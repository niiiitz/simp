use super::*;
use anyhow::{anyhow, Result};
use serde_json::Value;
use simp_protocol::{SimpSettings, TrackMetadata};
use std::collections::HashSet;

/// Fetches the user's Apple Music Cloud Playlists in native Rust (up to 2,500 playlists).
/// Requests `?include=catalog` so catalog playlists in the user's library use permanent `mzstatic.com` CDN artwork
/// instead of throttled/expiring `blobstore.apple.com` URLs.
pub fn fetch_cloud_playlists(settings: &SimpSettings) -> Result<Vec<AppleCloudPlaylistSummary>> {
    let (dev_token, user_token) = resolve_tokens(settings)?;
    let mut next_url: Option<String> =
        Some("/v1/me/library/playlists?include=catalog&limit=100".to_string());
    let mut items = Vec::new();
    let mut seen_ids = HashSet::new();

    for page_idx in 0..25 {
        let Some(ref url) = next_url else { break };
        let json = match apple_get_json(url, &dev_token, &user_token) {
            Ok(j) => j,
            Err(_) if page_idx == 0 && url.contains("include=catalog") => {
                match apple_get_json("/v1/me/library/playlists?limit=100", &dev_token, &user_token)
                {
                    Ok(j) => j,
                    Err(_) => break,
                }
            }
            Err(_) => break,
        };
        if let Some(arr) = json.get("data").and_then(|v| v.as_array()) {
            for pl in arr {
                let Some(id) = pl.get("id").and_then(|v| v.as_str()) else {
                    continue;
                };
                if !seen_ids.insert(id.to_string()) {
                    continue;
                }
                let attrs = pl.get("attributes").unwrap_or(pl);
                let name = attrs
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Apple Playlist")
                    .to_string();
                let description = attrs
                    .pointer("/description/standard")
                    .or_else(|| {
                        pl.pointer("/relationships/catalog/data/0/attributes/description/standard")
                    })
                    .and_then(|v| v.as_str())
                    .unwrap_or("iCloud Music Library Playlist")
                    .to_string();
                let rel_catalog_art = pl
                    .pointer("/relationships/catalog/data/0/attributes/artwork/url")
                    .and_then(|v| v.as_str());
                let attr_art = attrs.pointer("/artwork/url").and_then(|v| v.as_str());
                let raw_art = match (attr_art, rel_catalog_art) {
                    (Some(a), Some(c)) if a.contains("blobstore.apple.com") => Some(c),
                    (Some(a), _) => Some(a),
                    (None, Some(c)) => Some(c),
                    (None, None) => None,
                };
                let art_url = format_apple_art_url(raw_art, 300);
                let kind = if id.starts_with("pl.") {
                    "catalog"
                } else {
                    "library"
                }
                .to_string();
                items.push(AppleCloudPlaylistSummary {
                    id: id.to_string(),
                    name,
                    description,
                    art_url,
                    kind,
                });
            }
        }
        next_url = json
            .get("next")
            .and_then(|v| v.as_str())
            .map(with_limit_100);
    }

    Ok(items)
}

/// Resolves a permanent `mzstatic.com` cover artwork URL for an Apple Music playlist that has no playlist-level cover
/// (or whose `blobstore.apple.com` cover was rate-limited/expired) by fetching its first track with `?include=catalog&limit=1`.
pub fn fetch_playlist_cover_art(
    settings: &SimpSettings,
    playlist_id: &str,
    kind: Option<&str>,
) -> Option<String> {
    let (dev_token, user_token) = resolve_tokens(settings).ok()?;
    let storefront = get_storefront(&dev_token, &user_token);
    let clean_id = playlist_id
        .strip_prefix("applemusic:playlist:")
        .unwrap_or(playlist_id)
        .trim();
    if clean_id.is_empty() {
        return None;
    }
    let is_catalog = kind == Some("catalog") || clean_id.starts_with("pl.");
    let url = if is_catalog {
        format!(
            "/v1/catalog/{}/playlists/{}/tracks?limit=1",
            storefront,
            urlencode(clean_id)
        )
    } else {
        format!(
            "/v1/me/library/playlists/{}/tracks?include=catalog&limit=1",
            urlencode(clean_id)
        )
    };
    let json = apple_get_json(&url, &dev_token, &user_token).ok()?;
    let first_item = json.pointer("/data/0")?;
    let track = map_apple_item_to_track(first_item)?;
    track.art_url
}

/// Fetches all tracks for a library (`p.xxxx`) or catalog (`pl.xxxx`) playlist in native Rust,
/// automatically requesting `?include=catalog` so re-linked/moved cloud tracks resolve to their active catalog ID.
pub fn fetch_playlist_tracks(
    settings: &SimpSettings,
    playlist_id: &str,
    kind: Option<&str>,
) -> Result<Vec<TrackMetadata>> {
    let (dev_token, user_token) = resolve_tokens(settings)?;
    let storefront = get_storefront(&dev_token, &user_token);
    let clean_id = playlist_id
        .strip_prefix("applemusic:playlist:")
        .unwrap_or(playlist_id);
    let is_catalog = kind == Some("catalog") || clean_id.starts_with("pl.");

    let mut next_url: Option<String> = Some(if is_catalog {
        format!(
            "/v1/catalog/{}/playlists/{}/tracks?limit=100",
            storefront,
            urlencode(clean_id)
        )
    } else {
        format!(
            "/v1/me/library/playlists/{}/tracks?include=catalog&limit=100",
            urlencode(clean_id)
        )
    });

    let mut tracks = Vec::new();
    for _ in 0..10 {
        let Some(ref url) = next_url else { break };
        let Ok(json) = apple_get_json(url, &dev_token, &user_token) else {
            break;
        };
        if let Some(arr) = json.get("data").and_then(|v| v.as_array()) {
            for item in arr {
                if let Some(tr) = map_apple_item_to_track(item) {
                    tracks.push(tr);
                }
            }
        }
        next_url = json
            .get("next")
            .and_then(|v| v.as_str())
            .map(with_limit_100);
    }

    Ok(tracks)
}

/// Helper to parse a `library-albums` or `albums` JSON item into `AppleCloudAlbumSummary`,
/// automatically healing `blobstore.apple.com` artwork with `relationships.catalog.data[0]` when present.
pub(crate) fn parse_apple_album_summary(alb: &Value, default_kind: &str) -> Option<AppleCloudAlbumSummary> {
    let id = alb.get("id")?.as_str()?.trim();
    if id.is_empty() {
        return None;
    }
    let attrs = alb.get("attributes").unwrap_or(alb);
    let rel_catalog_art = alb
        .pointer("/relationships/catalog/data/0/attributes/artwork/url")
        .and_then(|v| v.as_str());
    let attr_art = attrs.pointer("/artwork/url").and_then(|v| v.as_str());
    let raw_art = match (attr_art, rel_catalog_art) {
        (Some(a), Some(c)) if a.contains("blobstore.apple.com") => Some(c),
        (Some(a), _) => Some(a),
        (None, Some(c)) => Some(c),
        (None, None) => None,
    };
    let release_year = attrs
        .get("releaseDate")
        .or_else(|| {
            alb.pointer("/relationships/catalog/data/0/attributes/releaseDate")
        })
        .and_then(|v| v.as_str())
        .and_then(|s| s.get(0..4))
        .and_then(|y| y.parse::<u32>().ok());
    let date_added = attrs
        .get("dateAdded")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let content_rating = extract_apple_content_rating(alb);
    let kind = if id.starts_with("l.") {
        "library"
    } else if id.chars().all(|c| c.is_ascii_digit()) {
        "catalog"
    } else {
        default_kind
    }
    .to_string();

    Some(AppleCloudAlbumSummary {
        id: id.to_string(),
        title: attrs
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("Album")
            .to_string(),
        artist: attrs
            .get("artistName")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown Artist")
            .to_string(),
        art_url: format_apple_art_url(raw_art, 300),
        track_count: attrs
            .get("trackCount")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as usize,
        release_year,
        kind,
        date_added,
        content_rating,
    })
}

/// Fetches a personal Cloud Library Album (`l.xxxx`) and all of its tracks from `/v1/me/library/albums/{id}`.
pub(crate) fn fetch_library_album_with_tracks(
    dev_token: &str,
    user_token: &str,
    lib_album_id: &str,
) -> Result<AppleFullAlbumResponse> {
    let alb_json = apple_get_json(
        &format!(
            "/v1/me/library/albums/{}?include=tracks,catalog",
            urlencode(lib_album_id)
        ),
        dev_token,
        user_token,
    )
    .or_else(|_| {
        apple_get_json(
            &format!("/v1/me/library/albums/{}?include=tracks", urlencode(lib_album_id)),
            dev_token,
            user_token,
        )
    })?;

    let alb_data = alb_json
        .pointer("/data/0")
        .ok_or_else(|| anyhow!("Library album {lib_album_id} not found in Your Library"))?;
    let mut summary = parse_apple_album_summary(alb_data, "library")
        .ok_or_else(|| anyhow!("Invalid library album payload for {lib_album_id}"))?;
    if let Some(ref art) = summary.art_url {
        summary.art_url = Some(art.replace("300x300bb", "400x400bb"));
    }

    let mut tracks: Vec<TrackMetadata> = alb_data
        .pointer("/relationships/tracks/data")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(map_apple_item_to_track).collect())
        .unwrap_or_default();

    let has_more_tracks = alb_data
        .pointer("/relationships/tracks/next")
        .and_then(|v| v.as_str())
        .is_some()
        || (summary.track_count > tracks.len() && summary.track_count > 0);

    if tracks.is_empty() || has_more_tracks {
        let mut next_url: Option<String> = Some(format!(
            "/v1/me/library/albums/{}/tracks?include=catalog&limit=100",
            urlencode(lib_album_id)
        ));
        let mut paginated = Vec::new();
        for page_idx in 0..6 {
            let Some(ref url) = next_url else { break };
            let page_json = match apple_get_json(url, dev_token, user_token) {
                Ok(j) => j,
                Err(_) if page_idx == 0 && url.contains("include=catalog") => {
                    match apple_get_json(
                        &format!("/v1/me/library/albums/{}/tracks?limit=100", urlencode(lib_album_id)),
                        dev_token,
                        user_token,
                    ) {
                        Ok(j) => j,
                        Err(_) => break,
                    }
                }
                Err(_) => break,
            };
            if let Some(arr) = page_json.get("data").and_then(|v| v.as_array()) {
                for item in arr {
                    if let Some(tr) = map_apple_item_to_track(item) {
                        paginated.push(tr);
                    }
                }
            }
            next_url = page_json
                .get("next")
                .and_then(|v| v.as_str())
                .map(with_limit_100);
        }
        if paginated.len() >= tracks.len() {
            tracks = paginated;
        }
    }

    // Heal any missing or expiring blobstore track artwork with the album's cover art
    if summary.art_url.is_none()
        || summary
            .art_url
            .as_deref()
            .map(|u| u.contains("blobstore.apple.com"))
            .unwrap_or(false)
    {
        if let Some(track_mz_art) = tracks
            .iter()
            .find_map(|t| t.art_url.as_ref().filter(|u| u.contains("mzstatic.com")))
            .cloned()
        {
            summary.art_url = Some(track_mz_art);
        } else if summary.art_url.is_none() {
            summary.art_url = tracks.first().and_then(|t| t.art_url.clone());
        }
    }
    if let Some(ref album_art) = summary.art_url {
        for tr in &mut tracks {
            let needs_art = tr
                .art_url
                .as_deref()
                .map(|u| u.is_empty() || (u.contains("blobstore.apple.com") && album_art.contains("mzstatic.com")))
                .unwrap_or(true);
            if needs_art {
                tr.art_url = Some(album_art.clone());
                remember_track_metadata_hint(tr);
            }
        }
    }
    if !tracks.is_empty() {
        summary.track_count = tracks.len();
    }
    if summary.content_rating.is_none()
        && tracks
            .iter()
            .any(|t| t.content_rating.as_deref() == Some("explicit"))
    {
        summary.content_rating = Some("explicit".to_string());
    }

    Ok(AppleFullAlbumResponse {
        album: summary,
        tracks,
    })
}

/// Resolves a full Apple Music Catalog Album or Personal Cloud Library Album (`l.xxxx`)
/// from a catalog album ID, library album ID (`l.xxxx`), or song URI.
pub fn fetch_full_album(
    settings: &SimpSettings,
    album_id: Option<&str>,
    song_uri: Option<&str>,
) -> Result<AppleFullAlbumResponse> {
    let (dev_token, user_token) = resolve_tokens(settings)?;
    let storefront = get_storefront(&dev_token, &user_token);

    let mut catalog_album_id: Option<String> = None;
    let mut library_album_id: Option<String> = None;

    if let Some(raw_alb) = album_id.filter(|s| !s.trim().is_empty()) {
        let clean_alb = raw_alb
            .strip_prefix("applemusic:album:")
            .unwrap_or(raw_alb)
            .trim();
        if clean_alb.starts_with("l.") {
            library_album_id = Some(clean_alb.to_string());
            if let Ok(json) = apple_get_json(
                &format!("/v1/me/library/albums/{}/catalog", urlencode(clean_alb)),
                &dev_token,
                &user_token,
            ) {
                catalog_album_id = json
                    .pointer("/data/0/id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
            }
        } else {
            catalog_album_id = Some(clean_alb.to_string());
        }
    }

    if catalog_album_id.is_none() && library_album_id.is_none() {
        if let Some(raw_song) = song_uri.filter(|s| !s.trim().is_empty()) {
            let clean_song = raw_song
                .strip_prefix("applemusic:song:")
                .or_else(|| raw_song.strip_prefix("applemusic:track:"))
                .or_else(|| raw_song.strip_prefix("applemusic:"))
                .unwrap_or(raw_song)
                .trim();
            if clean_song.starts_with("i.") {
                if let Ok(json) = apple_get_json(
                    &format!(
                        "/v1/me/library/songs/{}/catalog?include=albums",
                        urlencode(clean_song)
                    ),
                    &dev_token,
                    &user_token,
                ) {
                    catalog_album_id = json
                        .pointer("/data/0/relationships/albums/data/0/id")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                }
                if catalog_album_id.is_none() {
                    if let Ok(json) = apple_get_json(
                        &format!("/v1/me/library/songs/{}/albums", urlencode(clean_song)),
                        &dev_token,
                        &user_token,
                    ) {
                        library_album_id = json
                            .pointer("/data/0/id")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());
                    }
                }
            } else if let Ok(json) = apple_get_json(
                &format!(
                    "/v1/catalog/{}/songs/{}?include=albums",
                    storefront,
                    urlencode(clean_song)
                ),
                &dev_token,
                &user_token,
            ) {
                catalog_album_id = json
                    .pointer("/data/0/relationships/albums/data/0/id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
            }
        }
    }

    // If this is a personal Cloud Library album (`l.xxxx`) that is NOT in the public streaming catalog
    // (e.g., an uploaded vinyl download, Bandcamp purchase, or delisted release), resolve directly from `/v1/me/library/albums/{id}`!
    if let Some(ref lib_id) = library_album_id {
        if catalog_album_id.is_none() {
            return fetch_library_album_with_tracks(&dev_token, &user_token, lib_id);
        }
    }

    let Some(cat_id) = catalog_album_id else {
        return Err(anyhow!(
            "Could not resolve full album on Apple Music Catalog or Your Library"
        ));
    };

    let alb_json = match apple_get_json(
        &format!(
            "/v1/catalog/{}/albums/{}?include=tracks",
            storefront,
            urlencode(&cat_id)
        ),
        &dev_token,
        &user_token,
    ) {
        Ok(j) => j,
        Err(e) => {
            if let Some(ref lib_id) = library_album_id {
                return fetch_library_album_with_tracks(&dev_token, &user_token, lib_id);
            }
            return Err(e);
        }
    };

    let alb_data = alb_json
        .pointer("/data/0")
        .ok_or_else(|| anyhow!("Catalog album not found"))?;
    let attrs = alb_data.get("attributes").unwrap_or(alb_data);
    let tracks: Vec<TrackMetadata> = alb_data
        .pointer("/relationships/tracks/data")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(map_apple_item_to_track).collect())
        .unwrap_or_default();

    let release_year = attrs
        .get("releaseDate")
        .and_then(|v| v.as_str())
        .and_then(|s| s.get(0..4))
        .and_then(|y| y.parse::<u32>().ok());

    let art_url = format_apple_art_url(
        attrs.pointer("/artwork/url").and_then(|v| v.as_str()),
        400,
    )
    .or_else(|| tracks.first().and_then(|t| t.art_url.clone()));

    let track_count = if !tracks.is_empty() {
        tracks.len()
    } else {
        attrs
            .get("trackCount")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as usize
    };

    let mut content_rating = extract_apple_content_rating(alb_data);
    if content_rating.is_none()
        && tracks
            .iter()
            .any(|t| t.content_rating.as_deref() == Some("explicit"))
    {
        content_rating = Some("explicit".to_string());
    }

    let album = AppleCloudAlbumSummary {
        id: alb_data
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or(&cat_id)
            .to_string(),
        title: attrs
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("Apple Music Album")
            .to_string(),
        artist: attrs
            .get("artistName")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown Artist")
            .to_string(),
        art_url,
        track_count,
        release_year,
        kind: "catalog".to_string(),
        date_added: None,
        content_rating,
    };

    Ok(AppleFullAlbumResponse { album, tracks })
}

/// Live Apple Music Dual-Scope Search (`"Your Library"` `/v1/me/library/search` + `"Apple Music Catalog"` `/v1/catalog/{storefront}/search`).
/// Personal Cloud Library matches (`library-albums`, `library-playlists`, `library-songs`) are placed first so uploaded/matched
/// releases (such as vinyl companion digital downloads not in the streaming catalog) are immediately discoverable.
pub fn search_catalog(settings: &SimpSettings, term: &str) -> Result<AppleCatalogSearchResults> {
    let cleaned = term.trim();
    if cleaned.is_empty() {
        return Ok(AppleCatalogSearchResults {
            songs: Vec::new(),
            albums: Vec::new(),
            playlists: Vec::new(),
            stations: Vec::new(),
            artists: Vec::new(),
        });
    }

    let (dev_token, user_token) = resolve_tokens(settings)?;
    let storefront = get_storefront(&dev_token, &user_token);
    let encoded_term = urlencode(cleaned);

    let catalog_url = format!(
        "/v1/catalog/{}/search?term={}&types=songs,albums,playlists,stations,artists&limit=15",
        storefront, encoded_term
    );
    let library_url = format!(
        "/v1/me/library/search?term={}&types=library-albums,library-songs,library-playlists&limit=20",
        encoded_term
    );

    let (lib_res, cat_res) = std::thread::scope(|s| {
        let d1 = &dev_token;
        let u1 = &user_token;
        let l_url = &library_url;
        let lib_handle = s.spawn(move || apple_get_json(l_url, d1, u1));

        let d2 = &dev_token;
        let u2 = &user_token;
        let c_url = &catalog_url;
        let cat_handle = s.spawn(move || apple_get_json(c_url, d2, u2));

        (lib_handle.join().ok(), cat_handle.join().ok())
    });

    let mut songs: Vec<TrackMetadata> = Vec::new();
    let mut albums: Vec<AppleCloudAlbumSummary> = Vec::new();
    let mut playlists: Vec<AppleCloudPlaylistSummary> = Vec::new();
    let mut stations: Vec<AppleRadioStationSummary> = Vec::new();
    let mut artists: Vec<AppleArtistSummary> = Vec::new();

    let mut seen_song_uris = HashSet::new();
    let mut seen_album_ids = HashSet::new();
    let mut seen_playlist_ids = HashSet::new();
    let mut seen_artist_ids = HashSet::new();

    // 1. Parse Personal Cloud Library ("Your Library") matches first
    if let Some(Ok(lib_json)) = lib_res {
        let lib_results = lib_json.get("results").unwrap_or(&lib_json);

        if let Some(arr) = lib_results
            .pointer("/library-albums/data")
            .and_then(|v| v.as_array())
        {
            for alb in arr {
                if let Some(summary) = parse_apple_album_summary(alb, "library") {
                    if seen_album_ids.insert(summary.id.clone()) {
                        albums.push(summary);
                    }
                }
            }
        }

        if let Some(arr) = lib_results
            .pointer("/library-playlists/data")
            .and_then(|v| v.as_array())
        {
            for pl in arr {
                let Some(id) = pl.get("id").and_then(|v| v.as_str()) else {
                    continue;
                };
                if !seen_playlist_ids.insert(id.to_string()) {
                    continue;
                }
                let attrs = pl.get("attributes").unwrap_or(pl);
                playlists.push(AppleCloudPlaylistSummary {
                    id: id.to_string(),
                    name: attrs
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Library Playlist")
                        .to_string(),
                    description: attrs
                        .pointer("/description/standard")
                        .and_then(|v| v.as_str())
                        .unwrap_or("☁️ In Your Library")
                        .to_string(),
                    art_url: format_apple_art_url(
                        attrs.pointer("/artwork/url").and_then(|v| v.as_str()),
                        300,
                    ),
                    kind: "library".to_string(),
                });
            }
        }

        if let Some(arr) = lib_results
            .pointer("/library-songs/data")
            .and_then(|v| v.as_array())
        {
            for item in arr {
                if let Some(mut tr) = map_apple_item_to_track(item) {
                    if !tr.album.starts_with("☁️ ") && tr.uri.contains(":i.") {
                        tr.album = format!("☁️ {}", tr.album);
                    }
                    if seen_song_uris.insert(tr.uri.clone()) {
                        songs.push(tr);
                    }
                }
            }
        }
    }

    // 2. Parse Public Storefront Catalog matches & heal any blobstore artwork on matching Library Albums
    if let Some(Ok(json)) = cat_res {
        let results = json.get("results").unwrap_or(&json);

        if let Some(arr) = results.pointer("/artists/data").and_then(|v| v.as_array()) {
            for art_item in arr {
                let Some(id) = art_item.get("id").and_then(|v| v.as_str()) else {
                    continue;
                };
                if !seen_artist_ids.insert(id.to_string()) {
                    continue;
                }
                let attrs = art_item.get("attributes").unwrap_or(art_item);
                let name = attrs
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Artist")
                    .to_string();
                let genre = attrs
                    .pointer("/genreNames/0")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Apple Music Artist")
                    .to_string();
                let art_url = format_apple_art_url(
                    attrs.pointer("/artwork/url").and_then(|v| v.as_str()),
                    300,
                );
                artists.push(AppleArtistSummary {
                    id: id.to_string(),
                    name,
                    genre,
                    art_url,
                });
            }
        }

        if let Some(arr) = results.pointer("/albums/data").and_then(|v| v.as_array()) {
            for alb in arr {
                let Some(cat_alb) = parse_apple_album_summary(alb, "catalog") else {
                    continue;
                };
                let cat_title_lower = cat_alb.title.trim().to_lowercase();
                let cat_artist_lower = cat_alb.artist.trim().to_lowercase();

                if let Some(existing_lib) = albums.iter_mut().find(|a| {
                    a.kind == "library"
                        && a.title.trim().to_lowercase() == cat_title_lower
                        && a.artist.trim().to_lowercase() == cat_artist_lower
                        && (a.content_rating.is_none()
                            || cat_alb.content_rating.is_none()
                            || a.content_rating == cat_alb.content_rating)
                }) {
                    let lib_needs_art = existing_lib
                        .art_url
                        .as_deref()
                        .map(|u| u.is_empty() || u.contains("blobstore.apple.com"))
                        .unwrap_or(true);
                    if lib_needs_art && cat_alb.art_url.is_some() {
                        existing_lib.art_url = cat_alb.art_url.clone();
                    }
                    if existing_lib.release_year.is_none() {
                        existing_lib.release_year = cat_alb.release_year;
                    }
                    if existing_lib.content_rating.is_none() {
                        existing_lib.content_rating = cat_alb.content_rating.clone();
                    }
                    // If the user's library album is only a partial stub (fewer tracks than the full catalog album),
                    // also include the full catalog album so the user can open either!
                    if existing_lib.track_count >= cat_alb.track_count && existing_lib.track_count > 0 {
                        continue;
                    }
                }

                if seen_album_ids.insert(cat_alb.id.clone()) {
                    albums.push(cat_alb);
                }
            }
        }

        if let Some(arr) = results
            .pointer("/playlists/data")
            .and_then(|v| v.as_array())
        {
            for pl in arr {
                let Some(id) = pl.get("id").and_then(|v| v.as_str()) else {
                    continue;
                };
                if !seen_playlist_ids.insert(id.to_string()) {
                    continue;
                }
                let attrs = pl.get("attributes").unwrap_or(pl);
                playlists.push(AppleCloudPlaylistSummary {
                    id: id.to_string(),
                    name: attrs
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Playlist")
                        .to_string(),
                    description: attrs
                        .get("curatorName")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Apple Music Playlist")
                        .to_string(),
                    art_url: format_apple_art_url(
                        attrs.pointer("/artwork/url").and_then(|v| v.as_str()),
                        300,
                    ),
                    kind: "catalog".to_string(),
                });
            }
        }

        if let Some(arr) = results.pointer("/stations/data").and_then(|v| v.as_array()) {
            for st in arr {
                let Some(id) = st.get("id").and_then(|v| v.as_str()) else {
                    continue;
                };
                let attrs = st.get("attributes").unwrap_or(st);
                stations.push(AppleRadioStationSummary {
                    id: id.to_string(),
                    name: attrs
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Station")
                        .to_string(),
                    subtitle: attrs
                        .pointer("/editorialNotes/short")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Apple Music Radio")
                        .to_string(),
                    art_url: format_apple_art_url(
                        attrs.pointer("/artwork/url").and_then(|v| v.as_str()),
                        300,
                    ),
                    genre: None,
                });
            }
        }

        if let Some(arr) = results.pointer("/songs/data").and_then(|v| v.as_array()) {
            for item in arr {
                if let Some(tr) = map_apple_item_to_track(item) {
                    if seen_song_uris.insert(tr.uri.clone()) {
                        songs.push(tr);
                    }
                }
            }
        }
    }

    Ok(AppleCatalogSearchResults {
        songs,
        albums,
        playlists,
        stations,
        artists,
    })
}

/// Fetches the user's "Recently Added" personal Cloud Library albums (`/v1/me/library/recently-added?include=catalog&limit=25`
/// + `/v1/me/library/albums?include=catalog&limit=50`), automatically filtering out 1-track single-song playlist stubs
/// when full (`2+` track) albums are present.
pub fn fetch_library_recently_added(settings: &SimpSettings) -> Result<Vec<AppleCloudAlbumSummary>> {
    let (dev_token, user_token) = resolve_tokens(settings)?;
    let mut raw_albums = Vec::new();
    let mut seen_ids = HashSet::new();

    for url in [
        "/v1/me/library/recently-added?include=catalog&limit=25",
        "/v1/me/library/recently-added?include=catalog&offset=25&limit=25",
    ] {
        let json = match apple_get_json(url, &dev_token, &user_token) {
            Ok(j) => j,
            Err(_) => {
                let fallback = url.replace("include=catalog&", "");
                match apple_get_json(&fallback, &dev_token, &user_token) {
                    Ok(j) => j,
                    Err(_) => break,
                }
            }
        };
        if let Some(arr) = json.get("data").and_then(|v| v.as_array()) {
            if arr.is_empty() {
                break;
            }
            for item in arr {
                let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
                if item_type == "library-albums" || item_type == "albums" {
                    if let Some(alb) = parse_apple_album_summary(item, "library") {
                        if seen_ids.insert(alb.id.clone()) {
                            raw_albums.push(alb);
                        }
                    }
                }
            }
        }
    }

    let full_albums: Vec<AppleCloudAlbumSummary> = raw_albums
        .iter()
        .filter(|a| a.track_count >= 2)
        .cloned()
        .collect();

    if !full_albums.is_empty() {
        Ok(full_albums)
    } else {
        Ok(raw_albums)
    }
}


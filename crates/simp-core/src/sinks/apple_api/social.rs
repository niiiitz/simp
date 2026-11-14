use super::*;
use anyhow::{anyhow, Result};
use simp_protocol::{SimpSettings, TrackMetadata};
use std::collections::HashSet;

/// Resolves the canonical `https://music.apple.com/{storefront}/...` web URL for an Apple Music
/// song, album, playlist, artist, or station per Apple Music Identity & Attribution Guidelines.
pub fn resolve_apple_canonical_url(settings: &SimpSettings, kind: &str, raw_id: &str) -> String {
    let sf = storefront_cache()
        .lock()
        .ok()
        .and_then(|g| g.clone())
        .or_else(|| {
            resolve_tokens(settings)
                .ok()
                .map(|(d, u)| get_storefront(&d, &u))
        })
        .unwrap_or_else(|| "us".to_string());

    let clean_id = raw_id
        .trim()
        .strip_prefix("applemusic:song:")
        .or_else(|| raw_id.trim().strip_prefix("applemusic:track:"))
        .or_else(|| raw_id.trim().strip_prefix("applemusic:album:"))
        .or_else(|| raw_id.trim().strip_prefix("applemusic:playlist:"))
        .or_else(|| raw_id.trim().strip_prefix("applemusic:artist:"))
        .or_else(|| raw_id.trim().strip_prefix("applemusic:station:"))
        .or_else(|| raw_id.trim().strip_prefix("applemusic:"))
        .unwrap_or(raw_id.trim());

    if clean_id.is_empty() {
        return format!("https://music.apple.com/{sf}/new");
    }

    match kind.trim().to_ascii_lowercase().as_str() {
        "album" | "albums" | "cloud_album" => {
            if clean_id.starts_with("l.") {
                "https://music.apple.com/library/albums".to_string()
            } else {
                format!("https://music.apple.com/{sf}/album/{}", urlencode(clean_id))
            }
        }
        "playlist" | "playlists" | "cloud_playlist" => {
            if clean_id.starts_with("p.") {
                format!("https://music.apple.com/library/playlist/{}", urlencode(clean_id))
            } else {
                format!(
                    "https://music.apple.com/{sf}/playlist/{}",
                    urlencode(clean_id)
                )
            }
        }
        "artist" | "artists" => {
            format!("https://music.apple.com/{sf}/artist/{}", urlencode(clean_id))
        }
        "station" | "stations" => {
            format!("https://music.apple.com/{sf}/station/{}", urlencode(clean_id))
        }
        _ => {
            if clean_id.starts_with("i.") {
                "https://music.apple.com/library/songs".to_string()
            } else {
                format!("https://music.apple.com/{sf}/song/{}", urlencode(clean_id))
            }
        }
    }
}

/// Sets or clears a user's Apple Music Favorite/Love rating (`PUT` or `DELETE` `/v1/me/ratings/{kind}/{id}`).
/// Kept strictly separate from `add_to_apple_cloud_library` per Item #4.
pub fn set_apple_item_rating(
    settings: &SimpSettings,
    item_id_or_uri: &str,
    item_kind: &str,
    favorited: bool,
) -> Result<()> {
    let (dev_token, user_token) = resolve_tokens(settings)?;
    let clean_id = item_id_or_uri
        .strip_prefix("applemusic:song:")
        .or_else(|| item_id_or_uri.strip_prefix("applemusic:track:"))
        .or_else(|| item_id_or_uri.strip_prefix("applemusic:album:"))
        .or_else(|| item_id_or_uri.strip_prefix("applemusic:playlist:"))
        .or_else(|| item_id_or_uri.strip_prefix("applemusic:"))
        .unwrap_or(item_id_or_uri)
        .trim();
    if clean_id.is_empty() {
        return Err(anyhow!("Missing Apple Music item ID for rating"));
    }

    let endpoint_kind = match item_kind.trim().to_ascii_lowercase().as_str() {
        "album" | "albums" => {
            if clean_id.starts_with("l.") {
                "library-albums"
            } else {
                "albums"
            }
        }
        "playlist" | "playlists" => {
            if clean_id.starts_with("p.") {
                "library-playlists"
            } else {
                "playlists"
            }
        }
        _ => {
            if clean_id.starts_with("i.") {
                "library-songs"
            } else {
                "songs"
            }
        }
    };

    let url = format!(
        "https://api.music.apple.com/v1/me/ratings/{}/{}",
        endpoint_kind,
        urlencode(clean_id)
    );
    let auth_header = format!("Bearer {}", dev_token.trim());
    let headers = [
        ("Authorization", auth_header.as_str()),
        ("Music-User-Token", user_token.trim()),
        ("X-Apple-Music-User-Token", user_token.trim()),
        ("Content-Type", "application/json"),
        ("Origin", "https://music.apple.com"),
        ("Referer", "https://music.apple.com/"),
    ];

    if favorited {
        let body = serde_json::json!({
            "type": "ratings",
            "attributes": {
                "value": 1
            }
        });
        let body_bytes = serde_json::to_vec(&body)?;
        crate::http_pool::http_custom_bytes("PUT", &url, &headers, Some(&body_bytes), 12)
            .with_context(|| format!("Failed to favorite Apple Music item {clean_id}"))?;
    } else {
        crate::http_pool::http_custom_bytes("DELETE", &url, &headers, None, 12)
            .with_context(|| format!("Failed to remove Apple Music rating for {clean_id}"))?;
    }
    Ok(())
}

/// Adds a catalog song, album, or playlist to the user's personal Apple Music Cloud Library
/// (`POST /v1/me/library?ids[{songs|albums|playlists}]={id}`).
/// Kept strictly separate from `set_apple_item_rating` (`♥ Favorite`) per Item #4.
pub fn add_to_apple_cloud_library(
    settings: &SimpSettings,
    item_id_or_uri: &str,
    item_kind: &str,
) -> Result<()> {
    let (dev_token, user_token) = resolve_tokens(settings)?;
    let clean_id = item_id_or_uri
        .strip_prefix("applemusic:song:")
        .or_else(|| item_id_or_uri.strip_prefix("applemusic:track:"))
        .or_else(|| item_id_or_uri.strip_prefix("applemusic:album:"))
        .or_else(|| item_id_or_uri.strip_prefix("applemusic:playlist:"))
        .or_else(|| item_id_or_uri.strip_prefix("applemusic:"))
        .unwrap_or(item_id_or_uri)
        .trim();
    if clean_id.is_empty() {
        return Err(anyhow!("Missing Apple Music catalog ID to add to library"));
    }

    let query_type = match item_kind.trim().to_ascii_lowercase().as_str() {
        "album" | "albums" => "albums",
        "playlist" | "playlists" => "playlists",
        _ => "songs",
    };

    let url = format!(
        "https://api.music.apple.com/v1/me/library?ids[{}]={}",
        query_type,
        urlencode(clean_id)
    );
    let auth_header = format!("Bearer {}", dev_token.trim());
    let headers = [
        ("Authorization", auth_header.as_str()),
        ("Music-User-Token", user_token.trim()),
        ("X-Apple-Music-User-Token", user_token.trim()),
        ("Origin", "https://music.apple.com"),
        ("Referer", "https://music.apple.com/"),
    ];

    crate::http_pool::http_custom_bytes("POST", &url, &headers, Some(b""), 15)
        .with_context(|| format!("Failed to add {clean_id} to Apple Music Cloud Library"))?;
    Ok(())
}

/// Resolves an Apple Music Artist Profile (`Top Tracks`, `Albums`, `Singles & EPs`, and `Related Artists`)
/// by catalog artist ID or artist name (`name:<artist>`).
pub fn fetch_apple_artist_profile(
    settings: &SimpSettings,
    artist_id_or_name: &str,
) -> Result<AppleArtistProfileResponse> {
    let (dev_token, user_token) = resolve_tokens(settings)?;
    let storefront = get_storefront(&dev_token, &user_token);
    let raw = artist_id_or_name
        .strip_prefix("applemusic:artist:")
        .unwrap_or(artist_id_or_name)
        .trim();
    if raw.is_empty() {
        return Err(anyhow!("Missing Apple Music artist ID or name"));
    }

    let resolved_id = if let Some(name_query) = raw.strip_prefix("name:") {
        let q = name_query.trim();
        let search_json = apple_get_json(
            &format!(
                "/v1/catalog/{storefront}/search?term={}&types=artists&limit=5",
                urlencode(q)
            ),
            &dev_token,
            &user_token,
        )?;
        let q_lower = q.to_lowercase();
        let arr = search_json
            .pointer("/results/artists/data")
            .and_then(|v| v.as_array())
            .ok_or_else(|| anyhow!("No Apple Music artist found matching '{q}'"))?;
        arr.iter()
            .find(|a| {
                a.pointer("/attributes/name")
                    .and_then(|v| v.as_str())
                    .map(|n| n.trim().to_lowercase() == q_lower)
                    .unwrap_or(false)
            })
            .or_else(|| arr.first())
            .and_then(|a| a.get("id").and_then(|v| v.as_str()))
            .map(|s| s.to_string())
            .ok_or_else(|| anyhow!("No Apple Music artist found matching '{q}'"))?
    } else if raw.chars().all(|c| c.is_ascii_digit()) {
        raw.to_string()
    } else {
        let search_json = apple_get_json(
            &format!(
                "/v1/catalog/{storefront}/search?term={}&types=artists&limit=5",
                urlencode(raw)
            ),
            &dev_token,
            &user_token,
        )?;
        let raw_lower = raw.to_lowercase();
        let arr = search_json
            .pointer("/results/artists/data")
            .and_then(|v| v.as_array())
            .ok_or_else(|| anyhow!("No Apple Music artist found matching '{raw}'"))?;
        arr.iter()
            .find(|a| {
                a.pointer("/attributes/name")
                    .and_then(|v| v.as_str())
                    .map(|n| n.trim().to_lowercase() == raw_lower)
                    .unwrap_or(false)
            })
            .or_else(|| arr.first())
            .and_then(|a| a.get("id").and_then(|v| v.as_str()))
            .map(|s| s.to_string())
            .ok_or_else(|| anyhow!("No Apple Music artist found matching '{raw}'"))?
    };

    let artist_json = apple_get_json(
        &format!(
            "/v1/catalog/{storefront}/artists/{}?views=top-songs,full-albums,singles,similar-artists&include=albums",
            urlencode(&resolved_id)
        ),
        &dev_token,
        &user_token,
    )
    .or_else(|_| {
        apple_get_json(
            &format!(
                "/v1/catalog/{storefront}/artists/{}?include=albums",
                urlencode(&resolved_id)
            ),
            &dev_token,
            &user_token,
        )
    })?;

    let artist_node = artist_json
        .pointer("/data/0")
        .ok_or_else(|| anyhow!("Artist {resolved_id} not found in Apple Music catalog"))?;
    let attrs = artist_node.get("attributes").unwrap_or(artist_node);
    let artist_summary = AppleArtistSummary {
        id: resolved_id.clone(),
        name: attrs
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("Artist")
            .to_string(),
        genre: attrs
            .pointer("/genreNames/0")
            .and_then(|v| v.as_str())
            .unwrap_or("Apple Music Artist")
            .to_string(),
        art_url: format_apple_art_url(
            attrs.pointer("/artwork/url").and_then(|v| v.as_str()),
            400,
        ),
    };

    let mut top_tracks: Vec<TrackMetadata> = Vec::new();
    let mut seen_tracks = HashSet::new();
    if let Some(arr) = artist_node
        .pointer("/views/top-songs/data")
        .and_then(|v| v.as_array())
    {
        for item in arr {
            if let Some(tr) = map_apple_item_to_track(item) {
                if seen_tracks.insert(tr.uri.clone()) {
                    top_tracks.push(tr);
                }
            }
        }
    }
    if top_tracks.is_empty() {
        if let Ok(songs_json) = apple_get_json(
            &format!(
                "/v1/catalog/{storefront}/artists/{}/songs?limit=25",
                urlencode(&resolved_id)
            ),
            &dev_token,
            &user_token,
        ) {
            if let Some(arr) = songs_json.get("data").and_then(|v| v.as_array()) {
                for item in arr {
                    if let Some(tr) = map_apple_item_to_track(item) {
                        if seen_tracks.insert(tr.uri.clone()) {
                            top_tracks.push(tr);
                        }
                    }
                }
            }
        }
    }

    let mut albums: Vec<AppleCloudAlbumSummary> = Vec::new();
    let mut singles: Vec<AppleCloudAlbumSummary> = Vec::new();
    let mut seen_albums = HashSet::new();

    if let Some(arr) = artist_node
        .pointer("/views/full-albums/data")
        .and_then(|v| v.as_array())
    {
        for alb in arr {
            if let Some(summary) = parse_apple_album_summary(alb, "catalog") {
                if seen_albums.insert(summary.id.clone()) {
                    albums.push(summary);
                }
            }
        }
    }
    if let Some(arr) = artist_node
        .pointer("/views/singles/data")
        .and_then(|v| v.as_array())
    {
        for alb in arr {
            if let Some(summary) = parse_apple_album_summary(alb, "catalog") {
                if seen_albums.insert(summary.id.clone()) {
                    singles.push(summary);
                }
            }
        }
    }
    if let Some(arr) = artist_node
        .pointer("/relationships/albums/data")
        .and_then(|v| v.as_array())
    {
        for alb in arr {
            let is_single = alb
                .pointer("/attributes/isSingle")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if let Some(summary) = parse_apple_album_summary(alb, "catalog") {
                if !seen_albums.insert(summary.id.clone()) {
                    continue;
                }
                let title_lower = summary.title.to_lowercase();
                if is_single
                    || summary.track_count <= 3
                    || title_lower.contains("- single")
                    || title_lower.contains("- ep")
                {
                    singles.push(summary);
                } else {
                    albums.push(summary);
                }
            }
        }
    }

    let mut related_artists: Vec<AppleArtistSummary> = Vec::new();
    let mut seen_related = HashSet::new();
    if let Some(arr) = artist_node
        .pointer("/views/similar-artists/data")
        .and_then(|v| v.as_array())
    {
        for rel in arr {
            let Some(id) = rel.get("id").and_then(|v| v.as_str()) else {
                continue;
            };
            if !seen_related.insert(id.to_string()) {
                continue;
            };
            let rel_attrs = rel.get("attributes").unwrap_or(rel);
            related_artists.push(AppleArtistSummary {
                id: id.to_string(),
                name: rel_attrs
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Artist")
                    .to_string(),
                genre: rel_attrs
                    .pointer("/genreNames/0")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Similar Artist")
                    .to_string(),
                art_url: format_apple_art_url(
                    rel_attrs.pointer("/artwork/url").and_then(|v| v.as_str()),
                    300,
                ),
            });
        }
    }

    let mut final_artist = artist_summary;
    if final_artist.art_url.is_none() {
        final_artist.art_url = top_tracks
            .first()
            .and_then(|t| t.art_url.clone())
            .or_else(|| albums.first().and_then(|a| a.art_url.clone()));
    }

    Ok(AppleArtistProfileResponse {
        artist: final_artist,
        top_tracks,
        albums,
        singles,
        related_artists,
    })
}

/// Fetches the Apple Music "New" / Top Charts feed in native Rust.
pub fn fetch_new_feed(settings: &SimpSettings) -> Result<AppleNewFeedResponse> {
    let (dev_token, user_token) = resolve_tokens(settings)?;
    let storefront = get_storefront(&dev_token, &user_token);

    let mut recent_releases = Vec::new();
    let mut albums = Vec::new();
    let mut playlists = Vec::new();
    let mut songs = Vec::new();
    let mut seen_recent_releases = HashSet::new();
    let mut seen_albums = HashSet::new();
    let mut seen_playlists = HashSet::new();
    let mut seen_songs = HashSet::new();

    // 1. Personalized "New Releases For You" / "Recent Releases" from `/v1/me/recommendations`
    if let Ok(rec_json) = apple_get_json("/v1/me/recommendations?limit=12", &dev_token, &user_token)
    {
        if let Some(arr) = rec_json.get("data").and_then(|v| v.as_array()) {
            for rec in arr {
                let title = rec
                    .pointer("/attributes/title/stringForDisplay")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_lowercase();
                if title.contains("new release")
                    || title.contains("recent release")
                    || title == "new music"
                {
                    if let Some(contents) = rec
                        .pointer("/relationships/contents/data")
                        .and_then(|v| v.as_array())
                    {
                        for item in contents {
                            let item_type =
                                item.get("type").and_then(|v| v.as_str()).unwrap_or("");
                            if item_type == "albums" || item_type == "library-albums" {
                                if let Some(alb) = parse_apple_album_summary(item, "catalog") {
                                    if seen_recent_releases.insert(alb.id.clone()) {
                                        recent_releases.push(alb);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if let Ok(json) = apple_get_json(
        &format!("/v1/catalog/{storefront}/charts?types=albums,playlists,songs&limit=15"),
        &dev_token,
        &user_token,
    ) {
        if let Some(alb_charts) = json.pointer("/results/albums").and_then(|v| v.as_array()) {
            for chart in alb_charts {
                if let Some(arr) = chart.get("data").and_then(|v| v.as_array()) {
                    for alb in arr {
                        let Some(id) = alb.get("id").and_then(|v| v.as_str()) else { continue };
                        if !seen_albums.insert(id.to_string()) { continue; }
                        let attrs = alb.get("attributes").unwrap_or(alb);
                        albums.push(AppleCloudAlbumSummary {
                            id: id.to_string(),
                            title: attrs.get("name").and_then(|v| v.as_str()).unwrap_or("New Album").to_string(),
                            artist: attrs.get("artistName").and_then(|v| v.as_str()).unwrap_or("Apple Music").to_string(),
                            art_url: format_apple_art_url(attrs.pointer("/artwork/url").and_then(|v| v.as_str()), 300),
                            track_count: attrs.get("trackCount").and_then(|v| v.as_u64()).unwrap_or(0) as usize,
                            release_year: attrs.get("releaseDate").and_then(|v| v.as_str()).and_then(|s| s.get(0..4)).and_then(|y| y.parse::<u32>().ok()),
                            kind: "catalog".to_string(),
                            date_added: None,
                            content_rating: extract_apple_content_rating(alb),
                        });
                    }
                }
            }
        }
        if let Some(pl_charts) = json.pointer("/results/playlists").and_then(|v| v.as_array()) {
            for chart in pl_charts {
                if let Some(arr) = chart.get("data").and_then(|v| v.as_array()) {
                    for pl in arr {
                        let Some(id) = pl.get("id").and_then(|v| v.as_str()) else { continue };
                        if !seen_playlists.insert(id.to_string()) { continue; }
                        let attrs = pl.get("attributes").unwrap_or(pl);
                        playlists.push(AppleCloudPlaylistSummary {
                            id: id.to_string(),
                            name: attrs.get("name").and_then(|v| v.as_str()).unwrap_or("Featured Playlist").to_string(),
                            description: attrs.get("curatorName").or_else(|| attrs.pointer("/editorialNotes/short")).and_then(|v| v.as_str()).unwrap_or("Apple Music New & Featured").to_string(),
                            art_url: format_apple_art_url(attrs.pointer("/artwork/url").and_then(|v| v.as_str()), 300),
                            kind: "catalog".to_string(),
                        });
                    }
                }
            }
        }
        if let Some(song_charts) = json.pointer("/results/songs").and_then(|v| v.as_array()) {
            for chart in song_charts {
                if let Some(arr) = chart.get("data").and_then(|v| v.as_array()) {
                    for item in arr {
                        if let Some(tr) = map_apple_item_to_track(item) {
                            if seen_songs.insert(tr.uri.clone()) {
                                songs.push(tr);
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(AppleNewFeedResponse {
        recent_releases,
        albums,
        playlists,
        songs,
    })
}


use super::*;
use anyhow::Result;
use serde_json::Value;
use simp_protocol::{SimpSettings, TrackMetadata};
use std::collections::HashSet;

/// Fetches Radio & For You recommendations in native Rust.
pub fn fetch_radio_and_for_you(settings: &SimpSettings) -> Result<AppleRadioAndForYouResponse> {
    let (dev_token, user_token) = resolve_tokens(settings)?;
    let storefront = get_storefront(&dev_token, &user_token);

    let mut stations = Vec::new();
    let mut personal_stations = Vec::new();
    let mut live_stations = Vec::new();
    let mut playlists = Vec::new();
    let mut albums = Vec::new();
    let mut new_releases = Vec::new();
    let mut seen_stations = HashSet::new();
    let mut seen_personal_stations = HashSet::new();
    let mut seen_live_stations = HashSet::new();
    let mut seen_playlists = HashSet::new();
    let mut seen_albums = HashSet::new();
    let mut seen_new_releases = HashSet::new();

    fn is_live_broadcast_station(st: &Value, fallback_sub: &str) -> bool {
        let id = st.get("id").and_then(|v| v.as_str()).unwrap_or("");
        if id.contains("u-") {
            return false;
        }
        let attrs = st.get("attributes").unwrap_or(st);
        if attrs.get("isLive").and_then(|v| v.as_bool()) == Some(true) {
            return true;
        }
        let name_lower = attrs
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_lowercase();
        if name_lower.contains("'s station")
            || name_lower.contains("’s station")
            || name_lower.contains("discovery station")
        {
            return false;
        }
        if name_lower.starts_with("apple music ")
            || name_lower.starts_with("apple música ")
            || fallback_sub == "Live Global Radio"
        {
            return true;
        }
        false
    }

    fn build_station_summary(st: &Value, fallback_sub: &str) -> Option<AppleRadioStationSummary> {
        let id = st.get("id").and_then(|v| v.as_str())?;
        let attrs = st.get("attributes").unwrap_or(st);
        Some(AppleRadioStationSummary {
            id: id.to_string(),
            name: attrs
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("Radio Station")
                .to_string(),
            subtitle: attrs
                .pointer("/editorialNotes/short")
                .or_else(|| attrs.pointer("/editorialNotes/tagline"))
                .and_then(|v| v.as_str())
                .unwrap_or(fallback_sub)
                .to_string(),
            art_url: format_apple_art_url(
                attrs.pointer("/artwork/url").and_then(|v| v.as_str()),
                300,
            ),
            genre: None,
        })
    }

    fn push_station_to(
        stations: &mut Vec<AppleRadioStationSummary>,
        seen_stations: &mut HashSet<String>,
        st: &Value,
        fallback_sub: &str,
    ) {
        if let Some(summary) = build_station_summary(st, fallback_sub) {
            if seen_stations.insert(summary.id.clone()) {
                stations.push(summary);
            }
        }
    }

    let mut push_classified_station = |st: &Value, fallback_sub: &str| {
        if let Some(summary) = build_station_summary(st, fallback_sub) {
            if seen_stations.insert(summary.id.clone()) {
                stations.push(summary.clone());
            }
            if is_live_broadcast_station(st, fallback_sub) {
                if seen_live_stations.insert(summary.id.clone()) {
                    live_stations.push(summary);
                }
            } else if seen_personal_stations.insert(summary.id.clone()) {
                personal_stations.push(summary);
            }
        }
    };

    let mut shelves: Vec<AppleRecommendationShelf> = Vec::new();
    let mut recently_played: Vec<TrackMetadata> = Vec::new();

    if let Ok(json) = apple_get_json("/v1/me/recent/radio-stations?limit=12", &dev_token, &user_token) {
        if let Some(arr) = json.get("data").and_then(|v| v.as_array()) {
            for st in arr {
                push_classified_station(st, "Recent Radio Station");
            }
        }
    }

    // Recently Played Albums / Playlists / Stations (`/v1/me/recent/played?limit=12`)
    if let Ok(json) = apple_get_json("/v1/me/recent/played?limit=12", &dev_token, &user_token) {
        if let Some(arr) = json.get("data").and_then(|v| v.as_array()) {
            let mut recent_shelf = AppleRecommendationShelf {
                id: "recently-played-items".to_string(),
                title: "Recently Played".to_string(),
                is_social: false,
                playlists: Vec::new(),
                albums: Vec::new(),
                stations: Vec::new(),
            };
            let mut shelf_seen_st = HashSet::new();
            for item in arr {
                let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
                let attrs = item.get("attributes").unwrap_or(item);
                let Some(id) = item.get("id").and_then(|v| v.as_str()) else { continue };
                match item_type {
                    "stations" => {
                        push_classified_station(item, "Recently Played");
                        if ! is_live_broadcast_station(item, "Recently Played") {
                            push_station_to(&mut recent_shelf.stations, &mut shelf_seen_st, item, "Recently Played");
                        }
                    }
                    "playlists" | "library-playlists" => {
                        recent_shelf.playlists.push(AppleCloudPlaylistSummary {
                            id: id.to_string(),
                            name: attrs.get("name").and_then(|v| v.as_str()).unwrap_or("Playlist").to_string(),
                            description: attrs.get("curatorName").and_then(|v| v.as_str()).unwrap_or("Recently Played").to_string(),
                            art_url: format_apple_art_url(attrs.pointer("/artwork/url").and_then(|v| v.as_str()), 300),
                            kind: if id.starts_with("pl.") { "catalog" } else { "library" }.to_string(),
                        });
                    }
                    "albums" | "library-albums" => {
                        if let Some(alb) = parse_apple_album_summary(
                            item,
                            if id.starts_with("l.") { "library" } else { "catalog" },
                        ) {
                            recent_shelf.albums.push(alb);
                        }
                    }
                    _ => {}
                }
            }
            if !recent_shelf.playlists.is_empty()
                || !recent_shelf.albums.is_empty()
                || !recent_shelf.stations.is_empty()
            {
                shelves.push(recent_shelf);
            }
        }
    }

    if let Ok(json) = apple_get_json("/v1/me/history/heavy-rotation?limit=15", &dev_token, &user_token) {
        if let Some(arr) = json.get("data").and_then(|v| v.as_array()) {
            let mut heavy_shelf = AppleRecommendationShelf {
                id: "heavy-rotation".to_string(),
                title: "Heavy Rotation".to_string(),
                is_social: false,
                playlists: Vec::new(),
                albums: Vec::new(),
                stations: Vec::new(),
            };
            let mut shelf_seen_stations = HashSet::new();
            for item in arr {
                let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
                let attrs = item.get("attributes").unwrap_or(item);
                let Some(id) = item.get("id").and_then(|v| v.as_str()) else { continue };
                match item_type {
                    "stations" => {
                        push_classified_station(item, "Heavy Rotation");
                        if !is_live_broadcast_station(item, "Heavy Rotation") {
                            push_station_to(
                                &mut heavy_shelf.stations,
                                &mut shelf_seen_stations,
                                item,
                                "Heavy Rotation",
                            );
                        }
                    }
                    "playlists" | "library-playlists" => {
                        let pl = AppleCloudPlaylistSummary {
                            id: id.to_string(),
                            name: attrs.get("name").and_then(|v| v.as_str()).unwrap_or("Mix").to_string(),
                            description: attrs.get("curatorName").and_then(|v| v.as_str()).unwrap_or("Heavy Rotation").to_string(),
                            art_url: format_apple_art_url(attrs.pointer("/artwork/url").and_then(|v| v.as_str()), 300),
                            kind: if id.starts_with("pl.") { "catalog" } else { "library" }.to_string(),
                        };
                        if seen_playlists.insert(id.to_string()) {
                            playlists.push(pl.clone());
                        }
                        heavy_shelf.playlists.push(pl);
                    }
                    "albums" | "library-albums" => {
                        if let Some(alb) = parse_apple_album_summary(
                            item,
                            if id.starts_with("l.") { "library" } else { "catalog" },
                        ) {
                            if seen_albums.insert(id.to_string()) {
                                albums.push(alb.clone());
                            }
                            heavy_shelf.albums.push(alb);
                        }
                    }
                    _ => {}
                }
            }
            if !heavy_shelf.playlists.is_empty()
                || !heavy_shelf.albums.is_empty()
                || !heavy_shelf.stations.is_empty()
            {
                shelves.push(heavy_shelf);
            }
        }
    }

    if let Ok(json) = apple_get_json("/v1/me/recommendations?limit=12", &dev_token, &user_token) {
        if let Some(arr) = json.get("data").and_then(|v| v.as_array()) {
            for (idx, rec) in arr.iter().enumerate() {
                let rec_id = rec
                    .get("id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| format!("rec-{idx}"));
                let title = rec
                    .pointer("/attributes/title/stringForDisplay")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Made For You");
                let title_lower = title.to_lowercase();
                let is_new_release_shelf = title_lower.contains("new release")
                    || title_lower.contains("recent release")
                    || title_lower == "new music";
                let is_social = title_lower.contains("friend")
                    || title_lower.contains("listening to")
                    || rec
                        .pointer("/attributes/isGroupRecommendation")
                        .and_then(|v| v.as_bool())
                        == Some(true);

                let mut shelf = AppleRecommendationShelf {
                    id: rec_id,
                    title: title.to_string(),
                    is_social,
                    playlists: Vec::new(),
                    albums: Vec::new(),
                    stations: Vec::new(),
                };
                let mut shelf_seen_stations = HashSet::new();
                if let Some(contents) = rec
                    .pointer("/relationships/contents/data")
                    .and_then(|v| v.as_array())
                {
                    for item in contents {
                        let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
                        let attrs = item.get("attributes").unwrap_or(item);
                        let Some(id) = item.get("id").and_then(|v| v.as_str()) else { continue };
                        match item_type {
                            "stations" => {
                                push_classified_station(item, title);
                                if !is_live_broadcast_station(item, title) {
                                    push_station_to(
                                        &mut shelf.stations,
                                        &mut shelf_seen_stations,
                                        item,
                                        title,
                                    );
                                }
                            }
                            "playlists" | "library-playlists" => {
                                let pl = AppleCloudPlaylistSummary {
                                    id: id.to_string(),
                                    name: attrs.get("name").and_then(|v| v.as_str()).unwrap_or("Mix").to_string(),
                                    description: attrs.get("curatorName").and_then(|v| v.as_str()).unwrap_or(title).to_string(),
                                    art_url: format_apple_art_url(attrs.pointer("/artwork/url").and_then(|v| v.as_str()), 300),
                                    kind: if id.starts_with("pl.") { "catalog" } else { "library" }.to_string(),
                                };
                                if seen_playlists.insert(id.to_string()) {
                                    playlists.push(pl.clone());
                                }
                                shelf.playlists.push(pl);
                            }
                            "albums" | "library-albums" => {
                                if let Some(alb) = parse_apple_album_summary(
                                    item,
                                    if id.starts_with("l.") { "library" } else { "catalog" },
                                ) {
                                    if is_new_release_shelf {
                                        if seen_new_releases.insert(alb.id.clone()) {
                                            new_releases.push(alb.clone());
                                        }
                                    }
                                    if seen_albums.insert(id.to_string()) {
                                        albums.push(alb.clone());
                                    }
                                    shelf.albums.push(alb);
                                }
                            }
                            _ => {}
                        }
                    }
                }
                if !shelf.playlists.is_empty()
                    || !shelf.albums.is_empty()
                    || !shelf.stations.is_empty()
                {
                    shelves.push(shelf);
                }
            }
        }
    }

    if let Ok(json) = apple_get_json("/v1/me/recent/played/tracks?limit=24", &dev_token, &user_token) {
        if let Some(arr) = json.get("data").and_then(|v| v.as_array()) {
            let mut seen_recent = HashSet::new();
            for item in arr {
                if let Some(tr) = map_apple_item_to_track(item) {
                    if seen_recent.insert(tr.uri.clone()) {
                        recently_played.push(tr);
                    }
                }
            }
        }
    }

    // If `/v1/me/recommendations` didn't include a dedicated "New Releases For You" shelf (or had very few items),
    // also surface the newest releases from the user's top/recently played artists!
    if new_releases.len() < 4 {
        let mut seed_artists = Vec::new();
        let mut seen_seed_artists = HashSet::new();
        for alb in albums.iter().take(6) {
            let a = alb.artist.trim();
            if !a.is_empty() && a != "Various Artists" && seen_seed_artists.insert(a.to_lowercase()) {
                seed_artists.push(a.to_string());
            }
        }
        for tr in recently_played.iter().take(8) {
            if let Some(a) = tr.artists.first().map(|s| s.trim()) {
                if !a.is_empty() && seen_seed_artists.insert(a.to_lowercase()) {
                    seed_artists.push(a.to_string());
                }
            }
        }
        for artist_name in seed_artists.into_iter().take(3) {
            if let Ok(search_json) = apple_get_json(
                &format!(
                    "/v1/catalog/{storefront}/search?term={}&types=albums&limit=3",
                    urlencode(&artist_name)
                ),
                &dev_token,
                &user_token,
            ) {
                if let Some(arr) = search_json
                    .pointer("/results/albums/data")
                    .and_then(|v| v.as_array())
                {
                    for alb_val in arr {
                        if let Some(alb) = parse_apple_album_summary(alb_val, "catalog") {
                            if alb.release_year.unwrap_or(0) >= 2024
                                && seen_new_releases.insert(alb.id.clone())
                            {
                                new_releases.push(alb);
                            }
                        }
                    }
                }
            }
        }
    }

    if let Ok(json) = apple_get_json(
        &format!("/v1/catalog/{storefront}/stations?filter[featured]=apple-music-live-radio"),
        &dev_token,
        &user_token,
    ) {
        if let Some(arr) = json.get("data").and_then(|v| v.as_array()) {
            for st in arr {
                push_classified_station(st, "Live Global Radio");
            }
        }
    }

    // Fetch Richer Radio Shelves in parallel:
    // 1. Artist-Hosted Shows, Radio Hosts, Latest Episodes & Interviews
    // 2. Club Mixes & DJ Sets (Apple Music Club / One Mix / Boiler Room)
    // 3. Top Stations & Stations by Genre
    let mut artist_shows: Vec<AppleCloudPlaylistSummary> = Vec::new();
    let mut club_mixes: Vec<AppleCloudPlaylistSummary> = Vec::new();
    let mut genre_stations: Vec<AppleRadioStationSummary> = Vec::new();

    let (shows_res, mixes_res, genres_res) = std::thread::scope(|s| {
        let d1 = &dev_token;
        let u1 = &user_token;
        let sf1 = &storefront;
        let h_shows = s.spawn(move || {
            apple_get_json(
                &format!(
                    "/v1/catalog/{sf1}/search?term=Apple+Music+1+Radio+Show+Interview&types=playlists,stations&limit=18"
                ),
                d1,
                u1,
            )
        });

        let d2 = &dev_token;
        let u2 = &user_token;
        let sf2 = &storefront;
        let h_mixes = s.spawn(move || {
            apple_get_json(
                &format!(
                    "/v1/catalog/{sf2}/search?term=Apple+Music+Club+DJ+Mix+One+Mix&types=playlists,stations&limit=18"
                ),
                d2,
                u2,
            )
        });

        let d3 = &dev_token;
        let u3 = &user_token;
        let sf3 = &storefront;
        let h_genres = s.spawn(move || {
            let mut out: Vec<(String, Value)> = Vec::new();
            for genre_label in [
                "Electronic",
                "Hip-Hop",
                "Alternative",
                "Dance",
                "Pop",
                "R&B",
                "Rock",
                "Chill",
                "Jazz",
                "Classical",
                "Hits",
            ] {
                if let Ok(gj) = apple_get_json(
                    &format!(
                        "/v1/catalog/{sf3}/search?term={}+Station&types=stations&limit=4",
                        urlencode(genre_label)
                    ),
                    d3,
                    u3,
                ) {
                    out.push((genre_label.to_string(), gj));
                }
            }
            out
        });

        (
            h_shows.join().ok().and_then(|r| r.ok()),
            h_mixes.join().ok().and_then(|r| r.ok()),
            h_genres.join().ok().unwrap_or_default(),
        )
    });

    let mut seen_show_ids = HashSet::new();
    if let Some(sj) = shows_res {
        if let Some(arr) = sj
            .pointer("/results/playlists/data")
            .and_then(|v| v.as_array())
        {
            for pl in arr {
                let Some(id) = pl.get("id").and_then(|v| v.as_str()) else {
                    continue;
                };
                if !seen_show_ids.insert(id.to_string()) {
                    continue;
                }
                let attrs = pl.get("attributes").unwrap_or(pl);
                let name = attrs
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Radio Show")
                    .to_string();
                let curator = attrs
                    .get("curatorName")
                    .or_else(|| attrs.pointer("/editorialNotes/short"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("Apple Music Radio Show")
                    .to_string();
                let art_url = format_apple_art_url(
                    attrs.pointer("/artwork/url").and_then(|v| v.as_str()),
                    300,
                );
                artist_shows.push(AppleCloudPlaylistSummary {
                    id: id.to_string(),
                    name,
                    description: curator,
                    art_url,
                    kind: "catalog".to_string(),
                });
            }
        }
        if let Some(st_arr) = sj
            .pointer("/results/stations/data")
            .and_then(|v| v.as_array())
        {
            for st in st_arr {
                push_classified_station(st, "Radio Hosts & Shows");
            }
        }
    }

    let mut seen_mix_ids = HashSet::new();
    if let Some(mj) = mixes_res {
        if let Some(arr) = mj
            .pointer("/results/playlists/data")
            .and_then(|v| v.as_array())
        {
            for pl in arr {
                let Some(id) = pl.get("id").and_then(|v| v.as_str()) else {
                    continue;
                };
                if !seen_mix_ids.insert(id.to_string()) {
                    continue;
                }
                let attrs = pl.get("attributes").unwrap_or(pl);
                let name = attrs
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("DJ Mix")
                    .to_string();
                let curator = attrs
                    .get("curatorName")
                    .or_else(|| attrs.pointer("/editorialNotes/short"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("Club & DJ Mix")
                    .to_string();
                let art_url = format_apple_art_url(
                    attrs.pointer("/artwork/url").and_then(|v| v.as_str()),
                    300,
                );
                club_mixes.push(AppleCloudPlaylistSummary {
                    id: id.to_string(),
                    name,
                    description: curator,
                    art_url,
                    kind: "catalog".to_string(),
                });
            }
        }
    }

    let mut seen_genre_st_ids = HashSet::new();
    for (genre_label, gj) in genres_res {
        if let Some(st_arr) = gj
            .pointer("/results/stations/data")
            .and_then(|v| v.as_array())
        {
            for st in st_arr {
                if let Some(mut summary) =
                    build_station_summary(st, &format!("{genre_label} Radio"))
                {
                    if is_live_broadcast_station(st, &genre_label) {
                        if seen_live_stations.insert(summary.id.clone()) {
                            live_stations.push(summary);
                        }
                    } else if seen_genre_st_ids.insert(summary.id.clone()) {
                        summary.genre = Some(genre_label.clone());
                        genre_stations.push(summary);
                    }
                }
            }
        }
    }

    Ok(AppleRadioAndForYouResponse {
        stations,
        personal_stations,
        live_stations,
        genre_stations,
        artist_shows,
        club_mixes,
        playlists,
        albums,
        new_releases,
        shelves,
        recently_played,
    })
}


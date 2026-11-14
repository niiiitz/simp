use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use simp_protocol::{AlbumRecord, MountStatus, PlaylistRecord, TrackMetadata};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalArtistProfile {
    pub name: String,
    pub art_url: Option<String>,
    pub tracks: Vec<TrackMetadata>,
    pub albums: Vec<AlbumRecord>,
    pub related_artists: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TrackPropertiesRecord {
    pub uri: String,
    pub has_art: bool,
    pub has_lyrics: bool,
    pub has_synced_lyrics: bool,
    pub has_comments: bool,
    pub has_factoids: bool,
    pub suppress_lyrics: bool,
    pub suppress_comments: bool,
    pub suppress_factoids: bool,
    pub lyrics_offset_ms: i64,
    pub custom_art_url: Option<String>,
    pub preferred_viz_mode: Option<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TrackPropertiesPatch {
    pub has_art: Option<bool>,
    pub has_lyrics: Option<bool>,
    pub has_synced_lyrics: Option<bool>,
    pub has_comments: Option<bool>,
    pub has_factoids: Option<bool>,
    pub suppress_lyrics: Option<bool>,
    pub suppress_comments: Option<bool>,
    pub suppress_factoids: Option<bool>,
    pub lyrics_offset_ms: Option<i64>,
    pub custom_art_url: Option<String>,
    pub preferred_viz_mode: Option<String>,
}

#[derive(Clone)]
pub struct LibraryDatabase {
    conn: Arc<Mutex<Connection>>,
}

impl LibraryDatabase {
    pub fn open(db_path: &Path) -> Result<Self> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(db_path)?;
        let _ = conn.busy_timeout(std::time::Duration::from_millis(5000));
        conn.execute_batch(
            "
            PRAGMA busy_timeout = 5000;
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA foreign_keys = ON;
            PRAGMA temp_store = MEMORY;
            PRAGMA cache_size = -2000;

            CREATE TABLE IF NOT EXISTS storage_mounts (
                mount_root      TEXT PRIMARY KEY,
                label           TEXT NOT NULL,
                mount_kind      TEXT NOT NULL,
                is_online       INTEGER NOT NULL DEFAULT 1,
                last_scanned_at INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS albums (
                id              TEXT PRIMARY KEY,
                title           TEXT NOT NULL,
                album_artist    TEXT NOT NULL DEFAULT 'Unknown Artist',
                release_year    INTEGER,
                steam_app_id    INTEGER,
                art_cache_path  TEXT,
                created_at      INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_albums_title ON albums(title COLLATE NOCASE);
            CREATE INDEX IF NOT EXISTS idx_albums_steam_app ON albums(steam_app_id) WHERE steam_app_id IS NOT NULL;

            CREATE TABLE IF NOT EXISTS tracks (
                uri             TEXT PRIMARY KEY,
                source          TEXT NOT NULL,
                mount_root      TEXT REFERENCES storage_mounts(mount_root) ON DELETE SET NULL,
                album_id        TEXT REFERENCES albums(id) ON DELETE SET NULL,
                title           TEXT NOT NULL,
                artists_json    TEXT NOT NULL DEFAULT '[]',
                album_title     TEXT NOT NULL DEFAULT '',
                track_number    INTEGER,
                disc_number     INTEGER DEFAULT 1,
                duration_ms     INTEGER NOT NULL DEFAULT 0,
                art_url         TEXT,
                file_mtime      INTEGER,
                file_size       INTEGER
            );

            CREATE INDEX IF NOT EXISTS idx_tracks_mount ON tracks(mount_root);
            CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album_id, disc_number, track_number);
            CREATE INDEX IF NOT EXISTS idx_tracks_source ON tracks(source);
            CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title COLLATE NOCASE);

            CREATE TABLE IF NOT EXISTS playlists (
                id              TEXT PRIMARY KEY,
                name            TEXT NOT NULL,
                description     TEXT NOT NULL DEFAULT '',
                origin          TEXT NOT NULL,
                cover_art_url   TEXT,
                track_count     INTEGER NOT NULL DEFAULT 0,
                updated_at      INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS playlist_items (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                playlist_id     TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
                position        INTEGER NOT NULL,
                track_uri       TEXT NOT NULL REFERENCES tracks(uri) ON DELETE CASCADE,
                added_at        INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_playlist_items_order ON playlist_items(playlist_id, position);

            CREATE TABLE IF NOT EXISTS cd_cache (
                disc_id         TEXT PRIMARY KEY,
                album_title     TEXT NOT NULL,
                artist_name     TEXT NOT NULL,
                tracks_json     TEXT NOT NULL,
                art_cache_path  TEXT,
                fetched_at      INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS apple_catalog_map (
                raw_id          TEXT PRIMARY KEY,
                catalog_id      TEXT NOT NULL,
                art_url         TEXT,
                updated_at      INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS musicbrainz_album_art_cache (
                album_id        TEXT PRIMARY KEY,
                status          TEXT NOT NULL,
                art_url         TEXT,
                checked_at      INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS apple_playlist_art_cache (
                playlist_id     TEXT PRIMARY KEY,
                art_url         TEXT NOT NULL,
                updated_at      INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS play_history (
                uri             TEXT PRIMARY KEY,
                track_json      TEXT NOT NULL,
                source          TEXT NOT NULL,
                played_at       INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_play_history_played_at ON play_history(played_at DESC);
            CREATE INDEX IF NOT EXISTS idx_play_history_source ON play_history(source, played_at DESC);

            CREATE TABLE IF NOT EXISTS local_favorites (
                uri             TEXT PRIMARY KEY,
                track_json      TEXT NOT NULL,
                source          TEXT NOT NULL,
                added_at        INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS track_properties (
                uri                 TEXT PRIMARY KEY,
                has_art             INTEGER NOT NULL DEFAULT 0,
                has_lyrics          INTEGER NOT NULL DEFAULT 0,
                has_synced_lyrics   INTEGER NOT NULL DEFAULT 0,
                has_comments        INTEGER NOT NULL DEFAULT 0,
                has_factoids        INTEGER NOT NULL DEFAULT 0,
                suppress_lyrics     INTEGER NOT NULL DEFAULT 0,
                suppress_comments   INTEGER NOT NULL DEFAULT 0,
                suppress_factoids   INTEGER NOT NULL DEFAULT 0,
                lyrics_offset_ms    INTEGER NOT NULL DEFAULT 0,
                custom_art_url      TEXT,
                preferred_viz_mode  TEXT,
                updated_at          INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_track_props_synced_lyrics ON track_properties(has_synced_lyrics, suppress_lyrics);
            CREATE INDEX IF NOT EXISTS idx_track_props_art ON track_properties(has_art);

            INSERT INTO track_properties (uri, has_art, updated_at)
            SELECT uri,
                   CASE WHEN art_url IS NOT NULL AND art_url != '' THEN 1 ELSE 0 END,
                   strftime('%s', 'now')
            FROM tracks
            WHERE uri NOT IN (SELECT uri FROM track_properties);
            ",
        )?;

        // Self-heal temporary 24-hour iCloud Music Library `blobstore.apple.com` presigned artwork URLs
        // whenever another track from the same album already has a permanent `mzstatic.com` catalog URL!
        let _ = conn.execute_batch(
            "
            UPDATE tracks
            SET art_url = (
                SELECT m.art_url FROM apple_catalog_map m
                WHERE ('applemusic:song:' || m.raw_id = tracks.uri OR 'applemusic:track:' || m.raw_id = tracks.uri)
                  AND m.art_url LIKE '%mzstatic.com%'
                LIMIT 1
            )
            WHERE (art_url IS NULL OR art_url = '' OR art_url LIKE '%blobstore.apple.com%')
              AND EXISTS (
                SELECT 1 FROM apple_catalog_map m
                WHERE ('applemusic:song:' || m.raw_id = tracks.uri OR 'applemusic:track:' || m.raw_id = tracks.uri)
                  AND m.art_url LIKE '%mzstatic.com%'
              );

            UPDATE tracks
            SET art_url = (
                SELECT t2.art_url FROM tracks t2
                WHERE t2.album_title = tracks.album_title
                  AND t2.album_title != ''
                  AND t2.art_url LIKE '%mzstatic.com%'
                LIMIT 1
            )
            WHERE (art_url IS NULL OR art_url = '' OR art_url LIKE '%blobstore.apple.com%')
              AND EXISTS (
                SELECT 1 FROM tracks t2
                WHERE t2.album_title = tracks.album_title
                  AND t2.album_title != ''
                  AND t2.art_url LIKE '%mzstatic.com%'
              );

            UPDATE playlists
            SET cover_art_url = (
                SELECT t.art_url FROM playlist_items pi
                JOIN tracks t ON t.uri = pi.track_uri
                WHERE pi.playlist_id = playlists.id
                  AND t.art_url LIKE '%mzstatic.com%'
                ORDER BY pi.position ASC LIMIT 1
            )
            WHERE (cover_art_url IS NULL OR cover_art_url = '' OR cover_art_url LIKE '%blobstore.apple.com%')
              AND EXISTS (
                SELECT 1 FROM playlist_items pi
                JOIN tracks t ON t.uri = pi.track_uri
                WHERE pi.playlist_id = playlists.id
                  AND t.art_url LIKE '%mzstatic.com%'
              );
            ",
        );

        let user_version: i32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap_or(0);
        if user_version < 2 {
            let _ = conn.execute_batch(
                "DELETE FROM tracks;
                 DELETE FROM albums;
                 PRAGMA user_version = 2;",
            );
        }
        if user_version < 4 {
            // Switch to Opt-In ("Pin to SIMP") Apple Music model:
            // Clear previously auto-dumped `apple_remote` playlists and unpinned partial Apple Music albums,
            // while preserving any `apple_music` tracks that the user added to their own `simp_local` hybrid playlists!
            let _ = conn.execute_batch(
                "DELETE FROM playlists WHERE origin = 'apple_remote';
                 UPDATE tracks SET album_id = NULL WHERE source = 'apple_music';
                 DELETE FROM tracks
                 WHERE source = 'apple_music'
                   AND uri NOT IN (SELECT DISTINCT track_uri FROM playlist_items);
                 DELETE FROM albums
                 WHERE id NOT IN (SELECT DISTINCT album_id FROM tracks WHERE album_id IS NOT NULL);
                 PRAGMA user_version = 4;",
            );
        }
        if user_version < 5 {
            // Purge any stale/delisted catalog IDs cached from `/v1/me/library/songs/i.xxxx/catalog`
            // so `search_storefront_catalog_song_id` populates 100% active storefront IDs.
            let _ = conn.execute_batch(
                "DELETE FROM apple_catalog_map;
                 PRAGMA user_version = 5;",
            );
        }

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    pub fn upsert_mount(&self, mount_root: &str, label: &str, mount_kind: &str, is_online: bool) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO storage_mounts (mount_root, label, mount_kind, is_online, last_scanned_at)
             VALUES (?1, ?2, ?3, ?4, strftime('%s', 'now'))
             ON CONFLICT(mount_root) DO UPDATE SET
               label = excluded.label,
               is_online = excluded.is_online,
               last_scanned_at = strftime('%s', 'now')",
            params![mount_root, label, mount_kind, if is_online { 1 } else { 0 }],
        )?;
        Ok(())
    }

    pub fn set_mount_online(&self, mount_root: &str, is_online: bool) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE storage_mounts SET is_online = ?1 WHERE mount_root = ?2",
            params![if is_online { 1 } else { 0 }, mount_root],
        )?;
        Ok(())
    }

    /// Removes a storage mount and its associated tracks, cleaning up any orphaned albums.
    pub fn remove_mount(&self, mount_root: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM tracks WHERE mount_root = ?1",
            params![mount_root],
        )?;
        conn.execute(
            "DELETE FROM storage_mounts WHERE mount_root = ?1",
            params![mount_root],
        )?;
        conn.execute(
            "DELETE FROM albums WHERE id NOT IN (SELECT DISTINCT album_id FROM tracks WHERE album_id IS NOT NULL)",
            [],
        )?;
        Ok(())
    }

    pub fn get_mounts(&self) -> Result<Vec<MountStatus>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT m.mount_root, m.label, m.mount_kind, m.is_online, m.last_scanned_at,
                    COUNT(t.uri) as track_count
             FROM storage_mounts m
             LEFT JOIN tracks t ON t.mount_root = m.mount_root
             GROUP BY m.mount_root
             ORDER BY m.is_online DESC, m.label ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(MountStatus {
                mount_root: row.get(0)?,
                label: row.get(1)?,
                mount_kind: row.get(2)?,
                is_online: row.get::<_, i64>(3)? != 0,
                last_scanned_at: row.get(4)?,
                track_count: row.get::<_, i64>(5)? as usize,
            })
        })?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    /// Returns a map of `uri -> (mtime, size, art_url)` for fast incremental indexing of a mount root.
    /// Tracks with `art_url IS NULL` are excluded so newly added folder artwork (`cover.jpg`) is picked up on rescan.
    pub fn get_mount_file_fingerprints(
        &self,
        mount_root: &str,
    ) -> Result<HashMap<String, (i64, i64, Option<String>)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT uri, COALESCE(file_mtime, 0), COALESCE(file_size, 0), art_url
             FROM tracks WHERE mount_root = ?1 AND art_url IS NOT NULL",
        )?;
        let mut map = HashMap::new();
        let rows = stmt.query_map(params![mount_root], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })?;
        for row in rows.flatten() {
            map.insert(row.0, (row.1, row.2, row.3));
        }
        Ok(map)
    }

    pub fn upsert_album(
        &self,
        id: &str,
        title: &str,
        album_artist: &str,
        release_year: Option<i32>,
        steam_app_id: Option<u32>,
        art_cache_path: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO albums (id, title, album_artist, release_year, steam_app_id, art_cache_path, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, strftime('%s', 'now'))
             ON CONFLICT(id) DO UPDATE SET
               art_cache_path = CASE
                 WHEN excluded.art_cache_path IS NOT NULL THEN excluded.art_cache_path
                 WHEN albums.art_cache_path LIKE '%/mb_%' OR albums.art_cache_path LIKE '%mzstatic.com%' THEN albums.art_cache_path
                 ELSE NULL
               END,
               steam_app_id = COALESCE(excluded.steam_app_id, albums.steam_app_id)",
            params![id, title, album_artist, release_year, steam_app_id, art_cache_path],
        )?;
        Ok(())
    }

    pub fn upsert_track(
        &self,
        meta: &TrackMetadata,
        file_mtime: Option<i64>,
        file_size: Option<i64>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let artists_json = serde_json::to_string(&meta.artists).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "INSERT INTO tracks (
                uri, source, mount_root, album_id, title, artists_json,
                album_title, track_number, disc_number, duration_ms, art_url, file_mtime, file_size
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
             ON CONFLICT(uri) DO UPDATE SET
                album_id = COALESCE(excluded.album_id, tracks.album_id),
                title = excluded.title,
                artists_json = excluded.artists_json,
                album_title = excluded.album_title,
                track_number = excluded.track_number,
                disc_number = excluded.disc_number,
                duration_ms = excluded.duration_ms,
                art_url = CASE
                  WHEN excluded.art_url IS NOT NULL THEN excluded.art_url
                  WHEN tracks.art_url LIKE '%/mb_%' OR tracks.art_url LIKE '%mzstatic.com%' THEN tracks.art_url
                  ELSE NULL
                END,
                file_mtime = excluded.file_mtime,
                file_size = excluded.file_size",
            params![
                meta.uri,
                meta.source,
                meta.mount_root,
                meta.album_id,
                meta.title,
                artists_json,
                meta.album,
                meta.track_number,
                meta.disc_number.unwrap_or(1),
                meta.duration_ms,
                meta.art_url,
                file_mtime,
                file_size
            ],
        )?;
        Ok(())
    }

    pub fn get_track_by_uri(&self, uri: &str) -> Result<Option<TrackMetadata>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT uri, title, artists_json, album_title, album_id, track_number,
                    disc_number, art_url, duration_ms, source, mount_root
             FROM tracks WHERE uri = ?1",
        )?;
        let res = stmt
            .query_row(params![uri], |row| {
                let artists_str: String = row.get(2)?;
                let artists: Vec<String> = serde_json::from_str(&artists_str).unwrap_or_default();
                Ok(TrackMetadata {
                    uri: row.get(0)?,
                    title: row.get(1)?,
                    artists,
                    album: row.get(3)?,
                    album_id: row.get(4)?,
                    track_number: row.get(5)?,
                    disc_number: row.get(6)?,
                    art_url: row.get(7)?,
                    duration_ms: row.get(8)?,
                    source: row.get(9)?,
                    mount_root: row.get(10)?,
                })
            })
            .optional()?;
        Ok(res)
    }

    pub fn get_albums(
        &self,
        source: Option<&str>,
        search: Option<&str>,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<AlbumRecord>> {
        self.get_albums_filtered(source, None, search, limit, offset)
    }

    pub fn get_albums_filtered(
        &self,
        source: Option<&str>,
        mount_root: Option<&str>,
        search: Option<&str>,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<AlbumRecord>> {
        let conn = self.conn.lock().unwrap();
        let search_pattern = search.map(|s| format!("%{}%", s)).unwrap_or_else(|| "%".to_string());
        let mut stmt = conn.prepare(
            "SELECT a.id, a.title, a.album_artist, a.release_year, a.steam_app_id, a.art_cache_path,
                    COUNT(t.uri) as track_count,
                    GROUP_CONCAT(t.uri, '|') as uri_list
             FROM albums a
             JOIN tracks t ON t.album_id = a.id
             LEFT JOIN storage_mounts m ON t.mount_root = m.mount_root
             WHERE (t.mount_root IS NULL OR m.is_online = 1)
               AND (?1 IS NULL
                    OR (?1 = 'local' AND t.source != 'apple_music' AND t.source != 'soundcloud' AND t.source != 'internet_archive' AND t.source != 'ia_video')
                    OR (?1 = 'internet_archive' AND (t.source = 'internet_archive' OR t.source = 'ia_video'))
                    OR t.source = ?1)
               AND (?2 IS NULL OR t.mount_root = ?2)
               AND (a.title LIKE ?3 OR a.album_artist LIKE ?3)
             GROUP BY a.id
             ORDER BY a.title COLLATE NOCASE ASC
             LIMIT ?4 OFFSET ?5",
        )?;
        let rows = stmt.query_map(
            params![source, mount_root, search_pattern, limit as i64, offset as i64],
            |row| {
                let mut album_artist: String = row.get(2)?;
                let uri_list: Option<String> = row.get(7).ok();
                if let Some(uris) = uri_list {
                    let mut exts: Vec<&'static str> = Vec::new();
                    for u in uris.split('|') {
                        if u.starts_with("file://") || u.starts_with('/') {
                            if let Some((_, ext_raw)) = u.rsplit_once('.') {
                                let known = match ext_raw.to_ascii_uppercase().as_str() {
                                    "FLAC" => Some("FLAC"),
                                    "MP3" => Some("MP3"),
                                    "WAV" => Some("WAV"),
                                    "OGG" => Some("OGG"),
                                    "OPUS" => Some("OPUS"),
                                    "M4A" => Some("M4A"),
                                    "AAC" => Some("AAC"),
                                    "ALAC" => Some("ALAC"),
                                    "AIFF" => Some("AIFF"),
                                    _ => None,
                                };
                                if let Some(k) = known {
                                    if !exts.contains(&k) {
                                        exts.push(k);
                                    }
                                }
                            }
                        }
                    }
                    if !exts.is_empty() {
                        let fmt_badge = exts.join(" + ");
                        if !album_artist.contains(&fmt_badge) {
                            album_artist = format!("{album_artist} • {fmt_badge}");
                        }
                    }
                }
                Ok(AlbumRecord {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    album_artist,
                    release_year: row.get(3)?,
                    steam_app_id: row.get(4)?,
                    art_url: row.get(5)?,
                    track_count: row.get::<_, i64>(6)? as usize,
                })
            },
        )?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn get_album_tracks(&self, album_id: &str) -> Result<Vec<TrackMetadata>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT uri, title, artists_json, album_title, album_id, track_number,
                    disc_number, art_url, duration_ms, source, mount_root
             FROM tracks
             WHERE album_id = ?1
             ORDER BY COALESCE(disc_number, 1) ASC, COALESCE(track_number, 999) ASC, title ASC",
        )?;
        let rows = stmt.query_map(params![album_id], |row| {
            let artists_str: String = row.get(2)?;
            let artists: Vec<String> = serde_json::from_str(&artists_str).unwrap_or_default();
            Ok(TrackMetadata {
                uri: row.get(0)?,
                title: row.get(1)?,
                artists,
                album: row.get(3)?,
                album_id: row.get(4)?,
                track_number: row.get(5)?,
                disc_number: row.get(6)?,
                art_url: row.get(7)?,
                duration_ms: row.get(8)?,
                source: row.get(9)?,
                mount_root: row.get(10)?,
            })
        })?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn get_tracks(
        &self,
        source: Option<&str>,
        search: Option<&str>,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<TrackMetadata>> {
        self.get_tracks_filtered(source, None, search, limit, offset)
    }

    pub fn get_tracks_filtered(
        &self,
        source: Option<&str>,
        mount_root: Option<&str>,
        search: Option<&str>,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<TrackMetadata>> {
        let conn = self.conn.lock().unwrap();
        let search_pattern = search.map(|s| format!("%{}%", s)).unwrap_or_else(|| "%".to_string());
        let mut stmt = conn.prepare(
            "SELECT t.uri, t.title, t.artists_json, t.album_title, t.album_id, t.track_number,
                    t.disc_number, t.art_url, t.duration_ms, t.source, t.mount_root
             FROM tracks t
             LEFT JOIN storage_mounts m ON t.mount_root = m.mount_root
             WHERE (t.mount_root IS NULL OR m.is_online = 1)
               AND (?1 IS NULL
                    OR (?1 = 'local' AND t.source != 'apple_music' AND t.source != 'soundcloud' AND t.source != 'internet_archive' AND t.source != 'ia_video')
                    OR (?1 = 'internet_archive' AND (t.source = 'internet_archive' OR t.source = 'ia_video'))
                    OR t.source = ?1)
               AND (?2 IS NULL OR t.mount_root = ?2)
               AND (t.title LIKE ?3 OR t.album_title LIKE ?3 OR t.artists_json LIKE ?3)
             ORDER BY t.album_title COLLATE NOCASE ASC, COALESCE(t.disc_number, 1) ASC, COALESCE(t.track_number, 999) ASC
             LIMIT ?4 OFFSET ?5",
        )?;
        let rows = stmt.query_map(
            params![source, mount_root, search_pattern, limit as i64, offset as i64],
            |row| {
                let artists_str: String = row.get(2)?;
                let artists: Vec<String> = serde_json::from_str(&artists_str).unwrap_or_default();
                Ok(TrackMetadata {
                    uri: row.get(0)?,
                    title: row.get(1)?,
                    artists,
                    album: row.get(3)?,
                    album_id: row.get(4)?,
                    track_number: row.get(5)?,
                    disc_number: row.get(6)?,
                    art_url: row.get(7)?,
                    duration_ms: row.get(8)?,
                    source: row.get(9)?,
                    mount_root: row.get(10)?,
                })
            },
        )?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn get_playlists(&self) -> Result<Vec<PlaylistRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT p.id, p.name, p.description, p.origin, p.cover_art_url, p.track_count, p.updated_at,
                    EXISTS(SELECT 1 FROM playlist_items pi WHERE pi.playlist_id = p.id AND pi.track_uri NOT LIKE 'applemusic:%' AND pi.track_uri NOT LIKE 'soundcloud:%' AND pi.track_uri NOT LIKE 'ia:%' AND pi.track_uri NOT LIKE 'ia://%') AS has_local,
                    EXISTS(SELECT 1 FROM playlist_items pi WHERE pi.playlist_id = p.id AND pi.track_uri LIKE 'applemusic:%') AS has_apple,
                    EXISTS(SELECT 1 FROM playlist_items pi WHERE pi.playlist_id = p.id AND pi.track_uri LIKE 'soundcloud:%') AS has_soundcloud,
                    EXISTS(SELECT 1 FROM playlist_items pi WHERE pi.playlist_id = p.id AND (pi.track_uri LIKE 'ia:%' OR pi.track_uri LIKE 'ia://%')) AS has_archive
             FROM playlists p
             ORDER BY CASE WHEN p.origin = 'simp_local' THEN 0 ELSE 1 END ASC,
                      p.name COLLATE NOCASE ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            let origin: String = row.get(3)?;
            let has_local: bool = row.get(7).unwrap_or(false);
            let has_apple: bool = row.get(8).unwrap_or(false) || origin == "apple_remote";
            let has_soundcloud: bool =
                row.get(9).unwrap_or(false) || origin == "soundcloud_remote";
            let has_archive: bool =
                row.get(10).unwrap_or(false) || origin == "archive_remote";
            Ok(PlaylistRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                origin,
                cover_art_url: row.get(4)?,
                track_count: row.get::<_, i64>(5)? as usize,
                updated_at: row.get(6)?,
                has_local,
                has_apple,
                has_soundcloud,
                has_archive,
            })
        })?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn get_playlist_items(
        &self,
        playlist_id: &str,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<TrackMetadata>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT t.uri, t.title, t.artists_json, t.album_title, t.album_id, t.track_number,
                    t.disc_number, t.art_url, t.duration_ms, t.source, t.mount_root
             FROM playlist_items pi
             JOIN tracks t ON t.uri = pi.track_uri
             WHERE pi.playlist_id = ?1
             ORDER BY pi.position ASC
             LIMIT ?2 OFFSET ?3",
        )?;
        let rows = stmt.query_map(params![playlist_id, limit as i64, offset as i64], |row| {
            let artists_str: String = row.get(2)?;
            let artists: Vec<String> = serde_json::from_str(&artists_str).unwrap_or_default();
            Ok(TrackMetadata {
                uri: row.get(0)?,
                title: row.get(1)?,
                artists,
                album: row.get(3)?,
                album_id: row.get(4)?,
                track_number: row.get(5)?,
                disc_number: row.get(6)?,
                art_url: row.get(7)?,
                duration_ms: row.get(8)?,
                source: row.get(9)?,
                mount_root: row.get(10)?,
            })
        })?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn create_playlist(&self, name: &str, description: &str) -> Result<PlaylistRecord> {
        let id_input = format!(
            "playlist::{}::{}",
            name.trim().to_lowercase(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        );
        let id = blake3::hash(id_input.as_bytes()).to_hex()[..16].to_string();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO playlists (id, name, description, origin, track_count, updated_at)
             VALUES (?1, ?2, ?3, 'simp_local', 0, strftime('%s', 'now'))",
            params![id, name.trim(), description.trim()],
        )?;
        let updated_at: i64 = conn
            .query_row(
                "SELECT updated_at FROM playlists WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        Ok(PlaylistRecord {
            id,
            name: name.trim().to_string(),
            description: description.trim().to_string(),
            origin: "simp_local".to_string(),
            cover_art_url: None,
            track_count: 0,
            updated_at,
            has_local: false,
            has_apple: false,
            has_soundcloud: false,
            has_archive: false,
        })
    }

    pub fn add_tracks_to_playlist(&self, playlist_id: &str, uris: &[String]) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let mut next_pos: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(position), -1) + 1 FROM playlist_items WHERE playlist_id = ?1",
                params![playlist_id],
                |r| r.get(0),
            )
            .unwrap_or(0);

        for uri in uris {
            let inserted = conn.execute(
                "INSERT INTO playlist_items (playlist_id, position, track_uri, added_at)
                 VALUES (?1, ?2, ?3, strftime('%s', 'now'))",
                params![playlist_id, next_pos, uri],
            );
            if inserted.is_ok() {
                next_pos += 1;
            }
        }

        let new_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM playlist_items WHERE playlist_id = ?1",
                params![playlist_id],
                |r| r.get(0),
            )
            .unwrap_or(0);

        let cover_art: Option<String> = conn
            .query_row(
                "SELECT t.art_url FROM playlist_items pi
                 JOIN tracks t ON t.uri = pi.track_uri
                 WHERE pi.playlist_id = ?1 AND t.art_url IS NOT NULL
                 ORDER BY pi.position ASC LIMIT 1",
                params![playlist_id],
                |r| r.get(0),
            )
            .optional()?
            .flatten();

        conn.execute(
            "UPDATE playlists
             SET track_count = ?2,
                 cover_art_url = COALESCE(?3, cover_art_url),
                 updated_at = strftime('%s', 'now')
             WHERE id = ?1",
            params![playlist_id, new_count, cover_art],
        )?;

        Ok(new_count as usize)
    }

    pub fn remove_track_from_playlist(&self, playlist_id: &str, track_uri: &str) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM playlist_items WHERE playlist_id = ?1 AND track_uri = ?2",
            params![playlist_id, track_uri],
        )?;
        let new_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM playlist_items WHERE playlist_id = ?1",
                params![playlist_id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        conn.execute(
            "UPDATE playlists SET track_count = ?2, updated_at = strftime('%s', 'now') WHERE id = ?1",
            params![playlist_id, new_count],
        )?;
        Ok(new_count as usize)
    }

    pub fn delete_playlist(&self, playlist_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM playlist_items WHERE playlist_id = ?1",
            params![playlist_id],
        )?;
        conn.execute("DELETE FROM playlists WHERE id = ?1", params![playlist_id])?;
        Ok(())
    }

    pub fn delete_album(&self, album_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE tracks SET album_id = NULL WHERE album_id = ?1",
            params![album_id],
        )?;
        conn.execute("DELETE FROM albums WHERE id = ?1", params![album_id])?;
        conn.execute(
            "DELETE FROM tracks
             WHERE source = 'apple_music'
               AND album_id IS NULL
               AND uri NOT IN (SELECT DISTINCT track_uri FROM playlist_items)",
            [],
        )?;
        Ok(())
    }

    pub fn get_library_counts(&self) -> Result<(usize, usize)> {
        let conn = self.conn.lock().unwrap();
        let albums: i64 = conn.query_row("SELECT COUNT(*) FROM albums", [], |r| r.get(0))?;
        let tracks: i64 = conn.query_row("SELECT COUNT(*) FROM tracks", [], |r| r.get(0))?;
        Ok((albums as usize, tracks as usize))
    }

    /// Imports a batch of streaming tracks (and optional album / playlist container) from
    /// Apple Music (`source = "apple_music"`) into SQLite.
    pub fn import_catalog_bundle(
        &self,
        source: &str,
        album: Option<&AlbumRecord>,
        playlist: Option<&PlaylistRecord>,
        tracks: &[TrackMetadata],
    ) -> Result<()> {
        if let Some(alb) = album {
            self.upsert_album(
                &alb.id,
                &alb.title,
                &alb.album_artist,
                alb.release_year,
                alb.steam_app_id,
                alb.art_url.as_deref(),
            )?;
        }

        let mut normalized_uris = Vec::with_capacity(tracks.len());
        for raw_track in tracks {
            let mut t = raw_track.clone();
            if t.source.is_empty() {
                t.source = source.to_string();
            }
            let artist_primary = t
                .artists
                .first()
                .cloned()
                .unwrap_or_else(|| "Unknown Artist".to_string());
            let album_title = if t.album.trim().is_empty() {
                "Apple Music Library".to_string()
            } else {
                t.album.clone()
            };

            if let Some(alb) = album {
                t.album_id = Some(alb.id.clone());
                self.upsert_album(
                    &alb.id,
                    &alb.title,
                    &alb.album_artist,
                    alb.release_year,
                    alb.steam_app_id,
                    alb.art_url.as_deref().or(t.art_url.as_deref()),
                )?;
            } else if playlist.is_none()
                && t.source != "apple_music"
                && t.source != "soundcloud"
                && t.source != "internet_archive"
                && t.source != "ia_video"
                && t.source != "local_video"
                && t.source != "dvd"
            {
                let alb_id = t.album_id.clone().unwrap_or_else(|| {
                    let hash_key = format!(
                        "album::{}::{}::{}",
                        t.source,
                        album_title.trim().to_lowercase(),
                        artist_primary.trim().to_lowercase()
                    );
                    blake3::hash(hash_key.as_bytes()).to_hex()[..16].to_string()
                });
                t.album_id = Some(alb_id.clone());
                self.upsert_album(
                    &alb_id,
                    &album_title,
                    &artist_primary,
                    None,
                    None,
                    t.art_url.as_deref(),
                )?;
            } else if t.source == "local" || t.source == "steam_ost" || t.source == "removable" {
                // Local indexed tracks keep their existing album_id intact when pinned into a collection
                if let Some(ref alb_id) = t.album_id {
                    self.upsert_album(
                        alb_id,
                        &album_title,
                        &artist_primary,
                        None,
                        None,
                        t.art_url.as_deref(),
                    )?;
                }
            } else {
                // Individual Apple Music tracks or playlist tracks do not auto-create albums
                // unless an explicit `AlbumRecord` is being pinned.
                t.album_id = None;
            }
            self.upsert_track(&t, None, None)?;
            normalized_uris.push(t.uri.clone());
        }

        if let Some(pl) = playlist {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO playlists (id, name, description, origin, cover_art_url, track_count, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, strftime('%s', 'now'))
                 ON CONFLICT(id) DO UPDATE SET
                   name = excluded.name,
                   description = excluded.description,
                   cover_art_url = COALESCE(excluded.cover_art_url, playlists.cover_art_url),
                   track_count = excluded.track_count,
                   updated_at = strftime('%s', 'now')",
                params![
                    pl.id,
                    pl.name,
                    pl.description,
                    pl.origin,
                    pl.cover_art_url,
                    normalized_uris.len() as i64
                ],
            )?;
            conn.execute(
                "DELETE FROM playlist_items WHERE playlist_id = ?1",
                params![pl.id],
            )?;
            for (pos, uri) in normalized_uris.iter().enumerate() {
                let _ = conn.execute(
                    "INSERT INTO playlist_items (playlist_id, position, track_uri, added_at)
                     VALUES (?1, ?2, ?3, strftime('%s', 'now'))",
                    params![pl.id, pos as i64, uri],
                );
            }
        }

        Ok(())
    }

    pub fn remove_streaming_source(&self, source: &str, playlist_origin: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM playlists WHERE origin = ?1",
            params![playlist_origin],
        )?;
        conn.execute("DELETE FROM tracks WHERE source = ?1", params![source])?;
        if source == "internet_archive" {
            conn.execute("DELETE FROM tracks WHERE source = 'ia_video'", [])?;
        }
        conn.execute(
            "DELETE FROM albums WHERE id NOT IN (SELECT DISTINCT album_id FROM tracks WHERE album_id IS NOT NULL)",
            [],
        )?;
        Ok(())
    }

    pub fn clear_all_library_cache(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM playlist_items", [])?;
        conn.execute("DELETE FROM playlists", [])?;
        conn.execute("DELETE FROM tracks", [])?;
        conn.execute("DELETE FROM albums", [])?;
        conn.execute("DELETE FROM storage_mounts", [])?;
        conn.execute("DELETE FROM cd_cache", [])?;
        conn.execute("DELETE FROM apple_catalog_map", [])?;
        Ok(())
    }

    pub fn get_all_apple_catalog_mappings(
        &self,
    ) -> Result<HashMap<String, (String, Option<String>)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT raw_id, catalog_id, art_url FROM apple_catalog_map")?;
        let rows = stmt.query_map([], |row| {
            let raw_id: String = row.get(0)?;
            let catalog_id: String = row.get(1)?;
            let art_url: Option<String> = row.get(2)?;
            Ok((raw_id, (catalog_id, art_url)))
        })?;
        let mut map = HashMap::new();
        for r in rows.flatten() {
            map.insert(r.0, r.1);
        }
        Ok(map)
    }

    pub fn upsert_apple_catalog_mapping(
        &self,
        raw_id: &str,
        catalog_id: &str,
        art_url: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO apple_catalog_map (raw_id, catalog_id, art_url, updated_at)
             VALUES (?1, ?2, ?3, strftime('%s', 'now'))
             ON CONFLICT(raw_id) DO UPDATE SET
               catalog_id = excluded.catalog_id,
               art_url = COALESCE(excluded.art_url, apple_catalog_map.art_url),
               updated_at = strftime('%s', 'now')",
            params![raw_id, catalog_id, art_url],
        )?;

        if let Some(perm_art) = art_url.filter(|u| u.contains("mzstatic.com")) {
            let song_uri = format!("applemusic:song:{raw_id}");
            let track_uri = format!("applemusic:track:{raw_id}");
            let _ = conn.execute(
                "UPDATE tracks
                 SET art_url = ?1
                 WHERE (uri = ?2 OR uri = ?3)
                   AND (art_url IS NULL OR art_url = '' OR art_url LIKE '%blobstore.apple.com%')",
                params![perm_art, song_uri, track_uri],
            );
        }
        Ok(())
    }

    pub fn get_cd_cache(
        &self,
        disc_id: &str,
    ) -> Result<Option<(String, String, Vec<TrackMetadata>, Option<String>)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT album_title, artist_name, tracks_json, art_cache_path
             FROM cd_cache
             WHERE disc_id = ?1",
        )?;
        let res = stmt
            .query_row(params![disc_id], |row| {
                let album_title: String = row.get(0)?;
                let artist_name: String = row.get(1)?;
                let tracks_str: String = row.get(2)?;
                let art_path: Option<String> = row.get(3)?;
                let tracks: Vec<TrackMetadata> =
                    serde_json::from_str(&tracks_str).unwrap_or_default();
                Ok((album_title, artist_name, tracks, art_path))
            })
            .optional()?;
        Ok(res)
    }

    pub fn upsert_cd_cache(
        &self,
        disc_id: &str,
        album_title: &str,
        artist_name: &str,
        tracks: &[TrackMetadata],
        art_url: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let tracks_json = serde_json::to_string(tracks).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "INSERT INTO cd_cache (disc_id, album_title, artist_name, tracks_json, art_cache_path, fetched_at)
             VALUES (?1, ?2, ?3, ?4, ?5, strftime('%s', 'now'))
             ON CONFLICT(disc_id) DO UPDATE SET
               album_title = excluded.album_title,
               artist_name = excluded.artist_name,
               tracks_json = excluded.tracks_json,
               art_cache_path = COALESCE(excluded.art_cache_path, cd_cache.art_cache_path),
               fetched_at = strftime('%s', 'now')",
            params![disc_id, album_title, artist_name, tracks_json, art_url],
        )?;
        Ok(())
    }

    /// Returns `(album_id, title, album_artist)` for local albums that currently have no cover artwork (`art_cache_path IS NULL`).
    pub fn get_local_albums_missing_artwork(&self) -> Result<Vec<(String, String, String)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT DISTINCT a.id, a.title, a.album_artist
             FROM albums a
             JOIN tracks t ON t.album_id = a.id
             WHERE (a.art_cache_path IS NULL OR a.art_cache_path = '')
               AND a.id NOT LIKE 'applemusic:%'
               AND a.id NOT LIKE 'soundcloud:%'
               AND a.id NOT LIKE 'ia:%'
               AND t.source NOT IN ('apple_music', 'soundcloud', 'internet_archive', 'local_video')
             ORDER BY a.title COLLATE NOCASE ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn get_musicbrainz_art_cache(
        &self,
        album_id: &str,
    ) -> Option<(String, Option<String>, i64)> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT status, art_url, checked_at FROM musicbrainz_album_art_cache WHERE album_id = ?1",
            params![album_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .ok()
        .flatten()
    }

    pub fn set_musicbrainz_art_cache(
        &self,
        album_id: &str,
        status: &str,
        art_url: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO musicbrainz_album_art_cache (album_id, status, art_url, checked_at)
             VALUES (?1, ?2, ?3, strftime('%s', 'now'))
             ON CONFLICT(album_id) DO UPDATE SET
               status = excluded.status,
               art_url = excluded.art_url,
               checked_at = strftime('%s', 'now')",
            params![album_id, status, art_url],
        )?;
        Ok(())
    }

    pub fn set_album_and_tracks_artwork(&self, album_id: &str, art_url: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE albums SET art_cache_path = ?1 WHERE id = ?2",
            params![art_url, album_id],
        )?;
        conn.execute(
            "UPDATE tracks SET art_url = ?1 WHERE album_id = ?2 AND (art_url IS NULL OR art_url = '' OR art_url LIKE '%/simp_art_%')",
            params![art_url, album_id],
        )?;
        Ok(())
    }

    pub fn clear_musicbrainz_negative_cache(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM musicbrainz_album_art_cache WHERE status = 'not_found'",
            [],
        )?;
        Ok(())
    }

    pub fn get_all_cached_apple_playlist_art(&self) -> HashMap<String, String> {
        let conn = self.conn.lock().unwrap();
        let mut map = HashMap::new();
        if let Ok(mut stmt) =
            conn.prepare("SELECT playlist_id, art_url FROM apple_playlist_art_cache")
        {
            if let Ok(rows) =
                stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            {
                for row in rows.flatten() {
                    map.insert(row.0, row.1);
                }
            }
        }
        map
    }

    pub fn get_cached_apple_playlist_art(&self, playlist_id: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        let clean = playlist_id
            .strip_prefix("applemusic:playlist:")
            .unwrap_or(playlist_id);
        conn.query_row(
            "SELECT art_url FROM apple_playlist_art_cache WHERE playlist_id = ?1",
            params![clean],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .ok()
        .flatten()
    }

    pub fn set_cached_apple_playlist_art(&self, playlist_id: &str, art_url: &str) -> Result<()> {
        if art_url.trim().is_empty() {
            return Ok(());
        }
        let clean = playlist_id
            .strip_prefix("applemusic:playlist:")
            .unwrap_or(playlist_id);
        let pinned_id = format!("applemusic:playlist:{clean}");
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO apple_playlist_art_cache (playlist_id, art_url, updated_at)
             VALUES (?1, ?2, strftime('%s', 'now'))
             ON CONFLICT(playlist_id) DO UPDATE SET
               art_url = excluded.art_url,
               updated_at = strftime('%s', 'now')",
            params![clean, art_url],
        )?;
        let _ = conn.execute(
            "UPDATE playlists
             SET cover_art_url = ?1
             WHERE id = ?2
               AND (cover_art_url IS NULL OR cover_art_url = '' OR cover_art_url LIKE '%blobstore.apple.com%')",
            params![art_url, pinned_id],
        );
        Ok(())
    }

    pub fn record_play_history(&self, track: &TrackMetadata) -> Result<()> {
        if track.uri.trim().is_empty() {
            return Ok(());
        }
        let Ok(track_json) = serde_json::to_string(track) else {
            return Ok(());
        };
        let conn = self.conn.lock().unwrap();
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        conn.execute(
            "INSERT INTO play_history (uri, track_json, source, played_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(uri) DO UPDATE SET
               track_json = excluded.track_json,
               source = excluded.source,
               played_at = excluded.played_at",
            params![track.uri, track_json, track.source, now_ms],
        )?;
        // Cap table at 200 most recent entries
        let _ = conn.execute(
            "DELETE FROM play_history
             WHERE uri NOT IN (
                 SELECT uri FROM play_history ORDER BY played_at DESC LIMIT 200
             )",
            [],
        );
        Ok(())
    }

    pub fn get_play_history(
        &self,
        source: Option<&str>,
        limit: usize,
    ) -> Result<Vec<TrackMetadata>> {
        let conn = self.conn.lock().unwrap();
        let max_rows = limit.clamp(1, 200) as i64;
        let mut out = Vec::new();
        if let Some(src) = source.map(|s| s.trim()).filter(|s| !s.is_empty() && *s != "all") {
            let mut stmt = conn.prepare(
                "SELECT track_json FROM play_history
                 WHERE source = ?1
                 ORDER BY played_at DESC
                 LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![src, max_rows], |r| r.get::<_, String>(0))?;
            for json_str in rows.flatten() {
                if let Ok(t) = serde_json::from_str::<TrackMetadata>(&json_str) {
                    out.push(t);
                }
            }
        } else {
            let mut stmt = conn.prepare(
                "SELECT track_json FROM play_history
                 ORDER BY played_at DESC
                 LIMIT ?1",
            )?;
            let rows = stmt.query_map(params![max_rows], |r| r.get::<_, String>(0))?;
            for json_str in rows.flatten() {
                if let Ok(t) = serde_json::from_str::<TrackMetadata>(&json_str) {
                    out.push(t);
                }
            }
        }
        Ok(out)
    }

    pub fn set_track_favorited(&self, track: &TrackMetadata, favorited: bool) -> Result<bool> {
        let uri = track.uri.trim();
        if uri.is_empty() {
            return Ok(false);
        }
        let conn = self.conn.lock().unwrap();
        if favorited {
            let track_json = serde_json::to_string(track).unwrap_or_else(|_| "{}".to_string());
            let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            conn.execute(
                "INSERT INTO local_favorites (uri, track_json, source, added_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(uri) DO UPDATE SET
                   track_json = excluded.track_json,
                   source = excluded.source,
                   added_at = excluded.added_at",
                params![uri, track_json, track.source, now_ms],
            )?;
            Ok(true)
        } else {
            conn.execute("DELETE FROM local_favorites WHERE uri = ?1", params![uri])?;
            Ok(false)
        }
    }

    pub fn get_favorited_uris(&self) -> Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT uri FROM local_favorites ORDER BY added_at DESC LIMIT 1000")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        Ok(rows.flatten().collect())
    }

    pub fn get_favorited_tracks(&self, source: Option<&str>) -> Result<Vec<TrackMetadata>> {
        let conn = self.conn.lock().unwrap();
        let mut out = Vec::new();
        if let Some(src) = source.map(|s| s.trim()).filter(|s| !s.is_empty() && *s != "all") {
            let mut stmt = conn.prepare(
                "SELECT track_json FROM local_favorites
                 WHERE source = ?1
                 ORDER BY added_at DESC
                 LIMIT 500",
            )?;
            let rows = stmt.query_map(params![src], |r| r.get::<_, String>(0))?;
            for json_str in rows.flatten() {
                if let Ok(t) = serde_json::from_str::<TrackMetadata>(&json_str) {
                    out.push(t);
                }
            }
        } else {
            let mut stmt = conn.prepare(
                "SELECT track_json FROM local_favorites
                 ORDER BY added_at DESC
                 LIMIT 500",
            )?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
            for json_str in rows.flatten() {
                if let Ok(t) = serde_json::from_str::<TrackMetadata>(&json_str) {
                    out.push(t);
                }
            }
        }
        Ok(out)
    }

    pub fn get_local_artist_profile(&self, artist_name: &str) -> Result<LocalArtistProfile> {
        let cleaned = artist_name.trim();
        let all_albums = self.get_albums_filtered(None, None, Some(cleaned), 200, 0)?;
        let lower = cleaned.to_lowercase();
        let mut albums: Vec<AlbumRecord> = all_albums
            .into_iter()
            .filter(|a| {
                a.album_artist.trim().to_lowercase() == lower
                    || a.album_artist.to_lowercase().contains(&lower)
            })
            .collect();
        albums.sort_by(|a, b| b.release_year.cmp(&a.release_year).then_with(|| a.title.cmp(&b.title)));

        let all_tracks = self.get_tracks_filtered(None, None, Some(cleaned), 500, 0)?;
        let mut tracks: Vec<TrackMetadata> = all_tracks
            .into_iter()
            .filter(|t| {
                t.artists
                    .iter()
                    .any(|ar| ar.trim().to_lowercase() == lower || ar.to_lowercase().contains(&lower))
            })
            .collect();
        tracks.sort_by(|a, b| {
            a.album
                .cmp(&b.album)
                .then_with(|| a.disc_number.cmp(&b.disc_number))
                .then_with(|| a.track_number.cmp(&b.track_number))
        });

        let art_url = albums
            .iter()
            .find_map(|a| a.art_url.clone())
            .or_else(|| tracks.iter().find_map(|t| t.art_url.clone()));

        // Related artists: co-credited artists on those tracks or artists from the same mount_root
        let mut related_artists = Vec::new();
        for t in &tracks {
            for ar in &t.artists {
                let trim_ar = ar.trim();
                if !trim_ar.is_empty()
                    && trim_ar.to_lowercase() != lower
                    && !related_artists.iter().any(|r: &String| r.eq_ignore_ascii_case(trim_ar))
                {
                    related_artists.push(trim_ar.to_string());
                }
            }
        }

        Ok(LocalArtistProfile {
            name: cleaned.to_string(),
            art_url,
            tracks,
            albums,
            related_artists,
        })
    }

    pub fn get_track_properties(&self, uri: &str) -> Result<TrackPropertiesRecord> {
        let trimmed = uri.trim();
        let conn = self.conn.lock().unwrap();
        let row_opt = conn
            .query_row(
                "SELECT uri, has_art, has_lyrics, has_synced_lyrics, has_comments, has_factoids,
                        suppress_lyrics, suppress_comments, suppress_factoids, lyrics_offset_ms,
                        custom_art_url, preferred_viz_mode, updated_at
                 FROM track_properties
                 WHERE uri = ?1",
                params![trimmed],
                |r| {
                    Ok(TrackPropertiesRecord {
                        uri: r.get(0)?,
                        has_art: r.get::<_, i64>(1)? != 0,
                        has_lyrics: r.get::<_, i64>(2)? != 0,
                        has_synced_lyrics: r.get::<_, i64>(3)? != 0,
                        has_comments: r.get::<_, i64>(4)? != 0,
                        has_factoids: r.get::<_, i64>(5)? != 0,
                        suppress_lyrics: r.get::<_, i64>(6)? != 0,
                        suppress_comments: r.get::<_, i64>(7)? != 0,
                        suppress_factoids: r.get::<_, i64>(8)? != 0,
                        lyrics_offset_ms: r.get(9)?,
                        custom_art_url: r.get(10)?,
                        preferred_viz_mode: r.get(11)?,
                        updated_at: r.get(12)?,
                    })
                },
            )
            .optional()?;

        if let Some(rec) = row_opt {
            return Ok(rec);
        }

        // Fall back to checking if the track row has `art_url`
        let track_has_art: bool = conn
            .query_row(
                "SELECT CASE WHEN art_url IS NOT NULL AND art_url != '' THEN 1 ELSE 0 END
                 FROM tracks WHERE uri = ?1",
                params![trimmed],
                |r| r.get::<_, i64>(0).map(|v| v != 0),
            )
            .optional()?
            .unwrap_or(false);

        Ok(TrackPropertiesRecord {
            uri: trimmed.to_string(),
            has_art: track_has_art,
            ..Default::default()
        })
    }

    pub fn upsert_track_properties_patch(
        &self,
        uri: &str,
        patch: &TrackPropertiesPatch,
    ) -> Result<TrackPropertiesRecord> {
        let trimmed = uri.trim();
        let current = self.get_track_properties(trimmed)?;
        let next = TrackPropertiesRecord {
            uri: trimmed.to_string(),
            has_art: patch.has_art.unwrap_or(current.has_art),
            has_lyrics: patch.has_lyrics.unwrap_or(current.has_lyrics),
            has_synced_lyrics: patch.has_synced_lyrics.unwrap_or(current.has_synced_lyrics),
            has_comments: patch.has_comments.unwrap_or(current.has_comments),
            has_factoids: patch.has_factoids.unwrap_or(current.has_factoids),
            suppress_lyrics: patch.suppress_lyrics.unwrap_or(current.suppress_lyrics),
            suppress_comments: patch.suppress_comments.unwrap_or(current.suppress_comments),
            suppress_factoids: patch.suppress_factoids.unwrap_or(current.suppress_factoids),
            lyrics_offset_ms: patch
                .lyrics_offset_ms
                .unwrap_or(current.lyrics_offset_ms)
                .clamp(-15_000, 15_000),
            custom_art_url: match &patch.custom_art_url {
                Some(s) if s.trim().is_empty() => None,
                Some(s) => Some(s.trim().to_string()),
                None => current.custom_art_url,
            },
            preferred_viz_mode: match &patch.preferred_viz_mode {
                Some(s) if s.trim().is_empty() => None,
                Some(s) => Some(s.trim().to_string()),
                None => current.preferred_viz_mode,
            },
            updated_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0),
        };

        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO track_properties (
                uri, has_art, has_lyrics, has_synced_lyrics, has_comments, has_factoids,
                suppress_lyrics, suppress_comments, suppress_factoids, lyrics_offset_ms,
                custom_art_url, preferred_viz_mode, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
             ON CONFLICT(uri) DO UPDATE SET
                has_art = excluded.has_art,
                has_lyrics = excluded.has_lyrics,
                has_synced_lyrics = excluded.has_synced_lyrics,
                has_comments = excluded.has_comments,
                has_factoids = excluded.has_factoids,
                suppress_lyrics = excluded.suppress_lyrics,
                suppress_comments = excluded.suppress_comments,
                suppress_factoids = excluded.suppress_factoids,
                lyrics_offset_ms = excluded.lyrics_offset_ms,
                custom_art_url = excluded.custom_art_url,
                preferred_viz_mode = excluded.preferred_viz_mode,
                updated_at = excluded.updated_at",
            params![
                next.uri,
                if next.has_art { 1 } else { 0 },
                if next.has_lyrics { 1 } else { 0 },
                if next.has_synced_lyrics { 1 } else { 0 },
                if next.has_comments { 1 } else { 0 },
                if next.has_factoids { 1 } else { 0 },
                if next.suppress_lyrics { 1 } else { 0 },
                if next.suppress_comments { 1 } else { 0 },
                if next.suppress_factoids { 1 } else { 0 },
                next.lyrics_offset_ms,
                next.custom_art_url,
                next.preferred_viz_mode,
                next.updated_at,
            ],
        )?;

        Ok(next)
    }

    pub fn record_indexed_track_capabilities(
        &self,
        uri: &str,
        has_art: bool,
        has_lyrics: bool,
        has_synced_lyrics: bool,
    ) -> Result<()> {
        let trimmed = uri.trim();
        if trimmed.is_empty() {
            return Ok(());
        }
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO track_properties (
                uri, has_art, has_lyrics, has_synced_lyrics, updated_at
             ) VALUES (?1, ?2, ?3, ?4, strftime('%s', 'now'))
             ON CONFLICT(uri) DO UPDATE SET
                has_art = CASE WHEN excluded.has_art = 1 THEN 1 ELSE track_properties.has_art END,
                has_lyrics = CASE WHEN excluded.has_lyrics = 1 THEN 1 ELSE track_properties.has_lyrics END,
                has_synced_lyrics = CASE WHEN excluded.has_synced_lyrics = 1 THEN 1 ELSE track_properties.has_synced_lyrics END,
                updated_at = strftime('%s', 'now')",
            params![
                trimmed,
                if has_art { 1 } else { 0 },
                if has_lyrics { 1 } else { 0 },
                if has_synced_lyrics { 1 } else { 0 },
            ],
        )?;
        Ok(())
    }

    /// Synchronizes retrieved entries from `lyrics.db` (`lyrics_entries`) into `library.db` (`track_properties`),
    /// matching both direct `track_uri` and normalized `(title, artist)` across `tracks`, `play_history`, and `local_favorites`.
    pub fn sync_lyrics_properties_from_cache(&self) -> Result<()> {
        let cached = crate::lyrics::list_cached_lyrics_summaries();
        if cached.is_empty() {
            return Ok(());
        }

        let mut by_title_artist: std::collections::HashMap<(String, String), (bool, bool)> =
            std::collections::HashMap::new();
        for item in &cached {
            if !item.track_uri.is_empty() {
                let _ = self.record_indexed_track_capabilities(
                    &item.track_uri,
                    false,
                    item.has_lyrics,
                    item.has_synced_lyrics,
                );
            }
            if !item.title_lower.is_empty() {
                let entry = by_title_artist
                    .entry((item.title_lower.clone(), item.artist_lower.clone()))
                    .or_insert((false, false));
                entry.0 |= item.has_lyrics;
                entry.1 |= item.has_synced_lyrics;
            }
        }

        if by_title_artist.is_empty() {
            return Ok(());
        }

        let mut matched_uris: Vec<(String, bool, bool)> = Vec::new();
        {
            let conn = self.conn.lock().unwrap();
            if let Ok(mut stmt) = conn.prepare("SELECT uri, title, artists_json FROM tracks") {
                if let Ok(rows) = stmt.query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                    ))
                }) {
                    for (uri, title, artists_json) in rows.flatten() {
                        let t_low = title.trim().to_lowercase();
                        let artists: Vec<String> =
                            serde_json::from_str(&artists_json).unwrap_or_default();
                        let a_low = artists
                            .first()
                            .map(|s| s.trim().to_lowercase())
                            .unwrap_or_default();
                        if let Some(&(has_l, has_s)) =
                            by_title_artist.get(&(t_low.clone(), a_low))
                        {
                            matched_uris.push((uri, has_l, has_s));
                        }
                    }
                }
            };
        }

        for (uri, has_l, has_s) in matched_uris {
            let _ = self.record_indexed_track_capabilities(&uri, false, has_l, has_s);
        }
        Ok(())
    }

    /// Returns `(synced_lyrics_uris, all_lyrics_uris)` for fast UI track badge & filter lookups.
    pub fn get_lyrics_uri_sets(&self) -> Result<(Vec<String>, Vec<String>)> {
        let _ = self.sync_lyrics_properties_from_cache();
        let conn = self.conn.lock().unwrap();
        let mut synced_uris = Vec::new();
        let mut all_lyrics_uris = Vec::new();
        let mut stmt = conn.prepare(
            "SELECT uri, has_lyrics, has_synced_lyrics
             FROM track_properties
             WHERE (has_lyrics = 1 OR has_synced_lyrics = 1) AND suppress_lyrics = 0",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)? != 0,
                r.get::<_, i64>(2)? != 0,
            ))
        })?;
        for (uri, has_lyrics, has_synced) in rows.flatten() {
            if has_synced {
                synced_uris.push(uri.clone());
            }
            if has_lyrics || has_synced {
                all_lyrics_uris.push(uri);
            }
        }
        Ok((synced_uris, all_lyrics_uris))
    }

    /// Returns track URIs matching a Smart Facet (`"synced_lyrics"`, `"has_lyrics"`, `"has_art"`, `"missing_art"`, `"has_factoids"`, `"has_comments"`).
    pub fn get_facet_matching_uris(&self, facet: &str) -> Result<Vec<String>> {
        let trimmed = facet.trim();
        if trimmed == "synced_lyrics" || trimmed == "has_lyrics" {
            let _ = self.sync_lyrics_properties_from_cache();
        }
        let conn = self.conn.lock().unwrap();
        let sql = match trimmed {
            "synced_lyrics" => {
                "SELECT uri FROM track_properties WHERE has_synced_lyrics = 1 AND suppress_lyrics = 0"
            }
            "has_lyrics" => {
                "SELECT uri FROM track_properties WHERE (has_lyrics = 1 OR has_synced_lyrics = 1) AND suppress_lyrics = 0"
            }
            "has_art" => {
                "SELECT t.uri FROM tracks t
                 LEFT JOIN track_properties tp ON tp.uri = t.uri
                 WHERE (t.art_url IS NOT NULL AND t.art_url != '')
                    OR (tp.custom_art_url IS NOT NULL AND tp.custom_art_url != '')
                    OR COALESCE(tp.has_art, 0) = 1"
            }
            "missing_art" => {
                "SELECT t.uri FROM tracks t
                 LEFT JOIN track_properties tp ON tp.uri = t.uri
                 WHERE (t.art_url IS NULL OR t.art_url = '')
                   AND (tp.custom_art_url IS NULL OR tp.custom_art_url = '')
                   AND COALESCE(tp.has_art, 0) = 0"
            }
            "has_factoids" => {
                "SELECT uri FROM track_properties WHERE has_factoids = 1 AND suppress_factoids = 0"
            }
            "has_comments" => {
                "SELECT uri FROM track_properties WHERE has_comments = 1 AND suppress_comments = 0"
            }
            _ => return Ok(Vec::new()),
        };

        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        Ok(rows.flatten().collect())
    }

    pub fn get_facet_matching_tracks(&self, facet: &str) -> Result<Vec<TrackMetadata>> {
        let uris = self.get_facet_matching_uris(facet)?;
        if uris.is_empty() {
            return Ok(Vec::new());
        }
        let mut results: Vec<TrackMetadata> = Vec::new();
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

        // 1. Resolve tracks stored in `tracks` (local files, Steam OSTs, and pinned playlists/albums)
        for uri in &uris {
            if let Ok(Some(track)) = self.get_track_by_uri(uri) {
                if seen.insert(track.uri.clone()) {
                    results.push(track);
                }
            }
        }

        // 2. Resolve any remaining URIs from `play_history` or `local_favorites` (e.g. cloud tracks)
        if seen.len() < uris.len() {
            let conn = self.conn.lock().unwrap();
            for uri in &uris {
                if seen.contains(uri) {
                    continue;
                }
                let json_opt: Option<String> = conn
                    .query_row(
                        "SELECT track_json FROM play_history WHERE uri = ?1
                         UNION ALL
                         SELECT track_json FROM local_favorites WHERE uri = ?1
                         LIMIT 1",
                        params![uri],
                        |r| r.get(0),
                    )
                    .optional()
                    .ok()
                    .flatten();
                if let Some(raw_json) = json_opt {
                    if let Ok(track) = serde_json::from_str::<TrackMetadata>(&raw_json) {
                        if seen.insert(track.uri.clone()) {
                            results.push(track);
                        }
                    }
                }
            }
        }

        results.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
        Ok(results)
    }

    /// Upgrades a pinned cloud playlist (`apple_pinned`, `soundcloud_pinned`, `ia_pinned`, etc.)
    /// into a mutable Hybrid SIMP Playlist (`origin = 'simp_local'`).
    pub fn convert_playlist_to_hybrid(&self, playlist_id: &str) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let changed = conn.execute(
            "UPDATE playlists
             SET origin = 'simp_local',
                 updated_at = strftime('%s', 'now')
             WHERE id = ?1",
            params![playlist_id.trim()],
        )?;
        Ok(changed > 0)
    }

    /// Purges all database records (tracks, pins, play history, favorites, and source caches)
    /// for a single source (`"local"`, `"apple"`, `"soundcloud"`, `"ia"`).
    pub fn purge_source_data(&self, source: &str) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let mut removed = 0usize;
        match source.trim() {
            "local" => {
                removed += conn.execute(
                    "DELETE FROM tracks WHERE source != 'apple_music' AND source != 'soundcloud' AND source != 'internet_archive' AND source != 'ia_video'",
                    [],
                )?;
                let _ = conn.execute("DELETE FROM play_history WHERE source = 'local'", []);
                let _ = conn.execute("DELETE FROM local_favorites WHERE source = 'local'", []);
                let _ = conn.execute("DELETE FROM musicbrainz_album_art_cache", []);
            }
            "apple" | "apple_music" => {
                removed += conn.execute(
                    "DELETE FROM playlists WHERE origin LIKE 'apple_%'",
                    [],
                )?;
                removed += conn.execute(
                    "DELETE FROM tracks WHERE source = 'apple_music' OR uri LIKE 'applemusic:%'",
                    [],
                )?;
                let _ = conn.execute(
                    "DELETE FROM play_history WHERE source = 'apple_music' OR uri LIKE 'applemusic:%'",
                    [],
                );
                let _ = conn.execute(
                    "DELETE FROM local_favorites WHERE source = 'apple_music' OR uri LIKE 'applemusic:%'",
                    [],
                );
                let _ = conn.execute("DELETE FROM apple_catalog_map", []);
                let _ = conn.execute("DELETE FROM apple_playlist_art_cache", []);
            }
            "soundcloud" => {
                removed += conn.execute(
                    "DELETE FROM playlists WHERE origin LIKE 'soundcloud_%'",
                    [],
                )?;
                removed += conn.execute(
                    "DELETE FROM tracks WHERE source = 'soundcloud' OR uri LIKE 'soundcloud:%'",
                    [],
                )?;
                let _ = conn.execute(
                    "DELETE FROM play_history WHERE source = 'soundcloud' OR uri LIKE 'soundcloud:%'",
                    [],
                );
                let _ = conn.execute(
                    "DELETE FROM local_favorites WHERE source = 'soundcloud' OR uri LIKE 'soundcloud:%'",
                    [],
                );
            }
            "ia" | "internet_archive" => {
                removed += conn.execute(
                    "DELETE FROM playlists WHERE origin LIKE 'ia_%' OR origin LIKE 'archive_%'",
                    [],
                )?;
                removed += conn.execute(
                    "DELETE FROM tracks WHERE source IN ('internet_archive', 'ia_video') OR uri LIKE 'ia:%' OR uri LIKE 'ia://%'",
                    [],
                )?;
                let _ = conn.execute(
                    "DELETE FROM play_history WHERE source IN ('internet_archive', 'ia_video') OR uri LIKE 'ia:%' OR uri LIKE 'ia://%'",
                    [],
                );
                let _ = conn.execute(
                    "DELETE FROM local_favorites WHERE source IN ('internet_archive', 'ia_video') OR uri LIKE 'ia:%' OR uri LIKE 'ia://%'",
                    [],
                );
            }
            _ => {}
        }

        // Clean up any orphaned albums and update playlist track counts
        let _ = conn.execute(
            "DELETE FROM albums WHERE id NOT IN (SELECT DISTINCT album_id FROM tracks WHERE album_id IS NOT NULL)",
            [],
        );
        let _ = conn.execute(
            "UPDATE playlists SET track_count = (SELECT COUNT(*) FROM playlist_items WHERE playlist_id = playlists.id)",
            [],
        );

        Ok(removed)
    }
}


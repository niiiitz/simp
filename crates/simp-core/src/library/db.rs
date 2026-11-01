use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension};
use simp_protocol::{AlbumRecord, MountStatus, PlaylistRecord, TrackMetadata};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

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
        conn.execute_batch(
            "
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
            ",
        )?;

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

    /// Returns a map of `uri -> (mtime, size)` for fast incremental indexing of a mount root.
    /// Tracks with `art_url IS NULL` are excluded so newly added folder artwork (`cover.jpg`) is picked up on rescan.
    pub fn get_mount_file_fingerprints(&self, mount_root: &str) -> Result<HashMap<String, (i64, i64)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT uri, COALESCE(file_mtime, 0), COALESCE(file_size, 0)
             FROM tracks WHERE mount_root = ?1 AND art_url IS NOT NULL",
        )?;
        let mut map = HashMap::new();
        let rows = stmt.query_map(params![mount_root], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?;
        for row in rows.flatten() {
            map.insert(row.0, (row.1, row.2));
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
               art_cache_path = COALESCE(excluded.art_cache_path, albums.art_cache_path),
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
                title = excluded.title,
                artists_json = excluded.artists_json,
                album_title = excluded.album_title,
                track_number = excluded.track_number,
                disc_number = excluded.disc_number,
                duration_ms = excluded.duration_ms,
                art_url = COALESCE(excluded.art_url, tracks.art_url),
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
        let conn = self.conn.lock().unwrap();
        let search_pattern = search.map(|s| format!("%{}%", s)).unwrap_or_else(|| "%".to_string());
        let mut stmt = conn.prepare(
            "SELECT a.id, a.title, a.album_artist, a.release_year, a.steam_app_id, a.art_cache_path,
                    COUNT(t.uri) as track_count
             FROM albums a
             JOIN tracks t ON t.album_id = a.id
             LEFT JOIN storage_mounts m ON t.mount_root = m.mount_root
             WHERE (t.mount_root IS NULL OR m.is_online = 1)
               AND (?1 IS NULL OR t.source = ?1)
               AND (a.title LIKE ?2 OR a.album_artist LIKE ?2)
             GROUP BY a.id
             ORDER BY a.title COLLATE NOCASE ASC
             LIMIT ?3 OFFSET ?4",
        )?;
        let rows = stmt.query_map(
            params![source, search_pattern, limit as i64, offset as i64],
            |row| {
                Ok(AlbumRecord {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    album_artist: row.get(2)?,
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
        let conn = self.conn.lock().unwrap();
        let search_pattern = search.map(|s| format!("%{}%", s)).unwrap_or_else(|| "%".to_string());
        let mut stmt = conn.prepare(
            "SELECT t.uri, t.title, t.artists_json, t.album_title, t.album_id, t.track_number,
                    t.disc_number, t.art_url, t.duration_ms, t.source, t.mount_root
             FROM tracks t
             LEFT JOIN storage_mounts m ON t.mount_root = m.mount_root
             WHERE (t.mount_root IS NULL OR m.is_online = 1)
               AND (?1 IS NULL OR t.source = ?1)
               AND (t.title LIKE ?2 OR t.album_title LIKE ?2 OR t.artists_json LIKE ?2)
             ORDER BY t.album_title COLLATE NOCASE ASC, COALESCE(t.disc_number, 1) ASC, COALESCE(t.track_number, 999) ASC
             LIMIT ?3 OFFSET ?4",
        )?;
        let rows = stmt.query_map(
            params![source, search_pattern, limit as i64, offset as i64],
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
            "SELECT id, name, description, origin, cover_art_url, track_count, updated_at
             FROM playlists ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(PlaylistRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                origin: row.get(3)?,
                cover_art_url: row.get(4)?,
                track_count: row.get::<_, i64>(5)? as usize,
                updated_at: row.get(6)?,
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
        conn.execute(
            "DELETE FROM albums WHERE id NOT IN (SELECT DISTINCT album_id FROM tracks WHERE album_id IS NOT NULL)",
            [],
        )?;
        Ok(())
    }
}


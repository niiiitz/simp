pub mod gamepad;
pub mod http_pool;
pub mod library;
pub mod mpris;
pub mod orchestrator;
pub mod sinks;
pub mod time_tracker;
pub mod tray;
pub mod updater;
pub mod vr_overlay;

pub use orchestrator::AudioOrchestrator;
pub use time_tracker::LocalTimeTracker;

#[cfg(test)]
mod tests {
    use crate::library::db::LibraryDatabase;
    use crate::time_tracker::LocalTimeTracker;
    use simp_protocol::TrackMetadata;
    use std::path::PathBuf;

    #[test]
    fn test_time_tracker_seek_and_pause() {
        let mut tracker = LocalTimeTracker::new();
        assert!(!tracker.is_playing());
        assert_eq!(tracker.get_position_ms(), 0);

        tracker.seek(45_000);
        assert_eq!(tracker.get_position_ms(), 45_000);

        tracker.play();
        assert!(tracker.is_playing());
        tracker.pause();
        assert!(!tracker.is_playing());
        assert!(tracker.get_position_ms() >= 45_000);
    }

    #[test]
    fn test_sqlite_non_destructive_mount_hotplug() {
        let tmp_db = PathBuf::from("/tmp/simp_test_library.db");
        let _ = std::fs::remove_file(&tmp_db);
        let db = LibraryDatabase::open(&tmp_db).expect("open sqlite db");

        let usb_root = "/run/media/deck/USB_MUSIC";
        db.upsert_mount(usb_root, "USB_MUSIC", "removable_media", true)
            .unwrap();
        db.upsert_album(
            "alb_doom",
            "DOOM (Original Game Soundtrack)",
            "Mick Gordon",
            Some(2016),
            Some(379720),
            None,
        )
        .unwrap();

        let track = TrackMetadata {
            uri: "file:///run/media/deck/USB_MUSIC/03_BFG_Division.flac".to_string(),
            title: "BFG Division".to_string(),
            artists: vec!["Mick Gordon".to_string()],
            album: "DOOM (Original Game Soundtrack)".to_string(),
            album_id: Some("alb_doom".to_string()),
            track_number: Some(3),
            disc_number: Some(1),
            art_url: None,
            duration_ms: 506_000,
            source: "local".to_string(),
            mount_root: Some(usb_root.to_string()),
        };

        db.upsert_track(&track, Some(1700000000), Some(42_000_000))
            .unwrap();

        // While online, track and album appear in queries
        let albums_online = db.get_albums(None, None, 50, 0).unwrap();
        assert_eq!(albums_online.len(), 1);

        // Unplug USB drive (non-destructive!)
        db.set_mount_online(usb_root, false).unwrap();
        let albums_offline = db.get_albums(None, None, 50, 0).unwrap();
        assert_eq!(albums_offline.len(), 0);

        // Plug USB drive back in -> metadata is immediately restored without re-indexing!
        db.set_mount_online(usb_root, true).unwrap();
        let albums_restored = db.get_albums(None, None, 50, 0).unwrap();
        assert_eq!(albums_restored.len(), 1);
        assert_eq!(albums_restored[0].title, "DOOM (Original Game Soundtrack)");

        let _ = std::fs::remove_file(&tmp_db);
    }

    #[test]
    fn test_perceptual_cubic_volume_taper() {
        use crate::sinks::local::perceptual_cubic_gain;
        assert_eq!(perceptual_cubic_gain(0.0), 0.0);
        assert!((perceptual_cubic_gain(0.05) - 0.000125).abs() < 1e-6);
        assert!((perceptual_cubic_gain(0.30) - 0.027).abs() < 1e-6);
        assert!((perceptual_cubic_gain(0.50) - 0.125).abs() < 1e-6);
        assert!((perceptual_cubic_gain(0.70) - 0.343).abs() < 1e-6);
        assert_eq!(perceptual_cubic_gain(1.0), 1.0);
    }
}



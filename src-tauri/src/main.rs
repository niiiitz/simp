#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use mimalloc::MiMalloc;

#[global_allocator]
static GLOBAL: MiMalloc = MiMalloc;

fn main() {
    let args: Vec<String> = std::env::args().collect();

    if args.iter().any(|arg| arg == "--version" || arg == "-V") {
        println!("simp v{}", env!("CARGO_PKG_VERSION"));
        return;
    }

    // Mode 0: Self-Updater (`simp update` / `simp --update` / `simp self-update`)
    if args
        .iter()
        .any(|arg| arg == "update" || arg == "--update" || arg == "self-update")
    {
        println!(
            "Checking GitHub Releases for SIMP updates (current: v{})...",
            env!("CARGO_PKG_VERSION")
        );
        match simp_core::updater::check_for_updates() {
            Ok(status) => {
                if status.update_available {
                    println!(
                        "⬆️  New release available: {} (current: v{})",
                        status.latest_tag, status.current_version
                    );
                } else {
                    println!(
                        "ℹ️  Reinstalling latest release {} (current: v{})...",
                        status.latest_tag, status.current_version
                    );
                }
                match simp_core::updater::apply_self_update(Some(&status.latest_tag), true, false) {
                    Ok(res) => {
                        println!("✅ {}", res.message);
                        match simp_core::updater::restart_daemon_synchronously() {
                            Ok(restart_msg) => println!("🔄 {restart_msg}"),
                            Err(e) => eprintln!("⚠️  Could not auto-restart background daemon: {e}"),
                        }
                    }
                    Err(e) => {
                        eprintln!("❌ Update failed: {e}");
                        std::process::exit(1);
                    }
                }
            }
            Err(e) => {
                eprintln!("❌ Failed to check for updates: {e}");
                std::process::exit(1);
            }
        }
        return;
    }

    // Mode 0c: Isolated Subprocess Worker for `libwidevinecdm.so` FFI Test (`simp --cdm-worker-test <song_id>`)
    if let Some(pos) = args.iter().position(|arg| arg == "--cdm-worker-test") {
        let song_id = args
            .get(pos + 1)
            .map(|s| s.as_str())
            .unwrap_or("6777766099");
        let settings = simp_daemon::config::load_or_create_settings();
        match simp_core::sinks::apple_native::source::load_native_apple_music_rodio_source(
            &settings,
            song_id,
            Some(1),
        ) {
            Ok(src) => {
                println!(
                    "OK: Decrypted & decoded segment #0 ({} Hz, {} ch, {:.2}s PCM)",
                    src.pcm_sample_rate(),
                    src.pcm_channels(),
                    src.pcm_duration_secs()
                );
            }
            Err(e) => {
                eprintln!("ERR: {e}");
                std::process::exit(1);
            }
        }
        return;
    }

    // Mode 0b: Native Apple Music HLS + fMP4 + Widevine CDM Diagnostic Probe (`simp probe-apple [song_id]`)
    if let Some(pos) = args
        .iter()
        .position(|arg| arg == "probe-apple" || arg == "--probe-apple")
    {
        let settings = simp_daemon::config::load_or_create_settings();
        let song_id = if let Some(arg_id) = args.get(pos + 1).filter(|s| !s.starts_with('-')) {
            arg_id.clone()
        } else if let Ok(res) =
            simp_core::sinks::apple_api::search_catalog(&settings, "Dev Lemons Broke Your Cover")
        {
            res.songs
                .first()
                .map(|s| s.uri.clone())
                .unwrap_or_else(|| "1440857781".to_string())
        } else {
            "1440857781".to_string()
        };
        println!("🔍 Probing Native Rust Apple Music HLS + fMP4 Pipeline for song_id={song_id}...");
        match simp_core::sinks::apple_native::source::probe_apple_native_pipeline(
            &settings, &song_id,
        ) {
            Ok(report) => {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&report).unwrap_or_default()
                );
            }
            Err(e) => {
                eprintln!("❌ Native pipeline probe failed: {e}");
                std::process::exit(1);
            }
        }
        return;
    }

    // Mode 1: Headless systemd Daemon (`simp --daemon`)
    // Runs on a tight 2-thread Tokio runtime without initializing GTK or WebKitGTK.
    if args.iter().any(|arg| arg == "--daemon" || arg == "-d") {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .expect("Failed to build Tokio runtime for SIMP daemon");

        if let Err(e) = rt.block_on(simp_daemon::run_daemon()) {
            eprintln!("SIMP daemon exited with error: {e}");
            std::process::exit(1);
        }
        return;
    }

    // Mode 2: Foreground UI Client (`simp` or `simp --ui`)
    simp_ui_lib::run_ui();
}


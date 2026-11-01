#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use mimalloc::MiMalloc;

#[global_allocator]
static GLOBAL: MiMalloc = MiMalloc;

fn main() {
    let args: Vec<String> = std::env::args().collect();

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


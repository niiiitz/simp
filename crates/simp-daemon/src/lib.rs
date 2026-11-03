pub mod config;
pub mod ipc_server;

use crate::config::{library_db_path, load_or_create_settings};
use crate::ipc_server::{run_ipc_server, DaemonIpcState};
use simp_core::{library::db::LibraryDatabase, orchestrator::AudioOrchestrator};
use simp_protocol::{AudioCommand, PlaybackEvent};
use std::sync::{atomic::AtomicUsize, Arc, Mutex};
use tokio::sync::{broadcast, mpsc};

/// Headless entrypoint for `simp --daemon`.
/// Initializes `.vdf` settings, SQLite `library.db`, detached OST/USB indexer,
/// `souvlaki` MPRIS2 D-Bus hook, `AudioOrchestrator`, and the `127.0.0.1:18888` IPC server.
pub async fn run_daemon() -> anyhow::Result<()> {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "simp_daemon=info,simp_core=info".into()),
        )
        .try_init();

    tracing::info!("Starting SIMP (Simple Integrated Media Player) headless daemon...");

    let settings = Arc::new(Mutex::new(load_or_create_settings()));
    let db_path = library_db_path();
    let db = LibraryDatabase::open(&db_path)?;

    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<AudioCommand>();
    let (internal_event_tx, internal_event_rx) = mpsc::unbounded_channel::<PlaybackEvent>();
    let (broadcast_tx, _) = broadcast::channel::<PlaybackEvent>(256);

    let state_db = db.clone();
    let state_settings = settings.clone();
    let state_cmd_tx = cmd_tx.clone();
    let state_bcast_tx = broadcast_tx.clone();

    let (state_ready_tx, state_ready_rx) = tokio::sync::oneshot::channel();

    // 1. Spawn the dedicated Audio Orchestrator & MPRIS2 thread
    // (`rodio::OutputStream` and `souvlaki::MediaControls` own native OS handles and live on this thread)
    std::thread::Builder::new()
        .name("simp-audio-orchestrator".to_string())
        .spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("Failed to build audio orchestrator runtime");

            rt.block_on(async move {
                let orchestrator = AudioOrchestrator::new(
                    state_db,
                    state_settings,
                    state_cmd_tx,
                    internal_event_tx,
                    state_bcast_tx,
                );
                let _ = state_ready_tx.send(orchestrator.state.clone());
                orchestrator.run_loop(cmd_rx, internal_event_rx).await;
            });
        })?;

    let orchestrator_state = state_ready_rx.await?;

    // 2. Spawn native KDE Plasma / FreeDesktop StatusNotifierItem system tray hook
    simp_core::tray::spawn_system_tray(orchestrator_state.clone(), cmd_tx.clone());

    // 3. Trigger initial non-blocking background storage & Steam OST crawl
    let _ = cmd_tx.send(AudioCommand::RescanStorage);

    // 3. Run the local loopback WebSocket + Artwork HTTP server on 127.0.0.1:18888
    let ipc_state = DaemonIpcState {
        db,
        settings,
        orchestrator_state,
        cmd_tx,
        broadcast_tx,
        connected_clients: Arc::new(AtomicUsize::new(0)),
    };

    run_ipc_server(ipc_state).await
}


import type { RepeatMode, SimpStateSnapshot } from './types';

type StateListener = (state: SimpStateSnapshot) => void;
type ProgressListener = (positionMs: number, syncPerfTime: number, isPlaying: boolean) => void;

/**
 * Shared auto-reconnecting WebSocket client connecting to `simp --daemon` (`ws://127.0.0.1:18888/ws`).
 * Decouples low-frequency state updates from high-frequency 500ms `progress_tick` anchors.
 */
export class SimpDaemonClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reqCounter = 1;
  private pendingQueries = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();
  private stateListeners = new Set<StateListener>();
  private progressListeners = new Set<ProgressListener>();
  private state: SimpStateSnapshot = {
    active_engine: 'none',
    is_playing: false,
    position_ms: 0,
    volume: 0.8,
    shuffle: false,
    repeat_mode: 'off',
    current_track: null,
    up_next: [],
    queue_length: 0,
    queue_index: 0,
    mounts: [],
    power: { on_battery: false, battery_pct: null },
    spotify_authenticated: false,
    apple_authenticated: false,
  };

  constructor(url = 'ws://127.0.0.1:18888/ws') {
    this.url = url;
  }

  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.ws = new WebSocket(this.url);

    this.ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        this.handleEnvelope(msg);
      } catch {
        // Ignore malformed packets
      }
    };

    this.ws.onclose = () => {
      setTimeout(() => this.connect(), 1500);
    };
  }

  private handleEnvelope(msg: any): void {
    if (msg.kind === 'state_snapshot') {
      this.state = {
        active_engine: msg.active_engine,
        is_playing: msg.is_playing,
        position_ms: msg.position_ms,
        volume: msg.volume,
        shuffle: msg.shuffle,
        repeat_mode: msg.repeat_mode,
        current_track: msg.current_track,
        up_next: msg.up_next ?? [],
        queue_length: msg.queue_length ?? 0,
        queue_index: msg.queue_index ?? 0,
        mounts: msg.mounts ?? [],
        power: msg.power ?? { on_battery: false, battery_pct: null },
        spotify_authenticated: !!msg.spotify_authenticated,
        apple_authenticated: !!msg.apple_authenticated,
      };
      this.notifyState();
      this.notifyProgress(this.state.position_ms);
      return;
    }

    if (msg.kind === 'query_response') {
      const pending = this.pendingQueries.get(msg.req_id);
      if (pending) {
        this.pendingQueries.delete(msg.req_id);
        if (msg.ok) {
          pending.resolve(msg.data);
        } else {
          pending.reject(new Error(msg.error || 'Query failed'));
        }
      }
      return;
    }

    if (msg.kind === 'event') {
      switch (msg.event) {
        case 'progress_tick':
          // High-frequency tick: ONLY notify rAF progress listeners (never re-render React tree!)
          this.state.position_ms = msg.data.position_ms;
          this.notifyProgress(msg.data.position_ms);
          break;
        case 'track_changed':
          this.state = {
            ...this.state,
            current_track: msg.data.metadata,
            position_ms: msg.data.position_ms,
            is_playing: true,
          };
          this.notifyState();
          this.notifyProgress(msg.data.position_ms);
          break;
        case 'playback_state_changed':
          this.state = {
            ...this.state,
            is_playing: msg.data.is_playing,
            position_ms: msg.data.position_ms,
          };
          this.notifyState();
          this.notifyProgress(msg.data.position_ms);
          break;
        case 'volume_synced':
          this.state = { ...this.state, volume: msg.data.volume };
          this.notifyState();
          break;
        case 'queue_updated':
          this.state = {
            ...this.state,
            queue_index: msg.data.current_index,
            queue_length: msg.data.queue.length,
            up_next: msg.data.queue.slice(msg.data.current_index + 1, msg.data.current_index + 6),
            shuffle: msg.data.shuffle,
            repeat_mode: msg.data.repeat_mode,
          };
          this.notifyState();
          break;
        case 'storage_mounts_changed':
          this.state = { ...this.state, mounts: msg.data.mounts };
          this.notifyState();
          break;
        case 'library_updated':
          this.notifyState();
          break;
        case 'power_state_changed':
          this.state = { ...this.state, power: msg.data.power };
          this.notifyState();
          break;
      }
    }
  }

  public sendCommand(cmd: string, payload?: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ kind: 'command', cmd, ...(payload ? { payload } : {}) }));
  }

  public query<T = any>(queryName: string, params?: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Daemon WebSocket not connected'));
        return;
      }
      const req_id = this.reqCounter++;
      this.pendingQueries.set(req_id, { resolve, reject });
      this.ws.send(JSON.stringify({ kind: 'query', req_id, query: queryName, ...(params ? { params } : {}) }));
    });
  }

  // Transport helpers
  public play = () => this.sendCommand('play');
  public pause = () => this.sendCommand('pause');
  public togglePlayPause = () => this.sendCommand('toggle_play_pause');
  public next = () => this.sendCommand('next');
  public previous = () => this.sendCommand('previous');
  public seek = (position_ms: number) => this.sendCommand('seek', { position_ms });
  public seekRelative = (delta_ms: number) => this.sendCommand('seek_relative', { delta_ms });
  public setVolume = (volume: number) => this.sendCommand('set_volume', { volume });
  public setShuffle = (enabled: boolean) => this.sendCommand('set_shuffle', { enabled });
  public setRepeat = (mode: RepeatMode) => this.sendCommand('set_repeat', { mode });
  public cycleRepeat = () => this.sendCommand('cycle_repeat');
  public loadUri = (uri: string) => this.sendCommand('load', { uri });
  public loadQueue = (uris: string[], start_index = 0) =>
    this.sendCommand('load_queue', { uris, start_index });
  public playAlbum = (album_id: string, shuffle = false) =>
    this.sendCommand('play_album', { album_id, shuffle });
  public playPlaylist = (playlist_id: string, shuffle = false) =>
    this.sendCommand('play_playlist', { playlist_id, shuffle });
  public addLibraryPath = (path: string) => this.sendCommand('add_library_path', { path });
  public rescanStorage = () => this.sendCommand('rescan_storage');
  public shutdownDaemon = () => this.sendCommand('shutdown_daemon');

  public subscribeState(fn: StateListener): () => void {
    this.stateListeners.add(fn);
    fn(this.state);
    return () => this.stateListeners.delete(fn);
  }

  public subscribeProgress(fn: ProgressListener): () => void {
    this.progressListeners.add(fn);
    fn(this.state.position_ms, performance.now(), this.state.is_playing);
    return () => this.progressListeners.delete(fn);
  }

  private notifyState(): void {
    for (const fn of this.stateListeners) {
      fn(this.state);
    }
  }

  private notifyProgress(posMs: number): void {
    const now = performance.now();
    for (const fn of this.progressListeners) {
      fn(posMs, now, this.state.is_playing);
    }
  }
}

export const defaultSimpClient = new SimpDaemonClient();


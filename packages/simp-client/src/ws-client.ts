import type {
  AlbumRecord,
  AppleMusicAuthConfig,
  AppleSinkCommandPayload,
  InternetArchiveConfig,
  OpticalDiscStatus,
  PlaylistRecord,
  RepeatMode,
  SimpStateSnapshot,
  SoundCloudAuthConfig,
  TrackMetadata,
} from './types';

type StateListener = (state: SimpStateSnapshot) => void;
type ProgressListener = (positionMs: number, syncPerfTime: number, isPlaying: boolean) => void;
type AppleSinkListener = (cmd: AppleSinkCommandPayload) => void;

/**
 * Shared auto-reconnecting WebSocket client connecting to `simp --daemon` (`ws://127.0.0.1:18888/ws`).
 * Decouples low-frequency state updates from high-frequency 500ms `progress_tick` anchors.
 */
function resolveDefaultWsUrl(): string {
  if (typeof window !== 'undefined' && window.location?.hostname) {
    const host = window.location.hostname;
    // In SteamOS Gaming Mode (`SharedJSContext`), `window.location` is `https://steamloopback.host`.
    // Always connect directly to the local daemon on `ws://127.0.0.1:18888/ws` unless accessed over
    // plain HTTP from a LAN companion device (e.g. `http://192.168.x.x:18888/pair`).
    if (
      window.location.protocol === 'http:' &&
      host !== 'steamloopback.host' &&
      host !== '127.0.0.1' &&
      host !== 'localhost'
    ) {
      const port = window.location.port === '1420' ? '18888' : window.location.port || '18888';
      return `ws://${host}:${port}/ws`;
    }
  }
  return 'ws://127.0.0.1:18888/ws';
}

export class SimpDaemonClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reqCounter = 1;
  private pendingQueries = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();
  private stateListeners = new Set<StateListener>();
  private progressListeners = new Set<ProgressListener>();
  private appleSinkListeners = new Set<AppleSinkListener>();
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
    apple_authenticated: false,
    soundcloud_authenticated: false,
    internet_archive_authenticated: false,
    brightness_pct: 100,
  };

  constructor(url = resolveDefaultWsUrl()) {
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
        apple_authenticated: !!msg.apple_authenticated,
        soundcloud_authenticated: !!msg.soundcloud_authenticated,
        internet_archive_authenticated: !!msg.internet_archive_authenticated,
        brightness_pct: typeof msg.brightness_pct === 'number' && msg.brightness_pct >= 25 ? msg.brightness_pct : 100,
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
        case 'queue_updated': {
          const q = msg.data.queue || [];
          const idx = msg.data.current_index ?? 0;
          let upNext = q.slice(idx + 1, idx + 6);
          if (msg.data.repeat_mode === 'queue' && q.length > 1 && upNext.length < 5) {
            const needed = Math.min(5 - upNext.length, idx);
            upNext = [...upNext, ...q.slice(0, needed)];
          }
          this.state = {
            ...this.state,
            queue_index: idx,
            queue_length: q.length,
            up_next: upNext,
            shuffle: msg.data.shuffle,
            repeat_mode: msg.data.repeat_mode,
          };
          this.notifyState();
          break;
        }
        case 'storage_mounts_changed':
          this.state = { ...this.state, mounts: msg.data.mounts };
          this.notifyState();
          break;
        case 'library_updated':
          this.query('get_state_snapshot')
            .then((snap) => this.handleEnvelope(snap))
            .catch(() => this.notifyState());
          break;
        case 'power_state_changed':
          this.state = { ...this.state, power: msg.data.power };
          this.notifyState();
          break;
        case 'apple_sink_command':
          for (const fn of this.appleSinkListeners) {
            fn(msg.data as AppleSinkCommandPayload);
          }
          break;
        case 'gamepad_input':
          if (typeof window !== 'undefined' && msg.data?.action) {
            window.dispatchEvent(
              new CustomEvent('simp-daemon-gamepad', { detail: { action: msg.data.action } })
            );
          }
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
  public setBrightness = (brightness_pct: number) =>
    this.sendCommand('set_brightness', {
      brightness_pct: Math.max(25, Math.min(100, Math.round(brightness_pct))),
    });
  public setShuffle = (enabled: boolean) => this.sendCommand('set_shuffle', { enabled });
  public setRepeat = (mode: RepeatMode) => this.sendCommand('set_repeat', { mode });
  public cycleRepeat = () => this.sendCommand('cycle_repeat');
  public loadUri = (uri: string) => this.sendCommand('load', { uri });
  public loadQueue = (uris: string[], start_index = 0, tracks?: TrackMetadata[]) =>
    this.sendCommand('load_queue', {
      uris,
      start_index,
      ...(tracks && tracks.length > 0 ? { tracks } : {}),
    });
  public playAlbum = (album_id: string, shuffle = false) =>
    this.sendCommand('play_album', { album_id, shuffle });
  public playPlaylist = (playlist_id: string, shuffle = false) =>
    this.sendCommand('play_playlist', { playlist_id, shuffle });
  public addLibraryPath = (path: string) => this.sendCommand('add_library_path', { path });
  public removeLibraryPath = (path: string) => this.sendCommand('remove_library_path', { path });
  public rescanStorage = () => this.sendCommand('rescan_storage');
  public restartDaemon = () => this.sendCommand('restart_daemon');
  public resetDatabaseCache = () => this.sendCommand('reset_database_cache');
  public factoryReset = () => this.sendCommand('factory_reset');
  public ejectOpticalDisc = (device_path?: string) =>
    this.sendCommand('eject_optical_disc', device_path ? { device_path } : {});
  public scanOpticalDisc = (force_refresh = false, device_path?: string): Promise<OpticalDiscStatus> =>
    this.query<OpticalDiscStatus>('scan_optical_disc', {
      force_refresh,
      ...(device_path ? { device_path } : {}),
    });
  public shutdownDaemon = () => this.sendCommand('shutdown_daemon');

  // Apple Music Virtual Sink & Developer Token helpers
  public configureAppleMusic = (params: {
    team_id: string;
    key_id: string;
    private_key_path: string;
    developer_token?: string | null;
  }) => this.sendCommand('configure_apple_music', params);

  public setAppleMusicUserToken = (music_user_token: string) =>
    this.sendCommand('set_apple_music_user_token', { music_user_token });

  public disconnectAppleMusic = () => this.sendCommand('disconnect_apple_music');

  public importCatalogTracks = (params: {
    source: string;
    album?: AlbumRecord | null;
    playlist?: PlaylistRecord | null;
    tracks: TrackMetadata[];
  }) => this.sendCommand('import_catalog_tracks', params);

  public getAppleMusicAuthConfig = (): Promise<AppleMusicAuthConfig> =>
    this.query<AppleMusicAuthConfig>('get_apple_music_auth_config');

  // SoundCloud Native Sink & OAuth 2.1 helpers
  public configureSoundCloud = (params: {
    client_id: string;
    client_secret: string;
  }) => this.sendCommand('configure_soundcloud', params);

  public setSoundCloudTokens = (params: {
    access_token: string;
    refresh_token?: string;
    expires_at?: number;
    auth_mode?: string;
    username?: string;
  }) => this.sendCommand('set_soundcloud_tokens', params);

  public disconnectSoundCloud = () => this.sendCommand('disconnect_soundcloud');

  public getSoundCloudAuthConfig = (): Promise<SoundCloudAuthConfig> =>
    this.query<SoundCloudAuthConfig>('get_soundcloud_auth_config');

  // Internet Archive Free Digital Library Card & IAS3 helpers
  public configureInternetArchive = (params: {
    enabled: boolean;
    username?: string;
    access_key?: string;
    secret_key?: string;
  }) =>
    this.sendCommand('configure_internet_archive', {
      enabled: params.enabled,
      username: params.username ?? '',
      access_key: params.access_key ?? '',
      secret_key: params.secret_key ?? '',
    });

  public disconnectInternetArchive = () => this.sendCommand('disconnect_internet_archive');

  public getInternetArchiveConfig = (): Promise<InternetArchiveConfig> =>
    this.query<InternetArchiveConfig>('get_internet_archive_config');

  public reportAppleWorkerEvent = (
    state: 'playing' | 'paused' | 'ended' | 'time_update' | 'authorized' | 'worker_ready',
    position_ms: number,
    track?: TrackMetadata | null,
    duration_ms?: number | null
  ): void => {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        kind: 'apple_worker_event',
        state,
        position_ms: Math.max(0, Math.round(position_ms)),
        ...(track ? { track } : { track: null }),
        ...(duration_ms != null ? { duration_ms: Math.round(duration_ms) } : {}),
      })
    );
  };

  public subscribeAppleSink(fn: AppleSinkListener): () => void {
    this.appleSinkListeners.add(fn);
    return () => this.appleSinkListeners.delete(fn);
  }

  public subscribeState(fn: StateListener): () => void {
    this.stateListeners.add(fn);
    fn(this.state);
    return () => this.stateListeners.delete(fn);
  }

  public getState = (): SimpStateSnapshot => this.state;

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


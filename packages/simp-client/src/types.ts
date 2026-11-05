export type ActiveEngine = 'local' | 'apple_music' | 'none';
export type RepeatMode = 'off' | 'queue' | 'track';

export interface TrackMetadata {
  uri: string;
  title: string;
  artists: string[];
  album: string;
  album_id?: string | null;
  track_number?: number | null;
  disc_number?: number | null;
  art_url?: string | null;
  duration_ms: number;
  source: string;
  mount_root?: string | null;
}

export interface AlbumRecord {
  id: string;
  title: string;
  album_artist: string;
  release_year?: number | null;
  steam_app_id?: number | null;
  art_url?: string | null;
  track_count: number;
}

export interface PlaylistRecord {
  id: string;
  name: string;
  description: string;
  origin: string;
  cover_art_url?: string | null;
  track_count: number;
  updated_at: number;
}

export interface MountStatus {
  mount_root: string;
  label: string;
  mount_kind: string;
  is_online: boolean;
  track_count: number;
  last_scanned_at: number;
}

export interface PowerState {
  on_battery: boolean;
  battery_pct?: number | null;
}

export interface SimpStateSnapshot {
  active_engine: ActiveEngine;
  is_playing: boolean;
  position_ms: number;
  volume: number;
  shuffle: boolean;
  repeat_mode: RepeatMode;
  current_track: TrackMetadata | null;
  up_next: TrackMetadata[];
  queue_length: number;
  queue_index: number;
  mounts: MountStatus[];
  power: PowerState;
  apple_authenticated: boolean;
  brightness_pct?: number;
}

export interface AppleMusicAuthConfig {
  configured: boolean;
  team_id: string;
  key_id: string;
  private_key_path: string;
  has_private_key: boolean;
  developer_token: string | null;
  music_user_token: string | null;
  apple_authenticated: boolean;
  headless_worker_active?: boolean;
  lan_ip?: string | null;
  lan_ips?: string[];
  pair_url?: string | null;
  status_error: string | null;
}

export interface AppleSinkCommandPayload {
  action: 'load_and_play' | 'play' | 'pause' | 'seek' | 'set_volume' | 'unauthorize';
  uri?: string | null;
  position_ms?: number | null;
  volume?: number | null;
}

export interface OpticalDiscStatus {
  drive_present: boolean;
  device_path: string;
  disc_present: boolean;
  is_audio_cd: boolean;
  disc_id?: string | null;
  album_title: string;
  artist_name: string;
  release_year?: number | null;
  art_url?: string | null;
  tracks: TrackMetadata[];
  status_message: string;
}




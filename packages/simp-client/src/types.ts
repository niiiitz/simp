export type ActiveEngine = 'local' | 'spotify' | 'apple_music' | 'none';
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
  spotify_authenticated: boolean;
  apple_authenticated: boolean;
}


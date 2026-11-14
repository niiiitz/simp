export type ActiveEngine = 'local' | 'apple_music' | 'soundcloud' | 'internet_archive' | 'none';
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
  content_rating?: string | null;
}

export interface AlbumRecord {
  id: string;
  title: string;
  album_artist: string;
  release_year?: number | null;
  steam_app_id?: number | null;
  art_url?: string | null;
  track_count: number;
  content_rating?: string | null;
}

export interface PlaylistRecord {
  id: string;
  name: string;
  description: string;
  origin: string;
  cover_art_url?: string | null;
  track_count: number;
  updated_at: number;
  has_local?: boolean;
  has_apple?: boolean;
  has_soundcloud?: boolean;
  has_archive?: boolean;
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
  queue?: TrackMetadata[];
  queue_length: number;
  queue_index: number;
  mounts: MountStatus[];
  power: PowerState;
  apple_authenticated: boolean;
  soundcloud_authenticated?: boolean;
  internet_archive_authenticated?: boolean;
  brightness_pct?: number;
  daemon_version?: string;
}

export interface InternetArchiveConfig {
  enabled: boolean;
  internet_archive_authenticated: boolean;
  username: string;
  has_access_key: boolean;
  has_secret_key: boolean;
  safe_search?: boolean;
}

export interface VideoQualityVariant {
  label: string;
  format: string;
  stream_url: string;
  size_bytes?: number | null;
}

export interface VideoSubtitleVariant {
  id: string;
  lang_code: string;
  label: string;
  vtt_url: string;
}

export interface VideoEpisodeItem {
  episode_number: number;
  label: string;
  duration_ms: number;
  qualities: VideoQualityVariant[];
  subtitles: VideoSubtitleVariant[];
}

export interface ArchiveItemSummary {
  identifier: string;
  title: string;
  creator: string;
  mediatype: string;
  year?: number | null;
  description: string;
  art_url?: string | null;
  downloads: number;
  views_7d: number;
  views_30d: number;
  runtime_label?: string | null;
  item_count?: number | null;
  content_rating?: string | null;
}

export interface ArchiveItemDetail {
  summary: ArchiveItemSummary;
  episodes: VideoEpisodeItem[];
  tracks: TrackMetadata[];
}

export interface SoundCloudAuthConfig {
  configured: boolean;
  client_id: string;
  has_client_secret: boolean;
  soundcloud_authenticated: boolean;
  auth_mode: 'user' | 'client_credentials' | '';
  username: string;
  api_v2?: boolean;
  redirect_uri: string;
  lan_ip?: string | null;
  lan_ips?: string[];
  pair_url?: string | null;
  status_error: string | null;
}

export interface SoundCloudComment {
  id: string;
  body: string;
  timestamp_ms: number;
  username: string;
  avatar_url?: string | null;
  created_at?: string | null;
}

export interface AudioSpectrumFrame {
  rms: number;
  peak: number;
  onset: number;
  bands: number[];
  timestamp: number;
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

export interface DvdAudioTrack {
  stream_index: number;
  lang_code: string;
  lang_name: string;
  codec: string;
  channels: number;
  label: string;
}

export interface DvdSubtitleTrack {
  stream_index: number;
  lang_code: string;
  lang_name: string;
  label: string;
}

export interface DvdChapterInfo {
  chapter_number: number;
  start_ms: number;
  duration_ms: number;
}

export interface DvdTitleInfo {
  title_number: number;
  vts_number: number;
  vts_ttn: number;
  label: string;
  duration_ms: number;
  aspect_ratio: string;
  angles: number;
  chapters: DvdChapterInfo[];
  audio_tracks: DvdAudioTrack[];
  subtitle_tracks: DvdSubtitleTrack[];
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
  is_dvd_video?: boolean;
  dvd_css_available?: boolean;
  dvd_ffmpeg_available?: boolean;
  dvd_titles?: DvdTitleInfo[];
}




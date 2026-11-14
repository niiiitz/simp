import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArchiveItemDetail,
  defaultSimpClient,
  DvdTitleInfo,
  OpticalDiscStatus,
  SimpStateSnapshot,
  SoundCloudComment,
  TrackMetadata,
  VideoQualityVariant,
  VideoSubtitleVariant,
} from '@simp/client';
import { ProgressBarRaf } from '../components/ProgressBarRaf';
import {
  loadEnabledVisualizerScenes,
  PlayerBackgroundVisualizer,
  saveEnabledVisualizerScenes,
  VISUALIZER_ENGINES,
  VISUALIZER_MODES,
  type VisualizerEngine,
  type VisualizerMode,
} from '../components/PlayerBackgroundVisualizer';
import {
  VisualizerOverlayHud,
  type FactoidBubbleItem,
} from '../components/visualizers/VisualizerOverlayHud';
import { VisualizerDrawerModal } from '../components/visualizers/VisualizerDrawerModal';
import {
  DEFAULT_DSP_STATE,
  EqualizerModal,
  type DspConfigState,
} from '../components/EqualizerModal';
import {
  fetchSoundCloudTrackComments,
  fetchSoundCloudTrackWaveform,
  likeSoundCloudTrack,
  SoundCloudMixChapter,
  toggleFollowSoundCloudUser,
} from '../drivers/SoundCloudDriver';
import { SoundCloudAttributionLink, SoundCloudLogo } from '../components/SoundCloudLogo';
import { AppleMusicAttributionLink } from '../components/AppleMusicLogo';
import { fetchTrackLyrics, type TrackLyricsResponse } from '../drivers/appleApi';
import { ImpIcon } from '../components/icons/ImpIcon';
import { getSourceThemeForTrack, getSourceThemeCssVars } from '../theme/sourceTheme';

export interface BrowserTarget {
  kind:
    | 'album'
    | 'playlist'
    | 'mount'
    | 'cloud_playlist'
    | 'cloud_album'
    | 'soundcloud_playlist'
    | 'soundcloud_user'
    | 'ia_discover'
    | 'ia_item'
    | 'cdda';
  id: string;
  title?: string;
  subtitle?: string;
  art_url?: string | null;
}

export interface PlayerViewProps {
  hidden?: boolean;
  isPlayerIdle?: boolean;
  snap: SimpStateSnapshot | null;
  track: TrackMetadata | null | undefined;
  isPlaying: boolean;
  opticalDisc: OpticalDiscStatus | null;
  browserTarget: BrowserTarget | null;
  playingContextId: string;
  setBrowserTarget: React.Dispatch<React.SetStateAction<BrowserTarget | null>>;
  setBrowserTracks?: React.Dispatch<React.SetStateAction<TrackMetadata[]>>;
  setView: React.Dispatch<React.SetStateAction<'lock' | 'browser'>>;
  handleOpenFullAppleAlbum: (params: {
    albumId?: string | null;
    songUri?: string | null;
    fallbackTitle?: string;
  }) => Promise<void>;
  handleStartSoundCloudTrackRadio?: (seedTrack: TrackMetadata) => void;
  handleAddTracksToPlaylist?: (
    uris: string[],
    label: string,
    trackMetadata?: TrackMetadata[]
  ) => Promise<void>;
  handleFavoriteTrack?: (track: TrackMetadata) => Promise<void>;
  handleAddAppleToCloudLibrary?: (
    idOrUri: string,
    kind?: 'songs' | 'albums' | 'playlists',
    label?: string
  ) => Promise<void>;
  favoritedUris?: string[];
  handleMoreByArtist?: (
    artistName: string,
    preferredSource?: string,
    artistId?: string
  ) => void;
  applyFocusMarker?: (el: HTMLElement | null) => void;
  showToast?: (msg: string) => void;
}

interface ActiveCommentBubble {
  comment: SoundCloudComment;
  slot: 0 | 1;
  placement: 'above' | 'below';
  expiresAt: number;
}

const iaDetailMemoryCache = new Map<string, ArchiveItemDetail>();

export function isUiVideoTrack(track: TrackMetadata | null | undefined): boolean {
  if (!track) return false;
  return (
    track.source === 'ia_video' ||
    track.source === 'local_video' ||
    track.source === 'dvd' ||
    track.uri.startsWith('ia:video:') ||
    track.uri.startsWith('ia://video/') ||
    track.uri.startsWith('video://local/') ||
    track.uri.startsWith('dvd://')
  );
}

function formatCommentTs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '💬';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function computePlayerViewportScale(isVideo = false): number {
  if (typeof window === 'undefined') return 1;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (vw <= 1340 && vh <= 840) return 1;
  const baseWidth = isVideo ? 1160 : 1080;
  const scaleX = (vw - 192) / baseWidth;
  const scaleY = (vh - 210) / 520;
  const maxScale = isVideo ? 1.65 : 1.75;
  return Math.min(maxScale, Math.max(1, Math.min(scaleX, scaleY)));
}

export const PlayerView: React.FC<PlayerViewProps> = ({
  hidden = false,
  isPlayerIdle = false,
  snap,
  track,
  isPlaying,
  opticalDisc,
  browserTarget,
  playingContextId,
  setBrowserTarget,
  setBrowserTracks,
  setView,
  handleOpenFullAppleAlbum,
  handleStartSoundCloudTrackRadio,
  handleAddTracksToPlaylist,
  handleFavoriteTrack,
  handleAddAppleToCloudLibrary,
  favoritedUris = [],
  handleMoreByArtist,
  applyFocusMarker,
  showToast,
}) => {
  const isSoundCloudTrack = track?.source === 'soundcloud';
  const isVideoTrack = isUiVideoTrack(track);
  const isCurrentTrackFavorited = Boolean(track?.uri && favoritedUris.includes(track.uri));

  const [scCommentsEnabled, setScCommentsEnabled] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('simp_sc_comments_enabled') !== '0';
    } catch {
      return true;
    }
  });
  const [scComments, setScComments] = useState<SoundCloudComment[]>([]);
  const [scWaveformBars, setScWaveformBars] = useState<number[] | null>(null);
  const [scTrackBpm, setScTrackBpm] = useState<number | null>(null);
  const [scMixChapters, setScMixChapters] = useState<SoundCloudMixChapter[]>([]);
  const [scTrackUserId, setScTrackUserId] = useState<string | null>(null);
  const [scTrackPermalink, setScTrackPermalink] = useState<string | null>(null);
  const [scCreatorFollowed, setScCreatorFollowed] = useState<boolean>(false);
  const [vizMode, setVizMode] = useState<VisualizerMode>(() => {
    try {
      const saved = window.localStorage.getItem('simp.visualizer_mode') as VisualizerMode | null;
      if (saved && VISUALIZER_MODES.some((m) => m.id === saved)) {
        return saved;
      }
    } catch {}
    return 'cycle';
  });
  const [enabledVizScenes, setEnabledVizScenes] = useState<VisualizerEngine[]>(() =>
    loadEnabledVisualizerScenes(),
  );
  const [activeVizEngine, setActiveVizEngine] = useState<VisualizerEngine>('glyph');
  const [vizDrawerOpen, setVizDrawerOpen] = useState<boolean>(false);
  const [equalizerOpen, setEqualizerOpen] = useState<boolean>(false);
  const [dspState, setDspState] = useState<DspConfigState>(DEFAULT_DSP_STATE);
  const [factoidBubbles, setFactoidBubbles] = useState<FactoidBubbleItem[]>([]);
  const [trackPropsState, setTrackPropsState] = useState<{
    suppress_lyrics?: boolean;
    suppress_comments?: boolean;
    suppress_factoids?: boolean;
    preferred_viz_mode?: string | null;
  }>({});
  const [lyricsKaraokeEnabled, setLyricsKaraokeEnabled] = useState<boolean>(() => {
    try {
      const explicit = window.localStorage.getItem('simp_lyrics_karaoke_enabled');
      if (explicit !== null) return explicit !== '0';
      return window.localStorage.getItem('simp_lyrics_enabled') !== '0';
    } catch {
      return true;
    }
  });
  const [lyricsVizEnabled, setLyricsVizEnabled] = useState<boolean>(() => {
    try {
      const explicit = window.localStorage.getItem('simp_lyrics_viz_enabled');
      if (explicit !== null) return explicit !== '0';
      window.localStorage.setItem('simp_lyrics_viz_enabled', '1');
      return true;
    } catch {
      return true;
    }
  });
  const shouldFetchLyrics = lyricsKaraokeEnabled || lyricsVizEnabled;
  const [factoidsEnabled, setFactoidsEnabled] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('simp_factoids_enabled') === '1';
    } catch {
      return false;
    }
  });
  const [idleFadeEnabled, setIdleFadeEnabled] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('simp_idle_fade_enabled') !== '0';
    } catch {
      return true;
    }
  });
  const [idleOpacityPct, setIdleOpacityPct] = useState<number>(() => {
    try {
      const saved = window.localStorage.getItem('simp_idle_opacity_pct');
      if (saved !== null) {
        const parsed = Number(saved);
        if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 90) {
          return Math.round(parsed);
        }
      }
    } catch {}
    return 0;
  });
  const [lyricsData, setLyricsData] = useState<TrackLyricsResponse | null>(null);
  const [activeLyricIdx, setActiveLyricIdx] = useState<number>(-1);
  const activeLyricIdxRef = useRef<number>(-1);
  activeLyricIdxRef.current = activeLyricIdx;
  const lyricsDataRef = useRef<TrackLyricsResponse | null>(null);
  lyricsDataRef.current = lyricsData;
  const [rightColMode, setRightColMode] = useState<'queue' | 'chapters'>('queue');
  const [selectCategory, setSelectCategory] = useState<
    'track_options' | 'collection' | 'interface'
  >('track_options');
  const [activeBubbles, setActiveBubbles] = useState<ActiveCommentBubble[]>([]);
  const [playerActionsOpen, setPlayerActionsOpen] = useState<boolean>(false);
  const [playerScale, setPlayerScale] = useState<number>(() =>
    computePlayerViewportScale(isVideoTrack)
  );
  const mainRef = useRef<HTMLElement | null>(null);
  const artBoxRef = useRef<HTMLDivElement | null>(null);
  const scrubRowRef = useRef<HTMLDivElement | null>(null);
  const buttonsRowRef = useRef<HTMLDivElement | null>(null);
  const [scrubOffsetLeftPx, setScrubOffsetLeftPx] = useState<number | null>(null);
  const [buttonsOffsetLeftPx, setButtonsOffsetLeftPx] = useState<number | null>(null);
  const [buttonsFitScale, setButtonsFitScale] = useState<number | null>(null);
  const shownCommentIdsRef = useRef<Set<string>>(new Set());
  const lastPlayheadMsRef = useRef<number>(0);
  const nextCommentPlacementRef = useRef<'above' | 'below'>('above');

  // Unified Video Modality State (`ia_video`, `local_video`, `dvd`)
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoTheatreExpanded, setVideoTheatreExpanded] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() =>
    typeof document !== 'undefined' ? Boolean(document.fullscreenElement) : false
  );
  const [hudVisible, setHudVisible] = useState<boolean>(true);
  const hudTimerRef = useRef<number | null>(null);
  const lastTimeReportMsRef = useRef<number>(0);
  const pendingResumeTimeSecRef = useRef<number>(0);

  const [videoQualities, setVideoQualities] = useState<VideoQualityVariant[]>([]);
  const [selectedQualityIdx, setSelectedQualityIdx] = useState<number>(0);
  const [videoSubtitles, setVideoSubtitles] = useState<VideoSubtitleVariant[]>([]);
  const [selectedSubtitleIdx, setSelectedSubtitleIdx] = useState<number>(-1);
  const [resolvedSubtitleBlobUrl, setResolvedSubtitleBlobUrl] = useState<string | null>(null);
  const [videoErrorMsg, setVideoErrorMsg] = useState<string | null>(null);
  const [iaDetail, setIaDetail] = useState<ArchiveItemDetail | null>(null);
  const [dvdTitles, setDvdTitles] = useState<DvdTitleInfo[]>([]);
  const [dvdSeekOffsetSec, setDvdSeekOffsetSec] = useState<number>(0);

  useEffect(() => {
    setPlayerScale(computePlayerViewportScale(isVideoTrack));
    const onResize = () => setPlayerScale(computePlayerViewportScale(isVideoTrack));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [isVideoTrack]);

  // Adaptive Scrub Bar & 7-Button Control Array stepwise horizontal anchoring:
  // - Step 1 (Scrub Bar): When Artwork vertically overlaps the Scrub Bar band (`artRect.bottom + 14 * scale > scrubRect.top`),
  //   `scrubOffsetLeftPx` anchors the Scrub Bar's left edge relative to the Artwork's right border edge (`+ 28px`)
  //   while its right edge stays anchored at `right: 48px` (matching `NEXT:`). Otherwise `scrubOffsetLeftPx` is `null` (centered).
  // - Step 2 (7-Button Control Array): When Artwork continues down and vertically overlaps the 7-Button Control Array band
  //   (`artRect.bottom + 12 * scale > buttonsRect.top`), `buttonsOffsetLeftPx` steps the 7-button array to the exact same
  //   `[nextLeft, right: 48]` span so its horizontal center moves to match the center of the Scrub Bar.
  const recomputeScrubHorizontalAnchor = useCallback(() => {
    if (hidden || videoTheatreExpanded) {
      setScrubOffsetLeftPx(null);
      setButtonsOffsetLeftPx(null);
      setButtonsFitScale(null);
      return;
    }
    const mainEl = mainRef.current;
    const artEl = artBoxRef.current;
    const scrubEl = scrubRowRef.current;
    const buttonsEl = buttonsRowRef.current;
    if (!mainEl || !artEl || !scrubEl) return;

    const mainRect = mainEl.getBoundingClientRect();
    const artRect = artEl.getBoundingClientRect();
    const scrubRect = scrubEl.getBoundingClientRect();
    if (mainRect.width <= 0 || artRect.height <= 0 || scrubRect.height <= 0) return;

    const scale = !videoTheatreExpanded && playerScale > 1.02 ? playerScale : 1;
    const gapFromArtBorderPx = Math.round(28 * scale);
    const nextLeft = Math.max(48, Math.round(artRect.right - mainRect.left + gapFromArtBorderPx));

    // Step 1: Scrub bar collision check with Artwork (scrubRowRef is inside the scaled wrapper, so scrubRect.top is already the scaled visual top edge)
    const scrubClearancePx = Math.round(14 * scale);
    const scrubVisualTop = scrubRect.top;
    const scrubOverlapsVertically = artRect.bottom + scrubClearancePx > scrubVisualTop;

    if (scrubOverlapsVertically) {
      setScrubOffsetLeftPx((prev) => (prev === nextLeft ? prev : nextLeft));
    } else {
      setScrubOffsetLeftPx((prev) => (prev === null ? prev : null));
    }

    // Step 2: 7-Button Player Control Array collision check with Artwork (using scaled visual top edge)
    if (buttonsEl) {
      const buttonsRect = buttonsEl.getBoundingClientRect();
      const buttonsClearancePx = Math.round(12 * scale);
      const buttonsVisualTop = buttonsRect.bottom - buttonsRect.height * scale;
      const buttonsOverlapsVertically =
        buttonsRect.height > 0 && artRect.bottom + buttonsClearancePx > buttonsVisualTop;

      if (buttonsOverlapsVertically) {
        setButtonsOffsetLeftPx((prev) => (prev === nextLeft ? prev : nextLeft));
        const availableWidthPx = Math.max(260, mainRect.width - nextLeft - 48);
        const naturalButtonsWidthPx = 540;
        const maxFitScale = availableWidthPx / naturalButtonsWidthPx;
        const clampedScale = maxFitScale < scale ? Math.max(0.62, maxFitScale) : null;
        setButtonsFitScale((prev) => (prev === clampedScale ? prev : clampedScale));
      } else {
        setButtonsOffsetLeftPx((prev) => (prev === null ? prev : null));
        setButtonsFitScale((prev) => (prev === null ? prev : null));
      }
    }
  }, [hidden, videoTheatreExpanded, playerScale]);

  useLayoutEffect(() => {
    recomputeScrubHorizontalAnchor();
    const mainEl = mainRef.current;
    const artEl = artBoxRef.current;
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => recomputeScrubHorizontalAnchor())
        : null;
    if (ro && mainEl) ro.observe(mainEl);
    if (ro && artEl) ro.observe(artEl);
    window.addEventListener('resize', recomputeScrubHorizontalAnchor);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', recomputeScrubHorizontalAnchor);
    };
  }, [recomputeScrubHorizontalAnchor, isVideoTrack, track?.uri]);

  const togglePlayerFullscreen = useCallback(() => {
    if (isVideoTrack) {
      setVideoTheatreExpanded((prev) => {
        const next = !prev;
        if (next) {
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen?.().catch(() => {});
          }
        } else if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
        return next;
      });
    } else {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else {
        document.documentElement.requestFullscreen?.().catch(() => {});
      }
    }
  }, [isVideoTrack]);

  // Listen for `SELECT` button (`simp-player-actions-toggle`), `F`/`Alt+F`/`F11` (`simp-player-fullscreen-toggle`), and `fullscreenchange`
  useEffect(() => {
    const onToggleActions = () => {
      setPlayerActionsOpen((prev) => !prev);
    };
    const onToggleFullscreen = () => {
      togglePlayerFullscreen();
    };
    const onFullscreenChange = () => {
      const fs = Boolean(document.fullscreenElement);
      setIsFullscreen(fs);
      if (!fs) {
        setVideoTheatreExpanded(false);
      }
    };
    const onSelectCategoryFocus = (ev: Event) => {
      const cat = (ev as CustomEvent<{ category?: string }>).detail?.category;
      if (cat === 'track_options' || cat === 'collection' || cat === 'interface') {
        setSelectCategory(cat);
      }
    };
    window.addEventListener('simp-player-actions-toggle', onToggleActions);
    window.addEventListener('simp-player-fullscreen-toggle', onToggleFullscreen);
    window.addEventListener('simp-select-category-focus', onSelectCategoryFocus);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      window.removeEventListener('simp-player-actions-toggle', onToggleActions);
      window.removeEventListener('simp-player-fullscreen-toggle', onToggleFullscreen);
      window.removeEventListener('simp-select-category-focus', onSelectCategoryFocus);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, [togglePlayerFullscreen]);

  // 4-Second (`4000ms`) Floating Controls & Scrub Bar Auto-Hide Timer in Expanded Theatre Mode
  const wakeFloatingHud = useCallback(() => {
    setHudVisible(true);
    if (hudTimerRef.current) {
      window.clearTimeout(hudTimerRef.current);
      hudTimerRef.current = null;
    }
    if (videoTheatreExpanded && isPlaying && !playerActionsOpen) {
      hudTimerRef.current = window.setTimeout(() => {
        setHudVisible(false);
      }, 4000);
    }
  }, [videoTheatreExpanded, isPlaying, playerActionsOpen]);

  useEffect(() => {
    if (!videoTheatreExpanded || !isPlaying || playerActionsOpen) {
      setHudVisible(true);
      if (hudTimerRef.current) {
        window.clearTimeout(hudTimerRef.current);
        hudTimerRef.current = null;
      }
      return;
    }
    wakeFloatingHud();
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'];
    events.forEach((ev) => window.addEventListener(ev, wakeFloatingHud, { passive: true }));

    // Also poll gamepad buttons/axes lightly while in Expanded Theatre so D-pad/stick wakes the HUD
    let lastGpSignature = '';
    const gpPoll = window.setInterval(() => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const p of pads) {
        if (!p) continue;
        const pressed = p.buttons.map((b) => (b.pressed ? '1' : '0')).join('');
        const axes = p.axes.map((a) => (Math.abs(a) > 0.35 ? a.toFixed(1) : '0')).join(',');
        const sig = `${pressed}|${axes}`;
        if (lastGpSignature && sig !== lastGpSignature) {
          wakeFloatingHud();
        }
        lastGpSignature = sig;
        break;
      }
    }, 150);

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, wakeFloatingHud));
      window.clearInterval(gpPoll);
      if (hudTimerRef.current) {
        window.clearTimeout(hudTimerRef.current);
        hudTimerRef.current = null;
      }
    };
  }, [videoTheatreExpanded, isPlaying, playerActionsOpen, wakeFloatingHud]);

  // Allow `B` / `Escape` to exit Expanded Theatre back to Card View when Track Actions modal is closed
  useEffect(() => {
    if (!videoTheatreExpanded || playerActionsOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        setVideoTheatreExpanded(false);
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [videoTheatreExpanded, playerActionsOpen]);

  // Resolve video stream qualities, subtitles, and metadata when `track.uri` changes
  useEffect(() => {
    setVideoErrorMsg(null);
    setSelectedQualityIdx(0);
    setSelectedSubtitleIdx(-1);
    setDvdSeekOffsetSec(0);
    pendingResumeTimeSecRef.current = 0;

    if (!isVideoTrack || !track?.uri) {
      setVideoQualities([]);
      setVideoSubtitles([]);
      setIaDetail(null);
      setDvdTitles([]);
      setVideoTheatreExpanded(false);
      return;
    }

    let cancelled = false;
    const uri = track.uri;

    if (uri.startsWith('ia:video:') || uri.startsWith('ia://video/')) {
      const cleaned = uri.replace(/^ia:video:/, '').replace(/^ia:\/\/video\//, '');
      const parts = cleaned.split('/');
      const identifier = decodeURIComponent(parts[0] || '');
      const epIdx = Math.max(0, parseInt(parts[1] || '0', 10) || 0);

      const applyDetail = (detail: ArchiveItemDetail) => {
        if (cancelled) return;
        setIaDetail(detail);
        const ep = detail.episodes[epIdx] || detail.episodes[0];
        if (ep) {
          setVideoQualities(ep.qualities || []);
          setVideoSubtitles(ep.subtitles || []);
        } else {
          setVideoQualities([]);
          setVideoSubtitles([]);
        }
      };

      const cached = iaDetailMemoryCache.get(identifier);
      if (cached) {
        applyDetail(cached);
      } else {
        fetch(`/api/ia/item?id=${encodeURIComponent(identifier)}`)
          .then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
          })
          .then((d) => {
            const detail: ArchiveItemDetail | undefined = d?.detail || d?.data;
            if (!detail) throw new Error(d?.error || 'Missing detail');
            iaDetailMemoryCache.set(identifier, detail);
            applyDetail(detail);
          })
          .catch((err) => {
            if (!cancelled) {
              setVideoErrorMsg(`Failed to load Internet Archive video metadata: ${err}`);
            }
          });
      }
    } else if (uri.startsWith('video://local/')) {
      const rawPath = decodeURIComponent(uri.replace(/^video:\/\/local\//, ''));
      setVideoQualities([
        {
          label: 'Direct Play (Original)',
          format: 'mp4',
          stream_url: `/api/video/local?path=${encodeURIComponent(rawPath)}`,
          size_bytes: null,
        },
        {
          label: 'Compatibility MP4 (ffmpeg)',
          format: 'mp4',
          stream_url: `/api/video/local?path=${encodeURIComponent(rawPath)}&transcode=1`,
          size_bytes: null,
        },
      ]);
      setVideoSubtitles([]);
    } else if (uri.startsWith('dvd://')) {
      // Format: `dvd:///dev/sr0/1` or `dvd:///dev/sr0`
      const withoutScheme = uri.replace(/^dvd:\/\//, '');
      const lastSlash = withoutScheme.lastIndexOf('/');
      let devicePath = opticalDisc?.device_path || '/dev/sr0';
      let titleNum = 1;
      if (lastSlash > 0 && /^\d+$/.test(withoutScheme.slice(lastSlash + 1))) {
        devicePath = withoutScheme.slice(0, lastSlash);
        titleNum = parseInt(withoutScheme.slice(lastSlash + 1), 10) || 1;
      } else if (withoutScheme) {
        devicePath = withoutScheme;
      }
      const titles = opticalDisc?.dvd_titles || [];
      setDvdTitles(titles);
      const chosenTitle =
        titles.find((t: DvdTitleInfo) => t.title_number === titleNum) || titles[0];
      const tNum = chosenTitle?.title_number || titleNum;
      const audioVariants: VideoQualityVariant[] =
        chosenTitle && chosenTitle.audio_tracks.length > 0
          ? chosenTitle.audio_tracks.map((a, idx) => ({
              label: `Audio ${idx + 1}: ${a.lang_name || a.lang_code.toUpperCase()} (${a.codec.toUpperCase()} ${a.channels}ch)`,
              format: 'mp4',
              stream_url: `/api/dvd/stream?device=${encodeURIComponent(devicePath)}&title=${tNum}&audio=${a.stream_index ?? idx}`,
              size_bytes: null,
            }))
          : [
              {
                label: 'DVD Main Audio (MP4 Stream)',
                format: 'mp4',
                stream_url: `/api/dvd/stream?device=${encodeURIComponent(devicePath)}&title=${tNum}&audio=0`,
                size_bytes: null,
              },
            ];
      setVideoQualities(audioVariants);
      setVideoSubtitles([]);
    }

    return () => {
      cancelled = true;
    };
  }, [isVideoTrack, track?.uri, opticalDisc?.device_path, opticalDisc?.dvd_titles]);

  // Load selected `.vtt` subtitle track into a same-origin Blob URL so `<video>` never needs `crossOrigin="anonymous"`
  const activeSubtitle =
    selectedSubtitleIdx >= 0 && selectedSubtitleIdx < videoSubtitles.length
      ? videoSubtitles[selectedSubtitleIdx]
      : null;

  useEffect(() => {
    let activeBlobUrl: string | null = null;
    let cancelled = false;

    if (!activeSubtitle?.vtt_url) {
      setResolvedSubtitleBlobUrl(null);
      return;
    }

    fetch(activeSubtitle.vtt_url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((vttText) => {
        if (cancelled) return;
        const blob = new Blob([vttText], { type: 'text/vtt;charset=utf-8' });
        activeBlobUrl = URL.createObjectURL(blob);
        setResolvedSubtitleBlobUrl(activeBlobUrl);
      })
      .catch(() => {
        if (!cancelled) setResolvedSubtitleBlobUrl(null);
      });

    return () => {
      cancelled = true;
      if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
    };
  }, [activeSubtitle?.vtt_url]);

  // Compute active video stream URL
  const activeQuality = videoQualities[selectedQualityIdx] || videoQualities[0] || null;
  const activeStreamUrl = useMemo(() => {
    if (!activeQuality) return '';
    if (track?.uri?.startsWith('dvd://') && dvdSeekOffsetSec > 0) {
      return `${activeQuality.stream_url}&seek_ms=${Math.round(dvdSeekOffsetSec * 1000)}`;
    }
    return activeQuality.stream_url;
  }, [activeQuality, track?.uri, dvdSeekOffsetSec]);

  // Sync `isPlaying` and `snap.volume` from Orchestrator to `<video>`
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !isVideoTrack || !activeStreamUrl) return;
    if (typeof snap?.volume === 'number') {
      vid.volume = Math.max(0, Math.min(1, snap.volume));
    }
    if (isPlaying) {
      if (vid.paused) {
        vid.play().catch(() => {});
      }
    } else {
      if (!vid.paused) {
        vid.pause();
      }
    }
  }, [isPlaying, snap?.volume, isVideoTrack, activeStreamUrl]);

  // Listen for `AppleSinkCommand` (`action === 'seek'`) from Orchestrator so scrub bar & L2/R2 seek `<video>`
  useEffect(() => {
    if (!isVideoTrack) return;
    const unsub = defaultSimpClient.subscribeAppleSink((cmd) => {
      if (cmd.action === 'seek' && typeof cmd.position_ms === 'number') {
        const targetSec = cmd.position_ms / 1000;
        if (track?.uri?.startsWith('dvd://')) {
          setDvdSeekOffsetSec(targetSec);
        } else if (videoRef.current) {
          videoRef.current.currentTime = targetSec;
        }
      }
    });
    return unsub;
  }, [isVideoTrack, track?.uri]);

  const cycleVideoQuality = useCallback(() => {
    if (videoQualities.length <= 1) {
      showToast?.(
        videoQualities.length === 1
          ? `🎞️ Only 1 stream format available (${videoQualities[0].label})`
          : '🎞️ No alternative stream formats available'
      );
      return;
    }
    if (videoRef.current) {
      pendingResumeTimeSecRef.current = videoRef.current.currentTime || 0;
    }
    const nextIdx = (selectedQualityIdx + 1) % videoQualities.length;
    setSelectedQualityIdx(nextIdx);
    setVideoErrorMsg(null);
    showToast?.(`🎞️ Stream Quality: ${videoQualities[nextIdx].label}`);
  }, [videoQualities, selectedQualityIdx, showToast]);

  const cycleVideoSubtitles = useCallback(() => {
    if (videoSubtitles.length === 0) {
      showToast?.('💬 No subtitle tracks available for this video');
      return;
    }
    const nextIdx = selectedSubtitleIdx + 1 >= videoSubtitles.length ? -1 : selectedSubtitleIdx + 1;
    setSelectedSubtitleIdx(nextIdx);
    showToast?.(
      nextIdx === -1 ? '💬 Subtitles: Off' : `💬 Subtitles: ${videoSubtitles[nextIdx].label}`
    );
  }, [videoSubtitles, selectedSubtitleIdx, showToast]);

  const toggleTheatreFullscreen = useCallback(() => {
    setVideoTheatreExpanded((prev) => {
      const next = !prev;
      if (!next && document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      return next;
    });
    setPlayerActionsOpen(false);
  }, []);

  // Focus active item in Left Column when Player Track Actions Overlay opens
  useEffect(() => {
    if (!playerActionsOpen) return;
    window.dispatchEvent(new CustomEvent('simp-wake-idle'));
    const t = window.setTimeout(() => {
      const firstBtn =
        document.querySelector<HTMLElement>(
          '[data-player-actions-modal="true"] [data-player-actions-col="left"] button[data-select-active="true"]:not([disabled])'
        ) ||
        document.querySelector<HTMLElement>(
          '[data-player-actions-modal="true"] [data-player-actions-col="left"] button[data-default-focus="true"]:not([disabled])'
        ) ||
        document.querySelector<HTMLElement>(
          '[data-player-actions-modal="true"] button:not([disabled])'
        );
      if (firstBtn && applyFocusMarker) {
        applyFocusMarker(firstBtn);
      }
    }, 30);
    return () => window.clearTimeout(t);
  }, [playerActionsOpen, applyFocusMarker]);

  // Scroll active queue item into view whenever the `collection` shelf is exposed
  useEffect(() => {
    if (!playerActionsOpen || selectCategory !== 'collection') return;
    const t = window.setTimeout(() => {
      const currentQueueEl = document.querySelector<HTMLElement>(
        '[data-player-actions-modal="true"] [data-queue-current="true"]'
      );
      if (currentQueueEl) {
        currentQueueEl.scrollIntoView({ block: 'center', inline: 'nearest' });
      }
    }, 25);
    return () => window.clearTimeout(t);
  }, [playerActionsOpen, selectCategory, rightColMode]);

  const handleSelectVizMode = useCallback(
    (nextMode: VisualizerMode) => {
      setVizMode(nextMode);
      try {
        window.localStorage.setItem('simp.visualizer_mode', nextMode);
      } catch {}
      const found = VISUALIZER_MODES.find((m) => m.id === nextMode);
      if (found) {
        showToast?.(`Visualizer: ${found.label}`);
      }
    },
    [showToast],
  );

  const handleToggleSceneInRotation = useCallback((engine: VisualizerEngine) => {
    setEnabledVizScenes((prev) => {
      const exists = prev.includes(engine);
      if (exists && prev.length <= 1) {
        return prev;
      }
      const next = exists ? prev.filter((e) => e !== engine) : [...prev, engine];
      saveEnabledVisualizerScenes(next);
      return next;
    });
  }, []);

  const handleSetAllScenesInRotation = useCallback((engines: VisualizerEngine[]) => {
    const next = engines.length > 0 ? engines : [...VISUALIZER_ENGINES];
    setEnabledVizScenes(next);
    saveEnabledVisualizerScenes(next);
  }, []);

  const toggleLyricsKaraoke = useCallback(() => {
    setLyricsKaraokeEnabled((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('simp_lyrics_karaoke_enabled', next ? '1' : '0');
      } catch {}
      showToast?.(
        next ? 'Karaoke / Foreground Lyrics: ON' : 'Karaoke / Foreground Lyrics: OFF'
      );
      return next;
    });
  }, [showToast]);

  const toggleLyricsViz = useCallback(() => {
    setLyricsVizEnabled((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('simp_lyrics_viz_enabled', next ? '1' : '0');
      } catch {}
      showToast?.(
        next
          ? 'Visualizer Lyrics Data Element: ON'
          : 'Visualizer Lyrics Data Element: OFF'
      );
      return next;
    });
  }, [showToast]);

  const handleUpdateDsp = useCallback(
    (patch: Partial<DspConfigState>) => {
      setDspState((prev) => {
        const next: DspConfigState = { ...prev, ...patch };
        fetch('http://127.0.0.1:18888/api/dsp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
          .then((r) => r.json())
          .then((res) => {
            if (res?.ok && res?.data) {
              setDspState(res.data as DspConfigState);
            }
          })
          .catch(() => {});
        return next;
      });
    },
    []
  );

  const handleToggleKaraokeMode = useCallback(
    (enable: boolean) => {
      if (enable) {
        setLyricsKaraokeEnabled(true);
        try {
          window.localStorage.setItem('simp_lyrics_karaoke_enabled', '1');
        } catch {}
        handleUpdateDsp({ vocal_mode: 'vocal_remover' });
        showToast?.('Karaoke Mode ON (Vocal Remover + Synced Lyrics)');
      } else {
        handleUpdateDsp({ vocal_mode: 'off' });
        showToast?.('Karaoke Vocal Remover OFF');
      }
    },
    [handleUpdateDsp, showToast]
  );

  useEffect(() => {
    fetch('http://127.0.0.1:18888/api/dsp')
      .then((r) => r.json())
      .then((res) => {
        if (res?.ok && res?.data) {
          setDspState(res.data as DspConfigState);
        }
      })
      .catch(() => {});

    const onEngageKaraoke = () => {
      handleToggleKaraokeMode(true);
    };
    const onOpenEqualizer = () => {
      setEqualizerOpen(true);
    };
    window.addEventListener('simp-engage-karaoke-mode', onEngageKaraoke);
    window.addEventListener('simp-open-equalizer', onOpenEqualizer);
    return () => {
      window.removeEventListener('simp-engage-karaoke-mode', onEngageKaraoke);
      window.removeEventListener('simp-open-equalizer', onOpenEqualizer);
    };
  }, [handleToggleKaraokeMode]);

  const toggleFactoids = useCallback(() => {
    setFactoidsEnabled((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('simp_factoids_enabled', next ? '1' : '0');
      } catch {}
      showToast?.(next ? '💬 Pop-Up Factoid bubbles ON' : '💬 Pop-Up Factoid bubbles OFF');
      return next;
    });
  }, [showToast]);

  const toggleIdleFade = useCallback(() => {
    setIdleFadeEnabled((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('simp_idle_fade_enabled', next ? '1' : '0');
      } catch {}
      showToast?.(
        next
          ? `✨ Idle Controls Auto-Fade ON (${idleOpacityPct}% opacity)`
          : '✨ Idle Controls Auto-Fade OFF (100% opacity)'
      );
      return next;
    });
  }, [idleOpacityPct, showToast]);

  const updateIdleOpacityPct = useCallback((nextPct: number) => {
    const clamped = Math.max(0, Math.min(90, Math.round(nextPct / 5) * 5));
    setIdleOpacityPct(clamped);
    try {
      window.localStorage.setItem('simp_idle_opacity_pct', String(clamped));
    } catch {}
  }, []);

  const toggleScComments = useCallback(() => {
    setScCommentsEnabled((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('simp_sc_comments_enabled', next ? '1' : '0');
      } catch {}
      if (!next) {
        setActiveBubbles([]);
      }
      showToast?.(
        next ? '💬 SoundCloud timed comment bubbles ON' : '💬 SoundCloud timed comment bubbles OFF'
      );
      return next;
    });
  }, [showToast]);

  // Fetch synced lyrics from LRCLIB (v1 + v2 beta) or local .lrc sidecar on track change,
  // skipping network/DB retrieval completely when both Karaoke Lyrics and Visualizer Lyrics are disabled.
  const loadLyricsForCurrentTrack = useCallback(() => {
    if (!shouldFetchLyrics || !track?.uri || !track?.title || isVideoTrack) {
      setLyricsData(null);
      return () => {};
    }
    let cancelled = false;
    fetchTrackLyrics({
      uri: track.uri,
      title: track.title,
      artist: track.artists?.[0] || '',
      album: track.album || '',
      duration_ms: track.duration_ms || 0,
    })
      .then((res) => {
        if (!cancelled) {
          if (res && res.source !== 'none' && res.source !== 'suppressed') {
            setLyricsData(res);
          } else {
            setLyricsData(null);
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [
    shouldFetchLyrics,
    track?.uri,
    track?.title,
    track?.artists,
    track?.album,
    track?.duration_ms,
    isVideoTrack,
  ]);

  useEffect(() => {
    setLyricsData(null);
    setActiveLyricIdx(-1);
    activeLyricIdxRef.current = -1;
    return loadLyricsForCurrentTrack();
  }, [loadLyricsForCurrentTrack]);

  // Fetch per-track properties (suppression flags, preferred_viz_mode) and Pop-Up Video Factoids (factoids.rs)
  const loadFactoidsAndPropsForCurrentTrack = useCallback(() => {
    setTrackPropsState({});
    setFactoidBubbles([]);
    if (!track?.uri || !track?.title || isVideoTrack) {
      return () => {};
    }
    let cancelled = false;
    fetch(`/api/library/track-properties?uri=${encodeURIComponent(track.uri)}`)
      .then((r) => r.json())
      .then((res) => {
        if (!cancelled && res && res.ok && res.data) {
          setTrackPropsState(res.data);
        }
      })
      .catch(() => {});

    if (factoidsEnabled) {
      const params = new URLSearchParams({
        uri: track.uri,
        title: track.title,
        artist: track.artists?.[0] || '',
        album: track.album || '',
        duration_ms: String(track.duration_ms || 180000),
      });
      fetch(`/api/factoids?${params.toString()}`)
        .then((r) => r.json())
        .then((res) => {
          if (!cancelled && res && res.ok && res.data && Array.isArray(res.data.bubbles)) {
            setFactoidBubbles(res.data.bubbles);
          } else if (!cancelled) {
            setFactoidBubbles([]);
          }
        })
        .catch(() => {
          if (!cancelled) setFactoidBubbles([]);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [
    track?.uri,
    track?.title,
    track?.artists,
    track?.album,
    track?.duration_ms,
    isVideoTrack,
    factoidsEnabled,
  ]);

  useEffect(() => {
    return loadFactoidsAndPropsForCurrentTrack();
  }, [loadFactoidsAndPropsForCurrentTrack]);

  useEffect(() => {
    const onPropsUpdated = (ev: Event) => {
      const detail = (ev as CustomEvent).detail;
      if (!detail || !track?.uri || detail.uri !== track.uri) return;
      if (detail.properties) {
        setTrackPropsState(detail.properties);
      }
      if (detail.properties?.suppress_comments) {
        setActiveBubbles([]);
      }
      if (detail.properties?.suppress_factoids) {
        setFactoidBubbles([]);
      } else {
        loadFactoidsAndPropsForCurrentTrack();
      }
      if (detail.lyrics) {
        if (detail.lyrics.found && !detail.properties?.suppress_lyrics) {
          setLyricsData(detail.lyrics);
        } else {
          setLyricsData(null);
        }
      } else {
        loadLyricsForCurrentTrack();
      }
    };
    window.addEventListener('simp-track-properties-updated', onPropsUpdated);
    return () => window.removeEventListener('simp-track-properties-updated', onPropsUpdated);
  }, [track?.uri, loadLyricsForCurrentTrack, loadFactoidsAndPropsForCurrentTrack]);

  useEffect(() => {
    shownCommentIdsRef.current.clear();
    setActiveBubbles([]);
    lastPlayheadMsRef.current = 0;

    if (!track?.uri || isVideoTrack) {
      setScComments([]);
      setScWaveformBars(null);
      setScTrackBpm(null);
      setScMixChapters([]);
      setScTrackUserId(null);
      setScCreatorFollowed(false);
      setRightColMode('queue');
      return;
    }

    let cancelled = false;

    if (!isSoundCloudTrack) {
      setScComments([]);
      setScTrackBpm(null);
      setScMixChapters([]);
      setScTrackUserId(null);
      setScTrackPermalink(null);
      setScCreatorFollowed(false);
      setRightColMode('queue');

      fetch(`/api/audio/waveform?uri=${encodeURIComponent(track.uri)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!cancelled) {
            const bars = d?.data?.bars;
            setScWaveformBars(Array.isArray(bars) && bars.length > 0 ? bars : null);
          }
        })
        .catch(() => {
          if (!cancelled) setScWaveformBars(null);
        });

      return () => {
        cancelled = true;
      };
    }

    fetchSoundCloudTrackComments(track.uri)
      .then((comments) => {
        if (!cancelled) {
          setScComments(comments);
        }
      })
      .catch(() => {});

    fetchSoundCloudTrackWaveform(track.uri)
      .then((wf) => {
        if (!cancelled) {
          setScWaveformBars(wf?.bars || null);
          setScTrackBpm(typeof wf?.bpm === 'number' && wf.bpm > 0 ? wf.bpm : null);
          const chapters = wf?.chapters || [];
          setScMixChapters(chapters);
          setScTrackUserId(wf?.user_id || null);
          setScTrackPermalink(wf?.permalink_url || null);
          setScCreatorFollowed(false);
          setRightColMode(chapters.length > 0 ? 'chapters' : 'queue');
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [isSoundCloudTrack, isVideoTrack, track?.uri]);

  // Periodically prune expired comment speech bubbles
  useEffect(() => {
    if (activeBubbles.length === 0) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setActiveBubbles((prev) => {
        const filtered = prev.filter((b) => b.expiresAt > now);
        return filtered.length === prev.length ? prev : filtered;
      });
    }, 500);
    return () => window.clearInterval(timer);
  }, [activeBubbles.length]);

  const commentTimestampsMs = useMemo(
    () =>
      scComments
        .map((c) => c.timestamp_ms)
        .filter((ts): ts is number => typeof ts === 'number' && ts >= 0),
    [scComments]
  );

  const handlePlayheadTick = useCallback(
    (currentMs: number) => {
      // 1. Update active synced lyric line via fast binary search
      const lrcLines = lyricsDataRef.current?.synced_lines;
      if (lrcLines && lrcLines.length > 0) {
        const targetMs = currentMs + 180;
        let lo = 0;
        let hi = lrcLines.length - 1;
        let foundIdx = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >>> 1;
          if (lrcLines[mid].timestamp_ms <= targetMs) {
            foundIdx = mid;
            lo = mid + 1;
          } else {
            hi = mid - 1;
          }
        }
        if (foundIdx !== activeLyricIdxRef.current) {
          activeLyricIdxRef.current = foundIdx;
          setActiveLyricIdx(foundIdx);
        }
      }

      // 2. Update SoundCloud timed comment bubbles
      if (!isSoundCloudTrack || !scCommentsEnabled || scComments.length === 0) return;

      // Reset shown IDs if user seeked backward or track looped
      if (currentMs + 2500 < lastPlayheadMsRef.current) {
        shownCommentIdsRef.current.clear();
      }
      lastPlayheadMsRef.current = currentMs;

      const durMs = Math.max(track?.duration_ms || 180_000, 30_000);
      const match = scComments.find((c, idx) => {
        if (shownCommentIdsRef.current.has(c.id)) return false;
        const effectiveTs =
          c.timestamp_ms !== null && c.timestamp_ms > 0
            ? c.timestamp_ms
            : Math.round(((idx + 1) / (scComments.length + 1)) * durMs);
        return currentMs >= effectiveTs - 350 && currentMs <= effectiveTs + 1850;
      });

      if (!match) return;
      shownCommentIdsRef.current.add(match.id);

      const now = Date.now();
      setActiveBubbles((prev) => {
        const alive = prev.filter((b) => b.expiresAt > now);
        if (alive.length >= 2) return alive;
        const usedSlot0 = alive.some((b) => b.slot === 0);
        const slot: 0 | 1 = usedSlot0 ? 1 : 0;
        let placement: 'above' | 'below';
        if (alive.length === 1) {
          placement = alive[0].placement === 'above' ? 'below' : 'above';
        } else {
          placement = nextCommentPlacementRef.current;
        }
        nextCommentPlacementRef.current = placement === 'above' ? 'below' : 'above';
        return [...alive, { comment: match, slot, placement, expiresAt: now + 5000 }];
      });
    },
    [isSoundCloudTrack, scCommentsEnabled, scComments, track?.duration_ms]
  );

  const handleOpenCurrentCollection = useCallback(() => {
    setPlayerActionsOpen(false);
    setVideoTheatreExpanded(false);
    const notifyOpenCollection = () => {
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('simp-open-collection-in-library'));
      }, 0);
    };

    if (playingContextId) {
      const sep = playingContextId.indexOf(':');
      if (sep > 0) {
        const ctxKind = playingContextId.slice(0, sep);
        const ctxId = playingContextId.slice(sep + 1);
        if (
          ctxKind === 'playlist' ||
          ctxKind === 'album' ||
          ctxKind === 'mount' ||
          ctxKind === 'cdda' ||
          ctxKind === 'cloud_playlist' ||
          ctxKind === 'cloud_album' ||
          ctxKind === 'soundcloud_playlist' ||
          ctxKind === 'ia_item'
        ) {
          if (
            (ctxKind === 'cloud_playlist' ||
              ctxKind === 'cloud_album' ||
              ctxKind === 'soundcloud_playlist') &&
            snap?.queue &&
            snap.queue.length > 0 &&
            setBrowserTracks
          ) {
            setBrowserTracks(snap.queue);
          }
          setBrowserTarget((prev) =>
            prev && prev.kind === ctxKind && prev.id === ctxId
              ? { ...prev }
              : {
                  kind: ctxKind,
                  id: ctxId,
                  title: track?.album || track?.title,
                  subtitle: track?.artists?.join(', '),
                  art_url: track?.art_url,
                }
          );
          setView('browser');
          notifyOpenCollection();
          return;
        }
      }
    }
    if (track?.source === 'internet_archive' || track?.source === 'ia_video') {
      const rawId =
        track.album_id?.replace(/^ia:/, '') ||
        track.uri
          .replace(/^ia:audio:/, '')
          .replace(/^ia:video:/, '')
          .split('/')[0];
      if (rawId) {
        setBrowserTarget({
          kind: 'ia_item',
          id: rawId,
          title: track.album || track.title,
          subtitle: track.artists?.join(', '),
          art_url: track.art_url,
        });
        setView('browser');
        notifyOpenCollection();
        return;
      }
    }
    if (track?.source === 'apple_music') {
      handleOpenFullAppleAlbum({
        albumId: track.album_id?.replace(/^applemusic:album:/, '') || undefined,
        songUri: track.uri,
        fallbackTitle: track.album || track.title,
      });
      return;
    }
    if (track?.source === 'cdda' || track?.source === 'dvd') {
      setBrowserTarget({
        kind: 'cdda',
        id: opticalDisc?.disc_id || opticalDisc?.device_path || '/dev/sr0',
        title: `💿 ${opticalDisc?.album_title || track.album || 'Optical Disc'}`,
        subtitle: opticalDisc?.artist_name || track.artists?.join(', ') || 'Optical Disc',
        art_url: opticalDisc?.art_url || track.art_url,
      });
      setView('browser');
      notifyOpenCollection();
      return;
    }
    if (track?.album_id) {
      setBrowserTarget({
        kind: 'album',
        id: track.album_id,
        title: track.album || track.title,
        subtitle: track.artists?.join(', '),
        art_url: track.art_url,
      });
      setView('browser');
      notifyOpenCollection();
      return;
    }
    if (snap?.queue && snap.queue.length > 0 && setBrowserTracks) {
      setBrowserTracks(snap.queue);
      setBrowserTarget({
        kind: 'soundcloud_playlist',
        id: 'active_queue',
        title:
          track?.album ||
          (track?.source === 'soundcloud'
            ? '☁️ Active SoundCloud Queue'
            : '🎵 Active Playback Queue'),
        subtitle: track?.artists?.join(', ') || `${snap.queue.length} tracks in queue`,
        art_url: track?.art_url || null,
      });
      setView('browser');
      notifyOpenCollection();
      return;
    }
    setView('browser');
    notifyOpenCollection();
  }, [
    playingContextId,
    track,
    snap?.queue,
    opticalDisc,
    setBrowserTarget,
    setBrowserTracks,
    setView,
    handleOpenFullAppleAlbum,
  ]);

  const primaryArtist = track?.artists?.[0]?.trim() || '';

  // Build unified Queue / Episodes / DVD Titles / SoundCloud DJ Mix Chapters list for the right column of the SELECT modal
  const chapterModalItems = useMemo(() => {
    if (!isSoundCloudTrack || scMixChapters.length === 0) return [];
    const posMs = snap?.position_ms ?? 0;
    return scMixChapters.map((ch, idx) => {
      const nextTs = scMixChapters[idx + 1]?.timestamp_ms ?? Infinity;
      const isCurrent = posMs >= ch.timestamp_ms && posMs < nextTs;
      return {
        key: `chapter:${idx}:${ch.timestamp_ms}`,
        index: idx,
        title: ch.label,
        subtitle: `Jump to ${formatCommentTs(ch.timestamp_ms)}`,
        durationMs: ch.timestamp_ms,
        badgeLabel: formatCommentTs(ch.timestamp_ms),
        isCurrent,
        onSelect: () => {
          setPlayerActionsOpen(false);
          defaultSimpClient.seek(ch.timestamp_ms);
          showToast?.(`⏭ Seeking to ${formatCommentTs(ch.timestamp_ms)} — ${ch.label}`);
        },
      };
    });
  }, [isSoundCloudTrack, scMixChapters, snap?.position_ms, showToast]);

  const queueModalItems = useMemo(() => {
    if (snap?.queue && snap.queue.length > 1) {
      return snap.queue.map((qt, idx) => ({
        key: `${idx}:${qt.uri}`,
        index: idx,
        title: qt.title || `Track ${idx + 1}`,
        subtitle: qt.artists?.join(', ') || qt.album || '',
        durationMs: qt.duration_ms || 0,
        badgeLabel: `#${idx + 1}`,
        isCurrent: idx === (snap.queue_index ?? 0),
        onSelect: () => {
          setPlayerActionsOpen(false);
          defaultSimpClient.loadQueue(
            snap.queue!.map((t) => t.uri),
            idx,
            snap.queue!
          );
        },
      }));
    }
    if (isVideoTrack && iaDetail && iaDetail.episodes.length > 1) {
      return iaDetail.episodes.map((ep, idx) => {
        const epUri = `ia:video:${encodeURIComponent(iaDetail.summary.identifier)}/${idx}`;
        return {
          key: epUri,
          index: idx,
          title: ep.label,
          subtitle: iaDetail.summary.title,
          durationMs: ep.duration_ms || 0,
          badgeLabel: `#${idx + 1}`,
          isCurrent: track?.uri === epUri,
          onSelect: () => {
            setPlayerActionsOpen(false);
            const allTracks: TrackMetadata[] = iaDetail.episodes.map((itemEp, i) => ({
              uri: `ia:video:${encodeURIComponent(iaDetail.summary.identifier)}/${i}`,
              title: itemEp.label,
              artists: [iaDetail.summary.creator],
              album: iaDetail.summary.title,
              album_id: `ia:${iaDetail.summary.identifier}`,
              track_number: itemEp.episode_number,
              disc_number: 1,
              art_url: iaDetail.summary.art_url,
              duration_ms: itemEp.duration_ms,
              source: 'ia_video',
            }));
            defaultSimpClient.loadQueue(
              allTracks.map((t) => t.uri),
              idx,
              allTracks
            );
          },
        };
      });
    }
    if (isVideoTrack && dvdTitles.length > 1) {
      const dev = opticalDisc?.device_path || '/dev/sr0';
      return dvdTitles.map((t: DvdTitleInfo, idx) => {
        const dvdUri = `dvd://${dev}/${t.title_number}`;
        return {
          key: dvdUri,
          index: idx,
          title: `Title ${t.title_number}: ${t.label || 'DVD Video'}`,
          subtitle: `${Math.round(t.duration_ms / 60000)}m • ${t.aspect_ratio}`,
          durationMs: t.duration_ms || 0,
          badgeLabel: `#${idx + 1}`,
          isCurrent: track?.uri === dvdUri,
          onSelect: () => {
            setPlayerActionsOpen(false);
            const meta: TrackMetadata = {
              uri: dvdUri,
              title: `${opticalDisc?.album_title || 'DVD'} — Title ${t.title_number}`,
              artists: ['Optical DVD Video'],
              album: opticalDisc?.album_title || 'DVD Video',
              album_id: null,
              track_number: t.title_number,
              disc_number: 1,
              art_url: opticalDisc?.art_url || null,
              duration_ms: t.duration_ms,
              source: 'dvd',
            };
            defaultSimpClient.loadQueue([dvdUri], 0, [meta]);
          },
        };
      });
    }
    if (snap?.queue && snap.queue.length === 1) {
      const qt = snap.queue[0];
      return [
        {
          key: `0:${qt.uri}`,
          index: 0,
          title: qt.title || 'Track 1',
          subtitle: qt.artists?.join(', ') || qt.album || '',
          durationMs: qt.duration_ms || 0,
          badgeLabel: '#1',
          isCurrent: true,
          onSelect: () => {
            setPlayerActionsOpen(false);
          },
        },
      ];
    }
    return [];
  }, [snap?.queue, snap?.queue_index, isVideoTrack, iaDetail, dvdTitles, opticalDisc, track?.uri]);

  const activeRightColItems = useMemo(() => {
    if (rightColMode === 'chapters' && chapterModalItems.length > 0) {
      return chapterModalItems;
    }
    if (queueModalItems.length > 0) {
      return queueModalItems;
    }
    return chapterModalItems;
  }, [rightColMode, chapterModalItems, queueModalItems]);

  const currentQueueIdx = useMemo(() => {
    const found = activeRightColItems.findIndex((item) => item.isCurrent);
    return found >= 0 ? found : 0;
  }, [activeRightColItems]);

  const isForegroundFaded = Boolean(
    isPlayerIdle && idleFadeEnabled && !playerActionsOpen && !videoTheatreExpanded
  );

  const effectiveScale = !videoTheatreExpanded && playerScale > 1.02 ? playerScale : 1;
  const hasUpNext = Boolean(snap?.up_next && snap.up_next.length > 0);
  const buttonsBottomPx = Math.round(18 + 60 * effectiveScale);
  const scrubBottomPx = Math.round(18 + (60 + 86 + 18) * effectiveScale);
  const playerTheme = getSourceThemeForTrack(track?.uri, track?.source);
  const playerCssVars = getSourceThemeCssVars(playerTheme);

  return (
    <>
      <main
        ref={mainRef}
        style={{
          flex: 1,
          boxSizing: 'border-box',
          display: hidden ? 'none' : 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          width: '100%',
          overflow: 'visible',
          position: 'relative',
          ...playerCssVars,
        }}
      >
      {!isVideoTrack && !hidden && (
        <>
          <PlayerBackgroundVisualizer
            mode={vizMode}
            enabledScenes={enabledVizScenes}
            preferredScene={
              (trackPropsState.preferred_viz_mode as VisualizerEngine | null | undefined) || null
            }
            onActiveEngineChange={setActiveVizEngine}
            isPlaying={isPlaying}
            track={track || null}
            artUrl={track?.art_url || opticalDisc?.art_url || null}
            bpm={scTrackBpm}
            waveformBars={scWaveformBars}
            activeComment={activeBubbles[activeBubbles.length - 1]?.comment || null}
            comments={scComments}
            activeChapterLabel={
              chapterModalItems.find((c) => c.isCurrent)?.title || null
            }
            activeLyricLine={
              lyricsVizEnabled &&
              !trackPropsState.suppress_lyrics &&
              activeLyricIdx >= 0 &&
              lyricsData?.synced_lines[activeLyricIdx]
                ? lyricsData.synced_lines[activeLyricIdx].text
                : null
            }
            nextLyricLine={
              lyricsVizEnabled &&
              !trackPropsState.suppress_lyrics &&
              activeLyricIdx >= 0 &&
              lyricsData?.synced_lines[activeLyricIdx + 1]
                ? lyricsData.synced_lines[activeLyricIdx + 1].text
                : null
            }
            hasLyrics={Boolean(
              lyricsVizEnabled &&
                !trackPropsState.suppress_lyrics &&
                lyricsData &&
                !lyricsData.instrumental &&
                (lyricsData.synced_lines.length > 0 ||
                  (lyricsData.plain_lyrics && lyricsData.plain_lyrics.trim().length > 0))
            )}
            lyricsMarqueeFallback={
              lyricsVizEnabled &&
              !trackPropsState.suppress_lyrics &&
              lyricsData &&
              !lyricsData.instrumental
                ? lyricsData.synced_lines.length > 0
                  ? lyricsData.synced_lines
                      .map((l) => l.text.trim())
                      .filter(Boolean)
                      .slice(0, 12)
                      .join('   ♪   ')
                  : lyricsData.plain_lyrics
                    ? lyricsData.plain_lyrics
                        .split(/\r?\n/)
                        .map((l) => l.trim())
                        .filter(Boolean)
                        .slice(0, 12)
                        .join('   ♪   ')
                    : null
                : null
            }
            hidden={hidden}
          />
          {vizMode !== 'off' && (
            <VisualizerOverlayHud
              activeEngine={activeVizEngine}
              track={track || null}
              upNextTrack={snap?.up_next && snap.up_next.length > 0 ? snap.up_next[0] : null}
              positionMs={snap?.position_ms || 0}
              durationMs={track?.duration_ms || 0}
              activeLyricLine={
                lyricsKaraokeEnabled &&
                activeLyricIdx >= 0 &&
                lyricsData?.synced_lines[activeLyricIdx]
                  ? lyricsData.synced_lines[activeLyricIdx].text
                  : null
              }
              nextLyricLine={
                lyricsKaraokeEnabled &&
                activeLyricIdx >= 0 &&
                lyricsData?.synced_lines[activeLyricIdx + 1]
                  ? lyricsData.synced_lines[activeLyricIdx + 1].text
                  : null
              }
              activeComment={
                scCommentsEnabled
                  ? activeBubbles[activeBubbles.length - 1]?.comment || null
                  : null
              }
              factoidBubbles={factoidBubbles}
              suppressLyrics={Boolean(trackPropsState.suppress_lyrics)}
              suppressComments={Boolean(trackPropsState.suppress_comments)}
              suppressFactoids={!factoidsEnabled || Boolean(trackPropsState.suppress_factoids)}
              isForegroundFaded={isForegroundFaded}
              idleOpacityPct={idleOpacityPct}
              oskOrModalOpen={Boolean(playerActionsOpen || vizDrawerOpen)}
            />
          )}
        </>
      )}

      {/* Top-Right Up Next Readout Strip — Right-aligned & anchored just beneath the top Nav Bar */}
      {hasUpNext && snap?.up_next && !(isVideoTrack && videoTheatreExpanded) ? (
        <div
          style={{
            position: 'absolute',
            top: 14,
            right: 48,
            zIndex: 3,
            maxWidth: 'calc((100vw - 120px) * 0.42)',
            pointerEvents: 'none',
            opacity: isForegroundFaded ? Math.max(0, Math.min(0.95, idleOpacityPct / 100)) : 1,
            transition: isForegroundFaded ? 'opacity 480ms ease' : 'opacity 60ms ease-out',
            transform: effectiveScale > 1.02 ? `scale(${effectiveScale})` : undefined,
            transformOrigin: 'top right',
          }}
        >
          <div
            style={{
              width: 'fit-content',
              maxWidth: '100%',
              minWidth: 0,
              padding: '8px 14px',
              borderRadius: 12,
              background: 'rgba(8, 9, 14, 0.90)',
              border: '1px solid #283044',
              boxShadow:
                '0 10px 26px rgba(0, 0, 0, 0.92), 0 2px 8px rgba(0, 0, 0, 0.96), 0 0 0 1px rgba(0, 0, 0, 0.8)',
              fontSize: 12,
              color: '#c4c4d0',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              boxSizing: 'border-box',
              pointerEvents: 'auto',
            }}
          >
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
            >
              <strong style={{ fontFamily: 'monospace', color: '#2aa3c4', marginRight: 8 }}>
                NEXT:
              </strong>
              {snap.up_next[0].title} — {snap.up_next[0].artists.join(', ')}
            </span>
            <span
              className="simp-gp-badge"
              style={{
                fontFamily: 'monospace',
                color: '#71717a',
                fontSize: 11,
                flexShrink: 0,
              }}
            >
              <ImpIcon
                name="gamepad-select"
                size={12}
                color="#71717a"
                style={{ marginRight: 4, verticalAlign: '-1px' }}
              />
              SELECT • Actions
            </span>
          </div>
        </div>
      ) : null}

      {/* Top-Left Anchor: Track Title/Metadata + Left-Aligned Artwork Directly Beneath It (Mirror to NEXT) */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: 48,
          zIndex: isVideoTrack && videoTheatreExpanded ? 48 : 2,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 12,
          maxWidth: hasUpNext
            ? `calc((100vw - 120px) * 0.54 / ${effectiveScale})`
            : `calc((100vw - 96px) / ${effectiveScale})`,
          minWidth: 0,
          transform: effectiveScale > 1.02 ? `scale(${effectiveScale})` : undefined,
          transformOrigin: 'top left',
        }}
      >
        {/* Track Title & Artist / Collection / Source Header at Top-Left */}
        <div
          style={{
            display: isVideoTrack && videoTheatreExpanded ? 'none' : undefined,
            minWidth: 0,
            maxWidth: '100%',
            position: 'relative',
            padding: '6px 12px',
            margin: '-6px -12px 0',
            borderRadius: 16,
            background:
              !isVideoTrack && vizMode !== 'off'
                ? 'radial-gradient(ellipse at 25% 50%, rgba(6, 7, 12, 0.72) 0%, rgba(6, 7, 12, 0.36) 65%, rgba(6, 7, 12, 0) 100%)'
                : 'transparent',
            opacity: isForegroundFaded ? Math.max(0, Math.min(0.95, idleOpacityPct / 100)) : 1,
            transition: isForegroundFaded ? 'opacity 480ms ease' : 'opacity 60ms ease-out',
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: 28,
              fontWeight: 800,
              letterSpacing: -0.5,
              color: '#f4f4fa',
              textShadow:
                '0 2px 6px rgba(0, 0, 0, 0.98), 0 0 18px rgba(0, 0, 0, 0.96), 0 0 34px rgba(0, 0, 0, 0.9)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {track?.title || 'No Track Loaded'}
          </h1>
          <p
            style={{
              margin: '4px 0 0',
              fontSize: 15.5,
              fontWeight: 600,
              color: '#d4d4e2',
              textShadow:
                '0 2px 5px rgba(0, 0, 0, 0.98), 0 0 14px rgba(0, 0, 0, 0.96), 0 0 26px rgba(0, 0, 0, 0.92)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {track?.artists?.length ? (
              <span
                onClick={() => {
                  if (primaryArtist && handleMoreByArtist) {
                    handleMoreByArtist(
                      primaryArtist,
                      track.source,
                      scTrackUserId || undefined
                    );
                  }
                }}
                title={
                  primaryArtist
                    ? `Open ${primaryArtist} Artist Profile`
                    : undefined
                }
                style={{
                  cursor: primaryArtist && handleMoreByArtist ? 'pointer' : 'default',
                  textDecoration: primaryArtist && handleMoreByArtist ? 'underline' : 'none',
                  textDecorationColor: 'rgba(125, 211, 252, 0.45)',
                  textUnderlineOffset: 3,
                }}
              >
                {track.artists.join(', ')}
              </span>
            ) : (
              <>
                Select a track from Library<span className="simp-gp-badge"> (R1)</span>
              </>
            )}
            {track?.album ? ` • ${track.album}` : ''}
            {track?.source === 'soundcloud' && (
              <SoundCloudAttributionLink
                permalinkUrl={scTrackPermalink}
                kind="track"
                id={track.uri}
                width={30}
                style={{ marginLeft: 8, verticalAlign: 'middle' }}
              />
            )}
            {track?.source === 'apple_music' && (
              <AppleMusicAttributionLink
                id={track.uri}
                kind="song"
                style={{ marginLeft: 8, verticalAlign: 'middle' }}
              />
            )}
            {track?.source === 'soundcloud' && track?.album?.includes('• Preview') && (
              <span
                style={{
                  marginLeft: 8,
                  padding: '2px 7px',
                  borderRadius: 6,
                  background: '#3b1506',
                  border: '1px solid #f97316',
                  color: '#fdba74',
                  fontSize: 11,
                  fontFamily: 'monospace',
                  fontWeight: 800,
                  verticalAlign: 'middle',
                }}
              >
                30s PREVIEW • Sign in for full track
              </span>
            )}
            {(() => {
              const uri = track?.uri;
              if (!uri || (!uri.startsWith('file://') && !uri.startsWith('/'))) return null;
              const clean = uri.split('?')[0].split('#')[0];
              const dot = clean.lastIndexOf('.');
              if (dot < 0 || dot === clean.length - 1) return null;
              const ext = clean.slice(dot + 1).toUpperCase();
              return ['FLAC', 'MP3', 'WAV', 'OGG', 'OPUS', 'M4A', 'AAC', 'ALAC', 'AIFF'].includes(ext)
                ? ` • ${ext}`
                : null;
            })()}
            {isVideoTrack && activeQuality ? ` • ${activeQuality.label}` : ''}
          </p>
        </div>

        {/* Left-Aligned Artwork (240x240) OR 16:9 Live Video Stage Anchored Directly Beneath Title/Metadata */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            flexShrink: 0,
            opacity:
              isForegroundFaded && !(isVideoTrack && isPlaying)
                ? Math.max(0, Math.min(0.95, idleOpacityPct / 100))
                : 1,
            transition: isForegroundFaded ? 'opacity 480ms ease' : 'opacity 60ms ease-out',
          }}
        >
          <div
            ref={artBoxRef}
            data-video-enter-theatre={isVideoTrack && !videoTheatreExpanded ? 'true' : undefined}
            title={!isVideoTrack && track ? 'Click to open collection in Library' : undefined}
            onClick={() => {
              if (isVideoTrack && !videoTheatreExpanded) {
                setVideoTheatreExpanded(true);
              } else if (!isVideoTrack && document.documentElement.dataset.simpInput !== 'gamepad') {
                handleOpenCurrentCollection();
              }
            }}
            style={
              isVideoTrack && videoTheatreExpanded
                ? {
                    position: 'fixed',
                    inset: 0,
                    zIndex: 48,
                    background: '#000',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: hudVisible ? 'default' : 'none',
                  }
                : {
                    width: isVideoTrack ? 420 : 240,
                    height: isVideoTrack ? 236 : 240,
                    borderRadius: 20,
                    background: '#050508',
                    border: isVideoTrack ? '2px solid #2aa3c4' : '1px solid #2b2d3c',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                    boxShadow:
                      '0 18px 44px rgba(0, 0, 0, 0.94), 0 4px 14px rgba(0, 0, 0, 0.96), 0 0 0 1px rgba(0, 0, 0, 0.85)',
                    cursor: 'pointer',
                  }
            }
          >
            {isVideoTrack ? (
              <>
                {activeStreamUrl ? (
                  <video
                    ref={videoRef}
                    src={activeStreamUrl}
                    poster={track?.art_url || undefined}
                    autoPlay={isPlaying}
                    playsInline
                    onLoadedMetadata={(e) => {
                      const vid = e.currentTarget;
                      setVideoErrorMsg(null);
                      if (pendingResumeTimeSecRef.current > 0) {
                        vid.currentTime = pendingResumeTimeSecRef.current;
                        pendingResumeTimeSecRef.current = 0;
                      }
                      const rawDur =
                        Number.isFinite(vid.duration) && vid.duration > 0
                          ? Math.round(vid.duration * 1000)
                          : track?.duration_ms || 0;
                      const posMs = Math.round((dvdSeekOffsetSec + vid.currentTime) * 1000);
                      defaultSimpClient.reportAppleWorkerEvent(
                        vid.paused ? 'paused' : 'playing',
                        posMs,
                        undefined,
                        rawDur > 0 ? rawDur : undefined
                      );
                    }}
                    onPlay={(e) => {
                      const posMs = Math.round(
                        (dvdSeekOffsetSec + e.currentTarget.currentTime) * 1000
                      );
                      defaultSimpClient.reportAppleWorkerEvent('playing', posMs);
                    }}
                    onPause={(e) => {
                      if (e.currentTarget.ended) return;
                      const posMs = Math.round(
                        (dvdSeekOffsetSec + e.currentTarget.currentTime) * 1000
                      );
                      defaultSimpClient.reportAppleWorkerEvent('paused', posMs);
                    }}
                    onTimeUpdate={(e) => {
                      const now = performance.now();
                      if (now - lastTimeReportMsRef.current < 400) return;
                      lastTimeReportMsRef.current = now;
                      const vid = e.currentTarget;
                      const posMs = Math.round((dvdSeekOffsetSec + vid.currentTime) * 1000);
                      const rawDur =
                        Number.isFinite(vid.duration) && vid.duration > 0
                          ? Math.round(vid.duration * 1000)
                          : undefined;
                      defaultSimpClient.reportAppleWorkerEvent(
                        'time_update',
                        posMs,
                        undefined,
                        rawDur
                      );
                    }}
                    onEnded={(e) => {
                      const posMs = Math.round(
                        (dvdSeekOffsetSec + e.currentTarget.currentTime) * 1000
                      );
                      const hasNextTrack = Boolean(
                        (snap?.up_next && snap.up_next.length > 0) ||
                          snap?.repeat_mode === 'track' ||
                          snap?.repeat_mode === 'queue'
                      );
                      // When video concludes and no next track is queued, exit Fullscreen Theatre so OLED dimming can engage
                      if (!hasNextTrack) {
                        setVideoTheatreExpanded(false);
                        if (document.fullscreenElement) {
                          document.exitFullscreen().catch(() => {});
                        }
                      }
                      defaultSimpClient.reportAppleWorkerEvent('ended', posMs);
                    }}
                    onError={() => {
                      // Automatically try the next quality variant (e.g. falling back to Compatibility MP4 ffmpeg)
                      if (selectedQualityIdx + 1 < videoQualities.length) {
                        const nextIdx = selectedQualityIdx + 1;
                        setSelectedQualityIdx(nextIdx);
                        showToast?.(
                          `🎬 Switching stream format to ${videoQualities[nextIdx].label}…`
                        );
                      } else {
                        setVideoErrorMsg(
                          'Video stream unavailable for this format. Open SELECT menu to switch quality.'
                        );
                      }
                    }}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      background: '#000',
                    }}
                  >
                    {activeSubtitle && resolvedSubtitleBlobUrl && (
                      <track
                        key={activeSubtitle.vtt_url}
                        kind="subtitles"
                        src={resolvedSubtitleBlobUrl}
                        srcLang={activeSubtitle.lang_code}
                        label={activeSubtitle.label}
                        default
                      />
                    )}
                  </video>
                ) : (
                  <div style={{ color: '#9ca3af', fontSize: 13, fontFamily: 'monospace' }}>
                    ⏳ Resolving video stream…
                  </div>
                )}

                {videoErrorMsg && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 12,
                      background: 'rgba(10, 10, 16, 0.92)',
                      border: '1px solid #ef4444',
                      borderRadius: 12,
                      padding: 14,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 10,
                      textAlign: 'center',
                    }}
                  >
                    <span style={{ color: '#fca5a5', fontSize: 12.5, fontWeight: 700 }}>
                      ⚠️ {videoErrorMsg}
                    </span>
                    {videoQualities.length > 1 && (
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          cycleVideoQuality();
                        }}
                        style={{
                          padding: '6px 12px',
                          borderRadius: 8,
                          background: '#1e293b',
                          border: '1px solid #38bdf8',
                          color: '#e0f2fe',
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        🎞️ Switch Quality ({activeQuality?.label || 'Next'})
                      </button>
                    )}
                  </div>
                )}

                {/* Floating 4-Second Auto-Hide Theatre HUD & Scrub Bar when in Expanded Theatre Mode */}
                {videoTheatreExpanded && (
                  <div
                    onClick={(ev) => ev.stopPropagation()}
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      bottom: 0,
                      padding: '28px 36px 24px',
                      background:
                        'linear-gradient(to top, rgba(4, 4, 8, 0.95) 0%, rgba(4, 4, 8, 0.78) 65%, rgba(4, 4, 8, 0) 100%)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 14,
                      opacity: hudVisible ? 1 : 0,
                      pointerEvents: hudVisible ? 'auto' : 'none',
                      transition: 'opacity 0.28s ease',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 16,
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontSize: 22,
                            fontWeight: 800,
                            color: '#f4f4f6',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {track?.title || 'Video Playback'}
                        </div>
                        <div
                          style={{
                            fontSize: 13,
                            color: '#9ca3af',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            marginTop: 2,
                          }}
                        >
                          {track?.artists?.join(', ')}
                          {activeQuality ? ` • ${activeQuality.label}` : ''}
                          {activeSubtitle ? ` • CC: ${activeSubtitle.label}` : ''}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {videoQualities.length > 1 && (
                          <button
                            type="button"
                            onClick={cycleVideoQuality}
                            style={{
                              minHeight: 40,
                              padding: '0 12px',
                              borderRadius: 10,
                              background: '#12121c',
                              border: '1px solid #2aa3c4',
                              color: '#bfeaf5',
                              fontSize: 12,
                              fontFamily: 'monospace',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            🎞️ {activeQuality?.label || 'Quality'}
                          </button>
                        )}
                        {videoSubtitles.length > 0 && (
                          <button
                            type="button"
                            onClick={cycleVideoSubtitles}
                            style={{
                              minHeight: 40,
                              padding: '0 12px',
                              borderRadius: 10,
                              background: activeSubtitle ? '#0f222a' : '#12121c',
                              border: activeSubtitle ? '1px solid #2aa3c4' : '1px solid #2e2e3a',
                              color: activeSubtitle ? '#7dd3fc' : '#a1a1aa',
                              fontSize: 12,
                              fontFamily: 'monospace',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            💬 CC: {activeSubtitle ? activeSubtitle.label : 'Off'}
                          </button>
                        )}
                        <button
                          type="button"
                          data-video-exit-theatre="true"
                          onClick={() => {
                            setVideoTheatreExpanded(false);
                            if (document.fullscreenElement) {
                              document.exitFullscreen().catch(() => {});
                            }
                          }}
                          style={{
                            minHeight: 40,
                            padding: '0 14px',
                            borderRadius: 10,
                            background: '#181824',
                            border: '1px solid #3f3f4e',
                            color: '#f4f4f6',
                            fontSize: 12,
                            fontFamily: 'monospace',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          ↙ Card View<span className="simp-gp-badge"> B</span>
                        </button>
                      </div>
                    </div>

                    <ProgressBarRaf durationMs={track?.duration_ms ?? 0} trackUri={track?.uri} />

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 14,
                      }}
                    >
                      <TransportIconButton
                        icon="⏪"
                        badge="L2"
                        onClick={() => defaultSimpClient.seekRelative(-10_000)}
                      />
                      <TransportIconButton
                        icon="⏮"
                        badge="◄"
                        onClick={() => defaultSimpClient.previous()}
                      />
                      <button
                        type="button"
                        onClick={() => defaultSimpClient.togglePlayPause()}
                        style={{
                          width: 88,
                          height: 76,
                          borderRadius: 20,
                          background: isPlaying ? '#0f222a' : '#12121a',
                          color: isPlaying ? '#bfeaf5' : '#d4d4dc',
                          border: isPlaying ? '2px solid #2aa3c4' : '2px solid #3f3f4e',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 4,
                          cursor: 'pointer',
                          fontWeight: 900,
                        }}
                      >
                        <span style={{ fontSize: 26 }}>{isPlaying ? '⏸' : '▶'}</span>
                        <span
                          className="simp-gp-badge"
                          style={{
                            fontSize: 11,
                            fontFamily: 'monospace',
                            color: isPlaying ? '#7dd3fc' : '#a1a1aa',
                          }}
                        >
                          A
                        </span>
                      </button>
                      <TransportIconButton
                        icon="⏭"
                        badge="►"
                        onClick={() => defaultSimpClient.next()}
                      />
                      <TransportIconButton
                        icon="⏩"
                        badge="R2"
                        onClick={() => defaultSimpClient.seekRelative(10_000)}
                      />
                    </div>
                  </div>
                )}
              </>
            ) : track?.art_url ? (
              <img
                src={track.art_url}
                alt={track.album}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  filter: 'brightness(0.88)',
                }}
              />
            ) : (
              <img
                src="/simp-icon-dark.png?v=0.3.0-alpha.1"
                alt="IMP"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  filter: 'brightness(0.82)',
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Adaptive 7-Button Player Control Array — Anchored Above Lyrics Zone (Steps to Match Scrub Bar Center on Art Collision) */}
      <div
        ref={buttonsRowRef}
        style={{
          position: 'absolute',
          bottom: buttonsBottomPx,
          left: buttonsOffsetLeftPx !== null ? buttonsOffsetLeftPx : 48,
          right: 48,
          zIndex: 2,
          display: isVideoTrack && videoTheatreExpanded ? 'none' : 'flex',
          justifyContent: 'center',
          pointerEvents: 'none',
          opacity: isForegroundFaded ? Math.max(0, Math.min(0.95, idleOpacityPct / 100)) : 1,
          transition: isForegroundFaded ? 'opacity 480ms ease' : 'opacity 60ms ease-out',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            pointerEvents: 'auto',
            transform:
              buttonsFitScale !== null
                ? `scale(${buttonsFitScale})`
                : effectiveScale > 1.02
                ? `scale(${effectiveScale})`
                : undefined,
            transformOrigin: 'bottom center',
          }}
        >
          <TransportIconButton
            icon="🔀"
            badge="X"
            title={snap?.shuffle ? 'Shuffle: On' : 'Shuffle: Off'}
            active={!!snap?.shuffle}
            onClick={() => defaultSimpClient.setShuffle(!snap?.shuffle)}
          />
          <TransportIconButton
            icon="⏪"
            badge="L2"
            onClick={() => defaultSimpClient.seekRelative(-10_000)}
          />
          <TransportIconButton
            icon="⏮"
            badge="◄"
            onClick={() => defaultSimpClient.previous()}
          />
          <button
            data-default-focus="true"
            onClick={() => defaultSimpClient.togglePlayPause()}
            title={isPlaying ? 'Pause (Silence Audio)' : 'Resume Playback'}
            style={{
              width: 92,
              height: 86,
              borderRadius: 22,
              background: isPlaying ? playerTheme.accentMuted : '#12121a',
              color: isPlaying ? '#f8fafc' : '#d4d4dc',
              border: isPlaying ? `2px solid ${playerTheme.accent}` : '2px solid #3f3f4e',
              boxShadow: isPlaying
                ? `0 12px 32px rgba(0, 0, 0, 0.94), 0 0 22px ${playerTheme.accentGlow}, 0 0 0 1px rgba(0, 0, 0, 0.85)`
                : '0 12px 32px rgba(0, 0, 0, 0.94), 0 3px 10px rgba(0, 0, 0, 0.96), 0 0 0 1px rgba(0, 0, 0, 0.85)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
              cursor: 'pointer',
              fontWeight: 900,
            }}
          >
            <span style={{ fontSize: 28, color: isPlaying ? playerTheme.accent : '#d4d4dc' }}>
              {isPlaying ? '⏸' : '▶'}
            </span>
            <span
              className="simp-gp-badge"
              style={{
                padding: '2px 10px',
                borderRadius: 99,
                background: isPlaying ? 'rgba(0, 0, 0, 0.45)' : '#1f1f2b',
                color: isPlaying ? playerTheme.accent : '#a1a1aa',
                fontSize: 11,
                fontFamily: 'monospace',
              }}
            >
              {isPlaying ? 'A • 🔊' : 'A • 🔇'}
            </span>
          </button>
          <TransportIconButton
            icon="⏭"
            badge="►"
            onClick={() => defaultSimpClient.next()}
          />
          <TransportIconButton
            icon="⏩"
            badge="R2"
            onClick={() => defaultSimpClient.seekRelative(10_000)}
          />
          <TransportIconButton
            icon="🔁"
            badge={
              snap?.repeat_mode === 'track'
                ? 'Y•1'
                : snap?.repeat_mode === 'queue'
                ? 'Y•Q'
                : 'Y'
            }
            overlayBadge={
              snap?.repeat_mode === 'track'
                ? '1'
                : snap?.repeat_mode === 'queue'
                ? '∞'
                : null
            }
            title={
              snap?.repeat_mode === 'track'
                ? 'Repeat Mode: Single Track (1)'
                : snap?.repeat_mode === 'queue'
                ? 'Repeat Mode: Loop Queue (∞)'
                : 'Repeat Mode: Off'
            }
            active={snap?.repeat_mode !== 'off'}
            onClick={() => defaultSimpClient.cycleRepeat()}
          />
        </div>
      </div>

      {/* Adaptive Scrub Bar + Timed SoundCloud Comments — Anchored Above 7-Button Control Array */}
      <div
        style={{
          position: 'absolute',
          bottom: scrubBottomPx - Math.round(80 * effectiveScale),
          left: scrubOffsetLeftPx !== null ? scrubOffsetLeftPx : 48,
          right: 48,
          zIndex: 8,
          display:
            isVideoTrack && videoTheatreExpanded
              ? 'none'
              : scrubOffsetLeftPx !== null
              ? 'block'
              : 'flex',
          justifyContent: scrubOffsetLeftPx !== null ? undefined : 'center',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            position: 'relative',
            width:
              scrubOffsetLeftPx !== null
                ? effectiveScale > 1.02
                  ? `${100 / effectiveScale}%`
                  : '100%'
                : 'min(740px, 100%)',
            paddingTop: 72,
            paddingBottom: 80,
            boxSizing: 'border-box',
            pointerEvents: 'none',
            transform: effectiveScale > 1.02 ? `scale(${effectiveScale})` : undefined,
            transformOrigin: scrubOffsetLeftPx !== null ? 'bottom left' : 'bottom center',
          }}
        >
          <div
            ref={scrubRowRef}
            style={{
              position: 'relative',
              pointerEvents: 'auto',
              opacity: isForegroundFaded ? Math.max(0, Math.min(0.95, idleOpacityPct / 100)) : 1,
              transition: isForegroundFaded ? 'opacity 480ms ease' : 'opacity 60ms ease-out',
            }}
          >
            <ProgressBarRaf
              durationMs={track?.duration_ms ?? 0}
              trackUri={track?.uri}
              waveformBars={!isVideoTrack ? scWaveformBars : null}
              commentTimestampsMs={
                isSoundCloudTrack && scCommentsEnabled ? commentTimestampsMs : undefined
              }
              onPlayheadTick={handlePlayheadTick}
              hidden={hidden || (isVideoTrack && videoTheatreExpanded)}
            />
          </div>

          {/* Ephemeral SoundCloud Timed Comment Speech Bubbles (100% inside the 237px padded layout box so GPU opacity layers never clip) */}
          {isSoundCloudTrack &&
            scCommentsEnabled &&
            activeBubbles.map((b) => {
              const dur = track?.duration_ms || 0;
              const pct =
                dur > 0 && Number.isFinite(b.comment.timestamp_ms)
                  ? Math.max(0, Math.min(46, (b.comment.timestamp_ms / dur) * 100))
                  : 0;
              const isBelow = b.placement === 'below';
              return (
                <div
                  key={b.comment.id}
                  style={{
                    position: 'absolute',
                    ...(isBelow
                      ? { top: 134 }
                      : { bottom: 'calc(100% - 86px)' }),
                    left: 14,
                    right: 14,
                    display: 'flex',
                    justifyContent: 'flex-start',
                    pointerEvents: 'none',
                    zIndex: 25,
                  }}
                >
                  <div
                    style={{
                      marginLeft: `${pct}%`,
                      maxWidth: '78%',
                      minWidth: 240,
                      padding: '8px 14px',
                      borderRadius: 15,
                      ...(isBelow
                        ? { borderTopLeftRadius: 4 }
                        : { borderBottomLeftRadius: 4 }),
                      background: 'rgba(14, 12, 20, 0.96)',
                      border: '1px solid rgba(251, 146, 60, 0.6)',
                      boxShadow: '0 10px 26px rgba(0, 0, 0, 0.88)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      opacity: isForegroundFaded
                        ? Math.max(0, Math.min(0.95, idleOpacityPct / 100))
                        : 1,
                      transition: isForegroundFaded
                        ? 'opacity 480ms ease'
                        : 'opacity 60ms ease-out',
                    }}
                  >
                    {b.comment.avatar_url ? (
                      <img
                        src={b.comment.avatar_url}
                        alt=""
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: 99,
                          objectFit: 'cover',
                          border: '1px solid #ea580c',
                          flexShrink: 0,
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: 99,
                          background: '#27150c',
                          border: '1px solid #ea580c',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 15,
                          flexShrink: 0,
                        }}
                      >
                        💬
                      </div>
                    )}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: 12.5,
                          fontFamily: 'monospace',
                          color: '#fdba74',
                          fontWeight: 800,
                        }}
                      >
                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          @{b.comment.username}
                        </span>
                        <span
                          style={{
                            padding: '2px 7px',
                            borderRadius: 6,
                            background: '#27150c',
                            border: '1px solid #7c2d12',
                            color: '#fb923c',
                            fontSize: 11.5,
                            flexShrink: 0,
                          }}
                        >
                          {formatCommentTs(b.comment.timestamp_ms)}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 14.5,
                          color: '#f4f4f6',
                          marginTop: 2,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        “{b.comment.body.slice(0, 120)}”
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {/* Bottom-Edge Synced Lyrics Pill — Anchored near bottom screen edge & centered to the page */}
      {!isVideoTrack && (() => {
        const showLyricsBubble = Boolean(
          lyricsKaraokeEnabled &&
            !trackPropsState.suppress_lyrics &&
            lyricsData &&
            (lyricsData.synced_lines.length > 0 || lyricsData.instrumental)
        );
        if (!showLyricsBubble || !lyricsData) return null;
        return (
          <div
            style={{
              position: 'absolute',
              bottom: 18,
              left: 48,
              right: 48,
              zIndex: 3,
              pointerEvents: 'none',
              display: 'flex',
              justifyContent: 'center',
              opacity: isForegroundFaded ? Math.max(0, Math.min(0.95, idleOpacityPct / 100)) : 1,
              transition: isForegroundFaded ? 'opacity 480ms ease' : 'opacity 60ms ease-out',
            }}
          >
            <div
              style={{
                width: 'fit-content',
                maxWidth: '100%',
                padding: '6px 18px',
                borderRadius: 12,
                background: 'rgba(8, 9, 14, 0.82)',
                boxShadow: '0 6px 20px rgba(0, 0, 0, 0.88)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                textAlign: 'center',
                boxSizing: 'border-box',
                pointerEvents: 'auto',
                transition: 'opacity 200ms ease',
                transform:
                  !videoTheatreExpanded && playerScale > 1.02 ? `scale(${playerScale})` : undefined,
                transformOrigin: 'bottom center',
              }}
            >
              {lyricsData.instrumental ? (
                <div
                  style={{
                    fontSize: 13,
                    fontFamily: 'monospace',
                    color: '#67e8f9',
                    fontWeight: 700,
                    textShadow: '0 1px 4px rgba(0, 0, 0, 0.98)',
                  }}
                >
                  🎵 Instrumental Track
                </div>
              ) : (
                <>
                  {activeLyricIdx >= 0 && lyricsData.synced_lines[activeLyricIdx] ? (
                    <div
                      onClick={() => {
                        const line = lyricsData.synced_lines[activeLyricIdx];
                        if (line) defaultSimpClient.seek(line.timestamp_ms);
                      }}
                      title="Click to replay this lyric line"
                      style={{
                        maxWidth: '100%',
                        fontSize: 15,
                        fontWeight: 800,
                        color: '#67e8f9',
                        textShadow: '0 1px 6px rgba(0, 0, 0, 0.98)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        cursor: 'pointer',
                      }}
                    >
                      {lyricsData.synced_lines[activeLyricIdx].text}
                    </div>
                  ) : (
                    <div
                      style={{
                        maxWidth: '100%',
                        fontSize: 13.5,
                        fontFamily: 'monospace',
                        color: '#9ca3af',
                        textShadow: '0 1px 4px rgba(0, 0, 0, 0.98)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {lyricsData.synced_lines[0]?.text || '♪ …'}
                    </div>
                  )}
                  {lyricsData.synced_lines[activeLyricIdx + 1] && (
                    <div
                      onClick={() => {
                        const nextLine = lyricsData.synced_lines[activeLyricIdx + 1];
                        if (nextLine) defaultSimpClient.seek(nextLine.timestamp_ms);
                      }}
                      title="Click to jump to next lyric line"
                      style={{
                        maxWidth: '100%',
                        fontSize: 12,
                        color: '#8e8e99',
                        textShadow: '0 1px 4px rgba(0, 0, 0, 0.98)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        cursor: 'pointer',
                      }}
                    >
                      {lyricsData.synced_lines[activeLyricIdx + 1].text}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })()}
      </main>

      {/* Unified Two-Column Controller-First `SELECT` Track & Queue Actions Overlay Menu */}
      {playerActionsOpen && (
        <div
          onClick={() => setPlayerActionsOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.72)',
            zIndex: 55,
          }}
        >
          <div
            data-modal-root="true"
            data-player-actions-modal="true"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: 58,
              left: 16,
              width: 'min(760px, calc(100vw - 32px))',
              maxHeight: 'calc(100vh - 76px)',
              overflow: 'hidden',
              background: '#0a0a10',
              border: '2px solid #2aa3c4',
              borderRadius: 18,
              padding: 16,
              boxSizing: 'border-box',
              boxShadow: '0 20px 52px rgba(0, 0, 0, 0.92)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingBottom: 8,
                borderBottom: '1px solid #1e1e2a',
                flexShrink: 0,
              }}
            >
              <div style={{ minWidth: 0, flex: 1, marginRight: 10 }}>
                <div
                  style={{
                    fontSize: 13.5,
                    fontWeight: 800,
                    color: '#bfeaf5',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <ImpIcon name="gamepad-select" size={14} color="#67e8f9" />
                  <span>SELECT Menu</span>
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: '#8e8e99',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    marginTop: 2,
                  }}
                >
                  {track ? `${track.title} — ${track.artists.join(', ')}` : 'No active track'}
                </div>
              </div>
              <button
                type="button"
                data-player-actions-close="true"
                onClick={() => setPlayerActionsOpen(false)}
                style={{
                  minHeight: 34,
                  padding: '0 11px',
                  borderRadius: 9,
                  background: '#16161f',
                  border: '1px solid #2e2e3a',
                  color: '#d4d4dc',
                  fontFamily: 'monospace',
                  fontSize: 11.5,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                ✕<span className="simp-gp-badge"> B</span>
              </button>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '230px 1fr',
                gap: 14,
                minHeight: 0,
                flex: 1,
                overflow: 'hidden',
              }}
            >
              {/* Left Column: 3-Row XMB Category Selector (Up/Down or Hover exposes Right Pane) */}
              <div
                data-player-actions-col="left"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  overflowY: 'auto',
                  padding: '4px 6px',
                  boxSizing: 'border-box',
                }}
              >
                <button
                  type="button"
                  data-default-focus="true"
                  data-select-category="track_options"
                  data-select-active={selectCategory === 'track_options' ? 'true' : undefined}
                  onFocus={() => setSelectCategory('track_options')}
                  onMouseEnter={() => setSelectCategory('track_options')}
                  onClick={() => setSelectCategory('track_options')}
                  style={{
                    ...actionRowBtnStyle,
                    minHeight: 46,
                    padding: '8px 12px',
                    background: selectCategory === 'track_options' ? '#0f222a' : '#101018',
                    border:
                      selectCategory === 'track_options'
                        ? '1px solid #2aa3c4'
                        : '1px solid #222230',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 800,
                        color: selectCategory === 'track_options' ? '#bfeaf5' : '#e4e4ec',
                      }}
                    >
                      🎵 Track Options
                    </span>
                    <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                      Favorite, Hybrid, Radio, Artist
                    </span>
                  </div>
                  <span
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 12,
                      color: selectCategory === 'track_options' ? '#67e8f9' : '#71717a',
                    }}
                  >
                    ▸
                  </span>
                </button>

                <button
                  type="button"
                  data-select-category="collection"
                  data-select-active={selectCategory === 'collection' ? 'true' : undefined}
                  onFocus={() => setSelectCategory('collection')}
                  onMouseEnter={() => setSelectCategory('collection')}
                  onClick={handleOpenCurrentCollection}
                  style={{
                    ...actionRowBtnStyle,
                    minHeight: 46,
                    padding: '8px 12px',
                    background: selectCategory === 'collection' ? '#0f222a' : '#101018',
                    border:
                      selectCategory === 'collection'
                        ? '1px solid #2aa3c4'
                        : '1px solid #222230',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 800,
                        color: selectCategory === 'collection' ? '#bfeaf5' : '#e4e4ec',
                      }}
                    >
                      💿 Open Collection
                    </span>
                    <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                      A: Open in Library • ►: Queue ({activeRightColItems.length})
                    </span>
                  </div>
                  <span
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 12,
                      color: selectCategory === 'collection' ? '#67e8f9' : '#71717a',
                    }}
                  >
                    ▸
                  </span>
                </button>

                <button
                  type="button"
                  data-select-category="interface"
                  data-select-active={selectCategory === 'interface' ? 'true' : undefined}
                  onFocus={() => setSelectCategory('interface')}
                  onMouseEnter={() => setSelectCategory('interface')}
                  onClick={() => setSelectCategory('interface')}
                  style={{
                    ...actionRowBtnStyle,
                    minHeight: 46,
                    padding: '8px 12px',
                    background: selectCategory === 'interface' ? '#0f222a' : '#101018',
                    border:
                      selectCategory === 'interface'
                        ? '1px solid #2aa3c4'
                        : '1px solid #222230',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 800,
                        color: selectCategory === 'interface' ? '#bfeaf5' : '#e4e4ec',
                      }}
                    >
                      🖥️ Interface
                    </span>
                    <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                      Fullscreen, Visualizer, Lyrics, Factoids
                      {isSoundCloudTrack ? ', Comments' : ''}
                      {isVideoTrack ? ', Stream' : ''}
                    </span>
                  </div>
                  <span
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 12,
                      color: selectCategory === 'interface' ? '#67e8f9' : '#71717a',
                    }}
                  >
                    ▸
                  </span>
                </button>
              </div>

              {/* Right Column: Context-Exposed XMB Pane */}
              <div
                data-player-actions-col="right"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  background: '#0d0d15',
                  border: '1px solid #1e1e2c',
                  borderRadius: 14,
                  padding: 12,
                  minHeight: 0,
                  overflow: 'hidden',
                }}
              >
                {selectCategory === 'track_options' && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      overflowY: 'auto',
                      flex: 1,
                      padding: '4px 6px',
                      boxSizing: 'border-box',
                    }}
                  >
                    {track ? (
                      <>
                        {/* 1. Favorite / Like Track */}
                        <button
                          type="button"
                          onClick={() => {
                            setPlayerActionsOpen(false);
                            if (handleFavoriteTrack) {
                              handleFavoriteTrack(track);
                            } else if (track.source === 'soundcloud') {
                              likeSoundCloudTrack(track.uri, showToast);
                            }
                          }}
                          style={{
                            ...actionRowBtnStyle,
                            minHeight: 46,
                            padding: '8px 12px',
                            background: isCurrentTrackFavorited ? '#241016' : '#101018',
                            border: isCurrentTrackFavorited
                              ? '1px solid #f43f5e'
                              : '1px solid #222230',
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 800, color: '#fda4af' }}>
                              {isCurrentTrackFavorited ? '❤️ Favorited' : '♡ Favorite'}
                            </span>
                            <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                              {track.source === 'apple_music'
                                ? 'Love on Apple Music & ★ Favorites'
                                : track.source === 'soundcloud'
                                  ? 'Like on SoundCloud & ★ Favorites'
                                  : 'Save to ★ Favorites playlist'}
                            </span>
                          </div>
                          <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#fda4af' }}>
                            {isCurrentTrackFavorited ? '❤️ ON' : '+ ❤️'}
                          </span>
                        </button>

                        {/* 2. Add to Apple Cloud Library (Apple Music only) */}
                        {track.source === 'apple_music' && handleAddAppleToCloudLibrary && (
                          <button
                            type="button"
                            onClick={() => {
                              setPlayerActionsOpen(false);
                              handleAddAppleToCloudLibrary(track.uri, 'songs', track.title);
                            }}
                            style={{ ...actionRowBtnStyle, minHeight: 46, padding: '8px 12px' }}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                              <span style={{ fontSize: 12.5, fontWeight: 800, color: '#fca5a5' }}>
                                ☁️ + Cloud Library
                              </span>
                              <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                                Save to personal iCloud Music Library
                              </span>
                            </div>
                            <span
                              style={{ fontFamily: 'monospace', fontSize: 11, color: '#fca5a5' }}
                            >
                              + ☁️
                            </span>
                          </button>
                        )}

                        {/* 3. + Hybrid Playlist */}
                        {handleAddTracksToPlaylist && (
                          <button
                            type="button"
                            onClick={() => {
                              setPlayerActionsOpen(false);
                              handleAddTracksToPlaylist([track.uri], `"${track.title}"`, [track]);
                            }}
                            style={{ ...actionRowBtnStyle, minHeight: 46, padding: '8px 12px' }}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                              <span style={{ fontSize: 12.5, fontWeight: 800, color: '#67e8f9' }}>
                                ★ + Hybrid Playlist
                              </span>
                              <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                                Add track to active SIMP Hybrid Playlist
                              </span>
                            </div>
                            <span
                              style={{ fontFamily: 'monospace', fontSize: 11, color: '#67e8f9' }}
                            >
                              + ★
                            </span>
                          </button>
                        )}

                        {/* 4. Radio Station / Artist Mix */}
                        {!isVideoTrack && (track.source === 'soundcloud' || primaryArtist) && (
                          <button
                            type="button"
                            onClick={() => {
                              setPlayerActionsOpen(false);
                              if (
                                track.source === 'soundcloud' &&
                                handleStartSoundCloudTrackRadio
                              ) {
                                handleStartSoundCloudTrackRadio(track);
                              } else if (primaryArtist && handleMoreByArtist) {
                                handleMoreByArtist(
                                  primaryArtist,
                                  track.source,
                                  scTrackUserId || undefined
                                );
                              }
                            }}
                            style={{ ...actionRowBtnStyle, minHeight: 46, padding: '8px 12px' }}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                              <span style={{ fontSize: 12.5, fontWeight: 800, color: '#fdba74' }}>
                                📻{' '}
                                {track.source === 'soundcloud'
                                  ? 'Radio Station'
                                  : `Artist Mix / Station`}
                              </span>
                              <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                                {track.source === 'soundcloud'
                                  ? `Continuous station from "${track.title}"`
                                  : `Station & top mixes for ${primaryArtist}`}
                              </span>
                            </div>
                            <span
                              style={{ fontFamily: 'monospace', fontSize: 11, color: '#fdba74' }}
                            >
                              ▶
                            </span>
                          </button>
                        )}

                        {/* 5. More by Artist */}
                        {primaryArtist && handleMoreByArtist && (
                          <button
                            type="button"
                            onClick={() => {
                              setPlayerActionsOpen(false);
                              setVideoTheatreExpanded(false);
                              handleMoreByArtist(
                                primaryArtist,
                                track?.source,
                                scTrackUserId || undefined
                              );
                            }}
                            style={{ ...actionRowBtnStyle, minHeight: 46, padding: '8px 12px' }}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                              <span style={{ fontSize: 12.5, fontWeight: 800, color: '#d4d4dc' }}>
                                👤 More by {primaryArtist}
                              </span>
                              <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                                Artist profile: tracks, albums & related
                              </span>
                            </div>
                            <span
                              style={{ fontFamily: 'monospace', fontSize: 11, color: '#9ca3af' }}
                            >
                              →
                            </span>
                          </button>
                        )}

                        {/* 6. Follow Artist (SoundCloud) */}
                        {isSoundCloudTrack && scTrackUserId && primaryArtist && (
                          <button
                            type="button"
                            onClick={() => {
                              const nextFollow = !scCreatorFollowed;
                              toggleFollowSoundCloudUser(
                                scTrackUserId,
                                nextFollow,
                                primaryArtist,
                                showToast
                              )
                                .then((ok) => {
                                  if (ok) setScCreatorFollowed(nextFollow);
                                })
                                .catch((err: any) => {
                                  showToast?.(
                                    err?.message || 'Sign in with SoundCloud to follow creators'
                                  );
                                });
                            }}
                            style={{
                              ...actionRowBtnStyle,
                              minHeight: 46,
                              padding: '8px 12px',
                              background: scCreatorFollowed ? '#1f120b' : '#101018',
                              border: scCreatorFollowed
                                ? '1px solid #ea580c'
                                : '1px solid #222230',
                            }}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                              <span style={{ fontSize: 12.5, fontWeight: 800, color: '#fdba74' }}>
                                {scCreatorFollowed
                                  ? `✓ Following @${primaryArtist}`
                                  : `➕ Follow @${primaryArtist}`}
                              </span>
                              <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                                SoundCloud Following list & stream
                              </span>
                            </div>
                            <span
                              style={{
                                fontFamily: 'monospace',
                                fontSize: 10.5,
                                fontWeight: 800,
                                color: scCreatorFollowed ? '#fdba74' : '#9ca3af',
                              }}
                            >
                              {scCreatorFollowed ? 'FOLLOWING' : '+ FOLLOW'}
                            </span>
                          </button>
                        )}

                        {/* 7. Track Properties & Local Curation */}
                        <button
                          type="button"
                          data-track-properties-trigger="true"
                          onClick={() => {
                            window.dispatchEvent(
                              new CustomEvent('simp-open-track-properties', { detail: track }),
                            );
                          }}
                          style={{
                            ...actionRowBtnStyle,
                            minHeight: 46,
                            padding: '8px 12px',
                            background: '#111a26',
                            border: `1px solid ${playerTheme.accentBorder}`,
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <span
                              style={{
                                fontSize: 12.5,
                                fontWeight: 800,
                                color: playerTheme.accent,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                              }}
                            >
                              <ImpIcon name="sliders" size={14} color={playerTheme.accent} />
                              Track Properties & Curation
                            </span>
                            <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                              Refetch/suppress lyrics, sync offset ±250ms, cover art & overlays
                            </span>
                          </div>
                          <span
                            style={{
                              fontFamily: 'monospace',
                              fontSize: 11,
                              color: playerTheme.accent,
                            }}
                          >
                            ▸
                          </span>
                        </button>
                      </>
                    ) : (
                      <div style={{ padding: 18, color: '#8e8e99', fontSize: 12 }}>
                        No track loaded.
                      </div>
                    )}
                  </div>
                )}

                {selectCategory === 'collection' && (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        paddingBottom: 8,
                        marginBottom: 8,
                        borderBottom: '1px solid #1e1e2c',
                        flexShrink: 0,
                        gap: 8,
                      }}
                    >
                      <span style={{ fontSize: 12, fontWeight: 800, color: '#bfeaf5' }}>
                        📑{' '}
                        {rightColMode === 'chapters' && chapterModalItems.length > 0
                          ? 'MIX CHAPTERS'
                          : isVideoTrack
                            ? 'EPISODES / QUEUE'
                            : 'ACTIVE QUEUE'}{' '}
                        ({activeRightColItems.length > 0 ? currentQueueIdx + 1 : 0} /{' '}
                        {activeRightColItems.length})
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {chapterModalItems.length > 0 && queueModalItems.length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setRightColMode((prev) =>
                                prev === 'chapters' ? 'queue' : 'chapters'
                              )
                            }
                            style={{
                              padding: '3px 8px',
                              borderRadius: 6,
                              background: '#161622',
                              border: '1px solid #2aa3c4',
                              color: '#67e8f9',
                              fontSize: 10.5,
                              fontFamily: 'monospace',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            {rightColMode === 'chapters' ? 'Switch to Queue' : 'Switch to Chapters'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handleOpenCurrentCollection}
                          style={{
                            padding: '3px 8px',
                            borderRadius: 6,
                            background: '#0f222a',
                            border: '1px solid #2aa3c4',
                            color: '#bfeaf5',
                            fontSize: 10.5,
                            fontFamily: 'monospace',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          Open in Browser →
                        </button>
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        overflowY: 'auto',
                        flex: 1,
                        padding: '4px 6px',
                        boxSizing: 'border-box',
                      }}
                    >
                      {activeRightColItems.length > 0 ? (
                        activeRightColItems.map((item) => (
                          <button
                            key={item.key}
                            type="button"
                            data-queue-current={item.isCurrent ? 'true' : undefined}
                            onClick={item.onSelect}
                            style={{
                              width: '100%',
                              padding: '8px 11px',
                              borderRadius: 10,
                              background: item.isCurrent ? '#0f222a' : '#12121c',
                              border: item.isCurrent ? '1px solid #2aa3c4' : '1px solid #222230',
                              color: item.isCurrent ? '#7dd3fc' : '#d4d4dc',
                              textAlign: 'left',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: 10,
                              cursor: 'pointer',
                              flexShrink: 0,
                            }}
                          >
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div
                                style={{
                                  fontSize: 12.5,
                                  fontWeight: item.isCurrent ? 800 : 600,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {item.isCurrent ? '▶ ' : `${item.index + 1}. `}
                                {item.title}
                              </div>
                              {item.subtitle && (
                                <div
                                  style={{
                                    fontSize: 10.5,
                                    color: item.isCurrent ? '#67e8f9' : '#71717a',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    marginTop: 1,
                                  }}
                                >
                                  {item.subtitle}
                                </div>
                              )}
                            </div>
                            <span
                              style={{
                                fontSize: 10.5,
                                fontFamily: 'monospace',
                                color: item.isCurrent ? '#67e8f9' : '#71717a',
                                flexShrink: 0,
                              }}
                            >
                              {item.badgeLabel || `#${item.index + 1}`}
                            </span>
                          </button>
                        ))
                      ) : (
                        <div style={{ padding: 18, color: '#8e8e99', fontSize: 12 }}>
                          Queue is currently empty.
                        </div>
                      )}
                    </div>
                  </>
                )}

                {selectCategory === 'interface' && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      overflowY: 'auto',
                      flex: 1,
                      padding: '4px 6px',
                      boxSizing: 'border-box',
                    }}
                  >
                    {/* 1. Full Screen */}
                    <button
                      type="button"
                      onClick={() => {
                        setPlayerActionsOpen(false);
                        togglePlayerFullscreen();
                      }}
                      style={{
                        ...actionRowBtnStyle,
                        minHeight: 46,
                        padding: '8px 12px',
                        background: isFullscreen ? '#0f222a' : '#101018',
                        border: isFullscreen ? '1px solid #2aa3c4' : '1px solid #222230',
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 800, color: '#bfeaf5' }}>
                          ⛶ {isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
                        </span>
                        <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                          Shortcut: F / F11 / Alt+F or double-click background
                        </span>
                      </div>
                      <span
                        style={{
                          fontFamily: 'monospace',
                          fontSize: 11,
                          fontWeight: 800,
                          color: isFullscreen ? '#67e8f9' : '#71717a',
                        }}
                      >
                        {isFullscreen ? 'ON' : 'OFF'}
                      </span>
                    </button>

                    {/* 2. Visualizer Scene Queue & Rotation Drawer (Audio tracks) */}
                    {!isVideoTrack && (
                      <button
                        type="button"
                        data-viz-drawer-trigger="true"
                        onClick={() => setVizDrawerOpen(true)}
                        style={{
                          ...actionRowBtnStyle,
                          minHeight: 46,
                          padding: '8px 12px',
                          background: vizMode !== 'off' ? '#0f222a' : '#101018',
                          border: vizMode !== 'off' ? '1px solid #2aa3c4' : '1px solid #222230',
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 800, color: '#67e8f9' }}>
                            ✨ Visualizer:{' '}
                            {VISUALIZER_MODES.find((m) => m.id === vizMode)?.label ||
                              'Glyph Matrix'}
                          </span>
                          <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                            12 High-DPI Scenes • {enabledVizScenes.length}/12 in Cycle/Shuffle
                          </span>
                        </div>
                        <span
                          style={{
                            fontFamily: 'monospace',
                            fontSize: 11,
                            fontWeight: 800,
                            color: vizMode !== 'off' ? '#67e8f9' : '#71717a',
                          }}
                        >
                          {VISUALIZER_MODES.find((m) => m.id === vizMode)?.shortLabel || 'GLYPH'} ▸
                        </span>
                      </button>
                    )}

                    {/* 2a. 10-Band Audio Equalizer & Vocal Stage Drawer */}
                    {!isVideoTrack && (
                      <button
                        type="button"
                        data-equalizer-trigger="true"
                        onClick={() => setEqualizerOpen(true)}
                        style={{
                          ...actionRowBtnStyle,
                          minHeight: 46,
                          padding: '8px 12px',
                          background:
                            dspState.eq_enabled || dspState.vocal_mode !== 'off'
                              ? '#0f222a'
                              : '#101018',
                          border:
                            dspState.eq_enabled || dspState.vocal_mode !== 'off'
                              ? '1px solid #38bdf8'
                              : '1px solid #222230',
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <span
                            style={{
                              fontSize: 12.5,
                              fontWeight: 800,
                              color: '#7dd3fc',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                            }}
                          >
                            <ImpIcon name="sliders" size={14} color="#38bdf8" />
                            10-Band Equalizer & Vocal Stage
                          </span>
                          <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                            EQ: {dspState.eq_enabled ? dspState.eq_preset.toUpperCase() : 'Flat (Bypass)'}{' '}
                            • Vocal:{' '}
                            {dspState.vocal_mode === 'vocal_remover'
                              ? 'Karaoke Remover'
                              : dspState.vocal_mode === 'vocal_isolate'
                                ? 'Vocal Isolate'
                                : 'Original'}
                          </span>
                        </div>
                        <span
                          style={{
                            fontFamily: 'monospace',
                            fontSize: 11,
                            fontWeight: 800,
                            color:
                              dspState.eq_enabled || dspState.vocal_mode !== 'off'
                                ? '#38bdf8'
                                : '#71717a',
                          }}
                        >
                          {dspState.eq_enabled || dspState.vocal_mode !== 'off' ? 'ACTIVE ▸' : 'OPEN ▸'}
                        </span>
                      </button>
                    )}

                    {/* 2a-ii. 1-Click Karaoke Mode (Vocal Remover + Synced Lyrics) */}
                    {!isVideoTrack && (
                      <button
                        type="button"
                        onClick={() =>
                          handleToggleKaraokeMode(
                            !(dspState.vocal_mode === 'vocal_remover' && lyricsKaraokeEnabled)
                          )
                        }
                        style={{
                          ...actionRowBtnStyle,
                          minHeight: 46,
                          padding: '8px 12px',
                          background:
                            dspState.vocal_mode === 'vocal_remover' && lyricsKaraokeEnabled
                              ? '#0d261f'
                              : '#101018',
                          border:
                            dspState.vocal_mode === 'vocal_remover' && lyricsKaraokeEnabled
                              ? '1px solid #34d399'
                              : '1px solid #222230',
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <span
                            style={{
                              fontSize: 12.5,
                              fontWeight: 800,
                              color: '#6ee7b7',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                            }}
                          >
                            <ImpIcon
                              name={
                                dspState.vocal_mode === 'vocal_remover' ? 'mic-off' : 'mic'
                              }
                              size={14}
                              color="#34d399"
                            />
                            Karaoke Mode
                          </span>
                          <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                            Vocal remover + foreground synced lyrics
                          </span>
                        </div>
                        <span
                          style={{
                            fontFamily: 'monospace',
                            fontSize: 11,
                            fontWeight: 800,
                            color:
                              dspState.vocal_mode === 'vocal_remover' && lyricsKaraokeEnabled
                                ? '#34d399'
                                : '#71717a',
                          }}
                        >
                          {dspState.vocal_mode === 'vocal_remover' && lyricsKaraokeEnabled
                            ? 'ON'
                            : 'OFF'}
                        </span>
                      </button>
                    )}

                    {/* 2b. Karaoke / Foreground Synced Lyrics Overlay (LRCLIB v1/v2 + Local .lrc) */}
                    {!isVideoTrack && (
                      <button
                        type="button"
                        onClick={toggleLyricsKaraoke}
                        style={{
                          ...actionRowBtnStyle,
                          minHeight: 46,
                          padding: '8px 12px',
                          background: lyricsKaraokeEnabled ? '#0f222a' : '#101018',
                          border: lyricsKaraokeEnabled ? '1px solid #2aa3c4' : '1px solid #222230',
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <span
                            style={{
                              fontSize: 12.5,
                              fontWeight: 800,
                              color: '#67e8f9',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                            }}
                          >
                            <ImpIcon name="lyrics" size={14} color="#67e8f9" />
                            Foreground Synced Lyrics
                          </span>
                          <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                            {lyricsData?.synced_lines?.length
                              ? `${lyricsData.synced_lines.length} synced lines (${lyricsData.source})`
                              : lyricsData?.instrumental
                                ? 'Instrumental track'
                                : 'Synced teleprompter lyrics overlay'}
                          </span>
                        </div>
                        <span
                          style={{
                            fontFamily: 'monospace',
                            fontSize: 11,
                            fontWeight: 800,
                            color: lyricsKaraokeEnabled ? '#67e8f9' : '#71717a',
                          }}
                        >
                          {lyricsKaraokeEnabled ? 'ON' : 'OFF'}
                        </span>
                      </button>
                    )}

                    {/* 2b-i. Visualizer Lyrics Data Element Toggle */}
                    {!isVideoTrack && (
                      <button
                        type="button"
                        onClick={toggleLyricsViz}
                        style={{
                          ...actionRowBtnStyle,
                          minHeight: 46,
                          padding: '8px 12px',
                          background: lyricsVizEnabled ? '#121f2b' : '#101018',
                          border: lyricsVizEnabled ? '1px solid #38bdf8' : '1px solid #222230',
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <span
                            style={{
                              fontSize: 12.5,
                              fontWeight: 800,
                              color: '#7dd3fc',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                            }}
                          >
                            <ImpIcon name="sparkles" size={14} color="#7dd3fc" />
                            Visualizer Lyrics Data Element
                          </span>
                          <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                            {!lyricsKaraokeEnabled && !lyricsVizEnabled
                              ? 'Lyrics lookup disabled'
                              : 'Show synced lyrics inside visualizer scenes'}
                          </span>
                        </div>
                        <span
                          style={{
                            fontFamily: 'monospace',
                            fontSize: 11,
                            fontWeight: 800,
                            color: lyricsVizEnabled ? '#7dd3fc' : '#71717a',
                          }}
                        >
                          {lyricsVizEnabled ? 'ON' : 'OFF'}
                        </span>
                      </button>
                    )}

                    {/* 2b-ii. VH1 Pop-Up Factoid Speech Bubbles (Wikipedia / MusicBrainz) */}
                    {!isVideoTrack && (
                      <button
                        type="button"
                        onClick={toggleFactoids}
                        style={{
                          ...actionRowBtnStyle,
                          minHeight: 46,
                          padding: '8px 12px',
                          background: factoidsEnabled ? '#241d0c' : '#101018',
                          border: factoidsEnabled ? '1px solid #eab308' : '1px solid #222230',
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 800, color: '#fde047' }}>
                            💬 Pop-Up Factoids (VH1 / Wikipedia)
                          </span>
                          <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                            {factoidBubbles.length > 0
                              ? `${factoidBubbles.length} trivia bubble${factoidBubbles.length === 1 ? '' : 's'} queued for this track`
                              : 'Timed song & artist trivia speech bubbles'}
                          </span>
                        </div>
                        <span
                          style={{
                            fontFamily: 'monospace',
                            fontSize: 11,
                            fontWeight: 800,
                            color: factoidsEnabled ? '#fde047' : '#71717a',
                          }}
                        >
                          {factoidsEnabled ? 'ON' : 'OFF'}
                        </span>
                      </button>
                    )}

                    {/* 2c. Idle Controls Auto-Fade & Opacity */}
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        padding: '8px 12px',
                        borderRadius: 12,
                        background: idleFadeEnabled ? '#0f222a' : '#101018',
                        border: idleFadeEnabled ? '1px solid #2aa3c4' : '1px solid #222230',
                      }}
                    >
                      <button
                        type="button"
                        onClick={toggleIdleFade}
                        style={{
                          width: '100%',
                          padding: 0,
                          border: 'none',
                          background: 'transparent',
                          color: '#f4f4f6',
                          textAlign: 'left',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 12,
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 800, color: '#67e8f9' }}>
                            🫧 Idle Controls Fade (6s)
                          </span>
                          <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                            Auto-hide Nav Bar & fade controls to {idleOpacityPct}% opacity when idle
                          </span>
                        </div>
                        <span
                          style={{
                            fontFamily: 'monospace',
                            fontSize: 11,
                            fontWeight: 800,
                            color: idleFadeEnabled ? '#67e8f9' : '#71717a',
                          }}
                        >
                          {idleFadeEnabled ? `ON (${idleOpacityPct}%)` : 'OFF'}
                        </span>
                      </button>

                      {idleFadeEnabled && (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            paddingTop: 4,
                            borderTop: '1px solid rgba(42, 163, 196, 0.22)',
                          }}
                        >
                          <span
                            style={{
                              fontSize: 10.5,
                              fontFamily: 'monospace',
                              color: '#9ca3af',
                              minWidth: 78,
                            }}
                          >
                            Idle Opacity:
                          </span>
                          <button
                            type="button"
                            data-row-aux="true"
                            onClick={() => updateIdleOpacityPct(idleOpacityPct - 10)}
                            style={{
                              minWidth: 28,
                              height: 26,
                              borderRadius: 6,
                              background: '#14141e',
                              border: '1px solid #2a2c3c',
                              color: '#bfeaf5',
                              fontFamily: 'monospace',
                              fontSize: 12,
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            −
                          </button>
                          <input
                            type="range"
                            data-row-aux="true"
                            min={0}
                            max={90}
                            step={5}
                            value={idleOpacityPct}
                            onChange={(e) => updateIdleOpacityPct(Number(e.target.value))}
                            style={{
                              flex: 1,
                              accentColor: '#2aa3c4',
                              cursor: 'pointer',
                            }}
                          />
                          <button
                            type="button"
                            data-row-aux="true"
                            onClick={() => updateIdleOpacityPct(idleOpacityPct + 10)}
                            style={{
                              minWidth: 28,
                              height: 26,
                              borderRadius: 6,
                              background: '#14141e',
                              border: '1px solid #2a2c3c',
                              color: '#bfeaf5',
                              fontFamily: 'monospace',
                              fontSize: 12,
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            +
                          </button>
                          <span
                            style={{
                              fontSize: 11,
                              fontFamily: 'monospace',
                              fontWeight: 800,
                              color: '#67e8f9',
                              minWidth: 36,
                              textAlign: 'right',
                            }}
                          >
                            {idleOpacityPct}%
                          </span>
                        </div>
                      )}
                    </div>

                    {/* 3. Timed Comment Bubbles (SoundCloud only) */}
                    {isSoundCloudTrack && (
                      <button
                        type="button"
                        onClick={toggleScComments}
                        style={{
                          ...actionRowBtnStyle,
                          minHeight: 46,
                          padding: '8px 12px',
                          background: scCommentsEnabled ? '#1f120b' : '#101018',
                          border: scCommentsEnabled ? '1px solid #ea580c' : '1px solid #222230',
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 800, color: '#fdba74' }}>
                            💬 Timed Comment Bubbles
                          </span>
                          <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                            {scComments.length} timed comments on this track
                          </span>
                        </div>
                        <span
                          style={{
                            fontFamily: 'monospace',
                            fontSize: 11,
                            fontWeight: 800,
                            color: scCommentsEnabled ? '#fdba74' : '#71717a',
                          }}
                        >
                          {scCommentsEnabled ? 'ON' : 'OFF'}
                        </span>
                      </button>
                    )}

                    {/* 4. Video Theatre & Stream Quality / Subtitles (Video tracks) */}
                    {isVideoTrack && (
                      <>
                        <button
                          type="button"
                          onClick={toggleTheatreFullscreen}
                          style={{
                            ...actionRowBtnStyle,
                            minHeight: 46,
                            padding: '8px 12px',
                            background: videoTheatreExpanded ? '#0f222a' : '#101018',
                            border: videoTheatreExpanded
                              ? '1px solid #2aa3c4'
                              : '1px solid #222230',
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 800, color: '#67e8f9' }}>
                              {videoTheatreExpanded ? '↙ Exit Theatre Stage' : '⛶ Theatre Stage'}
                            </span>
                            <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                              Fill window with video stage & 4s auto-hide HUD
                            </span>
                          </div>
                          <span
                            style={{ fontFamily: 'monospace', fontSize: 11, color: '#67e8f9' }}
                          >
                            {videoTheatreExpanded ? 'CARD' : 'THEATRE'}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={cycleVideoQuality}
                          style={{ ...actionRowBtnStyle, minHeight: 46, padding: '8px 12px' }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 800, color: '#f4f4f6' }}>
                              🎞️ Stream Quality: {activeQuality?.label || 'Default'}
                            </span>
                            <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                              {videoQualities.length} format(s) available
                            </span>
                          </div>
                          <span
                            style={{ fontFamily: 'monospace', fontSize: 11, color: '#2aa3c4' }}
                          >
                            {selectedQualityIdx + 1}/{Math.max(1, videoQualities.length)}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={cycleVideoSubtitles}
                          style={{ ...actionRowBtnStyle, minHeight: 46, padding: '8px 12px' }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 800, color: '#f4f4f6' }}>
                              💬 Subtitles / CC: {activeSubtitle ? activeSubtitle.label : 'Off'}
                            </span>
                            <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                              {videoSubtitles.length} subtitle track(s)
                            </span>
                          </div>
                          <span
                            style={{ fontFamily: 'monospace', fontSize: 11, color: '#2aa3c4' }}
                          >
                            {activeSubtitle ? 'ON' : 'OFF'}
                          </span>
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <VisualizerDrawerModal
        open={vizDrawerOpen}
        onClose={() => {
          setVizDrawerOpen(false);
          window.setTimeout(() => {
            const trigger =
              document.querySelector<HTMLElement>(
                '[data-player-actions-modal="true"] [data-viz-drawer-trigger="true"]:not([disabled])',
              ) ||
              document.querySelector<HTMLElement>(
                '[data-player-actions-modal="true"] button:not([disabled])',
              );
            if (trigger && applyFocusMarker) {
              applyFocusMarker(trigger);
            }
          }, 25);
        }}
        vizMode={vizMode}
        activeEngine={activeVizEngine}
        enabledScenes={enabledVizScenes}
        onSelectMode={handleSelectVizMode}
        onToggleSceneInRotation={handleToggleSceneInRotation}
        onSetAllScenesInRotation={handleSetAllScenesInRotation}
      />

      <EqualizerModal
        open={equalizerOpen}
        onClose={() => {
          setEqualizerOpen(false);
          window.setTimeout(() => {
            const trigger =
              document.querySelector<HTMLElement>(
                '[data-player-actions-modal="true"] [data-equalizer-trigger="true"]:not([disabled])',
              ) ||
              document.querySelector<HTMLElement>(
                '[data-player-actions-modal="true"] button:not([disabled])',
              );
            if (trigger && applyFocusMarker) {
              applyFocusMarker(trigger);
            }
          }, 25);
        }}
        dspState={dspState}
        onUpdateDsp={handleUpdateDsp}
        karaokeLyricsEnabled={lyricsKaraokeEnabled}
        onToggleKaraokeMode={handleToggleKaraokeMode}
      />
    </>
  );
};

const actionRowBtnStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 52,
  padding: '10px 14px',
  borderRadius: 12,
  background: '#101018',
  border: '1px solid #222230',
  color: '#f4f4f6',
  textAlign: 'left',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  cursor: 'pointer',
};

interface TransportBtnProps {
  icon: string;
  badge: string;
  overlayBadge?: string | null;
  title?: string;
  active?: boolean;
  onClick: () => void;
}

const TransportIconButton: React.FC<TransportBtnProps> = ({
  icon,
  badge,
  overlayBadge,
  title,
  active,
  onClick,
}) => (
  <button
    onClick={onClick}
    title={title}
    style={{
      width: 72,
      height: 72,
      borderRadius: 18,
      background: active ? 'var(--imp-accent-muted, #0d1b22)' : '#0b0c12',
      border: active ? '2px solid var(--imp-accent, #2aa3c4)' : '2px solid #2a2c3c',
      boxShadow:
        '0 10px 26px rgba(0, 0, 0, 0.94), 0 3px 8px rgba(0, 0, 0, 0.96), 0 0 0 1px rgba(0, 0, 0, 0.85)',
      color: '#d4d4dc',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      cursor: 'pointer',
      position: 'relative',
    }}
  >
    <span style={{ fontSize: 24, position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      {icon}
      {overlayBadge && (
        <span
          style={{
            position: 'absolute',
            right: -9,
            bottom: -4,
            minWidth: 17,
            height: 17,
            padding: '0 3px',
            borderRadius: 99,
            background: '#061820',
            border: '1.5px solid var(--imp-accent, #38bdf8)',
            color: 'var(--imp-accent, #7dd3fc)',
            fontSize: 10.5,
            fontFamily: 'monospace',
            fontWeight: 900,
            lineHeight: '14px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 6px rgba(0, 0, 0, 0.92)',
          }}
        >
          {overlayBadge}
        </span>
      )}
    </span>
    <span
      className="simp-gp-badge"
      style={{
        padding: '2px 8px',
        borderRadius: 99,
        background: '#14141c',
        border: '1px solid #262632',
        fontSize: 12,
        fontFamily: 'monospace',
        color: active ? 'var(--imp-accent, #7dd3fc)' : '#8e8e99',
        fontWeight: 700,
      }}
    >
      {badge}
    </span>
  </button>
);

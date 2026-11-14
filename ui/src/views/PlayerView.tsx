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
import {
  loadEnabledVisualizerScenes,
  PlayerBackgroundVisualizer,
  saveEnabledVisualizerScenes,
  VISUALIZER_MODES,
  VISUALIZER_ENGINES,
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
  SoundCloudMixChapter,
} from '../drivers/SoundCloudDriver';
import { fetchTrackLyrics, type TrackLyricsResponse } from '../drivers/appleApi';
import { getSourceThemeForTrack, getSourceThemeCssVars } from '../theme/sourceTheme';
import { PlayerUpNextStrip } from './player/PlayerUpNextStrip';
import { PlayerSelectModal } from './player/PlayerSelectModal';
import { PlayerVideoStage } from './player/PlayerVideoStage';
import { type ActiveCommentBubble, formatCommentTs, PlayerTransportBar } from './player/PlayerTransportBar';

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
  content_rating?: string | null;
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
              content_rating: iaDetail.summary.content_rating ?? null,
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
      <PlayerUpNextStrip
        hasUpNext={hasUpNext}
        snap={snap}
        isVideoTrack={isVideoTrack}
        videoTheatreExpanded={videoTheatreExpanded}
        isForegroundFaded={isForegroundFaded}
        idleOpacityPct={idleOpacityPct}
        effectiveScale={effectiveScale}
      />

      <PlayerVideoStage
        snap={snap}
        track={track}
        isPlaying={isPlaying}
        handleMoreByArtist={handleMoreByArtist}
        showToast={showToast}
        isVideoTrack={isVideoTrack}
        scTrackUserId={scTrackUserId}
        scTrackPermalink={scTrackPermalink}
        vizMode={vizMode}
        idleOpacityPct={idleOpacityPct}
        artBoxRef={artBoxRef}
        videoRef={videoRef}
        videoTheatreExpanded={videoTheatreExpanded}
        setVideoTheatreExpanded={setVideoTheatreExpanded}
        hudVisible={hudVisible}
        lastTimeReportMsRef={lastTimeReportMsRef}
        pendingResumeTimeSecRef={pendingResumeTimeSecRef}
        videoQualities={videoQualities}
        selectedQualityIdx={selectedQualityIdx}
        setSelectedQualityIdx={setSelectedQualityIdx}
        videoSubtitles={videoSubtitles}
        resolvedSubtitleBlobUrl={resolvedSubtitleBlobUrl}
        setVideoErrorMsg={setVideoErrorMsg}
        videoErrorMsg={videoErrorMsg}
        dvdSeekOffsetSec={dvdSeekOffsetSec}
        activeSubtitle={activeSubtitle}
        activeQuality={activeQuality}
        activeStreamUrl={activeStreamUrl}
        cycleVideoQuality={cycleVideoQuality}
        cycleVideoSubtitles={cycleVideoSubtitles}
        handleOpenCurrentCollection={handleOpenCurrentCollection}
        primaryArtist={primaryArtist}
        isForegroundFaded={isForegroundFaded}
        effectiveScale={effectiveScale}
        hasUpNext={hasUpNext}
      />

      <PlayerTransportBar
        hidden={hidden}
        snap={snap}
        track={track}
        isPlaying={isPlaying}
        isSoundCloudTrack={isSoundCloudTrack}
        isVideoTrack={isVideoTrack}
        scCommentsEnabled={scCommentsEnabled}
        scWaveformBars={scWaveformBars}
        trackPropsState={trackPropsState}
        lyricsKaraokeEnabled={lyricsKaraokeEnabled}
        idleOpacityPct={idleOpacityPct}
        lyricsData={lyricsData}
        activeLyricIdx={activeLyricIdx}
        activeBubbles={activeBubbles}
        playerScale={playerScale}
        scrubRowRef={scrubRowRef}
        buttonsRowRef={buttonsRowRef}
        scrubOffsetLeftPx={scrubOffsetLeftPx}
        buttonsOffsetLeftPx={buttonsOffsetLeftPx}
        buttonsFitScale={buttonsFitScale}
        videoTheatreExpanded={videoTheatreExpanded}
        commentTimestampsMs={commentTimestampsMs}
        handlePlayheadTick={handlePlayheadTick}
        isForegroundFaded={isForegroundFaded}
        effectiveScale={effectiveScale}
        buttonsBottomPx={buttonsBottomPx}
        scrubBottomPx={scrubBottomPx}
        playerTheme={playerTheme}
      />
      </main>

      {/* Unified Two-Column Controller-First `SELECT` Track & Queue Actions Overlay Menu */}
      <PlayerSelectModal
        playerActionsOpen={playerActionsOpen}
        setPlayerActionsOpen={setPlayerActionsOpen}
        track={track}
        selectCategory={selectCategory}
        setSelectCategory={setSelectCategory}
        handleOpenCurrentCollection={handleOpenCurrentCollection}
        activeRightColItems={activeRightColItems}
        isSoundCloudTrack={isSoundCloudTrack}
        isVideoTrack={isVideoTrack}
        handleFavoriteTrack={handleFavoriteTrack}
        showToast={showToast}
        isCurrentTrackFavorited={isCurrentTrackFavorited}
        handleAddAppleToCloudLibrary={handleAddAppleToCloudLibrary}
        handleAddTracksToPlaylist={handleAddTracksToPlaylist}
        primaryArtist={primaryArtist}
        handleStartSoundCloudTrackRadio={handleStartSoundCloudTrackRadio}
        handleMoreByArtist={handleMoreByArtist}
        scTrackUserId={scTrackUserId}
        setVideoTheatreExpanded={setVideoTheatreExpanded}
        scCreatorFollowed={scCreatorFollowed}
        setScCreatorFollowed={setScCreatorFollowed}
        playerTheme={playerTheme}
        rightColMode={rightColMode}
        chapterModalItems={chapterModalItems}
        currentQueueIdx={currentQueueIdx}
        queueModalItems={queueModalItems}
        setRightColMode={setRightColMode}
        togglePlayerFullscreen={togglePlayerFullscreen}
        isFullscreen={isFullscreen}
        setVizDrawerOpen={setVizDrawerOpen}
        vizMode={vizMode}
        enabledVizScenes={enabledVizScenes}
        setEqualizerOpen={setEqualizerOpen}
        dspState={dspState}
        handleToggleKaraokeMode={handleToggleKaraokeMode}
        lyricsKaraokeEnabled={lyricsKaraokeEnabled}
        toggleLyricsKaraoke={toggleLyricsKaraoke}
        lyricsData={lyricsData}
        toggleLyricsViz={toggleLyricsViz}
        lyricsVizEnabled={lyricsVizEnabled}
        toggleFactoids={toggleFactoids}
        factoidsEnabled={factoidsEnabled}
        factoidBubbles={factoidBubbles}
        idleFadeEnabled={idleFadeEnabled}
        toggleIdleFade={toggleIdleFade}
        idleOpacityPct={idleOpacityPct}
        updateIdleOpacityPct={updateIdleOpacityPct}
        toggleScComments={toggleScComments}
        scCommentsEnabled={scCommentsEnabled}
        scComments={scComments}
        toggleTheatreFullscreen={toggleTheatreFullscreen}
        videoTheatreExpanded={videoTheatreExpanded}
        cycleVideoQuality={cycleVideoQuality}
        activeQuality={activeQuality}
        videoQualities={videoQualities}
        selectedQualityIdx={selectedQualityIdx}
        cycleVideoSubtitles={cycleVideoSubtitles}
        activeSubtitle={activeSubtitle}
        videoSubtitles={videoSubtitles}
      />

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

import React from 'react';
import {
  defaultSimpClient,
  SimpStateSnapshot,
  TrackMetadata,
  VideoQualityVariant,
  VideoSubtitleVariant,
} from '@simp/client';
import { ProgressBarRaf } from '../../components/ProgressBarRaf';
import { type VisualizerMode } from '../../components/PlayerBackgroundVisualizer';
import { SoundCloudAttributionLink } from '../../components/SoundCloudLogo';
import { AppleMusicAttributionLink } from '../../components/AppleMusicLogo';
import { ContentRatingBadge } from '../library/ContentRatingBadge';
import { TransportIconButton } from './PlayerTransportBar';

export interface PlayerVideoStageProps {
  snap: SimpStateSnapshot | null;
  track: TrackMetadata | null | undefined;
  isPlaying: boolean;
  handleMoreByArtist?: (
    artistName: string,
    preferredSource?: string,
    artistId?: string
  ) => void;
  showToast?: (msg: string) => void;
  isVideoTrack: boolean;
  scTrackUserId: string | null;
  scTrackPermalink: string | null;
  vizMode: VisualizerMode;
  idleOpacityPct: number;
  artBoxRef: React.RefObject<HTMLDivElement | null>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoTheatreExpanded: boolean;
  setVideoTheatreExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  hudVisible: boolean;
  lastTimeReportMsRef: React.RefObject<number>;
  pendingResumeTimeSecRef: React.RefObject<number>;
  videoQualities: VideoQualityVariant[];
  selectedQualityIdx: number;
  setSelectedQualityIdx: React.Dispatch<React.SetStateAction<number>>;
  videoSubtitles: VideoSubtitleVariant[];
  resolvedSubtitleBlobUrl: string | null;
  setVideoErrorMsg: React.Dispatch<React.SetStateAction<string | null>>;
  videoErrorMsg: string | null;
  dvdSeekOffsetSec: number;
  activeSubtitle: VideoSubtitleVariant | null;
  activeQuality: VideoQualityVariant | null;
  activeStreamUrl: string;
  cycleVideoQuality: () => void;
  cycleVideoSubtitles: () => void;
  handleOpenCurrentCollection: () => void;
  primaryArtist: string;
  isForegroundFaded: boolean;
  effectiveScale: number;
  hasUpNext: boolean;
}

export const PlayerVideoStage: React.FC<PlayerVideoStageProps> = ({
  snap,
  track,
  isPlaying,
  handleMoreByArtist,
  showToast,
  isVideoTrack,
  scTrackUserId,
  scTrackPermalink,
  vizMode,
  idleOpacityPct,
  artBoxRef,
  videoRef,
  videoTheatreExpanded,
  setVideoTheatreExpanded,
  hudVisible,
  lastTimeReportMsRef,
  pendingResumeTimeSecRef,
  videoQualities,
  selectedQualityIdx,
  setSelectedQualityIdx,
  videoSubtitles,
  resolvedSubtitleBlobUrl,
  setVideoErrorMsg,
  videoErrorMsg,
  dvdSeekOffsetSec,
  activeSubtitle,
  activeQuality,
  activeStreamUrl,
  cycleVideoQuality,
  cycleVideoSubtitles,
  handleOpenCurrentCollection,
  primaryArtist,
  isForegroundFaded,
  effectiveScale,
  hasUpNext,
}) => {
  return (
    <>
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
          <ContentRatingBadge
            rating={track?.content_rating}
            style={{ marginLeft: 8, verticalAlign: 'middle' }}
          />
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
    </>
  );
};

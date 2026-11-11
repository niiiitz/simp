import React, { useEffect, useState } from 'react';
import { ImpIcon } from './icons/ImpIcon';
import { getSourceThemeForTrack, getSourceThemeCssVars } from '../theme/sourceTheme';
import { VISUALIZER_SCENES } from './visualizers/sceneRegistry';

export interface TrackPropertiesData {
  uri: string;
  has_art: boolean;
  has_lyrics: boolean;
  has_synced_lyrics: boolean;
  has_comments: boolean;
  has_factoids: boolean;
  suppress_lyrics: boolean;
  suppress_comments: boolean;
  suppress_factoids: boolean;
  lyrics_offset_ms: number;
  custom_art_url?: string | null;
  preferred_viz_mode?: string | null;
  updated_at?: number;
}

export interface TrackPropertiesTarget {
  uri: string;
  title: string;
  artists: string[];
  album?: string;
  duration_ms?: number;
  art_url?: string | null;
  source?: string;
}

interface TrackPropertiesModalProps {
  track: TrackPropertiesTarget | null;
  onClose: () => void;
  onToast?: (msg: string) => void;
}

export const TrackPropertiesModal: React.FC<TrackPropertiesModalProps> = ({
  track,
  onClose,
  onToast,
}) => {
  const [propsData, setPropsData] = useState<TrackPropertiesData | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  useEffect(() => {
    if (!track?.uri) return;
    let cancelled = false;
    setLoading(true);
    fetch(`http://127.0.0.1:18888/api/library/track-properties?uri=${encodeURIComponent(track.uri)}`)
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled && json?.ok && json.data) {
          setPropsData(json.data);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [track?.uri]);

  if (!track) return null;

  const theme = getSourceThemeForTrack(track.uri, track.source);
  const cssVars = getSourceThemeCssVars(theme);

  const applyPatch = async (patch: Partial<TrackPropertiesData>, toastMsg?: string) => {
    if (!track.uri) return;
    setBusyAction('patch');
    try {
      const resp = await fetch('http://127.0.0.1:18888/api/library/track-properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uri: track.uri, ...patch }),
      });
      const json = await resp.json();
      if (json?.ok && json.data) {
        setPropsData(json.data);
        window.dispatchEvent(
          new CustomEvent('simp-track-properties-updated', {
            detail: { uri: track.uri, properties: json.data },
          }),
        );
        if (toastMsg && onToast) onToast(toastMsg);
      }
    } catch {
      if (onToast) onToast('Failed to update track properties');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRefetchLyrics = async () => {
    if (!track.uri) return;
    setBusyAction('lyrics');
    try {
      const resp = await fetch('http://127.0.0.1:18888/api/lyrics/refetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uri: track.uri,
          title: track.title,
          artist: (track.artists || []).join(', '),
          album: track.album || '',
          duration_ms: track.duration_ms || 0,
        }),
      });
      const json = await resp.json();
      if (json?.ok) {
        if (json.properties) setPropsData(json.properties);
        window.dispatchEvent(
          new CustomEvent('simp-track-properties-updated', {
            detail: {
              uri: track.uri,
              properties: json.properties,
              lyrics: json.data,
            },
          }),
        );
        const found = json.data?.found;
        const syncedCount = json.data?.synced_lines?.length || 0;
        if (onToast) {
          onToast(
            found
              ? syncedCount > 0
                ? `Refetched synced lyrics (${syncedCount} lines)`
                : 'Refetched plain lyrics'
              : 'Cleared lyrics cache — no matching lyrics found',
          );
        }
      }
    } catch {
      if (onToast) onToast('Failed to refetch lyrics');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRefetchFactoids = async () => {
    if (!track.uri) return;
    setBusyAction('factoids');
    try {
      const resp = await fetch('http://127.0.0.1:18888/api/factoids/refetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uri: track.uri,
          title: track.title,
          artist: (track.artists || []).join(', '),
          album: track.album || '',
          duration_ms: track.duration_ms || 0,
        }),
      });
      const json = await resp.json();
      if (json?.ok) {
        if (json.properties) setPropsData(json.properties);
        window.dispatchEvent(
          new CustomEvent('simp-track-properties-updated', {
            detail: {
              uri: track.uri,
              properties: json.properties,
              factoids: json.data,
            },
          }),
        );
        const found = json.data?.found;
        const count = json.data?.bubbles?.length || 0;
        if (onToast) {
          onToast(
            found && count > 0
              ? `Refetched ${count} Pop-Up Factoid bubble${count === 1 ? '' : 's'}`
              : 'Cleared factoid cache — no encyclopedia trivia found',
          );
        }
      }
    } catch {
      if (onToast) onToast('Failed to refetch Pop-Up Factoids');
    } finally {
      setBusyAction(null);
    }
  };

  const offsetMs = propsData?.lyrics_offset_ms ?? 0;

  return (
    <div
      data-modal-root="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9950,
        background: 'rgba(4, 7, 13, 0.82)',
        backdropFilter: 'blur(12px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        ...cssVars,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(560px, 94vw)',
          maxHeight: '88vh',
          overflowY: 'auto',
          borderRadius: 16,
          background: 'linear-gradient(180deg, rgba(15, 22, 34, 0.98), rgba(9, 13, 21, 0.99))',
          border: `1px solid ${theme.accentBorder}`,
          boxShadow: `0 22px 55px rgba(0, 0, 0, 0.7), 0 0 28px ${theme.accentMuted}`,
          padding: '18px 20px',
          color: '#f1f5f9',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                background: theme.accentMuted,
                border: `1px solid ${theme.accentBorder}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: theme.accent,
                flexShrink: 0,
              }}
            >
              <ImpIcon name="sliders" size={17} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: '0.02em' }}>
                Track Properties & Local Curation
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: '#94a3b8',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {track.title} — {(track.artists || []).join(', ') || 'Unknown Artist'}
              </div>
            </div>
          </div>
          <button
            data-focusable="true"
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.14)',
              borderRadius: 8,
              color: '#cbd5e1',
              padding: '6px 10px',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            <ImpIcon name="close" size={14} />
            Close
          </button>
        </div>

        {loading && !propsData ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
            Loading track properties…
          </div>
        ) : (
          <>
            {/* Section 1: Lyrics Curation */}
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 12,
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 800, color: theme.accent }}>
                  <ImpIcon name="lyrics" size={15} />
                  <span>Lyrics & Sync (`lyrics.db`)</span>
                </div>
                <span
                  style={{
                    fontSize: 11,
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: propsData?.suppress_lyrics
                      ? 'rgba(244, 63, 94, 0.16)'
                      : propsData?.has_synced_lyrics
                        ? 'rgba(52, 211, 153, 0.16)'
                        : 'rgba(148, 163, 184, 0.14)',
                    color: propsData?.suppress_lyrics
                      ? '#fda4af'
                      : propsData?.has_synced_lyrics
                        ? '#6ee7b7'
                        : '#cbd5e1',
                    fontWeight: 700,
                  }}
                >
                  {propsData?.suppress_lyrics
                    ? 'Suppressed'
                    : propsData?.has_synced_lyrics
                      ? 'Synced LRC Ready'
                      : propsData?.has_lyrics
                        ? 'Plain Lyrics'
                        : 'Not Cached'}
                </span>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button
                  data-focusable="true"
                  disabled={busyAction === 'lyrics'}
                  onClick={handleRefetchLyrics}
                  style={{
                    padding: '7px 12px',
                    borderRadius: 8,
                    border: `1px solid ${theme.accentBorder}`,
                    background: theme.accentMuted,
                    color: '#f8fafc',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <ImpIcon name="refresh" size={14} color={theme.accent} />
                  {busyAction === 'lyrics' ? 'Refetching…' : 'Refetch Lyrics'}
                </button>

                <button
                  data-focusable="true"
                  onClick={() =>
                    applyPatch(
                      { suppress_lyrics: !propsData?.suppress_lyrics },
                      !propsData?.suppress_lyrics
                        ? 'Lyrics suppressed for this track'
                        : 'Lyrics re-enabled for this track',
                    )
                  }
                  style={{
                    padding: '7px 12px',
                    borderRadius: 8,
                    border: propsData?.suppress_lyrics
                      ? '1px solid rgba(244, 63, 94, 0.55)'
                      : '1px solid rgba(255,255,255,0.14)',
                    background: propsData?.suppress_lyrics
                      ? 'rgba(244, 63, 94, 0.18)'
                      : 'rgba(255,255,255,0.05)',
                    color: propsData?.suppress_lyrics ? '#fecdd3' : '#e2e8f0',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <ImpIcon name="ban" size={14} />
                  {propsData?.suppress_lyrics ? 'Unsuppress Lyrics' : 'Suppress Lyrics / Mark Wrong'}
                </button>
              </div>

              {/* Sync Offset Stepper */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingTop: 6,
                  borderTop: '1px solid rgba(255,255,255,0.06)',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#cbd5e1' }}>
                  <ImpIcon name="clock" size={14} color="#94a3b8" />
                  <span>Sync Offset:</span>
                  <strong style={{ color: offsetMs === 0 ? '#94a3b8' : theme.accent }}>
                    {offsetMs > 0 ? `+${offsetMs}ms` : `${offsetMs}ms`}
                  </strong>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    data-focusable="true"
                    onClick={() => applyPatch({ lyrics_offset_ms: offsetMs - 250 })}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 7,
                      border: '1px solid rgba(255,255,255,0.14)',
                      background: 'rgba(255,255,255,0.06)',
                      color: '#f1f5f9',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    -250ms
                  </button>
                  <button
                    data-focusable="true"
                    disabled={offsetMs === 0}
                    onClick={() => applyPatch({ lyrics_offset_ms: 0 }, 'Reset lyric sync offset to 0ms')}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 7,
                      border: '1px solid rgba(255,255,255,0.12)',
                      background: 'rgba(255,255,255,0.04)',
                      color: offsetMs === 0 ? '#64748b' : '#cbd5e1',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: offsetMs === 0 ? 'default' : 'pointer',
                    }}
                  >
                    0ms
                  </button>
                  <button
                    data-focusable="true"
                    onClick={() => applyPatch({ lyrics_offset_ms: offsetMs + 250 })}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 7,
                      border: '1px solid rgba(255,255,255,0.14)',
                      background: 'rgba(255,255,255,0.06)',
                      color: '#f1f5f9',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    +250ms
                  </button>
                </div>
              </div>
            </div>

            {/* Section 2: Artwork Curation */}
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 12,
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 800, color: theme.accent }}>
                  <ImpIcon name={propsData?.has_art ? 'artwork' : 'artwork-missing'} size={15} />
                  <span>Artwork & Cover Cache</span>
                </div>
                <span style={{ fontSize: 11, color: propsData?.has_art ? '#6ee7b7' : '#fbbf24', fontWeight: 700 }}>
                  {propsData?.has_art ? 'Artwork Present' : 'Missing Artwork'}
                </span>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button
                  data-focusable="true"
                  onClick={() =>
                    applyPatch(
                      { has_art: Boolean(track.art_url), custom_art_url: '' },
                      'Refreshed cover artwork state for track',
                    )
                  }
                  style={{
                    padding: '7px 12px',
                    borderRadius: 8,
                    border: `1px solid ${theme.accentBorder}`,
                    background: theme.accentMuted,
                    color: '#f8fafc',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <ImpIcon name="refresh" size={14} color={theme.accent} />
                  Refetch Cover Art
                </button>

                <button
                  data-focusable="true"
                  onClick={() =>
                    applyPatch(
                      { has_art: false, custom_art_url: '' },
                      'Marked track as missing artwork',
                    )
                  }
                  style={{
                    padding: '7px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.14)',
                    background: 'rgba(255,255,255,0.05)',
                    color: '#cbd5e1',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <ImpIcon name="artwork-missing" size={14} />
                  Clear Cached Art Flag
                </button>
              </div>
            </div>

            {/* Section 3: Visualizer Overlay Suppression */}
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 12,
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 800, color: theme.accent }}>
                <ImpIcon name="sparkles" size={15} />
                <span>Visualizer Overlays (Per-Track)</span>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button
                  data-focusable="true"
                  onClick={() =>
                    applyPatch(
                      { suppress_comments: !propsData?.suppress_comments },
                      !propsData?.suppress_comments
                        ? 'Timed comments suppressed on this track'
                        : 'Timed comments enabled on this track',
                    )
                  }
                  style={{
                    padding: '7px 12px',
                    borderRadius: 8,
                    border: propsData?.suppress_comments
                      ? '1px solid rgba(244, 63, 94, 0.55)'
                      : '1px solid rgba(255,255,255,0.14)',
                    background: propsData?.suppress_comments
                      ? 'rgba(244, 63, 94, 0.18)'
                      : 'rgba(255,255,255,0.05)',
                    color: propsData?.suppress_comments ? '#fecdd3' : '#e2e8f0',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <ImpIcon name="comments" size={14} />
                  {propsData?.suppress_comments
                    ? 'Timed Comments: Suppressed'
                    : 'Suppress Timed Comments on Track'}
                </button>

                <button
                  data-focusable="true"
                  onClick={() =>
                    applyPatch(
                      { suppress_factoids: !propsData?.suppress_factoids },
                      !propsData?.suppress_factoids
                        ? 'Pop-Up Factoids suppressed on this track'
                        : 'Pop-Up Factoids enabled on this track',
                    )
                  }
                  style={{
                    padding: '7px 12px',
                    borderRadius: 8,
                    border: propsData?.suppress_factoids
                      ? '1px solid rgba(244, 63, 94, 0.55)'
                      : '1px solid rgba(255,255,255,0.14)',
                    background: propsData?.suppress_factoids
                      ? 'rgba(244, 63, 94, 0.18)'
                      : 'rgba(255,255,255,0.05)',
                    color: propsData?.suppress_factoids ? '#fecdd3' : '#e2e8f0',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <ImpIcon name="factoid" size={14} />
                  {propsData?.suppress_factoids
                    ? 'Pop-Up Factoids: Suppressed'
                    : 'Suppress Pop-Up Factoids on Track'}
                </button>

                <button
                  data-focusable="true"
                  disabled={busyAction === 'factoids'}
                  onClick={handleRefetchFactoids}
                  style={{
                    padding: '7px 12px',
                    borderRadius: 8,
                    border: `1px solid ${theme.accentBorder}`,
                    background: theme.accentMuted,
                    color: theme.accent,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: busyAction === 'factoids' ? 'wait' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <ImpIcon name="refresh" size={14} />
                  {busyAction === 'factoids' ? 'Refetching Factoids…' : 'Refetch Pop-Up Factoids'}
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>
                  Preferred Visualizer Scene (Per-Track Override)
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <button
                    data-focusable="true"
                    onClick={() => applyPatch({ preferred_viz_mode: '' }, 'Cleared per-track visualizer override')}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 999,
                      border: !propsData?.preferred_viz_mode
                        ? `1px solid ${theme.accentBorder}`
                        : '1px solid rgba(255,255,255,0.12)',
                      background: !propsData?.preferred_viz_mode
                        ? theme.accentMuted
                        : 'rgba(255,255,255,0.04)',
                      color: !propsData?.preferred_viz_mode ? theme.accent : '#cbd5e1',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Global Default
                  </button>
                  {VISUALIZER_SCENES.map((meta) => {
                    const active = propsData?.preferred_viz_mode === meta.id;
                    return (
                      <button
                        key={meta.id}
                        data-focusable="true"
                        onClick={() =>
                          applyPatch(
                            { preferred_viz_mode: meta.id },
                            `Pinned visualizer "${meta.shortLabel}" to this track`,
                          )
                        }
                        style={{
                          padding: '5px 10px',
                          borderRadius: 999,
                          border: active
                            ? `1px solid ${theme.accentBorder}`
                            : '1px solid rgba(255,255,255,0.12)',
                          background: active ? theme.accentMuted : 'rgba(255,255,255,0.04)',
                          color: active ? theme.accent : '#cbd5e1',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {meta.shortLabel}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

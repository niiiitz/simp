import React from 'react';
import { PlaylistRecord, TrackMetadata } from '@simp/client';
import { OskTargetKind } from '../hooks/useGamepadNavigation';

export interface PendingHybridAddJob {
  uris: string[];
  label: string;
  trackMetadata?: TrackMetadata[];
  creatingNew?: boolean;
}

export interface HybridPlaylistPickerModalProps {
  pendingHybridAdd: PendingHybridAddJob | null;
  setPendingHybridAdd: React.Dispatch<React.SetStateAction<PendingHybridAddJob | null>>;
  setOskTarget: React.Dispatch<React.SetStateAction<OskTargetKind>>;
  playlists: PlaylistRecord[];
  activePlaylistId: string;
  commitAddTracksToPlaylist: (
    uris: string[],
    label: string,
    trackMetadata?: TrackMetadata[],
    explicitPlaylistId?: string,
    createNewName?: string
  ) => Promise<void>;
  setNewPlaylistName: React.Dispatch<React.SetStateAction<string>>;
  applyFocusMarker: (el: HTMLElement | null) => void;
  newPlaylistName: string;
}

export const HybridPlaylistPickerModal: React.FC<HybridPlaylistPickerModalProps> = ({
  pendingHybridAdd,
  setPendingHybridAdd,
  setOskTarget,
  playlists,
  activePlaylistId,
  commitAddTracksToPlaylist,
  setNewPlaylistName,
  applyFocusMarker,
  newPlaylistName,
}) => {
  return (
    <>
      {pendingHybridAdd && (
        <div
          onClick={() => {
            setPendingHybridAdd(null);
            setOskTarget(null);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.86)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            boxSizing: 'border-box',
            zIndex: 80,
          }}
        >
          <div
            data-modal-root="true"
            data-hybrid-picker-modal="true"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 460,
              maxHeight: '82vh',
              overflowY: 'auto',
              background: '#0a0a0e',
              border: '2px solid #2aa3c4',
              borderRadius: 18,
              padding: 20,
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              boxShadow: '0 16px 40px rgba(0, 0, 0, 0.85)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#bfeaf5' }}>
                  ★ Add to IMP Hybrid Playlist
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: '#8e8e99',
                    marginTop: 2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Adding {pendingHybridAdd.label}
                </div>
              </div>
              <button
                data-hybrid-picker-close="true"
                onClick={() => {
                  setPendingHybridAdd(null);
                  setOskTarget(null);
                }}
                style={{
                  minHeight: 38,
                  padding: '0 12px',
                  borderRadius: 9,
                  background: '#16161f',
                  border: '1px solid #2e2e3a',
                  color: '#d4d4dc',
                  fontFamily: 'monospace',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                ✕<span className="simp-gp-badge"> B</span>
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {[...playlists]
                .sort((a, b) => (a.origin === 'simp_local' ? -1 : 1) - (b.origin === 'simp_local' ? -1 : 1))
                .map((p, idx) => {
                  const isPinned = Boolean(p.origin && p.origin !== 'simp_local');
                  const isPreferred =
                    p.id === activePlaylistId || (!activePlaylistId && idx === 0);
                  return (
                    <button
                      key={p.id}
                      data-default-focus={
                        !pendingHybridAdd.creatingNew && isPreferred ? 'true' : undefined
                      }
                      onClick={() => {
                        const job = pendingHybridAdd;
                        setPendingHybridAdd(null);
                        setOskTarget(null);
                        commitAddTracksToPlaylist(
                          job.uris,
                          job.label,
                          job.trackMetadata,
                          p.id
                        );
                      }}
                      style={{
                        minHeight: 44,
                        padding: '0 14px',
                        borderRadius: 10,
                        background: isPreferred ? '#0f222a' : '#101018',
                        border: isPreferred ? '1px solid #2aa3c4' : '1px solid #222230',
                        color: '#e4e4ec',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 10,
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 800, color: isPinned ? '#fde68a' : '#bfeaf5' }}>
                        {isPinned ? '📌 ' : '★ '}
                        {p.name}
                      </span>
                      <span style={{ fontSize: 11, fontFamily: 'monospace', color: isPinned ? '#fbbf24' : '#67e8f9' }}>
                        {isPinned
                          ? `Fork to Hybrid • ${p.track_count}`
                          : `${p.track_count} ${p.track_count === 1 ? 'track' : 'tracks'}`}
                      </span>
                    </button>
                  );
                })}
            </div>

            {/* Only shown when > 1 Hybrid Playlist already exists */}
            {!pendingHybridAdd.creatingNew ? (
              <button
                onClick={() => {
                  setNewPlaylistName('');
                  setPendingHybridAdd((prev) =>
                    prev ? { ...prev, creatingNew: true } : null
                  );
                  if (document.documentElement.dataset.simpInput === 'gamepad') {
                    setOskTarget('playlist');
                    if (window.parent && window.parent !== window) {
                      window.parent.postMessage({ type: 'SIMP_OPEN_OSK' }, '*');
                    }
                    window.setTimeout(() => {
                      const firstKey = document.querySelector<HTMLElement>(
                        '[data-osk-root="true"] button[data-default-focus="true"], [data-osk-root="true"] button'
                      );
                      if (firstKey) applyFocusMarker(firstKey);
                    }, 40);
                  } else {
                    window.setTimeout(() => {
                      const inp = document.querySelector<HTMLInputElement>(
                        '[data-hybrid-picker-modal="true"] input[data-osk-input="playlist"]'
                      );
                      inp?.focus();
                    }, 30);
                  }
                }}
                style={{
                  minHeight: 42,
                  padding: '0 14px',
                  borderRadius: 10,
                  background: '#121822',
                  border: '1px dashed #2aa3c4',
                  color: '#67e8f9',
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                + Add to New IMP Playlist...
              </button>
            ) : (
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  padding: 10,
                  borderRadius: 10,
                  background: '#0c161c',
                  border: '1px solid #2aa3c4',
                }}
              >
                <input
                  type="text"
                  data-osk-input="playlist"
                  placeholder="New IMP Playlist name..."
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  onClick={() => {
                    if (document.documentElement.dataset.simpInput === 'gamepad') {
                      setOskTarget('playlist');
                      if (window.parent && window.parent !== window) {
                        window.parent.postMessage({ type: 'SIMP_OPEN_OSK' }, '*');
                      }
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const job = pendingHybridAdd;
                      const chosenName = newPlaylistName;
                      setPendingHybridAdd(null);
                      setOskTarget(null);
                      commitAddTracksToPlaylist(
                        job.uris,
                        job.label,
                        job.trackMetadata,
                        undefined,
                        chosenName
                      );
                    }
                  }}
                  style={{
                    flex: 1,
                    minHeight: 38,
                    padding: '0 12px',
                    borderRadius: 8,
                    background: '#08080c',
                    border: '1px solid #2e2e3c',
                    color: '#d4d4dc',
                    fontSize: 12,
                  }}
                />
                <button
                  data-hybrid-picker-submit="true"
                  data-default-focus="true"
                  onClick={() => {
                    const job = pendingHybridAdd;
                    const chosenName = newPlaylistName;
                    setPendingHybridAdd(null);
                    setOskTarget(null);
                    commitAddTracksToPlaylist(
                      job.uris,
                      job.label,
                      job.trackMetadata,
                      undefined,
                      chosenName
                    );
                  }}
                  style={{
                    minHeight: 38,
                    padding: '0 14px',
                    borderRadius: 8,
                    background: '#0f222a',
                    color: '#bfeaf5',
                    border: '1px solid #2aa3c4',
                    fontWeight: 800,
                    fontSize: 12,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  Create & Add
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

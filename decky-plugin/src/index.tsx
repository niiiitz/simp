import React, { useEffect, useState } from 'react';
import { defaultSimpClient, SimpStateSnapshot } from '@simp/client';

/**
 * Pilot Phase 2: Lightweight Decky Loader QAM (`...` Menu) Drawer.
 * Connects directly to `simp --daemon` over `ws://127.0.0.1:18888/ws` with zero Python audio glue.
 */
export const SimpDeckyDrawer: React.FC = () => {
  const [snap, setSnap] = useState<SimpStateSnapshot | null>(null);

  useEffect(() => {
    defaultSimpClient.connect();
    return defaultSimpClient.subscribeState((s) => setSnap({ ...s }));
  }, []);

  const track = snap?.current_track;

  return (
    <div style={{ padding: 12, color: '#fff', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ padding: 12, borderRadius: 12, background: '#000', border: '1px solid #262630' }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{track?.title || 'SIMP Ready'}</div>
        <div style={{ fontSize: 12, color: '#a1a1aa' }}>
          {track?.artists?.join(', ') || 'Daemon Connected (:18888)'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 12 }}>
          <button onClick={() => defaultSimpClient.previous()} style={{ minHeight: 48 }}>⏮</button>
          <button onClick={() => defaultSimpClient.togglePlayPause()} style={{ minHeight: 48 }}>
            {snap?.is_playing ? '⏸' : '▶'}
          </button>
          <button onClick={() => defaultSimpClient.next()} style={{ minHeight: 48 }}>⏭</button>
          <button onClick={() => defaultSimpClient.setShuffle(!snap?.shuffle)} style={{ minHeight: 48 }}>
            🔀
          </button>
        </div>
      </div>
    </div>
  );
};


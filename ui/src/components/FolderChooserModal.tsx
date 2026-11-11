import React, { useEffect, useState } from 'react';
import { ImpIcon } from './icons/ImpIcon';

interface FsRootItem {
  label: string;
  path: string;
  kind: string;
}

interface FsDirEntry {
  name: string;
  path: string;
  media_count: number;
}

interface FolderChooserModalProps {
  open: boolean;
  initialPath?: string;
  onSelectFolder: (folderPath: string, suggestedLabel: string) => void;
  onClose: () => void;
}

export const FolderChooserModal: React.FC<FolderChooserModalProps> = ({
  open,
  initialPath,
  onSelectFolder,
  onClose,
}) => {
  const [roots, setRoots] = useState<FsRootItem[]>([]);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [mediaFileCount, setMediaFileCount] = useState<number>(0);
  const [directories, setDirectories] = useState<FsDirEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const loadDirectory = async (pathToLoad?: string) => {
    setLoading(true);
    setError(null);
    try {
      const q = pathToLoad ? `?path=${encodeURIComponent(pathToLoad)}` : '';
      const resp = await fetch(`http://127.0.0.1:18888/api/fs/list${q}`);
      const json = await resp.json();
      if (json?.ok && json.data) {
        setCurrentPath(json.data.current_path || '');
        setParentPath(json.data.parent_path || null);
        setMediaFileCount(json.data.media_file_count || 0);
        setDirectories(Array.isArray(json.data.directories) ? json.data.directories : []);
      } else {
        setError(json?.error || 'Unable to list directory');
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to browse filesystem');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    fetch('http://127.0.0.1:18888/api/fs/roots')
      .then((r) => r.json())
      .then((json) => {
        if (json?.ok && Array.isArray(json.roots)) {
          setRoots(json.roots);
        }
      })
      .catch(() => {});
    loadDirectory(initialPath?.trim() || undefined);
  }, [open]);

  if (!open) return null;

  const suggestedLabel = (() => {
    const cleaned = currentPath.replace(/[\\/]+$/, '');
    const parts = cleaned.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || currentPath || 'Local Folder';
  })();

  return (
    <div
      data-modal-root="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9960,
        background: 'rgba(4, 7, 13, 0.85)',
        backdropFilter: 'blur(14px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(760px, 95vw)',
          height: 'min(540px, 86vh)',
          borderRadius: 16,
          background: 'linear-gradient(180deg, rgba(15, 23, 36, 0.99), rgba(9, 13, 22, 0.99))',
          border: '1px solid rgba(52, 211, 153, 0.42)',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.75), 0 0 30px rgba(52, 211, 153, 0.14)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          color: '#f1f5f9',
        }}
      >
        {/* Top Bar */}
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 9,
                background: 'rgba(52, 211, 153, 0.14)',
                border: '1px solid rgba(52, 211, 153, 0.42)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#34d399',
              }}
            >
              <ImpIcon name="folder" size={16} />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800 }}>Browse Local Media Folders</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>
                Navigate with D-Pad or mouse and choose a folder to index
              </div>
            </div>
          </div>

          <button
            data-focusable="true"
            onClick={onClose}
            style={{
              padding: '6px 11px',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.14)',
              background: 'rgba(255,255,255,0.06)',
              color: '#cbd5e1',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <ImpIcon name="close" size={13} />
            Cancel
          </button>
        </div>

        {/* Breadcrumb / Current Path Bar */}
        <div
          style={{
            padding: '10px 18px',
            background: 'rgba(0, 0, 0, 0.28)',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
            <button
              data-focusable="true"
              disabled={!parentPath || parentPath === currentPath}
              onClick={() => parentPath && loadDirectory(parentPath)}
              style={{
                padding: '5px 10px',
                borderRadius: 7,
                border: '1px solid rgba(255,255,255,0.14)',
                background: 'rgba(255,255,255,0.06)',
                color: !parentPath || parentPath === currentPath ? '#64748b' : '#f1f5f9',
                fontSize: 11,
                fontWeight: 700,
                cursor: !parentPath || parentPath === currentPath ? 'default' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                flexShrink: 0,
              }}
            >
              <ImpIcon name="chevron-left" size={13} />
              Up
            </button>
            <div
              style={{
                fontFamily: 'monospace',
                fontSize: 12,
                color: '#6ee7b7',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={currentPath}
            >
              {currentPath || '/'}
            </div>
          </div>

          {mediaFileCount > 0 && (
            <span
              style={{
                fontSize: 11,
                padding: '3px 9px',
                borderRadius: 999,
                background: 'rgba(52, 211, 153, 0.16)',
                color: '#6ee7b7',
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {mediaFileCount} media file{mediaFileCount === 1 ? '' : 's'} here
            </span>
          )}
        </div>

        {/* Body: Left Roots Column + Right Subfolder List */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* Left Quick Places / Drives */}
          <div
            style={{
              width: '30%',
              borderRight: '1px solid rgba(255,255,255,0.08)',
              padding: 12,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              background: 'rgba(255,255,255,0.015)',
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '0.08em',
                color: '#94a3b8',
                textTransform: 'uppercase',
                marginBottom: 4,
              }}
            >
              Drives & Places
            </div>
            {roots.map((r) => {
              const active = currentPath === r.path;
              return (
                <button
                  key={r.path}
                  data-focusable="true"
                  onClick={() => loadDirectory(r.path)}
                  style={{
                    textAlign: 'left',
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: active
                      ? '1px solid rgba(52, 211, 153, 0.5)'
                      : '1px solid rgba(255,255,255,0.06)',
                    background: active ? 'rgba(52, 211, 153, 0.14)' : 'rgba(255,255,255,0.03)',
                    color: active ? '#6ee7b7' : '#e2e8f0',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <ImpIcon name="local" size={14} color={active ? '#34d399' : '#94a3b8'} />
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {r.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Right Directory Contents */}
          <div
            style={{
              flex: 1,
              padding: 12,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            {loading ? (
              <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                Reading directory…
              </div>
            ) : error ? (
              <div style={{ padding: 18, color: '#fda4af', fontSize: 12 }}>{error}</div>
            ) : directories.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>
                No subdirectories inside this folder.
              </div>
            ) : (
              directories.map((dir) => (
                <button
                  key={dir.path}
                  data-focusable="true"
                  onClick={() => loadDirectory(dir.path)}
                  style={{
                    padding: '9px 12px',
                    borderRadius: 9,
                    border: '1px solid rgba(255,255,255,0.07)',
                    background: 'rgba(255,255,255,0.03)',
                    color: '#f1f5f9',
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                    <ImpIcon name="folder" size={15} color="#34d399" />
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {dir.name}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {dir.media_count > 0 && (
                      <span
                        style={{
                          fontSize: 10.5,
                          padding: '2px 7px',
                          borderRadius: 999,
                          background: 'rgba(52, 211, 153, 0.14)',
                          color: '#6ee7b7',
                          fontWeight: 700,
                        }}
                      >
                        {dir.media_count} media
                      </span>
                    )}
                    <ImpIcon name="chevron-right" size={14} color="#64748b" />
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Footer Confirm Action */}
        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(0, 0, 0, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ fontSize: 12, color: '#94a3b8', minWidth: 0 }}>
            Selected: <strong style={{ color: '#e2e8f0' }}>{suggestedLabel}</strong>
          </div>
          <button
            data-focusable="true"
            disabled={!currentPath}
            onClick={() => {
              if (currentPath) {
                onSelectFolder(currentPath, suggestedLabel);
                onClose();
              }
            }}
            style={{
              padding: '8px 16px',
              borderRadius: 9,
              border: '1px solid rgba(52, 211, 153, 0.55)',
              background: 'linear-gradient(135deg, rgba(5, 150, 105, 0.42), rgba(52, 211, 153, 0.24))',
              color: '#ecfdf5',
              fontSize: 12.5,
              fontWeight: 800,
              cursor: currentPath ? 'pointer' : 'default',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
            }}
          >
            <ImpIcon name="folder-plus" size={15} color="#34d399" />
            Select This Folder
          </button>
        </div>
      </div>
    </div>
  );
};

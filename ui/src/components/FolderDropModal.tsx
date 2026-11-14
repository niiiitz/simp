import React from 'react';
import { disconnectAppleMusicCleanSlate } from '../drivers/AppleMusicDriver';
import { disconnectSoundCloudCleanSlate } from '../drivers/SoundCloudDriver';
import { ImpIcon } from './icons/ImpIcon';

export interface ExpiredAuthAlertState {
  provider: 'soundcloud' | 'apple';
  label: string;
  reason?: string;
}

export interface FolderDropModalProps {
  expiredAuthAlert: ExpiredAuthAlertState | null;
  setExpiredAuthAlert: React.Dispatch<React.SetStateAction<ExpiredAuthAlertState | null>>;
  setSourceModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  showToast: (msg: string) => void;
  pendingDroppedFolder: string | null;
  setPendingDroppedFolder: React.Dispatch<React.SetStateAction<string | null>>;
  handleAddFolder: (folderPath: string) => void;
}

export const FolderDropModal: React.FC<FolderDropModalProps> = ({
  expiredAuthAlert,
  setExpiredAuthAlert,
  setSourceModalOpen,
  showToast,
  pendingDroppedFolder,
  setPendingDroppedFolder,
  handleAddFolder,
}) => {
  return (
    <>
      {expiredAuthAlert && (
        <div
          data-expired-auth-banner="true"
          style={{
            position: 'fixed',
            top: 14,
            right: 16,
            zIndex: 9920,
            maxWidth: 440,
            padding: '12px 14px',
            borderRadius: 12,
            background: 'rgba(15, 22, 34, 0.97)',
            border: '1px solid rgba(250, 204, 21, 0.5)',
            boxShadow: '0 16px 40px rgba(0, 0, 0, 0.72)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            color: '#f8fafc',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 800, color: '#facc15' }}>
              <ImpIcon name="key" size={15} color="#facc15" />
              <span>{expiredAuthAlert.label} Session Needs Re-Sign-In</span>
            </div>
            <button
              data-expired-auth-close="true"
              onClick={() => setExpiredAuthAlert(null)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                padding: 2,
              }}
            >
              <ImpIcon name="close" size={14} />
            </button>
          </div>
          <div style={{ fontSize: 11.5, color: '#cbd5e1', lineHeight: 1.4 }}>
            Your {expiredAuthAlert.label} token has expired. Your pinned collections and hybrid playlists are safe in your local database.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <button
              data-focusable="true"
              onClick={() => {
                setExpiredAuthAlert(null);
                setSourceModalOpen(true);
              }}
              style={{
                padding: '6px 10px',
                borderRadius: 7,
                background: 'rgba(56, 189, 248, 0.16)',
                border: '1px solid rgba(56, 189, 248, 0.5)',
                color: '#bae6fd',
                fontSize: 11,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              Open Connected Accounts
            </button>
            <button
              data-focusable="true"
              onClick={async () => {
                const prov = expiredAuthAlert.provider;
                setExpiredAuthAlert(null);
                if (prov === 'apple') {
                  await disconnectAppleMusicCleanSlate(showToast);
                } else {
                  await disconnectSoundCloudCleanSlate(showToast);
                }
              }}
              style={{
                padding: '6px 10px',
                borderRadius: 7,
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.16)',
                color: '#e2e8f0',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Sign Out (Keep DB)
            </button>
            <button
              data-focusable="true"
              onClick={() => {
                localStorage.setItem('simp_mute_auth_reminders', '1');
                setExpiredAuthAlert(null);
                showToast('Muted proactive auth reminder notifications');
              }}
              style={{
                padding: '6px 10px',
                borderRadius: 7,
                background: 'transparent',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: '#94a3b8',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <ImpIcon name="bell-off" size={12} />
              Mute
            </button>
          </div>
        </div>
      )}

      {/* Dropped Folder Ingestion Confirmation Modal */}
      {pendingDroppedFolder && (
        <div
          data-modal-root="true"
          data-dropped-folder-modal="true"
          onClick={() => setPendingDroppedFolder(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9970,
            background: 'rgba(4, 7, 13, 0.82)',
            backdropFilter: 'blur(12px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(480px, 92vw)',
              borderRadius: 16,
              background: 'linear-gradient(180deg, rgba(15, 23, 36, 0.99), rgba(9, 13, 22, 0.99))',
              border: '1px solid rgba(52, 211, 153, 0.5)',
              boxShadow: '0 22px 55px rgba(0, 0, 0, 0.75)',
              padding: 20,
              color: '#f1f5f9',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <ImpIcon name="folder-plus" size={20} color="#34d399" />
              <div style={{ fontSize: 15, fontWeight: 800 }}>Add Folder to Local Folders?</div>
            </div>
            <div style={{ fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.45 }}>
              Index this folder into your local IMP library so its albums, tracks, artwork, and `.lrc` lyrics are available across all views:
            </div>
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                background: 'rgba(0, 0, 0, 0.38)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                fontFamily: 'monospace',
                fontSize: 12,
                color: '#6ee7b7',
                wordBreak: 'break-all',
              }}
            >
              {pendingDroppedFolder}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                data-focusable="true"
                data-dropped-folder-close="true"
                onClick={() => setPendingDroppedFolder(null)}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.14)',
                  color: '#cbd5e1',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                data-focusable="true"
                data-default-focus="true"
                ref={(el) => {
                  if (el && !el.hasAttribute('data-simp-active-focus')) {
                    window.setTimeout(() => {
                      if (!el.isConnected) return;
                      document
                        .querySelectorAll<HTMLElement>('[data-simp-active-focus="true"], .simp-gpfocus')
                        .forEach((node) => {
                          if (node !== el) {
                            node.removeAttribute('data-simp-active-focus');
                            node.classList.remove('simp-gpfocus');
                          }
                        });
                      el.setAttribute('data-simp-active-focus', 'true');
                      el.classList.add('simp-gpfocus');
                      el.focus({ preventScroll: true });
                    }, 30);
                  }
                }}
                onClick={() => {
                  const pathToAdd = pendingDroppedFolder;
                  setPendingDroppedFolder(null);
                  handleAddFolder(pathToAdd);
                }}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  background: 'linear-gradient(135deg, rgba(5, 150, 105, 0.45), rgba(52, 211, 153, 0.25))',
                  border: '1px solid rgba(52, 211, 153, 0.6)',
                  color: '#ecfdf5',
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <ImpIcon name="folder-plus" size={14} color="#34d399" />
                Add to Local Folders
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

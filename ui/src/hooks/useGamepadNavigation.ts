import { useCallback, useEffect, useRef } from 'react';
import { defaultSimpClient } from '@simp/client';
import {
  AppleCloudAlbumSummary,
  AppleCloudPlaylistSummary,
} from '../drivers/AppleMusicDriver';

export type OskTargetKind = 'search' | 'folder' | 'playlist' | null;

export interface UseGamepadNavigationParams {
  view: 'lock' | 'browser';
  setView: React.Dispatch<React.SetStateAction<'lock' | 'browser'>>;
  sourceModalOpen: boolean;
  setSourceModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  powerModalOpen: boolean;
  setPowerModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  volumePopoverOpen: boolean;
  setVolumePopoverOpen: React.Dispatch<React.SetStateAction<boolean>>;
  brightnessPopoverOpen: boolean;
  setBrightnessPopoverOpen: React.Dispatch<React.SetStateAction<boolean>>;
  confirmHardReset: boolean;
  setConfirmHardReset: React.Dispatch<React.SetStateAction<boolean>>;
  isSleeping: boolean;
  setIsSleeping: React.Dispatch<React.SetStateAction<boolean>>;
  setIsDimmed: React.Dispatch<React.SetStateAction<boolean>>;
  oskTarget: OskTargetKind;
  setOskTarget: React.Dispatch<React.SetStateAction<OskTargetKind>>;
  activeCloudAlbum: AppleCloudAlbumSummary | null;
  setActiveCloudAlbum: React.Dispatch<React.SetStateAction<AppleCloudAlbumSummary | null>>;
  activeCloudPlaylist: AppleCloudPlaylistSummary | null;
  setActiveCloudPlaylist: React.Dispatch<React.SetStateAction<AppleCloudPlaylistSummary | null>>;
  shuffle: boolean;
  currentVolume: number;
  applyVolume: (nextVol: number) => void;
}

export interface UseGamepadNavigationResult {
  applyFocusMarker: (el: HTMLElement | null) => void;
  moveSpatialFocus: (dir: 'up' | 'down' | 'left' | 'right') => void;
}

/**
 * Spatial 2D controller navigation, SteamUI Decky `/simp-console` postMessage/VGP bridge,
 * HTML5 Gamepad API polling, Linux `/dev/input/js*` daemon fallback, and keyboard shortcuts.
 */
export function useGamepadNavigation({
  view,
  setView,
  sourceModalOpen,
  setSourceModalOpen,
  powerModalOpen,
  setPowerModalOpen,
  volumePopoverOpen,
  setVolumePopoverOpen,
  brightnessPopoverOpen,
  setBrightnessPopoverOpen,
  confirmHardReset,
  setConfirmHardReset,
  isSleeping,
  setIsSleeping,
  setIsDimmed,
  oskTarget,
  setOskTarget,
  activeCloudAlbum,
  setActiveCloudAlbum,
  activeCloudPlaylist,
  setActiveCloudPlaylist,
  shuffle,
  currentVolume,
  applyVolume,
}: UseGamepadNavigationParams): UseGamepadNavigationResult {
  const lastBridgeMsgTsRef = useRef<number>(0);
  const gamepadActionRef = useRef<
    (action: string, source?: 'daemon' | 'keyboard' | 'web' | 'bridge') => void
  >(() => {});
  const lastWebGamepadTsRef = useRef<number>(0);
  const lastGamepadInputTsRef = useRef<number>(0);
  const lastBrowserFocusRef = useRef<HTMLElement | null>(null);
  const preMuteVolumeRef = useRef<number>(0.85);
  const lastActionTsRef = useRef<Record<string, number>>({});
  const lastActionSourceRef = useRef<Record<string, string>>({});
  const lastDaemonActionTsRef = useRef<Record<string, number>>({});
  const lastPowerActionTsRef = useRef<number>(0);

  // Adaptive Input Modality (`data-simp-input="pointer" | "gamepad"`):
  // Default to `gamepad` inside SteamUI's `/simp-console` iframe and `pointer` in standalone desktop windows,
  // then switch dynamically whenever the user moves the mouse vs presses a controller button.
  useEffect(() => {
    if (!document.documentElement.dataset.simpInput) {
      document.documentElement.dataset.simpInput =
        window.parent !== window ? 'gamepad' : 'pointer';
    }
    let lastMouseX: number | null = null;
    let lastMouseY: number | null = null;
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      // Ignore small pointer micro-jitter in SteamVR desktop view for 1.8s after controller input
      if (performance.now() - lastGamepadInputTsRef.current < 1800) {
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        return;
      }
      if (lastMouseX === null || lastMouseY === null) {
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        return;
      }
      const dist = Math.hypot(e.clientX - lastMouseX, e.clientY - lastMouseY);
      if (dist > 14) {
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        if (document.documentElement.dataset.simpInput !== 'pointer') {
          document.documentElement.dataset.simpInput = 'pointer';
        }
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!e.pointerType || e.pointerType === 'mouse') {
        if (document.documentElement.dataset.simpInput !== 'pointer') {
          document.documentElement.dataset.simpInput = 'pointer';
        }
      }
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, []);

  // IMPORTANT: Never call `el.focus()` here! Inside SteamUI's `/simp-console` iframe, calling
  // `el.focus()` steals browser focus away from the parent SteamUI `<Focusable>` wrapper,
  // causing SteamUI to play a "bonk" sound on the first D-Pad press and requiring 2 presses per row.
  const applyFocusMarker = useCallback((el: HTMLElement | null) => {
    const activeDom = document.activeElement as HTMLElement | null;
    if (
      activeDom &&
      activeDom !== document.body &&
      (activeDom.tagName === 'BUTTON' ||
        activeDom.tagName === 'INPUT' ||
        activeDom.tagName === 'SELECT' ||
        activeDom.tagName === 'TEXTAREA' ||
        activeDom.hasAttribute('tabindex'))
    ) {
      activeDom.blur();
    }
    document
      .querySelectorAll<HTMLElement>('[data-simp-active-focus="true"], .simp-gpfocus')
      .forEach((node) => {
        if (node !== el) {
          node.removeAttribute('data-simp-active-focus');
          node.classList.remove('simp-gpfocus');
        }
      });
    if (el) {
      el.setAttribute('data-simp-active-focus', 'true');
      el.classList.add('simp-gpfocus');
      if (el.closest('[data-nav-col]')) {
        lastBrowserFocusRef.current = el;
      }
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (el.closest('[data-nav-col="left"]') && el.dataset.xmbPreview === 'true') {
        window.dispatchEvent(
          new CustomEvent('simp-xmb-left-focus', { detail: { element: el } })
        );
      }
    }
  }, []);

  // Automatically place the focus marker on the default focus target when entering Browser (or restore last browser focus) or opening Modals
  useEffect(() => {
    if (view !== 'browser' && !sourceModalOpen && !powerModalOpen) return;
    const t = window.setTimeout(() => {
      if (sourceModalOpen || powerModalOpen) {
        const modalTarget =
          document.querySelector<HTMLElement>(
            '[data-modal-root="true"] [data-default-focus="true"]:not([disabled])'
          ) ||
          document.querySelector<HTMLElement>(
            '[data-modal-root="true"] button:not([disabled]), [data-modal-root="true"] input:not([disabled])'
          );
        if (modalTarget) {
          applyFocusMarker(modalTarget);
        }
        return;
      }
      // Restore the last focused element in the Library Browser if it is still mounted & visible
      const saved = lastBrowserFocusRef.current;
      if (saved && saved.isConnected) {
        const rect = saved.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          document
            .querySelectorAll<HTMLElement>('[data-simp-active-focus="true"], .simp-gpfocus')
            .forEach((node) => {
              if (node !== saved) {
                node.removeAttribute('data-simp-active-focus');
                node.classList.remove('simp-gpfocus');
              }
            });
          saved.setAttribute('data-simp-active-focus', 'true');
          saved.classList.add('simp-gpfocus');
          return;
        }
      }
      const preferred = document.querySelector<HTMLElement>(
        'button[data-default-focus="true"]:not([disabled]), [data-nav-col="left"] button:not([disabled])'
      );
      if (preferred) {
        applyFocusMarker(preferred);
      }
    }, 30);
    return () => window.clearTimeout(t);
  }, [view, sourceModalOpen, powerModalOpen, applyFocusMarker]);

  const moveSpatialFocus = useCallback(
    (dir: 'up' | 'down' | 'left' | 'right') => {
      setIsDimmed(false);
      setIsSleeping(false);
      const hasDomModal = Boolean(document.querySelector('[data-modal-root="true"]'));
      const isModalOpen = sourceModalOpen || powerModalOpen || hasDomModal;
      const selector = oskTarget
        ? '[data-osk-root="true"] button:not([disabled])'
        : isModalOpen
        ? '[data-modal-root="true"] button:not([disabled]), [data-modal-root="true"] input:not([disabled]), [data-modal-root="true"] select:not([disabled]), [data-modal-root="true"] a'
        : 'button:not([disabled]):not([data-tile-aux="true"]), input:not([disabled]), select:not([disabled]), [data-focusable="true"]';
      const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      if (nodes.length === 0) return;

      const active =
        (document.querySelector<HTMLElement>('[data-simp-active-focus="true"]') as HTMLElement | null) ||
        (document.activeElement as HTMLElement | null);
      if (!active || !nodes.includes(active)) {
        const preferred =
          nodes.find((el) => el.dataset.defaultFocus === 'true') || nodes[0];
        applyFocusMarker(preferred);
        return;
      }

      const getCol = (el: HTMLElement): string | null =>
        el.closest<HTMLElement>('[data-nav-col]')?.dataset.navCol || null;

      // Detect secondary inline row buttons (`✕`, `📌 Pin`, `🔄 Scan`, `⏏`, `+`, `💿`, `<select>`)
      // so D-Pad Up/Down moves cleanly 1 row per click on primary items, while D-Pad Right/Left reaches inline actions.
      const isAuxRowElement = (el: HTMLElement): boolean => {
        if (el.dataset.rowAux === 'true') return true;
        if (el.tagName === 'SELECT') return true;
        if (el.parentElement?.closest('[data-focusable="true"]')) return true;
        const r = el.getBoundingClientRect();
        if (r.width >= 120) return false;
        const ry = r.top + r.height / 2;
        const elCol = getCol(el);
        return nodes.some((other) => {
          if (other === el) return false;
          if (getCol(other) !== elCol) return false;
          const or = other.getBoundingClientRect();
          const oy = or.top + or.height / 2;
          return (
            Math.abs(oy - ry) <= 16 &&
            or.left < r.left - 8 &&
            or.width > r.width * 1.35 &&
            or.width >= 110
          );
        });
      };

      const cur = active.getBoundingClientRect();
      const cx = cur.left + cur.width / 2;
      const cy = cur.top + cur.height / 2;
      const curCol = getCol(active);

      // Two-Column Player Actions (`SELECT`) Modal Navigation:
      // - Up/Down stays strictly within `data-player-actions-col="left"` (settings) or `"right"` (queue tracks).
      // - Right from `"left"` jumps directly to `data-queue-current="true"` in `"right"`.
      // - Left from `"right"` returns directly to `"left"`.
      const curPlayerCol =
        active.closest<HTMLElement>('[data-player-actions-col]')?.dataset.playerActionsCol || null;
      if (curPlayerCol && !oskTarget) {
        if (dir === 'up' || dir === 'down') {
          let bestInPlayerCol: HTMLElement | null = null;
          let bestScore = Infinity;
          let wrapTopMost: HTMLElement | null = null;
          let wrapTopMinY = Infinity;
          let wrapBottomMost: HTMLElement | null = null;
          let wrapBottomMaxY = -Infinity;

          for (const candidate of nodes) {
            if (candidate === active) continue;
            const candCol =
              candidate.closest<HTMLElement>('[data-player-actions-col]')?.dataset
                .playerActionsCol || null;
            if (candCol !== curPlayerCol) continue;
            const r = candidate.getBoundingClientRect();
            const ty = r.top + r.height / 2;
            if (ty < wrapTopMinY) {
              wrapTopMinY = ty;
              wrapTopMost = candidate;
            }
            if (ty > wrapBottomMaxY) {
              wrapBottomMaxY = ty;
              wrapBottomMost = candidate;
            }
            const dy = ty - cy;
            if (dir === 'down' && dy <= 4) continue;
            if (dir === 'up' && dy >= -4) continue;
            if (Math.abs(dy) < bestScore) {
              bestScore = Math.abs(dy);
              bestInPlayerCol = candidate;
            }
          }
          if (bestInPlayerCol) {
            applyFocusMarker(bestInPlayerCol);
          } else {
            const wrapped = dir === 'up' ? wrapBottomMost : wrapTopMost;
            if (wrapped) {
              applyFocusMarker(wrapped);
            }
          }
          return;
        }
        if (curPlayerCol === 'left' && dir === 'right') {
          const currentQueueTarget =
            document.querySelector<HTMLElement>(
              '[data-player-actions-modal="true"] [data-player-actions-col="right"] [data-queue-current="true"]:not([disabled])'
            ) ||
            document.querySelector<HTMLElement>(
              '[data-player-actions-modal="true"] [data-player-actions-col="right"] button:not([disabled])'
            );
          if (currentQueueTarget) {
            applyFocusMarker(currentQueueTarget);
          }
          return;
        }
        if (curPlayerCol === 'right' && dir === 'left') {
          const leftSettingTarget =
            document.querySelector<HTMLElement>(
              '[data-player-actions-modal="true"] [data-player-actions-col="left"] button[data-select-active="true"]:not([disabled])'
            ) ||
            document.querySelector<HTMLElement>(
              '[data-player-actions-modal="true"] [data-player-actions-col="left"] button[data-default-focus="true"]:not([disabled])'
            ) ||
            document.querySelector<HTMLElement>(
              '[data-player-actions-modal="true"] [data-player-actions-col="left"] button:not([disabled])'
            );
          if (leftSettingTarget) {
            applyFocusMarker(leftSettingTarget);
          }
          return;
        }
      }

      // Two-Column Settings Drawer (`data-settings-col="main"` and slide-out `"sub"`):
      // Keep Up/Down navigation within the active Settings column; if on the `Folders & Accounts` trigger
      // and pressing Left, slide out / jump into the Folders & Accounts column!
      const curSettingsCol =
        active.closest<HTMLElement>('[data-settings-col]')?.dataset.settingsCol || null;
      if (curSettingsCol && !oskTarget) {
        if (active.dataset.brightnessScrubActive === 'true') {
          if (dir === 'left' || dir === 'right') {
            window.dispatchEvent(
              new CustomEvent('simp-brightness-step', {
                detail: { delta: dir === 'left' ? -5 : 5 },
              })
            );
            return;
          }
          if (dir === 'up' || dir === 'down') {
            window.dispatchEvent(new CustomEvent('simp-brightness-exit'));
          }
        }

        if (
          curSettingsCol === 'main' &&
          dir === 'left' &&
          active.dataset.settingsFoldersTrigger === 'true'
        ) {
          const existingSub = document.querySelector<HTMLElement>(
            '[data-settings-col="sub"] button[data-sub-default="true"]:not([disabled]), [data-settings-col="sub"] button:not([disabled])'
          );
          if (existingSub) {
            applyFocusMarker(existingSub);
          } else {
            active.click();
          }
          return;
        }

        let bestInSettingsCol: HTMLElement | null = null;
        let bestSettingsScore = Infinity;
        let wrapTopMost: HTMLElement | null = null;
        let wrapTopMinY = Infinity;
        let wrapBottomMost: HTMLElement | null = null;
        let wrapBottomMaxY = -Infinity;

        for (const candidate of nodes) {
          if (candidate === active) continue;
          const candSettingsCol =
            candidate.closest<HTMLElement>('[data-settings-col]')?.dataset.settingsCol || null;
          if (candSettingsCol !== curSettingsCol) continue;
          const r = candidate.getBoundingClientRect();
          const tx = r.left + r.width / 2;
          const ty = r.top + r.height / 2;
          const dx = tx - cx;
          const dy = ty - cy;

          if (ty < wrapTopMinY - 4 || (Math.abs(ty - wrapTopMinY) <= 4 && r.left < (wrapTopMost?.getBoundingClientRect().left ?? Infinity))) {
            wrapTopMinY = ty;
            wrapTopMost = candidate;
          }
          if (ty > wrapBottomMaxY + 4 || (Math.abs(ty - wrapBottomMaxY) <= 4 && r.left < (wrapBottomMost?.getBoundingClientRect().left ?? Infinity))) {
            wrapBottomMaxY = ty;
            wrapBottomMost = candidate;
          }

          if (dir === 'right' && dx <= 6) continue;
          if (dir === 'left' && dx >= -6) continue;
          if (dir === 'down' && dy <= 6) continue;
          if (dir === 'up' && dy >= -6) continue;

          if (dir === 'left' || dir === 'right') {
            const overlapsY = r.bottom > cur.top + 4 && r.top < cur.bottom - 4;
            if (!overlapsY && Math.abs(dy) > 28) continue;
          }

          const primary = dir === 'left' || dir === 'right' ? Math.abs(dx) : Math.abs(dy);
          const boxCross =
            dir === 'left' || dir === 'right'
              ? cy >= r.top && cy <= r.bottom
                ? 0
                : Math.min(Math.abs(cy - r.top), Math.abs(cy - r.bottom))
              : cx >= r.left && cx <= r.right
              ? 0
              : Math.min(Math.abs(cx - r.left), Math.abs(cx - r.right));
          const centerTieBreak =
            (dir === 'left' || dir === 'right' ? Math.abs(ty - cy) : Math.abs(tx - cx)) * 0.08;
          const score = primary + (boxCross + centerTieBreak) * 2.2;
          if (score < bestSettingsScore) {
            bestSettingsScore = score;
            bestInSettingsCol = candidate;
          }
        }

        if (bestInSettingsCol) {
          applyFocusMarker(bestInSettingsCol);
          return;
        }

        if (dir === 'up' || dir === 'down') {
          const wrapped = dir === 'up' ? wrapBottomMost : wrapTopMost;
          if (wrapped) {
            applyFocusMarker(wrapped);
          }
          return;
        }

        // If in `sub` column and no same-row element to the right, pressing Right returns to `Folders & Accounts` trigger in `main`
        if (curSettingsCol === 'sub' && dir === 'right') {
          const mainTrigger = document.querySelector<HTMLElement>(
            '[data-settings-col="main"] [data-settings-folders-trigger="true"]:not([disabled])'
          );
          if (mainTrigger) {
            applyFocusMarker(mainTrigger);
          }
        }
        return;
      }

      if (!oskTarget && !isModalOpen && (dir === 'up' || dir === 'down') && curCol) {
        // 1. Try moving Up/Down among primary row items inside the SAME column (`left` or `right`)
        let bestInCol: HTMLElement | null = null;
        let bestInColScore = Infinity;

        for (const candidate of nodes) {
          if (candidate === active) continue;
          if (getCol(candidate) !== curCol) continue;
          if (isAuxRowElement(candidate)) continue;

          const r = candidate.getBoundingClientRect();
          const tx = r.left + r.width / 2;
          const ty = r.top + r.height / 2;
          const dx = tx - cx;
          const dy = ty - cy;

          if (dir === 'down' && dy <= 6) continue;
          if (dir === 'up' && dy >= -6) continue;

          // Keep multi-column grid tiles in their vertical lane while still allowing full-width rows to transition smoothly
          const overlapsX = r.right > cur.left + 8 && r.left < cur.right - 8;
          const score = Math.abs(dy) + Math.abs(dx) * (overlapsX ? 0.15 : 1.15);
          if (score < bestInColScore) {
            bestInColScore = score;
            bestInCol = candidate;
          }
        }

        if (bestInCol) {
          applyFocusMarker(bestInCol);
          return;
        }

        // If at the top of a column and pressing Up, allow escaping to the top header bar (`getCol(c) === null`)
        if (dir === 'up') {
          let bestHeader: HTMLElement | null = null;
          let bestHeaderScore = Infinity;
          for (const candidate of nodes) {
            if (getCol(candidate) !== null) continue;
            const r = candidate.getBoundingClientRect();
            const tx = r.left + r.width / 2;
            const ty = r.top + r.height / 2;
            const dy = ty - cy;
            if (dy >= -6) continue;
            const score = Math.abs(dy) + Math.abs(tx - cx) * 0.5;
            if (score < bestHeaderScore) {
              bestHeaderScore = score;
              bestHeader = candidate;
            }
          }
          if (bestHeader) {
            applyFocusMarker(bestHeader);
            return;
          }
        }
        return;
      }

      if (!oskTarget && !isModalOpen && (dir === 'left' || dir === 'right') && curCol) {
        // PS3 XMB Drill-Right Action: If focused on a Left-Column drill-right row (`🍎 Apple Music ▸`, `☁️ SoundCloud ▸`, or `+ New Playlist`),
        // pressing D-Pad Right triggers the drill-in / action directly!
        if (curCol === 'left' && dir === 'right' && active.dataset.xmbDrillRight === 'true') {
          const drillTarget =
            active.parentElement?.querySelector<HTMLElement>(
              '[data-xmb-drill-action="true"]:not([disabled])'
            ) || active;
          drillTarget.click();
          return;
        }

        // 1. First look for a sibling control on the SAME horizontal row in the SAME column
        let bestSameRow: HTMLElement | null = null;
        let bestSameRowDx = Infinity;

        for (const candidate of nodes) {
          if (candidate === active) continue;
          if (getCol(candidate) !== curCol) continue;
          const r = candidate.getBoundingClientRect();
          const tx = r.left + r.width / 2;
          const ty = r.top + r.height / 2;
          const dx = tx - cx;
          const dy = ty - cy;

          const overlapsY = r.bottom > cur.top + 6 && r.top < cur.bottom - 6;
          if (!overlapsY) continue;
          if (dir === 'right' && dx <= 6) continue;
          if (dir === 'left' && dx >= -6) continue;

          if (Math.abs(dx) < bestSameRowDx) {
            bestSameRowDx = Math.abs(dx);
            bestSameRow = candidate;
          }
        }

        if (bestSameRow) {
          applyFocusMarker(bestSameRow);
          return;
        }

        // 2. Otherwise cross directly between the Left Column (`left`) and Right Column (`right`)!
        const targetCol =
          curCol === 'left' && dir === 'right'
            ? 'right'
            : curCol === 'right' && dir === 'left'
            ? 'left'
            : null;

        if (targetCol === 'right') {
          // PS3 XMB Ergonomics: Crossing from Left Column to Right Column ALWAYS lands on the FIRST playable tile/track
          // (never on top filter/genre pills, which remain reachable by pressing D-Pad Up from the first tile row!)
          const firstContentItem = document.querySelector<HTMLElement>(
            '[data-nav-col="right"] [data-right-tile="true"]:not([disabled]), [data-nav-col="right"] [data-single-song-play="true"]:not([disabled]), [data-nav-col="right"] [data-right-track="true"]:not([disabled]), [data-nav-col="right"] [data-right-play-all="true"]:not([disabled])'
          );
          if (firstContentItem) {
            const rect = firstContentItem.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              applyFocusMarker(firstContentItem);
              return;
            }
          }
        } else if (targetCol === 'left') {
          // Crossing from Right Column back to Left Column prefers the active Left-Column item (`data-left-active="true"`)
          const activeLeftItem = document.querySelector<HTMLElement>(
            '[data-nav-col="left"] button[data-left-active="true"]:not([disabled])'
          );
          if (activeLeftItem) {
            const rect = activeLeftItem.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              applyFocusMarker(activeLeftItem);
              return;
            }
          }
        }

        if (targetCol) {
          let bestCrossCol: HTMLElement | null = null;
          let bestCrossColScore = Infinity;

          for (const candidate of nodes) {
            if (getCol(candidate) !== targetCol) continue;
            if (isAuxRowElement(candidate)) continue;
            if (targetCol === 'right' && candidate.dataset.rightFilterPill === 'true') continue;
            const r = candidate.getBoundingClientRect();
            const ty = r.top + r.height / 2;
            const score = Math.abs(ty - cy) + r.left * 0.05;
            if (score < bestCrossColScore) {
              bestCrossColScore = score;
              bestCrossCol = candidate;
            }
          }

          if (bestCrossCol) {
            applyFocusMarker(bestCrossCol);
            return;
          }
        }
        return;
      }

      // Default 2D spatial navigation (Header bar, Modals, On-Screen Keyboard)
      let best: HTMLElement | null = null;
      let bestScore = Infinity;

      for (const candidate of nodes) {
        if (candidate === active) continue;
        if (!oskTarget && (dir === 'up' || dir === 'down') && isAuxRowElement(candidate)) continue;
        const r = candidate.getBoundingClientRect();
        const tx = r.left + r.width / 2;
        const ty = r.top + r.height / 2;
        const dx = tx - cx;
        const dy = ty - cy;

        if (dir === 'right' && dx <= 6) continue;
        if (dir === 'left' && dx >= -6) continue;
        if (dir === 'down' && dy <= 6) continue;
        if (dir === 'up' && dy >= -6) continue;

        const primary = dir === 'left' || dir === 'right' ? Math.abs(dx) : Math.abs(dy);
        // Use bounding-box interval overlap for cross-axis distance so wide full-width rows
        // (such as `⚙ Folders & Connected Accounts` in PowerModal) are never skipped when moving Up/Down!
        const boxCross =
          dir === 'left' || dir === 'right'
            ? cy >= r.top && cy <= r.bottom
              ? 0
              : Math.min(Math.abs(cy - r.top), Math.abs(cy - r.bottom))
            : cx >= r.left && cx <= r.right
            ? 0
            : Math.min(Math.abs(cx - r.left), Math.abs(cx - r.right));
        const centerTieBreak =
          (dir === 'left' || dir === 'right' ? Math.abs(ty - cy) : Math.abs(tx - cx)) * 0.08;
        const cross = oskTarget
          ? dir === 'left' || dir === 'right'
            ? Math.abs(dy)
            : Math.abs(dx)
          : boxCross + centerTieBreak;
        const score = primary + cross * (oskTarget ? 1.8 : 2.2);

        if (score < bestScore) {
          bestScore = score;
          best = candidate;
        }
      }

      if (best) {
        applyFocusMarker(best);
      }
    },
    [sourceModalOpen, powerModalOpen, oskTarget, applyFocusMarker, setIsDimmed, setIsSleeping]
  );

  // Keyboard shortcuts + Native Decky Fullscreen Route `postMessage` Gamepad Bridge
  useEffect(() => {
    const handleGamepadAction = (
      action: string,
      source: 'daemon' | 'keyboard' | 'web' | 'bridge' = 'keyboard'
    ) => {
      const now = performance.now();
      const prevTs = lastActionTsRef.current[action] || 0;
      const prevSource = lastActionSourceRef.current[action];
      // When the same logical action arrives from two different input paths (e.g., Linux `/dev/hidraw*`
      // daemon event + Steam Input KDE Desktop keyboard emulation `Enter`/`Escape`/`Arrow*`/`Tab`/`Space`),
      // deduplicate within 240ms so a single physical button press never fires twice.
      const crossSource = Boolean(prevSource && prevSource !== source);
      const debounceMs = crossSource
        ? 240
        : action === 'power' || action === 'sources'
        ? 220
        : 70;
      if (prevTs && now - prevTs < debounceMs) return;
      lastActionTsRef.current[action] = now;
      lastActionSourceRef.current[action] = source;
      if (source === 'daemon') {
        lastDaemonActionTsRef.current[action] = now;
      }
      if (action === 'power') {
        lastPowerActionTsRef.current = now;
      }
      lastGamepadInputTsRef.current = now;
      if (document.documentElement.dataset.simpInput !== 'gamepad') {
        document.documentElement.dataset.simpInput = 'gamepad';
      }
      setIsDimmed(false);
      if (isSleeping) {
        setIsSleeping(false);
        return;
      }

      const isDvdModalOpen = Boolean(document.querySelector('[data-dvd-modal="true"]'));
      const isPlayerActionsModalOpen = Boolean(
        document.querySelector('[data-player-actions-modal="true"]')
      );

      // In the `🎵 Player` (`lock`) view (when modals and OSK are closed), D-Pad maps directly
      // to the on-screen transport badges (`◄` Previous, `►` Next, `▲/▼` Volume, `A` Play/Pause)!
      const isDirectTransportView =
        view === 'lock' &&
        !sourceModalOpen &&
        !powerModalOpen &&
        !oskTarget &&
        !isDvdModalOpen &&
        !isPlayerActionsModalOpen;

      if (isDvdModalOpen) {
        window.dispatchEvent(
          new CustomEvent('simp-dvd-gamepad-op', { detail: { op: 'wake' } })
        );
        const activeDvdEl =
          (document.querySelector<HTMLElement>(
            '[data-simp-active-focus="true"]'
          ) as HTMLElement | null) || (document.activeElement as HTMLElement | null);
        const isScrubberFocused = Boolean(activeDvdEl?.dataset.dvdScrubber === 'true');

        switch (action) {
          case 'left':
            if (isScrubberFocused) {
              window.dispatchEvent(
                new CustomEvent('simp-dvd-gamepad-op', { detail: { op: 'scrub-left' } })
              );
            } else {
              moveSpatialFocus('left');
            }
            return;
          case 'right':
            if (isScrubberFocused) {
              window.dispatchEvent(
                new CustomEvent('simp-dvd-gamepad-op', { detail: { op: 'scrub-right' } })
              );
            } else {
              moveSpatialFocus('right');
            }
            return;
          case 'up':
            moveSpatialFocus('up');
            return;
          case 'down':
            moveSpatialFocus('down');
            return;
          case 'activate':
            if (isScrubberFocused) {
              window.dispatchEvent(
                new CustomEvent('simp-dvd-gamepad-op', { detail: { op: 'scrub-commit' } })
              );
            } else if (
              activeDvdEl &&
              activeDvdEl !== document.body &&
              activeDvdEl.closest('[data-dvd-modal="true"]') &&
              typeof activeDvdEl.click === 'function'
            ) {
              activeDvdEl.click();
            } else {
              window.dispatchEvent(
                new CustomEvent('simp-dvd-gamepad-op', { detail: { op: 'toggle-play' } })
              );
            }
            return;
          case 'back':
            window.dispatchEvent(
              new CustomEvent('simp-dvd-gamepad-op', { detail: { op: 'close' } })
            );
            return;
          case 'shuffle':
            window.dispatchEvent(
              new CustomEvent('simp-dvd-gamepad-op', { detail: { op: 'cycle-audio' } })
            );
            return;
          case 'repeat':
            window.dispatchEvent(
              new CustomEvent('simp-dvd-gamepad-op', { detail: { op: 'cycle-subtitles' } })
            );
            return;
          case 'l1':
            window.dispatchEvent(
              new CustomEvent('simp-dvd-gamepad-op', { detail: { op: 'prev-chapter' } })
            );
            return;
          case 'r1':
            window.dispatchEvent(
              new CustomEvent('simp-dvd-gamepad-op', { detail: { op: 'next-chapter' } })
            );
            return;
          case 'l2':
            window.dispatchEvent(
              new CustomEvent('simp-dvd-gamepad-op', { detail: { op: 'seek-back' } })
            );
            return;
          case 'r2':
            window.dispatchEvent(
              new CustomEvent('simp-dvd-gamepad-op', { detail: { op: 'seek-fwd' } })
            );
            return;
          case 'sources':
            window.dispatchEvent(
              new CustomEvent('simp-dvd-gamepad-op', { detail: { op: 'fullscreen' } })
            );
            return;
          case 'vol_up':
            applyVolume(currentVolume + 0.05);
            return;
          case 'vol_down':
            applyVolume(currentVolume - 0.05);
            return;
        }
      }

      switch (action) {
        case 'left':
          if (isDirectTransportView) {
            defaultSimpClient.previous();
          } else {
            moveSpatialFocus('left');
          }
          break;
        case 'right':
          if (isDirectTransportView) {
            defaultSimpClient.next();
          } else {
            moveSpatialFocus('right');
          }
          break;
        case 'up':
          if (isDirectTransportView) {
            applyVolume(currentVolume + 0.05);
          } else {
            moveSpatialFocus('up');
          }
          break;
        case 'down':
          if (isDirectTransportView) {
            applyVolume(currentVolume - 0.05);
          } else {
            moveSpatialFocus('down');
          }
          break;
        case 'activate': {
          if (isDirectTransportView) {
            defaultSimpClient.togglePlayPause();
            break;
          }
          const active =
            (document.querySelector<HTMLElement>('[data-simp-active-focus="true"]') as HTMLElement | null) ||
            (document.activeElement as HTMLElement | null);
          if (active && active.tagName === 'INPUT' && (active as HTMLInputElement).type === 'text') {
            const targetKind =
              (active.dataset.oskInput as 'search' | 'folder' | 'playlist' | undefined) || 'search';
            setOskTarget(targetKind);
            if (window.parent && window.parent !== window) {
              window.parent.postMessage({ type: 'SIMP_OPEN_OSK' }, '*');
            }
            window.setTimeout(() => {
              const firstKey = document.querySelector<HTMLElement>(
                '[data-osk-root="true"] button[data-default-focus="true"], [data-osk-root="true"] button'
              );
              if (firstKey) applyFocusMarker(firstKey);
            }, 40);
            break;
          }
          if (active && active !== document.body && typeof active.click === 'function') {
            active.click();
          } else {
            defaultSimpClient.togglePlayPause();
          }
          break;
        }
        case 'back': {
          if (oskTarget) {
            const prevInputSelector = `[data-osk-input="${oskTarget}"]`;
            setOskTarget(null);
            window.setTimeout(() => {
              const pickerSubmit = document.querySelector<HTMLElement>(
                '[data-hybrid-picker-submit="true"]:not([disabled])'
              );
              const inp =
                pickerSubmit || document.querySelector<HTMLElement>(prevInputSelector);
              if (inp) applyFocusMarker(inp);
            }, 30);
            break;
          }
          // In the Two-Column `SELECT` Player Actions modal, pressing `B` while in the Right Column
          // returns focus to the Left Column settings first; pressing `B` in the Left Column closes the modal.
          const activeModalEl =
            (document.querySelector<HTMLElement>(
              '[data-simp-active-focus="true"]'
            ) as HTMLElement | null) || (document.activeElement as HTMLElement | null);
          if (
            activeModalEl?.closest<HTMLElement>('[data-player-actions-col]')?.dataset
              .playerActionsCol === 'right'
          ) {
            const leftSettingBtn =
              document.querySelector<HTMLElement>(
                '[data-player-actions-modal="true"] [data-player-actions-col="left"] button[data-default-focus="true"]:not([disabled])'
              ) ||
              document.querySelector<HTMLElement>(
                '[data-player-actions-modal="true"] [data-player-actions-col="left"] button:not([disabled])'
              );
            if (leftSettingBtn) {
              applyFocusMarker(leftSettingBtn);
              break;
            }
          }
          const playerActionsClose = document.querySelector<HTMLElement>(
            '[data-player-actions-close="true"]'
          );
          if (playerActionsClose) {
            playerActionsClose.click();
            break;
          }
          // Hierarchical walk-back inside the Top-Left Settings Drawer (`SettingsModal`):
          // If a nested section is expanded (`[data-settings-walk-back="true"]`), collapse it first!
          const settingsWalkBack = document.querySelector<HTMLElement>(
            '[data-settings-walk-back="true"]:not([disabled])'
          );
          if (settingsWalkBack) {
            settingsWalkBack.click();
            break;
          }
          const hybridPickerClose = document.querySelector<HTMLElement>(
            '[data-hybrid-picker-close="true"]'
          );
          if (hybridPickerClose) {
            hybridPickerClose.click();
            break;
          }
          if (volumePopoverOpen || brightnessPopoverOpen) {
            setVolumePopoverOpen(false);
            setBrightnessPopoverOpen(false);
          } else if (confirmHardReset) {
            setConfirmHardReset(false);
          } else if (powerModalOpen) {
            setPowerModalOpen(false);
          } else if (sourceModalOpen) {
            setSourceModalOpen(false);
          } else if (view === 'browser') {
            // Hierarchical Back ('B') Navigation inside the Library Browser:
            // 1. If viewing a Collection Tracklist on the Right Pane -> return to Right-Pane Tile Grid
            const backToGridBtn = document.querySelector<HTMLElement>(
              '[data-right-back-grid="true"]:not([disabled])'
            );
            if (backToGridBtn) {
              backToGridBtn.click();
              break;
            }
            if (activeCloudAlbum || activeCloudPlaylist) {
              setActiveCloudAlbum(null);
              setActiveCloudPlaylist(null);
              break;
            }
            // 2. If focus is in the Right Pane (Tile Grid) or Header -> return focus to the Left Column
            const activeEl =
              (document.querySelector<HTMLElement>(
                '[data-simp-active-focus="true"]'
              ) as HTMLElement | null) || (document.activeElement as HTMLElement | null);
            const activeCol =
              activeEl?.closest<HTMLElement>('[data-nav-col]')?.dataset.navCol || null;
            if (activeCol !== 'left') {
              const leftTarget =
                document.querySelector<HTMLElement>(
                  '[data-nav-col="left"] button[data-left-active="true"]:not([disabled])'
                ) ||
                document.querySelector<HTMLElement>(
                  '[data-nav-col="left"] button[data-default-focus="true"]:not([disabled])'
                ) ||
                document.querySelector<HTMLElement>('[data-nav-col="left"] button:not([disabled])');
              if (leftTarget) {
                applyFocusMarker(leftTarget);
              }
              break;
            }
            // 3. Already in Left Column: if search has text, clear it; otherwise if we drilled into a Service Place, walk back!
            const clearSearchBtn = document.querySelector<HTMLElement>(
              '[data-clear-search="true"]:not([disabled])'
            );
            if (clearSearchBtn) {
              clearSearchBtn.click();
              break;
            }
            const walkBackBtn = document.querySelector<HTMLElement>(
              '[data-right-walk-back="true"]:not([disabled])'
            );
            if (walkBackBtn) {
              walkBackBtn.click();
              break;
            }
          } else if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'SIMP_EXIT_CONSOLE' }, '*');
          }
          break;
        }
        case 'shuffle':
          defaultSimpClient.setShuffle(!shuffle);
          break;
        case 'repeat':
          if (view === 'browser' && !sourceModalOpen && !powerModalOpen && !oskTarget) {
            window.dispatchEvent(
              new CustomEvent('simp-browser-gamepad-op', { detail: { op: 'y' } })
            );
          } else {
            defaultSimpClient.cycleRepeat();
          }
          break;
        case 'l1':
          setOskTarget(null);
          setView('lock');
          break;
        case 'r1':
          setView('browser');
          break;
        case 'l2':
          defaultSimpClient.seekRelative(-10_000);
          break;
        case 'r2':
          defaultSimpClient.seekRelative(10_000);
          break;
        case 'sources':
          if (document.querySelector('[data-player-actions-modal="true"]')) {
            window.dispatchEvent(new CustomEvent('simp-player-actions-toggle'));
          } else if (view === 'browser' && !sourceModalOpen && !powerModalOpen && !oskTarget) {
            window.dispatchEvent(
              new CustomEvent('simp-browser-gamepad-op', { detail: { op: 'select' } })
            );
          } else if (view === 'lock' && !sourceModalOpen && !powerModalOpen && !oskTarget) {
            window.dispatchEvent(new CustomEvent('simp-player-actions-toggle'));
          } else {
            setOskTarget(null);
            setPowerModalOpen(false);
            setSourceModalOpen((v) => !v);
          }
          break;
        case 'power':
          setOskTarget(null);
          setPowerModalOpen(false);
          setSourceModalOpen((v) => !v);
          break;
        case 'vol_up':
          applyVolume(currentVolume + 0.05);
          break;
        case 'vol_down':
          applyVolume(currentVolume - 0.05);
          break;
      }
    };

    gamepadActionRef.current = handleGamepadAction;

    // Track standalone taps of `Control` (`L1` in Steam KDE Desktop Layout) and `Alt` (`R1` in Steam KDE Desktop Layout)
    let pendingModifierKey: 'Control' | 'Alt' | null = null;
    let pendingModifierTs = 0;

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        pendingModifierKey = null;
        if (e.key === 'Escape') {
          (e.target as HTMLElement).blur();
          setOskTarget(null);
        }
        return;
      }

      if (e.key === 'Control' || e.key === 'Alt') {
        if (!e.repeat) {
          pendingModifierKey = e.key;
          pendingModifierTs = performance.now();
        }
        return;
      } else {
        pendingModifierKey = null;
      }

      // Cmd/Ctrl + F or `/` jumps directly to the Library & Queue Search input
      if (
        e.key === '/' ||
        ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F'))
      ) {
        e.preventDefault();
        e.stopPropagation();
        setSourceModalOpen(false);
        setPowerModalOpen(false);
        setView('browser');
        window.setTimeout(() => {
          const searchInput = document.querySelector<HTMLInputElement>(
            '[data-osk-input="search"]'
          );
          searchInput?.focus();
          searchInput?.select();
        }, 40);
        return;
      }

      // Cmd/Ctrl + Arrow keys for desktop media transport (Previous/Next Track & Volume Up/Down)
      if (e.metaKey || e.ctrlKey) {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          e.stopPropagation();
          defaultSimpClient.next();
          return;
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          e.stopPropagation();
          defaultSimpClient.previous();
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          handleGamepadAction('vol_up');
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          e.stopPropagation();
          handleGamepadAction('vol_down');
          return;
        }
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        handleGamepadAction('up');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        handleGamepadAction('down');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        handleGamepadAction('left');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        handleGamepadAction('right');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        handleGamepadAction('activate');
      } else if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        // In Steam KDE Desktop Mode, if `Start` (`Menu ☰`) opened the hamburger menu via `hidraw`
        // (`action === 'power'`) and Steam Input also emits a synthetic `Escape` on button release,
        // ignore that synthetic `Escape` so it does not immediately close the menu!
        if (e.key === 'Escape' && performance.now() - lastPowerActionTsRef.current < 600) {
          return;
        }
        handleGamepadAction('back');
      } else if (e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        // In Steam KDE Desktop Mode, the physical `Y` button emits `repeat` via `hidraw` AND Steam Input
        // sends a synthetic `Space` keydown; ignore that synthetic `Space` so pressing `Y` in the Player
        // view cycles Repeat without accidentally toggling Play/Pause.
        if (performance.now() - (lastDaemonActionTsRef.current['repeat'] || 0) < 450) {
          return;
        }
        const isModalOpen =
          sourceModalOpen ||
          powerModalOpen ||
          !!oskTarget ||
          !!document.querySelector('[data-player-actions-modal="true"]');
        // 100% Play/Pause in the Player tab (`view === 'lock'`, both Card and Fullscreen/Expanded Video)
        // and whenever using desktop pointer mode (`data-simp-input !== 'gamepad'`).
        // Only preserve the Steam KDE Lizard Mode `Y` alias (`repeat`) when browsing in gamepad mode.
        if (
          (view === 'lock' && !isModalOpen) ||
          document.documentElement.dataset.simpInput !== 'gamepad'
        ) {
          defaultSimpClient.togglePlayPause();
        } else {
          handleGamepadAction('repeat');
        }
      } else if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        e.stopPropagation();
        defaultSimpClient.togglePlayPause();
      } else if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        e.stopPropagation();
        handleGamepadAction('repeat');
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        e.stopPropagation();
        defaultSimpClient.cycleRepeat();
      } else if (e.key === 'Tab') {
        // In Steam KDE Desktop Mode, the physical `SELECT` (View) button sends `Tab`.
        e.preventDefault();
        e.stopPropagation();
        handleGamepadAction('sources');
      } else if (e.key === 'x' || e.key === 'X' || e.key === 's' || e.key === 'S') {
        e.preventDefault();
        e.stopPropagation();
        handleGamepadAction('shuffle');
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        e.stopPropagation();
        if (currentVolume > 0.001) {
          preMuteVolumeRef.current = currentVolume;
          applyVolume(0);
        } else {
          applyVolume(preMuteVolumeRef.current > 0.05 ? preMuteVolumeRef.current : 0.85);
        }
      } else if (
        e.key === 'f' ||
        e.key === 'F' ||
        e.key === 'F11' ||
        (e.altKey && e.key === 'Enter')
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (view === 'lock') {
          window.dispatchEvent(new CustomEvent('simp-player-fullscreen-toggle'));
        } else if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        } else {
          document.documentElement.requestFullscreen?.().catch(() => {});
        }
      } else if (e.key === 'n' || e.key === 'N' || e.key === '>') {
        e.preventDefault();
        e.stopPropagation();
        defaultSimpClient.next();
      } else if (e.key === 'b' || e.key === 'B' || e.key === '<') {
        e.preventDefault();
        e.stopPropagation();
        defaultSimpClient.previous();
      } else if (e.key === 'PageUp' || e.key === '[' || e.key === '1') {
        e.preventDefault();
        e.stopPropagation();
        handleGamepadAction('l1');
      } else if (e.key === 'PageDown' || e.key === ']' || e.key === '2') {
        e.preventDefault();
        e.stopPropagation();
        handleGamepadAction('r1');
      } else if (e.key === '-' || e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        e.stopPropagation();
        handleGamepadAction('l2');
      } else if (e.key === '=' || e.key === '+' || e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        e.stopPropagation();
        handleGamepadAction('r2');
      } else if (
        e.key === 'ContextMenu' ||
        e.key === 'F1' ||
        e.key === 'F2' ||
        e.key === 'F10' ||
        e.key === 'p' ||
        e.key === 'P'
      ) {
        e.preventDefault();
        e.stopPropagation();
        handleGamepadAction('power');
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (
        (e.key === 'Control' || e.key === 'Alt') &&
        pendingModifierKey === e.key &&
        performance.now() - pendingModifierTs < 400
      ) {
        const mod = pendingModifierKey;
        pendingModifierKey = null;
        e.preventDefault();
        if (mod === 'Control') {
          handleGamepadAction('l1');
        } else if (mod === 'Alt') {
          handleGamepadAction('r1');
        }
      } else {
        pendingModifierKey = null;
      }
    };

    const onMessage = (e: MessageEvent) => {
      const data = e.data;
      if (!data || data.type !== 'SIMP_GAMEPAD_ACTION') return;
      lastBridgeMsgTsRef.current = performance.now();
      handleGamepadAction(data.action, 'bridge');
    };

    // Also listen for SteamUI's native `vgp_onbuttondown` / `vgp_ondirection` events directly
    const onVgpEvent = (e: any) => {
      const btn = Number(e?.detail?.button);
      if (!btn) return;
      const map: Record<number, string> = {
        1: 'activate',
        2: 'back',
        3: 'shuffle',
        4: 'repeat',
        5: 'l1',
        6: 'r1',
        7: 'l2',
        8: 'r2',
        9: 'up',
        10: 'down',
        11: 'left',
        12: 'right',
        13: 'sources',
        14: 'power',
      };
      const action = map[btn];
      if (action) {
        lastBridgeMsgTsRef.current = performance.now();
        handleGamepadAction(action, 'bridge');
      }
    };

    // Native Linux `/dev/input/js*`, `/dev/input/event*` & Steam Deck `/dev/hidraw*` daemon gamepad fallback
    // for standalone KDE / SteamVR windows
    const onDaemonGamepad = (e: any) => {
      const action = e?.detail?.action;
      if (!action) return;
      if (window.parent !== window) return;
      // Only ignore if the browser tab is hidden in the background; in SteamVR Desktop overlay mode,
      // visible windows (`visibilityState === 'visible'`) often have `document.hasFocus() === false` when using Gamepad mode!
      if (document.visibilityState === 'hidden') return;
      const now = performance.now();
      if (now - lastBridgeMsgTsRef.current < 220) {
        return;
      }
      handleGamepadAction(action, 'daemon');
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('message', onMessage);
    window.addEventListener('vgp_onbuttondown', onVgpEvent as EventListener, true);
    window.addEventListener('vgp_ondirection', onVgpEvent as EventListener, true);
    window.addEventListener('simp-daemon-gamepad', onDaemonGamepad as EventListener);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('message', onMessage);
      window.removeEventListener('vgp_onbuttondown', onVgpEvent as EventListener, true);
      window.removeEventListener('vgp_ondirection', onVgpEvent as EventListener, true);
      window.removeEventListener('simp-daemon-gamepad', onDaemonGamepad as EventListener);
    };
  }, [
    moveSpatialFocus,
    applyFocusMarker,
    oskTarget,
    sourceModalOpen,
    powerModalOpen,
    volumePopoverOpen,
    brightnessPopoverOpen,
    confirmHardReset,
    isSleeping,
    activeCloudAlbum,
    activeCloudPlaylist,
    view,
    shuffle,
    applyVolume,
    currentVolume,
    setView,
    setSourceModalOpen,
    setPowerModalOpen,
    setVolumePopoverOpen,
    setBrightnessPopoverOpen,
    setConfirmHardReset,
    setIsSleeping,
    setIsDimmed,
    setOskTarget,
    setActiveCloudAlbum,
    setActiveCloudPlaylist,
  ]);

  // HTML5 Gamepad API polling across all connected controllers (D-Pad + Left/Right Sticks + ABXY/Bumpers/Triggers)
  // Event-driven (`gamepadconnected` / `gamepaddisconnected`) + visibility-gated so Chromium never burns CPU
  // querying the OS HID subsystem at 20Hz when no controller is plugged in or when the window is minimized.
  useEffect(() => {
    const prevButtonsByPad = new Map<number, boolean[]>();
    const prevAxisDirByPad = new Map<number, string | null>();
    const prevHatDirByPad = new Map<number, string | null>();

    const checkHasPad = () => {
      if (!navigator.getGamepads) return false;
      try {
        const pads = navigator.getGamepads();
        for (const p of pads) {
          if (p && p.connected) return true;
        }
      } catch {
        // Ignore security/permissions errors in restricted webviews
      }
      return false;
    };

    let hasConnectedPad = checkHasPad();
    let lastIdleProbeTs = performance.now();

    const onGamepadConnected = () => {
      hasConnectedPad = true;
    };
    const onGamepadDisconnected = () => {
      hasConnectedPad = checkHasPad();
    };
    window.addEventListener('gamepadconnected', onGamepadConnected);
    window.addEventListener('gamepaddisconnected', onGamepadDisconnected);

    const poll = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      const now = performance.now();
      if (!hasConnectedPad) {
        // In browsers that don't fire `gamepadconnected` until a button is pressed, probe once every 1.5s instead of 20Hz
        if (now - lastIdleProbeTs < 1500) return;
        lastIdleProbeTs = now;
        hasConnectedPad = checkHasPad();
        if (!hasConnectedPad) return;
      }

      const bridgeActive = now - lastBridgeMsgTsRef.current < 3500;
      const rawPads = navigator.getGamepads ? navigator.getGamepads() : [];
      let anyStillConnected = false;
      for (const pad of rawPads) {
        if (!pad || !pad.connected) continue;
        anyStillConnected = true;

        const prevButtons = prevButtonsByPad.get(pad.index) || [];
        const pressed = (idx: number) => !!pad.buttons[idx]?.pressed && !prevButtons[idx];
        const anyButtonPressed = pad.buttons.some((b, i) => b.pressed && !prevButtons[i]);

        if (isSleeping && anyButtonPressed) {
          setIsSleeping(false);
          setIsDimmed(false);
          lastWebGamepadTsRef.current = performance.now();
          prevButtonsByPad.set(
            pad.index,
            pad.buttons.map((b) => b.pressed)
          );
          continue;
        }

        const fireWebPad = (action: string) => {
          lastWebGamepadTsRef.current = performance.now();
          gamepadActionRef.current(action, 'web');
        };

        if (!bridgeActive) {
          if (pressed(0)) fireWebPad('activate'); // A
          if (pressed(1)) fireWebPad('back'); // B
          if (pressed(2)) fireWebPad('shuffle'); // X
          if (pressed(3)) fireWebPad('repeat'); // Y
          if (pressed(4)) fireWebPad('l1'); // L1
          if (pressed(5)) fireWebPad('r1'); // R1
          if (pressed(6)) fireWebPad(pad.mapping === 'standard' ? 'l2' : 'sources'); // L2 or raw Linux Select
          if (pressed(7)) fireWebPad(pad.mapping === 'standard' ? 'r2' : 'power'); // R2 or raw Linux Start
          if (pressed(8)) fireWebPad('sources'); // Select
          if (pressed(9)) fireWebPad('power'); // Start
          if (pressed(12)) fireWebPad('up'); // D-Up
          if (pressed(13)) fireWebPad('down'); // D-Down
          if (pressed(14)) fireWebPad('left'); // D-Left
          if (pressed(15)) fireWebPad('right'); // D-Right

          // Linux raw `joydev` D-Pad Hat Axes (`ABS_HAT0X` = axes[6], `ABS_HAT0Y` = axes[7])
          const hx = pad.axes[6] ?? 0;
          const hy = pad.axes[7] ?? 0;
          let hatDir: 'up' | 'down' | 'left' | 'right' | null = null;
          if (hy < -0.5) hatDir = 'up';
          else if (hy > 0.5) hatDir = 'down';
          else if (hx < -0.5) hatDir = 'left';
          else if (hx > 0.5) hatDir = 'right';

          const prevHat = prevHatDirByPad.get(pad.index) || null;
          if (hatDir && hatDir !== prevHat) {
            fireWebPad(hatDir);
          }
          prevHatDirByPad.set(pad.index, hatDir);
        }

        // Left Stick 2D Spatial Navigation (with edge-trigger debounce)
        const lx = pad.axes[0] ?? 0;
        const ly = pad.axes[1] ?? 0;
        let stickDir: 'up' | 'down' | 'left' | 'right' | null = null;
        if (ly < -0.55) stickDir = 'up';
        else if (ly > 0.55) stickDir = 'down';
        else if (lx < -0.55) stickDir = 'left';
        else if (lx > 0.55) stickDir = 'right';

        const prevDir = prevAxisDirByPad.get(pad.index) || null;
        if (stickDir && stickDir !== prevDir) {
          fireWebPad(stickDir);
        }
        prevAxisDirByPad.set(pad.index, stickDir);

        // Right Stick Y-Axis Volume Adjustment
        const ry = (pad.mapping === 'standard' ? pad.axes[3] : pad.axes[4] ?? pad.axes[3]) ?? 0;
        if (Math.abs(ry) > 0.6) {
          lastWebGamepadTsRef.current = performance.now();
          applyVolume(currentVolume + (ry < 0 ? 0.02 : -0.02));
        }

        prevButtonsByPad.set(
          pad.index,
          pad.buttons.map((b) => b.pressed)
        );
      }
      hasConnectedPad = anyStillConnected;
    }, 50);

    return () => {
      window.clearInterval(poll);
      window.removeEventListener('gamepadconnected', onGamepadConnected);
      window.removeEventListener('gamepaddisconnected', onGamepadDisconnected);
    };
  }, [applyVolume, currentVolume, isSleeping, setIsSleeping, setIsDimmed]);

  return { applyFocusMarker, moveSpatialFocus };
}


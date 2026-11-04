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
  const gamepadActionRef = useRef<(action: string) => void>(() => {});
  const lastWebGamepadTsRef = useRef<number>(0);
  const lastGamepadInputTsRef = useRef<number>(0);

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
      if (dist > 55) {
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
      activeDom !== el &&
      (activeDom.tagName === 'INPUT' ||
        activeDom.tagName === 'SELECT' ||
        activeDom.tagName === 'TEXTAREA')
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
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, []);

  // Automatically place the focus marker on the default focus target when entering Browser or opening Modals
  useEffect(() => {
    if (view !== 'browser' && !sourceModalOpen && !powerModalOpen) return;
    const t = window.setTimeout(() => {
      const rootSelector =
        sourceModalOpen || powerModalOpen
          ? '[data-modal-root="true"] button:not([disabled]), [data-modal-root="true"] input:not([disabled])'
          : 'button[data-default-focus="true"]:not([disabled]), [data-nav-col="left"] button:not([disabled])';
      const preferred = document.querySelector<HTMLElement>(rootSelector);
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
      const isModalOpen = sourceModalOpen || powerModalOpen;
      const selector = oskTarget
        ? '[data-osk-root="true"] button:not([disabled])'
        : isModalOpen
        ? '[data-modal-root="true"] button:not([disabled]), [data-modal-root="true"] input:not([disabled]), [data-modal-root="true"] select:not([disabled]), [data-modal-root="true"] a'
        : 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [data-focusable="true"]';
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

          // Strongly prioritize vertical proximity within the same column so wide rows vs grid buttons never skip
          const score = Math.abs(dy) + Math.abs(dx) * 0.22;
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

          if (Math.abs(dy) > 22) continue;
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

        // 2. Otherwise cross directly between the Left Column (`left`) and Right Column (`right`) at the closest vertical Y!
        const targetCol =
          curCol === 'left' && dir === 'right'
            ? 'right'
            : curCol === 'right' && dir === 'left'
            ? 'left'
            : null;

        if (targetCol) {
          let bestCrossCol: HTMLElement | null = null;
          let bestCrossColScore = Infinity;

          for (const candidate of nodes) {
            if (getCol(candidate) !== targetCol) continue;
            if (isAuxRowElement(candidate)) continue;
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
        const cross = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
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
    const lastActionTs: Record<string, number> = {};
    const handleGamepadAction = (action: string) => {
      const now = performance.now();
      if (lastActionTs[action] && now - lastActionTs[action] < 70) return;
      lastActionTs[action] = now;
      lastGamepadInputTsRef.current = now;
      if (document.documentElement.dataset.simpInput !== 'gamepad') {
        document.documentElement.dataset.simpInput = 'gamepad';
      }
      setIsDimmed(false);
      if (isSleeping) {
        setIsSleeping(false);
        return;
      }

      // In the `🎵 Player` (`lock`) view (when modals and OSK are closed), D-Pad maps directly
      // to the on-screen transport badges (`◄` Previous, `►` Next, `▲/▼` Volume, `A` Play/Pause)!
      const isDirectTransportView =
        view === 'lock' && !sourceModalOpen && !powerModalOpen && !oskTarget;

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
        case 'back':
          if (oskTarget) {
            const prevInputSelector = `[data-osk-input="${oskTarget}"]`;
            setOskTarget(null);
            window.setTimeout(() => {
              const inp = document.querySelector<HTMLElement>(prevInputSelector);
              if (inp) applyFocusMarker(inp);
            }, 30);
          } else if (volumePopoverOpen || brightnessPopoverOpen) {
            setVolumePopoverOpen(false);
            setBrightnessPopoverOpen(false);
          } else if (confirmHardReset) {
            setConfirmHardReset(false);
          } else if (powerModalOpen) {
            setPowerModalOpen(false);
          } else if (sourceModalOpen) {
            setSourceModalOpen(false);
          } else if (activeCloudAlbum || activeCloudPlaylist) {
            setActiveCloudAlbum(null);
            setActiveCloudPlaylist(null);
          } else if (view === 'browser') {
            setView('lock');
          } else if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'SIMP_EXIT_CONSOLE' }, '*');
          }
          break;
        case 'shuffle':
          defaultSimpClient.setShuffle(!shuffle);
          break;
        case 'repeat':
          defaultSimpClient.cycleRepeat();
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
          setOskTarget(null);
          setPowerModalOpen(false);
          setSourceModalOpen((v) => !v);
          break;
        case 'power':
          setOskTarget(null);
          setSourceModalOpen(false);
          setPowerModalOpen((v) => !v);
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

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        if (e.key === 'Escape') {
          (e.target as HTMLElement).blur();
          setOskTarget(null);
        }
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        handleGamepadAction('up');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        handleGamepadAction('down');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleGamepadAction('left');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleGamepadAction('right');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleGamepadAction('activate');
      } else if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault();
        handleGamepadAction('back');
      } else if (e.key === ' ') {
        if (document.activeElement === document.body || !document.activeElement) {
          e.preventDefault();
          defaultSimpClient.togglePlayPause();
        }
      }
    };

    const onMessage = (e: MessageEvent) => {
      const data = e.data;
      if (!data || data.type !== 'SIMP_GAMEPAD_ACTION') return;
      lastBridgeMsgTsRef.current = performance.now();
      handleGamepadAction(data.action);
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
        handleGamepadAction(action);
      }
    };

    // Native Linux `/dev/input/js*` & `/dev/input/event*` daemon gamepad fallback for standalone KDE / SteamVR windows
    const onDaemonGamepad = (e: any) => {
      const action = e?.detail?.action;
      if (!action) return;
      if (window.parent !== window) return;
      // Only ignore if the browser tab is hidden in the background; in SteamVR Desktop overlay mode,
      // visible windows (`visibilityState === 'visible'`) often have `document.hasFocus() === false` when using Gamepad mode!
      if (document.visibilityState === 'hidden') return;
      const now = performance.now();
      if (now - lastBridgeMsgTsRef.current < 220 || now - lastWebGamepadTsRef.current < 220) {
        return;
      }
      handleGamepadAction(action);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('message', onMessage);
    window.addEventListener('vgp_onbuttondown', onVgpEvent as EventListener, true);
    window.addEventListener('vgp_ondirection', onVgpEvent as EventListener, true);
    window.addEventListener('simp-daemon-gamepad', onDaemonGamepad as EventListener);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
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
  useEffect(() => {
    const prevButtonsByPad = new Map<number, boolean[]>();
    const prevAxisDirByPad = new Map<number, string | null>();
    const prevHatDirByPad = new Map<number, string | null>();

    const poll = window.setInterval(() => {
      const bridgeActive = performance.now() - lastBridgeMsgTsRef.current < 3500;
      const rawPads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const pad of rawPads) {
        if (!pad || !pad.connected) continue;

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
          gamepadActionRef.current(action);
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
    }, 50);

    return () => window.clearInterval(poll);
  }, [applyVolume, currentVolume, isSleeping, setIsSleeping, setIsDimmed]);

  return { applyFocusMarker, moveSpatialFocus };
}


import type * as ReactTypes from 'react';
import {
  defaultSimpClient,
  AlbumRecord,
  AppleMusicAuthConfig,
  PlaylistRecord,
  SimpStateSnapshot,
} from '@simp/client';
import { encodeQrMatrix } from '../../ui/src/components/qrMatrix';

/**
 * SteamOS Gaming Mode (`SharedJSContext`) exposes its active React instance on `window.SP_REACT`.
 * Using `window.SP_REACT` directly avoids bundling a second copy of React with a null hook dispatcher.
 */
const SP_REACT: typeof ReactTypes = (window as any).SP_REACT || (globalThis as any).SP_REACT || (window as any).React;

const SIMP_VERSION = 'v0.1.0-alpha.51';
let cachedLiveDaemonVersion = SIMP_VERSION;
const SIMP_CONSOLE_ROUTE = '/simp-console';

let cachedSteamFocusable: any = null;
let cachedSteamButtonItem: any = null;
let cachedSteamNavigation: any = null;

function getSteamWebpackModules(): any[] {
  const modules: any[] = [];
  try {
    const chunk = (window as any).webpackChunksteamui;
    if (!Array.isArray(chunk)) return modules;

    let webpackRequire: any;
    chunk.push([
      [Symbol('simp-decky-webpack')],
      {},
      (r: any) => {
        webpackRequire = r;
      },
    ]);
    if (!webpackRequire) return modules;

    // 1. Check already-loaded module cache (`webpackRequire.c`) first
    if (webpackRequire.c) {
      for (const key of Object.keys(webpackRequire.c)) {
        const exp = webpackRequire.c[key]?.exports;
        if (exp) modules.push(exp);
      }
    }

    // 2. Also scan module factories (`webpackRequire.m`) if not yet instantiated
    if (webpackRequire.m) {
      for (const id of Object.keys(webpackRequire.m)) {
        try {
          const exp = webpackRequire(id);
          if (exp) modules.push(exp);
        } catch {
          // Ignore factory init errors
        }
      }
    }
  } catch (err) {
    console.warn('[SIMP Decky] Failed to inspect webpackChunksteamui:', err);
  }
  return modules;
}

/**
 * Discovers Valve's native `Focusable` React component inside `window.DFL`, `window.deckyFrontendLib`,
 * or `window.webpackChunksteamui` (supporting both standard functions and `React.forwardRef` objects
 * where `typeof candidate === 'object'` and `candidate.render` holds the implementation).
 */
function resolveSteamFocusable(): any {
  if (cachedSteamFocusable) return cachedSteamFocusable;
  const globalDfl = (window as any).DFL || (window as any).deckyFrontendLib;
  if (globalDfl?.Focusable) {
    cachedSteamFocusable = globalDfl.Focusable;
    return cachedSteamFocusable;
  }

  const matchesFocusable = (fn: any): boolean => {
    if (!fn) return false;
    const str =
      (typeof fn === 'function' && fn.toString?.()) ||
      (fn?.render && typeof fn.render === 'function' && fn.render.toString?.()) ||
      (fn?.type && typeof fn.type === 'function' && fn.type.toString?.()) ||
      '';
    if (!str) return false;
    return (
      str.includes('flow-children') &&
      (str.includes('onActivate') ||
        str.includes('focusClassName') ||
        str.includes('navRef') ||
        str.includes('focusWithinClassName'))
    );
  };

  for (const mod of getSteamWebpackModules()) {
    for (const candidate of [mod?.default, mod]) {
      if (!candidate || candidate === window) continue;
      if (matchesFocusable(candidate)) {
        cachedSteamFocusable = candidate;
        return cachedSteamFocusable;
      }
      if (typeof candidate === 'object') {
        for (const key of Object.keys(candidate)) {
          try {
            const exp = candidate[key];
            if (exp && matchesFocusable(exp)) {
              cachedSteamFocusable = exp;
              return cachedSteamFocusable;
            }
          } catch {
            // Ignore getter errors
          }
        }
      }
    }
  }
  return null;
}

/**
 * Discovers Valve's native `DialogButton` component for 100% native SteamOS QAM button focus.
 */
function resolveSteamDialogButton(): any {
  if (cachedSteamButtonItem) return cachedSteamButtonItem;
  const globalDfl = (window as any).DFL || (window as any).deckyFrontendLib;
  if (globalDfl?.DialogButton) {
    cachedSteamButtonItem = globalDfl.DialogButton;
    return cachedSteamButtonItem;
  }

  const matchesDialogButton = (fn: any): boolean => {
    if (!fn) return false;
    const str =
      (typeof fn === 'function' && fn.toString?.()) ||
      (fn?.render && typeof fn.render === 'function' && fn.render.toString?.()) ||
      '';
    return (
      str.includes('DialogButton') &&
      (str.includes('noFocusRing') || str.includes('onOKButton') || str.includes('focusable'))
    );
  };

  for (const mod of getSteamWebpackModules()) {
    if (typeof mod === 'object' && mod) {
      for (const key of Object.keys(mod)) {
        try {
          const exp = mod[key];
          if (exp && matchesDialogButton(exp)) {
            cachedSteamButtonItem = exp;
            return cachedSteamButtonItem;
          }
        } catch {
          // Ignore
        }
      }
    }
  }
  return null;
}

/**
 * Discovers Valve's `Navigation` router object (`Navigate`, `NavigateBack`, `CloseSideMenus`)
 * so SIMP can open the native `/simp-console` route inside Gaming Mode without triggering
 * the External Web Browser's `"Use touch"` controller block!
 */
function resolveSteamNavigation(): any {
  if (cachedSteamNavigation) return cachedSteamNavigation;
  const globalDfl = (window as any).DFL || (window as any).deckyFrontendLib;
  if (globalDfl?.Navigation) {
    cachedSteamNavigation = globalDfl.Navigation;
    return cachedSteamNavigation;
  }

  for (const mod of getSteamWebpackModules()) {
    for (const candidate of [mod?.default, mod]) {
      if (!candidate || typeof candidate !== 'object' || candidate === window) continue;
      if (
        typeof candidate.Navigate === 'function' &&
        (typeof candidate.NavigateBack === 'function' ||
          typeof candidate.CloseSideMenus === 'function')
      ) {
        cachedSteamNavigation = candidate;
        return cachedSteamNavigation;
      }
      for (const key of Object.keys(candidate)) {
        try {
          const exp = candidate[key];
          if (
            exp &&
            typeof exp === 'object' &&
            typeof exp.Navigate === 'function' &&
            (typeof exp.NavigateBack === 'function' || typeof exp.CloseSideMenus === 'function')
          ) {
            cachedSteamNavigation = exp;
            return cachedSteamNavigation;
          }
        } catch {
          // Ignore
        }
      }
    }
  }
  return null;
}

export type SteamPadAction =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'activate'
  | 'back'
  | 'shuffle'
  | 'repeat'
  | 'l1'
  | 'r1'
  | 'l2'
  | 'r2'
  | 'sources'
  | 'power';

let isSimpRouteRegistered = false;
let lastFocusableClickTs = 0;

function resolveDeckyRouterHook(serverApi?: any): any {
  return (
    serverApi?.routerHook ||
    (window as any).DeckyPluginLoader?.routerHook ||
    (window as any).DFL?.routerHook ||
    (window as any).deckyFrontendLib?.routerHook ||
    null
  );
}

/**
 * Maps Valve's `EGamepadButton` (`@decky/ui` / `decky-frontend-lib` / `vgp_onbuttondown`)
 * to canonical SIMP actions:
 *   1 = OK (A), 2 = CANCEL (B), 3 = SECONDARY (X), 4 = OPTIONS (Y),
 *   5 = BUMPER_LEFT (L1), 6 = BUMPER_RIGHT (R1), 7 = TRIGGER_LEFT (L2), 8 = TRIGGER_RIGHT (R2),
 *   9 = DIR_UP, 10 = DIR_DOWN, 11 = DIR_LEFT, 12 = DIR_RIGHT, 13 = SELECT, 14 = START
 */
const E_GAMEPAD_BUTTON_MAP: Record<number, SteamPadAction> = {
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

/**
 * Multi-source deduplicated SteamOS controller listener for both the QAM drawer and `/simp-console`:
 *   1. SteamUI DOM `vgp_onbuttondown` & `vgp_ondirection` events on the active window/document (capture phase)
 *   2. Standard `keydown` (`ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Enter`)
 */
function registerSteamControllerButtons(
  onAction: (action: SteamPadAction, rawEvent?: Event) => boolean | void,
  getTargetDoc?: () => Document | null
): () => void {
  const disposers: Array<() => void> = [];
  const lastEmitByAction: Record<string, number> = {};
  const lastConsumedByAction: Record<string, boolean> = {};

  const emit = (action: SteamPadAction | undefined, rawEvent?: Event): boolean => {
    if (!action) return false;
    const now = performance.now();
    if (lastEmitByAction[action] && now - lastEmitByAction[action] < 65) {
      return Boolean(lastConsumedByAction[action]);
    }
    lastEmitByAction[action] = now;
    const consumed = Boolean(onAction(action, rawEvent));
    lastConsumedByAction[action] = consumed;
    return consumed;
  };

  // Attach `vgp_onbuttondown`, `vgp_ondirection`, and `keydown` to both `window` and `ownerDocument`
  const attachedTargets = new Set<EventTarget>();
  const onVgp = (e: any) => {
    const btn = Number(e?.detail?.button);
    const action = btn ? E_GAMEPAD_BUTTON_MAP[btn] : undefined;
    if (action) {
      const consumed = emit(action, e);
      if (consumed) {
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
        if (typeof e.preventDefault === 'function') e.preventDefault();
      }
    }
  };
  const onKeyDown = (e: any) => {
    const map: Record<string, SteamPadAction> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      Enter: 'activate',
    };
    const action = map[e.key];
    if (action) {
      const consumed = emit(action, e);
      if (consumed) {
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
        if (typeof e.preventDefault === 'function') e.preventDefault();
      }
    }
  };

  const attachToTarget = (target: EventTarget | null | undefined) => {
    if (!target || attachedTargets.has(target)) return;
    attachedTargets.add(target);
    target.addEventListener('vgp_onbuttondown', onVgp as EventListener, true);
    target.addEventListener('vgp_ondirection', onVgp as EventListener, true);
    target.addEventListener('keydown', onKeyDown as EventListener, true);
    disposers.push(() => {
      target.removeEventListener('vgp_onbuttondown', onVgp as EventListener, true);
      target.removeEventListener('vgp_ondirection', onVgp as EventListener, true);
      target.removeEventListener('keydown', onKeyDown as EventListener, true);
    });
  };

  attachToTarget(window);
  attachToTarget(document);

  // Poll briefly to attach to `ownerDocument` & its `defaultView` once the QAM / Route ref mounts
  const syncDocTarget = () => {
    const doc = getTargetDoc?.();
    if (doc) {
      attachToTarget(doc);
      attachToTarget(doc.defaultView);
    }
  };
  syncDocTarget();
  const docTimer = window.setInterval(syncDocTarget, 250);
  disposers.push(() => window.clearInterval(docTimer));

  return () => {
    for (const fn of disposers) {
      try {
        fn();
      } catch {
        // Ignore
      }
    }
  };
}

/**
 * Navigates to the native `/simp-console` Decky route inside SteamUI (avoiding the `"Use touch"`
 * External Web Browser popup), closing the QAM drawer automatically.
 * Falls back to the inline fullscreen console overlay inside SteamUI if `routerHook` isn't available.
 */
function openFullSimpConsole(onFallbackInline?: () => void) {
  try {
    const nav = resolveSteamNavigation();
    if (isSimpRouteRegistered && nav?.Navigate) {
      if (nav?.CloseSideMenus) {
        nav.CloseSideMenus();
      }
      nav.Navigate(SIMP_CONSOLE_ROUTE);
      return;
    }
    const routerHook = resolveDeckyRouterHook();
    if (isSimpRouteRegistered && routerHook?.navigate) {
      if (nav?.CloseSideMenus) {
        nav.CloseSideMenus();
      }
      routerHook.navigate(SIMP_CONSOLE_ROUTE);
      return;
    }
  } catch {
    // Fall through to inline fullscreen SteamUI overlay
  }
  if (onFallbackInline) {
    onFallbackInline();
  }
}

/**
 * Fullscreen Native SteamUI Route (`/simp-console`) registered via Decky's `routerHook.addRoute`.
 * Renders SIMP Console (`http://127.0.0.1:18888`) inside a native SteamUI `Focusable` screen
 * and bridges all Steam Deck controller buttons (`D-Pad`, `A`, `B`, `X`, `Y`, `L1`, `R1`, `L2`, `R2`, `Start`)
 * directly into the Console UI via `postMessage` — zero `"Use touch"` banner and 100% controller support!
 */
const SimpNativeConsoleRoute: ReactTypes.FC<{ onExit?: () => void }> = ({ onExit }) => {
  const { useEffect, useRef } = SP_REACT;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const mountTsRef = useRef<number>(Date.now());
  const lastSentByActionRef = useRef<Record<string, number>>({});

  const sendAction = (action: SteamPadAction) => {
    const now = performance.now();
    const prev = lastSentByActionRef.current[action] || 0;
    if (now - prev < 65) return;
    lastSentByActionRef.current[action] = now;

    const win = iframeRef.current?.contentWindow;
    if (win) {
      win.postMessage({ type: 'SIMP_GAMEPAD_ACTION', action }, '*');
    }
  };

  const exitConsole = () => {
    if (onExit) {
      onExit();
      return;
    }
    const nav = resolveSteamNavigation();
    if (nav?.NavigateBack) {
      nav.NavigateBack();
    } else {
      window.history.back();
    }
  };

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'SIMP_EXIT_CONSOLE') {
        exitConsole();
      } else if (e.data?.type === 'SIMP_OPEN_OSK') {
        try {
          const sc = (window as any).SteamClient;
          if (sc?.Browser?.ShowVirtualKeyboard) {
            sc.Browser.ShowVirtualKeyboard();
          } else if (sc?.URL?.ExecuteSteamURL) {
            sc.URL.ExecuteSteamURL('steam://open/keyboard');
          }
        } catch {
          // Built-in Console OSK inside SIMP UI handles controller typing as well
        }
      }
    };
    window.addEventListener('message', onMessage);

    const unsubController = registerSteamControllerButtons(
      (action) => {
        sendAction(action);
        return true;
      },
      () => containerRef.current?.ownerDocument || null
    );

    return () => {
      window.removeEventListener('message', onMessage);
      unsubController();
    };
  }, []);

  return (
    <Focusable
      useNativeSteamFocusable={true}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        background: '#000000',
        zIndex: 999999,
        display: 'flex',
        flexDirection: 'column',
      }}
      onActivate={() => sendAction('activate')}
      onOKButton={() => sendAction('activate')}
      onCancel={() => sendAction('back')}
      onCancelButton={() => sendAction('back')}
      onSecondaryButton={() => sendAction('shuffle')}
      onOptionsButton={() => sendAction('repeat')}
      onMenuButton={() => sendAction('power')}
      onMoveUp={() => {
        sendAction('up');
        return true;
      }}
      onMoveDown={() => {
        sendAction('down');
        return true;
      }}
      onMoveLeft={() => {
        sendAction('left');
        return true;
      }}
      onMoveRight={() => {
        sendAction('right');
        return true;
      }}
      onButtonDown={(evt: any) => {
        const btn = Number(evt?.detail?.button);
        if (btn && E_GAMEPAD_BUTTON_MAP[btn]) {
          sendAction(E_GAMEPAD_BUTTON_MAP[btn]);
        }
      }}
      onGamepadDirection={(evt: any) => {
        const dir = Number(evt?.detail?.button);
        if (dir && E_GAMEPAD_BUTTON_MAP[dir]) {
          sendAction(E_GAMEPAD_BUTTON_MAP[dir]);
        }
        return true;
      }}
    >
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}
      >
        <iframe
          ref={iframeRef}
          src={`http://127.0.0.1:18888/?v=${encodeURIComponent(cachedLiveDaemonVersion)}&t=${mountTsRef.current}`}
          title="SIMP Console"
          allow="autoplay; encrypted-media; clipboard-write"
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            background: '#000000',
          }}
        />
      </div>
    </Focusable>
  );
};

/**
 * Gamepad-navigable Focusable container & button component.
 * Uses Valve's native `Focusable` from `window.DFL` or `window.webpackChunksteamui` and marks
 * interactive nodes with `.SimpInteractiveBtn` + `data-simp-focusable="true"` so both native
 * `CNavTree` and our spatial controller bridge can navigate them seamlessly.
 */
const Focusable: ReactTypes.FC<any> = ({
  onActivate,
  onClick,
  className = '',
  children,
  style,
  flowChildren,
  useNativeSteamFocusable = false,
  ...rest
}) => {
  const SteamFocusable = useNativeSteamFocusable ? resolveSteamFocusable() : null;
  const isInteractive = Boolean(onActivate || onClick);
  const combinedClassName = `Focusable ${isInteractive ? 'SimpInteractiveBtn' : ''} ${className}`.trim();

  const handleClick = (e: any) => {
    const now = performance.now();
    if (now - lastFocusableClickTs < 140) return;
    lastFocusableClickTs = now;
    if (onActivate) onActivate(e);
    else if (onClick) onClick(e);
  };

  if (SteamFocusable) {
    return SP_REACT.createElement(
      SteamFocusable,
      {
        onActivate: isInteractive ? handleClick : undefined,
        onOKButton: isInteractive ? handleClick : undefined,
        onClick: isInteractive ? handleClick : undefined,
        focusable: isInteractive,
        'data-simp-focusable': isInteractive ? 'true' : undefined,
        className: combinedClassName,
        focusClassName: 'gpfocus',
        focusWithinClassName: 'gpfocuswithin',
        style,
        'flow-children': flowChildren,
        ...rest,
      },
      children
    );
  }

  return SP_REACT.createElement(
    'div',
    {
      role: isInteractive ? 'button' : undefined,
      tabIndex: isInteractive ? 0 : undefined,
      'data-simp-focusable': isInteractive ? 'true' : undefined,
      className: combinedClassName,
      onClick: isInteractive ? handleClick : undefined,
      onKeyDown: isInteractive
        ? (e: any) => {
            if (e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 32) {
              e.preventDefault();
              handleClick(e);
            }
          }
        : undefined,
      style,
      ...rest,
    },
    children
  );
};

const DeckyQrSvg: ReactTypes.FC<{ value: string; size?: number }> = ({
  value,
  size = 92,
}) => {
  const matrix = encodeQrMatrix(value);
  const n = matrix.length;
  const quiet = 2;
  const viewBoxSize = n + quiet * 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
      shapeRendering="crispEdges"
      style={{
        borderRadius: 10,
        background: '#ffffff',
        padding: 4,
        boxSizing: 'border-box',
        flexShrink: 0,
      }}
    >
      <rect width={viewBoxSize} height={viewBoxSize} fill="#ffffff" />
      {matrix.map((row, r) =>
        row.map((cell, c) =>
          cell ? (
            <rect
              key={`${r}-${c}`}
              x={c + quiet}
              y={r + quiet}
              width={1}
              height={1}
              fill="#07070c"
            />
          ) : null
        )
      )}
    </svg>
  );
};

/**
 * Pilot Phase 2: Lightweight Decky Loader QAM (`...` Menu) Drawer.
 * Connects directly to `simp --daemon` over `ws://127.0.0.1:18888/ws` with zero Python audio glue.
 */
const SimpDeckyDrawer: ReactTypes.FC<{ serverApi?: any }> = ({ serverApi }) => {
  const { useState, useEffect, useRef } = SP_REACT;
  const drawerRootRef = useRef<HTMLDivElement | null>(null);
  const [snap, setSnap] = useState<SimpStateSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateLabel, setUpdateLabel] = useState<string>('⬆️ Update');
  const [liveVersion, setLiveVersion] = useState<string>(cachedLiveDaemonVersion);
  const [updateAvailableTag, setUpdateAvailableTag] = useState<string | null>(null);
  const [albums, setAlbums] = useState<AlbumRecord[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistRecord[]>([]);
  const [authCfg, setAuthCfg] = useState<AppleMusicAuthConfig | null>(null);
  const [drawerTab, setDrawerTab] = useState<'none' | 'albums' | 'playlists' | 'pair'>('none');
  const [volumeEditMode, setVolumeEditMode] = useState<boolean>(false);
  const volumeEditRef = useRef<boolean>(false);
  const volumeRailRef = useRef<HTMLDivElement | null>(null);
  const isDraggingVolRef = useRef<boolean>(false);
  const [focusedIdx, setFocusedIdx] = useState<number>(-1);
  const focusedIdxRef = useRef<number>(-1);
  const [inlineConsoleOpen, setInlineConsoleOpen] = useState<boolean>(false);

  const setVolEdit = (val: boolean) => {
    volumeEditRef.current = val;
    setVolumeEditMode(val);
  };

  const setDrawerFocusIdx = (idx: number) => {
    focusedIdxRef.current = idx;
    setFocusedIdx(idx);
  };

  const refreshCatalogs = () => {
    defaultSimpClient
      .query<AlbumRecord[]>('get_albums', { limit: 200, offset: 0 })
      .then((res) => {
        setConnected(true);
        if (Array.isArray(res)) setAlbums(res);
      })
      .catch(() => {});
    defaultSimpClient
      .query<PlaylistRecord[]>('get_playlists')
      .then((res) => {
        setConnected(true);
        if (Array.isArray(res)) setPlaylists(res);
      })
      .catch(() => {});
    defaultSimpClient
      .getAppleMusicAuthConfig()
      .then((cfg) => {
        setConnected(true);
        setAuthCfg(cfg);
      })
      .catch(() => {});
    fetch(`http://127.0.0.1:18888/health?t=${Date.now()}`)
      .then((r) => r.json())
      .then((h) => {
        if (h?.version) {
          const v = `v${String(h.version).replace(/^v/, '')}`;
          cachedLiveDaemonVersion = v;
          setLiveVersion(v);
        }
      })
      .catch(() => {});
    fetch(`http://127.0.0.1:18888/api/update/check?t=${Date.now()}`)
      .then((r) => r.json())
      .then((info) => {
        if (info?.current_version) {
          const v = `v${String(info.current_version).replace(/^v/, '')}`;
          cachedLiveDaemonVersion = v;
          setLiveVersion(v);
        }
        if (info?.update_available && info?.latest_tag) {
          setUpdateAvailableTag(String(info.latest_tag));
          setUpdateLabel(`⬆️ ${String(info.latest_tag)}`);
        } else {
          setUpdateAvailableTag(null);
        }
      })
      .catch(() => {});
    try {
      serverApi?.callPluginMethod?.('sync_decky_plugin', {});
    } catch {
      // Ignore if Decky serverApi isn't exposed
    }
  };

  useEffect(() => {
    defaultSimpClient.connect();

    const unsubState = defaultSimpClient.subscribeState((s) => {
      setSnap({ ...s });
      setConnected(true);
      if (s?.daemon_version) {
        const v = `v${String(s.daemon_version).replace(/^v/, '')}`;
        cachedLiveDaemonVersion = v;
        setLiveVersion(v);
      }
    });

    const getInteractiveNodes = (): HTMLElement[] => {
      const root = drawerRootRef.current;
      if (!root) return [];
      return Array.from(
        root.querySelectorAll<HTMLElement>('.SimpInteractiveBtn, [data-simp-focusable="true"]')
      ).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
    };

    const isFocusInRightQamStrip = (): boolean => {
      const root = drawerRootRef.current;
      if (!root) return false;
      const drawerRect = root.getBoundingClientRect();
      const doc = root.ownerDocument;
      const gpEl = doc?.querySelector?.('.gpfocus') as HTMLElement | null;
      if (!gpEl || root.contains(gpEl)) return false;
      const gpRect = gpEl.getBoundingClientRect();
      return gpRect.width > 0 && gpRect.left > drawerRect.right + 4;
    };

    const moveDrawerFocus = (dir: 'up' | 'down' | 'left' | 'right'): boolean => {
      const nodes = getInteractiveNodes();
      if (nodes.length === 0) return false;

      const prev = focusedIdxRef.current;
      if (prev < 0 || prev >= nodes.length) {
        // When focus is outside the SIMP drawer (e.g. on Decky's `< SIMP Audio Player` header),
        // only enter the SIMP drawer when the user presses D-Pad Down from the header column.
        if (dir !== 'down' || isFocusInRightQamStrip()) {
          return false;
        }
        const initial = Math.min(2, nodes.length - 1);
        nodes.forEach((n, idx) => n.classList.toggle('gpfocus', idx === initial));
        nodes[initial]?.scrollIntoView({ block: 'nearest' });
        setDrawerFocusIdx(initial);
        return true;
      }

      const curNode = nodes[prev];
      const cur = curNode.getBoundingClientRect();
      const cx = cur.left + cur.width / 2;
      const cy = cur.top + cur.height / 2;

      let bestIdx = prev;
      let bestScore = Infinity;

      nodes.forEach((candidate, idx) => {
        if (idx === prev) return;
        const r = candidate.getBoundingClientRect();
        const tx = r.left + r.width / 2;
        const ty = r.top + r.height / 2;
        const dx = tx - cx;
        const dy = ty - cy;

        if (dir === 'right' && (dx <= 4 || Math.abs(dy) > 22)) return;
        if (dir === 'left' && (dx >= -4 || Math.abs(dy) > 22)) return;
        if (dir === 'down' && dy <= 4) return;
        if (dir === 'up' && dy >= -4) return;

        const primary = dir === 'left' || dir === 'right' ? Math.abs(dx) : Math.abs(dy);
        const cross = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
        const score = primary + cross * 2.5;
        if (score < bestScore) {
          bestScore = score;
          bestIdx = idx;
        }
      });

      // If user presses Up at the very top row of the SIMP drawer, release focus back to `< SIMP` header
      if (dir === 'up' && bestIdx === prev) {
        nodes.forEach((n) => n.classList.remove('gpfocus'));
        setVolEdit(false);
        setDrawerFocusIdx(-1);
        return true;
      }

      // If user presses Left at the left edge of a row (when not in Volume Scrub Mode), release focus to QAM
      if (dir === 'left' && bestIdx === prev) {
        nodes.forEach((n) => n.classList.remove('gpfocus'));
        setVolEdit(false);
        setDrawerFocusIdx(-1);
        return false;
      }

      nodes.forEach((n, idx) => n.classList.toggle('gpfocus', idx === bestIdx));
      nodes[bestIdx]?.scrollIntoView({ block: 'nearest' });
      setDrawerFocusIdx(bestIdx);
      return true;
    };

    const activateDrawerFocus = (): boolean => {
      const nodes = getInteractiveNodes();
      const cur = focusedIdxRef.current;
      if (cur >= 0 && cur < nodes.length) {
        nodes[cur].click();
        return true;
      }
      return false;
    };

    const unsubController = registerSteamControllerButtons(
      (action) => {
        if (!drawerRootRef.current || drawerRootRef.current.offsetParent === null) return false;

        // When Volume Scrub Mode (`volumeEditRef.current`) is active on the volume bar:
        // D-Pad Left/Right steps volume by ±5%, B exits Scrub Mode, and Up/Down exits Scrub Mode & moves focus.
        if (volumeEditRef.current) {
          if (action === 'left' || action === 'right') {
            const curVol = defaultSimpClient.getState()?.volume ?? 0.85;
            const delta = action === 'right' ? 0.05 : -0.05;
            const nextVol = Math.max(0.05, Math.min(1, Math.round((curVol + delta) * 100) / 100));
            defaultSimpClient.setVolume(nextVol);
            return true;
          }
          if (action === 'back') {
            setVolEdit(false);
            return true;
          }
          if (action === 'up' || action === 'down') {
            setVolEdit(false);
          }
        }

        switch (action) {
          case 'up':
          case 'down':
          case 'left':
          case 'right':
            return moveDrawerFocus(action);
          case 'activate':
            return activateDrawerFocus();
          case 'back':
            if (focusedIdxRef.current >= 0) {
              const nodes = getInteractiveNodes();
              nodes.forEach((n) => n.classList.remove('gpfocus'));
              setVolEdit(false);
              setDrawerFocusIdx(-1);
            }
            return false;
          case 'shuffle':
            if (focusedIdxRef.current >= 0) {
              defaultSimpClient.setShuffle(!defaultSimpClient.getState()?.shuffle);
              return true;
            }
            return false;
          case 'repeat':
            if (focusedIdxRef.current >= 0) {
              defaultSimpClient.cycleRepeat();
              return true;
            }
            return false;
          case 'l2':
            if (focusedIdxRef.current >= 0) {
              defaultSimpClient.seekRelative(-10_000);
              return true;
            }
            return false;
          case 'r2':
            if (focusedIdxRef.current >= 0) {
              defaultSimpClient.seekRelative(10_000);
              return true;
            }
            return false;
          default:
            return false;
        }
      },
      () => drawerRootRef.current?.ownerDocument || null
    );

    const timer = window.setTimeout(refreshCatalogs, 350);
    return () => {
      window.clearTimeout(timer);
      unsubController();
      unsubState();
    };
  }, []);

  const handleReloadDaemon = async () => {
    setReloading(true);
    try {
      defaultSimpClient.restartDaemon();
      if (serverApi?.callPluginMethod) {
        await serverApi.callPluginMethod('restart_daemon', {});
      }
    } catch {
      // Fallback if Decky serverApi isn't exposed
    }
    window.setTimeout(() => {
      defaultSimpClient.connect();
      refreshCatalogs();
      setReloading(false);
    }, 950);
  };

  const handleSelfUpdate = async () => {
    if (updating) return;
    setUpdating(true);
    setUpdateLabel('⏳ Updating...');
    let targetVer = '';
    try {
      const resp = await fetch('http://127.0.0.1:18888/api/update/apply', { method: 'POST' });
      const data = await resp.json();
      if (data.ok || data.status === 'ok') {
        targetVer = String(data.updated_version || data.installed_version || '').replace(/^v/, '');
        if (targetVer) {
          const v = `v${targetVer}`;
          cachedLiveDaemonVersion = v;
          setLiveVersion(v);
        }
        setUpdateAvailableTag(null);
        setUpdateLabel(`✅ v${targetVer || 'Updated'}`);
        try {
          if (serverApi?.callPluginMethod) {
            await serverApi.callPluginMethod('sync_decky_plugin', {});
          }
        } catch {
          // Ignore if Decky serverApi isn't exposed
        }
      } else {
        setUpdateLabel('⚠️ Error');
      }
    } catch {
      setUpdateLabel('🔄 Restarting...');
    }

    // Wait for the newly restarted daemon to come online on :18888 before re-querying /health & /api/update/check
    // so an in-flight shutdown of the old daemon never reverts `liveVersion` to the previous release.
    await new Promise((r) => window.setTimeout(r, 950));
    for (let attempt = 0; attempt < 15; attempt++) {
      try {
        const hr = await fetch(`http://127.0.0.1:18888/health?t=${Date.now()}`);
        if (hr.ok) {
          const hj = await hr.json();
          const reported = String(hj?.version || '').replace(/^v/, '');
          if (reported && (!targetVer || reported === targetVer)) {
            const v = `v${reported}`;
            cachedLiveDaemonVersion = v;
            setLiveVersion(v);
            break;
          }
        }
      } catch {
        // Daemon is still restarting
      }
      await new Promise((r) => window.setTimeout(r, 400));
    }

    defaultSimpClient.connect();
    refreshCatalogs();
    setUpdating(false);
    setUpdateLabel('⬆️ Update');
  };

  const toggleDrawerTab = (tab: 'albums' | 'playlists' | 'pair') => {
    const next = drawerTab === tab ? 'none' : tab;
    setDrawerTab(next);
    if (next === 'albums') {
      defaultSimpClient
        .query<AlbumRecord[]>('get_albums', { limit: 200, offset: 0 })
        .then((res) => Array.isArray(res) && setAlbums(res))
        .catch(() => {});
    } else if (next === 'playlists') {
      defaultSimpClient
        .query<PlaylistRecord[]>('get_playlists')
        .then((res) => Array.isArray(res) && setPlaylists(res))
        .catch(() => {});
    } else if (next === 'pair') {
      defaultSimpClient
        .getAppleMusicAuthConfig()
        .then((cfg) => setAuthCfg(cfg))
        .catch(() => {});
    }
  };

  const track = snap?.current_track;
  const isPlaying = Boolean(snap?.is_playing);
  const volumePct = Math.round((snap?.volume ?? 0.85) * 100);
  const repeatMode = snap?.repeat_mode ?? 'off';
  const repeatLabel = repeatMode === 'queue' ? 'All' : repeatMode === 'track' ? 'One' : 'Off';

  const setVolumeFromPointer = (clientX: number) => {
    const el = volumeRailRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0.05, Math.min(1, (clientX - rect.left) / rect.width));
    defaultSimpClient.setVolume(Math.round(ratio * 100) / 100);
  };

  const btnStyle: ReactTypes.CSSProperties = {
    minHeight: 44,
    borderRadius: 10,
    border: '1px solid #262630',
    background: '#121216',
    color: '#d4d4dc',
    fontWeight: 700,
    fontSize: 14,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'border-box',
    userSelect: 'none',
  };

  return (
    <Focusable
      flowChildren="vertical"
      style={{
        padding: 10,
        color: '#d4d4dc',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {inlineConsoleOpen && (
        <SimpNativeConsoleRoute onExit={() => setInlineConsoleOpen(false)} />
      )}
      <div
        ref={drawerRootRef}
        data-simp-drawer-root="true"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <style>{`
          [data-simp-drawer-root="true"] .SimpInteractiveBtn.gpfocus {
            outline: 2px solid #2aa3c4 !important;
            outline-offset: 1px !important;
            background: #18333e !important;
          }
          ${
            focusedIdx >= 0
              ? `
          .gpfocus:not([data-simp-focusable="true"]) {
            outline: none !important;
            box-shadow: none !important;
          }
          `
              : ''
          }
        `}</style>

      {/* Now Playing Card */}
      <Focusable
        flowChildren="vertical"
        style={{
          padding: 12,
          borderRadius: 12,
          background: '#000000',
          border: '1px solid #262630',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 8,
              background: '#121216',
              border: '1px solid #262630',
              overflow: 'hidden',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {track?.art_url ? (
              <img
                src={track.art_url}
                alt="Art"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <img
                src="http://127.0.0.1:18888/simp-icon-dark.png"
                alt="SIMP"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            )}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontWeight: 700,
                fontSize: 14,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {track?.title || 'SIMP Ready'}
            </div>
            <div
              style={{
                fontSize: 12,
                color: '#a1a1aa',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {track?.artists?.join(', ') || (connected ? 'Daemon Online (:18888)' : 'Connecting...')}
            </div>
            {track?.album && (
              <div
                style={{
                  fontSize: 11,
                  color: '#2aa3c4',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {track.album}
              </div>
            )}
          </div>
        </div>

        {/* 5-Button Symmetrical Transport Row */}
        <Focusable flowChildren="horizontal" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
          <Focusable
            onActivate={() => defaultSimpClient.seekRelative(-10_000)}
            onClick={() => defaultSimpClient.seekRelative(-10_000)}
            style={btnStyle}
            title="Rewind 10s"
          >
            ⏪
          </Focusable>
          <Focusable
            onActivate={() => defaultSimpClient.previous()}
            onClick={() => defaultSimpClient.previous()}
            style={btnStyle}
            title="Previous"
          >
            ⏮
          </Focusable>
          <Focusable
            onActivate={() => defaultSimpClient.togglePlayPause()}
            onClick={() => defaultSimpClient.togglePlayPause()}
            style={{
              ...btnStyle,
              background: isPlaying ? '#0f222a' : '#18141c',
              borderColor: isPlaying ? '#2aa3c4' : '#52525b',
              color: isPlaying ? '#5bc0de' : '#d4d4dc',
              fontSize: 16,
            }}
            title={isPlaying ? 'Pause / Silence Audio' : 'Play / Resume Audio'}
          >
            {isPlaying ? '⏸' : '▶'}
          </Focusable>
          <Focusable
            onActivate={() => defaultSimpClient.next()}
            onClick={() => defaultSimpClient.next()}
            style={btnStyle}
            title="Next"
          >
            ⏭
          </Focusable>
          <Focusable
            onActivate={() => defaultSimpClient.seekRelative(10_000)}
            onClick={() => defaultSimpClient.seekRelative(10_000)}
            style={btnStyle}
            title="Fast-Forward 10s"
          >
            ⏩
          </Focusable>
        </Focusable>

        {/* Shuffle & Repeat Row */}
        <Focusable flowChildren="horizontal" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <Focusable
            onActivate={() => defaultSimpClient.setShuffle(!snap?.shuffle)}
            onClick={() => defaultSimpClient.setShuffle(!snap?.shuffle)}
            style={{
              ...btnStyle,
              minHeight: 38,
              fontSize: 12,
              borderColor: snap?.shuffle ? '#2aa3c4' : '#262630',
              color: snap?.shuffle ? '#5bc0de' : '#a1a1aa',
            }}
          >
            🔀 {snap?.shuffle ? 'Shuffle: ON' : 'Shuffle: OFF'}
          </Focusable>
          <Focusable
            onActivate={() => defaultSimpClient.cycleRepeat()}
            onClick={() => defaultSimpClient.cycleRepeat()}
            style={{
              ...btnStyle,
              minHeight: 38,
              fontSize: 12,
              borderColor: repeatMode !== 'off' ? '#2aa3c4' : '#262630',
              color: repeatMode !== 'off' ? '#5bc0de' : '#a1a1aa',
            }}
          >
            🔁 Repeat: {repeatLabel}
          </Focusable>
        </Focusable>

        {/* Unified Single-Row Volume Bar (Coupled to Play/Pause state + Press A to enter Left/Right Scrub Mode) */}
        <Focusable
          data-simp-volume-row="true"
          onActivate={() => setVolEdit(!volumeEditRef.current)}
          onClick={() => {
            if (!isDraggingVolRef.current) {
              setVolEdit(!volumeEditRef.current);
            }
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minHeight: 40,
            padding: '0 10px',
            borderRadius: 10,
            background: volumeEditMode ? '#1d160b' : '#121216',
            border: volumeEditMode
              ? '1px solid #f59e0b'
              : isPlaying
              ? '1px solid #262630'
              : '1px solid #1c1c24',
            boxSizing: 'border-box',
            width: '100%',
            minWidth: 0,
            overflow: 'hidden',
            cursor: 'pointer',
            userSelect: 'none',
            touchAction: 'none',
          }}
          title={
            volumeEditMode
              ? 'Volume Scrub Mode: Use D-Pad Left/Right to adjust, or press A/B when done'
              : 'Press A to adjust volume with D-Pad Left/Right (or drag bar with touch)'
          }
        >
          <span
            style={{
              fontSize: 13,
              lineHeight: 1,
              flexShrink: 0,
              color: volumeEditMode ? '#fcd34d' : isPlaying ? '#2aa3c4' : '#71717a',
            }}
          >
            {!isPlaying ? '🔇' : volumePct < 45 ? '🔉' : '🔊'}
          </span>

          {/* Custom Zero-Overflow Touch & Controller Scrub Rail */}
          <div
            ref={volumeRailRef}
            onPointerDown={(e) => {
              e.stopPropagation();
              isDraggingVolRef.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              setVolumeFromPointer(e.clientX);
            }}
            onPointerMove={(e) => {
              if (!isDraggingVolRef.current) return;
              e.stopPropagation();
              setVolumeFromPointer(e.clientX);
            }}
            onPointerUp={(e) => {
              if (!isDraggingVolRef.current) return;
              e.stopPropagation();
              if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
              }
              setVolumeFromPointer(e.clientX);
              window.setTimeout(() => {
                isDraggingVolRef.current = false;
              }, 80);
            }}
            onPointerCancel={() => {
              isDraggingVolRef.current = false;
            }}
            style={{
              flex: 1,
              minWidth: 0,
              height: 22,
              display: 'flex',
              alignItems: 'center',
              position: 'relative',
            }}
          >
            <div
              style={{
                width: '100%',
                height: 8,
                borderRadius: 999,
                background: '#08080c',
                border: '1px solid #22222e',
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <div
                style={{
                  width: `${Math.max(0, Math.min(100, volumePct))}%`,
                  height: '100%',
                  borderRadius: 999,
                  background: volumeEditMode
                    ? '#f59e0b'
                    : isPlaying
                    ? 'linear-gradient(90deg, #164e63 0%, #2aa3c4 100%)'
                    : '#3f3f46',
                  transition: 'width 60ms linear',
                }}
              />
            </div>
          </div>

          <span
            style={{
              fontSize: 11,
              fontFamily: 'monospace',
              fontWeight: 800,
              color: volumeEditMode ? '#fcd34d' : isPlaying ? '#d4d4dc' : '#8e8e99',
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
          >
            {volumeEditMode
              ? `◄ ${volumePct}% ►`
              : isPlaying
              ? `${volumePct}%`
              : `${volumePct}% • PAUSED`}
          </span>
        </Focusable>
      </Focusable>

      {/* Quick Switcher Drawer Tabs */}
      <Focusable
        flowChildren="horizontal"
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6 }}
      >
        <Focusable
          onActivate={() => toggleDrawerTab('albums')}
          onClick={() => toggleDrawerTab('albums')}
          style={{
            ...btnStyle,
            minHeight: 38,
            fontSize: 12,
            borderColor: drawerTab === 'albums' ? '#2aa3c4' : '#262630',
            color: drawerTab === 'albums' ? '#5bc0de' : '#d4d4dc',
          }}
        >
          💿 Albums ({albums.length})
        </Focusable>
        <Focusable
          onActivate={() => toggleDrawerTab('playlists')}
          onClick={() => toggleDrawerTab('playlists')}
          style={{
            ...btnStyle,
            minHeight: 38,
            fontSize: 12,
            borderColor: drawerTab === 'playlists' ? '#2aa3c4' : '#262630',
            color: drawerTab === 'playlists' ? '#5bc0de' : '#d4d4dc',
          }}
        >
          Playlists ({playlists.length})
        </Focusable>
        <Focusable
          onActivate={() => toggleDrawerTab('pair')}
          onClick={() => toggleDrawerTab('pair')}
          style={{
            ...btnStyle,
            minHeight: 38,
            padding: '0 10px',
            fontSize: 12,
            borderColor:
              drawerTab === 'pair'
                ? '#f43f5e'
                : snap?.apple_authenticated
                ? '#10b981'
                : '#262630',
            color:
              drawerTab === 'pair'
                ? '#fda4af'
                : snap?.apple_authenticated
                ? '#6ee7b7'
                : '#d4d4dc',
          }}
          title="Apple Music QR Companion Pairing"
        >
          {snap?.apple_authenticated ? '🍎 Paired' : '📱 Pair QR'}
        </Focusable>
      </Focusable>

      {drawerTab === 'pair' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: 10,
            borderRadius: 10,
            background: '#000000',
            border: '1px solid #f43f5e',
          }}
        >
          <DeckyQrSvg
            value={authCfg?.pair_url || 'http://steamdeck.local:18888/pair'}
            size={92}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#fda4af' }}>
              {snap?.apple_authenticated ? '🟢 Apple Music Connected' : '📱 Scan with iPhone / PC'}
            </div>
            <div style={{ fontSize: 11, color: '#a1a1aa', lineHeight: 1.35 }}>
              Sign in with Face ID, Passkey, or YubiKey on your phone/PC to sync Apple Music directly to your Deck.
            </div>
            <div
              style={{
                fontSize: 10,
                fontFamily: 'monospace',
                color: '#67e8f9',
                wordBreak: 'break-all',
              }}
            >
              {authCfg?.pair_url || 'http://steamdeck.local:18888/pair'}
            </div>
          </div>
        </div>
      )}

      {drawerTab === 'albums' && (
        <Focusable
          flowChildren="vertical"
          style={{
            maxHeight: 190,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            padding: 6,
            borderRadius: 10,
            background: '#000000',
            border: '1px solid #262630',
          }}
        >
          {albums.map((alb) => (
            <Focusable
              key={alb.id}
              onActivate={() => defaultSimpClient.playAlbum(alb.id, false)}
              onClick={() => defaultSimpClient.playAlbum(alb.id, false)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                padding: '8px 10px',
                borderRadius: 8,
                background: '#121216',
                border: '1px solid #262630',
                color: '#d4d4dc',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 700 }}>{alb.title}</span>
              <span style={{ fontSize: 11, color: '#a1a1aa' }}>
                {alb.album_artist} • {alb.track_count} tracks
              </span>
            </Focusable>
          ))}
        </Focusable>
      )}

      {drawerTab === 'playlists' && (
        <Focusable
          flowChildren="vertical"
          style={{
            maxHeight: 190,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            padding: 6,
            borderRadius: 10,
            background: '#000000',
            border: '1px solid #262630',
          }}
        >
          {playlists.length === 0 ? (
            <div style={{ fontSize: 12, color: '#a1a1aa', padding: 8 }}>
              No saved playlists yet. Create one in the Full Console.
            </div>
          ) : (
            playlists.map((pl) => (
              <Focusable
                key={pl.id}
                onActivate={() => defaultSimpClient.playPlaylist(pl.id, false)}
                onClick={() => defaultSimpClient.playPlaylist(pl.id, false)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: '#121216',
                  border: '1px solid #262630',
                  color: '#d4d4dc',
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 700 }}>{pl.name}</span>
                <span style={{ fontSize: 11, color: '#a1a1aa' }}>{pl.track_count} tracks</span>
              </Focusable>
            ))
          )}
        </Focusable>
      )}

      {/* Open Full SIMP Console + Update + Reload Row */}
      <Focusable flowChildren="horizontal" style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 6 }}>
        <Focusable
          onActivate={() => openFullSimpConsole(() => setInlineConsoleOpen(true))}
          onClick={() => openFullSimpConsole(() => setInlineConsoleOpen(true))}
          style={{
            ...btnStyle,
            minHeight: 40,
            fontSize: 11,
            color: '#a1a1aa',
          }}
        >
          ↗ Console ({liveVersion || SIMP_VERSION})
        </Focusable>
        <Focusable
          onActivate={handleSelfUpdate}
          onClick={handleSelfUpdate}
          style={{
            ...btnStyle,
            minHeight: 40,
            padding: '0 10px',
            fontSize: 11,
            color: updating ? '#34d399' : updateAvailableTag ? '#34d399' : '#5bc0de',
            borderColor: updating ? '#34d399' : updateAvailableTag ? '#10b981' : '#262630',
          }}
          title="1-Click Self-Update SIMP Daemon + Decky Plugin from GitHub Releases"
        >
          {updateLabel}
        </Focusable>
        <Focusable
          onActivate={handleReloadDaemon}
          onClick={handleReloadDaemon}
          style={{
            ...btnStyle,
            minHeight: 40,
            padding: '0 10px',
            fontSize: 11,
            color: reloading ? '#5bc0de' : '#a1a1aa',
            borderColor: reloading ? '#2aa3c4' : '#262630',
          }}
          title="Restart SIMP Background Daemon & Widevine Worker"
        >
          {reloading ? '⏳' : '🔄 BG'}
        </Focusable>
      </Focusable>
      </div>
    </Focusable>
  );
};

/**
 * Standard Decky Loader plugin entrypoint (`api_version: 1`).
 */
export default function defineSimpDeckyPlugin(serverApi?: any) {
  const routerHook = resolveDeckyRouterHook(serverApi);
  try {
    if (routerHook?.addRoute) {
      routerHook.addRoute(SIMP_CONSOLE_ROUTE, SimpNativeConsoleRoute, {
        exact: true,
      });
      isSimpRouteRegistered = true;
    }
  } catch (err) {
    console.warn('[SIMP Decky] Failed to register /simp-console route:', err);
  }

  return {
    title: <div style={{ fontWeight: 800 }}>SIMP Audio Player</div>,
    content: <SimpDeckyDrawer serverApi={serverApi} />,
    icon: <span>🎵</span>,
    onDismount() {
      try {
        const rh = resolveDeckyRouterHook(serverApi);
        if (rh?.removeRoute) {
          rh.removeRoute(SIMP_CONSOLE_ROUTE);
        }
        isSimpRouteRegistered = false;
      } catch {
        // Ignore teardown errors
      }
    },
  };
}


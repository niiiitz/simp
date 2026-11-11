export interface WasmVizExports {
  memory: WebAssembly.Memory;
  viz_frame_ptr: () => number;
  viz_art_ptr: () => number;
  viz_notify_art_loaded: (hasArt: number) => void;
  viz_set_bands: (
    b0: number,
    b1: number,
    b2: number,
    b3: number,
    b4: number,
    b5: number,
    b6: number,
    b7: number,
    b8: number,
    b9: number,
    b10: number,
    b11: number,
    b12: number,
    b13: number,
    b14: number,
    b15: number,
  ) => void;
  viz_render_frame: (
    sceneId: number,
    timeSec: number,
    trackProgress: number,
    rms: number,
    peak: number,
    onset: number,
    bpm: number,
    transProgress: number,
  ) => void;
}

let wasmInstanceExports: WasmVizExports | null = null;
let wasmLoadPromise: Promise<WasmVizExports | null> | null = null;

export function ensureWasmVizEngineLoaded(): Promise<WasmVizExports | null> {
  if (wasmInstanceExports) {
    return Promise.resolve(wasmInstanceExports);
  }
  if (wasmLoadPromise) {
    return wasmLoadPromise;
  }
  wasmLoadPromise = (async () => {
    try {
      const resp = await fetch('/simp_viz_engine.wasm');
      if (!resp.ok) return null;
      const bytes = await resp.arrayBuffer();
      const { instance } = await WebAssembly.instantiate(bytes, {});
      wasmInstanceExports = instance.exports as unknown as WasmVizExports;
      return wasmInstanceExports;
    } catch {
      return null;
    }
  })();
  return wasmLoadPromise;
}

export function getLoadedWasmVizEngine(): WasmVizExports | null {
  return wasmInstanceExports;
}

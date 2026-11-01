import { defineConfig } from 'vite';

/**
 * Decky Loader (`api_version: 1`) executes plugins inside Steam's `SharedJSContext`
 * where React is already mounted globally as `window.SP_REACT`.
 * Never bundle a duplicate copy of React 19 (which has a null dispatcher inside Steam's renderer);
 * compile JSX directly to `SP_REACT.createElement` / `SP_REACT.Fragment`.
 */
export default defineConfig({
  esbuild: {
    jsx: 'transform',
    jsxFactory: 'SP_REACT.createElement',
    jsxFragment: 'SP_REACT.Fragment',
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    minify: 'terser',
    lib: {
      entry: 'src/index.tsx',
      name: 'SimpDeckyPlugin',
      formats: ['es', 'iife'],
      fileName: (format) => (format === 'es' ? 'index.js' : 'index.iife.js'),
    },
    sourcemap: false,
  },
});



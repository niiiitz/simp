import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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


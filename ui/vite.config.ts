import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Micro-footprint Vite configuration for SteamOS WebKitGTK
export default defineConfig({
  plugins: [react()],
  server: {
    port: 1420,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:18888',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://127.0.0.1:18888',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'esnext',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
    cssCodeSplit: true,
    sourcemap: false,
  },
});


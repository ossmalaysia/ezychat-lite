import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const SERVER = process.env.WATI_DEV_SERVER ?? 'http://127.0.0.1:7420';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Task 13 appends VitePWA({ strategies: 'injectManifest', srcDir: 'src', filename: 'sw.ts', ... }) here.
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: SERVER, changeOrigin: false },
      '/socket.io': { target: SERVER, ws: true, changeOrigin: false },
    },
  },
  preview: {
    proxy: {
      '/api': { target: SERVER, changeOrigin: false },
      '/socket.io': { target: SERVER, ws: true, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    emptyOutDir: true,
  },
});

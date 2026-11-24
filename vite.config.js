import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'esnext',
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});

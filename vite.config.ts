import { defineConfig } from 'vite';

export default defineConfig({
  // Cloudflare Pages serves the static bundle from the build root, so keep
  // asset URLs relative enough to survive being mounted at any subpath.
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
});

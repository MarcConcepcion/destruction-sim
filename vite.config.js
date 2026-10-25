import { defineConfig } from 'vite';

/**
 * GitHub Pages serves project sites from https://<user>.github.io/<repo>/.
 * A relative base ('./') makes every asset URL in the build relative to
 * index.html, so the same build works from any repo name or sub-path (and
 * from a custom domain or a plain `file://`-style static host) without
 * configuration. Override with VITE_BASE=/my-repo/ if you prefer absolute URLs.
 */
export default defineConfig({
  base: process.env.VITE_BASE || './',
  build: {
    target: 'es2022',
    sourcemap: false,
    // Rapier's compat build embeds its WASM as base64, so it is a large (but
    // single, cacheable) chunk. Split vendors so game-code updates stay small.
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/@dimforge')) return 'rapier';
        },
      },
    },
  },
  server: { host: true },
  preview: { host: true },
});

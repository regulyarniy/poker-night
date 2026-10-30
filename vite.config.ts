import { fileURLToPath, URL } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';
import { offlinePlugin } from './vite-plugin-offline';

/** База GitHub Pages: репозиторий `poker-night` (§14). Менять только вместе с репо. */
const BASE = '/poker-night/';

export default defineConfig({
  base: BASE,
  plugins: [preact(), offlinePlugin({ base: BASE })],
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    cssTarget: 'chrome111',
    sourcemap: false,
  },
});

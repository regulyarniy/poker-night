/**
 * Build-хуки (docs/SPEC.md §10.1, §10.4).
 *
 * 1. `generateBundle` собирает список ассетов из манифеста Vite и печатает
 *    `sw.js` из `src/sw-source.ts` — с версией кэша и precache-списком.
 * 2. Тот же хук копирует `index.html` → `404.html`: GitHub Pages отдаёт его
 *    на неизвестные пути, и SPA подхватывает маршрут (иначе `/share/...` = 404).
 *
 * В репозитории `404.html` нет — только на выходе сборки.
 */

import type { Plugin } from 'vite';
import { buildServiceWorker, cacheVersion } from './src/sw-source';

export type OfflinePluginOptions = {
  /** База приложения из `vite.config.ts`, например `/poker-night/`. */
  base: string;
};

/** Убирает ведущий `/` — precache-пути должны быть относительными. */
function toRelative(base: string, fileName: string): string {
  const prefix = base.endsWith('/') ? base : `${base}/`;
  const clean = fileName.startsWith('/') ? fileName.slice(1) : fileName;
  if (!prefix || prefix === '/') return clean;
  return clean.startsWith(prefix) ? clean.slice(prefix.length) : clean;
}

export function offlinePlugin({ base }: OfflinePluginOptions): Plugin {
  return {
    name: 'poker-night-offline',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).map((fileName) => toRelative(base, fileName));
      const precache = [
        'index.html',
        'manifest.webmanifest',
        'icons/192.png',
        'icons/512.png',
        'icons/maskable-512.png',
        ...files.filter((file) => file.endsWith('.js') || file.endsWith('.css')),
      ];

      const source = buildServiceWorker({
        precache: [...new Set(precache)],
        version: cacheVersion(precache),
      });

      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source,
      });

      // 404.html — точная копия index.html (§10.4).
      const index = bundle['index.html'];
      if (index && index.type === 'asset') {
        this.emitFile({
          type: 'asset',
          fileName: '404.html',
          source: index.source,
        });
      }
    },
  };
}


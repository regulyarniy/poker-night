/**
 * Исходник Service Worker как строка (docs/SPEC.md §10.1).
 *
 * SW собирается build-хуком: список precache и версия кэша известны только
 * после того, как Vite посчитал все имена файлов. Поэтому текст SW здесь —
 * чистая функция `buildServiceWorker({ precache, version })`, которую
 * покрывают тесты, а плагин в vite.config.ts просто кладёт результат в бандл.
 */

export type ServiceWorkerOptions = {
  /** Пути от корня сайта: `index.html`, `assets/index-abc.js`, … */
  precache: string[];
  /** Версия кэша — хэш сборки. Меняется → старые кэши удаляются. */
  version: string;
};

/** Экранирование для вставки в JS-литерал. */
function json(value: unknown): string {
  return JSON.stringify(value);
}

export function buildServiceWorker({ precache, version }: ServiceWorkerOptions): string {
  return `/* Poker Night service worker — generated, do not edit */
const CACHE = 'poker-night-${version}';
const PRECACHE = ${json(precache)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // По одному: один недоступный файл не должен ломать установку.
      await Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined),
        ),
      );
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/** Навигация: сеть → кэш index.html. */
async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE);
      cache.put('index.html', response.clone()).catch(() => undefined);
      return response;
    }
    throw new Error('bad status');
  } catch {
    const cache = await caches.open(CACHE);
    const cached = (await cache.match('index.html')) || (await cache.match('.')); 
    return (
      cached ||
      new Response('<!doctype html><meta charset="utf-8"><title>Offline</title>', {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    );
  }
}

/** Ассеты: кэш-first, immutable. */
async function handleAsset(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone()).catch(() => undefined);
  return response;
}

/** Манифест и иконки: stale-while-revalidate. */
async function handleStale(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone()).catch(() => undefined);
      return response;
    })
    .catch(() => undefined);
  const resolved = cached || (await network);
  return resolved || Response.error();
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }
  if (url.pathname.includes('/assets/')) {
    event.respondWith(handleAsset(request));
    return;
  }
  if (
    url.pathname.endsWith('manifest.webmanifest') ||
    url.pathname.includes('/icons/')
  ) {
    event.respondWith(handleStale(request));
  }
});
`;
}

/** Стабильная версия кэша по списку файлов: одна и та же сборка → один и тот же ключ. */
export function cacheVersion(files: string[]): string {
  let hash = 2166136261;
  for (const file of [...files].sort()) {
    for (let i = 0; i < file.length; i++) {
      hash ^= file.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  }
  return (hash >>> 0).toString(36);
}

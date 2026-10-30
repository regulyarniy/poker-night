/**
 * Регистрация Service Worker и тост обновления (docs/SPEC.md §10.2).
 *
 * Никаких Workbox: `registration.update()` по возврату во вкладку,
 * `SKIP_WAITING` по кнопке в тосте, перезагрузка по `controllerchange`.
 */

import { showToast } from './ui/kit';

const MESSAGES = {
  update: 'Доступно обновление',
  failed: 'Офлайн-режим недоступен',
} as const;

/** Только в проде: dev-сервер отдаёт модули без хэшей, кэш там вредит. */
export function registerServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) return;

  const url = `${import.meta.env.BASE_URL}sw.js`;

  globalThis.addEventListener?.('load', () => {
    void (async () => {
      try {
        const registration = await navigator.serviceWorker.register(url, {
          scope: import.meta.env.BASE_URL,
        });

        // Уже ждал обновления до этой загрузки — сразу предлагаем перезагрузить.
        if (registration.waiting && navigator.serviceWorker.controller) {
          offerReload(registration);
        }

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state !== 'installed') return;
            // Первая установка: страницей уже управляет этот SW, тост не нужен.
            if (!navigator.serviceWorker.controller) return;
            offerReload(registration);
          });
        });

        // Проверяем обновление при возврате во вкладку — без опроса по таймеру.
        globalThis.addEventListener?.('visibilitychange', () => {
          if (document.visibilityState === 'visible') void registration.update();
        });
      } catch {
        showToast(MESSAGES.failed, 'warn');
      }
    })();
  });
}

/** Тост с кнопкой: без нажатия обновление не применяется (§10.2). */
function offerReload(registration: ServiceWorkerRegistration): void {
  showToast(MESSAGES.update, 'warn', {
    label: 'Перезагрузить',
    run: () => {
      const waiting = registration.waiting;
      if (waiting) {
        waiting.postMessage({ type: 'SKIP_WAITING' });
        // Если воркер уже активировался (например, нажали дважды) — просто
        // перезагружаем, иначе ждём controllerchange.
        if (!registration.waiting) globalThis.location?.reload();
        return;
      }
      globalThis.location?.reload();
    },
  });
}

/** Перезагрузка после смены контроллера — один раз, чтобы не уйти в цикл. */
export function watchControllerChange(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    globalThis.location?.reload();
  });
}

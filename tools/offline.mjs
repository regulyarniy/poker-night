/**
 * Проверка офлайна (docs/SPEC.md §10.1): после первой загрузки приложение
 * обязано открываться и работать без сети.
 *
 * Запуск: node tools/offline.mjs [url]
 * Требует собранный `dist/` и запущенный `pnpm preview`.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.argv[2] ?? 'http://localhost:4174/poker-night/';
const PORT = 9336;
const profile = mkdtempSync(join(tmpdir(), 'pn-offline-'));
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function wsUrl() {
  for (let i = 0; i < 120; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const data = await response.json();
      if (data.webSocketDebuggerUrl) return data.webSocketDebuggerUrl;
    } catch {
      // Chrome стартует.
    }
    await sleep(100);
  }
  throw new Error('Chrome не отвечает');
}

const socket = new WebSocket(await wsUrl());
await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));

let seq = 0;
const pending = new Map();
const events = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
    return;
  }
  events.push(message);
});

const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
    setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`${method}: timeout`));
    }, 20000);
  });

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Runtime.enable', {}, sessionId);
await send('Page.enable', {}, sessionId);
await send('Network.enable', {}, sessionId);

const evaluate = async (expression) => {
  const result = await send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? 'ошибка evaluate');
  }
  return result.result.value;
};

const waitFor = async (expression, timeout = 12000) => {
  const started = Date.now();
  for (;;) {
    try {
      if (await evaluate(expression)) return true;
    } catch {
      // страница ещё грузится
    }
    if (Date.now() - started > timeout) return false;
    await sleep(150);
  }
};

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

// 1. Первая загрузка и установка SW.
await send(
  'Emulation.setDeviceMetricsOverride',
  { width: 375, height: 689, deviceScaleFactor: 2, mobile: true },
  sessionId,
);
await send('Page.navigate', { url: URL }, sessionId);
check('первая загрузка', await waitFor('!!document.querySelector(".menu")'));

const swState = await evaluate(`(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  return JSON.stringify({
    controller: !!navigator.serviceWorker.controller,
    count: regs.length,
    active: regs.map((r) => (r.active ? r.active.state : null)),
    scope: regs.map((r) => r.scope),
  });
})()`);
console.log('   SW:', swState);
const swReady = await waitFor(
  `navigator.serviceWorker.controller !== null`,
  20000,
);
check('service worker управляет страницей', swReady, swState);
const precached = await waitFor(
  `(async () => {
     const keys = await caches.keys();
     if (keys.length === 0) return false;
     const cache = await caches.open(keys[0]);
     const requests = await cache.keys();
     return requests.some((r) => r.url.endsWith('index.html')) && requests.some((r) => r.url.includes('/assets/'));
   })()`,
  20000,
);
check('precache содержит index.html и ассеты', precached, await evaluate('caches.keys().then((k) => k.join(","))'));

// 2. Сеть выключается — приложение обязано открыться из кэша.
await send('Network.emulateNetworkConditions', {
  offline: true,
  latency: 0,
  downloadThroughput: 0,
  uploadThroughput: 0,
}, sessionId);

await send('Page.navigate', { url: `${URL}history` }, sessionId);
const offlineHistory = await waitFor('!!document.querySelector(".history__month, .empty")', 15000);
check('офлайн: /history открывается', offlineHistory, await evaluate('document.title'));

await send('Page.navigate', { url: `${URL}settings` }, sessionId);
check('офлайн: /settings открывается', await waitFor('!!document.querySelector(".denom")', 15000));

await send('Page.navigate', { url: URL }, sessionId);
check('офлайн: главная открывается', await waitFor('!!document.querySelector(".menu")', 15000));

// 3. Глубокая ссылка офлайн не даёт 404 — 404.html отдан сервером, SPA подхватил маршрут.
await send('Page.navigate', { url: `${URL}share/AAAA`, }, sessionId);
check(
  'офлайн: глубокая ссылка не 404',
  await waitFor(
    `document.body.textContent.includes('Ссылка повреждена') || document.body.textContent.includes('Poker Night')`,
    15000,
  ),
);

await send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 0,
  downloadThroughput: -1,
  uploadThroughput: -1,
}, sessionId);

socket.close();
chrome.kill();
await sleep(300);
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  // профиль мог остаться занятым
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} проверок прошло`);
if (failed.length > 0) process.exitCode = 1;



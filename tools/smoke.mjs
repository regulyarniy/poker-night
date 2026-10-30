/**
 * Ручная проверка в реальном Chrome через CDP (docs/PLAN.md: UI-тесты не пишем,
 * но ручной сценарий нужно чем-то воспроизводить).
 *
 * Запуск: node tools/smoke.mjs [url]
 * Требует запущенный `pnpm preview` и Chrome в PATH/по стандартному пути.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.argv[2] ?? 'http://localhost:4174/poker-night/';
const PORT = 9333;

const profile = mkdtempSync(join(tmpdir(), 'pn-smoke-'));
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
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const data = await response.json();
      if (data.webSocketDebuggerUrl) return data.webSocketDebuggerUrl;
    } catch {
      // Chrome ещё стартует.
    }
    await sleep(100);
  }
  throw new Error('Chrome не отвечает');
}

class CDP {
  #socket;
  #id = 0;
  #pending = new Map();
  events = [];

  static async connect(url) {
    const cdp = new CDP();
    cdp.#socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      cdp.#socket.addEventListener('open', resolve, { once: true });
      cdp.#socket.addEventListener('error', reject, { once: true });
    });
    cdp.#socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && cdp.#pending.has(message.id)) {
        const { resolve, reject } = cdp.#pending.get(message.id);
        cdp.#pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
        return;
      }
      cdp.events.push(message);
    });
    return cdp;
  }

  send(method, params = {}, sessionId) {
    const id = ++this.#id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.#socket.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.#pending.has(id)) {
          this.#pending.delete(id);
          reject(new Error(`${method}: timeout`));
        }
      }, 20000);
    });
  }

  close() {
    this.#socket.close();
  }
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const browser = await CDP.connect(await wsUrl());
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });

  const consoleErrors = [];
  browser.events.length = 0;
  await browser.send('Runtime.enable', {}, sessionId);
  await browser.send('Page.enable', {}, sessionId);
  await browser.send('Log.enable', {}, sessionId);

  const evaluate = async (expression) => {
    const result = await browser.send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      sessionId,
    );
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'ошибка evaluate');
    }
    return result.result.value;
  };

  const waitFor = async (expression, timeout = 8000) => {
    const started = Date.now();
    for (;;) {
      try {
        if (await evaluate(expression)) return true;
      } catch {
        // страница ещё грузится
      }
      if (Date.now() - started > timeout) return false;
      await sleep(100);
    }
  };

  const setViewport = (width, height) =>
    browser.send(
      'Emulation.setDeviceMetricsOverride',
      { width, height, deviceScaleFactor: 2, mobile: true },
      sessionId,
    );

  const navigate = async (url) => {
    await browser.send('Page.navigate', { url }, sessionId);
    await sleep(400);
  };

  await setViewport(375, 689);
  await navigate(URL);
  const booted = await waitFor('!!document.querySelector(".menu")');
  check('главная отрисовывается', booted);

  // Собираем ошибки консоли со всей сессии.
  const drain = () => {
    for (const event of browser.events) {
      if (event.method === 'Runtime.exceptionThrown') {
        consoleErrors.push(
          event.params.exceptionDetails?.exception?.description ??
            event.params.exceptionDetails?.text ??
            'exception',
        );
      }
      if (event.method === 'Log.entryAdded' && event.params.entry.level === 'error') {
        consoleErrors.push(event.params.entry.text);
      }
    }
    browser.events = browser.events.filter(
      (event) => event.method !== 'Runtime.exceptionThrown' && event.method !== 'Log.entryAdded',
    );
  };

  // Настройки: набор и дефолты.
  await navigate(`${URL}settings`);
  check('экран настроек', await waitFor('!!document.querySelector(".denom")'));
  check(
    'набор 12 250 фишек',
    await evaluate('document.body.textContent.includes("12\\u00a0250")'),
    await evaluate('document.body.textContent.match(/[\\d\\u00a0 ]+фишек/)?.[0] ?? ""'),
  );

  // Новая игра.
  await navigate(`${URL}new`);
  check('экран новой игры', await waitFor('!!document.querySelector(".variant")'));
  const cards = await evaluate(
    `[...document.querySelectorAll('.variant')].map((el) => ({ label: el.querySelector('.variant__name').textContent, vector: el.querySelector('.variant__vector').textContent, disabled: el.disabled }))`,
  );
  check('три карточки раздачи', cards.length === 3, JSON.stringify(cards.map((c) => c.label)));
  check(
    'balanced = 5×10 · 50×11',
    cards[0]?.vector === '5×10 · 50×11',
    cards[0]?.vector,
  );

  // Старт игры.
  const startEnabled = await evaluate(`!document.querySelector('.btn--primary[disabled]')`);
  check('кнопка старта активна', Boolean(startEnabled));
  await evaluate(`document.querySelector('.btn--primary.btn--lg').click()`);
  const inGame = await waitFor('!!document.querySelector(".bank")', 6000);
  check('игра создана и открыта', inGame, await evaluate('location.pathname'));
  const gameUrl = await evaluate('location.pathname');
  const players = await evaluate('document.querySelectorAll(".player").length');
  check('4 игрока на экране', players === 4, String(players));

  // Пересдача: журнал пока только из deal-событий (§6.7), значит кнопка есть.
  check(
    'пересдача доступна до докупки',
    await evaluate(
      `[...document.querySelectorAll('button')].some((b) => b.textContent.includes('Пересдать раздачу'))`,
    ),
  );
  await evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Пересдать раздачу')).click()`,
  );
  check(
    'диалог пересдачи открылся',
    await waitFor(
      `!!document.querySelector('dialog.modal[open]') && document.querySelector('dialog.modal[open]').textContent.includes('Пересдать')`,
    ),
  );
  await evaluate(
    `[...document.querySelectorAll('dialog.modal[open] .variant')]
      .find((b) => b.textContent.includes('Speed')).click()`,
  );
  await sleep(150);
  await evaluate(
    `[...document.querySelectorAll('dialog.modal[open] button')]
      .find((b) => b.textContent.trim() === 'Пересдать').click()`,
  );
  await sleep(600);
  /**
   * Прямая проверка персистентности: читаем игры из IndexedDB страницы.
   * Кнопка пересдачи после пересдачи остаётся — журнал снова только из deal,
   * поэтому смотрим именно на сохранённый вектор (§6.7).
   */
  const readGames = () =>
    evaluate(`(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('pokernight', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const games = await new Promise((resolve, reject) => {
        const request = db.transaction('games').objectStore('games').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return games.map((game) => ({
        id: game.id,
        status: game.status,
        variant: game.deal.variant,
        perPlayer: game.deal.perPlayer,
        events: game.events.length,
      }));
    })()`);

  const afterRedeal = await readGames();
  const stored = afterRedeal.find((g) => gameUrl.endsWith(g.id));
  check(
    'пересдача сохранилась в базу с вариантом Speed',
    Boolean(stored) && stored.variant === 'speed' && stored.events === 4,
    JSON.stringify(stored),
  );
  check('диалог пересдачи закрылся', await evaluate('!document.querySelector("dialog.modal[open]")'));

  // Шторка игрока: открывается, показывает метрики и закрывается по Esc.
  await evaluate(`document.querySelectorAll('.player__actions .btn')[1].click()`);
  check(
    'шторка игрока открылась',
    await waitFor('!!document.querySelector("dialog.modal[open] .drawer__title")'),
  );
  check(
    'шторка показывает «на руках» и куплено',
    await evaluate(
      `document.querySelector('dialog.modal[open]').textContent.includes('На руках') && document.querySelector('dialog.modal[open]').textContent.includes('Куплено стеков')`,
    ),
  );
  await browser.send(
    'Input.dispatchKeyEvent',
    { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
    sessionId,
  );
  await sleep(400);
  check(
    'шторка закрывается по Esc',
    await evaluate('!document.querySelector("dialog.modal[open]")'),
  );

  // Докупка первому игроку.
  const beforeBank = await evaluate('document.querySelector(".bank__value").textContent');
  await evaluate(`document.querySelectorAll('.player__actions .btn')[0].click()`);
  await sleep(400);
  const afterBank = await evaluate('document.querySelector(".bank__value").textContent');
  check('докупка уменьшила банк', beforeBank !== afterBank, `${beforeBank} → ${afterBank}`);
  // После докупки журнал перестаёт быть «только раздача» — пересдача исчезает (§6.7).
  check(
    'пересдача исчезла после докупки',
    await evaluate(
      `![...document.querySelectorAll('button')].some((b) => b.textContent.includes('Пересдать раздачу'))`,
    ),
  );

  // Проверка вёрстки: нет горизонтального скролла на 320 и 375.
  for (const width of [320, 375, 430]) {
    await setViewport(width, 689);
    await sleep(200);
    const overflow = await evaluate(
      'document.documentElement.scrollWidth - document.documentElement.clientWidth',
    );
    check(`нет горизонтального скролла на ${width}px`, overflow <= 0, `overflow=${overflow}`);
  }

  await setViewport(375, 689);
  await sleep(150);
  // Добавляем игроков кнопкой «Добавить игрока» — ввод настоящим нажатием клавиш.
  const typeInto = async (selector, text) => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    await browser.send('Input.insertText', { text }, sessionId);
    await sleep(120);
  };
  for (let i = 0; i < 2; i++) {
    await evaluate(
      `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Добавить игрока'))?.click()`,
    );
    await sleep(250);
    await typeInto('input[aria-label="Имя нового игрока"]', `Игрок ${i + 5}`);
    await evaluate(
      `document.querySelector('input[aria-label="Имя нового игрока"]').closest('form').querySelector('button[type=submit]').click()`,
    );
    await sleep(500);
  }
  const layout = await evaluate(
    `JSON.stringify({ players: document.querySelectorAll('.player').length, height: document.documentElement.scrollHeight, viewport: window.innerHeight })`,
  );
  check(
    '6 игроков помещаются на 375×689',
    await evaluate(
      'document.querySelectorAll(".player").length >= 6 && document.documentElement.scrollHeight <= window.innerHeight + 2',
    ),
    layout,
  );

  // Итоги.
  const gamePath = await evaluate('location.pathname');
  const gameId = gamePath.split('/').filter(Boolean).pop();
  await navigate(`${URL}game/${gameId}/results`);
  check('экран итогов', await waitFor('!!document.querySelector(".table")'));

  /** Сверка считается сошедшейся только по точному тексту бейджа. */
  const reconciledNow = () =>
    evaluate(
      `[...document.querySelectorAll('.badge')].some((b) => b.textContent.trim() === 'сходится')`,
    );
  const mismatchText = () =>
    evaluate(
      `[...document.querySelectorAll('.badge')].map((b) => b.textContent.trim()).find((t) => t.startsWith('не сходится')) ?? ''`,
    );

  // Пока остатки не введены — итоги помечены предварительными (§5.6, Q90).
  check(
    'до ввода остатков итоги предварительные',
    await evaluate(
      `[...document.querySelectorAll('.badge')].some((b) => b.textContent.trim() === 'не у всех') && document.body.textContent.includes('не зафиксирован')`,
    ),
  );

  // Финальные остатки: у первого игрока была докупка (+600). Тогда
  // у всех final == bought и Σ net обязана стать нулём (§3.4.2).
  const stacksCount = await evaluate(
    `document.querySelectorAll('input[aria-label^="Финальный остаток"]').length`,
  );
  for (let i = 0; i < stacksCount; i++) {
    await evaluate(
      `document.querySelectorAll('input[aria-label^="Финальный остаток"]')[${i}].focus()`,
    );
    await browser.send('Input.insertText', { text: i === 0 ? '1200' : '600' }, sessionId);
    await sleep(180);
  }
  await sleep(700);
  check(
    'Σ net = 0 после ввода всех остатков',
    await reconciledNow(),
    (await mismatchText()) || 'сходится',
  );

  // Архивация: мини-игра 1 → 2 → 3 → 4.
  await evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('В архив'))?.click()`,
  );
  check('мини-игра открылась', await waitFor('!!document.querySelector(".gate__area")'));
  for (const value of [1, 2, 3, 4]) {
    await evaluate(`document.querySelector('[aria-label="Цифра ${value}"]')?.click()`);
    await sleep(120);
  }
  await sleep(900);
  check(
    'игра в архиве и только для чтения',
    await evaluate('document.body.textContent.includes("только чтение")'),
    await evaluate('location.pathname'),
  );

  // Публичная ссылка: жмём «Поделиться» на архивной игре и читаем поле ссылки.
  await evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Поделиться'))?.click()`,
  );
  const shareOk = await waitFor(`!!document.querySelector('input[aria-label="Ссылка"]')`, 6000);
  const shareUrl = shareOk
    ? await evaluate(`document.querySelector('input[aria-label="Ссылка"]').value`)
    : '';
  check('ссылка собирается', shareUrl.includes('/share/'), String(shareUrl).slice(-40));
  if (shareUrl.includes('/share/')) {
    const payloadLength = shareUrl.split('/share/')[1]?.length ?? 0;
    check(
      'длина payload < 800',
      payloadLength > 0 && payloadLength < 800,
      `payload=${payloadLength}`,
    );
    await navigate(shareUrl);
    check(
      'публичная страница показывает всех игроков',
      await waitFor(
        '!!document.querySelector(".table") && document.querySelectorAll(".table tbody tr").length === ' +
          stacksCount,
      ),
      await evaluate('String(document.querySelectorAll(".table tbody tr").length)'),
    );
    check(
      'публичная страница без управления',
      await evaluate('!document.querySelector(".player__actions")'),
    );
  }

  // История.
  await navigate(`${URL}history`);
  check('история показывает игру', await waitFor('!!document.querySelector(".history__item")'));

  // Шит действий истории: открыть / поделиться / клон / удалить.
  await evaluate(`document.querySelector('.history__item').click()`);
  check(
    'шит истории открылся',
    await waitFor(
      `!!document.querySelector('dialog.modal[open]') && document.querySelector('dialog.modal[open]').textContent.includes('Открыть')`,
    ),
  );
  check(
    'шит предлагает клон и удаление',
    await evaluate(
      `(() => { const t = document.querySelector('dialog.modal[open]').textContent; return t.includes('Новая игра с этими настройками') && t.includes('Удалить'); })()`,
    ),
  );
  await evaluate(
    `[...document.querySelectorAll('dialog.modal[open] button')].find((b) => b.textContent.trim() === 'Отмена').click()`,
  );
  await sleep(300);
  check('шит истории закрывается', await evaluate('!document.querySelector("dialog.modal[open]")'));

  // Клон: /new?clone=:id подставляет имя игры и игроков (§12.11).
  await navigate(`${URL}new?clone=${gameId}`);
  await sleep(800);
  const cloneState = await evaluate(`JSON.stringify({
    path: location.pathname,
    title: document.querySelector('.topbar__title')?.textContent,
    values: [...document.querySelectorAll('input[aria-label^="Игрок"]')].map((input) => input.value),
  })`);
  check(
    'клон предзаполняет игроков',
    (await evaluate(`document.querySelectorAll('input[aria-label^="Игрок"]').length`)) === 6,
    cloneState,
  );

  drain();
  const realErrors = consoleErrors.filter(
    (text) =>
      !/favicon|manifest|ServiceWorker|service worker|navigator\.vibrate|permissions policy/i.test(
        text,
      ),
  );
  check('нет ошибок в консоли', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

  await browser.send('Target.closeTarget', { targetId });
  browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} проверок прошло`);
  if (failed.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    chrome.kill();
    await sleep(300);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // профиль ещё занят — не страшно
    }
  });






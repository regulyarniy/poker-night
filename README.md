# Poker Night

Мобильное SPA для домашних покерных вечеров: раздача фишек из своего набора, учёт докупок и
выводов, итоги вечера и публичная ссылка на результаты. Бэкенда нет — всё живёт в браузере,
данные в IndexedDB. Приложение работает офлайн после первой загрузки.

Живая версия: <https://regulyarniy.github.io/poker-night/>

Требования — `docs/SPEC.md` (источник правды), пошаговый план — `docs/PLAN.md`.

## Запуск

```bash
pnpm install
pnpm dev          # vite dev server
pnpm build        # production build в dist/
pnpm preview      # локальный просмотр сборки
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest run
pnpm lint         # biome check src
pnpm format       # biome format --write src
```

Всё вместе перед коммитом:

```bash
pnpm typecheck && pnpm test && pnpm lint && pnpm build
```

## Деплой

Push в `main` → GitHub Actions (`.github/workflows/deploy.yml`) → `actions/deploy-pages`.
В настройках репозитория: **Pages → Source = GitHub Actions**.

`base` в `vite.config.ts` — `/poker-night/`. Если репозиторий переименовать, поменять и его.

`public/404.html` в репозитории нет: build-хук (`vite-plugin-offline.ts`) копирует `index.html`
в `404.html` и печатает `sw.js` со списком precache. Без этого прямые ссылки `/share/...`
на GitHub Pages давали бы 404.

## Ограничения

- **Одна вкладка за раз.** Две вкладки перетирают данные: синхронизации нет (спека §12.6).
- Только русский язык, только тёмная тема.
- Сеть в рантайме не используется, кроме загрузки приложения и обновления Service Worker.
- Brotli-энкодинг ссылок не делается (нет в Chrome), декодирование есть.
- Экспорт/импорт базы, аккаунты, мультиустройство — вне области (§1.2).

## Размеры бандла

Замерено на production-сборке (gzip):

| Файл | raw | gzip | brotli |
|---|---|---|---|
| JS (`dist/assets/index-*.js`) | 101.3 KB | **31.4 KB** | 27.8 KB |
| CSS (`dist/assets/index-*.css`) | 86.1 KB | **15.6 KB** | 13.4 KB |

Бюджет спеки — JS < 120 KB gzip, CSS < 25 KB gzip. Кино `kinu` приносит ~70 KB CSS,
поэтому таблица стилей крупная; JS-часть — Preact + signals + idb + иконки.

## Иконки PWA

`public/icons/*` генерируются кодом: `python tools/gen-icons.py` (Pillow). Бинарники
не редактируются руками — меняется скрипт.

## Проверки в браузере

Юнит-тесты покрывают `src/core/**` и роутер. Сквозные сценарии прогоняются через
headless Chrome по CDP (нужен запущенный `pnpm preview`):

```bash
pnpm build
pnpm preview --port 4174 --strictPort   # отдельный терминал

node tools/smoke.mjs     # создание игры, докупка, вёрстка 320/375/430, итоги,
                         # архивация, ссылка, история
node tools/offline.mjs   # регистрация SW, precache и работа без сети
```

Скрипты ничего не устанавливают: Chrome берётся по стандартному пути
(`C:/Program Files/Google/Chrome/Application/chrome.exe`).

## Структура

```
src/
├─ core/        чистая логика (без Preact, DOM и idb) + тесты
├─ db/          IndexedDB: схема и репозиторий
├─ screens/     по файлу на экран
├─ components/  переиспользуемые куски UI
├─ ui/          обёртки: тосты, поля, моушн
├─ state/       сигналы и хук игры
├─ styles/      tokens.css + app.css
├─ router.ts    свой history-роутер
├─ sw.ts        регистрация SW и тост обновления
└─ sw-source.ts исходник SW (тестируемая чистая функция)
```

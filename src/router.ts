/**
 * Свой роутер (docs/SPEC.md §5.1).
 *
 * History-роутинг: разбор `location.pathname` без учёта base, подписка на
 * `popstate`, программная навигация через `history.pushState`.
 * Никаких зависимостей — ~60 строк по спеке.
 */

import { signal } from '@preact/signals';

export type Route =
  | { name: 'home' }
  | { name: 'new'; cloneId: string | null }
  | { name: 'game'; id: string }
  | { name: 'results'; id: string }
  | { name: 'history' }
  | { name: 'settings' }
  | { name: 'share'; payload: string }
  | { name: 'notFound'; path: string };

/** База приложения: `/poker-night/` в проде, `/` в dev. */
const BASE = normalizeBase(import.meta.env.BASE_URL);

function normalizeBase(base: string): string {
  const trimmed = base.replace(/\/+$/, '');
  return trimmed === '' ? '' : trimmed;
}

/** Убирает base из пути. `/poker-night/game/x` → `/game/x`. */
export function stripBase(pathname: string, base = BASE): string {
  if (base && (pathname === base || pathname.startsWith(`${base}/`))) {
    const rest = pathname.slice(base.length);
    return rest === '' ? '/' : rest;
  }
  return pathname === '' ? '/' : pathname;
}

/** Добавляет base к пути приложения. */
export function withBase(path: string, base = BASE): string {
  return `${base}${path}`;
}

/** Абсолютный URL для ссылки «Поделиться» (с текущим origin). */
export function absoluteUrl(path: string): string {
  return new URL(withBase(path), globalThis.location?.origin ?? 'http://localhost').href;
}

/** Разбор пути в маршрут. Всё неизвестное — 404. */
export function match(pathname: string, base = BASE): Route {
  const path = stripBase(pathname, base);
  const queryIndex = path.indexOf('?');
  const clean = queryIndex >= 0 ? path.slice(0, queryIndex) : path;
  const search = queryIndex >= 0 ? path.slice(queryIndex) : '';

  const segments = clean.split('/').filter((s) => s.length > 0);

  if (segments.length === 0) return { name: 'home' };
  const [head, second, third, ...rest] = segments;

  if (head === 'new' && segments.length === 1) {
    return { name: 'new', cloneId: readCloneId(search) };
  }
  if (head === 'history' && segments.length === 1) return { name: 'history' };
  if (head === 'settings' && segments.length === 1) return { name: 'settings' };
  if (head === 'game' && segments.length === 2 && second) {
    return { name: 'game', id: decodeURIComponent(second) };
  }
  if (head === 'game' && segments.length === 3 && second && third === 'results') {
    return { name: 'results', id: decodeURIComponent(second) };
  }
  if (head === 'share' && segments.length === 2 && second) {
    return { name: 'share', payload: decodeURIComponent(second) };
  }
  if (segments.length > 0 || rest.length > 0) return { name: 'notFound', path: clean };
  return { name: 'home' };
}

function readCloneId(search: string): string | null {
  const params = new URLSearchParams(search);
  const value = params.get('clone');
  return value && value.length > 0 ? value : null;
}

/** Текущий маршрут как сигнал — компоненты подписываются на него. */
export const route = signal<Route>(routeFromLocation());

/**
 * Маршрут из текущего адреса. Чистая функция от пары pathname/search —
 * ровно здесь однажды терялся `?clone=:id` (§12.11).
 */
export function routeFromLocation(pathname = '/', search = '', base = BASE): Route {
  return match(`${pathname}${search}`, base);
}

/** Обработчики «перед уходом»: dirty-формы, открытые шторки. */
type LeaveGuard = () => boolean;
const guards = new Set<LeaveGuard>();

export function addLeaveGuard(guard: LeaveGuard): () => void {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}

function canLeave(): boolean {
  for (const guard of guards) {
    if (!guard()) return false;
  }
  return true;
}

/**
 * Программная навигация. Возвращает false, если уход отменён guard-ом.
 * Дубликат текущего пути не создаёт новую запись в истории.
 *
 * Смена маршрута оборачивается в View Transition (§11.2) с фоллбеком
 * на мгновенную замену — сам `navigate` от этого не зависит.
 */
export function navigate(to: string): boolean {
  const target = withBase(to);
  if (target === globalThis.location?.pathname + globalThis.location?.search) return true;
  if (!canLeave()) return false;
  globalThis.history?.pushState(null, '', target);
  transitionToCurrentRoute(() => sync());
  return true;
}

/** Замена текущей записи — для редиректов и `/share` без истории. */
export function replace(to: string): void {
  globalThis.history?.replaceState(null, '', withBase(to));
  transitionToCurrentRoute(() => sync());
}

type TransitionDoc = Document & {
  startViewTransition?: (cb: () => void | Promise<void>) => { finished: Promise<void> };
};

/** View Transition с фоллбеком и уважением к `prefers-reduced-motion`. */
function transitionToCurrentRoute(apply: () => void): void {
  const doc = globalThis.document as TransitionDoc | undefined;
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  if (!doc?.startViewTransition || reduced) {
    apply();
    return;
  }
  doc.startViewTransition(() => {
    apply();
    // Preact перерисовывает в микрозадаче — даём кадр на новый DOM.
    return new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

function sync(): void {
  const loc = globalThis.location;
  route.value = routeFromLocation(loc?.pathname ?? '/', loc?.search ?? '');
}

/** Включает подписку на `popstate`. Возвращает функцию отписки. */
export function startRouter(): () => void {
  const onPop = () => {
    sync();
  };
  globalThis.addEventListener?.('popstate', onPop);
  sync();
  return () => {
    globalThis.removeEventListener?.('popstate', onPop);
  };
}

/** Ссылка-перехватчик: обычный `<a href>` деградирует до полной загрузки. */
export function linkHandler(to: string) {
  return (event: MouseEvent): void => {
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
}

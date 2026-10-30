/**
 * Даты и русские подписи (docs/SPEC.md §5.7, §11.4).
 *
 * Все функции принимают дату явно — время не читается из `Date.now()` внутри,
 * поэтому имена игр и группировка истории детерминированы в тестах.
 */

const MONTHS_GENITIVE = [
  'янв',
  'фев',
  'мар',
  'апр',
  'мая',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
] as const;

const MONTHS_NOMINATIVE = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
] as const;

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * ISO 8601 с локальным offset: `2026-10-29T20:45:00+10:00`.
 * Именно в таком виде даты хранятся в событиях и игре (§3.3).
 */
export function toIsoLocal(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** Разбор ISO-строки. Невалидная дата → null, а не Invalid Date. */
export function parseIso(text: string): Date | null {
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** «29 окт 20:45» — автоимя игры и строка истории. */
export function formatShortDateTime(text: string): string {
  const date = parseIso(text);
  if (!date) return '—';
  const month = MONTHS_GENITIVE[date.getMonth()] ?? '';
  return `${date.getDate()} ${month} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** «29 окт 20:45» — автоимя новой игры (§3.2). */
export function defaultGameName(date: Date): string {
  return formatShortDateTime(toIsoLocal(date));
}

/** «Октябрь 2026» — заголовок группы в истории (§5.7). */
export function formatMonth(text: string): string {
  const date = parseIso(text);
  if (!date) return 'Без даты';
  return `${MONTHS_NOMINATIVE[date.getMonth()] ?? ''} ${date.getFullYear()}`;
}

/** «20:45» — время события в журнале. */
export function formatTime(text: string): string {
  const date = parseIso(text);
  if (!date) return '—';
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Ключ группировки истории: `2026-10`. */
export function monthKey(text: string): string {
  const date = parseIso(text);
  if (!date) return 'unknown';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

/** Русское склонение по числу: 1 фишка, 2 фишки, 5 фишек. */
export function plural(count: number, forms: [string, string, string]): string {
  const abs = Math.abs(Math.trunc(count));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/** «4 игрока», «12 игроков», «2 монеты». */
export function playersLabel(count: number): string {
  return `${count} ${plural(count, ['игрок', 'игрока', 'игроков'])}`;
}

/** «1 докупка», «3 докупки», «16 докупок». */
export function buyinsLabel(count: number): string {
  return `${count} ${plural(count, ['докупка', 'докупки', 'докупок'])}`;
}

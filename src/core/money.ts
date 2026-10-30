/**
 * Деньги и числа: монеты хранятся в целых сотых, фишки — целые.
 * Никаких float для денег. Форматирование — только здесь.
 */

import type { Chips, CoinCents } from './types';

const CENTS_PER_COIN = 100;

/** Округление half-up для неотрицательных и симметричное для отрицательных. */
function roundHalfUp(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Монеты (может быть дробным при вводе) → целые сотые. */
export function coinsToCents(n: number): CoinCents {
  return roundHalfUp(n * CENTS_PER_COIN);
}

/** Целые сотые → монеты (дробное число). */
export function centsToCoins(c: CoinCents): number {
  return c / CENTS_PER_COIN;
}

/** Фишки → целые сотые монеты по курсу. */
export function chipsToCoins(chips: Chips, rate: number): CoinCents {
  if (rate <= 0) return 0;
  return roundHalfUp((chips * CENTS_PER_COIN) / rate);
}

/** Целые сотые монеты → фишки по курсу (для предпросмотра). */
export function coinsToChips(cents: CoinCents, rate: number): Chips {
  if (rate <= 0) return 0;
  return roundHalfUp((cents * rate) / CENTS_PER_COIN);
}

/**
 * Формат монет: ru-RU, до 2 знаков, `.00` отбрасывается.
 * Разряды разделяются неразрывным пробелом (ru-RU даёт U+00A0).
 * Примеры: 31000 → «310», 7750 → «77,5», 7725 → «77,25», -12500 → «−125».
 */
export function formatCoins(c: CoinCents): string {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(centsToCoins(c));
}

/** Формат фишек: ru-RU с пробелами разрядов. 12250 → «12 250». */
export function formatChips(n: Chips): string {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 0,
  }).format(Math.trunc(n));
}

/** Знаковые монеты: «+75» / «−25» / «0». Минус — типографский U+2212. */
export function formatSignedCoins(c: CoinCents): string {
  if (c === 0) return '0';
  const sign = c > 0 ? '+' : '\u2212';
  return sign + formatCoins(Math.abs(c));
}

/** Знаковые фишки: «+300» / «−300» / «0». */
export function formatSignedChips(n: Chips): string {
  if (n === 0) return '0';
  const sign = n > 0 ? '+' : '\u2212';
  return sign + formatChips(Math.abs(n));
}

/** Безопасное приведение введённого текста к целому числу фишек. */
export function parseChipsInput(text: string): Chips | null {
  const normalized = text.replace(/[\s\u00a0]/g, '').replace(',', '.');
  if (normalized === '' || !/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  return Math.round(Number(normalized));
}

/** Безопасное приведение введённого текста к монетам (дробным). */
export function parseCoinsInput(text: string): number | null {
  const normalized = text.replace(/[\s\u00a0]/g, '').replace(',', '.');
  if (normalized === '' || !/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  return Number(normalized);
}

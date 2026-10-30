/**
 * Валидация ввода (docs/SPEC.md §5.4, §5.9, §12).
 *
 * Все функции возвращают единый результат: ok/errors/warnings.
 * Тексты ошибок — короткие существительные, без глаголов и обращений (§11.4).
 */

import type { Deal, Defaults, Denomination, Kit, MultipleK, Player } from './types';

export type Validation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

const MIN_DENOMINATIONS = 2;
const MAX_DENOMINATIONS = 8;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 12;
export const MAX_NAME_LENGTH = 24;
const VALID_K: readonly MultipleK[] = [4, 5, 10];

function make(errors: string[], warnings: string[] = []): Validation {
  return { ok: errors.length === 0, errors, warnings };
}

/** Обрезка имени до 24 символов с сохранением длины по code points. */
export function clampName(name: string): string {
  const chars = Array.from(name);
  return chars.length <= MAX_NAME_LENGTH ? name : chars.slice(0, MAX_NAME_LENGTH).join('');
}

/** Нормализация имени для сравнения: trim + casefold + схлопывание пробелов. */
export function normalizeName(name: string): string {
  return clampName(name).trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Валидация набора: 2..8 номиналов, строго возрастают, уникальные цвета, count ≥ 0. */
export function validateKit(kit: Pick<Kit, 'denominations'>): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const list = kit.denominations;

  if (list.length < MIN_DENOMINATIONS) errors.push('Мало номиналов');
  if (list.length > MAX_DENOMINATIONS) errors.push('Много номиналов');

  const ids = new Set<string>();
  const values = new Set<number>();
  const colors = new Set<string>();

  for (const d of list) {
    if (!Number.isInteger(d.value) || d.value <= 0) errors.push('Номинал');
    if (!Number.isInteger(d.count) || d.count < 0) errors.push('Количество');
    if (values.has(d.value)) errors.push('Дубликат номинала');
    values.add(d.value);
    if (ids.has(d.id)) errors.push('Дубликат id');
    ids.add(d.id);
    if (!/^#[0-9a-fA-F]{6}$/.test(d.color)) errors.push('Цвет');
    const colorKey = d.color.toLowerCase();
    if (colors.has(colorKey)) warnings.push('Дубликат цвета');
    colors.add(colorKey);
  }

  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1];
    const cur = list[i];
    if (prev && cur && cur.value <= prev.value) {
      errors.push('Номиналы не возрастают');
      break;
    }
  }

  const total = list.reduce((acc, d) => acc + Math.max(0, d.count) * d.value, 0);
  if (total <= 0) errors.push('Пустой набор');

  return make([...new Set(errors)], [...new Set(warnings)]);
}

/** Валидация списка игроков: 2..12, непустые, уникальные, ≤ 24 символов. */
export function validatePlayers(players: Pick<Player, 'name'>[]): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (players.length < MIN_PLAYERS) errors.push('Мало игроков');
  if (players.length > MAX_PLAYERS) errors.push('Много игроков');

  const seen = new Set<string>();
  for (const p of players) {
    const raw = p.name.trim();
    if (raw.length === 0) {
      errors.push('Пустое имя');
      continue;
    }
    if (Array.from(p.name).length > MAX_NAME_LENGTH) warnings.push('Имя обрезано');
    const key = normalizeName(p.name);
    if (seen.has(key)) errors.push('Дубликат имени');
    seen.add(key);
  }

  // §12.16: одинаковые имена после обрезки/нормализации — тоже дубликат.
  return make([...new Set(errors)], [...new Set(warnings)]);
}

export type GameSettingsInput = {
  stackCoins: number;
  rate: number;
  smallBlindChips: number;
  multipleK: MultipleK;
  reserveStacks: number;
};

/** Валидация настроек игры: стек > 0, курс ≥ 1, SB ≥ мин. номинал, K ∈ {4,5,10}, резерв ≥ 0. */
export function validateGameSettings(
  settings: GameSettingsInput,
  denominations: Pick<Denomination, 'value'>[] = [],
): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!Number.isFinite(settings.stackCoins) || settings.stackCoins <= 0) errors.push('Стек');
  if (!Number.isInteger(settings.rate) || settings.rate < 1) errors.push('Курс');
  if (!VALID_K.includes(settings.multipleK)) errors.push('Кратность');
  if (!Number.isInteger(settings.reserveStacks) || settings.reserveStacks < 0) {
    errors.push('Резерв');
  }
  if (!Number.isInteger(settings.smallBlindChips) || settings.smallBlindChips <= 0) {
    errors.push('Малый блайнд');
  }

  const minValue = denominations.reduce<number | null>(
    (acc, d) => (acc === null || d.value < acc ? d.value : acc),
    null,
  );
  if (minValue !== null && settings.smallBlindChips < minValue) {
    errors.push('Блайнд ниже номинала');
  }

  return make(errors, warnings);
}

/** Валидация дефолтов из `/settings`. */
export function validateDefaults(defaults: Omit<Defaults, 'id' | 'updatedAt'>): Validation {
  return validateGameSettings({
    stackCoins: defaults.stackCoins,
    rate: defaults.rate,
    smallBlindChips: defaults.smallBlindChips,
    multipleK: defaults.multipleK,
    reserveStacks: defaults.reserveStacks,
  });
}

/** Проверка, что раздача физически помещается в набор: a[i]·n ≤ counts[i]. */
export function validateDealFits(
  deal: Pick<Deal, 'perPlayer'>,
  players: number,
  denominations: Pick<Denomination, 'value' | 'count'>[],
): Validation {
  const errors: string[] = [];
  if (players <= 0) errors.push('Нет игроков');
  for (const entry of deal.perPlayer) {
    const kit = denominations.find((d) => d.value === entry.value);
    if (!kit) {
      errors.push('Нет номинала');
      continue;
    }
    if (entry.count * players > kit.count) errors.push('Нет места');
  }
  return make([...new Set(errors)]);
}

/** Проверка, что событие ссылается на существующих игроков (§12.15). */
export function validateExternal(
  fromId: string,
  toId: string,
  players: Pick<Player, 'id'>[],
): Validation {
  const errors: string[] = [];
  if (fromId === toId) errors.push('Один игрок');
  if (!players.some((p) => p.id === fromId)) errors.push('Нет продавца');
  if (!players.some((p) => p.id === toId)) errors.push('Нет покупателя');
  return make(errors);
}

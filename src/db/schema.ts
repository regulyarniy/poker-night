/**
 * Схема IndexedDB (docs/SPEC.md §8.1).
 */

import type { DBSchema } from 'idb';
import type { Defaults, Game, GameStatus, Kit } from '../core/types';

export const DB_NAME = 'pokernight';
export const DB_VERSION = 1;

export type PokerDBSchema = DBSchema & {
  games: {
    key: string;
    value: Game;
    indexes: { 'by-status': GameStatus; 'by-createdAt': string };
  };
  settings: {
    key: 'kit' | 'defaults';
    value: Kit | Defaults;
  };
};

/** Дефолтный набор (§8.2) — 12 250 фишек. */
export function defaultKit(now: string): Kit {
  return {
    id: 'kit',
    denominations: [
      { id: 'd1', value: 5, color: '#c8443b', count: 75 },
      { id: 'd2', value: 25, color: '#2f9e6a', count: 75 },
      { id: 'd3', value: 50, color: '#2f6fd0', count: 50 },
      { id: 'd4', value: 100, color: '#2b2b2b', count: 75 },
    ],
    updatedAt: now,
  };
}

/** Дефолтные настройки новой игры (§8.2). */
export function defaultDefaults(now: string): Defaults {
  return {
    id: 'defaults',
    stackCoins: 150,
    rate: 4,
    smallBlindChips: 5,
    multipleK: 5,
    reserveStacks: 4,
    updatedAt: now,
  };
}

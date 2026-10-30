/**
 * Типы домена. Перенесены из docs/SPEC.md §3.2–3.3.
 *
 * Правила:
 * - фишки — целые;
 * - монеты — целые сотые (`CoinCents`), 1 монета = 100;
 * - производные величины игрока (chips, buyins, out, net…) не хранятся в базе
 *   и живут только в `PlayerState`/`PlayerTotals`.
 */

/** Фишки — всегда целое число. */
export type Chips = number;

/** Монеты — целые сотые: 1 монета = 100. */
export type CoinCents = number;

// ---------------------------------------------------------------------------
// Набор
// ---------------------------------------------------------------------------

export type Denomination = {
  /** crypto.randomUUID() */
  id: string;
  /** Номинал, > 0, целое */
  value: Chips;
  /** hex из палитры (#RRGGBB) */
  color: string;
  /** Количество в наборе, >= 0 */
  count: number;
};

export type Kit = {
  id: 'kit';
  /** 2..8, строго возрастают по value */
  denominations: Denomination[];
  /** ISO 8601 */
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Дефолты новой игры
// ---------------------------------------------------------------------------

/** Кратность выдаваемых фишек каждого номинала. */
export type MultipleK = 4 | 5 | 10;

export type Defaults = {
  id: 'defaults';
  /** Стек в монетах, целое > 0 */
  stackCoins: number;
  /** Фишек за монету, целое >= 1 */
  rate: number;
  smallBlindChips: Chips;
  multipleK: MultipleK;
  /** Сколько полных стеков держать в резерве, >= 0 */
  reserveStacks: number;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Игра
// ---------------------------------------------------------------------------

export type GameStatus = 'active' | 'finished' | 'archived';

export type Player = {
  id: string;
  /** 1..24 символа, уникален в игре */
  name: string;
  /** Порядок в списке */
  seat: number;
};

/** Производные величины — только в памяти, не в базе. */
export type PlayerState = Player & {
  /** Фишки на руках (из журнала) */
  chips: Chips;
  /** Докупок из банка */
  buyins: number;
  /** Внешних стеков получено */
  externalIn: number;
  /** Внешних стеков отдано */
  externalOut: number;
  out: boolean;
  /** undefined = остаток не зафиксирован */
  finalChips?: Chips;
  netChips: Chips;
};

export type Variant = 'balanced' | 'economy' | 'speed';

export type DealLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';

export type DealEntry = { value: Chips; count: number };

export type Deal = {
  variant: Variant;
  /** Одинаково для всех игроков */
  perPlayer: DealEntry[];
  /** Сумма perPlayer */
  chipsPerPlayer: Chips;
  /** chipsPerPlayer * players.length */
  totalDealt: Chips;
  /** Какой уровень компромисса сработал */
  level: DealLevel;
  /** Номинал, освобождённый от кратности K */
  exemptValue?: Chips;
};

export type Game = {
  id: string;
  /** Автоимя «29 окт 20:45» или введённое */
  name: string;
  /** ISO 8601 с offset */
  createdAt: string;
  status: GameStatus;

  // Замороженная копия настроек: архивы стабильны.
  rate: number;
  stackCoins: number;
  stackChips: Chips;
  smallBlindChips: Chips;
  multipleK: MultipleK;
  reserveStacks: number;
  denominations: Denomination[];

  players: Player[];
  deal: Deal;
  /** Журнал, хронологический порядок */
  events: GameEvent[];
  archivedAt?: string;
  schemaVersion: 1;
};

// ---------------------------------------------------------------------------
// Журнал событий
// ---------------------------------------------------------------------------

type EventBase = { id: string; t: string };

export type GameEvent =
  | (EventBase & { type: 'deal'; playerId: string; chips: Chips })
  | (EventBase & { type: 'buyin'; playerId: string; chips: Chips })
  | (EventBase & { type: 'external'; fromId: string; toId: string; chips: Chips })
  | (EventBase & { type: 'cashout'; playerId: string; chips: Chips })
  | (EventBase & { type: 'finalStack'; playerId: string; chips: Chips });

export type GameEventType = GameEvent['type'];

// ---------------------------------------------------------------------------
// Сводка
// ---------------------------------------------------------------------------

export type PlayerTotals = {
  playerId: string;
  name: string;
  /** Физически на руках */
  chipsOnHand: Chips;
  /** null = остаток не зафиксирован */
  finalChips: Chips | null;
  /** Оплачено всего (включая стартовый стек) */
  boughtChips: Chips;
  /** Продано другим игрокам */
  externalOutChips: Chips;
  netChips: Chips;
  /** Для UI */
  netCoins: number;
};

export type GameTotals = {
  players: PlayerTotals[];
  /** Должно быть 0 */
  sumNetChips: Chips;
  reconciled: boolean;
  bankRemainingChips: Chips;
  bankRemainingCoins: number;
  /** Сколько игроков без финального остатка */
  uncoveredCount: number;
};

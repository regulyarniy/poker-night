/**
 * Операции над игрой и журналом событий (docs/SPEC.md §3.3, §6).
 *
 * Всё чистое: функции не мутируют вход и не трогают хранилище.
 * Производные величины (chips, net, банк) не считаются здесь — только журнал.
 */

import type {
  Chips,
  Deal,
  Denomination,
  Game,
  GameEvent,
  GameStatus,
  MultipleK,
  Player,
} from './types';

export type CreateGameInput = {
  id: string;
  name: string;
  createdAt: string;
  rate: number;
  stackCoins: number;
  smallBlindChips: Chips;
  multipleK: MultipleK;
  reserveStacks: number;
  denominations: Denomination[];
  players: { id: string; name: string }[];
  deal: Deal;
};

/** Следующий свободный id события. Учитывает удаления: `e1`, `e2`, … */
export function nextEventId(game: Game): string {
  let max = 0;
  for (const event of game.events) {
    const match = /-e(\d+)$/.exec(event.id);
    if (match?.[1]) max = Math.max(max, Number(match[1]));
  }
  return `${game.id}-e${max + 1}`;
}

/** Стартовое событие раздачи для игрока. */
export function makeDealEvent(playerId: string, chips: Chips, t: string, id: string): GameEvent {
  return { id, t, type: 'deal', playerId, chips };
}

/** Создаёт игру по выбранной раздаче (§6.1). */
export function createGame(input: CreateGameInput): Game {
  const events: GameEvent[] = input.players.map((player, index) => ({
    id: `${input.id}-e${index + 1}`,
    t: input.createdAt,
    type: 'deal',
    playerId: player.id,
    chips: input.deal.chipsPerPlayer,
  }));
  const players: Player[] = input.players.map((player, index) => ({
    id: player.id,
    name: player.name,
    seat: index,
  }));
  return {
    id: input.id,
    name: input.name,
    createdAt: input.createdAt,
    status: 'active',
    rate: input.rate,
    stackCoins: input.stackCoins,
    stackChips: input.stackCoins * input.rate,
    smallBlindChips: input.smallBlindChips,
    multipleK: input.multipleK,
    reserveStacks: input.reserveStacks,
    denominations: input.denominations.map((d) => ({ ...d })),
    players,
    deal: { ...input.deal, totalDealt: input.deal.chipsPerPlayer * players.length },
    events,
    schemaVersion: 1,
  };
}

/** Возвращает копию игры с добавленным событием в конец журнала. */
export function appendEvent(game: Game, event: GameEvent): Game {
  return { ...game, events: [...game.events, event] };
}

/** Игра только с `deal`-событиями: пересдача ещё возможна (§6.7). */
export function canRedeal(game: Game): boolean {
  return game.events.every((e) => e.type === 'deal');
}

/** Пересдача: заменяет `deal`-события новым вектором (§6.7, Q122). */
export function redeal(game: Game, deal: Deal, t: string): Game {
  if (!canRedeal(game)) return game;
  const events: GameEvent[] = game.players.map((player, index) => ({
    id: `${game.id}-e${index + 1}`,
    t,
    type: 'deal',
    playerId: player.id,
    chips: deal.chipsPerPlayer,
  }));
  return {
    ...game,
    deal: { ...deal, totalDealt: deal.chipsPerPlayer * game.players.length },
    events,
  };
}

/**
 * Сколько фишек каждого номинала нужно на раздачу всем игрокам — для превью
 * пересдачи: набор должны выдержать все.
 */
export function dealCountsNeeded(deal: Deal, players: number): { value: Chips; count: number }[] {
  return deal.perPlayer.map((entry) => ({ value: entry.value, count: entry.count * players }));
}

/** Удаляет событие по id. Несуществующий id — без изменений. */
export function removeEvent(game: Game, eventId: string): Game {
  const events = game.events.filter((e) => e.id !== eventId);
  return events.length === game.events.length ? game : { ...game, events };
}

/** Меняет сумму события (редактор журнала, §6.6). */
export function updateEventChips(game: Game, eventId: string, chips: Chips): Game {
  const value = Math.max(0, Math.round(chips));
  let changed = false;
  const events = game.events.map((event) => {
    if (event.id !== eventId || event.chips === value) return event;
    changed = true;
    return { ...event, chips: value };
  });
  return changed ? { ...game, events } : game;
}

/** «Отменить последнее действие» — снимает последнее событие (§6.6). */
export function undoLast(game: Game): Game {
  if (game.events.length === 0) return game;
  return { ...game, events: game.events.slice(0, -1) };
}

/**
 * Докупка из банка (§6.2). Банк может уйти в минус — это не блокирует.
 */
export function addBuyin(game: Game, playerId: string, t: string, id: string): Game {
  return appendEvent(game, { id, t, type: 'buyin', playerId, chips: game.stackChips });
}

/** Внешняя покупка: стек переходит от продавца покупателю (§6.3). */
export function addExternal(game: Game, fromId: string, toId: string, t: string, id: string): Game {
  return appendEvent(game, {
    id,
    t,
    type: 'external',
    fromId,
    toId,
    chips: game.stackChips,
  });
}

/** Выход игрока с остатком: повторный выход перезаписывает предыдущий (§3.4.1). */
export function setCashout(
  game: Game,
  playerId: string,
  chips: Chips,
  t: string,
  id: string,
): Game {
  const value = Math.max(0, Math.round(chips));
  const index = lastIndexFor(game.events, playerId, 'cashout');
  if (index < 0) {
    return appendEvent(game, { id, t, type: 'cashout', playerId, chips: value });
  }
  const events = game.events.slice();
  const existing = events[index];
  if (!existing) return game;
  events[index] = { ...existing, t, chips: value };
  return { ...game, events };
}

/** Финальный остаток: перезаписывает предыдущий `finalStack` (§6.5). */
export function setFinalStack(
  game: Game,
  playerId: string,
  chips: Chips,
  t: string,
  id: string,
): Game {
  const value = Math.max(0, Math.round(chips));
  const index = lastIndexFor(game.events, playerId, 'finalStack');
  if (index < 0) {
    return appendEvent(game, { id, t, type: 'finalStack', playerId, chips: value });
  }
  const events = game.events.slice();
  const existing = events[index];
  if (!existing) return game;
  events[index] = { ...existing, t, chips: value };
  return { ...game, events };
}

/** Добавление игрока в процессе: игрок + `deal`-событие (§6.8). */
export function addPlayer(
  game: Game,
  player: { id: string; name: string },
  t: string,
  eventId: string,
): Game {
  const seat = game.players.reduce((acc, p) => Math.max(acc, p.seat + 1), 0);
  const next: Game = {
    ...game,
    players: [...game.players, { id: player.id, name: player.name, seat }],
  };
  return appendEvent(next, {
    id: eventId,
    t,
    type: 'deal',
    playerId: player.id,
    chips: game.stackChips,
  });
}

/** Смена статуса игры. `archivedAt` ставится только при архивации (§6.9). */
export function setStatus(game: Game, status: GameStatus, now?: string): Game {
  if (status === 'archived') {
    return { ...game, status, archivedAt: now ?? game.archivedAt ?? '' };
  }
  const { archivedAt: _archivedAt, ...rest } = game;
  return { ...rest, status };
}

function lastIndexFor(
  events: GameEvent[],
  playerId: string,
  type: 'cashout' | 'finalStack',
): number {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (!event || event.type !== type) continue;
    if (event.playerId === playerId) return i;
  }
  return -1;
}

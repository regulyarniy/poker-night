/**
 * Сводка игры из журнала событий (docs/SPEC.md §3.4).
 *
 * Журнал — единственный источник правды. Никакие производные величины
 * здесь не сохраняются: всё считается на лету.
 */

import { chipsToCoins } from './money';
import type {
  Chips,
  Game,
  GameEvent,
  GameTotals,
  Player,
  PlayerState,
  PlayerTotals,
} from './types';

/** Сколько фишек лежит перед игроком прямо сейчас. */
function chipsOnHand(events: GameEvent[], playerId: string): Chips {
  let chips = 0;
  for (const e of events) {
    switch (e.type) {
      case 'deal':
      case 'buyin':
        if (e.playerId === playerId) chips += e.chips;
        break;
      case 'external':
        if (e.toId === playerId) chips += e.chips;
        if (e.fromId === playerId) chips -= e.chips;
        break;
      case 'cashout':
        if (e.playerId === playerId) chips -= e.chips;
        break;
      case 'finalStack':
        break;
    }
  }
  return chips;
}

/** Последнее событие заданного типа для игрока (перезапись, не сумма). */
function lastEventFor(
  events: GameEvent[],
  playerId: string,
  type: 'cashout' | 'finalStack',
): GameEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e || e.type !== type) continue;
    if (e.playerId === playerId) return e;
  }
  return null;
}

/** Считает докупки, внешние входы/выходы и финальный остаток игрока. */
export function derivePlayers(game: Game): PlayerState[] {
  const { events, players, stackChips, rate } = game;
  return players.map((p) => {
    let buyins = 0;
    let externalIn = 0;
    let externalOut = 0;
    let cashedOut = false;

    for (const e of events) {
      if (e.type === 'buyin' && e.playerId === p.id) buyins += 1;
      if (e.type === 'external') {
        if (e.toId === p.id) externalIn += 1;
        if (e.fromId === p.id) externalOut += 1;
      }
      if (e.type === 'cashout' && e.playerId === p.id) cashedOut = true;
    }

    const final = lastEventFor(events, p.id, 'finalStack');
    const cashout = lastEventFor(events, p.id, 'cashout');

    const state: PlayerState = {
      ...p,
      chips: chipsOnHand(events, p.id),
      buyins,
      externalIn,
      externalOut,
      out: cashedOut,
      netChips: 0,
    };

    // finalChips: finalStack → cashout → chipsOnHand (§3.4, п. 2).
    if (final && final.type === 'finalStack') {
      state.finalChips = final.chips;
    } else if (cashout && cashout.type === 'cashout') {
      state.finalChips = cashout.chips;
    }

    const finalChips = state.finalChips ?? state.chips;
    const bought = stackChips * (1 + buyins + externalIn);
    const sold = stackChips * externalOut;
    state.netChips = finalChips + sold - bought;
    void rate;
    return state;
  });
}

/** Сводка по игроку для экрана итогов. */
function toPlayerTotals(state: PlayerState, stackChips: Chips, rate: number): PlayerTotals {
  const boughtChips = stackChips * (1 + state.buyins + state.externalIn);
  const externalOutChips = stackChips * state.externalOut;
  const finalChips = state.finalChips ?? null;
  const effectiveFinal = finalChips ?? state.chips;
  const netChips = effectiveFinal + externalOutChips - boughtChips;
  return {
    playerId: state.id,
    name: state.name,
    chipsOnHand: state.chips,
    finalChips,
    boughtChips,
    externalOutChips,
    netChips,
    netCoins: chipsToCoins(netChips, rate),
  };
}

/** Полная сводка игры: игроки, сверка, остаток банка, незафиксированные. */
export function gameTotals(game: Game): GameTotals {
  const states = derivePlayers(game);
  const players = states.map((s) => toPlayerTotals(s, game.stackChips, game.rate));
  const sumNetChips = players.reduce((acc, p) => acc + p.netChips, 0);
  const uncoveredCount = states.filter((s) => s.finalChips === undefined).length;
  const bank = bankState(game);
  return {
    players,
    sumNetChips,
    reconciled: sumNetChips === 0,
    bankRemainingChips: bank.remaining,
    bankRemainingCoins: chipsToCoins(bank.remaining, game.rate),
    uncoveredCount,
  };
}

export type BankState = {
  /** Всего фишек в наборе игры */
  total: Chips;
  /** Выдано событиями deal */
  dealt: Chips;
  /** Вернулось событиями cashout */
  returned: Chips;
  /** Остаток в банке */
  remaining: Chips;
  /** Сколько полных стеков ещё хватит */
  coveredStacks: number;
};

/**
 * Состояние банка (§3.4, п. 5): внешние покупки его не двигают.
 * bankRemaining = kitTotal − Σ deal − Σ buyin + Σ cashout.
 */
export function bankState(game: Game): BankState {
  const total = game.denominations.reduce((acc, d) => acc + Math.max(0, d.count) * d.value, 0);
  let dealt = 0;
  let buyin = 0;
  let returned = 0;
  for (const e of game.events) {
    if (e.type === 'deal') dealt += e.chips;
    else if (e.type === 'buyin') buyin += e.chips;
    else if (e.type === 'cashout') returned += e.chips;
  }
  const remaining = total - dealt - buyin + returned;
  const coveredStacks =
    game.stackChips > 0 ? Math.max(0, Math.floor(remaining / game.stackChips)) : 0;
  return { total, dealt, returned, remaining, coveredStacks };
}

/** Игрок с максимальным net (для блока «топ»). null — если все в нуле. */
export function topPlayer(totals: GameTotals): PlayerTotals | null {
  let best: PlayerTotals | null = null;
  for (const p of totals.players) {
    if (p.netChips <= 0) continue;
    if (!best || p.netChips > best.netChips) best = p;
  }
  return best;
}

/** События одного игрока в хронологическом порядке. */
export function eventsForPlayer(events: GameEvent[], playerId: string): GameEvent[] {
  return events.filter((e) => {
    if (e.type === 'external') return e.fromId === playerId || e.toId === playerId;
    return e.playerId === playerId;
  });
}

/** Ищет игрока по id. */
export function findPlayer(players: Player[], id: string): Player | null {
  return players.find((p) => p.id === id) ?? null;
}

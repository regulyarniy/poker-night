import { describe, expect, it } from 'vitest';
import { addBuyin, addExternal, createGame, setFinalStack } from './game';
import { payloadFromGame, resultsFromPayload } from './payload';
import { gameTotals } from './totals';
import type { Deal, Denomination } from './types';

const denoms: Denomination[] = [
  { id: 'd1', value: 5, color: '#c8443b', count: 75 },
  { id: 'd2', value: 25, color: '#2f9e6a', count: 75 },
  { id: 'd3', value: 50, color: '#2f6fd0', count: 50 },
  { id: 'd4', value: 100, color: '#2b2b2b', count: 75 },
];

const deal: Deal = {
  variant: 'balanced',
  perPlayer: [{ value: 100, count: 6 }],
  chipsPerPlayer: 600,
  totalDealt: 1200,
  level: 'L0',
};

const T = '2026-10-29T20:45:00+10:00';

function twoPlayerGame() {
  return createGame({
    id: 'g1',
    name: '29 окт 20:45',
    createdAt: T,
    rate: 4,
    stackCoins: 150,
    smallBlindChips: 5,
    multipleK: 5,
    reserveStacks: 4,
    denominations: denoms,
    players: [
      { id: 'p1', name: 'Анна' },
      { id: 'p2', name: 'Борис' },
    ],
    deal,
  });
}

describe('payloadFromGame / resultsFromPayload', () => {
  it('передаёт финальные остатки и повторяет итоги игры', () => {
    let game = twoPlayerGame();
    game = setFinalStack(game, 'p1', 900, T, 'e1');
    game = setFinalStack(game, 'p2', 300, T, 'e2');
    const totals = gameTotals(game);
    const payload = payloadFromGame(game, totals);
    const publicResults = resultsFromPayload(payload);

    expect(payload.p.map((p) => p.f)).toEqual([900, 300]);
    expect(publicResults.rows.map((r) => r.netChips)).toEqual(
      totals.players.map((p) => p.netChips),
    );
    expect(publicResults.sumNetChips).toBe(totals.sumNetChips);
  });

  it('считает докупки из банка', () => {
    let game = twoPlayerGame();
    game = addBuyin(game, 'p1', T, 'e1');
    game = addBuyin(game, 'p1', T, 'e2');
    const totals = gameTotals(game);
    const payload = payloadFromGame(game, totals);
    expect(payload.p[0]?.b).toBe(2);
    expect(payload.p[1]?.b).toBe(0);

    const publicResults = resultsFromPayload(payload);
    expect(publicResults.rows[0]?.boughtChips).toBe(totals.players[0]?.boughtChips);
  });

  it('передаёт внешние покупки в обе стороны', () => {
    let game = twoPlayerGame();
    game = addExternal(game, 'p1', 'p2', T, 'e1');
    const totals = gameTotals(game);
    const payload = payloadFromGame(game, totals);

    expect(payload.p[0]?.x).toBe(1);
    expect(payload.p[0]?.e).toBe(0);
    expect(payload.p[1]?.x).toBe(0);
    expect(payload.p[1]?.e).toBe(1);

    const publicResults = resultsFromPayload(payload);
    expect(publicResults.rows.map((r) => r.netChips)).toEqual(
      totals.players.map((p) => p.netChips),
    );
    expect(publicResults.sumNetChips).toBe(0);
  });

  it('внешняя покупка + докупка + выход дают те же итоги на публичной странице', () => {
    // Пример C из спеки §3.5, но событий ровно столько, сколько нужно.
    let game = twoPlayerGame();
    game = addExternal(game, 'p1', 'p2', T, 'e1');
    game = addBuyin(game, 'p1', T, 'e2');
    game = setFinalStack(game, 'p1', 700, T, 'e3');
    game = setFinalStack(game, 'p2', 1100, T, 'e4');
    const totals = gameTotals(game);
    const payload = payloadFromGame(game, totals);
    const publicResults = resultsFromPayload(payload);

    expect(publicResults.rows.map((r) => r.netChips)).toEqual([100, -100]);
    expect(publicResults.reconciled).toBe(true);
  });

  it('без finalStack публичная страница повторяет net экрана итогов', () => {
    let game = twoPlayerGame();
    game = addBuyin(game, 'p1', T, 'e1');
    const totals = gameTotals(game);
    const payload = payloadFromGame(game, totals);

    // Все остатки не зафиксированы — в payload должен уйти «на руках».
    expect(payload.p.every((p) => p.f === null && typeof p.h === 'number')).toBe(true);
    const publicResults = resultsFromPayload(payload);
    expect(publicResults.rows.map((r) => r.netChips)).toEqual(
      totals.players.map((p) => p.netChips),
    );
  });

  it('старая ссылка без h читается и даёт ноль в net при f: null', () => {
    const payload = {
      v: 1,
      t: T,
      s: 150,
      r: 4,
      sb: 5,
      k: 5,
      p: [{ n: 'Анна', f: null, b: 0, e: 0, x: 0 }],
    };
    const results = resultsFromPayload(payload);
    expect(results.rows[0]?.netChips).toBe(-600);
  });
});

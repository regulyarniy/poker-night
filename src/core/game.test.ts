import { describe, expect, it } from 'vitest';
import {
  addBuyin,
  addExternal,
  addPlayer,
  appendEvent,
  canRedeal,
  createGame,
  makeDealEvent,
  nextEventId,
  redeal,
  removeEvent,
  setCashout,
  setFinalStack,
  setStatus,
  undoLast,
  updateEventChips,
} from './game';
import { bankState, derivePlayers, gameTotals } from './totals';
import type { Deal, Denomination, Game } from './types';

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
  totalDealt: 2400,
  level: 'L0',
};

const T0 = '2026-10-29T20:45:00+10:00';
const T1 = '2026-10-29T21:00:00+10:00';

function newGame(names = ['Анна', 'Борис', 'Вера', 'Глеб']): Game {
  return createGame({
    id: 'g1',
    name: '29 окт 20:45',
    createdAt: T0,
    rate: 4,
    stackCoins: 150,
    smallBlindChips: 5,
    multipleK: 5,
    reserveStacks: 4,
    denominations: denoms,
    players: names.map((name, i) => ({ id: `p${i + 1}`, name })),
    deal,
  });
}

describe('createGame', () => {
  it('создаёт активную игру с замороженной копией настроек', () => {
    const game = newGame();
    expect(game.status).toBe('active');
    expect(game.stackChips).toBe(600);
    expect(game.schemaVersion).toBe(1);
    expect(game.players.map((p) => p.seat)).toEqual([0, 1, 2, 3]);
    expect(game.deal.totalDealt).toBe(2400);
    expect(game.denominations).not.toBe(denoms);
  });

  it('генерирует по одному deal-событию на игрока с общим стеком', () => {
    const game = newGame();
    expect(game.events).toHaveLength(4);
    expect(game.events.every((e) => e.type === 'deal')).toBe(true);
    expect(game.events.every((e) => e.type === 'deal' && e.chips === 600)).toBe(true);
    expect(new Set(game.events.map((e) => e.id)).size).toBe(4);
  });

  it('не мутирует входные данные', () => {
    const players = [
      { id: 'p1', name: 'Анна' },
      { id: 'p2', name: 'Борис' },
    ];
    const game = createGame({
      id: 'g2',
      name: 'игра',
      createdAt: T0,
      rate: 4,
      stackCoins: 150,
      smallBlindChips: 5,
      multipleK: 5,
      reserveStacks: 0,
      denominations: denoms,
      players,
      deal,
    });
    game.players[0]?.name.toUpperCase();
    expect(players[0]?.name).toBe('Анна');
  });
});

describe('журнал', () => {
  it('appendEvent не мутирует исходную игру', () => {
    const game = newGame();
    const next = appendEvent(game, makeDealEvent('p1', 600, T1, 'g1-e5'));
    expect(game.events).toHaveLength(4);
    expect(next.events).toHaveLength(5);
  });

  it('nextEventId продолжает нумерацию по максимуму в журнале', () => {
    const initial = newGame();
    expect(nextEventId(initial)).toBe('g1-e5');
    const trimmed = removeEvent(initial, 'g1-e4');
    // Нумерация идёт по максимуму в журнале, а не по длине массива.
    expect(nextEventId(trimmed)).toBe('g1-e4');
  });

  it('removeEvent удаляет событие и не падает на неизвестном id', () => {
    const game = newGame();
    expect(removeEvent(game, 'g1-e1').events).toHaveLength(3);
    expect(removeEvent(game, 'нет-такого')).toBe(game);
  });

  it('updateEventChips меняет сумму и не трогает другие события', () => {
    const game = newGame();
    const updated = updateEventChips(game, 'g1-e1', 700);
    const event = updated.events[0];
    expect(event?.type).toBe('deal');
    expect(event?.chips).toBe(700);
    expect(updated.events[1]?.chips).toBe(600);
  });

  it('updateEventChips на неизвестном id — та же игра', () => {
    const game = newGame();
    expect(updateEventChips(game, 'нет', 1)).toBe(game);
  });

  it('undoLast снимает последнее событие', () => {
    const game = addBuyin(newGame(), 'p1', T1, 'g1-e5');
    expect(undoLast(game).events.at(-1)?.type).toBe('deal');
    expect(undoLast(newGame()).events).toHaveLength(3);
  });
});

describe('операции игры', () => {
  it('докупка добавляет buyin на полный стек', () => {
    const game = addBuyin(newGame(), 'p2', T1, 'g1-e5');
    const event = game.events.at(-1);
    expect(event?.type).toBe('buyin');
    expect(event?.chips).toBe(600);
    expect(bankState(game).remaining).toBe(12250 - 2400 - 600);
  });

  it('внешняя покупка не двигает банк', () => {
    const game = addExternal(newGame(), 'p1', 'p2', T1, 'g1-e5');
    const before = bankState(newGame()).remaining;
    expect(bankState(game).remaining).toBe(before);
    const p1 = derivePlayers(game).find((p) => p.id === 'p1');
    const p2 = derivePlayers(game).find((p) => p.id === 'p2');
    expect(p1?.externalOut).toBe(1);
    expect(p2?.externalIn).toBe(1);
  });

  it('двойной cashout перезаписывает, а не суммирует', () => {
    let game = setCashout(newGame(), 'p1', 300, T1, 'g1-e5');
    game = setCashout(game, 'p1', 500, T1, 'g1-e6');
    const cashouts = game.events.filter((e) => e.type === 'cashout');
    expect(cashouts).toHaveLength(1);
    expect(cashouts[0]?.chips).toBe(500);
    expect(derivePlayers(game).find((p) => p.id === 'p1')?.out).toBe(true);
  });

  it('двойной finalStack применяется последним', () => {
    let game = setFinalStack(newGame(), 'p1', 1000, T1, 'g1-e5');
    game = setFinalStack(game, 'p1', 1200, T1, 'g1-e6');
    const finals = game.events.filter((e) => e.type === 'finalStack');
    expect(finals).toHaveLength(1);
    expect(finals[0]?.chips).toBe(1200);
  });

  it('cashout и finalStack сосуществуют', () => {
    let game = setCashout(newGame(), 'p1', 200, T1, 'g1-e5');
    game = setFinalStack(game, 'p1', 900, T1, 'g1-e6');
    const p1 = derivePlayers(game).find((p) => p.id === 'p1');
    expect(p1?.finalChips).toBe(900);
    expect(p1?.chips).toBe(0 - 200 + 600);
  });

  it('отрицательный остаток обрезается до нуля', () => {
    const game = setFinalStack(newGame(), 'p1', -50, T1, 'g1-e5');
    expect(game.events.at(-1)?.chips).toBe(0);
  });

  it('добавление игрока ставит следующий seat и выдаёт стек', () => {
    const game = addPlayer(newGame(), { id: 'p5', name: 'Дина' }, T1, 'g1-e5');
    expect(game.players).toHaveLength(5);
    expect(game.players.at(-1)?.seat).toBe(4);
    expect(game.events.at(-1)).toMatchObject({ type: 'deal', playerId: 'p5', chips: 600 });
  });

  it('архивация ставит archivedAt, снятие статуса его убирает', () => {
    const archived = setStatus(newGame(), 'archived', T1);
    expect(archived.archivedAt).toBe(T1);
    const finished = setStatus(archived, 'finished');
    expect(finished.status).toBe('finished');
    expect(finished.archivedAt).toBeUndefined();
  });
});

describe('пересдача', () => {
  it('доступна, пока в журнале только deal', () => {
    expect(canRedeal(newGame())).toBe(true);
    expect(canRedeal(addBuyin(newGame(), 'p1', T1, 'g1-e5'))).toBe(false);
  });

  it('redeal заменяет все deal-события и пересчитывает totalDealt', () => {
    const next: Deal = { ...deal, perPlayer: [{ value: 50, count: 12 }], chipsPerPlayer: 600 };
    const game = redeal(newGame(), next, T1);
    expect(game.events).toHaveLength(4);
    expect(game.events.every((e) => e.t === T1)).toBe(true);
    expect(game.deal.totalDealt).toBe(2400);
    expect(gameTotals(game).players).toHaveLength(4);
  });

  it('redeal не срабатывает после докупки', () => {
    const game = addBuyin(newGame(), 'p1', T1, 'g1-e5');
    expect(redeal(game, deal, T1)).toBe(game);
  });
});

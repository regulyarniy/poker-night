import { describe, expect, it } from 'vitest';
import { bankState, derivePlayers, gameTotals, topPlayer } from './totals';
import type { Deal, Denomination, Game, GameEvent, Player } from './types';

const KIT: Denomination[] = [
  { id: 'd1', value: 5, color: '#c8443b', count: 75 },
  { id: 'd2', value: 25, color: '#2f9e6a', count: 75 },
  { id: 'd3', value: 50, color: '#2f6fd0', count: 50 },
  { id: 'd4', value: 100, color: '#2b2b2b', count: 75 },
];

const DEAL: Deal = {
  variant: 'balanced',
  perPlayer: [{ value: 100, count: 6 }],
  chipsPerPlayer: 600,
  totalDealt: 2400,
  level: 'L0',
};

type EventInput =
  | { type: 'deal'; playerId: string; chips: number }
  | { type: 'buyin'; playerId: string; chips: number }
  | { type: 'external'; fromId: string; toId: string; chips: number }
  | { type: 'cashout'; playerId: string; chips: number }
  | { type: 'finalStack'; playerId: string; chips: number };

let seq = 0;
const ev = (e: EventInput): GameEvent => {
  seq += 1;
  return {
    id: `e${seq}`,
    t: `2026-10-29T20:${String(seq).padStart(2, '0')}:00+10:00`,
    ...e,
  } as GameEvent;
};

const player = (id: string, name: string, seat: number): Player => ({ id, name, seat });

function makeGame(players: Player[], events: GameEvent[], stackChips = 600, rate = 4): Game {
  return {
    id: 'g1',
    name: '29 окт 20:45',
    createdAt: '2026-10-29T20:45:00+10:00',
    status: 'active',
    rate,
    stackCoins: 150,
    stackChips,
    smallBlindChips: 5,
    multipleK: 5,
    reserveStacks: 4,
    denominations: KIT,
    players,
    deal: DEAL,
    events,
    schemaVersion: 1,
  };
}

describe('golden пример A — обычная игра, 4 игрока, одна докупка', () => {
  const players = [
    player('a', 'A', 0),
    player('b', 'B', 1),
    player('c', 'C', 2),
    player('d', 'D', 3),
  ];
  const events: GameEvent[] = [
    ev({ type: 'deal', playerId: 'a', chips: 600 }),
    ev({ type: 'deal', playerId: 'b', chips: 600 }),
    ev({ type: 'deal', playerId: 'c', chips: 600 }),
    ev({ type: 'deal', playerId: 'd', chips: 600 }),
    ev({ type: 'buyin', playerId: 'a', chips: 600 }),
    ev({ type: 'cashout', playerId: 'a', chips: 1500 }),
    ev({ type: 'cashout', playerId: 'b', chips: 300 }),
    ev({ type: 'cashout', playerId: 'c', chips: 500 }),
    ev({ type: 'cashout', playerId: 'd', chips: 100 }),
  ];
  const game = makeGame(players, events);

  it('совпадает с таблицей спеки §3.5', () => {
    const totals = gameTotals(game);
    const byId = new Map(totals.players.map((p) => [p.playerId, p]));

    // ВНИМАНИЕ: колонка «on hand» в таблице §3.5 показывает 0 у всех, но это
    // противоречит формуле §3.4 (chipsOnHand = deal + buyin − cashout) и тексту
    // той же §3.5: «600 фишек остались на столе». По формуле сумма on hand = 600,
    // что ровно совпадает с этим недобором. Реализована нормативная формула;
    // отрицательное значение у `a` — следствие ошибочного ввода (cashout 1500
    // больше полученных 1200), а не баг. Остальные величины совпадают с таблицей.
    expect(byId.get('a')).toMatchObject({
      chipsOnHand: -300,
      finalChips: 1500,
      boughtChips: 1200,
      netChips: 300,
      netCoins: 7500,
    });
    expect(byId.get('b')).toMatchObject({
      chipsOnHand: 300,
      finalChips: 300,
      boughtChips: 600,
      netChips: -300,
    });
    expect(byId.get('c')).toMatchObject({
      chipsOnHand: 100,
      finalChips: 500,
      boughtChips: 600,
      netChips: -100,
    });
    expect(byId.get('d')).toMatchObject({
      chipsOnHand: 500,
      finalChips: 100,
      boughtChips: 600,
      netChips: -500,
    });
  });

  it('сумма on hand равна недобранным фишкам (600)', () => {
    const totals = gameTotals(game);
    const sumOnHand = totals.players.reduce((acc, p) => acc + p.chipsOnHand, 0);
    expect(sumOnHand).toBe(600);
    expect(sumOnHand).toBe(-totals.sumNetChips);
  });

  it('сумма net = −600 и игра не сходится', () => {
    const totals = gameTotals(game);
    expect(totals.sumNetChips).toBe(-600);
    expect(totals.reconciled).toBe(false);
  });

  it('банк = 11 650', () => {
    const bank = bankState(game);
    expect(bank.total).toBe(12250);
    expect(bank.dealt).toBe(2400);
    expect(bank.remaining).toBe(11650);
  });
});

describe('golden пример B — внешняя покупка, 2 игрока', () => {
  const players = [player('a', 'A', 0), player('b', 'B', 1)];
  const events: GameEvent[] = [
    ev({ type: 'deal', playerId: 'a', chips: 600 }),
    ev({ type: 'deal', playerId: 'b', chips: 600 }),
    ev({ type: 'external', fromId: 'a', toId: 'b', chips: 600 }),
    ev({ type: 'cashout', playerId: 'a', chips: 0 }),
    ev({ type: 'cashout', playerId: 'b', chips: 1200 }),
  ];
  const game = makeGame(players, events);

  it('оба при своих', () => {
    const totals = gameTotals(game);
    const byId = new Map(totals.players.map((p) => [p.playerId, p]));
    expect(byId.get('a')).toMatchObject({
      finalChips: 0,
      externalOutChips: 600,
      boughtChips: 600,
      netChips: 0,
    });
    expect(byId.get('b')).toMatchObject({
      finalChips: 1200,
      externalOutChips: 0,
      boughtChips: 1200,
      netChips: 0,
    });
  });

  it('сумма net = 0 и банк не изменился', () => {
    const totals = gameTotals(game);
    expect(totals.sumNetChips).toBe(0);
    expect(totals.reconciled).toBe(true);
    expect(bankState(game).remaining).toBe(12250);
  });
});

describe('golden пример C — внешняя покупка + докупка из банка', () => {
  const players = [player('a', 'A', 0), player('b', 'B', 1)];
  const events: GameEvent[] = [
    ev({ type: 'deal', playerId: 'a', chips: 600 }),
    ev({ type: 'deal', playerId: 'b', chips: 600 }),
    ev({ type: 'external', fromId: 'a', toId: 'b', chips: 600 }),
    ev({ type: 'buyin', playerId: 'a', chips: 600 }),
    ev({ type: 'cashout', playerId: 'a', chips: 700 }),
    ev({ type: 'cashout', playerId: 'b', chips: 1100 }),
  ];
  const game = makeGame(players, events);

  it('итоги a +100 / b −100', () => {
    const totals = gameTotals(game);
    const byId = new Map(totals.players.map((p) => [p.playerId, p]));
    expect(byId.get('a')).toMatchObject({
      finalChips: 700,
      externalOutChips: 600,
      boughtChips: 1200,
      netChips: 100,
    });
    expect(byId.get('b')).toMatchObject({
      finalChips: 1100,
      externalOutChips: 0,
      boughtChips: 1200,
      netChips: -100,
    });
  });

  it('сумма net = 0 и банк = 12 250', () => {
    const totals = gameTotals(game);
    expect(totals.sumNetChips).toBe(0);
    expect(bankState(game).remaining).toBe(12250);
  });
});

describe('правила вычисления §3.4', () => {
  it('finalStack перезаписывает, а не суммирует', () => {
    const players = [player('a', 'A', 0), player('b', 'B', 1)];
    const game = makeGame(players, [
      ev({ type: 'deal', playerId: 'a', chips: 600 }),
      ev({ type: 'deal', playerId: 'b', chips: 600 }),
      ev({ type: 'finalStack', playerId: 'a', chips: 900 }),
      ev({ type: 'finalStack', playerId: 'a', chips: 400 }),
    ]);
    const a = derivePlayers(game).find((p) => p.id === 'a');
    expect(a?.finalChips).toBe(400);
  });

  it('cashout + finalStack вместе: побеждает finalStack', () => {
    const players = [player('a', 'A', 0), player('b', 'B', 1)];
    const game = makeGame(players, [
      ev({ type: 'deal', playerId: 'a', chips: 600 }),
      ev({ type: 'deal', playerId: 'b', chips: 600 }),
      ev({ type: 'cashout', playerId: 'a', chips: 300 }),
      ev({ type: 'finalStack', playerId: 'a', chips: 500 }),
    ]);
    const a = derivePlayers(game).find((p) => p.id === 'a');
    expect(a?.finalChips).toBe(500);
    expect(a?.out).toBe(true);
  });

  it('без финального остатка finalChips = null, uncovered растёт', () => {
    const players = [player('a', 'A', 0), player('b', 'B', 1)];
    const game = makeGame(players, [
      ev({ type: 'deal', playerId: 'a', chips: 600 }),
      ev({ type: 'deal', playerId: 'b', chips: 600 }),
      ev({ type: 'finalStack', playerId: 'a', chips: 1200 }),
    ]);
    const totals = gameTotals(game);
    expect(totals.uncoveredCount).toBe(1);
    const b = totals.players.find((p) => p.playerId === 'b');
    expect(b?.finalChips).toBeNull();
    // Для незафиксированного используется chipsOnHand.
    expect(b?.netChips).toBe(0);
  });

  it('chipsOnHand учитывает deal, buyin, external и cashout', () => {
    const players = [player('a', 'A', 0), player('b', 'B', 1)];
    const game = makeGame(players, [
      ev({ type: 'deal', playerId: 'a', chips: 600 }),
      ev({ type: 'buyin', playerId: 'a', chips: 600 }),
      ev({ type: 'external', fromId: 'b', toId: 'a', chips: 600 }),
      ev({ type: 'cashout', playerId: 'a', chips: 200 }),
      ev({ type: 'deal', playerId: 'b', chips: 600 }),
    ]);
    const states = derivePlayers(game);
    const a = states.find((p) => p.id === 'a');
    expect(a?.chips).toBe(600 + 600 + 600 - 200);
    expect(a?.buyins).toBe(1);
    expect(a?.externalIn).toBe(1);
    expect(a?.externalOut).toBe(0);
  });

  it('повторный cashout перезаписывает предыдущий', () => {
    const players = [player('a', 'A', 0), player('b', 'B', 1)];
    const game = makeGame(players, [
      ev({ type: 'deal', playerId: 'a', chips: 600 }),
      ev({ type: 'deal', playerId: 'b', chips: 600 }),
      ev({ type: 'cashout', playerId: 'a', chips: 100 }),
      ev({ type: 'cashout', playerId: 'a', chips: 450 }),
    ]);
    const a = derivePlayers(game).find((p) => p.id === 'a');
    expect(a?.finalChips).toBe(450);
    // chipsOnHand вычитает оба cashout.
    expect(a?.chips).toBe(600 - 100 - 450);
  });

  it('пустой журнал: все на нуле, банк полон', () => {
    const players = [player('a', 'A', 0)];
    const game = makeGame(players, []);
    const totals = gameTotals(game);
    expect(totals.players[0]?.chipsOnHand).toBe(0);
    expect(totals.uncoveredCount).toBe(1);
    expect(bankState(game).remaining).toBe(12250);
  });
});

describe('bankState', () => {
  it('считает покрытие докупок', () => {
    const game = makeGame([player('a', 'A', 0)], [ev({ type: 'deal', playerId: 'a', chips: 600 })]);
    const bank = bankState(game);
    expect(bank.dealt).toBe(600);
    expect(bank.remaining).toBe(11650);
    expect(bank.coveredStacks).toBe(19);
  });

  it('уходит в минус при перерасходе', () => {
    const game = makeGame(
      [player('a', 'A', 0)],
      [
        ev({ type: 'deal', playerId: 'a', chips: 600 }),
        ev({ type: 'buyin', playerId: 'a', chips: 600 }),
      ],
    );
    const tiny = { ...game, denominations: [{ ...KIT[0]!, count: 100 }] };
    // 5×100 = 500 в наборе, выдано 1200 → минус.
    expect(bankState(tiny).remaining).toBe(500 - 1200);
  });
});

describe('topPlayer', () => {
  it('берёт максимальный положительный net', () => {
    const game = makeGame(
      [player('a', 'A', 0), player('b', 'B', 1)],
      [
        ev({ type: 'deal', playerId: 'a', chips: 600 }),
        ev({ type: 'deal', playerId: 'b', chips: 600 }),
        ev({ type: 'finalStack', playerId: 'a', chips: 900 }),
        ev({ type: 'finalStack', playerId: 'b', chips: 300 }),
      ],
    );
    const top = topPlayer(gameTotals(game));
    expect(top?.playerId).toBe('a');
    expect(top?.netChips).toBe(300);
  });

  it('все в минусе — null', () => {
    const game = makeGame([player('a', 'A', 0)], [ev({ type: 'deal', playerId: 'a', chips: 600 })]);
    expect(topPlayer(gameTotals(game))).toBeNull();
  });
});

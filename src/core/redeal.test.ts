import { describe, expect, it } from 'vitest';
import { addBuyin, canRedeal, createGame, dealCountsNeeded, redeal } from './game';
import type { Deal, Denomination } from './types';

const denoms: Denomination[] = [
  { id: 'd1', value: 5, color: '#c8443b', count: 75 },
  { id: 'd2', value: 25, color: '#2f9e6a', count: 75 },
  { id: 'd3', value: 50, color: '#2f6fd0', count: 50 },
  { id: 'd4', value: 100, color: '#2b2b2b', count: 75 },
];

const first: Deal = {
  variant: 'balanced',
  perPlayer: [
    { value: 5, count: 10 },
    { value: 50, count: 11 },
  ],
  chipsPerPlayer: 600,
  totalDealt: 1200,
  level: 'L0',
};

const T = '2026-10-29T20:45:00+10:00';

function game() {
  return createGame({
    id: 'g1',
    name: 'вечер',
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
    deal: first,
  });
}

describe('dealCountsNeeded', () => {
  it('умножает вектор на число игроков', () => {
    expect(dealCountsNeeded(first, 4)).toEqual([
      { value: 5, count: 40 },
      { value: 50, count: 44 },
    ]);
  });
});

describe('пересдача', () => {
  const second: Deal = {
    variant: 'speed',
    perPlayer: [
      { value: 5, count: 20 },
      { value: 100, count: 5 },
    ],
    chipsPerPlayer: 600,
    totalDealt: 1200,
    level: 'L0',
  };

  it('меняет вектор, не трогая игроков и настройки', () => {
    const before = game();
    const after = redeal(before, second, '2026-10-29T21:00:00+10:00');
    expect(after.players).toEqual(before.players);
    expect(after.stackChips).toBe(before.stackChips);
    expect(after.deal.variant).toBe('speed');
    expect(after.deal.perPlayer).toEqual(second.perPlayer);
    expect(after.events.every((e) => e.chips === 600)).toBe(true);
  });

  it('пересчитывает totalDealt по числу игроков', () => {
    const after = redeal(game(), second, T);
    expect(after.deal.totalDealt).toBe(1200);
  });

  it('не срабатывает, если в журнале уже есть докупка', () => {
    const withBuyin = addBuyin(game(), 'p1', T, 'g1-e3');
    expect(canRedeal(withBuyin)).toBe(false);
    expect(redeal(withBuyin, second, T)).toBe(withBuyin);
  });

  it('не мутирует исходную игру', () => {
    const before = game();
    redeal(before, second, T);
    expect(before.deal.variant).toBe('balanced');
    expect(before.events).toHaveLength(2);
  });
});

import { describe, expect, it } from 'vitest';
import { coverageText, defaultVariant, levelBadge, planDeals, vectorToText } from './planner';

const denoms = [
  { value: 5, count: 75 },
  { value: 25, count: 75 },
  { value: 50, count: 50 },
  { value: 100, count: 75 },
];

const base = {
  denominations: denoms,
  players: 4,
  stackCoins: 150,
  rate: 4,
  multipleK: 5 as const,
  reserveStacks: 4,
};

describe('planDeals', () => {
  it('возвращает три карточки для всех вариантов', () => {
    const cards = planDeals(base);
    expect(cards.map((c) => c.variant)).toEqual(['balanced', 'economy', 'speed']);
    expect(cards.every((c) => c.ok)).toBe(true);
  });

  it('воспроизводит golden-раздачу 4 игрока / 150 монет / K=5', () => {
    const cards = planDeals(base);
    const balanced = cards.find((c) => c.variant === 'balanced');
    const economy = cards.find((c) => c.variant === 'economy');
    const speed = cards.find((c) => c.variant === 'speed');

    expect(vectorToText(balanced?.deal?.perPlayer ?? [])).toBe(
      '5\u00d715 · 25\u00d711 · 50\u00d75',
    );
    expect(vectorToText(economy?.deal?.perPlayer ?? [])).toBe('5\u00d75 · 25\u00d73 · 100\u00d75');
    expect(vectorToText(speed?.deal?.perPlayer ?? [])).toBe('5\u00d715 · 25\u00d75 · 100\u00d74');
    expect(balanced?.chipsPerPlayer).toBe(600);
    expect(balanced?.level).toBe('L0');
  });

  it('считает покрытие докупок', () => {
    const cards = planDeals(base);
    const balanced = cards[0];
    expect(balanced?.coverage.stillInBank).toBe(12250 - 2400);
    expect(balanced?.coverage.coveredStacks).toBe(16);
    expect(balanced?.coverage.ok).toBe(true);
  });

  it('плашка L3 при нехватке фишек на 6 игроков', () => {
    const cards = planDeals({ ...base, players: 6, stackCoins: 500 });
    const balanced = cards[0];
    expect(balanced?.level).toBe('L3');
    expect(balanced?.levelNote).toBe('кратность ослаблена');
    expect(balanced?.chipsPerPlayer).toBe(1960);
    expect(balanced?.coverage.ok).toBe(false);
    expect(coverageText(balanced!, 4)).toContain('банк выдержит');
  });

  it('все карточки неактивны без набора', () => {
    const cards = planDeals({ ...base, denominations: [] });
    expect(cards.every((c) => !c.ok)).toBe(true);
    expect(cards.every((c) => c.reason === 'Нет набора')).toBe(true);
  });

  it('помечает совпадающие варианты', () => {
    // 12 игроков по 150 монет: набора хватает только на `[5,3,0,5]`,
    // и все три варианта вырождаются в один вектор (§4.7, строка 6).
    const cards = planDeals({ ...base, players: 12 });
    const duplicates = cards.filter((c) => c.duplicateOf !== null);
    expect(duplicates.length).toBe(2);
    expect(duplicates.every((c) => c.duplicateOf === 'balanced')).toBe(true);
  });

  it('defaultVariant возвращает первый доступный', () => {
    expect(defaultVariant(planDeals(base))).toBe('balanced');
    expect(defaultVariant(planDeals({ ...base, denominations: [] }))).toBeNull();
  });

  it('coinsPerPlayer считается из курса', () => {
    const cards = planDeals({ ...base, rate: 5, stackCoins: 120 });
    const balanced = cards[0];
    expect(balanced?.chipsPerPlayer).toBe(600);
    expect(balanced?.coinsPerPlayer).toBe(12000);
  });
});

describe('levelBadge', () => {
  it('L0 без плашки, остальные с текстом', () => {
    expect(levelBadge('L0')).toBeNull();
    expect(levelBadge('L1')).toBe('без мелких на блайнды');
    expect(levelBadge('L2', '−1 фишка на игрока')).toBe('−1 фишка на игрока');
    expect(levelBadge('L2')).toBe('стек меньше на 1–2 фишки');
    expect(levelBadge('L3')).toBe('кратность ослаблена');
    expect(levelBadge('L4')).toBe('банк не позволяет полный стек');
  });
});

describe('vectorToText', () => {
  it('склеивает номиналы и пустой вектор', () => {
    expect(
      vectorToText([
        { value: 5, count: 5 },
        { value: 100, count: 2 },
      ]),
    ).toBe('5\u00d75 · 100\u00d72');
    expect(vectorToText([])).toBe('—');
  });
});

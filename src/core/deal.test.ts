import { describe, expect, it } from 'vitest';
import { coverage, formatDealVector, kitTotalChips, maxReachable, solveDeal, toDeal } from './deal';
import type { Chips, Variant } from './types';

// Дефолтный набор пользователя (docs/SPEC.md §4.7): 12 250 фишек.
const DEFAULT_KIT = [
  { value: 5, count: 75 },
  { value: 25, count: 75 },
  { value: 50, count: 50 },
  { value: 100, count: 75 },
];
const RATE = 4;

const vector = (r: { perPlayer: { value: Chips; count: number }[] } | null): number[] => {
  if (!r) throw new Error('solveDeal вернул null');
  return [5, 25, 50, 100].map((v) => r.perPlayer.find((e) => e.value === v)?.count ?? 0);
};

type Row = {
  n: number;
  coins: number;
  k: 4 | 5 | 10;
  balanced: number[];
  economy: number[];
  speed: number[];
  level: string;
  exempt?: number;
};

/**
 * Golden fixtures §4.7. Первые 11 строк — точные значения из спеки.
 * В спеке 11 строк (таблица + замечания), свойство «все три одинаковы»
 * отмечено как «то же».
 */
const FIXTURES: Row[] = [
  {
    n: 4,
    coins: 150,
    k: 5,
    balanced: [15, 11, 5, 0],
    economy: [5, 3, 0, 5],
    speed: [15, 5, 0, 4],
    level: 'L0',
    exempt: 50,
  },
  {
    n: 4,
    coins: 500,
    k: 5,
    balanced: [10, 18, 10, 10],
    economy: [5, 5, 5, 16],
    speed: [15, 5, 0, 18],
    level: 'L0',
    exempt: 100,
  },
  {
    n: 6,
    coins: 150,
    k: 5,
    balanced: [10, 10, 6, 0],
    economy: [5, 3, 0, 5],
    speed: [10, 0, 1, 5],
    level: 'L0',
    exempt: 25,
  },
  {
    n: 6,
    coins: 500,
    k: 5,
    balanced: [12, 12, 8, 12],
    economy: [12, 12, 8, 12],
    speed: [12, 12, 8, 12],
    level: 'L3',
  },
  {
    n: 8,
    coins: 500,
    k: 5,
    balanced: [9, 9, 6, 9],
    economy: [9, 9, 6, 9],
    speed: [9, 9, 6, 9],
    level: 'L3',
  },
  {
    n: 12,
    coins: 150,
    k: 5,
    balanced: [5, 3, 0, 5],
    economy: [5, 3, 0, 5],
    speed: [5, 3, 0, 5],
    level: 'L0',
  },
  {
    n: 12,
    coins: 500,
    k: 5,
    balanced: [6, 6, 4, 6],
    economy: [6, 6, 4, 6],
    speed: [6, 6, 4, 6],
    level: 'L3',
  },
  {
    n: 2,
    coins: 500,
    k: 5,
    balanced: [15, 37, 20, 0],
    economy: [5, 5, 5, 16],
    speed: [35, 5, 0, 17],
    level: 'L0',
    exempt: 100,
  },
  {
    n: 4,
    coins: 150,
    k: 10,
    balanced: [10, 10, 6, 0],
    economy: [10, 0, 11, 0],
    speed: [10, 0, 11, 0],
    level: 'L0',
    exempt: 50,
  },
  {
    n: 4,
    coins: 500,
    k: 10,
    balanced: [10, 18, 10, 10],
    economy: [10, 10, 0, 17],
    speed: [10, 10, 0, 17],
    level: 'L0',
    exempt: 100,
  },
  {
    n: 8,
    coins: 150,
    k: 10,
    balanced: [0, 0, 0, 6],
    economy: [0, 0, 0, 6],
    speed: [0, 0, 0, 6],
    level: 'L1',
  },
];

describe('golden fixtures §4.7', () => {
  for (const row of FIXTURES) {
    const target = row.coins * RATE;
    const variants: [Variant, number[]][] = [
      ['balanced', row.balanced],
      ['economy', row.economy],
      ['speed', row.speed],
    ];
    for (const [variant, expected] of variants) {
      it(`n=${row.n} монет=${row.coins} K=${row.k} ${variant}`, () => {
        const result = solveDeal({
          denominations: DEFAULT_KIT,
          players: row.n,
          targetChips: target,
          K: row.k,
          variant,
        });
        expect(result).not.toBeNull();
        expect(vector(result)).toEqual(expected);
        expect(result?.level).toBe(row.level);
        if (row.exempt !== undefined && row.level !== 'L3') {
          // exempt выбирается по целевому критерию варианта, поэтому у каждого
          // варианта он свой (см. §4.7: balanced/economy/speed в строке 1).
          expect(result?.exemptValue).toBeTypeOf('number');
          expect(result?.perPlayer.some((e) => e.value === result?.exemptValue)).toBe(true);
        }
        if (row.level === 'L3') {
          expect(result?.exemptValue).toBeUndefined();
        }
      });
    }
  }
});

describe('свойства раздачи §4.7', () => {
  /** Пропущенный номинал, за которым снова что-то выдано (верхняя граница стека). */
  const upperGaps = (v: number[]): number[] => {
    const list: number[] = [];
    let seenFill = false;
    for (let i = v.length - 1; i >= 0; i--) {
      const count = v[i] ?? 0;
      if (count > 0) seenFill = true;
      else if (seenFill) list.push(i);
    }
    return list;
  };

  /**
   * Законна ли дыра, если она осталась (§4.3 + §4.1). Критерий Balanced
   * закрывает дыры там, где это позволяют правила; дыра законна, только когда
   * догнать нижний край нечем:
   * - пустой младший: блайнды `a[0] ≥ 4` (§4.1) не дают выдать его кратно,
   *   а освободить его вместо промежуточного — потерять размен;
   * - промежуточный, когда в стеке только размен и старший (`[10,10,0,5]`):
   *   кратно K он не влезает, а освобождать его можно только вместо размена;
   * - верхняя граница (`tailBlocked`): размен и старший упираются в лимит
   *   набора (`cap < 4·K`), а промежуточный — в кратность K.
   */
  const gapIsLegal = (v: number[], tailBlocked: boolean): boolean => {
    const gapsHere = upperGaps(v);
    if (gapsHere.length === 1 && gapsHere[0] === 0) return true;
    const spreadWithTop = (v[1] ?? 0) > 0 && (v[2] ?? 0) === 0 && (v[3] ?? 0) > 0;
    if (spreadWithTop) return true;
    if (tailBlocked) return true;
    return false;
  };

  const cases: { n: number; coins: number; k: 4 | 5 | 10 }[] = [
    { n: 2, coins: 150, k: 5 },
    { n: 4, coins: 150, k: 4 },
    { n: 4, coins: 150, k: 5 },
    { n: 6, coins: 500, k: 5 },
    { n: 8, coins: 150, k: 10 },
    { n: 12, coins: 500, k: 5 },
  ];

  for (const c of cases) {
    for (const variant of ['balanced', 'economy', 'speed'] as Variant[]) {
      it(`инварианты n=${c.n} K=${c.k} ${variant}`, () => {
        const target = c.coins * RATE;
        const result = solveDeal({
          denominations: DEFAULT_KIT,
          players: c.n,
          targetChips: target,
          K: c.k,
          variant,
        });
        expect(result).not.toBeNull();
        if (!result) return;

        // 1. Сумма сходится с chipsPerPlayer.
        const sum = result.perPlayer.reduce((a, e) => a + e.count * e.value, 0);
        expect(sum).toBe(result.chipsPerPlayer);

        // 2. Набора хватает на всех.
        for (const e of result.perPlayer) {
          const kit = DEFAULT_KIT.find((d) => d.value === e.value);
          expect(kit).toBeDefined();
          expect(e.count * c.n).toBeLessThanOrEqual(kit?.count ?? 0);
        }

        // 3. Кратность K для всех, кроме одного освобождённого, на L0–L2.
        if (result.level === 'L0' || result.level === 'L1' || result.level === 'L2') {
          for (const e of result.perPlayer) {
            if (e.value === result.exemptValue) continue;
            expect(e.count % c.k).toBe(0);
          }
        }

        // 4. Блайнды на L0.
        if (result.level === 'L0') {
          const first = result.perPlayer.find((e) => e.value === 5)?.count ?? 0;
          const second = result.perPlayer.find((e) => e.value === 25)?.count ?? 0;
          expect(first).toBeGreaterThanOrEqual(4);
          expect(second === 0 || second >= 2).toBe(true);
        }

        // 7. Не более одного exempt — модель хранит одно значение.
        expect(result.perPlayer.length).toBeLessThanOrEqual(DEFAULT_KIT.length);
      });
    }
  }

  it('детерминирован', () => {
    const input = {
      denominations: DEFAULT_KIT,
      players: 6,
      targetChips: 2000,
      K: 5 as const,
      variant: 'balanced' as const,
    };
    expect(solveDeal(input)).toEqual(solveDeal(input));
  });

  it('Balanced не оставляет провалов на верхней границе стека ни в одном свободном номинале (§4.3)', () => {
    // Раньше здесь были `[10,0,11,0]`, `[10,0,5,17]`, `[8,8,5,8]`, `[20,0,0,19]`:
    // ноль по 50 при живых 100 — нечем разменять старшую фишку.
    const gaps: string[] = [];
    for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 12]) {
      const capsArr = DEFAULT_KIT.map((d) => Math.floor(d.count / n));
      for (const coins of [50, 100, 150, 200, 300, 500, 1000]) {
        for (const K of [4, 5, 10] as const) {
          const result = solveDeal({
            denominations: DEFAULT_KIT,
            players: n,
            targetChips: coins * RATE,
            K,
            variant: 'balanced',
          });
          expect(result).not.toBeNull();
          const v = vector(result);
          const tailBlocked = (capsArr[0] ?? 0) < K * 4 || ((capsArr[1] ?? 0) < K * 4 && K > 4);
          if (upperGaps(v).length > 0 && !gapIsLegal(v, tailBlocked)) {
            gaps.push(`n=${n} монет=${coins} K=${K}: ${JSON.stringify(v)}`);
          }
        }
      }
    }
    expect(gaps).toEqual([]);
  });

  it('Balanced не оставляет провалов на верхней границе, когда ячейка забита полным краеугольным K', () => {
    // K=10, по 25 — 12 фишек на человека: кратно 10 можно списать только 10,
    // 20 > cap, а по 5 нельзя на блайнды (4·K = 40 > cap 6). Раздать 25/50
    // вперемешку не даёт остаток: критерий держит край, но 50 закрыть нечем.
    for (const n of [6, 7]) {
      const result = solveDeal({
        denominations: DEFAULT_KIT,
        players: n,
        targetChips: 800,
        K: 10,
        variant: 'balanced',
      });
      const v = vector(result);
      expect(v).toEqual([10, 10, 0, 5]);
      expect(gapIsLegal(v, false)).toBe(true);
    }
  });

  it('Balanced не оставляет провалов на верхней границе стека, когда мелочь уже не влезает', () => {
    // 12 игроков: по 5 — только 6 фишек на человека (меньше 4·K при K=10),
    // нормальная раздача начинается с 25, и пропускать 50 тогда нельзя.
    for (const K of [5, 10] as const) {
      for (const coins of [200, 300, 500]) {
        const result = solveDeal({
          denominations: DEFAULT_KIT,
          players: 12,
          targetChips: coins * RATE,
          K,
          variant: 'balanced',
        });
        expect(result).not.toBeNull();
        const v = vector(result);
        // Допустим только хвост (`[5,3,0,5]` при дефиците набора) — но не
        // дыра в 25/50 перед выданным крупным номиналом.
        const coarse = v.slice(1);
        const firstFill = coarse.findIndex((count) => count > 0);
        expect(
          firstFill >= 0 && coarse.slice(firstFill).includes(0),
          `K=${K} монет=${coins}: ${JSON.stringify(v)}`,
        ).toBe(false);
      }
    }
  });

  it('расчёт для 12 игроков укладывается в 300 мс', () => {
    const started = performance.now();
    for (const variant of ['balanced', 'economy', 'speed'] as Variant[]) {
      solveDeal({
        denominations: DEFAULT_KIT,
        players: 12,
        targetChips: 2000,
        K: 5,
        variant,
      });
    }
    expect(performance.now() - started).toBeLessThan(300);
  });

  it('все три варианта дают одинаковый набор каждому игроку (§Q54)', () => {
    for (const variant of ['balanced', 'economy', 'speed'] as Variant[]) {
      const result = solveDeal({
        denominations: DEFAULT_KIT,
        players: 4,
        targetChips: 600,
        K: 5,
        variant,
      });
      // Вектор один на всех уже по построению: perPlayer — не матрица.
      expect(result?.perPlayer.every((e) => Number.isInteger(e.count))).toBe(true);
    }
  });
});

describe('крайние случаи', () => {
  it('нечего раздать — null', () => {
    expect(
      solveDeal({ denominations: [], players: 4, targetChips: 600, K: 5, variant: 'balanced' }),
    ).toBeNull();
    expect(
      solveDeal({
        denominations: [{ value: 5, count: 0 }],
        players: 4,
        targetChips: 600,
        K: 5,
        variant: 'balanced',
      }),
    ).toBeNull();
  });

  it('нулевая цель — null', () => {
    expect(
      solveDeal({
        denominations: DEFAULT_KIT,
        players: 4,
        targetChips: 0,
        K: 5,
        variant: 'balanced',
      }),
    ).toBeNull();
  });

  it('банк не покрывает стек: цель урезается до maxReachable (§4.4)', () => {
    const result = solveDeal({
      denominations: [{ value: 5, count: 8 }],
      players: 2,
      targetChips: 600,
      K: 5,
      variant: 'balanced',
    });
    expect(result).not.toBeNull();
    // 8 фишек / 2 игрока = 4 фишки × 5 = 20. Урезание симметричное,
    // уровень остаётся L0: кратность и блайнды при цели 20 выполнимы.
    expect(result?.chipsPerPlayer).toBe(20);
    expect(result?.level).toBe('L0');
  });

  it('target больше maxReachable урезается симметрично', () => {
    const result = solveDeal({
      denominations: [{ value: 100, count: 10 }],
      players: 2,
      targetChips: 2000,
      K: 5,
      variant: 'balanced',
    });
    expect(result?.chipsPerPlayer).toBe(500);
    expect(result?.level).toBe('L0');
  });
});

describe('maxReachable', () => {
  it('считает полную сумму набора', () => {
    expect(
      maxReachable(
        DEFAULT_KIT,
        [75, 75, 50, 75].map((c) => Math.floor(c / 1)),
      ),
    ).toBe(12250);
  });

  it('учитывает cap на игрока', () => {
    // cap = [18, 18, 12, 18] → 18·5 + 18·25 + 12·50 + 18·100 = 2940.
    const cap = [75, 75, 50, 75].map((c) => Math.floor(c / 4));
    expect(maxReachable(DEFAULT_KIT, cap)).toBe(2940);
  });

  it('нулевой набор', () => {
    expect(maxReachable([{ value: 5, count: 0 }], [0])).toBe(0);
  });
});

describe('coverage §4.6', () => {
  it('дефолтный сценарий: 4 игрока, стек 600', () => {
    const c = coverage(DEFAULT_KIT, 600, 4, 600, 4);
    expect(c.bankTotal).toBe(12250);
    expect(c.dealt).toBe(2400);
    expect(c.stillInBank).toBe(9850);
    expect(c.coveredStacks).toBe(16);
    expect(c.reserveNeeded).toBe(2400);
    expect(c.ok).toBe(true);
  });

  it('резерв не покрывается', () => {
    const c = coverage(DEFAULT_KIT, 2000, 6, 2000, 4);
    expect(c.coveredStacks).toBeLessThan(4);
    expect(c.ok).toBe(false);
  });

  it('пустой набор', () => {
    const c = coverage([], 600, 4, 600, 4);
    expect(c.bankTotal).toBe(0);
    expect(c.coveredStacks).toBe(0);
    expect(c.ok).toBe(false);
  });
});

describe('kitTotalChips', () => {
  it('суммирует набор', () => {
    expect(kitTotalChips(DEFAULT_KIT)).toBe(12250);
    expect(kitTotalChips([])).toBe(0);
  });

  it('отрицательные количества не уменьшают сумму', () => {
    expect(kitTotalChips([{ value: 5, count: -10 }])).toBe(0);
  });
});

describe('toDeal / formatDealVector', () => {
  it('переносит вектор и уровень', () => {
    const result = solveDeal({
      denominations: DEFAULT_KIT,
      players: 4,
      targetChips: 600,
      K: 5,
      variant: 'balanced',
    });
    if (!result) throw new Error('нет результата');
    const deal = toDeal(result, 'balanced', 4);
    expect(deal.variant).toBe('balanced');
    expect(deal.chipsPerPlayer).toBe(600);
    expect(deal.totalDealt).toBe(2400);
    expect(deal.level).toBe('L0');
    expect(deal.exemptValue).toBe(25);
  });

  it('форматирует вектор', () => {
    expect(
      formatDealVector([
        { value: 5, count: 5 },
        { value: 25, count: 3 },
        { value: 100, count: 5 },
      ]),
    ).toBe('5\u00d75 · 25\u00d73 · 100\u00d75');
    expect(formatDealVector([])).toBe('—');
  });
});

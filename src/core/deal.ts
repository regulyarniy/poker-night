/**
 * Алгоритм раздачи (docs/SPEC.md §4).
 *
 * Задача: один и тот же вектор количества фишек каждого номинала на игрока,
 * ровно набирающий целевой стек, с ограничениями по количеству в наборе,
 * кратности K и минимуму мелких фишек на блайнды.
 *
 * Решение — полный перебор с отсечением: m ≤ 8, n ≤ 12, cap[i] ≤ 37,
 * пространство < 500 узлов. Оптимум точный, без эвристик.
 */

import type { Chips, Deal, DealLevel, MultipleK, Variant } from './types';

export type DealDenomination = { value: Chips; count: number };

export type DealInput = {
  denominations: DealDenomination[];
  players: number;
  targetChips: Chips;
  K: MultipleK;
  variant: Variant;
};

export type DealResult = {
  perPlayer: { value: Chips; count: number }[];
  chipsPerPlayer: Chips;
  level: DealLevel;
  exemptValue?: Chips;
  /** Человекочитаемое пояснение для UI */
  note?: string;
};

type Solution = {
  counts: number[];
  /** Индекс освобождённого от K номинала, -1 = все под K */
  exempt: number;
};

/**
 * Сплошность стека для Balanced (§4.3).
 *
 * Номиналы делятся на две группы относительно самого крупного номинала
 * набора: `coarse` (≥ 1/10 старшего — «верхняя граница»: 25, 50, 100) и
 * `fine` (мельче — размен и блайнды: 5).
 *
 * - `gaps` — пропущенные coarse-номиналы, за которыми снова что-то выдано.
 *   Для `5,25,50,100`: `[10,0,5,17]` → 1 (пропущен 25),
 *   `[8,8,0,8]` → 1 (пропущен 50), `[15,11,5,0]` → 0 (пробел только в
 *   хвосте — разменять нечего, но и жертвовать нечем).
 * - `coarseSpread` — перекос верха в фишках: `max(count·value) − min(count·value)`.
 *   `[10,0,5,17]` (250…1700) → 1450, `[8,8,0,8]` (200…800) → 600,
 *   `[10,18,10,10]` (450…1000) → 550.
 * - `fineChips` — сколько мелкого выдано: для отладки и будущих tie-break.
 *
 * Обе метрики — 0, если крупных номиналов в наборе меньше двух: один
 * номинал нечему противоречить.
 */
type Spread = { gaps: number; coarseSpread: number; fineChips: number };

function spread(denoms: number[], counts: number[]): Spread {
  const max = denoms.length - 1;
  const empty: Spread = { gaps: 0, coarseSpread: 0, fineChips: 0 };
  if (max < 1) return empty;

  const top = denoms[max] ?? 0;
  const coarse = (value: number): boolean => value * 10 >= top;

  const coarseCount = denoms.filter(coarse).length;
  if (coarseCount < 2) return empty;

  let gaps = 0;
  let seenFill = false;
  let minChips = Number.POSITIVE_INFINITY;
  let maxChips = 0;
  let counted = 0;
  let fineChips = 0;

  for (let i = max; i >= 0; i--) {
    const count = counts[i] ?? 0;
    const value = denoms[i] ?? 0;
    if (!coarse(value)) {
      fineChips += count * value;
      continue;
    }
    if (count > 0) {
      seenFill = true;
      const chips = count * value;
      if (chips < minChips) minChips = chips;
      if (chips > maxChips) maxChips = chips;
      counted += 1;
    } else if (seenFill) {
      gaps += 1;
    }
  }

  if (counted === 0) return { gaps, coarseSpread: 0, fineChips };
  if (counted === 1) minChips = maxChips;
  return { gaps, coarseSpread: maxChips - minChips, fineChips };
}

/** Целевые критерии вариантов (§4.3). Меньше — лучше. */
function score(s: Solution, variant: Variant, denoms: number[]): number[] {
  let nonZero = 0;
  let total = 0;
  for (const c of s.counts) {
    if (c > 0) nonZero += 1;
    total += c;
  }
  switch (variant) {
    case 'balanced': {
      // Сплошной верх важнее экономии номиналов: иначе первое же решение с
      // минимумом ненулевых ломает верхнюю границу (`[10,0,11,0]`).
      const d = spread(denoms, s.counts);
      return [d.gaps, d.coarseSpread, nonZero, total];
    }
    case 'economy':
      return [total, nonZero];
    case 'speed':
      return [-(s.counts[0] ?? 0), total];
  }
}

/** Лексикографическое сравнение: true, если `a` строго лучше `b`. */
function better(a: Solution, b: Solution | null, variant: Variant, denoms: number[]): boolean {
  if (b === null) return true;
  const sa = score(a, variant, denoms);
  const sb = score(b, variant, denoms);
  for (let i = 0; i < sa.length; i++) {
    const x = sa[i] ?? 0;
    const y = sb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

/**
 * Максимальная сумма, физически собираемая из набора (без K и блайндов).
 * Ограниченный рюкзак: dp[s] = достижима ли сумма s.
 * Один проход на номинал через счётчик израсходованных фишек — O(Σ cap·value).
 */
export function maxReachable(denominations: DealDenomination[], cap: number[]): number {
  const total = denominations.reduce((acc, d, i) => acc + (cap[i] ?? 0) * d.value, 0);
  if (total <= 0) return 0;
  const reachable = new Uint8Array(total + 1);
  reachable[0] = 1;
  const used = new Int32Array(total + 1);

  for (let i = 0; i < denominations.length; i++) {
    const value = denominations[i]?.value ?? 0;
    const limit = cap[i] ?? 0;
    if (value <= 0 || limit <= 0) continue;
    used.fill(-1);
    used[0] = 0;
    for (let s = 0; s <= total; s++) {
      if (reachable[s] === 1) {
        used[s] = 0;
      } else if (s >= value) {
        const prev = used[s - value] ?? -1;
        if (prev >= 0 && prev < limit) {
          reachable[s] = 1;
          used[s] = prev + 1;
        }
      }
    }
  }

  for (let s = total; s >= 0; s--) {
    if (reachable[s] === 1) return s;
  }
  return 0;
}

/**
 * Перебор при фиксированном освобождённом номинале.
 * Возвращает лучший вектор по критерию варианта или null.
 *
 * Гарантии блайндов проверяются **внутри** цикла, а не после перебора:
 * иначе валидные решения (например `[10,0,11,0]`) отбрасываются заодно
 * с невалидными, и L0 не находится.
 */
function dfs(
  i: number,
  rem: Chips,
  ctx: {
    values: number[];
    cap: number[];
    suffix: number[];
    useK: boolean;
    strictBlinds: boolean;
    K: number;
    exempt: number;
    variant: Variant;
    counts: number[];
  },
): Solution | null {
  const { values, cap, suffix, useK, strictBlinds, K, exempt, variant, counts } = ctx;
  if (i === values.length) {
    return rem === 0 ? { counts: counts.slice(), exempt } : null;
  }
  const suffixHere = suffix[i] ?? 0;
  if (rem > suffixHere) return null;

  const value = values[i] ?? 0;
  if (value <= 0) return null;
  const capHere = cap[i] ?? 0;
  const max = Math.min(capHere, Math.floor(rem / value));
  let best: Solution | null = null;

  for (let a = 0; a <= max; a++) {
    if (useK && i !== exempt && a % K !== 0) continue;
    if (strictBlinds && i === 0 && a < 4) continue;
    if (strictBlinds && i === 1 && a > 0 && a < 2) continue;

    const v = a * value;
    if (rem - v > (suffix[i + 1] ?? 0)) continue;

    counts[i] = a;
    const cand = dfs(i + 1, rem - v, ctx);
    if (cand && better(cand, best, variant, values)) best = cand;
  }
  counts[i] = 0;
  return best;
}

/** Перебор по всем вариантам exempt: первый успешный — не значит оптимальный. */
function search(
  target: Chips,
  useK: boolean,
  strictBlinds: boolean,
  base: {
    values: number[];
    cap: number[];
    suffix: number[];
    K: number;
    variant: Variant;
  },
): Solution | null {
  const { values, cap, suffix, K, variant } = base;
  const exempts = useK ? [-1, ...values.map((_, idx) => idx)] : [-1];
  let best: Solution | null = null;
  const counts = new Array<number>(values.length).fill(0);
  for (const exempt of exempts) {
    const ctx = { values, cap, suffix, useK, strictBlinds, K, exempt, variant, counts };
    const found = dfs(0, target, ctx);
    if (found && better(found, best, variant, values)) best = found;
  }
  return best;
}

/** Сборка результата: вектор, уровень, освобождённый номинал, пояснение. */
function finish(sol: Solution, level: DealLevel, values: number[], note?: string): DealResult {
  const perPlayer: { value: Chips; count: number }[] = [];
  let chips = 0;
  for (let i = 0; i < values.length; i++) {
    const count = sol.counts[i] ?? 0;
    const value = values[i] ?? 0;
    if (count > 0) perPlayer.push({ value, count });
    chips += count * value;
  }
  const result: DealResult = {
    perPlayer,
    chipsPerPlayer: chips,
    level,
  };
  if (sol.exempt >= 0 && values[sol.exempt] !== undefined) {
    result.exemptValue = values[sol.exempt];
  }
  if (note !== undefined) result.note = note;
  return result;
}

/**
 * Решает задачу раздачи по лестнице компромиссов §4.4.
 * Возвращает null, только если раздать нечего (нулевой набор/цель).
 */
export function solveDeal(input: DealInput): DealResult | null {
  const { denominations, players, targetChips, K, variant } = input;
  if (players <= 0 || denominations.length === 0) return null;

  const sorted = [...denominations].sort((a, b) => a.value - b.value);
  const values = sorted.map((d) => d.value);
  const cap = sorted.map((d) => Math.floor(Math.max(0, d.count) / players));
  if (values.some((v) => !(v > 0))) return null;

  const suffix = new Array<number>(values.length + 1).fill(0);
  for (let i = values.length - 1; i >= 0; i--) {
    suffix[i] = (suffix[i + 1] ?? 0) + (cap[i] ?? 0) * (values[i] ?? 0);
  }

  const reachableMax = suffix[0] ?? 0;
  if (reachableMax <= 0) return null;
  const t = Math.min(targetChips, reachableMax);
  if (t <= 0) return null;

  const base = { values, cap, suffix, K, variant };

  const l0 = search(t, true, true, base);
  if (l0) return finish(l0, 'L0', values);

  const l1 = search(t, true, false, base);
  if (l1) return finish(l1, 'L1', values, 'без мелких на блайнды');

  for (const dev of [1, 2]) {
    if (t - dev <= 0) continue;
    const l2 = search(t - dev, true, false, base);
    if (l2) return finish(l2, 'L2', values, `\u2212${dev} фиш${dev === 1 ? 'ка' : 'ки'} на игрока`);
  }

  const l3 = search(t, false, false, base);
  if (l3) return finish(l3, 'L3', values, 'кратность ослаблена');

  const maxSum = maxReachable(sorted, cap);
  const startFrom = Math.min(t, maxSum);
  for (let target = startFrom; target > 0; target--) {
    const l4 = search(target, false, false, base);
    if (l4) return finish(l4, 'L4', values, `доступно только ${target} фишек`);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Покрытие докупок (§4.6)
// ---------------------------------------------------------------------------

export type Coverage = {
  /** Всего фишек в наборе */
  bankTotal: Chips;
  /** Выдано всех стеков */
  dealt: Chips;
  /** Нужно на резерв */
  reserveNeeded: Chips;
  /** Останется в банке */
  stillInBank: Chips;
  /** Сколько полных стеков хватит */
  coveredStacks: number;
  /** Хватает ли резерва */
  ok: boolean;
};

export function kitTotalChips(denominations: DealDenomination[]): Chips {
  return denominations.reduce((acc, d) => acc + Math.max(0, d.count) * d.value, 0);
}

export function coverage(
  denominations: DealDenomination[],
  chipsPerPlayer: Chips,
  players: number,
  stackChips: Chips,
  reserveStacks: number,
): Coverage {
  const bankTotal = kitTotalChips(denominations);
  const dealt = chipsPerPlayer * players;
  const reserveNeeded = stackChips * reserveStacks;
  const stillInBank = bankTotal - dealt;
  const coveredStacks = stackChips > 0 ? Math.max(0, Math.floor(stillInBank / stackChips)) : 0;
  return {
    bankTotal,
    dealt,
    reserveNeeded,
    stillInBank,
    coveredStacks,
    ok: coveredStacks >= reserveStacks,
  };
}

// ---------------------------------------------------------------------------
// Мост к доменному Deal
// ---------------------------------------------------------------------------

/** Приводит результат алгоритма к `Deal` игры. */
export function toDeal(result: DealResult, variant: Variant, players: number): Deal {
  const deal: Deal = {
    variant,
    perPlayer: result.perPlayer,
    chipsPerPlayer: result.chipsPerPlayer,
    totalDealt: result.chipsPerPlayer * players,
    level: result.level,
  };
  if (result.exemptValue !== undefined) deal.exemptValue = result.exemptValue;
  return deal;
}

/** Вектор раздачи в человекочитаемый вид: «5×5 · 25×3 · 100×5». */
export function formatDealVector(perPlayer: { value: Chips; count: number }[]): string {
  if (perPlayer.length === 0) return '—';
  return perPlayer.map((e) => `${e.value}\u00d7${e.count}`).join(' · ');
}

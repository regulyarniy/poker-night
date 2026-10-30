/**
 * Планирование раздачи для экрана «Новая игра» (docs/SPEC.md §4.6, §5.4).
 *
 * Чистый слой: считает три варианта, их покрытие докупок, плашки уровней
 * и пометки о совпадении вариантов (Q133). Никакого DOM.
 */

import { type Coverage, coverage, solveDeal, toDeal } from './deal';
import type { Chips, CoinCents, Deal, DealLevel, MultipleK, Variant } from './types';

export type PlannerInput = {
  denominations: { value: Chips; count: number }[];
  players: number;
  stackCoins: number;
  rate: number;
  multipleK: MultipleK;
  reserveStacks: number;
};

export type VariantCard = {
  variant: Variant;
  label: string;
  /** Вариант осуществим */
  ok: boolean;
  /** Причина неактивности — короткое существительное */
  reason: string | null;
  deal: Deal | null;
  level: DealLevel | null;
  chipsPerPlayer: Chips;
  coinsPerPlayer: CoinCents;
  coverage: Coverage;
  /** С каким вариантом совпадает вектор (Q133) */
  duplicateOf: Variant | null;
  /** Пояснение уровня из Приложения A */
  levelNote: string | null;
};

export const VARIANT_LABELS: Record<Variant, string> = {
  balanced: 'Balanced',
  economy: 'Economy',
  speed: 'Speed',
};

export const VARIANTS: readonly Variant[] = ['balanced', 'economy', 'speed'];

/** Плашки уровней — Приложение A спеки. */
export function levelBadge(level: DealLevel, note?: string): string | null {
  switch (level) {
    case 'L0':
      return null;
    case 'L1':
      return 'без мелких на блайнды';
    case 'L2':
      return note ?? 'стек меньше на 1–2 фишки';
    case 'L3':
      return 'кратность ослаблена';
    case 'L4':
      return 'банк не позволяет полный стек';
  }
}

/** Вектор раздачи в виде «5×5 · 25×3 · 100×5». */
export function vectorToText(perPlayer: { value: Chips; count: number }[]): string {
  if (perPlayer.length === 0) return '—';
  return perPlayer.map((entry) => `${entry.value}\u00d7${entry.count}`).join(' · ');
}

function sameVector(a: Deal, b: Deal): boolean {
  if (a.chipsPerPlayer !== b.chipsPerPlayer) return false;
  if (a.perPlayer.length !== b.perPlayer.length) return false;
  for (let i = 0; i < a.perPlayer.length; i++) {
    const x = a.perPlayer[i];
    const y = b.perPlayer[i];
    if (!x || !y) return false;
    if (x.value !== y.value || x.count !== y.count) return false;
  }
  return true;
}

/**
 * Считает три карточки вариантов. Пустой массив только если нечего считать
 * (меньше 2 номиналов или нулевой набор) — тогда все карточки неактивны (§12.13).
 */
export function planDeals(input: PlannerInput): VariantCard[] {
  const { denominations, players, stackCoins, rate, multipleK, reserveStacks } = input;
  const targetChips = Math.max(0, Math.round(stackCoins * rate));
  const bankTotal = denominations.reduce((acc, d) => acc + Math.max(0, d.count) * d.value, 0);
  const usable = denominations.length >= 2 && bankTotal > 0 && players >= 2 && targetChips > 0;

  const cards: VariantCard[] = VARIANTS.map((variant) => {
    const base: VariantCard = {
      variant,
      label: VARIANT_LABELS[variant],
      ok: false,
      reason: null,
      deal: null,
      level: null,
      chipsPerPlayer: 0,
      coinsPerPlayer: 0,
      coverage: coverage(denominations, 0, players, targetChips, reserveStacks),
      duplicateOf: null,
      levelNote: null,
    };
    if (!usable) {
      return { ...base, reason: 'Нет набора' };
    }

    const result = solveDeal({
      denominations,
      players,
      targetChips,
      K: multipleK,
      variant,
    });
    if (!result) return { ...base, reason: 'Не хватает фишек' };

    const deal = toDeal(result, variant, players);
    return {
      ...base,
      ok: true,
      deal,
      level: result.level,
      chipsPerPlayer: deal.chipsPerPlayer,
      coinsPerPlayer: rate > 0 ? Math.round((deal.chipsPerPlayer * 100) / rate) : 0,
      coverage: coverage(denominations, deal.chipsPerPlayer, players, targetChips, reserveStacks),
      levelNote: levelBadge(result.level, result.note),
    };
  });

  // Пометки о совпадении: первый по порядку вариант считается «эталоном».
  for (let i = 1; i < cards.length; i++) {
    const current = cards[i];
    const currentDeal = current?.deal;
    if (!current || !currentDeal) continue;
    const twin = cards.slice(0, i).find((other) => {
      const otherDeal = other.deal;
      return otherDeal !== null && otherDeal !== undefined && sameVector(otherDeal, currentDeal);
    });
    if (twin) cards[i] = { ...current, duplicateOf: twin.variant };
  }

  return cards;
}

/** Первый доступный вариант — для дефолтного выбора. */
export function defaultVariant(cards: VariantCard[]): Variant | null {
  return cards.find((card) => card.ok)?.variant ?? null;
}

/** Пояснение покрытия докупок (§4.6). */
export function coverageText(card: VariantCard, reserveStacks: number): string {
  const { coveredStacks, stillInBank } = card.coverage;
  if (coveredStacks < reserveStacks) {
    return `Резерв ${reserveStacks} не покрывается: банк выдержит ${coveredStacks}`;
  }
  return `В банке останется ${stillInBank} — хватит на ${coveredStacks} докупок`;
}

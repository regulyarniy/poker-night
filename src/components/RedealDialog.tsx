/**
 * Пересдача в игре (docs/SPEC.md §6.7, Q122).
 *
 * Доступна, только пока журнал состоит из `deal`-событий. Меняется вектор
 * раздачи, состав игроков и настройки остаются замороженными.
 */

import { useEffect, useState } from 'preact/hooks';
import { formatChips } from '../core/money';
import { planDeals, vectorToText } from '../core/planner';
import type { Deal, Game, Variant } from '../core/types';
import { Modal } from './Modal';

export type RedealDialogProps = {
  game: Game | null;
  onClose: () => void;
  onApply: (deal: Deal) => void;
};

const VARIANT_NAMES: Record<Variant, string> = {
  balanced: 'Balanced',
  economy: 'Economy',
  speed: 'Speed',
};

export function RedealDialog({ game, onClose, onApply }: RedealDialogProps) {
  const [variant, setVariant] = useState<Variant>('balanced');

  useEffect(() => {
    if (game) setVariant(game.deal.variant);
  }, [game]);

  const cards = game
    ? planDeals({
        denominations: game.denominations.map((d) => ({ value: d.value, count: d.count })),
        players: game.players.length,
        stackCoins: game.stackCoins,
        rate: game.rate,
        multipleK: game.multipleK,
        reserveStacks: game.reserveStacks,
      })
    : [];
  const chosen = cards.find((card) => card.variant === variant && card.ok) ?? null;

  return (
    <Modal open={game !== null} onClose={onClose} label="Пересдача">
      {game ? (
        <>
          <h2 class="drawer__title">Пересдача</h2>
          <p class="small muted" style={{ margin: 0 }}>
            Настройки остаются прежними. Журнал содержит только раздачу, поэтому её можно заменить.
          </p>
          <div class="stack" style={{ gap: '8px' }}>
            {cards.map((card) => (
              <button
                type="button"
                key={card.variant}
                class="variant"
                aria-pressed={variant === card.variant && card.ok}
                disabled={!card.ok}
                onClick={() => setVariant(card.variant)}
              >
                <span class="variant__head">
                  <span class="variant__name">{VARIANT_NAMES[card.variant]}</span>
                  <span class="variant__vector">
                    {card.ok ? vectorToText(card.deal?.perPlayer ?? []) : (card.reason ?? '—')}
                  </span>
                </span>
                <span class="variant__stats">
                  <span>{formatChips(card.chipsPerPlayer)} фишек</span>
                  {card.levelNote ? <span>{card.levelNote}</span> : null}
                </span>
              </button>
            ))}
          </div>
          <div class="row">
            <button type="button" class="btn" onClick={onClose}>
              Отмена
            </button>
            <span class="spacer" />
            <button
              type="button"
              class="btn btn--primary"
              disabled={!chosen?.deal}
              onClick={() => {
                if (chosen?.deal) onApply({ ...chosen.deal, variant: chosen.variant });
              }}
            >
              Пересдать
            </button>
          </div>
        </>
      ) : null}
    </Modal>
  );
}

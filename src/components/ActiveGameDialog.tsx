/**
 * Диалог «есть незавершённая игра» (docs/SPEC.md §8.3).
 *
 * Три варианта вместо системного `confirm`: [Завершить её] [Оставить в истории
 * и начать новую] [Отмена]. Первый переводит текущую игру в архив через
 * мини-игру, второй — в `finished` без неё (Q82/Q86).
 */

import { X } from 'lucide-preact';
import type { Game } from '../core/types';
import { Badge } from '../ui/kit';
import { Modal } from './Modal';

export type ActiveGameChoice = 'archive' | 'keep' | 'cancel';

export function ActiveGameDialog({
  game,
  onChoose,
}: {
  game: Game | null;
  onChoose: (choice: ActiveGameChoice) => void;
}) {
  return (
    <Modal open={game !== null} onClose={() => onChoose('cancel')} label="Незавершённая игра">
      {game ? (
        <>
          <div class="row row--between">
            <h2 class="drawer__title">Незавершённая игра</h2>
            <Badge tone="gold">идёт</Badge>
          </div>
          <p class="small muted" style={{ margin: 0 }}>
            «{game.name}» ещё не завершена. Что с ней сделать?
          </p>
          <div class="drawer__actions">
            <button type="button" class="btn btn--primary" onClick={() => onChoose('archive')}>
              Завершить её
            </button>
            <button type="button" class="btn" onClick={() => onChoose('keep')}>
              Оставить в истории и начать новую
            </button>
            <button type="button" class="btn btn--ghost" onClick={() => onChoose('cancel')}>
              Отмена
            </button>
          </div>
          <p class="tiny muted" style={{ margin: 0 }}>
            Завершение требует мини-игру подтверждения. «Оставить в истории» закроет игру без неё.
          </p>
        </>
      ) : (
        <button
          type="button"
          class="btn btn--icon"
          aria-label="Закрыть"
          onClick={() => onChoose('cancel')}
        >
          <X size={20} aria-hidden="true" />
        </button>
      )}
    </Modal>
  );
}

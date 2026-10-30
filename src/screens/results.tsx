/**
 * Итоги `/game/:id/results` (docs/SPEC.md §5.6, §6.5, §6.9).
 *
 * Топ, таблица, сверка, финальные остатки, архив с мини-игрой и шеринг.
 */

import { Archive, ChevronDown, Share2, Undo2, X } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { ArchiveGate } from '../components/ArchiveGate';
import { Modal } from '../components/Modal';
import { Screen, TopBar } from '../components/Screen';
import { formatShortDateTime, playersLabel } from '../core/datetime';
import {
  canRedeal,
  nextEventId,
  removeEvent,
  setFinalStack,
  setStatus,
  undoLast,
  updateEventChips,
} from '../core/game';
import { formatChips, formatSignedChips, formatSignedCoins } from '../core/money';
import { canEncodeLinks, encodePayload, payloadFromGame } from '../core/payload';
import { gameTotals, topPlayer } from '../core/totals';
import type { Game } from '../core/types';
import { validatePlayers } from '../core/validate';
import { absoluteUrl, navigate } from '../router';
import { peekGame } from '../state/store';
import { useGame } from '../state/use-game';
import { Badge, Banner, cx, showToast, tap } from '../ui/kit';
import { RollUp } from '../ui/motion';

export function ResultsScreen({ id }: { id: string }) {
  const { game, missing, update } = useGame(id);
  const [gate, setGate] = useState(false);
  const [shareLink, setShareLink] = useState<string | null>(null);

  // Клон из истории: `/new?clone=:id` читает игру отдельно.
  useEffect(() => () => setShareLink(null), []);

  if (missing) {
    return (
      <>
        <TopBar title="Игра не найдена" back="/" />
        <Screen>
          <div class="empty">
            <p class="h2">Игра не найдена</p>
            <button type="button" class="btn btn--primary" onClick={() => navigate('/')}>
              На главную
            </button>
          </div>
        </Screen>
      </>
    );
  }

  if (!game) {
    return (
      <>
        <TopBar title="Итоги" back="/" />
        <Screen>
          <div class="empty">Загрузка…</div>
        </Screen>
      </>
    );
  }

  // После проверки на null — стабильная ссылка для вложенных обработчиков:
  // TS не переносит сужение в замыкания, а `current` уже точно `Game`.
  const current: Game = game;
  const readonly = current.status === 'archived';
  const totals = gameTotals(current);
  const winner = topPlayer(totals);
  const preliminary = totals.uncoveredCount > 0;

  /**
   * Изменение считается от **актуальной** версии игры, а не от снимка
   * этого рендера: несколько остатков подряд вводятся быстрее, чем
   * перерисовка, и обязаны все попасть в журнал.
   */
  const commit = (change: (game: Game) => Game): void => {
    tap();
    void update(change);
  };

  function setStack(playerId: string, chips: number): void {
    const now = new Date().toISOString();
    commit((game) => setFinalStack(game, playerId, chips, now, nextEventId(game)));
  }

  function finishGame(): void {
    if (totals.uncoveredCount > 0) {
      const ok = window.confirm(
        `У ${totals.uncoveredCount} из ${current.players.length} игроков остаток не зафиксирован. Всё равно завершить?`,
      );
      if (!ok) return;
    }
    commit((game) => setStatus(game, 'archived', new Date().toISOString()));
  }

  async function share(): Promise<void> {
    if (!canEncodeLinks()) {
      showToast('Ссылки недоступны в этом браузере', 'warn');
      return;
    }
    try {
      const payload = payloadFromGame(current, gameTotals(current));
      const encoded = await encodePayload(payload);
      const url = absoluteUrl(`/share/${encoded}`);
      setShareLink(url);
      if (navigator.share) {
        try {
          await navigator.share({ title: current.name, url });
          return;
        } catch {
          // пользователь закрыл шит — оставляем ссылку на экране
        }
      }
      await navigator.clipboard?.writeText(url);
      tap();
      showToast('Ссылка скопирована', 'ok');
    } catch {
      showToast('Не удалось создать ссылку', 'danger');
    }
  }

  function markFinished(): void {
    if (totals.uncoveredCount > 0) {
      const ok = window.confirm(
        `У ${totals.uncoveredCount} из ${current.players.length} игроков остаток не зафиксирован. Завершить?`,
      );
      if (!ok) return;
    }
    commit((game) => setStatus(game, 'finished'));
  }

  return (
    <>
      <TopBar
        title="Итоги"
        back={`/game/${current.id}`}
        action={
          current.status === 'active' ? { label: 'Завершить', onClick: markFinished } : undefined
        }
      />
      <Screen>
        <div class="tiny muted">
          {formatShortDateTime(current.createdAt)} · {playersLabel(current.players.length)} · стек{' '}
          {formatChips(current.stackChips)}
        </div>

        {winner ? (
          <div class="top-winner">
            <span class="top-winner__label">Лучший результат</span>
            <span class="top-winner__name">{winner.name}</span>
            <span class="top-winner__value">
              <RollUp value={winner.netCoins} format={(n) => formatSignedCoins(Math.round(n))} />{' '}
              монет
            </span>
            <span class="tiny muted">
              фишек:{' '}
              <RollUp value={winner.netChips} format={(n) => formatSignedChips(Math.round(n))} />
            </span>
          </div>
        ) : (
          <div class="panel panel--flat">
            <p class="small muted" style={{ margin: 0 }}>
              {preliminary ? 'Итоги предварительные — остатки не у всех' : 'Все при своих'}
            </p>
          </div>
        )}

        <section class="panel panel--flat">
          <table class="table">
            <thead>
              <tr>
                <th>Игрок</th>
                <th>На руках</th>
                <th>Куплено</th>
                <th>Фишки</th>
                <th>Монеты</th>
              </tr>
            </thead>
            <tbody>
              {totals.players.map((row) => (
                <tr key={row.playerId}>
                  <td class="table__name">{row.name}</td>
                  <td class="numeric">{formatChips(row.chipsOnHand)}</td>
                  <td class="numeric">{formatChips(row.boughtChips)}</td>
                  <td class={cx('numeric', netClass(row.netChips))}>
                    {formatSignedChips(row.netChips)}
                  </td>
                  <td class={cx('numeric', netClass(row.netChips))}>
                    {formatSignedCoins(row.netCoins)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <div class="panel panel--flat stack" style={{ gap: '6px' }}>
          <div class="spread small">
            <span class="muted">Выдано</span>
            <span class="numeric">
              {formatChips(
                totals.reconciled ? totals.bankRemainingChips + dealtOf(current) : dealtOf(current),
              )}{' '}
              из {formatChips(bankTotal(current))}
            </span>
          </div>
          <div class="spread small">
            <span class="muted">В банке</span>
            <span class="numeric">{formatChips(totals.bankRemainingChips)}</span>
          </div>
          <div class="spread small">
            <span class="muted">Сверка</span>
            {totals.reconciled ? (
              <Badge tone="ok">сходится</Badge>
            ) : (
              <Badge tone="danger">
                не сходится на {formatChips(Math.abs(totals.sumNetChips))}
              </Badge>
            )}
          </div>
          {preliminary ? (
            <div class="spread small">
              <span class="muted">Без остатка</span>
              <span class="numeric">{totals.uncoveredCount}</span>
            </div>
          ) : null}
        </div>

        <section class="block">
          <div class="block__head">
            <span class="block__title">Финальные остатки</span>
            {preliminary ? (
              <Badge tone="warn">не у всех</Badge>
            ) : (
              <Badge tone="ok">заполнено</Badge>
            )}
          </div>
          <div class="block__body">
            {totals.players.map((row) => (
              <div class="row" key={row.playerId}>
                <span class="player__name">{row.name}</span>
                <input
                  class="input input--sm input--num"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  value={row.finalChips ?? ''}
                  placeholder="—"
                  aria-label={`Финальный остаток: ${row.name}`}
                  disabled={readonly}
                  onInput={(event) => {
                    const value = Number.parseInt(event.currentTarget.value, 10);
                    if (Number.isFinite(value)) setStack(row.playerId, value);
                  }}
                />
                {row.finalChips === null ? (
                  <span class="tiny muted">не зафиксирован</span>
                ) : (
                  <span class="tiny numeric muted">{formatSignedChips(row.netChips)}</span>
                )}
              </div>
            ))}
          </div>
        </section>

        <section class="block">
          <details open={false}>
            <summary>
              <span class="block__title">Журнал событий</span>
              <span class="tiny muted">{current.events.length}</span>
              <ChevronDown size={18} class="block__chevron" aria-hidden="true" />
            </summary>
            <div class="block__body">
              {current.events.length === 0 ? <p class="small muted">Событий нет</p> : null}
              {current.events.map((event) => {
                const owner =
                  event.type === 'external'
                    ? `${nameOf(current, event.fromId)} → ${nameOf(current, event.toId)}`
                    : nameOf(current, event.playerId);
                return (
                  <div class="row" key={event.id}>
                    <span class="tiny muted" style={{ width: '92px' }}>
                      {event.type}
                    </span>
                    <span class="small" style={{ flex: 1, minWidth: 0 }}>
                      {owner}
                    </span>
                    <input
                      class="input input--sm input--num"
                      type="number"
                      inputMode="numeric"
                      min="0"
                      value={event.chips}
                      aria-label={`Сумма события ${event.id}`}
                      disabled={readonly}
                      onInput={(inputEvent) => {
                        const value = Number.parseInt(inputEvent.currentTarget.value, 10);
                        if (!Number.isFinite(value)) return;
                        commit((current) => updateEventChips(current, event.id, value));
                      }}
                    />
                    <button
                      type="button"
                      class="btn btn--icon"
                      aria-label="Удалить событие"
                      disabled={readonly}
                      onClick={() => commit((current) => removeEvent(current, event.id))}
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
              <div class="row">
                <button
                  type="button"
                  class="btn btn--sm"
                  disabled={readonly || current.events.length === 0}
                  onClick={() => commit((current) => undoLast(current))}
                >
                  <Undo2 size={16} aria-hidden="true" /> Отменить последнее
                </button>
                {canRedeal(current) ? <Badge tone="gold">доступна пересдача</Badge> : null}
              </div>
            </div>
          </details>
        </section>

        {shareLink ? (
          <div class="panel panel--flat stack">
            <span class="h3">Ссылка</span>
            <input class="input input--sm" readOnly value={shareLink} aria-label="Ссылка" />
            <button
              type="button"
              class="btn btn--sm"
              onClick={() => {
                void navigator.clipboard?.writeText(shareLink);
                showToast('Ссылка скопирована', 'ok');
              }}
            >
              Скопировать
            </button>
          </div>
        ) : null}

        <div class="stack">
          {game.status !== 'archived' ? (
            <button
              type="button"
              class="btn btn--primary btn--lg btn--block"
              disabled={!validatePlayers(current.players).ok}
              onClick={() => setGate(true)}
            >
              <Archive size={18} aria-hidden="true" /> В архив
            </button>
          ) : null}

          <button
            type="button"
            class="btn btn--block"
            disabled={current.status === 'active' || !canEncodeLinks()}
            onClick={() => void share()}
          >
            <Share2 size={18} aria-hidden="true" /> Поделиться
          </button>

          {current.status === 'active' ? (
            <p class="tiny muted" style={{ margin: 0 }}>
              Поделиться можно после завершения игры
            </p>
          ) : null}

          <button type="button" class="btn btn--block" onClick={() => void cloneIntoNew(current)}>
            Новая игра с этими настройками
          </button>
        </div>

        {readonly ? <Banner tone="warn">Игра в архиве — только чтение</Banner> : null}
      </Screen>

      <Modal
        open={gate}
        onClose={() => setGate(false)}
        label="Подтверждение архивации"
        variant="full"
      >
        <ArchiveGate
          onSuccess={() => {
            setGate(false);
            finishGame();
          }}
          onCancel={() => setGate(false)}
        />
      </Modal>
    </>
  );
}

async function cloneIntoNew(game: Game): Promise<void> {
  const fresh = (await peekGame(game.id)) ?? game;
  navigate(`/new?clone=${encodeURIComponent(fresh.id)}`);
}

function dealtOf(game: Game): number {
  return game.events.reduce(
    (acc: number, event) => (event.type === 'deal' ? acc + event.chips : acc),
    0,
  );
}

function bankTotal(game: Game): number {
  return game.denominations.reduce((acc, d) => acc + Math.max(0, d.count) * d.value, 0);
}

function nameOf(game: Game, playerId: string): string {
  return game.players.find((p) => p.id === playerId)?.name ?? '—';
}

function netClass(value: number): string {
  if (value > 0) return 'positive';
  if (value < 0) return 'negative';
  return '';
}

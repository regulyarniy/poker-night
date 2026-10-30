/**
 * История `/history` (docs/SPEC.md §5.7).
 *
 * Группировка по месяцам, новые сверху, шит действий: открыть, поделиться,
 * клон, удаление с двойным подтверждением.
 */

import { useEffect, useState } from 'preact/hooks';
import { Modal } from '../components/Modal';
import { Screen, TopBar } from '../components/Screen';
import { formatMonth, formatShortDateTime, monthKey, playersLabel } from '../core/datetime';
import { setStatus } from '../core/game';
import { formatSignedCoins } from '../core/money';
import { canEncodeLinks, encodePayload, payloadFromGame } from '../core/payload';
import { gameTotals } from '../core/totals';
import type { Game } from '../core/types';
import { absoluteUrl, navigate } from '../router';
import { dropGame, games, loadGame, persistGame, refreshGames } from '../state/store';
import { Badge, cx, showToast, tap } from '../ui/kit';

type Group = { key: string; title: string; items: Game[] };

function groupByMonth(list: Game[]): Group[] {
  const groups = new Map<string, Group>();
  for (const game of list) {
    const key = monthKey(game.createdAt);
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(game);
    } else {
      groups.set(key, { key, title: formatMonth(game.createdAt), items: [game] });
    }
  }
  return [...groups.values()];
}

export function HistoryScreen() {
  const [active, setActive] = useState<Game | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    void refreshGames();
  }, []);

  const groups = groupByMonth(games.value);

  async function openSheet(game: Game): Promise<void> {
    const fresh = await loadGame(game.id);
    setActive(fresh ?? game);
    tap();
  }

  async function share(game: Game): Promise<void> {
    if (!canEncodeLinks()) {
      showToast('Ссылки недоступны в этом браузере', 'warn');
      return;
    }
    try {
      const totals = gameTotals(game);
      const encoded = await encodePayload(payloadFromGame(game, totals));
      const url = absoluteUrl(`/share/${encoded}`);
      if (navigator.share) {
        try {
          await navigator.share({ title: game.name, url });
          setActive(null);
          return;
        } catch {
          // отмена шита — продолжаем копированием
        }
      }
      await navigator.clipboard?.writeText(url);
      showToast('Ссылка скопирована', 'ok');
      setActive(null);
    } catch {
      showToast('Не удалось создать ссылку', 'danger');
    }
  }

  async function remove(game: Game): Promise<void> {
    if (confirmId !== game.id) {
      setConfirmId(game.id);
      showToast('Нажмите «Удалить» ещё раз', 'warn');
      return;
    }
    await dropGame(game.id);
    await refreshGames();
    setActive(null);
    setConfirmId(null);
    showToast('Игра удалена', 'ok');
  }

  return (
    <>
      <TopBar title="История" back="/" />
      <Screen>
        {games.value.length === 0 ? (
          <div class="empty">
            <p class="h2">Пока пусто</p>
            <p class="small">Сыграйте первую игру</p>
            <button type="button" class="btn btn--primary" onClick={() => navigate('/new')}>
              Новая игра
            </button>
          </div>
        ) : null}

        {groups.map((group) => (
          <section key={group.key} class="stack" style={{ gap: '6px' }}>
            <h2 class="history__month">{group.title}</h2>
            {group.items.map((game) => {
              const totals = gameTotals(game);
              return (
                <div class="row" key={game.id} style={{ gap: '6px' }}>
                  <button type="button" class="history__item" onClick={() => void openSheet(game)}>
                    <span class="history__col">
                      <span class="history__date">{formatShortDateTime(game.createdAt)}</span>
                      <span class="history__meta">
                        {playersLabel(game.players.length)} ·{' '}
                        {formatSignedCoins(totals.sumNetChips === 0 ? topCoins(game) : 0)}
                      </span>
                    </span>
                    {game.status === 'archived' ? (
                      <Badge>архив</Badge>
                    ) : game.status === 'finished' ? (
                      <Badge tone="gold">завершена</Badge>
                    ) : (
                      <Badge tone="ok">идёт</Badge>
                    )}
                  </button>
                </div>
              );
            })}
          </section>
        ))}
      </Screen>

      <Modal open={active !== null} onClose={() => setActive(null)} label="Действия с игрой">
        {active ? (
          <>
            <div class="row row--between">
              <h2 class="drawer__title">{active.name}</h2>
              <Badge>{active.status === 'archived' ? 'архив' : active.status}</Badge>
            </div>
            <div class="drawer__actions">
              <button
                type="button"
                class="btn"
                onClick={() => navigate(`/game/${active.id}/results`)}
              >
                Открыть
              </button>
              <button
                type="button"
                class="btn"
                disabled={active.status === 'active' || !canEncodeLinks()}
                onClick={() => void share(active)}
              >
                Поделиться
              </button>
              <button
                type="button"
                class="btn"
                onClick={() => navigate(`/new?clone=${encodeURIComponent(active.id)}`)}
              >
                Новая игра с этими настройками
              </button>
              {active.status === 'active' ? (
                <button
                  type="button"
                  class="btn"
                  onClick={() => {
                    void persistGame(setStatus(active, 'finished'));
                    setActive(null);
                    showToast('Игра завершена', 'ok');
                  }}
                >
                  Завершить
                </button>
              ) : null}
              <button
                type="button"
                class={cx('btn', confirmId === active.id ? 'btn--danger' : 'btn--ghost')}
                onClick={() => void remove(active)}
              >
                {confirmId === active.id ? 'Точно удалить' : 'Удалить'}
              </button>
              <button type="button" class="btn btn--ghost" onClick={() => setActive(null)}>
                Отмена
              </button>
            </div>
          </>
        ) : null}
      </Modal>
    </>
  );
}

function topCoins(game: Game): number {
  const totals = gameTotals(game);
  const values = totals.players.map((p) => p.netCoins).filter((coins) => coins > 0);
  return values.length === 0 ? 0 : Math.max(...values);
}

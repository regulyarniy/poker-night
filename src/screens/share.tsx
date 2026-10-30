/**
 * Публичные итоги `/share/:payload` (docs/SPEC.md §5.8, §9).
 *
 * Read-only карточка: тот же «топ + таблица», плюс дата, стек, курс, блайнды.
 * При ошибке декодирования — вежливый экран (§12.3, §12.18).
 */

import { Copy, Share2 } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { Screen, TopBar } from '../components/Screen';
import { formatShortDateTime } from '../core/datetime';
import { formatChips, formatCoins, formatSignedCoins } from '../core/money';
import {
  type DecodeResult,
  decodePayload,
  type PublicResults,
  resultsFromPayload,
} from '../core/payload';
import { absoluteUrl, navigate } from '../router';
import { Badge, cx, showToast, tap } from '../ui/kit';

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready'; results: PublicResults }
  | { phase: 'error'; reason: 'corrupt' | 'unsupported' | 'newer' };

/** `navigator.share` есть не везде — кнопка показывается только с ним. */
function canShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

export function ShareScreen({ payload }: { payload: string }) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ phase: 'loading' });
    void (async () => {
      const decoded: DecodeResult = await decodePayload(payload);
      if (cancelled) return;
      if (decoded.ok) setState({ phase: 'ready', results: resultsFromPayload(decoded.payload) });
      else setState({ phase: 'error', reason: decoded.reason });
    })();
    return () => {
      cancelled = true;
    };
  }, [payload]);

  if (state.phase === 'loading') {
    return (
      <>
        <TopBar title="Итоги вечера" back={false} />
        <Screen>
          <div class="empty">Декодируем…</div>
        </Screen>
      </>
    );
  }

  if (state.phase === 'error') {
    const message =
      state.reason === 'unsupported'
        ? 'Ссылка создана в браузере, который не поддерживается этим устройством'
        : state.reason === 'newer'
          ? 'Ссылка новее приложения — обновите страницу'
          : 'Ссылка повреждена или неполная';
    return (
      <>
        <TopBar title="Итоги вечера" back={false} />
        <Screen>
          <div class="empty">
            <p class="h2">{message}</p>
            <button type="button" class="btn btn--primary" onClick={() => navigate('/')}>
              На главную
            </button>
          </div>
        </Screen>
      </>
    );
  }

  const { results } = state;
  const winner = results.rows.reduce<PublicResults['rows'][number] | null>((best, row) => {
    if (row.netChips <= 0) return best;
    if (!best || row.netChips > best.netChips) return row;
    return best;
  }, null);
  const url = absoluteUrl(`/share/${payload}`);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard?.writeText(url);
      tap();
      showToast('Ссылка скопирована', 'ok');
    } catch {
      showToast('Не удалось скопировать', 'danger');
    }
  }

  async function share(): Promise<void> {
    try {
      await navigator.share?.({ title: 'Poker Night', url });
    } catch {
      // пользователь отменил — не ошибка
    }
  }

  return (
    <>
      <TopBar title="Итоги вечера" back={false} />
      <Screen>
        <div class="tiny muted">
          {formatShortDateTime(results.date)} · стек {formatChips(results.stackCoins)} монет · курс{' '}
          {results.rate} · блайнды {results.smallBlindChips}/{results.smallBlindChips * 2}
        </div>

        {winner ? (
          <div class="top-winner">
            <span class="top-winner__label">Лучший результат</span>
            <span class="top-winner__name">{winner.name}</span>
            <span class="top-winner__value">{formatSignedCoins(winner.netCoins)} монет</span>
          </div>
        ) : (
          <div class="panel panel--flat">
            <p class="small muted" style={{ margin: 0 }}>
              Все при своих
            </p>
          </div>
        )}

        <section class="panel panel--flat">
          <table class="table">
            <thead>
              <tr>
                <th>Игрок</th>
                <th>Остаток</th>
                <th>Куплено</th>
                <th>Монеты</th>
              </tr>
            </thead>
            <tbody>
              {results.rows.map((row, index) => (
                <tr key={`${row.name}-${index}`}>
                  <td class="table__name">{row.name}</td>
                  <td class="numeric">
                    {row.finalChips === null ? (
                      <span class="tiny muted">не зафиксирован</span>
                    ) : (
                      formatChips(row.finalChips)
                    )}
                  </td>
                  <td class="numeric">{formatChips(row.boughtChips)}</td>
                  <td
                    class={cx(
                      'numeric',
                      row.netChips > 0 ? 'positive' : row.netChips < 0 ? 'negative' : '',
                    )}
                  >
                    {formatSignedCoins(row.netCoins)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <div class="row">
          <Badge tone={results.reconciled ? 'ok' : 'warn'}>
            {results.reconciled
              ? 'сходится'
              : `не сходится на ${formatCoins(Math.abs(results.sumNetChips * 100))} монет`}
          </Badge>
          <span class="spacer" />
          <span class="tiny muted">только чтение</span>
        </div>

        <div class="stack">
          <button type="button" class="btn btn--block" onClick={() => void copy()}>
            <Copy size={18} aria-hidden="true" /> Скопировать ссылку
          </button>
          {canShare() ? (
            <button type="button" class="btn btn--block" onClick={() => void share()}>
              <Share2 size={18} aria-hidden="true" /> Поделиться
            </button>
          ) : null}
        </div>
      </Screen>
    </>
  );
}

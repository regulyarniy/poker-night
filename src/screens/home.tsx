/**
 * Главное меню `/` (docs/SPEC.md §5.3).
 */

import { Clock, ListOrdered, Settings2, Sparkles } from 'lucide-preact';
import { Screen, TopBar } from '../components/Screen';
import { formatShortDateTime, playersLabel } from '../core/datetime';
import { formatChips } from '../core/money';
import { gameTotals } from '../core/totals';
import { navigate } from '../router';
import { activeGame, storageOk } from '../state/store';
import { Banner } from '../ui/kit';

export function HomeScreen() {
  const active = activeGame.value;
  const totals = active ? gameTotals(active) : null;

  return (
    <Screen>
      <header class="stack" style={{ paddingTop: '8px' }}>
        <h1 class="h1">Poker Night</h1>
        <p class="muted small" style={{ margin: 0 }}>
          Фишки, докупки и итоги вечера
        </p>
      </header>

      {!storageOk.value ? (
        <Banner tone="warn">Данные не сохраняются — браузер не даёт доступ к хранилищу</Banner>
      ) : null}

      {active && totals ? (
        <section class="panel panel--flat stack">
          <div class="row row--between">
            <span class="tiny muted">Незавершённая игра</span>
            <span class="tiny numeric gold">{formatChips(totals.bankRemainingChips)} в банке</span>
          </div>
          <div class="spread">
            <strong style={{ fontSize: '17px' }}>{active.name}</strong>
            <span class="tiny muted">{playersLabel(active.players.length)}</span>
          </div>
          <div class="tiny muted">{formatShortDateTime(active.createdAt)}</div>
        </section>
      ) : null}

      <nav class="menu">
        <button
          type="button"
          class="menu__item menu__item--primary"
          onClick={() => navigate('/new')}
        >
          <span class="menu__icon">
            <Sparkles size={20} aria-hidden="true" />
          </span>
          <span class="menu__label">Новая игра</span>
        </button>

        {active ? (
          <button type="button" class="menu__item" onClick={() => navigate(`/game/${active.id}`)}>
            <span class="menu__icon">
              <Clock size={20} aria-hidden="true" />
            </span>
            <span class="menu__label">Продолжить: {active.name}</span>
          </button>
        ) : null}

        <button type="button" class="menu__item" onClick={() => navigate('/history')}>
          <span class="menu__icon">
            <ListOrdered size={20} aria-hidden="true" />
          </span>
          <span class="menu__label">История</span>
        </button>

        <button type="button" class="menu__item" onClick={() => navigate('/settings')}>
          <span class="menu__icon">
            <Settings2 size={20} aria-hidden="true" />
          </span>
          <span class="menu__label">Набор и дефолты</span>
        </button>
      </nav>
    </Screen>
  );
}

/** Заголовок для экрана 404 — используется в app.tsx. */
export function NotFoundScreen() {
  return (
    <>
      <TopBar title="Страница не найдена" back="/" />
      <Screen>
        <div class="empty">
          <p class="h2">Страница не найдена</p>
          <p class="small">Такого адреса нет</p>
          <button type="button" class="btn btn--primary" onClick={() => navigate('/')}>
            На главную
          </button>
        </div>
      </Screen>
    </>
  );
}

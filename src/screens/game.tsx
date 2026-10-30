/**
 * Экран активной игры `/game/:id` (docs/SPEC.md §5.5, §6).
 *
 * Липкая панель банка, строки игроков 44 px, докупка и шторка игрока.
 * Все производные величины считаются из журнала на каждой отрисовке.
 */

import { ChevronRight, Coins, Plus, X } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Modal } from '../components/Modal';
import { RedealDialog } from '../components/RedealDialog';
import { Screen, TopBar } from '../components/Screen';
import { formatShortDateTime, playersLabel, toIsoLocal } from '../core/datetime';
import {
  addBuyin,
  addExternal,
  addPlayer,
  canRedeal,
  nextEventId,
  redeal as redealGame,
  removeEvent,
  setCashout,
  setFinalStack,
  undoLast,
  updateEventChips,
} from '../core/game';
import { formatChips } from '../core/money';
import { bankState, derivePlayers, eventsForPlayer } from '../core/totals';
import type { Game, GameEvent, PlayerState } from '../core/types';
import { clampName, validateExternal, validatePlayers } from '../core/validate';
import { navigate } from '../router';
import { useGame } from '../state/use-game';
import { Badge, Banner, cx, Field, showToast, tap } from '../ui/kit';
import { flyChip, RollUp } from '../ui/motion';

export function GameScreen({ id }: { id: string }) {
  const { game, missing, update } = useGame(id);
  const [openPlayerId, setOpenPlayerId] = useState<string | null>(null);
  const [redeal, setRedeal] = useState(false);
  const bankRef = useRef<HTMLDivElement>(null);

  if (missing) {
    return (
      <>
        <TopBar title="Игра не найдена" back="/" />
        <Screen>
          <div class="empty">
            <p class="h2">Игра не найдена</p>
            <p class="small">Возможно, она удалена</p>
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
        <TopBar title="Игра" back="/" />
        <Screen>
          <div class="empty">Загрузка…</div>
        </Screen>
      </>
    );
  }

  const current: Game = game;
  const readonly = current.status === 'archived';
  const states = derivePlayers(current);
  const bank = bankState(current);
  const openPlayer = openPlayerId
    ? (states.find((player) => player.id === openPlayerId) ?? null)
    : null;

  /** Изменение всегда считается от актуального журнала, а не от снимка рендера. */
  function commit(change: (game: Game) => Game): void {
    tap();
    void update(change);
  }

  function stamp(): string {
    return toIsoLocal(new Date());
  }

  function buyin(playerId: string, source?: Element | null): void {
    const now = stamp();
    commit((game) => addBuyin(game, playerId, now, nextEventId(game)));
    // FLIP-перелёт фишки от кнопки к панели банка (§11.2).
    void flyChip(source ?? null, bankRef.current);
  }

  function cashout(playerId: string, chips: number): void {
    const now = stamp();
    commit((game) => setCashout(game, playerId, chips, now, nextEventId(game)));
  }

  function finalStack(playerId: string, chips: number): void {
    const now = stamp();
    commit((game) => setFinalStack(game, playerId, chips, now, nextEventId(game)));
  }

  function external(fromId: string, toId: string): void {
    const check = validateExternal(fromId, toId, current.players);
    if (!check.ok) {
      showToast(check.errors[0] ?? 'Ошибка', 'danger');
      return;
    }
    const now = stamp();
    commit((game) => addExternal(game, fromId, toId, now, nextEventId(game)));
  }

  function addNewPlayer(name: string): void {
    const trimmed = clampName(name.trim());
    if (trimmed.length === 0) {
      showToast('Пустое имя', 'danger');
      return;
    }
    const names = [...current.players.map((player) => ({ name: player.name })), { name: trimmed }];
    const check = validatePlayers(names);
    if (!check.ok) {
      showToast(check.errors[0] ?? 'Ошибка', 'danger');
      return;
    }
    const player = { id: crypto.randomUUID(), name: trimmed };
    const now = stamp();
    commit((game) => addPlayer(game, player, now, nextEventId(game)));
    if (current.deal.chipsPerPlayer > bank.remaining) {
      showToast('В банке не хватает фишек', 'warn');
    }
  }

  return (
    <>
      <div class="bank" ref={bankRef}>
        <div class="bank__main">
          <span class="bank__label">Банк</span>
          <span class={cx('bank__value', bank.remaining < 0 && 'bank__value--negative')}>
            <RollUp value={bank.remaining} format={(n) => formatChips(n)} /> фишек ·{' '}
            <RollUp value={coinsOf(bank.remaining, current.rate)} format={(n) => formatChips(n)} />{' '}
            монет
          </span>
        </div>
        <div class="bank__side">
          {playersLabel(current.players.length)}
          <br />
          докупок: {bank.coveredStacks}
        </div>
      </div>

      <TopBar
        title={current.name}
        back="/"
        action={{
          label: 'Итоги',
          to: `/game/${current.id}/results`,
          accent: true,
        }}
      />

      <Screen>
        {bank.remaining < 0 ? (
          <Banner tone="danger">Банк в минусе на {formatChips(-bank.remaining)} фишек</Banner>
        ) : null}
        {readonly ? <Banner tone="warn">Игра в архиве — только чтение</Banner> : null}
        {!readonly && canRedeal(current) ? (
          <button type="button" class="btn btn--sm" onClick={() => setRedeal(true)}>
            Пересдать раздачу
          </button>
        ) : null}

        <section class="panel panel--flat" style={{ padding: '4px 10px' }}>
          {game.players.map((player, index) => {
            const state = states.find((s) => s.id === player.id);
            if (!state) return null;
            return (
              <div key={player.id} class={cx('player', state.out && 'player--out')}>
                <span class="player__dot" aria-hidden="true" />
                <span class="player__name">{player.name}</span>
                <span class="player__meta">
                  <span>{state.chips > 0 ? formatChips(state.chips) : '0'}</span>
                  {state.buyins > 0 ? <span>{state.buyins} стек</span> : null}
                  {state.externalIn + state.externalOut > 0 ? (
                    <span>{state.externalIn + state.externalOut} внешн.</span>
                  ) : null}
                </span>
                <span class="player__actions">
                  <button
                    type="button"
                    class="btn btn--icon"
                    aria-label={`Докупка: ${player.name}`}
                    disabled={readonly}
                    onClick={(event) => buyin(player.id, event.currentTarget)}
                  >
                    <Plus size={18} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    class="btn btn--icon"
                    aria-label={`Игрок: ${player.name}`}
                    onClick={() => setOpenPlayerId(player.id)}
                    data-player-index={index}
                  >
                    <ChevronRight size={18} aria-hidden="true" />
                  </button>
                </span>
              </div>
            );
          })}
        </section>

        {game.players.length < 12 ? (
          <AddPlayerRow onAdd={addNewPlayer} disabled={readonly} />
        ) : null}

        <button
          type="button"
          class="btn btn--block"
          onClick={() => navigate(`/game/${game.id}/results`)}
        >
          Итоги и остатки
        </button>
      </Screen>

      {openPlayer ? (
        <PlayerDrawer
          game={current}
          player={openPlayer}
          readonly={readonly}
          onClose={() => setOpenPlayerId(null)}
          onBuyin={() => buyin(openPlayer.id)}
          onCashout={(chips) => cashout(openPlayer.id, chips)}
          onFinalStack={(chips) => finalStack(openPlayer.id, chips)}
          onExternal={external}
          onCommit={(change) => commit(change)}
        />
      ) : null}

      <RedealDialog
        game={redeal ? current : null}
        onClose={() => setRedeal(false)}
        onApply={(deal) => {
          const now = stamp();
          commit((game) => redealGame(game, deal, now));
          setRedeal(false);
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Добавление игрока
// ---------------------------------------------------------------------------

function AddPlayerRow({ onAdd, disabled }: { onAdd: (name: string) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        class="btn btn--block"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Plus size={16} aria-hidden="true" /> Добавить игрока
      </button>
    );
  }

  return (
    <form
      class="row"
      onSubmit={(event) => {
        event.preventDefault();
        onAdd(name);
        setName('');
        setOpen(false);
      }}
    >
      <input
        ref={inputRef}
        class="input"
        value={name}
        maxLength={24}
        placeholder="Имя игрока"
        aria-label="Имя нового игрока"
        onInput={(event) => setName(event.currentTarget.value.slice(0, 24))}
      />
      <button type="submit" class="btn btn--sm btn--primary">
        Добавить
      </button>
      <button
        type="button"
        class="btn btn--icon"
        aria-label="Отмена"
        onClick={() => {
          setOpen(false);
          setName('');
        }}
      >
        <X size={18} aria-hidden="true" />
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Шторка игрока
// ---------------------------------------------------------------------------

type DrawerProps = {
  game: Game;
  player: PlayerState;
  readonly: boolean;
  onClose: () => void;
  onBuyin: () => void;
  onCashout: (chips: number) => void;
  onFinalStack: (chips: number) => void;
  onExternal: (fromId: string, toId: string) => void;
  onCommit: (change: (game: Game) => Game) => void;
};

type DrawerMode = 'main' | 'cashout' | 'final' | 'external' | 'journal';

function PlayerDrawer(props: DrawerProps) {
  const { game, player, readonly, onClose } = props;
  const [mode, setMode] = useState<DrawerMode>('main');

  return (
    <Modal open onClose={onClose} label={`Игрок ${player.name}`}>
      <div class="row row--between">
        <h2 class="drawer__title">{player.name}</h2>
        <button type="button" class="btn btn--icon" aria-label="Закрыть" onClick={onClose}>
          <X size={20} aria-hidden="true" />
        </button>
      </div>

      <div class="panel panel--flat">
        <div class="spread">
          <span class="small muted">На руках</span>
          <strong class="numeric">{formatChips(player.chips)}</strong>
        </div>
        <div class="spread">
          <span class="small muted">Куплено стеков</span>
          <strong class="numeric">{1 + player.buyins + player.externalIn}</strong>
        </div>
        <div class="spread">
          <span class="small muted">Внешних получено / отдано</span>
          <strong class="numeric">
            {player.externalIn} / {player.externalOut}
          </strong>
        </div>
        <div class="spread">
          <span class="small muted">Итог, фишек</span>
          <strong class={cx('numeric', netClass(player.netChips))}>
            {formatSigned(player.netChips)}
          </strong>
        </div>
      </div>

      {mode === 'main' ? (
        <div class="drawer__actions">
          <button type="button" class="btn" disabled={readonly} onClick={() => props.onBuyin()}>
            Докупка · +{formatChips(game.stackChips)}
          </button>
          <button type="button" class="btn" disabled={readonly} onClick={() => setMode('cashout')}>
            Вышел из игры
          </button>
          <button type="button" class="btn" disabled={readonly} onClick={() => setMode('external')}>
            Внешняя докупка
          </button>
          <button type="button" class="btn" disabled={readonly} onClick={() => setMode('final')}>
            Финальный остаток
          </button>
          <button type="button" class="btn" onClick={() => setMode('journal')}>
            Журнал игрока
          </button>
        </div>
      ) : null}

      {mode === 'cashout' ? (
        <NumberPrompt
          label="Сколько осталось фишек"
          initial={player.chips}
          hint="Фишки вернутся в банк, выход не отменяется"
          onCancel={() => setMode('main')}
          onSubmit={(value) => {
            props.onCashout(value);
            setMode('main');
          }}
        />
      ) : null}

      {mode === 'final' ? (
        <NumberPrompt
          label="Финальный остаток, фишек"
          initial={player.finalChips ?? player.chips}
          hint="Перезаписывает предыдущий остаток"
          onCancel={() => setMode('main')}
          onSubmit={(value) => {
            props.onFinalStack(value);
            setMode('main');
          }}
        />
      ) : null}

      {mode === 'external' ? (
        <ExternalForm
          game={game}
          player={player}
          onCancel={() => setMode('main')}
          onSubmit={(fromId, toId) => {
            props.onExternal(fromId, toId);
            setMode('main');
          }}
        />
      ) : null}

      {mode === 'journal' ? (
        <JournalEditor
          game={game}
          player={player}
          readonly={readonly}
          onCommit={props.onCommit}
          onBack={() => setMode('main')}
        />
      ) : null}
    </Modal>
  );
}

function NumberPrompt({
  label,
  initial,
  hint,
  onCancel,
  onSubmit,
}: {
  label: string;
  initial: number;
  hint: string;
  onCancel: () => void;
  onSubmit: (value: number) => void;
}) {
  const [text, setText] = useState(String(Math.max(0, Math.round(initial))));
  const value = Number.parseInt(text, 10);
  const valid = Number.isFinite(value) && value >= 0;

  return (
    <form
      class="drawer__section"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onSubmit(value);
      }}
    >
      <Field label={label} hint={hint}>
        <input
          class="input"
          type="number"
          inputMode="numeric"
          min="0"
          value={text}
          onInput={(event) => setText(event.currentTarget.value)}
        />
      </Field>
      <div class="row">
        <button type="button" class="btn" onClick={onCancel}>
          Отмена
        </button>
        <span class="spacer" />
        <button type="submit" class="btn btn--primary" disabled={!valid}>
          Сохранить
        </button>
      </div>
    </form>
  );
}

function ExternalForm({
  game,
  player,
  onCancel,
  onSubmit,
}: {
  game: Game;
  player: PlayerState;
  onCancel: () => void;
  onSubmit: (fromId: string, toId: string) => void;
}) {
  const others = game.players.filter((p) => p.id !== player.id);
  const [fromId, setFromId] = useState(player.id);
  const [toId, setToId] = useState(others[0]?.id ?? player.id);

  return (
    <form
      class="drawer__section"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(fromId, toId);
      }}
    >
      <Field label="Продавец">
        <select
          class="input"
          value={fromId}
          onInput={(event) => setFromId(event.currentTarget.value)}
        >
          {game.players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Покупатель" hint="Банк не меняется, стек переходит между игроками">
        <select class="input" value={toId} onInput={(event) => setToId(event.currentTarget.value)}>
          {game.players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <div class="row">
        <button type="button" class="btn" onClick={onCancel}>
          Отмена
        </button>
        <span class="spacer" />
        <button type="submit" class="btn btn--primary" disabled={fromId === toId}>
          Передать стек
        </button>
      </div>
    </form>
  );
}

const EVENT_LABELS: Record<GameEvent['type'], string> = {
  deal: 'Раздача',
  buyin: 'Докупка',
  external: 'Внешняя',
  cashout: 'Выход',
  finalStack: 'Остаток',
};

function JournalEditor({
  game,
  player,
  readonly,
  onCommit,
  onBack,
}: {
  game: Game;
  player: PlayerState;
  readonly: boolean;
  onCommit: (change: (game: Game) => Game) => void;
  onBack: () => void;
}) {
  // Полный журнал: игрок видит свои события, но правит по одному.
  const events = eventsForPlayer(game.events, player.id);

  return (
    <section class="drawer__section">
      <div class="row row--between">
        <span class="h3">Журнал</span>
        <button type="button" class="btn btn--sm" onClick={onBack}>
          Назад
        </button>
      </div>

      {events.length === 0 ? <p class="small muted">Событий нет</p> : null}

      {events.map((event) => (
        <div class="row" key={event.id}>
          <span class="tiny muted" style={{ width: '74px' }}>
            {EVENT_LABELS[event.type]}
          </span>
          <input
            class="input input--sm"
            type="number"
            inputMode="numeric"
            min="0"
            value={event.chips}
            aria-label={`Сумма: ${EVENT_LABELS[event.type]}`}
            disabled={readonly}
            onInput={(inputEvent) => {
              const next = Number.parseInt(inputEvent.currentTarget.value, 10);
              if (!Number.isFinite(next)) return;
              onCommit((current) => updateEventChips(current, event.id, next));
            }}
          />
          <button
            type="button"
            class="btn btn--icon"
            aria-label="Удалить событие"
            disabled={readonly}
            onClick={() => onCommit((current) => removeEvent(current, event.id))}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ))}

      <div class="row">
        <button
          type="button"
          class="btn btn--sm"
          disabled={readonly || game.events.length === 0}
          onClick={() => onCommit((current) => undoLast(current))}
        >
          Отменить последнее действие
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Мелкие хелперы
// ---------------------------------------------------------------------------

function formatSigned(value: number): string {
  if (value === 0) return '0';
  return `${value > 0 ? '+' : '\u2212'}${formatChips(Math.abs(value))}`;
}

function netClass(value: number): string {
  if (value > 0) return 'positive';
  if (value < 0) return 'negative';
  return '';
}

function coinsOf(chips: number, rate: number): number {
  return rate > 0 ? Math.round((chips * 100) / rate) : 0;
}

/** Экспортируется для экрана итогов: бейдж статуса игры. */
export function StatusBadge({ game }: { game: Game }) {
  if (game.status === 'archived') return <Badge>архив</Badge>;
  if (game.status === 'finished') return <Badge tone="gold">завершена</Badge>;
  return <Badge tone="ok">идёт</Badge>;
}

/** Подпись даты игры — для шапки. */
export function gameSubtitle(game: Game): string {
  return `${formatShortDateTime(game.createdAt)} · ${playersLabel(game.players.length)}`;
}

/** Иконка монеты для панели банка. */
export function CoinsIcon() {
  return <Coins size={14} aria-hidden="true" />;
}

/**
 * Новая игра `/new` (docs/SPEC.md §5.4).
 *
 * Четыре блока: набор, игроки, ставки, раздача. Три карточки вариантов
 * пересчитываются на ввод (debounce 150 мс). Поддержка `?clone=:id`.
 */

import { ChevronDown, Plus, Trash2 } from 'lucide-preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { type ActiveGameChoice, ActiveGameDialog } from '../components/ActiveGameDialog';
import { Screen, TopBar } from '../components/Screen';
import { defaultGameName, playersLabel, toIsoLocal } from '../core/datetime';
import { createGame, setStatus } from '../core/game';
import { formatChips, formatCoins } from '../core/money';
import { coverageText, defaultVariant, planDeals, vectorToText } from '../core/planner';
import type { Deal, Defaults, Game, Kit, MultipleK, Variant } from '../core/types';
import { validateGameSettings, validatePlayers } from '../core/validate';
import { navigate } from '../router';
import {
  activeGame,
  defaults as defaultsSignal,
  fallbackDefaults,
  fallbackKit,
  K_OPTIONS,
  kit as kitSignal,
  loadGame,
  persistGame,
  persistNewGame,
} from '../state/store';
import { Badge, Banner, cx, Field, showToast, tap } from '../ui/kit';

type Draft = {
  names: string[];
  stackCoins: number;
  rate: number;
  smallBlindChips: number;
  multipleK: MultipleK;
  reserveStacks: number;
  variant: Variant | null;
};

function draftFromDefaults(defaults: Defaults, players: number): Draft {
  return {
    names: Array.from({ length: players }, (_, i) => `Игрок ${i + 1}`),
    stackCoins: defaults.stackCoins,
    rate: defaults.rate,
    smallBlindChips: defaults.smallBlindChips,
    multipleK: defaults.multipleK,
    reserveStacks: defaults.reserveStacks,
    variant: null,
  };
}

export function NewGameScreen({ cloneId }: { cloneId: string | null }) {
  const initialKit = kitSignal.value ?? fallbackKit();
  const initialDefaults = defaultsSignal.value ?? fallbackDefaults();

  const [kit] = useState<Kit>(initialKit);
  const [draft, setDraft] = useState<Draft>(() => draftFromDefaults(initialDefaults, 4));
  const [touched, setTouched] = useState(false);
  const [pendingOverActive, setPendingOverActive] = useState<Game | null>(null);
  const [cloneName, setCloneName] = useState<string | null>(null);

  // Клон: предзаполнение из существующей игры (§12.11, Q138).
  useEffect(() => {
    if (!cloneId) return;
    let cancelled = false;
    void (async () => {
      const source = await loadGame(cloneId);
      if (cancelled || !source) return;
      setCloneName(source.name);
      setDraft({
        names: source.players.map((p) => p.name),
        stackCoins: source.stackCoins,
        rate: source.rate,
        smallBlindChips: source.smallBlindChips,
        multipleK: source.multipleK,
        reserveStacks: source.reserveStacks,
        variant: source.deal.variant,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [cloneId]);

  // Debounce 150 мс на пересчёт раздачи (§5.4).
  const [debounced, setDebounced] = useState<Draft>(draft);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(draft), 150);
    return () => clearTimeout(timer);
  }, [draft]);

  const playersCheck = validatePlayers(draft.names.map((name) => ({ name })));
  const settingsCheck = validateGameSettings(
    {
      stackCoins: debounced.stackCoins,
      rate: debounced.rate,
      smallBlindChips: debounced.smallBlindChips,
      multipleK: debounced.multipleK,
      reserveStacks: debounced.reserveStacks,
    },
    kit.denominations,
  );

  const cards = useMemo(
    () =>
      planDeals({
        denominations: kit.denominations.map((d) => ({ value: d.value, count: d.count })),
        players: debounced.names.length,
        stackCoins: debounced.stackCoins,
        rate: debounced.rate,
        multipleK: debounced.multipleK,
        reserveStacks: debounced.reserveStacks,
      }),
    [
      kit.denominations,
      debounced.names.length,
      debounced.stackCoins,
      debounced.rate,
      debounced.multipleK,
      debounced.reserveStacks,
    ],
  );

  const selectedVariant = draft.variant ?? defaultVariant(cards);
  const selectedCard = cards.find((card) => card.variant === selectedVariant && card.ok) ?? null;

  const stackChips = Math.max(0, Math.round(debounced.stackCoins * debounced.rate));
  const canStart = playersCheck.ok && settingsCheck.ok && selectedCard !== null;

  function patch(changes: Partial<Draft>): void {
    setTouched(true);
    setDraft((current) => ({ ...current, ...changes }));
  }

  function patchName(index: number, name: string): void {
    setTouched(true);
    setDraft((current) => {
      const names = current.names.slice();
      names[index] = name;
      return { ...current, names };
    });
  }

  function addPlayer(): void {
    if (draft.names.length >= 12) {
      showToast('Много игроков', 'warn');
      return;
    }
    patch({ names: [...draft.names, `Игрок ${draft.names.length + 1}`] });
    tap();
  }

  function removePlayer(index: number): void {
    if (draft.names.length <= 2) {
      showToast('Мало игроков', 'warn');
      return;
    }
    patch({ names: draft.names.filter((_, i) => i !== index) });
  }

  /** Создаёт игру по текущему черновику. Вынесено из `start` для диалога §8.3. */
  async function createFromDraft(): Promise<void> {
    if (!selectedCard?.deal) return;
    const now = new Date();
    const id = crypto.randomUUID();
    const deal: Deal = { ...selectedCard.deal, variant: selectedCard.variant };
    const game = createGame({
      id,
      name: defaultGameName(now),
      createdAt: toIsoLocal(now),
      rate: debounced.rate,
      stackCoins: debounced.stackCoins,
      smallBlindChips: debounced.smallBlindChips,
      multipleK: debounced.multipleK,
      reserveStacks: debounced.reserveStacks,
      denominations: kit.denominations,
      players: draft.names.map((name) => ({ id: crypto.randomUUID(), name: name.trim() })),
      deal,
    });
    const error = await persistNewGame(game);
    if (error) showToast(error, 'danger');
    tap();
    navigate(`/game/${game.id}`);
  }

  // Если есть активная игра — сначала спрашиваем, что с ней делать (§8.3).
  function start(): void {
    if (!selectedCard?.deal) return;
    if (activeGame.value) {
      setPendingOverActive(activeGame.value);
      return;
    }
    void createFromDraft();
  }

  async function resolveActive(choice: ActiveGameChoice): Promise<void> {
    const existing = pendingOverActive;
    setPendingOverActive(null);
    if (!existing || choice === 'cancel') return;
    if (choice === 'archive') {
      // Первый вариант: текущая уходит в архив через экран итогов и мини-игру.
      navigate(`/game/${existing.id}/results`);
      return;
    }
    await persistGame(setStatus(existing, 'finished'));
    await createFromDraft();
  }

  return (
    <>
      <TopBar title={cloneName ? 'Новая игра · клон' : 'Новая игра'} back="/" />
      <Screen>
        <details class="block" open>
          <summary>
            <span class="block__title">Набор</span>
            <span class="tiny muted numeric">{formatChips(totalChips(kit))} фишек</span>
            <ChevronDown size={18} class="block__chevron" aria-hidden="true" />
          </summary>
          <div class="block__body">
            <p class="small muted" style={{ margin: 0 }}>
              {kit.denominations.map((d) => `${d.value}\u00d7${d.count}`).join(' · ')}
            </p>
            <button type="button" class="btn btn--sm" onClick={() => navigate('/settings')}>
              Изменить
            </button>
          </div>
        </details>

        <details class="block" open>
          <summary>
            <span class="block__title">Игроки</span>
            <span class="tiny muted">{playersLabel(draft.names.length)}</span>
            <ChevronDown size={18} class="block__chevron" aria-hidden="true" />
          </summary>
          <div class="block__body">
            {draft.names.map((name, index) => (
              <div class="row" key={index}>
                <input
                  class={cx('input', touched && name.trim().length === 0 && 'input--invalid')}
                  value={name}
                  maxLength={24}
                  aria-label={`Игрок ${index + 1}`}
                  placeholder={`Игрок ${index + 1}`}
                  onInput={(event) => patchName(index, event.currentTarget.value.slice(0, 24))}
                />
                <button
                  type="button"
                  class="btn btn--icon"
                  aria-label="Удалить игрока"
                  disabled={draft.names.length <= 2}
                  onClick={() => removePlayer(index)}
                >
                  <Trash2 size={18} aria-hidden="true" />
                </button>
              </div>
            ))}
            <div class="row">
              <button
                type="button"
                class="btn btn--sm"
                onClick={addPlayer}
                disabled={draft.names.length >= 12}
              >
                <Plus size={16} aria-hidden="true" /> Добавить игрока
              </button>
            </div>
            {!playersCheck.ok && touched ? (
              <Banner tone="danger">{playersCheck.errors.join(' · ')}</Banner>
            ) : null}
          </div>
        </details>

        <details class="block" open>
          <summary>
            <span class="block__title">Ставки</span>
            <span class="tiny muted numeric">{formatChips(stackChips)} фишек</span>
            <ChevronDown size={18} class="block__chevron" aria-hidden="true" />
          </summary>
          <div class="block__body">
            <div class="grid-2">
              <Field label="Стек, монет">
                <input
                  class="input"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  value={draft.stackCoins}
                  onInput={(event) => patch({ stackCoins: toInt(event.currentTarget.value) })}
                />
              </Field>
              <Field label="Курс, фишек за монету">
                <input
                  class="input"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  value={draft.rate}
                  onInput={(event) => patch({ rate: toInt(event.currentTarget.value) })}
                />
              </Field>
              <Field label="Малый блайнд, фишек">
                <input
                  class="input"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  value={draft.smallBlindChips}
                  onInput={(event) => patch({ smallBlindChips: toInt(event.currentTarget.value) })}
                />
              </Field>
              <Field label="Резерв, докупок">
                <input
                  class="input"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  value={draft.reserveStacks}
                  onInput={(event) =>
                    patch({ reserveStacks: Math.max(0, toInt(event.currentTarget.value)) })
                  }
                />
              </Field>
            </div>

            <div class="field">
              <span class="field__label">Кратность K</span>
              <fieldset class="segments" aria-label="Кратность">
                {K_OPTIONS.map((k) => (
                  <button
                    type="button"
                    key={k}
                    class="segment"
                    aria-pressed={draft.multipleK === k}
                    onClick={() => patch({ multipleK: k })}
                  >
                    {k}
                  </button>
                ))}
              </fieldset>
            </div>

            <p class="small muted" style={{ margin: 0 }}>
              Стек = {formatChips(stackChips)} фишек на игрока · блайнды {draft.smallBlindChips}/
              {draft.smallBlindChips * 2}
            </p>
            {!settingsCheck.ok ? (
              <Banner tone="danger">{settingsCheck.errors.join(' · ')}</Banner>
            ) : null}
          </div>
        </details>

        <details class="block" open>
          <summary>
            <span class="block__title">Раздача</span>
            <span class="tiny muted">{cards.filter((c) => c.ok).length} варианта</span>
            <ChevronDown size={18} class="block__chevron" aria-hidden="true" />
          </summary>
          <div class="block__body">
            {cards.map((card) => (
              <button
                type="button"
                key={card.variant}
                class="variant"
                aria-pressed={selectedVariant === card.variant && card.ok}
                disabled={!card.ok}
                onClick={() => patch({ variant: card.variant })}
              >
                <span class="variant__head">
                  <span class="variant__name">{card.label}</span>
                  <span class="variant__vector">
                    {card.ok ? vectorToText(card.deal?.perPlayer ?? []) : (card.reason ?? '—')}
                  </span>
                </span>
                {card.ok ? (
                  <>
                    <span class="variant__stats">
                      <span>{formatChips(card.chipsPerPlayer)} фишек</span>
                      <span>{formatCoins(card.coinsPerPlayer)} монет</span>
                      <span>
                        из банка {formatChips(card.coverage.dealt)} · останется{' '}
                        {formatChips(card.coverage.stillInBank)}
                      </span>
                    </span>
                    <span class="badges">
                      {card.levelNote ? <Badge tone="warn">{card.levelNote}</Badge> : null}
                      <Badge tone={card.coverage.ok ? 'ok' : 'warn'}>
                        {coverageText(card, debounced.reserveStacks)}
                      </Badge>
                      {card.duplicateOf ? (
                        <Badge>совпадает с «{labelOf(card.duplicateOf)}»</Badge>
                      ) : null}
                    </span>
                  </>
                ) : (
                  <span class="variant__stats">
                    <span>Недоступно · измените набор</span>
                  </span>
                )}
              </button>
            ))}
            {cards.every((card) => !card.ok) ? (
              <Banner tone="danger">
                Набор не позволяет раздать стек.{' '}
                <button type="button" class="btn btn--sm" onClick={() => navigate('/settings')}>
                  Изменить набор
                </button>
              </Banner>
            ) : null}
          </div>
        </details>

        <button
          type="button"
          class="btn btn--primary btn--lg btn--block"
          disabled={!canStart}
          onClick={start}
        >
          Начать игру
        </button>
      </Screen>

      <ActiveGameDialog
        game={pendingOverActive}
        onChoose={(choice) => void resolveActive(choice)}
      />
    </>
  );
}

function labelOf(variant: Variant): string {
  return variant === 'balanced' ? 'Balanced' : variant === 'economy' ? 'Economy' : 'Speed';
}

function totalChips(kit: Kit): number {
  return kit.denominations.reduce((acc, d) => acc + Math.max(0, d.count) * d.value, 0);
}

function toInt(text: string): number {
  const value = Number.parseInt(text, 10);
  return Number.isFinite(value) ? value : 0;
}

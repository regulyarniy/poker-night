/**
 * Набор и дефолты `/settings` (docs/SPEC.md §5.9).
 *
 * Две секции на одной странице: строки номиналов и дефолты новой игры.
 * Сохранение — сразу в IndexedDB через репозиторий.
 */

import { Plus, RotateCcw, Trash2 } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { Screen, TopBar } from '../components/Screen';
import { formatChips } from '../core/money';
import type { Defaults, Denomination, Kit, MultipleK } from '../core/types';
import { validateDefaults, validateKit } from '../core/validate';
import { navigate } from '../router';
import {
  defaults as defaultsSignal,
  K_OPTIONS,
  kit as kitSignal,
  persistDefaults,
  persistKit,
} from '../state/store';
import { Badge, Banner, cx, Field, showToast, tap } from '../ui/kit';

/** Палитра из 8 пресетов (§5.9, Q74). */
const PALETTE = [
  '#c8443b',
  '#2f9e6a',
  '#2f6fd0',
  '#2b2b2b',
  '#d4af37',
  '#8e4bd8',
  '#e08a2b',
  '#ececec',
] as const;

const MIN_DENOMS = 2;
const MAX_DENOMS = 8;

function makeDenomination(value: number): Denomination {
  return {
    id: crypto.randomUUID(),
    value,
    color: PALETTE[0] ?? '#c8443b',
    count: 50,
  };
}

export function SettingsScreen() {
  const initialKit = kitSignal.value;
  const initialDefaults = defaultsSignal.value;

  const [denominations, setDenominations] = useState<Denomination[]>(
    initialKit?.denominations ?? [],
  );
  const [form, setForm] = useState<Defaults>(
    initialDefaults ?? {
      id: 'defaults',
      stackCoins: 150,
      rate: 4,
      smallBlindChips: 5,
      multipleK: 5,
      reserveStacks: 4,
      updatedAt: '',
    },
  );

  useEffect(() => {
    const next = kitSignal.value;
    if (next) setDenominations(next.denominations.map((d) => ({ ...d })));
  }, [kitSignal.value]);

  const total = denominations.reduce((acc, d) => acc + Math.max(0, d.count) * d.value, 0);
  const kitCheck = validateKit({ denominations });
  const defaultsCheck = validateDefaults(form);

  function patch(index: number, changes: Partial<Denomination>): void {
    setDenominations((list) => list.map((d, i) => (i === index ? { ...d, ...changes } : d)));
  }

  function addRow(): void {
    if (denominations.length >= MAX_DENOMS) {
      showToast('Много номиналов', 'warn');
      return;
    }
    const last = denominations[denominations.length - 1];
    const nextValue = last ? last.value * 2 : 5;
    setDenominations((list) => [...list, makeDenomination(nextValue)]);
    tap();
  }

  function removeRow(index: number): void {
    if (denominations.length <= MIN_DENOMS) {
      showToast('Мало номиналов', 'warn');
      return;
    }
    setDenominations((list) => list.filter((_, i) => i !== index));
  }

  async function saveKitNow(): Promise<void> {
    if (!kitCheck.ok) {
      showToast(kitCheck.errors[0] ?? 'Набор', 'danger');
      return;
    }
    const next: Kit = {
      id: 'kit',
      denominations: [...denominations].sort((a, b) => a.value - b.value),
      updatedAt: new Date().toISOString(),
    };
    const error = await persistKit(next);
    showToast(error ?? 'Набор сохранён', error ? 'danger' : 'ok');
    tap();
  }

  async function saveDefaultsNow(): Promise<void> {
    if (!defaultsCheck.ok) {
      showToast(defaultsCheck.errors[0] ?? 'Дефолты', 'danger');
      return;
    }
    const error = await persistDefaults(form);
    showToast(error ?? 'Дефолты сохранены', error ? 'danger' : 'ok');
    tap();
  }

  function resetDefaults(): void {
    const minValue = denominations.reduce<number>(
      (acc, d) => (acc === 0 || d.value < acc ? d.value : acc),
      0,
    );
    setForm({
      id: 'defaults',
      stackCoins: 150,
      rate: 4,
      smallBlindChips: minValue > 0 ? minValue : 5,
      multipleK: 5,
      reserveStacks: 4,
      updatedAt: '',
    });
    tap();
  }

  return (
    <>
      <TopBar title="Набор и дефолты" back="/" />
      <Screen>
        <section class="block">
          <div class="block__head">
            <span class="block__title">Набор</span>
            <Badge tone="gold">{formatChips(total)} фишек</Badge>
          </div>
          <div class="block__body">
            {denominations.map((denom, index) => (
              <div class="denom" key={denom.id}>
                <div class="field">
                  <span class="field__label">Номинал · количество</span>
                  <div class="row denom__inputs">
                    <input
                      class={cx(
                        'input input--sm input--denom',
                        !(denom.value > 0) && 'input--invalid',
                      )}
                      type="number"
                      inputMode="numeric"
                      min="1"
                      value={denom.value}
                      aria-label={`Номинал ${index + 1}`}
                      onInput={(event) => patch(index, { value: toInt(event.currentTarget.value) })}
                    />
                    <span class="muted tiny">×</span>
                    <input
                      class="input input--sm input--denom"
                      type="number"
                      inputMode="numeric"
                      min="0"
                      value={denom.count}
                      aria-label={`Количество номинала ${index + 1}`}
                      onInput={(event) =>
                        patch(index, { count: Math.max(0, toInt(event.currentTarget.value)) })
                      }
                    />
                  </div>
                </div>
                <div class="denom__palette">
                  <fieldset class="swatches" aria-label="Цвет">
                    <button
                      type="button"
                      class="swatch"
                      style={{ background: denom.color }}
                      aria-label="Свой цвет"
                      aria-pressed="false"
                      onClick={() => {
                        const picker = document.createElement('input');
                        picker.type = 'color';
                        picker.value = denom.color;
                        picker.addEventListener('input', () =>
                          patch(index, { color: picker.value }),
                        );
                        picker.click();
                      }}
                    />
                    {PALETTE.slice(0, 4).map((color) => (
                      <button
                        type="button"
                        key={color}
                        class="swatch"
                        style={{ background: color }}
                        aria-label={`Цвет ${color}`}
                        aria-pressed={denom.color.toLowerCase() === color}
                        onClick={() => patch(index, { color })}
                      />
                    ))}
                  </fieldset>
                  <span class="spacer" />
                  <button
                    type="button"
                    class="btn btn--icon"
                    aria-label="Удалить номинал"
                    disabled={denominations.length <= MIN_DENOMS}
                    onClick={() => removeRow(index)}
                  >
                    <Trash2 size={18} aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}

            {!kitCheck.ok ? <Banner tone="danger">{kitCheck.errors.join(' · ')}</Banner> : null}

            <div class="row">
              <button
                type="button"
                class="btn btn--sm"
                onClick={addRow}
                disabled={denominations.length >= MAX_DENOMS}
              >
                <Plus size={16} aria-hidden="true" /> Номинал
              </button>
              <span class="spacer" />
              <button
                type="button"
                class="btn btn--sm btn--primary"
                onClick={() => void saveKitNow()}
              >
                Сохранить набор
              </button>
            </div>
          </div>
        </section>

        <section class="block">
          <div class="block__head">
            <span class="block__title">Дефолты новой игры</span>
          </div>
          <div class="block__body">
            <div class="grid-2">
              <Field label="Стек, монет">
                <input
                  class="input"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  value={form.stackCoins}
                  onInput={(event) =>
                    setForm({ ...form, stackCoins: toInt(event.currentTarget.value) })
                  }
                />
              </Field>
              <Field label="Курс, фишек за монету">
                <input
                  class="input"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  value={form.rate}
                  onInput={(event) => setForm({ ...form, rate: toInt(event.currentTarget.value) })}
                />
              </Field>
              <Field label="Малый блайнд, фишек">
                <input
                  class="input"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  value={form.smallBlindChips}
                  onInput={(event) =>
                    setForm({ ...form, smallBlindChips: toInt(event.currentTarget.value) })
                  }
                />
              </Field>
              <Field label="Резерв, докупок">
                <input
                  class="input"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  value={form.reserveStacks}
                  onInput={(event) =>
                    setForm({
                      ...form,
                      reserveStacks: Math.max(0, toInt(event.currentTarget.value)),
                    })
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
                    aria-pressed={form.multipleK === k}
                    onClick={() => setForm({ ...form, multipleK: k as MultipleK })}
                  >
                    {k}
                  </button>
                ))}
              </fieldset>
            </div>

            {!defaultsCheck.ok ? (
              <Banner tone="danger">{defaultsCheck.errors.join(' · ')}</Banner>
            ) : null}

            <div class="row">
              <button type="button" class="btn btn--sm" onClick={resetDefaults}>
                <RotateCcw size={16} aria-hidden="true" /> Сбросить к стандартным
              </button>
              <span class="spacer" />
              <button
                type="button"
                class="btn btn--sm btn--primary"
                onClick={() => void saveDefaultsNow()}
              >
                Сохранить
              </button>
            </div>
          </div>
        </section>

        <button type="button" class="btn btn--block" onClick={() => navigate('/new')}>
          К новой игре
        </button>
      </Screen>
    </>
  );
}

function toInt(text: string): number {
  const value = Number.parseInt(text, 10);
  return Number.isFinite(value) ? value : 0;
}

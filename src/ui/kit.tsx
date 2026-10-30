/**
 * Мелкие UI-обёртки и хелперы (docs/SPEC.md §11.3, §11.4).
 *
 * Здесь же — тактильность и «мгновенные» тосты: без сторонних библиотек,
 * только navigator.vibrate и собственный сигнал.
 */

import { signal } from '@preact/signals';
import type { ComponentChildren, JSX } from 'preact';
import { cloneElement, isValidElement } from 'preact';
import { useId } from 'preact/hooks';

// ---------------------------------------------------------------------------
// Вибро-отклик (§11.3)
// ---------------------------------------------------------------------------

type VibrateCapable = { vibrate?: (pattern: number | number[]) => boolean };

/** Короткий отклик на успешное действие. Молча ничего не делает без поддержки. */
export function tap(): void {
  try {
    (globalThis.navigator as VibrateCapable | undefined)?.vibrate?.(10);
  } catch {
    // Вибро — необязательное украшение.
  }
}

/** Отклик на ошибку в мини-игре (§7). */
export function buzzError(): void {
  try {
    (globalThis.navigator as VibrateCapable | undefined)?.vibrate?.([20, 40, 20]);
  } catch {
    // см. выше
  }
}

// ---------------------------------------------------------------------------
// Тосты
// ---------------------------------------------------------------------------

export type ToastKind = 'info' | 'warn' | 'danger' | 'ok';

export type Toast = {
  id: number;
  text: string;
  kind: ToastKind;
  /** Действие в тосте (§10.2: «Перезагрузить»). Тост с действием не гаснет сам. */
  action?: { label: string; run: () => void };
};

export const toast = signal<Toast | null>(null);
let toastSeq = 0;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

/** Показывает тост. Повторный вызов заменяет предыдущий. */
export function showToast(text: string, kind: ToastKind = 'info', action?: Toast['action']): void {
  toastSeq += 1;
  toast.value = { id: toastSeq, text, kind, ...(action ? { action } : {}) };
  if (toastTimer) clearTimeout(toastTimer);
  // Тост с кнопкой живёт, пока пользователь не нажмёт: обновление нельзя пропустить.
  toastTimer = action
    ? null
    : setTimeout(() => {
        toast.value = null;
        toastTimer = null;
      }, 2600);
}

/** Скрывает тост немедленно (для тестов и ухода с экрана). */
export function hideToast(): void {
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = null;
  toast.value = null;
}

// ---------------------------------------------------------------------------
// Мелочи
// ---------------------------------------------------------------------------

/** `style` для stagger-анимации карточек (§11.2). */
export function stagger(index: number): JSX.CSSProperties {
  return { '--i': String(index) } as JSX.CSSProperties;
}

/** Настройка CSS-переменной без `as`-каста: Preact принимает любой ключ. */
export function cssVar(name: `--${string}`, value: string): JSX.CSSProperties {
  const style: Record<string, string> = {};
  style[name] = value;
  return style as unknown as JSX.CSSProperties;
}

/** Склеивает классы, отбрасывая falsy. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export type FieldProps = {
  label: string;
  hint?: string;
  error?: string;
  children: ComponentChildren;
};

/**
 * Подпись + контрол + подсказка/ошибка.
 *
 * Контрол получает `id` и `aria-labelledby` — связь с подписью настоящая,
 * а не визуальная: `<label for>` указывает на конкретный элемент.
 */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const control = isValidElement(children)
    ? cloneElement(children, { id, 'aria-labelledby': labelId } as Record<string, unknown>)
    : children;

  return (
    <div class="field">
      <label class="field__label" for={id} id={labelId}>
        {label}
      </label>
      {control}
      {error ? <span class="field__error">{error}</span> : null}
      {!error && hint ? <span class="field__hint">{hint}</span> : null}
    </div>
  );
}

/** Плашка-статус. */
export function Badge({
  tone = 'default',
  children,
}: {
  tone?: 'default' | 'gold' | 'warn' | 'danger' | 'ok';
  children: ComponentChildren;
}) {
  return <span class={cx('badge', tone !== 'default' && `badge--${tone}`)}>{children}</span>;
}

/** Тост внизу экрана. Рендерится один раз в корне приложения. */
export function ToastView() {
  const current = toast.value;
  if (!current) return null;
  return (
    <div class="toast-host" role="status" aria-live="polite">
      <div class={cx('banner', current.kind === 'info' ? 'banner--ok' : `banner--${current.kind}`)}>
        <span style={{ flex: 1 }}>{current.text}</span>
        {current.action ? (
          <button
            type="button"
            class="btn btn--sm"
            onClick={() => {
              const action = current.action;
              hideToast();
              action?.run();
            }}
          >
            {current.action.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Баннер-предупреждение. */
export function Banner({
  tone = 'warn',
  children,
}: {
  tone?: 'warn' | 'danger' | 'ok';
  children: ComponentChildren;
}) {
  return <div class={cx('banner', `banner--${tone}`)}>{children}</div>;
}

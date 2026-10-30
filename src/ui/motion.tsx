/**
 * Моушн без библиотек (docs/SPEC.md §11.2).
 *
 * Три техники спеки: View Transitions для смены маршрута, FLIP-перелёт фишки
 * при докупке и roll-up цифр на итогах. Всё через нативные API;
 * `prefers-reduced-motion` отключает любую анимацию.
 */

import { useEffect, useRef, useState } from 'preact/hooks';

/** Уважает системную настройку «меньше движения». */
export function prefersReducedMotion(): boolean {
  const query = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  return query?.matches ?? false;
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void | Promise<void>) => { finished: Promise<void> };
};

/**
 * Выполняет `apply` внутри View Transition.
 *
 * `apply` меняет сигнал маршрута; Preact перерисовывает в микрозадаче,
 * поэтому ждём ещё один макротик — иначе снимок «после» будет старым.
 */
export function runTransition(apply: () => void): void {
  const doc = globalThis.document as ViewTransitionDocument | undefined;
  if (!doc?.startViewTransition || prefersReducedMotion()) {
    apply();
    return;
  }
  doc.startViewTransition(() => {
    apply();
    return new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

/**
 * FLIP-перелёт фишки: от кнопки докупки к счётчику банка.
 * Возвращает промис, который резолвится после анимации (или сразу).
 */
export async function flyChip(
  from: Element | null,
  to: Element | null,
  color = 'var(--gold)',
): Promise<void> {
  if (!from || !to || prefersReducedMotion()) return;
  const start = from.getBoundingClientRect();
  const end = to.getBoundingClientRect();
  if (start.width === 0 || end.width === 0) return;

  const size = 18;
  const node = document.createElement('div');
  node.setAttribute('aria-hidden', 'true');
  node.style.cssText = [
    'position:fixed',
    'z-index:60',
    'pointer-events:none',
    'border-radius:50%',
    `width:${size}px`,
    `height:${size}px`,
    `background:${color}`,
    'box-shadow:0 0 12px rgba(212,175,55,.55)',
    `left:${start.left + start.width / 2 - size / 2}px`,
    `top:${start.top + start.height / 2 - size / 2}px`,
  ].join(';');
  document.body.appendChild(node);

  const dx = end.left + end.width / 2 - (start.left + start.width / 2);
  const dy = end.top + end.height / 2 - (start.top + start.height / 2);

  try {
    const animation = node.animate(
      [
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        { transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 24}px) scale(1.15)`, opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.6)`, opacity: 0.2 },
      ],
      { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' },
    );
    await animation.finished.catch(() => undefined);
  } finally {
    node.remove();
  }
}

/**
 * Roll-up числа: 400 мс, easeOutCubic (§11.2).
 * При `prefers-reduced-motion` сразу отдаёт финальное значение.
 */
export function RollUp({
  value,
  format = (n: number) => String(Math.round(n)),
  duration = 400,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
}) {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);

  useEffect(() => {
    if (prefersReducedMotion() || duration <= 0) {
      setShown(value);
      fromRef.current = value;
      return;
    }
    const from = fromRef.current;
    if (from === value) return;
    const startedAt = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - (1 - progress) ** 3;
      const next = from + (value - from) * eased;
      setShown(progress >= 1 ? value : next);
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        fromRef.current = value;
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return <>{format(shown)}</>;
}

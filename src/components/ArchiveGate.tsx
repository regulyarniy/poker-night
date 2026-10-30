/**
 * Мини-игра подтверждения архивации (docs/SPEC.md §7).
 *
 * Четыре круга с цифрами 1–4 в случайных непересекающихся позициях.
 * Ошибка сбрасывает прогресс, позиции не пересчитываются. Успех — архивация.
 */

import { X } from 'lucide-preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import { buzzError, cx, tap } from '../ui/kit';

export type ArchiveGateProps = {
  /** Рандом для позиций — инъекция для тестов и предсказуемости. */
  random?: () => number;
  onSuccess: () => void;
  onCancel: () => void;
};

type Point = { x: number; y: number };

const MIN_DISTANCE = 88;
const PADDING = 16;
const AREA_W = 340;
const AREA_H = 420;
const MAX_ATTEMPTS = 60;

/** Расставляет 4 точки: минимум 88 px между центрами, отступ 16 px от краёв. */
export function layoutPoints(random: () => number = Math.random): Point[] {
  const points: Point[] = [];
  for (let index = 0; index < 4; index++) {
    let placed: Point | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const x = PADDING + random() * (AREA_W - PADDING * 2);
      const y = PADDING + random() * (AREA_H - PADDING * 2);
      const clash = points.some((p) => Math.hypot(p.x - x, p.y - y) < MIN_DISTANCE);
      if (!clash) {
        placed = { x, y };
        break;
      }
    }
    // Страховка от бесконечного поиска: сетка по умолчанию.
    points.push(placed ?? { x: 40 + index * 80, y: 80 + index * 70 });
  }
  return points;
}

export function ArchiveGate({ random = Math.random, onSuccess, onCancel }: ArchiveGateProps) {
  const points = useMemo(() => layoutPoints(random), [random]);
  const [next, setNext] = useState(1);
  const [error, setError] = useState(false);
  // Прогресс живёт ещё и в ref: два тапа быстрее перерисовки не должны
  // сравниваться с устаревшим состоянием и сбрасывать верную последовательность.
  const progress = useRef(1);

  function choose(value: number): void {
    if (value !== progress.current) {
      buzzError();
      setError(true);
      progress.current = 1;
      setNext(1);
      return;
    }
    tap();
    setError(false);
    if (value === 4) {
      try {
        (globalThis.navigator as { vibrate?: (p: number) => boolean } | undefined)?.vibrate?.(20);
      } catch {
        // необязательно
      }
      progress.current = 1;
      onSuccess();
      return;
    }
    progress.current = value + 1;
    setNext(value + 1);
  }

  return (
    <div class="screen gate">
      <div class="row row--between">
        <span class="h3">Подтверждение</span>
        <button type="button" class="btn btn--icon" aria-label="Отмена" onClick={onCancel}>
          <X size={20} aria-hidden="true" />
        </button>
      </div>

      <div class="gate__seq" role="img" aria-label={`Следующая цифра ${next}`}>
        {[1, 2, 3, 4].map((value) => (
          <span key={value} class={cx('gate__step', value < next && 'gate__step--done')}>
            {value}
          </span>
        ))}
      </div>

      <p class={cx('small', error ? 'negative' : 'muted')} style={{ margin: 0 }}>
        {error ? 'Сброс — начните с 1' : `Нажмите по порядку: следующая ${next}`}
      </p>

      <div class="gate__area">
        {points.map((point, index) => {
          const value = index + 1;
          return (
            <button
              type="button"
              key={value}
              class={cx('gate__circle', value < next && 'gate__circle--done')}
              style={{ left: `${(point.x / AREA_W) * 100}%`, top: `${(point.y / AREA_H) * 100}%` }}
              aria-label={`Цифра ${value}`}
              onClick={() => choose(value)}
            >
              {value}
            </button>
          );
        })}
      </div>

      <button type="button" class="btn btn--block" onClick={onCancel}>
        Отмена
      </button>
    </div>
  );
}

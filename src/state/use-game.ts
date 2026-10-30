/**
 * Состояние одной игры для экранов (docs/SPEC.md §6).
 *
 * Ключевая деталь: `update` получает **последнюю** версию игры, а не ту,
 * что была в замыкании на момент отрисовки. Иначе быстрый ввод нескольких
 * остатков подряд применяет только последний: каждый обработчик считает
 * от одного и того же устаревшего журнала.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { Game } from '../core/types';
import { loadGame, persistGame } from './store';

export type GameLoader = {
  game: Game | null;
  /** Игры нет в базе. */
  missing: boolean;
  /** Ещё читаем. */
  loading: boolean;
  /** Применить изменение к актуальной версии и сохранить. */
  update: (change: (current: Game) => Game) => Promise<void>;
};

export function useGame(id: string): GameLoader {
  const [game, setGame] = useState<Game | null>(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const latest = useRef<Game | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMissing(false);
    latest.current = null;
    setGame(null);
    void (async () => {
      const loaded = await loadGame(id);
      if (cancelled) return;
      if (!loaded) {
        setMissing(true);
      } else {
        latest.current = loaded;
        setGame(loaded);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const update = useCallback(async (change: (current: Game) => Game): Promise<void> => {
    const current = latest.current;
    if (!current) return;
    const next = change(current);
    if (next === current) return;
    latest.current = next;
    setGame(next);
    await persistGame(next);
  }, []);

  return { game, missing, loading, update };
}

/**
 * Состояние приложения на сигналах.
 *
 * Единственный слой, который знает про репозиторий: экраны читают сигналы
 * и вызывают функции отсюда же. Производные величины не кэшируются —
 * считаются из журнала при отрисовке.
 */

import { computed, signal } from '@preact/signals';
import type { Defaults, Game, Kit, MultipleK } from '../core/types';
import {
  createGame as createGameRecord,
  deleteGame as deleteGameRecord,
  getActiveGame,
  getDefaults,
  getGame,
  getKit,
  initRepo,
  isStorageAvailable,
  listGames,
  saveDefaults,
  saveKit,
  subscribeRepo,
  updateGame as updateGameRecord,
} from '../db/repo';
import { defaultDefaults, defaultKit } from '../db/schema';

export const kit = signal<Kit | null>(null);
export const defaults = signal<Defaults | null>(null);
export const games = signal<Game[]>([]);
export const activeGame = signal<Game | null>(null);
export const currentGame = signal<Game | null>(null);
export const storageOk = signal(true);
export const ready = signal(false);

export const kitTotal = computed(() =>
  (kit.value?.denominations ?? []).reduce((acc, d) => acc + Math.max(0, d.count) * d.value, 0),
);

export const minDenomination = computed(() => {
  const list = kit.value?.denominations ?? [];
  return list.reduce<number | null>(
    (acc, d) => (acc === null || d.value < acc ? d.value : acc),
    null,
  );
});

let started = false;

/** Загрузка всех данных при старте приложения. */
export async function boot(): Promise<void> {
  if (started) return;
  started = true;

  await initRepo();
  storageOk.value = isStorageAvailable();
  kit.value = await getKit();
  defaults.value = await getDefaults();
  await refreshGames();
  ready.value = true;

  subscribeRepo(() => {
    storageOk.value = isStorageAvailable();
    void refreshGames();
  });
}

/** Перечитывает список игр и активную игру. */
export async function refreshGames(): Promise<void> {
  games.value = await listGames();
  activeGame.value = await getActiveGame();
  const current = currentGame.value;
  if (current) {
    const fresh = await getGame(current.id);
    if (fresh) currentGame.value = fresh;
  }
}

/** Загружает игру в `currentGame`. Возвращает null, если её нет. */
export async function loadGame(id: string): Promise<Game | null> {
  const game = await getGame(id);
  currentGame.value = game;
  return game;
}

/** Загружает игру по ссылке из истории без переключения текущей. */
export async function peekGame(id: string): Promise<Game | null> {
  return getGame(id);
}

function stamp(): string {
  return new Date().toISOString();
}

/** Сохраняет набор. Возвращает текст ошибки для тоста или null. */
export async function persistKit(next: Kit): Promise<string | null> {
  const failure = await saveKit({ ...next, updatedAt: stamp() });
  if (failure === 'quota') return 'Не удалось сохранить: нет места';
  kit.value = await getKit();
  if (failure === 'unavailable') {
    storageOk.value = false;
    return 'Данные не сохраняются';
  }
  return null;
}

export async function persistDefaults(next: Defaults): Promise<string | null> {
  const failure = await saveDefaults({ ...next, updatedAt: stamp() });
  if (failure === 'quota') return 'Не удалось сохранить: нет места';
  defaults.value = await getDefaults();
  if (failure === 'unavailable') {
    storageOk.value = false;
    return 'Данные не сохраняются';
  }
  return null;
}

/** Запасной набор, если база ещё не успела загрузиться. */
export function fallbackKit(): Kit {
  return kit.value ?? defaultKit(stamp());
}

export function fallbackDefaults(): Defaults {
  return defaults.value ?? defaultDefaults(stamp());
}

/** Перезапись игры (журнал — источник правды). */
export async function persistGame(game: Game): Promise<string | null> {
  const failure = await updateGameRecord(game);
  if (currentGame.value?.id === game.id) currentGame.value = game;
  if (activeGame.value?.id === game.id) {
    activeGame.value = game.status === 'active' ? game : null;
  }
  await refreshGames();
  if (failure === 'quota') return 'Не удалось сохранить: нет места';
  if (failure === 'unavailable') {
    storageOk.value = false;
    return null;
  }
  return null;
}

/** Новая игра. Возвращает текст ошибки или null. */
export async function persistNewGame(game: Game): Promise<string | null> {
  const failure = await createGameRecord(game);
  await refreshGames();
  if (failure === 'quota') return 'Не удалось сохранить: нет места';
  if (failure === 'unavailable') {
    storageOk.value = false;
    return null;
  }
  return null;
}

export async function dropGame(id: string): Promise<string | null> {
  const failure = await deleteGameRecord(id);
  await refreshGames();
  if (failure === 'unavailable') return null;
  return null;
}

/** Часто используемые значения K. */
export const K_OPTIONS: readonly MultipleK[] = [4, 5, 10];

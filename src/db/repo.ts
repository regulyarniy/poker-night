/**
 * Репозиторий IndexedDB (docs/SPEC.md §8).
 *
 * В базе — только журнал событий и настройки. Производные величины
 * (фишки на руках, итоги, остаток банка) не хранятся никогда.
 *
 * Если IndexedDB недоступен (приватный режим), работаем в памяти
 * и поднимаем флаг `storageAvailable = false` (§12.5).
 */

import { type IDBPDatabase, openDB } from 'idb';
import type { Defaults, Game, Kit } from '../core/types';
import { DB_NAME, DB_VERSION, defaultDefaults, defaultKit, type PokerDBSchema } from './schema';

export type StorageFailure = 'quota' | 'unavailable';

export type RepoEvents = {
  onStorageUnavailable?: () => void;
  onQuotaExceeded?: () => void;
  onUpdate?: () => void;
};

type Listener = () => void;

let dbPromise: Promise<IDBPDatabase<PokerDBSchema> | null> | null = null;
let memoryGames = new Map<string, Game>();
let memoryKit: Kit | null = null;
let memoryDefaults: Defaults | null = null;
let storageAvailable = true;
let initialized = false;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Подписка на изменения данных (для сигналов UI). */
export function subscribeRepo(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Доступно ли постоянное хранилище. */
export function isStorageAvailable(): boolean {
  return storageAvailable;
}

/** Явно отметить недоступность (для тестов и фоллбека). */
export function markStorageUnavailable(): void {
  storageAvailable = false;
  emit();
}

function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException && (error.name === 'QuotaExceededError' || error.code === 22)
  );
}

async function openDatabase(): Promise<IDBPDatabase<PokerDBSchema> | null> {
  try {
    const db = await openDB<PokerDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains('games')) {
          const games = database.createObjectStore('games', { keyPath: 'id' });
          games.createIndex('by-status', 'status');
          games.createIndex('by-createdAt', 'createdAt');
        }
        if (!database.objectStoreNames.contains('settings')) {
          database.createObjectStore('settings', { keyPath: 'id' });
        }
      },
    });
    storageAvailable = true;
    return db;
  } catch {
    storageAvailable = false;
    return null;
  }
}

async function getDb(): Promise<IDBPDatabase<PokerDBSchema> | null> {
  if (!dbPromise) dbPromise = openDatabase();
  return dbPromise;
}

/**
 * Инициализация: при пустых настройках пишет дефолты (§8.2).
 * Дефолты применяются один раз при первом запуске (Q120).
 */
export async function initRepo(now = new Date().toISOString()): Promise<void> {
  if (initialized) return;
  initialized = true;

  const db = await getDb();
  if (!db) {
    memoryKit ??= defaultKit(now);
    memoryDefaults ??= defaultDefaults(now);
    emit();
    return;
  }

  try {
    const kit = await db.get('settings', 'kit');
    const defaults = await db.get('settings', 'defaults');
    if (!kit) await db.put('settings', defaultKit(now));
    if (!defaults) await db.put('settings', defaultDefaults(now));
  } catch {
    storageAvailable = false;
  }
  emit();
}

/** Сбрасывает состояние репозитория (только для тестов). */
export function resetRepoForTests(): void {
  dbPromise = null;
  memoryGames = new Map();
  memoryKit = null;
  memoryDefaults = null;
  storageAvailable = true;
  initialized = false;
  listeners.clear();
}

export async function getKit(): Promise<Kit> {
  const db = await getDb();
  if (db) {
    try {
      const kit = await db.get('settings', 'kit');
      if (kit && kit.id === 'kit') return kit;
    } catch {
      storageAvailable = false;
    }
  }
  memoryKit ??= defaultKit(new Date().toISOString());
  return memoryKit;
}

export async function saveKit(kit: Kit): Promise<StorageFailure | null> {
  const updated: Kit = { ...kit, id: 'kit', updatedAt: new Date().toISOString() };
  memoryKit = updated;
  const db = await getDb();
  if (!db) {
    emit();
    return 'unavailable';
  }
  try {
    await db.put('settings', updated);
    emit();
    return null;
  } catch (error) {
    emit();
    return isQuotaError(error) ? 'quota' : 'unavailable';
  }
}

export async function getDefaults(): Promise<Defaults> {
  const db = await getDb();
  if (db) {
    try {
      const defaults = await db.get('settings', 'defaults');
      if (defaults && defaults.id === 'defaults') return defaults;
    } catch {
      storageAvailable = false;
    }
  }
  memoryDefaults ??= defaultDefaults(new Date().toISOString());
  return memoryDefaults;
}

export async function saveDefaults(defaults: Defaults): Promise<StorageFailure | null> {
  const updated: Defaults = {
    ...defaults,
    id: 'defaults',
    updatedAt: new Date().toISOString(),
  };
  memoryDefaults = updated;
  const db = await getDb();
  if (!db) {
    emit();
    return 'unavailable';
  }
  try {
    await db.put('settings', updated);
    emit();
    return null;
  } catch (error) {
    emit();
    return isQuotaError(error) ? 'quota' : 'unavailable';
  }
}

/** Все игры, новые сверху. */
export async function listGames(): Promise<Game[]> {
  const db = await getDb();
  let games: Game[] = [];
  if (db) {
    try {
      games = await db.getAll('games');
    } catch {
      storageAvailable = false;
      games = [...memoryGames.values()];
    }
  } else {
    games = [...memoryGames.values()];
  }
  return games.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getGame(id: string): Promise<Game | null> {
  const db = await getDb();
  if (db) {
    try {
      return (await db.get('games', id)) ?? memoryGames.get(id) ?? null;
    } catch {
      storageAvailable = false;
    }
  }
  return memoryGames.get(id) ?? null;
}

/** Активная игра — максимум одна (§8.3). */
export async function getActiveGame(): Promise<Game | null> {
  const db = await getDb();
  if (db) {
    try {
      const index = db.transaction('games').store.index('by-status');
      const active = await index.get('active');
      if (active) return active;
    } catch {
      storageAvailable = false;
    }
  }
  for (const game of memoryGames.values()) {
    if (game.status === 'active') return game;
  }
  return null;
}

export async function createGame(game: Game): Promise<StorageFailure | null> {
  memoryGames.set(game.id, game);
  const db = await getDb();
  if (!db) {
    emit();
    return 'unavailable';
  }
  try {
    await db.add('games', game);
    emit();
    return null;
  } catch (error) {
    emit();
    return isQuotaError(error) ? 'quota' : 'unavailable';
  }
}

export async function updateGame(game: Game): Promise<StorageFailure | null> {
  memoryGames.set(game.id, game);
  const db = await getDb();
  if (!db) {
    emit();
    return 'unavailable';
  }
  try {
    await db.put('games', game);
    emit();
    return null;
  } catch (error) {
    emit();
    return isQuotaError(error) ? 'quota' : 'unavailable';
  }
}

export async function deleteGame(id: string): Promise<StorageFailure | null> {
  memoryGames.delete(id);
  const db = await getDb();
  if (!db) {
    emit();
    return 'unavailable';
  }
  try {
    await db.delete('games', id);
    emit();
    return null;
  } catch (error) {
    emit();
    return isQuotaError(error) ? 'quota' : 'unavailable';
  }
}

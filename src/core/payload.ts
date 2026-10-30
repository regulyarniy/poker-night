/**
 * Публичная ссылка (docs/SPEC.md §9).
 *
 * Формат: payload = base64url(codecByte ‖ compressedJSON).
 * Кодируем всегда deflate-raw (0x01), декодируем оба кодека (0x01/0x02),
 * если браузер умеет brotli; иначе — внятная ошибка (§12.18).
 *
 * Журнал событий в ссылку не попадает — только итоговая таблица (§Q115).
 */

import { derivePlayers } from './totals';
import type { CoinCents, Game, GameTotals } from './types';

/** Кодек байта-префикса. */
export const CODEC_DEFLATE_RAW = 0x01;
export const CODEC_BROTLI = 0x02;

export type PayloadPlayer = {
  /** Имя, ≤ 24 символов */
  n: string;
  /** Финальные фишки, null = остаток не зафиксирован */
  f: number | null;
  /** Докупок из банка */
  b: number;
  /** Внешних получено */
  e: number;
  /** Внешних отдано */
  x: number;
  /**
   * Фишки на руках — только при `f: null` (§9.2). Без него публичная страница
   * не может повторить `net` экрана итогов для незафиксированного остатка.
   */
  h?: number;
};

export type Payload = {
  /** Версия схемы */
  v: number;
  /** Дата игры, ISO 8601 с offset */
  t: string;
  /** Стек в монетах */
  s: number;
  /** Курс (фишек за монету) */
  r: number;
  /** Малый блайнд в фишках */
  sb: number;
  /** Кратность K */
  k: number;
  p: PayloadPlayer[];
};

export type DecodeResult =
  | { ok: true; payload: Payload }
  | { ok: false; reason: 'corrupt' | 'unsupported' | 'newer' };

// ---------------------------------------------------------------------------
// base64url
// ---------------------------------------------------------------------------

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_LOOKUP = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64_ALPHABET.length; i++) {
    table[B64_ALPHABET.charCodeAt(i)] = i;
  }
  // Принимаем и стандартный алфавит на случай ссылок из старых версий.
  table['+'.charCodeAt(0)] = 62;
  table['/'.charCodeAt(0)] = 63;
  return table;
})();

/** Байты → base64url без паддинга. */
export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64_ALPHABET[(n >> 18) & 63];
    out += B64_ALPHABET[(n >> 12) & 63];
    out += B64_ALPHABET[(n >> 6) & 63];
    out += B64_ALPHABET[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = (bytes[i] ?? 0) << 16;
    out += B64_ALPHABET[(n >> 18) & 63];
    out += B64_ALPHABET[(n >> 12) & 63];
  } else if (rest === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8);
    out += B64_ALPHABET[(n >> 18) & 63];
    out += B64_ALPHABET[(n >> 12) & 63];
    out += B64_ALPHABET[(n >> 6) & 63];
  }
  return out;
}

/** base64url → байты. Возвращает null на невалидный ввод. */
export function fromBase64Url(text: string): Uint8Array | null {
  const clean = text.replace(/=+$/, '');
  if (clean.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let byteIndex = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    const value = code < 128 ? (B64_LOOKUP[code] ?? -1) : -1;
    if (value < 0) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[byteIndex] = (buffer >> bits) & 0xff;
      byteIndex += 1;
    }
  }
  return out.subarray(0, byteIndex);
}

// ---------------------------------------------------------------------------
// CompressionStream / DecompressionStream
// ---------------------------------------------------------------------------

type CodecFormat = 'deflate-raw' | 'brotli';

function hasCompression(format: CodecFormat): boolean {
  const Ctor = (globalThis as { CompressionStream?: unknown }).CompressionStream;
  if (typeof Ctor !== 'function') return false;
  try {
    new (Ctor as new (f: string) => unknown)(format);
    return true;
  } catch {
    return false;
  }
}

function hasDecompression(format: CodecFormat): boolean {
  const Ctor = (globalThis as { DecompressionStream?: unknown }).DecompressionStream;
  if (typeof Ctor !== 'function') return false;
  try {
    new (Ctor as new (f: string) => unknown)(format);
    return true;
  } catch {
    return false;
  }
}

/** Есть ли нативные средства создать ссылку (§12.17). */
export function canEncodeLinks(): boolean {
  return hasCompression('deflate-raw') && hasDecompression('deflate-raw');
}

/** Сжимает байты нативным потоком. */
async function compress(bytes: Uint8Array, format: CodecFormat): Promise<Uint8Array> {
  const Ctor = (
    globalThis as {
      CompressionStream: new (
        f: string,
      ) => {
        readable: ReadableStream<Uint8Array>;
        writable: WritableStream<Uint8Array>;
      };
    }
  ).CompressionStream;
  const stream = new Ctor(format);
  const writer = stream.writable.getWriter();
  // Ошибка записи и чтения должна всплыть в одном месте — через awaited pump,
  // иначе промис writer.write() останется необработанным (unhandled rejection).
  const pump = (async () => {
    await writer.write(bytes);
    await writer.close();
  })();
  const chunks = await readAll(stream.readable);
  await pump;
  return chunks;
}

/** Разжимает байты нативным потоком. Бросает при повреждённых данных. */
async function decompress(bytes: Uint8Array, format: CodecFormat): Promise<Uint8Array> {
  const Ctor = (
    globalThis as {
      DecompressionStream: new (
        f: string,
      ) => {
        readable: ReadableStream<Uint8Array>;
        writable: WritableStream<Uint8Array>;
      };
    }
  ).DecompressionStream;
  const stream = new Ctor(format);
  const writer = stream.writable.getWriter();
  // При повреждённом теле обе стороны падают: читатель — с Z_DATA_ERROR,
  // писатель — с тем же. Оба промиса должны быть пойманы здесь.
  const pump = (async () => {
    try {
      await writer.write(bytes);
      await writer.close();
    } catch {
      // Читающая сторона сообщит об ошибке более осмысленно.
    }
  })();
  try {
    return await readAll(stream.readable);
  } finally {
    await pump;
  }
}

/** Читает поток целиком. */
async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return concat(chunks);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const c of chunks) length += c.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ---------------------------------------------------------------------------
// Кодирование / декодирование
// ---------------------------------------------------------------------------

/** Кодирует payload в base64url-строку. */
export async function encodePayload(payload: Payload): Promise<string> {
  const json = encoder.encode(JSON.stringify(payload));
  const packed = await compress(json, 'deflate-raw');
  const framed = new Uint8Array(packed.length + 1);
  framed[0] = CODEC_DEFLATE_RAW;
  framed.set(packed, 1);
  return toBase64Url(framed);
}

/** Декодирует base64url-строку в payload. Никогда не бросает. */
export async function decodePayload(encoded: string): Promise<DecodeResult> {
  const bytes = fromBase64Url(encoded);
  if (!bytes || bytes.length < 2) return { ok: false, reason: 'corrupt' };

  const codec = bytes[0];
  const body = bytes.subarray(1);
  let format: CodecFormat;
  if (codec === CODEC_DEFLATE_RAW) {
    format = 'deflate-raw';
  } else if (codec === CODEC_BROTLI) {
    format = 'brotli';
  } else {
    return { ok: false, reason: 'corrupt' };
  }

  if (!hasDecompression(format)) return { ok: false, reason: 'unsupported' };

  let raw: Uint8Array;
  try {
    raw = await decompress(body, format);
  } catch {
    return { ok: false, reason: 'corrupt' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(raw));
  } catch {
    return { ok: false, reason: 'corrupt' };
  }

  return parsePayload(parsed);
}

/** Мягкий разбор JSON: читает известные поля, игнорирует неизвестные (§9.3). */
export function parsePayload(value: unknown): DecodeResult {
  if (typeof value !== 'object' || value === null) return { ok: false, reason: 'corrupt' };
  const obj = value as Record<string, unknown>;

  const v = typeof obj.v === 'number' ? obj.v : 0;
  if (!Number.isInteger(v) || v < 1) return { ok: false, reason: 'corrupt' };
  if (v > 1) {
    // §9.3: читаем известные поля, но помечаем ссылку новее приложения.
    const known = parseKnownFields(obj, v);
    return known ? { ok: false, reason: 'newer' } : { ok: false, reason: 'corrupt' };
  }

  const payload = parseKnownFields(obj, v);
  return payload ? { ok: true, payload } : { ok: false, reason: 'corrupt' };
}

function parseKnownFields(obj: Record<string, unknown>, v: number): Payload | null {
  const t = typeof obj.t === 'string' ? obj.t : null;
  const s = typeof obj.s === 'number' ? obj.s : null;
  const r = typeof obj.r === 'number' ? obj.r : null;
  const sb = typeof obj.sb === 'number' ? obj.sb : null;
  const k = typeof obj.k === 'number' ? obj.k : null;
  const p = Array.isArray(obj.p) ? obj.p : null;
  if (t === null || s === null || r === null || sb === null || k === null || p === null) {
    return null;
  }

  const players: PayloadPlayer[] = [];
  for (const raw of p) {
    if (typeof raw !== 'object' || raw === null) continue;
    const rec = raw as Record<string, unknown>;
    if (typeof rec.n !== 'string') continue;
    const f = typeof rec.f === 'number' ? rec.f : null;
    const entry: PayloadPlayer = {
      n: Array.from(rec.n).slice(0, 24).join(''),
      f: f === null ? null : Math.round(f),
      b: typeof rec.b === 'number' ? Math.max(0, Math.round(rec.b)) : 0,
      e: typeof rec.e === 'number' ? Math.max(0, Math.round(rec.e)) : 0,
      x: typeof rec.x === 'number' ? Math.max(0, Math.round(rec.x)) : 0,
    };
    // `h` необязателен: ссылки до его появления читаются без него (§9.3).
    if (typeof rec.h === 'number') entry.h = Math.max(0, Math.round(rec.h));
    players.push(entry);
  }
  if (players.length === 0) return null;

  return {
    v,
    t,
    s: Math.round(s),
    r: Math.round(r),
    sb: Math.round(sb),
    k: Math.round(k),
    p: players,
  };
}

// ---------------------------------------------------------------------------
// Мост к игре / итогам
// ---------------------------------------------------------------------------

/**
 * Собирает payload из игры и её сводки.
 *
 * Счётчики берутся из журнала (`derivePlayers`), а не из `boughtChips`:
 * `b` — только докупки из банка, `e`/`x` — внешние покупки. Сворачивать их
 * в одно число нельзя, иначе публичная страница покажет другие итоги (§9.2).
 */
export function payloadFromGame(game: Game, totals: GameTotals): Payload {
  const byId = new Map(totals.players.map((p) => [p.playerId, p]));
  const states = new Map(derivePlayers(game).map((p) => [p.id, p]));
  return {
    v: 1,
    t: game.createdAt,
    s: game.stackCoins,
    r: game.rate,
    sb: game.smallBlindChips,
    k: game.multipleK,
    p: game.players.map((p) => {
      const row = byId.get(p.id);
      const state = states.get(p.id);
      const entry: PayloadPlayer = {
        n: Array.from(p.name).slice(0, 24).join(''),
        f: row?.finalChips ?? null,
        b: Math.max(0, state?.buyins ?? 0),
        e: Math.max(0, state?.externalIn ?? 0),
        x: Math.max(0, state?.externalOut ?? 0),
      };
      if (entry.f === null) entry.h = Math.max(0, state?.chips ?? 0);
      return entry;
    }),
  };
}

/** Итоговая строка для публичной страницы. */
export type PublicRow = {
  name: string;
  finalChips: number | null;
  boughtChips: number;
  netChips: number;
  netCoins: CoinCents;
};

export type PublicResults = {
  date: string;
  stackCoins: number;
  rate: number;
  smallBlindChips: number;
  multipleK: number;
  rows: PublicRow[];
  sumNetChips: number;
  reconciled: boolean;
};

/** Пересчитывает итоги из payload по тем же формулам §3.4. */
export function resultsFromPayload(payload: Payload): PublicResults {
  const stackChips = payload.s * payload.r;
  const rows: PublicRow[] = payload.p.map((p) => {
    const boughtChips = stackChips * (1 + p.b + p.e);
    const externalOutChips = stackChips * p.x;
    // Как на экране итогов: без finalStack «закрываемся» фишками на руках (§3.4).
    const effectiveFinal = p.f ?? p.h ?? 0;
    const netChips = effectiveFinal + externalOutChips - boughtChips;
    const netCoins = payload.r > 0 ? Math.round((netChips * 100) / payload.r) : 0;
    return {
      name: p.n,
      finalChips: p.f,
      boughtChips,
      netChips,
      netCoins,
    };
  });
  const sumNetChips = rows.reduce((acc, r) => acc + r.netChips, 0);
  return {
    date: payload.t,
    stackCoins: payload.s,
    rate: payload.r,
    smallBlindChips: payload.sb,
    multipleK: payload.k,
    rows,
    sumNetChips,
    reconciled: sumNetChips === 0,
  };
}

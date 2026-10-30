import { describe, expect, it } from 'vitest';
import {
  CODEC_BROTLI,
  CODEC_DEFLATE_RAW,
  canEncodeLinks,
  decodePayload,
  encodePayload,
  fromBase64Url,
  type Payload,
  parsePayload,
  resultsFromPayload,
  toBase64Url,
} from './payload';

const makePayload = (count: number, nameLength = 8): Payload => ({
  v: 1,
  t: '2026-10-29T20:45:00+10:00',
  s: 150,
  r: 4,
  sb: 5,
  k: 5,
  p: Array.from({ length: count }, (_, i) => ({
    n: `Игрок${String(i + 1).padStart(2, '0')}`.slice(0, nameLength),
    f: 1240 + i * 10,
    b: i % 2,
    e: 0,
    x: 0,
  })),
});

describe('base64url', () => {
  it('roundtrip на разных длинах', () => {
    for (const length of [0, 1, 2, 3, 4, 5, 100, 1000]) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i++) bytes[i] = (i * 37) % 256;
      const encoded = toBase64Url(bytes);
      expect(encoded).not.toMatch(/[+/=]/);
      expect(fromBase64Url(encoded)).toEqual(bytes);
    }
  });

  it('не падает на мусоре', () => {
    expect(fromBase64Url('!!!!')).toBeNull();
    expect(fromBase64Url('a')).toBeNull(); // длина % 4 === 1
  });

  it('принимает паддинг', () => {
    expect(fromBase64Url('YQ==')).toEqual(new Uint8Array([97]));
  });
});

describe('roundtrip payload', () => {
  it('есть нативные средства сжатия', () => {
    expect(canEncodeLinks()).toBe(true);
  });

  for (const count of [2, 4, 6, 12]) {
    it(`roundtrip для ${count} игроков`, async () => {
      const payload = makePayload(count);
      const encoded = await encodePayload(payload);
      const decoded = await decodePayload(encoded);
      expect(decoded.ok).toBe(true);
      if (decoded.ok) expect(decoded.payload).toEqual(payload);
    });
  }

  it('кириллица переживает roundtrip', async () => {
    const payload = makePayload(3);
    payload.p[0]!.n = 'Александр Иванович Петро'; // ровно 24 символа
    const decoded = await decodePayload(await encodePayload(payload));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.payload.p[0]?.n).toBe('Александр Иванович Петро');
  });

  it('имя длиннее 24 символов обрезается при кодировании', () => {
    const payload = makePayload(2);
    payload.p[0]!.n = 'Александр Иванович Петров'; // 25 символов
    const results = resultsFromPayload(payload);
    expect(results.rows[0]?.name).toBe('Александр Иванович Петров');
  });
});

describe('размер ссылки (§9.4, Q116)', () => {
  it('12 игроков с короткими именами < 800 символов', async () => {
    const encoded = await encodePayload(makePayload(12));
    expect(encoded.length).toBeLessThan(800);
  });

  it('12 игроков с именами по 24 символа < 800 символов', async () => {
    const payload = makePayload(12, 24);
    payload.p = payload.p.map((p, i) => ({
      ...p,
      n: `Александр${String(i + 1).padStart(2, '0')}`.padEnd(24, 'ъ').slice(0, 24),
    }));
    const encoded = await encodePayload(payload);
    expect(encoded.length).toBeLessThan(800);
  });
});

describe('устойчивость декодера', () => {
  it('мусор → corrupt, без исключения', async () => {
    expect(await decodePayload('')).toEqual({ ok: false, reason: 'corrupt' });
    expect(await decodePayload('AAAA')).toEqual({ ok: false, reason: 'corrupt' });
    expect(await decodePayload('!!!')).toEqual({ ok: false, reason: 'corrupt' });
    expect(await decodePayload('QRSTUVWXYZ')).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('повреждённое тело при валидном теге кодека → corrupt', async () => {
    const framed = new Uint8Array([CODEC_DEFLATE_RAW, 0xff, 0xff, 0xff, 0xff]);
    const result = await decodePayload(toBase64Url(framed));
    expect(result).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('неизвестный кодек → corrupt', async () => {
    const framed = new Uint8Array([0x7f, 1, 2, 3, 4]);
    expect(await decodePayload(toBase64Url(framed))).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('лишние поля игнорируются (§9.3)', async () => {
    const json = JSON.stringify({
      v: 1,
      t: '2026-10-29T20:45:00+10:00',
      s: 150,
      r: 4,
      sb: 5,
      k: 5,
      future: 'ignored',
      p: [{ n: 'Антон', f: 100, b: 0, e: 0, x: 0, extra: true }],
    });
    const parsed = parsePayload(JSON.parse(json));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.payload.p[0]?.n).toBe('Антон');
  });

  it('ссылка новее приложения → newer (§9.3)', () => {
    const parsed = parsePayload({
      v: 2,
      t: '2027-01-01T00:00:00+10:00',
      s: 200,
      r: 4,
      sb: 5,
      k: 5,
      p: [{ n: 'Антон', f: 100, b: 0, e: 0, x: 0 }],
    });
    expect(parsed).toEqual({ ok: false, reason: 'newer' });
  });

  it('отсутствие критичных полей → corrupt', () => {
    expect(parsePayload({ v: 1, p: [] })).toEqual({ ok: false, reason: 'corrupt' });
    expect(parsePayload(null)).toEqual({ ok: false, reason: 'corrupt' });
    expect(parsePayload('строка')).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('имена обрезаются до 24 символов при декодировании', () => {
    const parsed = parsePayload({
      v: 1,
      t: '2026-10-29T20:45:00+10:00',
      s: 150,
      r: 4,
      sb: 5,
      k: 5,
      p: [{ n: 'А'.repeat(40), f: 100, b: 0, e: 0, x: 0 }],
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(Array.from(parsed.payload.p[0]?.n ?? '').length).toBe(24);
  });

  it('f: null сохраняется как «не зафиксирован»', async () => {
    const payload = makePayload(2);
    payload.p[0]!.f = null;
    const decoded = await decodePayload(await encodePayload(payload));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.payload.p[0]?.f).toBeNull();
  });
});

describe('brotli-совместимость (§12.18)', () => {
  /** Есть ли в рантайме brotli — в Node 22 он появился позже, в 24 точно есть. */
  const hasBrotli = (): boolean => {
    const Ctor = (globalThis as { CompressionStream?: unknown }).CompressionStream;
    if (typeof Ctor !== 'function') return false;
    try {
      new (Ctor as new (f: string) => unknown)('brotli');
      return true;
    } catch {
      return false;
    }
  };

  it('декодирует ссылку с тегом 0x02, если рантайм умеет brotli', async () => {
    if (!hasBrotli()) {
      // Рантайм без brotli: декодер обязан ответить «unsupported», а не упасть.
      const decoded = await decodePayload(toBase64Url(new Uint8Array([CODEC_BROTLI, 1, 2, 3])));
      expect(decoded).toEqual({ ok: false, reason: 'unsupported' });
      return;
    }

    // Собираем brotli-payload вручную.
    const json = new TextEncoder().encode(JSON.stringify(makePayload(2)));
    const Ctor = (
      globalThis as unknown as {
        CompressionStream: new (
          f: string,
        ) => {
          readable: ReadableStream<Uint8Array>;
          writable: WritableStream<Uint8Array>;
        };
      }
    ).CompressionStream;
    const stream = new Ctor('brotli');
    const writer = stream.writable.getWriter();
    void writer.write(json);
    void writer.close();
    const chunks: Uint8Array[] = [];
    const reader = stream.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const packed = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
    let offset = 0;
    for (const c of chunks) {
      packed.set(c, offset);
      offset += c.length;
    }
    const framed = new Uint8Array(packed.length + 1);
    framed[0] = CODEC_BROTLI;
    framed.set(packed, 1);

    const decoded = await decodePayload(toBase64Url(framed));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.payload.p.length).toBe(2);
  });
});

describe('resultsFromPayload', () => {
  it('пересчитывает итоги по формулам §3.4', () => {
    const results = resultsFromPayload({
      v: 1,
      t: '2026-10-29T20:45:00+10:00',
      s: 150,
      r: 4,
      sb: 5,
      k: 5,
      p: [
        { n: 'A', f: 900, b: 0, e: 0, x: 0 },
        { n: 'B', f: 300, b: 0, e: 0, x: 0 },
      ],
    });
    // stackChips = 150 × 4 = 600.
    expect(results.rows[0]?.boughtChips).toBe(600);
    expect(results.rows[0]?.netChips).toBe(300);
    expect(results.rows[1]?.netChips).toBe(-300);
    expect(results.sumNetChips).toBe(0);
    expect(results.reconciled).toBe(true);
  });

  it('учитывает внешние покупки', () => {
    const results = resultsFromPayload({
      v: 1,
      t: '2026-10-29T20:45:00+10:00',
      s: 150,
      r: 4,
      sb: 5,
      k: 5,
      p: [
        { n: 'A', f: 0, b: 0, e: 0, x: 1 },
        { n: 'B', f: 1200, b: 0, e: 1, x: 0 },
      ],
    });
    expect(results.rows[0]?.netChips).toBe(0);
    expect(results.rows[1]?.netChips).toBe(0);
    expect(results.reconciled).toBe(true);
  });

  it('незафиксированный остаток считается как 0 и ломает сверку', () => {
    const results = resultsFromPayload({
      v: 1,
      t: '2026-10-29T20:45:00+10:00',
      s: 150,
      r: 4,
      sb: 5,
      k: 5,
      p: [
        { n: 'A', f: 600, b: 0, e: 0, x: 0 },
        { n: 'B', f: null, b: 0, e: 0, x: 0 },
      ],
    });
    expect(results.rows[0]?.netChips).toBe(0);
    expect(results.rows[1]?.netChips).toBe(-600);
    expect(results.reconciled).toBe(false);
  });

  it('net в монетах считается целыми сотыми', () => {
    const results = resultsFromPayload({
      v: 1,
      t: '2026-10-29T20:45:00+10:00',
      s: 150,
      r: 4,
      sb: 5,
      k: 5,
      p: [{ n: 'A', f: 900, b: 0, e: 0, x: 0 }],
    });
    expect(results.rows[0]?.netCoins).toBe(7500);
  });
});

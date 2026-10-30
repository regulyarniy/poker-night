import { describe, expect, it } from 'vitest';
import {
  buyinsLabel,
  defaultGameName,
  formatMonth,
  formatShortDateTime,
  formatTime,
  monthKey,
  parseIso,
  playersLabel,
  plural,
  toIsoLocal,
} from './datetime';

describe('toIsoLocal', () => {
  it('пишет локальное время с offset', () => {
    const date = new Date(2026, 9, 29, 20, 45, 7);
    const iso = toIsoLocal(date);
    expect(iso.startsWith('2026-10-29T20:45:07')).toBe(true);
    expect(iso).toMatch(/[+-]\d{2}:\d{2}$/);
  });

  it('сохраняет момент при обратном разборе', () => {
    const date = new Date(2026, 0, 1, 0, 0, 0);
    expect(parseIso(toIsoLocal(date))?.getTime()).toBe(date.getTime());
  });

  it('дополняет нулями месяц, день и время', () => {
    const date = new Date(2026, 0, 5, 3, 4, 5);
    expect(toIsoLocal(date).slice(0, 19)).toBe('2026-01-05T03:04:05');
  });
});

describe('formatShortDateTime', () => {
  it('форматирует по-русски', () => {
    // Без offset: `new Date()` считает такую строку локальной,
    // поэтому тест не зависит от часового пояса раннера.
    expect(formatShortDateTime('2026-10-29T20:45:00')).toBe('29 окт 20:45');
  });

  it('переводит z-время в часовой пояс читателя', () => {
    // 10:45 UTC — в UTC-поясе это 10:45, в любом поясе с +N это 10:45+N.
    const utcHours = new Date('2026-10-29T10:45:00Z').getHours();
    const expected = `29 окт ${String(utcHours).padStart(2, '0')}:45`;
    expect(formatShortDateTime('2026-10-29T10:45:00Z')).toBe(expected);
  });

  it('возвращает прочерк на мусоре', () => {
    expect(formatShortDateTime('не дата')).toBe('—');
    expect(formatTime('не дата')).toBe('—');
    expect(formatMonth('не дата')).toBe('Без даты');
  });
});

describe('formatMonth / monthKey', () => {
  it('группирует по месяцам', () => {
    expect(formatMonth('2026-10-29T20:45:00')).toBe('Октябрь 2026');
    expect(monthKey('2026-10-29T20:45:00')).toBe('2026-10');
    expect(monthKey('2026-01-02T00:00:00')).toBe('2026-01');
  });
});

describe('defaultGameName', () => {
  it('берёт локальные день и время', () => {
    expect(defaultGameName(new Date(2026, 9, 29, 20, 45))).toBe('29 окт 20:45');
  });
});

describe('plural', () => {
  it('склоняет по русским правилам', () => {
    expect(plural(1, ['игрок', 'игрока', 'игроков'])).toBe('игрок');
    expect(plural(2, ['игрок', 'игрока', 'игроков'])).toBe('игрока');
    expect(plural(4, ['игрок', 'игрока', 'игроков'])).toBe('игрока');
    expect(plural(5, ['игрок', 'игрока', 'игроков'])).toBe('игроков');
    expect(plural(11, ['игрок', 'игрока', 'игроков'])).toBe('игроков');
    expect(plural(21, ['игрок', 'игрока', 'игроков'])).toBe('игрок');
    expect(plural(112, ['игрок', 'игрока', 'игроков'])).toBe('игроков');
    expect(plural(0, ['игрок', 'игрока', 'игроков'])).toBe('игроков');
  });

  it('склоняет подписи игроков и докупок', () => {
    expect(playersLabel(4)).toBe('4 игрока');
    expect(playersLabel(12)).toBe('12 игроков');
    expect(buyinsLabel(16)).toBe('16 докупок');
    expect(buyinsLabel(1)).toBe('1 докупка');
  });
});

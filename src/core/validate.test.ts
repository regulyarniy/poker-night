import { describe, expect, it } from 'vitest';
import type { Denomination, Player } from './types';
import {
  clampName,
  MAX_NAME_LENGTH,
  normalizeName,
  validateDealFits,
  validateDefaults,
  validateExternal,
  validateGameSettings,
  validateKit,
  validatePlayers,
} from './validate';

const denom = (
  value: number,
  count: number,
  color = '#c8443b',
  id = `d${value}`,
): Denomination => ({
  id,
  value,
  color,
  count,
});

const player = (name: string, id = name): Player => ({ id, name, seat: 0 });

describe('clampName / normalizeName', () => {
  it('обрезает до 24 символов', () => {
    const long = 'Александр Иванович Петров';
    expect(Array.from(clampName(long)).length).toBe(MAX_NAME_LENGTH);
    expect(clampName('Антон')).toBe('Антон');
  });

  it('не режет суррогатные пары', () => {
    const emoji = '😀'.repeat(30);
    const clamped = clampName(emoji);
    expect(Array.from(clamped).length).toBe(MAX_NAME_LENGTH);
  });

  it('нормализует регистр и пробелы', () => {
    expect(normalizeName('  Антон   Иванов ')).toBe('антон иванов');
  });
});

describe('validateKit', () => {
  it('принимает корректный набор', () => {
    const r = validateKit({
      denominations: [denom(5, 75), denom(25, 75), denom(50, 50), denom(100, 75, '#2b2b2b', 'd4')],
    });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('требует минимум 2 номинала', () => {
    expect(validateKit({ denominations: [denom(5, 75)] }).ok).toBe(false);
  });

  it('не даёт больше 8 номиналов', () => {
    const many = Array.from({ length: 9 }, (_, i) => denom((i + 1) * 5, 10, '#c8443b', `d${i}`));
    expect(validateKit({ denominations: many }).ok).toBe(false);
  });

  it('ловит неубывающий порядок', () => {
    const r = validateKit({ denominations: [denom(25, 10), denom(5, 10)] });
    expect(r.errors).toContain('Номиналы не возрастают');
  });

  it('ловит дубликат номинала', () => {
    const r = validateKit({ denominations: [denom(5, 10), denom(5, 10, '#2f9e6a', 'x')] });
    expect(r.errors).toContain('Дубликат номинала');
  });

  it('ловит отрицательное количество', () => {
    expect(validateKit({ denominations: [denom(5, -1), denom(25, 10)] }).ok).toBe(false);
  });

  it('ловит невалидный цвет', () => {
    const r = validateKit({ denominations: [denom(5, 10, 'red'), denom(25, 10, '#2f9e6a')] });
    expect(r.errors).toContain('Цвет');
  });

  it('предупреждает о дубликате цвета', () => {
    const r = validateKit({ denominations: [denom(5, 10), denom(25, 10)] });
    expect(r.warnings).toContain('Дубликат цвета');
    expect(r.ok).toBe(true);
  });

  it('ловит пустой набор', () => {
    expect(validateKit({ denominations: [denom(5, 0), denom(25, 0)] }).errors).toContain(
      'Пустой набор',
    );
  });
});

describe('validatePlayers', () => {
  it('принимает 2 уникальных имени', () => {
    expect(validatePlayers([player('Антон'), player('Борис')]).ok).toBe(true);
  });

  it('требует минимум 2 игрока', () => {
    expect(validatePlayers([player('Антон')]).errors).toContain('Мало игроков');
  });

  it('не даёт больше 12', () => {
    const many = Array.from({ length: 13 }, (_, i) => player(`Игрок ${i}`, `p${i}`));
    expect(validatePlayers(many).errors).toContain('Много игроков');
  });

  it('ловит дубликат имени', () => {
    expect(validatePlayers([player('Антон', 'a'), player('антон', 'b')]).errors).toContain(
      'Дубликат имени',
    );
  });

  it('ловит дубликат после обрезки (§12.16)', () => {
    const long1 = 'Александр Иванович Петров';
    const long2 = 'Александр Иванович Петрова';
    expect(validatePlayers([player(long1, 'a'), player(long2, 'b')]).errors).toContain(
      'Дубликат имени',
    );
  });

  it('ловит пустое имя', () => {
    expect(validatePlayers([player('   ', 'a'), player('Борис', 'b')]).errors).toContain(
      'Пустое имя',
    );
  });

  it('предупреждает об обрезке', () => {
    const r = validatePlayers([
      player('Очень длинное имя игрока номер один', 'a'),
      player('Б', 'b'),
    ]);
    expect(r.warnings).toContain('Имя обрезано');
  });
});

describe('validateGameSettings', () => {
  const valid = {
    stackCoins: 150,
    rate: 4,
    smallBlindChips: 5,
    multipleK: 5 as const,
    reserveStacks: 4,
  };

  it('принимает дефолтные настройки', () => {
    expect(validateGameSettings(valid, [{ value: 5 }]).ok).toBe(true);
  });

  it('ловит нулевой стек', () => {
    expect(validateGameSettings({ ...valid, stackCoins: 0 }).errors).toContain('Стек');
  });

  it('ловит курс меньше 1', () => {
    expect(validateGameSettings({ ...valid, rate: 0 }).errors).toContain('Курс');
  });

  it('ловит нецелый курс', () => {
    expect(validateGameSettings({ ...valid, rate: 4.5 }).errors).toContain('Курс');
  });

  it('ловит недопустимую кратность', () => {
    // @ts-expect-error — проверяем рантайм-защиту от неверного значения
    expect(validateGameSettings({ ...valid, multipleK: 7 }).errors).toContain('Кратность');
  });

  it('ловит отрицательный резерв', () => {
    expect(validateGameSettings({ ...valid, reserveStacks: -1 }).errors).toContain('Резерв');
  });

  it('ловит блайнд ниже минимального номинала', () => {
    expect(validateGameSettings(valid, [{ value: 25 }]).errors).toContain('Блайнд ниже номинала');
  });

  it('ловит нулевой блайнд', () => {
    expect(validateGameSettings({ ...valid, smallBlindChips: 0 }).errors).toContain('Малый блайнд');
  });
});

describe('validateDefaults', () => {
  it('принимает стандартные дефолты', () => {
    expect(
      validateDefaults({
        stackCoins: 150,
        rate: 4,
        smallBlindChips: 5,
        multipleK: 5,
        reserveStacks: 4,
      }).ok,
    ).toBe(true);
  });
});

describe('validateDealFits', () => {
  const kit = [denom(5, 75), denom(25, 75), denom(50, 50), denom(100, 75, '#2b2b2b', 'd4')];

  it('раздача помещается', () => {
    const r = validateDealFits(
      {
        perPlayer: [
          { value: 5, count: 10 },
          { value: 50, count: 11 },
        ],
      },
      4,
      kit,
    );
    expect(r.ok).toBe(true);
  });

  it('не помещается — «Нет места»', () => {
    const r = validateDealFits({ perPlayer: [{ value: 5, count: 30 }] }, 4, kit);
    expect(r.errors).toContain('Нет места');
  });

  it('номинала нет в наборе', () => {
    const r = validateDealFits({ perPlayer: [{ value: 7, count: 1 }] }, 4, kit);
    expect(r.errors).toContain('Нет номинала');
  });

  it('без игроков', () => {
    expect(validateDealFits({ perPlayer: [] }, 0, kit).errors).toContain('Нет игроков');
  });
});

describe('validateExternal', () => {
  const players = [{ id: 'a' }, { id: 'b' }];

  it('принимает корректный перевод', () => {
    expect(validateExternal('a', 'b', players).ok).toBe(true);
  });

  it('ловит перевод самому себе', () => {
    expect(validateExternal('a', 'a', players).errors).toContain('Один игрок');
  });

  it('ловит несуществующего покупателя (§12.15)', () => {
    expect(validateExternal('a', 'z', players).errors).toContain('Нет покупателя');
  });

  it('ловит несуществующего продавца', () => {
    expect(validateExternal('z', 'a', players).errors).toContain('Нет продавца');
  });
});

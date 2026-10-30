import { describe, expect, it } from 'vitest';
import {
  centsToCoins,
  chipsToCoins,
  coinsToCents,
  coinsToChips,
  formatChips,
  formatCoins,
  formatSignedChips,
  formatSignedCoins,
  parseChipsInput,
  parseCoinsInput,
} from './money';

/** Intl в Node может отдавать NBSP или NNBSP — нормализуем для сравнения. */
const norm = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

describe('coinsToCents / centsToCoins', () => {
  it('конвертирует целые монеты', () => {
    expect(coinsToCents(150)).toBe(15000);
    expect(centsToCoins(15000)).toBe(150);
  });

  it('конвертирует дробные монеты без float-ошибок', () => {
    expect(coinsToCents(77.5)).toBe(7750);
    expect(coinsToCents(77.25)).toBe(7725);
    expect(coinsToCents(0.1 + 0.2)).toBe(30);
  });

  it('переживает roundtrip', () => {
    for (const value of [0, 1, 150, 77.5, 77.25, 1234.56]) {
      expect(centsToCoins(coinsToCents(value))).toBeCloseTo(value, 10);
    }
  });

  it('работает с отрицательными значениями', () => {
    expect(coinsToCents(-77.5)).toBe(-7750);
    expect(coinsToCents(-0.005)).toBe(-1);
  });
});

describe('chipsToCoins / coinsToChips', () => {
  it('считает по курсу', () => {
    expect(chipsToCoins(600, 4)).toBe(15000);
    expect(chipsToCoins(300, 4)).toBe(7500);
    expect(chipsToCoins(1, 4)).toBe(25);
  });

  it('не делит на ноль', () => {
    expect(chipsToCoins(600, 0)).toBe(0);
    expect(coinsToChips(15000, 0)).toBe(0);
  });

  it('обратная операция', () => {
    expect(coinsToChips(15000, 4)).toBe(600);
  });

  it('отрицательные фишки', () => {
    expect(chipsToCoins(-600, 4)).toBe(-15000);
  });
});

describe('formatCoins', () => {
  it('отбрасывает .00', () => {
    expect(norm(formatCoins(31000))).toBe('310');
  });

  it('показывает один знак', () => {
    expect(norm(formatCoins(7750))).toBe('77,5');
  });

  it('показывает два знака', () => {
    expect(norm(formatCoins(7725))).toBe('77,25');
  });

  it('разделяет разряды', () => {
    expect(norm(formatCoins(246250))).toBe('2 462,5');
  });

  it('отрицательные', () => {
    expect(norm(formatCoins(-12500))).toBe('-125');
  });

  it('ноль', () => {
    expect(norm(formatCoins(0))).toBe('0');
  });
});

describe('formatChips', () => {
  it('разделяет разряды', () => {
    expect(norm(formatChips(12250))).toBe('12 250');
    expect(norm(formatChips(600))).toBe('600');
    expect(norm(formatChips(0))).toBe('0');
  });

  it('отрицательные', () => {
    expect(norm(formatChips(-2400))).toBe('-2 400');
  });
});

describe('formatSignedChips / formatSignedCoins', () => {
  it('ставит плюс и типографский минус', () => {
    expect(norm(formatSignedChips(300))).toBe('+300');
    expect(norm(formatSignedChips(-300))).toBe('\u2212300');
    expect(formatSignedChips(0)).toBe('0');
  });

  it('для монет', () => {
    expect(norm(formatSignedCoins(7500))).toBe('+75');
    expect(norm(formatSignedCoins(-2500))).toBe('\u221225');
    expect(formatSignedCoins(0)).toBe('0');
  });
});

describe('parseChipsInput / parseCoinsInput', () => {
  it('принимает целые и пробелы', () => {
    expect(parseChipsInput('12 250')).toBe(12250);
    expect(parseChipsInput('600')).toBe(600);
    expect(parseChipsInput('0')).toBe(0);
  });

  it('принимает запятую как разделитель', () => {
    expect(parseCoinsInput('77,5')).toBe(77.5);
    expect(parseCoinsInput('77.25')).toBe(77.25);
  });

  it('возвращает null на мусор', () => {
    expect(parseChipsInput('')).toBeNull();
    expect(parseChipsInput('abc')).toBeNull();
    expect(parseChipsInput('1,2,3')).toBeNull();
    expect(parseCoinsInput('-')).toBeNull();
  });

  it('округляет фишки до целого', () => {
    expect(parseChipsInput('599.6')).toBe(600);
  });
});

import { describe, expect, it } from 'vitest';
import { match, routeFromLocation, stripBase, withBase } from './router';

describe('stripBase / withBase', () => {
  const base = '/poker-night';

  it('снимает base приложения', () => {
    expect(withBase('/game/x', base)).toBe('/poker-night/game/x');
    expect(stripBase('/poker-night/game/x', base)).toBe('/game/x');
    expect(stripBase('/poker-night', base)).toBe('/');
    expect(stripBase('/poker-night/', base)).toBe('/');
  });

  it('не трогает чужие пути', () => {
    expect(stripBase('/game/x', base)).toBe('/game/x');
    expect(stripBase('/poker-nightly', base)).toBe('/poker-nightly');
  });

  it('работает без base (dev-сервер)', () => {
    expect(stripBase('/game/x', '')).toBe('/game/x');
    expect(withBase('/game/x', '')).toBe('/game/x');
  });
});

describe('match', () => {
  const base = '/poker-night';

  it('главная', () => {
    expect(match('/', base)).toEqual({ name: 'home' });
    expect(match('/poker-night/', base)).toEqual({ name: 'home' });
  });

  it('новая игра и клон', () => {
    expect(match('/new', base)).toEqual({ name: 'new', cloneId: null });
    expect(match('/new?clone=g1', base)).toEqual({ name: 'new', cloneId: 'g1' });
    expect(match('/new?clone=', base)).toEqual({ name: 'new', cloneId: null });
  });

  // Регрессия: `sync()` однажды читал только `location.pathname` и терял query,
  // поэтому клон из истории и итогов не предзаполнялся (§12.11).
  it('routeFromLocation склеивает путь и query', () => {
    expect(routeFromLocation('/poker-night/new', '?clone=g1', base)).toEqual({
      name: 'new',
      cloneId: 'g1',
    });
    expect(routeFromLocation('/poker-night/new', '', base)).toEqual({ name: 'new', cloneId: null });
    expect(routeFromLocation('/poker-night/game/g1', '', base)).toEqual({ name: 'game', id: 'g1' });
    expect(routeFromLocation('/poker-night/', '', base)).toEqual({ name: 'home' });
  });

  it('игра, итоги, история, настройки', () => {
    expect(match('/game/g1', base)).toEqual({ name: 'game', id: 'g1' });
    expect(match('/game/g1/results', base)).toEqual({ name: 'results', id: 'g1' });
    expect(match('/history', base)).toEqual({ name: 'history' });
    expect(match('/settings', base)).toEqual({ name: 'settings' });
  });

  it('публичная ссылка', () => {
    expect(match('/share/ABC-123_x', base)).toEqual({ name: 'share', payload: 'ABC-123_x' });
  });

  it('неизвестный путь — 404', () => {
    expect(match('/nope', base)).toEqual({ name: 'notFound', path: '/nope' });
    expect(match('/game', base)).toEqual({ name: 'notFound', path: '/game' });
    expect(match('/game/g1/other', base)).toEqual({ name: 'notFound', path: '/game/g1/other' });
  });

  it('игнорирует хвостовые слэши', () => {
    expect(match('/history/', base)).toEqual({ name: 'history' });
    expect(match('/game/g1/', base)).toEqual({ name: 'game', id: 'g1' });
  });
});

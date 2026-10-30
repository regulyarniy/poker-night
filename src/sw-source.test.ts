import { describe, expect, it } from 'vitest';
import { buildServiceWorker, cacheVersion } from './sw-source';

const options = {
  precache: ['index.html', 'assets/index-abc.js', 'manifest.webmanifest', 'icons/192.png'],
  version: 'abc123',
};

describe('buildServiceWorker', () => {
  const source = buildServiceWorker(options);

  it('подставляет версию кэша в имя', () => {
    expect(source).toContain("const CACHE = 'poker-night-abc123';");
  });

  it('вставляет список precache валидным JSON', () => {
    expect(source).toContain(
      'const PRECACHE = ["index.html","assets/index-abc.js","manifest.webmanifest","icons/192.png"];',
    );
  });

  it('содержит обязательные обработчики', () => {
    expect(source).toContain("addEventListener('install'");
    expect(source).toContain("addEventListener('activate'");
    expect(source).toContain("addEventListener('fetch'");
    expect(source).toContain("addEventListener('message'");
  });

  it('навигация — network-first с фоллбеком на index.html', () => {
    expect(source).toContain("request.mode === 'navigate'");
    expect(source).toContain("cache.match('index.html')");
  });

  it('ассеты — cache-first, прочие домены игнорируются', () => {
    expect(source).toContain("url.pathname.includes('/assets/')");
    expect(source).toContain('url.origin !== self.location.origin');
  });

  it('при активации удаляет старые кэши и делает claim', () => {
    expect(source).toContain('caches.delete(key)');
    expect(source).toContain('self.clients.claim()');
  });

  it('поддерживает SKIP_WAITING', () => {
    expect(source).toContain("event.data.type === 'SKIP_WAITING'");
  });

  it('остаётся синтаксически корректным JS', () => {
    expect(() => new Function(source)).not.toThrow();
  });
});

describe('cacheVersion', () => {
  it('детерминирована и не зависит от порядка', () => {
    expect(cacheVersion(['a.js', 'b.js'])).toBe(cacheVersion(['b.js', 'a.js']));
  });

  it('меняется при изменении набора файлов', () => {
    expect(cacheVersion(['a.js'])).not.toBe(cacheVersion(['a.js', 'b.js']));
  });

  it('состоит из base36-символов', () => {
    expect(cacheVersion(['index.html'])).toMatch(/^[0-9a-z]+$/);
  });
});

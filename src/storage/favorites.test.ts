import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Station } from '@/types';

const KEY = 'signalsurf:favorites:v1';

function makeStation(id: string): Station {
  return {
    id,
    name: `Station ${id}`,
    streamUrl: `https://stream.example/${id}`,
    homepage: null,
    favicon: null,
    country: null,
    countryCode: null,
    region: null,
    tags: [],
    categories: [],
    codec: null,
    bitrate: null,
    hls: false,
    coords: null,
    lastCheckOk: true,
    lastCheckTime: null,
    clickCount: 0,
    votes: 0,
  };
}

async function loadFavorites() {
  vi.resetModules();
  return import('./favorites');
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('favorites', () => {
  it('toggle adds a station, then removes it on the second toggle', async () => {
    const { favorites } = await loadFavorites();
    const a = makeStation('a');

    favorites.toggle(a);
    expect(favorites.has('a')).toBe(true);
    expect(favorites.list().map((s) => s.id)).toEqual(['a']);

    favorites.toggle(a);
    expect(favorites.has('a')).toBe(false);
    expect(favorites.list()).toEqual([]);
  });

  it('lists newest first and removes by id', async () => {
    const { favorites } = await loadFavorites();
    favorites.toggle(makeStation('a'));
    favorites.toggle(makeStation('b'));
    favorites.toggle(makeStation('c'));
    expect(favorites.list().map((s) => s.id)).toEqual(['c', 'b', 'a']);

    favorites.remove('b');
    expect(favorites.list().map((s) => s.id)).toEqual(['c', 'a']);
    expect(JSON.parse(localStorage.getItem(KEY) ?? '[]').map((s: Station) => s.id)).toEqual(['c', 'a']);
  });

  it('persists across re-hydration of the module', async () => {
    const first = await loadFavorites();
    first.favorites.toggle(makeStation('a'));
    first.favorites.toggle(makeStation('b'));

    const second = await loadFavorites();
    expect(second.favorites.list().map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('treats corrupt JSON as an empty list', async () => {
    localStorage.setItem(KEY, '{not json');
    const { favorites } = await loadFavorites();
    expect(favorites.list()).toEqual([]);
  });

  it('drops invalid entries and duplicate ids on read', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        makeStation('a'),
        { id: 'x' },
        null,
        'nope',
        { ...makeStation('b'), streamUrl: 42 },
        makeStation('a'),
        makeStation('c'),
      ]),
    );
    const { favorites } = await loadFavorites();
    expect(favorites.list().map((s) => s.id)).toEqual(['a', 'c']);
  });

  it('keeps working in memory when writes fail', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const { favorites } = await loadFavorites();

    expect(() => favorites.toggle(makeStation('a'))).not.toThrow();
    expect(favorites.has('a')).toBe(true);
    expect(favorites.list().map((s) => s.id)).toEqual(['a']);
  });

  it('clear empties the list and persists the empty state', async () => {
    const { favorites } = await loadFavorites();
    favorites.toggle(makeStation('a'));
    favorites.toggle(makeStation('b'));

    favorites.clear();
    expect(favorites.list()).toEqual([]);

    const reloaded = await loadFavorites();
    expect(reloaded.favorites.list()).toEqual([]);
  });

  it('re-reads when another tab changes the key', async () => {
    const { favorites } = await loadFavorites();
    expect(favorites.list()).toEqual([]);

    localStorage.setItem(KEY, JSON.stringify([makeStation('z')]));
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));

    expect(favorites.list().map((s) => s.id)).toEqual(['z']);
  });
});

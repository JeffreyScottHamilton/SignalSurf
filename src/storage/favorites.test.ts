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
    const a = makeStation('station-a-0001');

    favorites.toggle(a);
    expect(favorites.has('station-a-0001')).toBe(true);
    expect(favorites.list().map((s) => s.id)).toEqual(['station-a-0001']);

    favorites.toggle(a);
    expect(favorites.has('station-a-0001')).toBe(false);
    expect(favorites.list()).toEqual([]);
  });

  it('lists newest first and removes by id', async () => {
    const { favorites } = await loadFavorites();
    favorites.toggle(makeStation('station-a-0001'));
    favorites.toggle(makeStation('station-b-0001'));
    favorites.toggle(makeStation('station-c-0001'));
    expect(favorites.list().map((s) => s.id)).toEqual(['station-c-0001', 'station-b-0001', 'station-a-0001']);

    favorites.remove('station-b-0001');
    expect(favorites.list().map((s) => s.id)).toEqual(['station-c-0001', 'station-a-0001']);
    expect(JSON.parse(localStorage.getItem(KEY) ?? '[]').map((s: Station) => s.id)).toEqual(['station-c-0001', 'station-a-0001']);
  });

  it('persists across re-hydration of the module', async () => {
    const first = await loadFavorites();
    first.favorites.toggle(makeStation('station-a-0001'));
    first.favorites.toggle(makeStation('station-b-0001'));

    const second = await loadFavorites();
    expect(second.favorites.list().map((s) => s.id)).toEqual(['station-b-0001', 'station-a-0001']);
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
        makeStation('station-a-0001'),
        { id: 'station-x-0001' },
        null,
        'nope',
        { ...makeStation('station-b-0001'), streamUrl: 42 },
        makeStation('station-a-0001'),
        makeStation('station-c-0001'),
      ]),
    );
    const { favorites } = await loadFavorites();
    expect(favorites.list().map((s) => s.id)).toEqual(['station-a-0001', 'station-c-0001']);
  });

  it('keeps working in memory when writes fail', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const { favorites } = await loadFavorites();

    expect(() => favorites.toggle(makeStation('station-a-0001'))).not.toThrow();
    expect(favorites.has('station-a-0001')).toBe(true);
    expect(favorites.list().map((s) => s.id)).toEqual(['station-a-0001']);
  });

  it('clear empties the list and persists the empty state', async () => {
    const { favorites } = await loadFavorites();
    favorites.toggle(makeStation('station-a-0001'));
    favorites.toggle(makeStation('station-b-0001'));

    favorites.clear();
    expect(favorites.list()).toEqual([]);

    const reloaded = await loadFavorites();
    expect(reloaded.favorites.list()).toEqual([]);
  });

  it('re-reads when another tab changes the key', async () => {
    const { favorites } = await loadFavorites();
    expect(favorites.list()).toEqual([]);

    localStorage.setItem(KEY, JSON.stringify([makeStation('station-z-0001')]));
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));

    expect(favorites.list().map((s) => s.id)).toEqual(['station-z-0001']);
  });
});

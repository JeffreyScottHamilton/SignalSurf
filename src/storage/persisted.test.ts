import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPersisted, sanitizeStation, storageHealth } from './persisted';

const FAV_KEY = 'signalsurf:favorites:v1';

function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'x', name: 'Station X', streamUrl: 'https://e.com/s', ...overrides };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('sanitizeStation', () => {
  it('keeps a valid snapshot and fills defaults for the optional fields', () => {
    const s = sanitizeStation(valid());
    expect(s).toEqual({
      id: 'x',
      name: 'Station X',
      streamUrl: 'https://e.com/s',
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
      lastCheckOk: false,
      lastCheckTime: null,
      clickCount: 0,
      votes: 0,
    });
  });

  it('drops entries that are not objects or lack a usable id, name or https stream', () => {
    expect(sanitizeStation(null)).toBeNull();
    expect(sanitizeStation('x')).toBeNull();
    expect(sanitizeStation(valid({ id: '' }))).toBeNull();
    expect(sanitizeStation(valid({ id: 4 }))).toBeNull();
    expect(sanitizeStation(valid({ name: '   ' }))).toBeNull();
    expect(sanitizeStation(valid({ streamUrl: 'http://e.com/s' }))).toBeNull();
    expect(sanitizeStation(valid({ streamUrl: 'javascript:alert(1)' }))).toBeNull();
    expect(sanitizeStation(valid({ streamUrl: 'not a url' }))).toBeNull();
  });

  it('rejects a non-string region instead of passing it through', () => {
    expect(sanitizeStation(valid({ region: 5 }))?.region).toBeNull();
    expect(sanitizeStation(valid({ region: { a: 1 } }))?.region).toBeNull();
    expect(sanitizeStation(valid({ region: 'Oslo' }))?.region).toBe('Oslo');
  });

  it('nulls non-string country, countryCode and codec', () => {
    const s = sanitizeStation(valid({ country: 1, countryCode: true, codec: [] }));
    expect(s).toMatchObject({ country: null, countryCode: null, codec: null });
  });

  it('keeps homepage only when it is http(s), and favicon only when it is https', () => {
    expect(sanitizeStation(valid({ homepage: 'https://e.com/' }))?.homepage).toBe('https://e.com/');
    expect(sanitizeStation(valid({ homepage: 'http://e.com/' }))?.homepage).toBe('http://e.com/');
    expect(sanitizeStation(valid({ homepage: 'javascript:alert(1)' }))?.homepage).toBeNull();
    expect(sanitizeStation(valid({ homepage: 7 }))?.homepage).toBeNull();
    expect(sanitizeStation(valid({ favicon: 'https://e.com/a.png' }))?.favicon).toBe('https://e.com/a.png');
    expect(sanitizeStation(valid({ favicon: 'http://e.com/a.png' }))?.favicon).toBeNull();
  });

  it('keeps only string tags and defaults a non-array to []', () => {
    expect(sanitizeStation(valid({ tags: ['jazz', 3, null, 'soul'] }))?.tags).toEqual(['jazz', 'soul']);
    expect(sanitizeStation(valid({ tags: 'jazz' }))?.tags).toEqual([]);
  });

  it('keeps only the four valid categories', () => {
    const s = sanitizeStation(valid({ categories: ['music', 'weather', 'news', 4, 'all'] }));
    expect(s?.categories).toEqual(['music', 'news']);
  });

  it('keeps coordinates only when finite, in range, and not (0,0)', () => {
    expect(sanitizeStation(valid({ coords: { lat: 59.9, lng: 10.7 } }))?.coords).toEqual({ lat: 59.9, lng: 10.7 });
    expect(sanitizeStation(valid({ coords: { lat: 91, lng: 10 } }))?.coords).toBeNull();
    expect(sanitizeStation(valid({ coords: { lat: 10, lng: 181 } }))?.coords).toBeNull();
    expect(sanitizeStation(valid({ coords: { lat: 0, lng: 0 } }))?.coords).toBeNull();
    expect(sanitizeStation(valid({ coords: { lat: '59', lng: 10 } }))?.coords).toBeNull();
    expect(sanitizeStation(valid({ coords: 'here' }))?.coords).toBeNull();
  });

  it('keeps bitrate only as a number and defaults numbers and booleans', () => {
    expect(sanitizeStation(valid({ bitrate: 128 }))?.bitrate).toBe(128);
    expect(sanitizeStation(valid({ bitrate: '128' }))?.bitrate).toBeNull();
    const s = sanitizeStation(valid({ hls: 'yes', lastCheckOk: 1, clickCount: -4, votes: 'many' }));
    expect(s).toMatchObject({ hls: false, lastCheckOk: false, clickCount: 0, votes: 0 });
  });

  it('keeps a valid last check time and drops an unparseable one', () => {
    expect(sanitizeStation(valid({ lastCheckTime: '2026-11-12T09:40:38Z' }))?.lastCheckTime).toBe(
      '2026-11-12T09:40:38Z',
    );
    expect(sanitizeStation(valid({ lastCheckTime: 'yesterday' }))?.lastCheckTime).toBeNull();
  });
});

describe('favorites hydration with corrupt entries', () => {
  it('keeps the valid entry and loads the bad one without crashing', async () => {
    localStorage.setItem(
      FAV_KEY,
      JSON.stringify([valid({ id: 'bad', region: 5 }), valid({ id: 'good', region: 'Oslo' })]),
    );
    vi.resetModules();
    const { favorites } = await import('./favorites');
    expect(favorites.list().map((s) => s.id)).toEqual(['bad', 'good']);
    expect(favorites.list()[0]?.region).toBeNull();
    expect(favorites.list()[1]?.region).toBe('Oslo');
  });
});

describe('write failure health', () => {
  it('is clean before any write fails', () => {
    expect(storageHealth.get()).toEqual({ writeFailed: false });
  });

  it('is flagged when a commit cannot be written, and the in-memory value still updates', () => {
    const { store, commit } = createPersisted<number[]>('signalsurf:test:health', (raw) =>
      Array.isArray(raw) ? (raw as number[]) : [],
    );
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });
    commit([1, 2]);
    expect(store.get()).toEqual([1, 2]);
    expect(storageHealth.get()).toEqual({ writeFailed: true });
  });
});

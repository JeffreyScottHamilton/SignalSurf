import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPersisted, storageHealth } from './persisted';

const FAV_KEY = 'roadtrip:favorites:v1';

function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'station-x-0001', name: 'Station X', streamUrl: 'https://e.com/s', ...overrides };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('favorites hydration with corrupt entries', () => {
  it('keeps the valid entries and loads the bad ones without crashing', async () => {
    localStorage.setItem(
      FAV_KEY,
      JSON.stringify([
        valid({ id: 'bad-00000001', stateCode: 'ZZ', genres: 'rock' }),
        valid({ id: 'good-00000002', stateCode: 'NY', city: 'Albany' }),
        valid({ id: 'short', stateCode: 'NY' }),
      ]),
    );
    vi.resetModules();
    const { favorites } = await import('./favorites');
    expect(favorites.list().map((s) => s.id)).toEqual(['bad-00000001', 'good-00000002']);
    expect(favorites.list()[0]).toMatchObject({ stateCode: null, genres: [] });
    expect(favorites.list()[1]).toMatchObject({ stateCode: 'NY', city: 'Albany' });
  });
});

describe('write failure health', () => {
  it('is clean before any write fails', () => {
    expect(storageHealth.get()).toEqual({ writeFailed: false });
  });

  it('is flagged when a commit cannot be written, and the in-memory value still updates', () => {
    const { store, commit } = createPersisted<number[]>('roadtrip:test:health', (raw) =>
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

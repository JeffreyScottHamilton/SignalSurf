import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Station } from '@/types';

const KEY = 'signalsurf:history:v1';

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

async function loadHistory() {
  vi.resetModules();
  return import('./history');
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('history', () => {
  it('lists newest first with the playedAt time', async () => {
    const { history } = await loadHistory();
    history.add(makeStation('a'), 1000);
    history.add(makeStation('b'), 2000);

    expect(history.list().map((e) => e.station.id)).toEqual(['b', 'a']);
    expect(history.list()[0].playedAt).toBe(2000);
  });

  it('moves an existing station to the top instead of duplicating it', async () => {
    const { history } = await loadHistory();
    history.add(makeStation('a'), 1000);
    history.add(makeStation('b'), 2000);
    history.add(makeStation('a'), 3000);

    const list = history.list();
    expect(list.map((e) => e.station.id)).toEqual(['a', 'b']);
    expect(list[0].playedAt).toBe(3000);
  });

  it('caps the list at 50 entries and drops the oldest', async () => {
    const { history } = await loadHistory();
    for (let i = 0; i < 55; i += 1) history.add(makeStation(`s${i}`), i);

    const list = history.list();
    expect(list).toHaveLength(50);
    expect(list[0].station.id).toBe('s54');
    expect(list[49].station.id).toBe('s5');
  });

  it('clear removes every entry and persists it', async () => {
    const { history } = await loadHistory();
    history.add(makeStation('a'), 1);
    history.clear();
    expect(history.list()).toEqual([]);

    const reloaded = await loadHistory();
    expect(reloaded.history.list()).toEqual([]);
  });

  it('persists across re-hydration and skips corrupt entries', async () => {
    const first = await loadHistory();
    first.history.add(makeStation('a'), 1000);
    first.history.add(makeStation('b'), 2000);

    const stored = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    localStorage.setItem(KEY, JSON.stringify([...stored, { station: { id: 'bad' }, playedAt: 1 }, 'junk']));

    const second = await loadHistory();
    expect(second.history.list().map((e) => e.station.id)).toEqual(['b', 'a']);
  });

  it('keeps working in memory when writes fail', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const { history } = await loadHistory();
    expect(() => history.add(makeStation('a'), 5)).not.toThrow();
    expect(history.list().map((e) => e.station.id)).toEqual(['a']);
  });
});

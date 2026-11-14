import { describe, expect, it } from 'vitest';
import type { Station } from '@/types';
import { filterStations } from './search';

function st(id: string, overrides: Partial<Station> = {}): Station {
  return {
    id,
    name: `Station ${id}`,
    streamUrl: `https://stream.test/${id}`,
    homepage: null,
    favicon: null,
    stateCode: null,
    city: null,
    tags: [],
    genres: [],
    codec: null,
    bitrate: null,
    hls: false,
    coords: null,
    clickCount: 0,
    ...overrides,
  };
}

const all = (stations: Station[], query = '') => filterStations(stations, { query, genre: 'all' }).map((s) => s.id);

const sample: Station[] = [
  st('a', { name: 'KUTX 98.9', city: 'Austin', stateCode: 'TX', tags: ['indie', 'eclectic'], genres: ['indie'], clickCount: 5 }),
  st('b', { name: 'WNYC Jazz', city: 'New York', stateCode: 'NY', tags: ['jazz'], genres: ['jazz'], clickCount: 9 }),
  st('c', { name: 'Smooth Radio', stateCode: 'NJ', tags: ['smooth jazz'], genres: ['jazz'], clickCount: 7 }),
  st('d', { name: 'Hits FM', city: 'Dallas', stateCode: 'TX', tags: ['top 40'], genres: ['pop'], clickCount: 1 }),
  st('e', { name: 'Gospel 1400', stateCode: null, tags: ['gospel'], genres: ['christian'], clickCount: 3 }),
  st('f', { name: 'Music Only', genres: [], clickCount: 100 }),
];

describe('filterStations: terms', () => {
  it('returns everything, most popular first, for a blank query and the all genre', () => {
    expect(all(sample)).toEqual(['f', 'b', 'c', 'a', 'e', 'd']);
    expect(all(sample, '   ')).toEqual(all(sample));
  });

  it('matches names case-insensitively and ignores surrounding space', () => {
    expect(all(sample, '  kutx ')).toEqual(['a']);
  });

  it('matches cities', () => {
    expect(all(sample, 'austin')).toEqual(['a']);
    expect(all(sample, 'DALLAS')).toEqual(['d']);
  });

  it('matches tags and genre labels', () => {
    expect(all(sample, 'eclectic')).toEqual(['a']);
    expect(all(sample, 'jazz')).toEqual(['b', 'c']);
    expect(all(sample, 'hip')).toEqual([]);
    expect(all(sample, 'gospel & christian')).toEqual(['e']);
    expect(all(sample, 'christian')).toEqual(['e']);
  });

  it('requires every whitespace-separated term to match', () => {
    expect(all(sample, 'jazz texas')).toEqual([]);
    expect(all(sample, 'jazz new')).toEqual(['b', 'c']);
    expect(all(sample, 'jazz austin')).toEqual([]);
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(all(sample, 'zzz-no-such-station')).toEqual([]);
  });
});

describe('filterStations: states', () => {
  it('resolves a full state name', () => {
    expect(all(sample, 'texas')).toEqual(['a', 'd']);
    expect(all(sample, 'new jersey')).toEqual(['c']);
  });

  it('resolves a two-letter code exactly', () => {
    expect(all(sample, 'tx')).toEqual(['a', 'd']);
    expect(all(sample, 'ny')).toEqual(['b']);
    expect(all(sample, 'nj')).toEqual(['c']);
  });

  it('matches a multi-word state phrase', () => {
    expect(all(sample, 'new york')).toEqual(['b']);
  });

  it('does not match stations without a state by state text', () => {
    expect(all(sample, 'nj')).toEqual(['c']);
    expect(all(sample, 'united states')).toEqual([]);
  });
});

describe('filterStations: genre filter', () => {
  it('keeps only stations with that genre, combined with the query', () => {
    expect(filterStations(sample, { query: '', genre: 'jazz' }).map((s) => s.id)).toEqual(['b', 'c']);
    expect(filterStations(sample, { query: 'texas', genre: 'jazz' })).toEqual([]);
    expect(filterStations(sample, { query: 'texas', genre: 'pop' }).map((s) => s.id)).toEqual(['d']);
  });

  it('excludes stations with no genres from every genre', () => {
    expect(filterStations(sample, { query: '', genre: 'rock' })).toEqual([]);
  });
});

describe('filterStations: ordering and purity', () => {
  it('orders by click count, most popular first', () => {
    expect(all(sample, 'jazz')).toEqual(['b', 'c']);
    const ordered = filterStations(sample, { query: '', genre: 'all' }).map((s) => s.clickCount);
    expect(ordered).toEqual([...ordered].sort((x, y) => y - x));
  });

  it('does not change the input array', () => {
    const copy = [...sample];
    filterStations(sample, { query: 'jazz', genre: 'all' });
    expect(sample).toEqual(copy);
  });
});

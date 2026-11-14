import { describe, expect, it } from 'vitest';
import type { Station } from '@/types';
import { filterStations } from '@/catalog/search';
import { mapStationsFor } from './mapData';

function st(id: string, overrides: Partial<Station> = {}): Station {
  return {
    id,
    name: `Station ${id}`,
    streamUrl: `https://stream.test/${id}`,
    homepage: null,
    favicon: null,
    stateCode: 'TX',
    city: null,
    tags: [],
    genres: ['jazz'],
    codec: null,
    bitrate: null,
    hls: false,
    coords: { lat: 30, lng: -97 },
    clickCount: 0,
    ...overrides,
  };
}

describe('mapStationsFor', () => {
  it('keeps only matches that have coordinates, in the same order', () => {
    const list = [st('a'), st('b', { coords: null }), st('c', { coords: { lat: 0, lng: 0 } }), st('d')];
    expect(mapStationsFor(list).map((s) => s.id)).toEqual(['a', 'd']);
  });

  it('never invents a marker: an empty match list gives no markers', () => {
    expect(mapStationsFor([])).toEqual([]);
  });

  it('agrees with the list: the map is the filtered list with coordinates', () => {
    const catalogue = [
      st('a', { name: 'Austin Jazz', genres: ['jazz'] }),
      st('b', { name: 'Austin Rock', genres: ['rock'] }),
      st('c', { name: 'Austin Jazz nowhere', genres: ['jazz'], coords: null }),
      st('d', { name: 'Dallas Jazz', genres: ['jazz'], stateCode: 'TX' }),
    ];
    const matches = filterStations(catalogue, { query: 'austin', genre: 'jazz' });
    expect(mapStationsFor(matches).map((s) => s.id)).toEqual(['a']);
  });
});

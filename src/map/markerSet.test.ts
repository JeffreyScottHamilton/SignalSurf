import { describe, expect, it } from 'vitest';
import type { Station } from '@/types';
import { hasValidCoords, mergeMarkerStations } from './markerSet';

function station(id: string, coords: Station['coords']): Station {
  return {
    id,
    name: `Station ${id}`,
    streamUrl: `https://example.test/${id}`,
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
    coords,
    lastCheckOk: true,
    lastCheckTime: null,
    clickCount: 0,
    votes: 0,
  };
}

const at = (lat: number, lng: number) => ({ lat, lng });

describe('hasValidCoords', () => {
  it('accepts finite in-range coords', () => {
    expect(hasValidCoords(at(51.5, -0.12))).toBe(true);
    expect(hasValidCoords(at(-90, 180))).toBe(true);
  });

  it('rejects missing, non-finite, out-of-range and (0,0) coords', () => {
    expect(hasValidCoords(null)).toBe(false);
    expect(hasValidCoords(undefined)).toBe(false);
    expect(hasValidCoords(at(Number.NaN, 1))).toBe(false);
    expect(hasValidCoords(at(1, Infinity))).toBe(false);
    expect(hasValidCoords(at(91, 0))).toBe(false);
    expect(hasValidCoords(at(0, 181))).toBe(false);
    expect(hasValidCoords(at(0, 0))).toBe(false);
  });
});

describe('mergeMarkerStations', () => {
  it('returns nothing for empty inputs', () => {
    expect(mergeMarkerStations([], [])).toEqual([]);
  });

  it('drops stations without usable coords and never invents any', () => {
    const list = mergeMarkerStations(
      [station('a', null), station('b', at(Number.NaN, 2)), station('c', at(0, 0)), station('d', at(10, 20))],
      [station('e', at(95, 0)), station('f', null)],
    );
    expect(list.map((s) => s.id)).toEqual(['d']);
  });

  it('dedupes by id, keeping the map-data copy first', () => {
    const fromMap = station('x', at(1, 1));
    const fromResults = { ...station('x', at(2, 2)), name: 'Result copy' };
    const list = mergeMarkerStations([fromMap], [fromResults, station('y', at(3, 3))]);
    expect(list.map((s) => s.id)).toEqual(['x', 'y']);
    expect(list[0]).toBe(fromMap);
  });

  it('keeps a later valid copy when an earlier copy has invalid coords', () => {
    const list = mergeMarkerStations([station('x', null)], [station('x', at(4, 5))]);
    expect(list).toHaveLength(1);
    expect(list[0]?.coords).toEqual(at(4, 5));
  });

  it('tolerates null entries from untrusted data', () => {
    const list = mergeMarkerStations([null as unknown as Station], [station('z', at(7, 8))]);
    expect(list.map((s) => s.id)).toEqual(['z']);
  });
});

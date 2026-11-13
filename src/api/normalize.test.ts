import { describe, expect, it } from 'vitest';
import type { Station } from '@/types';
import { dedupeStations, normalizeStation } from './normalize';

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    changeuuid: 'change-1',
    stationuuid: 'uuid-1',
    name: 'Jazz FM',
    url: 'https://example.com/stream.mp3',
    url_resolved: 'https://example.com/stream.mp3',
    homepage: 'https://example.com/',
    favicon: 'https://example.com/logo.png',
    tags: 'Jazz, Smooth',
    country: 'Germany',
    countrycode: 'DE',
    state: 'Berlin',
    codec: 'MP3',
    bitrate: 128,
    hls: 0,
    lastcheckok: 1,
    lastchecktime_iso8601: '2026-11-12T09:40:38Z',
    clickcount: 1200,
    votes: 40,
    geo_lat: 52.52,
    geo_long: 13.405,
    ...overrides,
  };
}

function station(overrides: Partial<Station>): Station {
  return {
    id: 'id',
    name: 'Name',
    streamUrl: 'https://example.com/a',
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
    ...overrides,
  };
}

describe('normalizeStation', () => {
  it('maps a valid record', () => {
    const s = normalizeStation(raw());
    expect(s).toEqual({
      id: 'uuid-1',
      name: 'Jazz FM',
      streamUrl: 'https://example.com/stream.mp3',
      homepage: 'https://example.com/',
      favicon: 'https://example.com/logo.png',
      country: 'Germany',
      countryCode: 'DE',
      region: 'Berlin',
      tags: ['jazz', 'smooth'],
      categories: ['music'],
      codec: 'MP3',
      bitrate: 128,
      hls: false,
      coords: { lat: 52.52, lng: 13.405 },
      lastCheckOk: true,
      lastCheckTime: '2026-11-12T09:40:38Z',
      clickCount: 1200,
      votes: 40,
    });
  });

  it('rejects a record without a uuid', () => {
    expect(normalizeStation(raw({ stationuuid: '' }))).toBeNull();
    expect(normalizeStation(raw({ stationuuid: undefined }))).toBeNull();
  });

  it('rejects an empty or blank name', () => {
    expect(normalizeStation(raw({ name: '   ' }))).toBeNull();
    expect(normalizeStation(raw({ name: null }))).toBeNull();
  });

  it('rejects a non-https stream', () => {
    expect(normalizeStation(raw({ url_resolved: 'http://example.com/a', url: 'http://example.com/a' }))).toBeNull();
    expect(normalizeStation(raw({ url_resolved: 'not a url', url: '' }))).toBeNull();
  });

  it('rejects non-objects', () => {
    expect(normalizeStation(null)).toBeNull();
    expect(normalizeStation('station')).toBeNull();
    expect(normalizeStation([])).toBeNull();
  });

  it('trims and collapses whitespace in the name', () => {
    expect(normalizeStation(raw({ name: '  Jazz   \t FM  ' }))?.name).toBe('Jazz FM');
  });

  it('drops (0,0) and out-of-range coordinates', () => {
    expect(normalizeStation(raw({ geo_lat: 0, geo_long: 0 }))?.coords).toBeNull();
    expect(normalizeStation(raw({ geo_lat: 100.5, geo_long: 13.7 }))?.coords).toBeNull();
    expect(normalizeStation(raw({ geo_lat: 10, geo_long: 181 }))?.coords).toBeNull();
    expect(normalizeStation(raw({ geo_lat: null, geo_long: 13 }))?.coords).toBeNull();
    expect(normalizeStation(raw({ geo_lat: '52.5', geo_long: '13.4' }))?.coords).toBeNull();
  });

  it('keeps coordinates on the edges of the valid range', () => {
    expect(normalizeStation(raw({ geo_lat: -90, geo_long: 180 }))?.coords).toEqual({ lat: -90, lng: 180 });
  });

  it('drops non-https favicons and non-http homepages', () => {
    const s = normalizeStation(raw({ favicon: 'http://example.com/a.png', homepage: 'javascript:alert(1)' }));
    expect(s?.favicon).toBeNull();
    expect(s?.homepage).toBeNull();
  });

  it('shortens a very long country name using the country code', () => {
    const s = normalizeStation(
      raw({ country: 'The United Kingdom Of Great Britain And Northern Ireland', countrycode: 'GB' }),
    );
    expect(s?.country).toBe('United Kingdom');
    expect(s?.countryCode).toBe('GB');
  });

  it('falls back to the raw country when the code is missing', () => {
    const s = normalizeStation(raw({ country: 'Somewhere', countrycode: '' }));
    expect(s?.country).toBe('Somewhere');
    expect(s?.countryCode).toBeNull();
  });

  it('limits tags to 8, drops empty and over-long tags, and keeps the first occurrence', () => {
    const tags = ['a1', ' ', 'x'.repeat(25), 'jazz', 'JAZZ', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7'].join(',');
    const s = normalizeStation(raw({ tags }));
    expect(s?.tags).toEqual(['a1', 'jazz', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7']);
  });

  it('classifies categories from all valid tags, even beyond the 8 kept', () => {
    const tags = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7', 'h8', 'news'].join(',');
    expect(normalizeStation(raw({ tags }))?.categories).toEqual(['news']);
  });

  it('maps zero bitrate and zero-or-missing numbers to null or 0', () => {
    const s = normalizeStation(raw({ bitrate: 0, clickcount: undefined, votes: -3, hls: 1 }));
    expect(s?.bitrate).toBeNull();
    expect(s?.clickCount).toBe(0);
    expect(s?.votes).toBe(0);
    expect(s?.hls).toBe(true);
  });

  it('treats an unparseable last check time as null', () => {
    expect(normalizeStation(raw({ lastchecktime_iso8601: 'yesterday' }))?.lastCheckTime).toBeNull();
  });
});

describe('dedupeStations', () => {
  it('removes repeated ids and keeps the first occurrence', () => {
    const out = dedupeStations([station({ id: 'a', name: 'One' }), station({ id: 'a', name: 'Two', streamUrl: 'https://x.test/2' })]);
    expect(out.map((s) => s.name)).toEqual(['One']);
  });

  it('removes repeated stream URLs', () => {
    const out = dedupeStations([
      station({ id: 'a', name: 'One', streamUrl: 'https://same.test/s' }),
      station({ id: 'b', name: 'Two', streamUrl: 'https://same.test/s' }),
    ]);
    expect(out.map((s) => s.id)).toEqual(['a']);
  });

  it('keeps distinct regional stations that share a name in the same country', () => {
    const out = dedupeStations([
      station({ id: 'a', name: 'Radio Plus', countryCode: 'DE', streamUrl: 'https://one.test/' }),
      station({ id: 'b', name: 'RADIO PLUS', countryCode: 'de', streamUrl: 'https://two.test/' }),
      station({ id: 'c', name: 'Radio Plus', countryCode: 'AT', streamUrl: 'https://three.test/' }),
    ]);
    expect(out.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
});

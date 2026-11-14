import { describe, expect, it } from 'vitest';
import { sanitizeStation } from './sanitize';

function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'station-x-0001', name: 'Station X', streamUrl: 'https://e.com/s', ...overrides };
}

describe('sanitizeStation', () => {
  it('keeps a valid snapshot and fills defaults for the optional fields', () => {
    expect(sanitizeStation(valid())).toEqual({
      id: 'station-x-0001',
      name: 'Station X',
      streamUrl: 'https://e.com/s',
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

  it('drops entries whose name is shorter than 2 characters after trimming', () => {
    expect(sanitizeStation(valid({ name: 'A' }))).toBeNull();
    expect(sanitizeStation(valid({ name: '  A  ' }))).toBeNull();
    expect(sanitizeStation(valid({ name: ' AB ' }))?.name).toBe('AB');
  });

  it('drops entries whose id is shorter than 8 characters, and keeps a UUID-length id', () => {
    expect(sanitizeStation(valid({ id: 'abc-def' }))).toBeNull();
    expect(sanitizeStation(valid({ id: '1234567' }))).toBeNull();
    expect(sanitizeStation(valid({ id: '  abc  ' }))).toBeNull();
    expect(sanitizeStation(valid({ id: '12345678' }))?.id).toBe('12345678');
    expect(sanitizeStation(valid({ id: '3f2a9c1e-7b4d-4e8a-9f10-2c5d6e7f8a9b' }))?.id).toBe(
      '3f2a9c1e-7b4d-4e8a-9f10-2c5d6e7f8a9b',
    );
  });

  it('keeps a known state code and nulls anything else', () => {
    expect(sanitizeStation(valid({ stateCode: 'TX' }))?.stateCode).toBe('TX');
    expect(sanitizeStation(valid({ stateCode: 'tx' }))?.stateCode).toBeNull();
    expect(sanitizeStation(valid({ stateCode: 'ZZ' }))?.stateCode).toBeNull();
    expect(sanitizeStation(valid({ stateCode: 5 }))?.stateCode).toBeNull();
    expect(sanitizeStation(valid({ stateCode: 'Texas' }))?.stateCode).toBeNull();
  });

  it('keeps a city only as a non-empty string', () => {
    expect(sanitizeStation(valid({ city: ' Austin ' }))?.city).toBe('Austin');
    expect(sanitizeStation(valid({ city: '   ' }))?.city).toBeNull();
    expect(sanitizeStation(valid({ city: 9 }))?.city).toBeNull();
  });

  it('ignores the old country and region fields', () => {
    const s = sanitizeStation(valid({ country: 'Norway', countryCode: 'NO', region: 'Oslo' }));
    expect(s).not.toHaveProperty('country');
    expect(s).not.toHaveProperty('region');
    expect(s).toMatchObject({ stateCode: null, city: null });
  });

  it('nulls a non-string codec', () => {
    expect(sanitizeStation(valid({ codec: [] }))?.codec).toBeNull();
  });

  it('keeps homepage only when it is http(s), and favicon only when it is https', () => {
    expect(sanitizeStation(valid({ homepage: 'https://e.com/' }))?.homepage).toBe('https://e.com/');
    expect(sanitizeStation(valid({ homepage: 'http://e.com/' }))?.homepage).toBe('http://e.com/');
    expect(sanitizeStation(valid({ homepage: 'javascript:alert(1)' }))?.homepage).toBeNull();
    expect(sanitizeStation(valid({ homepage: 7 }))?.homepage).toBeNull();
    expect(sanitizeStation(valid({ favicon: 'https://e.com/a.png' }))?.favicon).toBe('https://e.com/a.png');
    expect(sanitizeStation(valid({ favicon: 'http://e.com/a.png' }))?.favicon).toBeNull();
  });

  it('keeps only string tags, at most five, and defaults a non-array to []', () => {
    expect(sanitizeStation(valid({ tags: ['jazz', 3, null, 'soul'] }))?.tags).toEqual(['jazz', 'soul']);
    expect(sanitizeStation(valid({ tags: 'jazz' }))?.tags).toEqual([]);
    expect(sanitizeStation(valid({ tags: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'] }))?.tags).toHaveLength(5);
  });

  it('keeps only the known genres', () => {
    const s = sanitizeStation(valid({ genres: ['rock', 'weather', 'jazz', 4, 'all', 'hiphop'] }));
    expect(s?.genres).toEqual(['rock', 'jazz', 'hiphop']);
  });

  it('keeps coordinates only when finite, in range, and not (0,0)', () => {
    expect(sanitizeStation(valid({ coords: { lat: 30.2, lng: -97.7 } }))?.coords).toEqual({ lat: 30.2, lng: -97.7 });
    expect(sanitizeStation(valid({ coords: { lat: 91, lng: 10 } }))?.coords).toBeNull();
    expect(sanitizeStation(valid({ coords: { lat: 10, lng: 181 } }))?.coords).toBeNull();
    expect(sanitizeStation(valid({ coords: { lat: 0, lng: 0 } }))?.coords).toBeNull();
    expect(sanitizeStation(valid({ coords: { lat: '59', lng: 10 } }))?.coords).toBeNull();
    expect(sanitizeStation(valid({ coords: 'here' }))?.coords).toBeNull();
  });

  it('keeps bitrate only as a positive number and defaults hls and clicks', () => {
    expect(sanitizeStation(valid({ bitrate: 128 }))?.bitrate).toBe(128);
    expect(sanitizeStation(valid({ bitrate: 0 }))?.bitrate).toBeNull();
    expect(sanitizeStation(valid({ bitrate: '128' }))?.bitrate).toBeNull();
    const s = sanitizeStation(valid({ hls: 'yes', clickCount: -4 }));
    expect(s).toMatchObject({ hls: false, clickCount: 0 });
  });
});

import { describe, expect, it } from 'vitest';
import {
  classifyStation,
  dedupeCatalog,
  inPolygon,
  inUsBox,
  normalizeRaw,
  parseStateText,
  parseTags,
  stateAtPoint,
  stateFromIso,
} from './rules.mjs';

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    stationuuid: 'a1b2c3d4-0000-4000-8000-000000000001',
    name: '  KTST  ',
    url: 'https://stream.test/a',
    url_resolved: 'https://stream.test/a',
    homepage: 'https://ktst.test/',
    favicon: 'https://ktst.test/i.png',
    tags: 'Jazz, Rock',
    iso_3166_2: null,
    state: 'Austin TX',
    codec: 'MP3',
    bitrate: 128,
    hls: 0,
    clickcount: 42,
    geo_lat: 30.27,
    geo_long: -97.74,
    ...overrides,
  };
}

const polygonNone = () => null;

describe('classifyStation: genres', () => {
  it.each([
    [['classic rock'], ['rock']],
    [['hip-hop', 'r&b'], ['hiphop']],
    [["80's"], ['oldies']],
    [['classic hits'], ['oldies']],
    [['hits'], ['pop']],
    [['adult contemporary'], ['pop']],
    [['top 40'], ['pop']],
    [['alternative / indie'], ['rock', 'indie']],
    [['college radio'], ['indie']],
    [['bluegrass'], ['folk']],
    [['americana'], ['folk']],
    [['gospel'], ['christian']],
    [['smooth jazz'], ['jazz']],
    [['blues'], ['jazz']],
    [['soul'], ['hiphop']],
    [['ambient'], ['electronic']],
    [['regional mexican'], ['latin']],
    [['classical music'], ['classical']],
    [['country music'], ['country']],
  ])('maps %j to %j', (tags, genres) => {
    expect(classifyStation(tags)).toEqual({ reason: null, genres });
  });

  it('keeps genres in display order and without duplicates', () => {
    expect(classifyStation(['gospel', 'jazz', 'classic rock', 'classic rock']).genres).toEqual([
      'rock',
      'jazz',
      'christian',
    ]);
  });

  it('matches whole words only', () => {
    expect(classifyStation(['rocket']).reason).toBe('no-genre');
    expect(classifyStation(['popcorn']).reason).toBe('no-genre');
    expect(classifyStation(['dancehall']).reason).toBe('no-genre');
    expect(classifyStation(['transport']).reason).toBe('no-genre');
  });

  it('reports a station with no genre match as no-genre', () => {
    expect(classifyStation(['reggae', 'caribbean'])).toEqual({ reason: 'no-genre', genres: [] });
  });

  it('keeps a station whose only tags are bare music or variety, with no genres', () => {
    expect(classifyStation(['music'])).toEqual({ reason: null, genres: [] });
    expect(classifyStation(['variety'])).toEqual({ reason: null, genres: [] });
    expect(classifyStation(['music variety'])).toEqual({ reason: null, genres: [] });
  });

  it('does not keep bare music when a non-genre tag is present', () => {
    expect(classifyStation(['music', 'community radio']).reason).toBe('no-genre');
  });

  it('treats no tags, or only blank tags, as untagged', () => {
    expect(classifyStation([])).toEqual({ reason: 'untagged', genres: [] });
    expect(classifyStation(['  ', ''])).toEqual({ reason: 'untagged', genres: [] });
  });
});

describe('classifyStation: hard excludes', () => {
  it.each([
    [['news talk', 'jazz']],
    [['talk']],
    [['sports', 'rock']],
    [['christian preaching', 'christian']],
    [['old time radio', 'jazz']],
    [['otr', 'oldies']],
    [['Local News', 'pop']],
    [['bible', 'gospel']],
    [['podcast', 'rock']],
  ])('drops %j as hard-exclude', (tags) => {
    expect(classifyStation(tags)).toEqual({ reason: 'hard-exclude', genres: [] });
  });

  it('excludes whole words, not substrings', () => {
    expect(classifyStation(['sportsman radio', 'rock']).reason).toBeNull();
  });
});

describe('parseTags', () => {
  it('lower-cases, trims, drops empties and duplicates, and keeps the first occurrence', () => {
    expect(parseTags(' Jazz , ,JAZZ, soul ')).toEqual(['jazz', 'soul']);
  });

  it('drops tags longer than 24 characters and non-string input', () => {
    expect(parseTags('x'.repeat(25))).toEqual([]);
    expect(parseTags(undefined)).toEqual([]);
  });
});

describe('parseStateText', () => {
  it.each([
    ['CA', 'CA', null],
    ['California', 'CA', null],
    ['New York NY', 'NY', 'New York'],
    ['Seattle, Washington', 'WA', 'Seattle'],
    ['Washington', 'WA', null],
    ['Washington, DC', 'DC', 'Washington'],
    ['Washington, D.C.', 'DC', 'Washington'],
    ['West Virginia', 'WV', null],
    ['Morgantown West Virginia', 'WV', 'Morgantown'],
    ['Kansas City, Missouri', 'MO', 'Kansas City'],
    ['New York City, New York', 'NY', 'New York City'],
    ['Warren AFB WY', 'WY', 'Warren AFB'],
    ['Birmingham Alabama', 'AL', 'Birmingham'],
    ['Pratt, KS', 'KS', 'Pratt'],
    ['US-CA', 'CA', null],
  ])('parses %j as %j, city %j', (text, code, city) => {
    expect(parseStateText(text)).toEqual({ code, city });
  });

  it.each([
    ['Las Vegas'],
    ['Virginia Beach'],
    ['Nevada City'],
    ['United States'],
    ['in'],
    ['ca'],
    ['US-XX'],
    ['AT-1'],
    ['Waynesboro'],
    [''],
    [' , '],
    [null],
    [42],
  ])('never guesses a state for %j', (text) => {
    expect(parseStateText(text as string)).toEqual({ code: null, city: null });
  });
});

describe('stateFromIso', () => {
  it('reads US-XX codes only', () => {
    expect(stateFromIso('US-CA')).toBe('CA');
    expect(stateFromIso('AT-1')).toBeNull();
    expect(stateFromIso('US')).toBeNull();
    expect(stateFromIso('US-XX')).toBeNull();
    expect(stateFromIso(null)).toBeNull();
  });
});

describe('inUsBox', () => {
  it('accepts points in the lower 48, Alaska, Hawaii and the territories', () => {
    expect(inUsBox(30.27, -97.74)).toBe(true);
    expect(inUsBox(61.2, -149.9)).toBe(true);
    expect(inUsBox(21.3, -157.8)).toBe(true);
    expect(inUsBox(18.4, -66.1)).toBe(true);
    expect(inUsBox(52.0, 178.0)).toBe(true);
  });

  it('rejects points outside the US, including (0,0)', () => {
    expect(inUsBox(51.5, -0.12)).toBe(false);
    expect(inUsBox(48.85, 2.35)).toBe(false);
    expect(inUsBox(0, 0)).toBe(false);
  });
});

describe('point in polygon', () => {
  // A square state "AA" with a square hole, and a second small shape "BB".
  const square = [
    [
      [-100, 30],
      [-90, 30],
      [-90, 40],
      [-100, 40],
      [-100, 30],
    ],
    [
      [-96, 34],
      [-94, 34],
      [-94, 36],
      [-96, 36],
      [-96, 34],
    ],
  ];
  const small = [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ],
  ];
  const shapes = [
    { code: 'AA', polygons: [square] },
    { code: 'BB', polygons: [small] },
  ];

  it('finds the containing shape', () => {
    expect(inPolygon(-99, 31, square)).toBe(true);
    expect(stateAtPoint(-99, 31, shapes)).toBe('AA');
    expect(stateAtPoint(0.5, 0.5, shapes)).toBe('BB');
  });

  it('returns null outside every shape and inside a hole', () => {
    expect(stateAtPoint(-80, 35, shapes)).toBeNull();
    expect(stateAtPoint(-95, 35, shapes)).toBeNull();
  });
});

describe('normalizeRaw', () => {
  it('maps a valid record into the compact catalogue shape', () => {
    const r = normalizeRaw(raw(), polygonNone);
    expect(r.reason).toBeNull();
    if (r.reason !== null) return;
    expect(r.station).toEqual({
      id: 'a1b2c3d4-0000-4000-8000-000000000001',
      name: 'KTST',
      streamUrl: 'https://stream.test/a',
      homepage: 'https://ktst.test/',
      favicon: 'https://ktst.test/i.png',
      stateCode: 'TX',
      city: 'Austin',
      tags: ['jazz', 'rock'],
      genres: ['rock', 'jazz'],
      codec: 'MP3',
      bitrate: 128,
      hls: false,
      lat: 30.27,
      lng: -97.74,
      clickCount: 42,
    });
    expect(r.stateSource).toBe('name');
    expect(r.coordsDropped).toBe(false);
  });

  it('drops records without uuid or name', () => {
    expect(normalizeRaw(raw({ stationuuid: '' }), polygonNone)).toEqual({ reason: 'junk' });
    expect(normalizeRaw(raw({ name: '  ' }), polygonNone)).toEqual({ reason: 'junk' });
    expect(normalizeRaw(null, polygonNone)).toEqual({ reason: 'junk' });
  });

  it('drops non-https streams, including a resolved http URL', () => {
    expect(normalizeRaw(raw({ url_resolved: 'http://x.test/a' }), polygonNone)).toEqual({ reason: 'non-https' });
    expect(normalizeRaw(raw({ url_resolved: '', url: 'not a url' }), polygonNone)).toEqual({ reason: 'non-https' });
  });

  it('drops unmusical stations with their reason', () => {
    expect(normalizeRaw(raw({ tags: '' }), polygonNone)).toEqual({ reason: 'untagged' });
    expect(normalizeRaw(raw({ tags: 'news' }), polygonNone)).toEqual({ reason: 'hard-exclude' });
    expect(normalizeRaw(raw({ tags: 'public radio' }), polygonNone)).toEqual({ reason: 'no-genre' });
  });

  it('keeps at most five tags', () => {
    const r = normalizeRaw(raw({ tags: 'a1,a2,a3,a4,a5,rock,jazz' }), polygonNone);
    expect(r.reason).toBeNull();
    if (r.reason === null) expect(r.station.tags).toEqual(['a1', 'a2', 'a3', 'a4', 'a5']);
  });

  it('takes the state code from iso before the state text', () => {
    const r = normalizeRaw(raw({ iso_3166_2: 'US-CA', state: 'Texas' }), polygonNone);
    expect(r.reason).toBeNull();
    if (r.reason === null) {
      expect(r.station.stateCode).toBe('CA');
      expect(r.stateSource).toBe('iso');
      expect(r.station.city).toBeNull();
    }
  });

  it('drops the city when the state text disagrees with the iso code', () => {
    const r = normalizeRaw(raw({ iso_3166_2: 'US-CA', state: 'Austin TX' }), polygonNone);
    if (r.reason === null) {
      expect(r.station.stateCode).toBe('CA');
      expect(r.station.city).toBeNull();
    }
  });

  it('uses the polygon state only when the text gives none, and never when there are no coords', () => {
    const polygon = () => 'OK';
    const fromPolygon = normalizeRaw(raw({ state: 'Las Vegas' }), polygon);
    if (fromPolygon.reason === null) {
      expect(fromPolygon.station.stateCode).toBe('OK');
      expect(fromPolygon.stateSource).toBe('polygon');
    }
    const noCoords = normalizeRaw(raw({ state: '', geo_lat: null, geo_long: null }), polygon);
    if (noCoords.reason === null) {
      expect(noCoords.station.stateCode).toBeNull();
      expect(noCoords.stateSource).toBe('null');
    }
  });

  it('drops coordinates outside the US instead of moving them', () => {
    const r = normalizeRaw(raw({ geo_lat: 51.5, geo_long: -0.12 }), polygonNone);
    expect(r.reason).toBeNull();
    if (r.reason === null) {
      expect(r.station).not.toHaveProperty('lat');
      expect(r.station).not.toHaveProperty('lng');
      expect(r.coordsDropped).toBe(true);
    }
  });

  it('drops in-box coordinates that lie in no state and whose state is unknown', () => {
    const ottawa = normalizeRaw(raw({ state: '', geo_lat: 45.4, geo_long: -75.7 }), polygonNone);
    expect(ottawa.reason === null && ottawa.coordsDropped).toBe(true);
    const kept = normalizeRaw(raw({ state: 'Austin TX', geo_lat: 45.4, geo_long: -75.7 }), polygonNone);
    expect(kept.reason === null && kept.station.lat).toBe(45.4);
  });

  it('treats (0,0) and out-of-range coordinates as absent, without counting them as US drops', () => {
    const zero = normalizeRaw(raw({ geo_lat: 0, geo_long: 0 }), polygonNone);
    expect(zero.reason === null && zero.coordsDropped).toBe(false);
    const range = normalizeRaw(raw({ geo_lat: 95, geo_long: -97 }), polygonNone);
    expect(range.reason === null && range.coordsDropped).toBe(false);
  });

  it('returns a null state when nothing is known, and no city', () => {
    const r = normalizeRaw(raw({ state: 'United States', geo_lat: null, geo_long: null }), polygonNone);
    if (r.reason === null) {
      expect(r.station.stateCode).toBeNull();
      expect(r.station.city).toBeNull();
      expect(r.stateSource).toBe('null');
    }
  });

  it('keeps https favicons and http(s) homepages only', () => {
    const r = normalizeRaw(raw({ favicon: 'http://x.test/i.png', homepage: 'javascript:alert(1)' }), polygonNone);
    if (r.reason === null) {
      expect(r.station.favicon).toBeNull();
      expect(r.station.homepage).toBeNull();
    }
  });
});

describe('dedupeCatalog', () => {
  it('removes repeated ids and repeated stream URLs, keeping the first', () => {
    const list = [
      { id: 'a', streamUrl: 'https://x/1' },
      { id: 'a', streamUrl: 'https://x/2' },
      { id: 'b', streamUrl: 'https://x/1' },
      { id: 'c', streamUrl: 'https://x/3' },
    ];
    expect(dedupeCatalog(list).map((s) => s.id)).toEqual(['a', 'c']);
  });
});

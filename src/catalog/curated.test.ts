import { describe, expect, it } from 'vitest';
import {
  checkCuratedEntry,
  curatedRecords,
  curatedToRaw,
  mergeCurated,
  parseCurated,
  radioBrowserStreamKeys,
  streamKey,
  type CuratedEntry,
} from './curated.mjs';
import { dedupeCatalog, normalizeRaw } from './rules.mjs';
import { sanitizeStation } from './sanitize';

const KBZN_STREAM = 'https://capitalslc.cdnstream1.com/2283_96.aac';
// Same as the entry in data/curated-stations.json. curated-build.test.mjs checks the file itself.
const KBZN: CuratedEntry = {
  id: 'curated:kbzn',
  name: 'NOW 97.9 KBZN',
  streamUrl: KBZN_STREAM,
  homepage: 'https://www.kbzn.com',
  favicon: 'https://live.mystreamplayer.com/configs/images/kbzn_icon.png',
  state: 'Utah',
  city: 'Salt Lake City',
  tags: ['hot adult contemporary'],
  codec: 'AAC',
  bitrate: 96,
  lat: 40.7608,
  lng: -111.891,
  source: 'Stream URL from the official player.',
  verified: '2026-11-18',
  coordsSource: 'City centre, not the transmitter.',
};

function entry(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'curated:test-one',
    name: 'Test Station',
    streamUrl: 'https://stream.test/one.mp3',
    homepage: 'https://test.example/',
    favicon: null,
    state: 'Utah',
    city: 'Salt Lake City',
    tags: ['hot adult contemporary'],
    lat: 40.7608,
    lng: -111.891,
    source: 'Checked by hand from the official player.',
    verified: '2026-11-18',
    coordsSource: 'City centre from Wikipedia.',
    ...extra,
  };
}

function doc(stations: unknown[]): unknown {
  return { schemaVersion: 1, stations };
}

function rbRow(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    stationuuid: 'a1b2c3d4-0000-4000-8000-000000000009',
    name: 'Radio Browser Rock',
    url: 'https://rb.test/rock',
    url_resolved: 'https://rb.test/rock',
    homepage: null,
    favicon: null,
    tags: 'rock',
    iso_3166_2: 'US-UT',
    state: 'Utah',
    hls: 0,
    clickcount: 10,
    geo_lat: 40.76,
    geo_long: -111.89,
    ...extra,
  };
}

describe('curated file: validation', () => {
  it('accepts a valid entry', () => {
    expect(checkCuratedEntry(entry())).toEqual([]);
    expect(checkCuratedEntry(KBZN)).toEqual([]);
  });

  it('rejects an http stream', () => {
    expect(checkCuratedEntry(entry({ streamUrl: 'http://stream.test/one.mp3' }))).toEqual([
      'streamUrl must be https, not http',
    ]);
  });

  it('rejects a stream that is not a URL', () => {
    expect(checkCuratedEntry(entry({ streamUrl: 'stream.test/one' }))).toEqual([
      'streamUrl missing or not an https URL',
    ]);
  });

  it.each([
    ['name'],
    ['streamUrl'],
    ['state'],
    ['tags'],
    ['lat'],
    ['lng'],
    ['source'],
    ['verified'],
    ['coordsSource'],
  ])('rejects an entry with no %s', (field) => {
    const e = entry();
    delete e[field];
    expect(checkCuratedEntry(e).length).toBeGreaterThan(0);
  });

  it('rejects a bad id, a non-date verified and a state with a city', () => {
    expect(checkCuratedEntry(entry({ id: 'kbzn' }))).toEqual(['id must look like "curated:kbzn"']);
    expect(checkCuratedEntry(entry({ verified: '18/11/2026' }))).toEqual(['verified must be a date, YYYY-MM-DD']);
    expect(checkCuratedEntry(entry({ state: 'Salt Lake City, Utah' }))).toEqual([
      'state must be a US state name or code, with no city',
    ]);
  });

  it.each([
    ['a string', { lat: '40.76' }],
    ['NaN', { lng: Number.NaN }],
    ['latitude past 90', { lat: 91 }],
    ['longitude past 180', { lng: -181 }],
    ['0,0', { lat: 0, lng: 0 }],
    ['outside the US (London)', { lat: 51.5074, lng: -0.1278 }],
  ])('rejects bad coordinates: %s', (_label, coords) => {
    const problems = checkCuratedEntry(entry(coords));
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(' ')).toMatch(/lat|lng/);
  });

  it('reports each bad entry by index and id, and keeps the good ones', () => {
    const parsed = parseCurated(
      doc([
        entry(),
        entry({ id: 'curated:bad-http', streamUrl: 'http://stream.test/x' }),
        entry({ id: 'curated:bad-coords', lat: 0, lng: 0 }),
        'junk',
      ]),
    );
    expect(parsed.stations.map((s) => s.id)).toEqual(['curated:test-one']);
    expect(parsed.errors).toEqual([
      'stations[1] (curated:bad-http): streamUrl must be https, not http',
      'stations[2] (curated:bad-coords): lat and lng are 0,0',
      'stations[3]: entry is not an object',
    ]);
  });

  it('rejects repeated ids and repeated stream URLs', () => {
    const parsed = parseCurated(
      doc([entry(), entry({ streamUrl: 'https://stream.test/one.mp3' }), entry({ id: 'curated:test-one' })]),
    );
    expect(parsed.errors.join('\n')).toMatch(/duplicate stream URL/);
    expect(parsed.errors.join('\n')).toMatch(/duplicate id/);
  });

  it('returns an error when there is no stations array', () => {
    expect(parseCurated(null).errors).toHaveLength(1);
    expect(parseCurated({ stations: 'nope' }).errors).toHaveLength(1);
  });

  it('the id passes the app sanitiser, so favourites and history can store it', () => {
    const station = sanitizeStation({
      id: 'curated:kbzn',
      name: 'NOW 97.9 KBZN',
      streamUrl: KBZN_STREAM,
      stateCode: 'UT',
      genres: ['pop'],
    });
    expect(station?.id).toBe('curated:kbzn');
  });
});

describe('curated entries through the shared rules', () => {
  it('maps the KBZN format tag to pop and the state to UT, with coordinates', () => {
    const r = normalizeRaw(curatedToRaw(KBZN), null, null);
    if (r.reason !== null) throw new Error(`KBZN was dropped: ${r.reason}`);
    expect(r.by).toBe('tags');
    expect(r.station).toMatchObject({
      id: 'curated:kbzn',
      name: 'NOW 97.9 KBZN',
      streamUrl: KBZN_STREAM,
      stateCode: 'UT',
      city: 'Salt Lake City',
      genres: ['pop'],
      lat: 40.7608,
      lng: -111.891,
    });
  });

  it('gives a curated entry the music rule reason when its tags are not music', () => {
    const talk: CuratedEntry = { ...KBZN, id: 'curated:talk-one', tags: ['news'], streamUrl: 'https://s.test/talk' };
    const [res] = curatedRecords([talk], null);
    expect(res.result).toEqual({ reason: 'hard-exclude' });
  });
});

describe('mergeCurated', () => {
  const rbStation = (streamUrl: string, id = 'a1b2c3d4-0000-4000-8000-000000000009') => {
    const r = normalizeRaw(rbRow({ stationuuid: id, url: streamUrl, url_resolved: streamUrl }), null, null);
    if (r.reason !== null) throw new Error('fixture dropped');
    return r.station;
  };

  it('adds the curated station after the Radio Browser ones when the stream is new', () => {
    const rb = [rbStation('https://rb.test/rock')];
    const rows = [rbRow()];
    const merged = mergeCurated(dedupeCatalog(rb), curatedRecords([KBZN], null), radioBrowserStreamKeys(rows));
    expect(merged.added).toBe(1);
    expect(merged.skipped).toEqual([]);
    expect(merged.dropped).toEqual({});
    expect(merged.stations.map((s) => s.id)).toEqual(['a1b2c3d4-0000-4000-8000-000000000009', 'curated:kbzn']);
  });

  it('skips a curated station when Radio Browser has its stream, and keeps the Radio Browser record', () => {
    const rb = [rbStation(KBZN_STREAM, 'rb-kbzn-uuid-0001')];
    const rows = [rbRow({ stationuuid: 'rb-kbzn-uuid-0001', url: KBZN_STREAM, url_resolved: KBZN_STREAM })];
    const merged = mergeCurated(rb, curatedRecords([KBZN], null), radioBrowserStreamKeys(rows));
    expect(merged.added).toBe(0);
    expect(merged.skipped).toEqual(['curated:kbzn']);
    expect(merged.stations.map((s) => s.id)).toEqual(['rb-kbzn-uuid-0001']);
  });

  it('treats an http twin in Radio Browser as the same stream', () => {
    const rows = [rbRow({ url: 'http://capitalslc.cdnstream1.com/2283_96.aac', url_resolved: null })];
    expect(radioBrowserStreamKeys(rows).has(streamKey(KBZN_STREAM))).toBe(true);
    const merged = mergeCurated([], curatedRecords([KBZN], null), radioBrowserStreamKeys(rows));
    expect(merged.skipped).toEqual(['curated:kbzn']);
    expect(merged.stations).toEqual([]);
  });

  it('skips a station Radio Browser lists even when its rules dropped it', () => {
    const rows = [rbRow({ tags: 'news', url: KBZN_STREAM, url_resolved: KBZN_STREAM })];
    const merged = mergeCurated([], curatedRecords([KBZN], null), radioBrowserStreamKeys(rows));
    expect(merged.skipped).toEqual(['curated:kbzn']);
  });

  it('counts curated entries the rules drop, by reason, and does not add them', () => {
    const talk: CuratedEntry = { ...KBZN, id: 'curated:talk-one', tags: ['talk'], streamUrl: 'https://s.test/talk' };
    const merged = mergeCurated([], curatedRecords([talk], null), new Set());
    expect(merged.added).toBe(0);
    expect(merged.dropped).toEqual({ 'hard-exclude': 1 });
  });
});

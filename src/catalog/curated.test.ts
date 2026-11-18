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

  it('rejects a replaces value that is not a lower-case Radio Browser uuid', () => {
    for (const bad of ['b0dc24e6', 'B0DC24E6-1484-41E8-A18E-25F33AA4DD9C', 'curated:kbzn', 'b0dc24e6-1484-41e8-a18e-25f33aa4dd9']) {
      expect(checkCuratedEntry(entry({ replaces: bad }))).toEqual([
        'replaces must be a Radio Browser stationuuid (lower-case uuid)',
      ]);
    }
    expect(checkCuratedEntry(entry({ replaces: 'b0dc24e6-1484-41e8-a18e-25f33aa4dd9c' }))).toEqual([]);
  });

  it('rejects a repeated replaces', () => {
    const uuid = 'b0dc24e6-1484-41e8-a18e-25f33aa4dd9c';
    const parsed = parseCurated(
      doc([
        entry({ replaces: uuid }),
        entry({ id: 'curated:other', streamUrl: 'https://stream.test/other.mp3', replaces: uuid }),
      ]),
    );
    expect(parsed.errors).toEqual(['stations[1] (curated:other): duplicate replaces']);
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

  it('a curated entry without replaces still loses to the directory on a stream match', () => {
    const rows = [rbRow({ stationuuid: 'rb-kbzn-uuid-0002', url: KBZN_STREAM, url_resolved: KBZN_STREAM })];
    const rb = [rbStation(KBZN_STREAM, 'rb-kbzn-uuid-0002')];
    const merged = mergeCurated(rb, curatedRecords([KBZN], null), radioBrowserStreamKeys(rows), rows);
    expect(merged.skipped).toEqual(['curated:kbzn']);
    expect(merged.replaced).toEqual([]);
    expect(merged.stations.map((s) => s.id)).toEqual(['rb-kbzn-uuid-0002']);
  });

  it('skips a station Radio Browser lists even when its rules dropped it', () => {
    const rows = [rbRow({ tags: 'news', url: KBZN_STREAM, url_resolved: KBZN_STREAM })];
    const merged = mergeCurated([], curatedRecords([KBZN], null), radioBrowserStreamKeys(rows));
    expect(merged.skipped).toEqual(['curated:kbzn']);
  });

  it('skips a curated entry when the directory lists its stream with listener params', () => {
    const rows = [rbRow({ url: `${KBZN_STREAM}?newListeningSessionID=abc&lat=40.7&lon=-111.9`, url_resolved: `${KBZN_STREAM}?newListeningSessionID=abc&lat=40.7&lon=-111.9` })];
    const merged = mergeCurated([], curatedRecords([KBZN], null), radioBrowserStreamKeys(rows), rows);
    expect(merged.skipped).toEqual(['curated:kbzn']);
    expect(merged.added).toBe(0);
  });

  it('counts curated entries the rules drop, by reason, and does not add them', () => {
    const talk: CuratedEntry = { ...KBZN, id: 'curated:talk-one', tags: ['talk'], streamUrl: 'https://s.test/talk' };
    const merged = mergeCurated([], curatedRecords([talk], null), new Set());
    expect(merged.added).toBe(0);
    expect(merged.dropped).toEqual({ 'hard-exclude': 1 });
  });
});

describe('replaces: a curated entry corrects a directory station', () => {
  const KSFI_UUID = 'b0dc24e6-1484-41e8-a18e-25f33aa4dd9c';
  const KSFI_SESSION =
    'https://bonneville.cdnstream1.com/2702_48.aac?aw_0_1st.playerid=Tuner&newListeningSessionID=abc_123&lat=37.4013952&lon=-122.0968448';
  const KSFI_CLEAN = 'https://bonneville.cdnstream1.com/2702_48.aac';
  // The directory record as it was on 2026-11-18: no tags, no coordinates, a session URL.
  const ksfiRow = rbRow({
    stationuuid: KSFI_UUID,
    name: 'FM100.3 - Better Music Better Work Day',
    url: KSFI_SESSION,
    url_resolved: KSFI_SESSION,
    homepage: 'https://fm100.com/',
    tags: '',
    iso_3166_2: null,
    state: null,
    clickcount: 2,
    geo_lat: null,
    geo_long: null,
  });
  const ksfi: CuratedEntry = {
    ...KBZN,
    id: 'curated:ksfi',
    replaces: KSFI_UUID,
    name: 'FM100.3 KSFI',
    streamUrl: KSFI_CLEAN,
    homepage: 'https://fm100.com/',
    favicon: null,
    tags: ['adult contemporary'],
    codec: 'AAC',
    bitrate: 48,
  };
  const directoryKsfi = () => {
    const r = normalizeRaw(ksfiRow, null, null);
    if (r.reason !== null) throw new Error('KSFI directory fixture dropped');
    return r.station;
  };
  const directoryRock = () => {
    const r = normalizeRaw(rbRow(), null, null);
    if (r.reason !== null) throw new Error('rock fixture dropped');
    return r.station;
  };

  it('keeps the uuid and the directory clickCount, and takes the curated fields', () => {
    const rows = [ksfiRow, rbRow()];
    const radio = dedupeCatalog([directoryKsfi(), directoryRock()]);
    const merged = mergeCurated(radio, curatedRecords([ksfi], null), radioBrowserStreamKeys(rows), rows);
    expect(merged.stations.filter((s) => s.id === KSFI_UUID)).toHaveLength(1);
    expect(merged.stations.find((s) => s.id === KSFI_UUID)).toMatchObject({
      id: KSFI_UUID,
      name: 'FM100.3 KSFI',
      streamUrl: KSFI_CLEAN,
      homepage: 'https://fm100.com/',
      stateCode: 'UT',
      city: 'Salt Lake City',
      genres: ['pop'],
      lat: 40.7608,
      lng: -111.891,
      clickCount: 2,
    });
    expect(merged.replaced).toEqual([KSFI_UUID]);
    expect(merged.missing).toEqual([]);
    expect(merged.added).toBe(0);
    expect(JSON.stringify(merged.stations)).not.toMatch(/newListeningSessionID/);
  });

  it('falls back to a curated: id, and reports it as missing, when the uuid is not in the fetch', () => {
    const merged = mergeCurated([], curatedRecords([ksfi], null), new Set(), [rbRow()]);
    expect(merged.missing).toEqual(['curated:ksfi']);
    expect(merged.replaced).toEqual([]);
    expect(merged.added).toBe(1);
    expect(merged.stations.map((s) => s.id)).toEqual(['curated:ksfi']);
  });

  it('does not replace when another directory row lists the clean stream; the directory station stays', () => {
    const other = rbRow({ stationuuid: 'rb-other-0003', url: KSFI_CLEAN, url_resolved: KSFI_CLEAN });
    const rows = [ksfiRow, other];
    const radio = dedupeCatalog([directoryKsfi()]);
    const merged = mergeCurated(radio, curatedRecords([ksfi], null), radioBrowserStreamKeys(rows), rows);
    expect(merged.skipped).toEqual(['curated:ksfi']);
    expect(merged.replaced).toEqual([]);
    expect(merged.stations.map((s) => s.id)).toEqual([KSFI_UUID]);
  });

  it('when the rules drop the replacement, the directory station stays and the drop is counted', () => {
    const talk: CuratedEntry = { ...ksfi, tags: ['talk'] };
    const rows = [ksfiRow];
    const merged = mergeCurated([directoryKsfi()], curatedRecords([talk], null), radioBrowserStreamKeys(rows), rows);
    expect(merged.dropped).toEqual({ 'hard-exclude': 1 });
    expect(merged.replaced).toEqual([]);
    expect(merged.stations.map((s) => s.streamUrl)).toEqual([KSFI_CLEAN]);
  });
});


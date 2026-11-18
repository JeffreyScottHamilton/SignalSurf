// Node-side checks for the curated stations: the committed data file, the build script run on a
// fixture, and the committed public/catalog.json. Plain .mjs so the app typecheck (src, no Node types) does not see it.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { expandCatalogRecord } from './rules.mjs';
import { parseCurated } from './curated.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CURATED_FILE = join(ROOT, 'data', 'curated-stations.json');
const BUILD = join(ROOT, 'scripts', 'build-catalog.mjs');
const KBZN_STREAM = 'https://capitalslc.cdnstream1.com/2283_96.aac';
const KSFI_UUID = 'b0dc24e6-1484-41e8-a18e-25f33aa4dd9c';
const KSFI_CLEAN = 'https://bonneville.cdnstream1.com/2702_48.aac';
const KSFI_SESSION = `${KSFI_CLEAN}?aw_0_1st.playerid=Tuner&newListeningSessionID=abc_123&lat=37.4013952&lon=-122.0968448`;

function rbRow(extra = {}) {
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

/**
 * Runs the build on a raw fixture. The discovered input is an empty stations file in the temp dir, so the result does not
 * depend on the real data/discovered-stations.json. Pass discovered: 'missing' to point at a file that does not exist.
 */
function build(rows, curatedDoc, { discovered = { stations: [] } } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'curated-build-'));
  const rawPath = join(dir, 'raw.json');
  const outPath = join(dir, 'catalog.json');
  writeFileSync(rawPath, JSON.stringify(rows));
  const discoveredPath = join(dir, 'discovered.json');
  if (discovered !== 'missing') writeFileSync(discoveredPath, JSON.stringify(discovered));
  const args = [BUILD, '--raw', rawPath, '--out', outPath, '--discovered', discoveredPath];
  if (curatedDoc !== undefined) {
    const curatedPath = join(dir, 'curated.json');
    writeFileSync(curatedPath, JSON.stringify(curatedDoc));
    args.push('--curated', curatedPath);
  }
  const log = execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { log, catalog: JSON.parse(readFileSync(outPath, 'utf8')) };
}

const fileEntry = (extra = {}) => ({
  id: 'curated:test-one',
  name: 'Test Station',
  streamUrl: 'https://fresh.test/one.mp3',
  state: 'Utah',
  city: 'Salt Lake City',
  tags: ['hot adult contemporary'],
  lat: 40.7608,
  lng: -111.891,
  source: 'Checked by hand.',
  verified: '2026-11-18',
  coordsSource: 'City centre.',
  ...extra,
});

describe('data/curated-stations.json', () => {
  it('is valid and holds KSFI as a correction of the directory station, with its verified fields', () => {
    const parsed = parseCurated(JSON.parse(readFileSync(CURATED_FILE, 'utf8')));
    const ksfi = parsed.stations.find((s) => s.id === 'curated:ksfi');
    expect(ksfi).toMatchObject({
      replaces: KSFI_UUID,
      name: 'FM100.3 KSFI',
      streamUrl: KSFI_CLEAN,
      homepage: 'https://fm100.com/',
      state: 'Utah',
      city: 'Salt Lake City',
      tags: ['adult contemporary'],
      lat: 40.7608,
      lng: -111.891,
      verified: '2026-11-18',
    });
    expect(ksfi.favicon).toBeUndefined();
  });

  it('is valid and holds KBZN with its verified fields', () => {
    const parsed = parseCurated(JSON.parse(readFileSync(CURATED_FILE, 'utf8')));
    expect(parsed.errors).toEqual([]);
    const kbzn = parsed.stations.find((s) => s.id === 'curated:kbzn');
    expect(kbzn).toMatchObject({
      name: 'NOW 97.9 KBZN',
      streamUrl: KBZN_STREAM,
      homepage: 'https://www.kbzn.com',
      favicon: 'https://live.mystreamplayer.com/configs/images/kbzn_icon.png',
      state: 'Utah',
      city: 'Salt Lake City',
      lat: 40.7608,
      lng: -111.891,
      verified: '2026-11-18',
    });
    expect(kbzn.source).toMatch(/live\.mystreamplayer\.com\/kbzn/);
    expect(kbzn.coordsSource).toMatch(/NOT the transmitter/);
  });
});

describe('build-catalog with curated stations', () => {
  it('adds KBZN with state Utah and its coordinates, from the committed curated file', () => {
    const { log, catalog } = build([rbRow()]);
    const kbzn = catalog.stations.find((s) => s.i === 'curated:kbzn');
    expect(kbzn).toMatchObject({ n: 'NOW 97.9 KBZN', u: KBZN_STREAM, s: 'UT', c: 'Salt Lake City', a: 40.7608, o: -111.891 });
    expect(catalog.count).toBe(3);
    expect(log).toMatch(
      /curated \(2 in .*\): added 2, skipped \(Radio Browser has the stream\) 0, dropped by the rules none/,
    );
  });

  it('replaces the directory KSFI record with the clean stream, keeping its uuid and clicks; no record holds the session URL', () => {
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
    const { log, catalog } = build([ksfiRow, rbRow()]);
    const ksfi = catalog.stations.find((s) => s.i === KSFI_UUID);
    expect(ksfi).toMatchObject({
      n: 'FM100.3 KSFI',
      u: KSFI_CLEAN,
      h: 'https://fm100.com/',
      s: 'UT',
      c: 'Salt Lake City',
      t: ['adult contemporary'],
      g: ['pop'],
      a: 40.7608,
      o: -111.891,
      k: 2,
    });
    expect(ksfi.y).toBeUndefined();
    expect(catalog.stations.find((s) => s.i === 'curated:ksfi')).toBeUndefined();
    expect(catalog.stations.filter((s) => s.u === KSFI_CLEAN)).toHaveLength(1);
    expect(JSON.stringify(catalog)).not.toMatch(/newListeningSessionID|lat=37\.4/);
    expect(catalog.count).toBe(3);
    expect(log).toMatch(/curated replaces .*: 1 \(b0dc24e6-1484-41e8-a18e-25f33aa4dd9c\)/);
    expect(log).not.toMatch(/WARNING/);
  });

  it('a KSFI entry whose uuid is not in the fetch is added as curated:ksfi, with a warning', () => {
    const { log, catalog } = build([rbRow()]);
    const ksfi = catalog.stations.find((s) => s.i === 'curated:ksfi');
    expect(ksfi).toMatchObject({ n: 'FM100.3 KSFI', u: KSFI_CLEAN, s: 'UT', a: 40.7608, o: -111.891 });
    expect(log).toMatch(/curated replaces .*: 0/);
  });

  it('skips a curated station whose stream Radio Browser already lists, and keeps the directory record', () => {
    const curated = {
      stations: [
        fileEntry({ id: 'curated:dup-one', streamUrl: 'https://rb.test/rock' }),
        fileEntry({ id: 'curated:fresh-one', streamUrl: 'https://fresh.test/s' }),
      ],
    };
    const { log, catalog } = build([rbRow()], curated);
    expect(catalog.stations.map((s) => s.i)).toEqual([rbRow().stationuuid, 'curated:fresh-one']);
    expect(log).toMatch(/added 1, skipped \(Radio Browser has the stream\) 1/);
  });

  it('a missing discovered file builds with 0 discovered and prints one stat line', () => {
    const { log, catalog } = build([rbRow()], undefined, { discovered: 'missing' });
    expect(log).toMatch(/^discovered: 0 \(file not present\)$/m);
    expect(log).not.toMatch(/^discovered \(/m);
    expect(catalog.count).toBe(3);
  });

  it('fails the build, naming the entry, when the curated file is invalid', () => {
    expect(() => build([rbRow()], { stations: [fileEntry({ streamUrl: 'http://stream.test/x' })] })).toThrow(
      /must be https, not http/,
    );
  });
});

describe('the committed public/catalog.json', () => {
  it('lists KSFI under its directory uuid with the clean stream, Utah, coordinates and pop, and no session URL', () => {
    const built = JSON.parse(readFileSync(join(ROOT, 'public', 'catalog.json'), 'utf8'));
    const found = built.stations.filter((s) => s.i === KSFI_UUID);
    expect(found).toHaveLength(1);
    expect(expandCatalogRecord(found[0])).toMatchObject({
      id: KSFI_UUID,
      name: 'FM100.3 KSFI',
      streamUrl: KSFI_CLEAN,
      homepage: 'https://fm100.com/',
      stateCode: 'UT',
      genres: ['pop'],
      lat: 40.7608,
      lng: -111.891,
    });
    expect(JSON.stringify(built)).not.toMatch(/newListeningSessionID|lat=37\.4/);
  });

  it('lists KBZN as a Utah station with coordinates, and the app expands it', () => {
    const built = JSON.parse(readFileSync(join(ROOT, 'public', 'catalog.json'), 'utf8'));
    const found = built.stations.find((s) => s.i === 'curated:kbzn');
    expect(found).toBeDefined();
    expect(expandCatalogRecord(found)).toMatchObject({
      id: 'curated:kbzn',
      name: 'NOW 97.9 KBZN',
      streamUrl: KBZN_STREAM,
      homepage: 'https://www.kbzn.com',
      stateCode: 'UT',
      genres: ['pop'],
      lat: 40.7608,
      lng: -111.891,
    });
  });
});

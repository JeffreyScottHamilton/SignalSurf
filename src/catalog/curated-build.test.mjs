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

function build(rows, curatedDoc) {
  const dir = mkdtempSync(join(tmpdir(), 'curated-build-'));
  const rawPath = join(dir, 'raw.json');
  const outPath = join(dir, 'catalog.json');
  writeFileSync(rawPath, JSON.stringify(rows));
  const args = [BUILD, '--raw', rawPath, '--out', outPath];
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
    expect(catalog.count).toBe(2);
    expect(log).toMatch(
      /curated \(1 in .*\): added 1, skipped \(Radio Browser has the stream\) 0, dropped by the rules none/,
    );
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

  it('fails the build, naming the entry, when the curated file is invalid', () => {
    expect(() => build([rbRow()], { stations: [fileEntry({ streamUrl: 'http://stream.test/x' })] })).toThrow(
      /must be https, not http/,
    );
  });
});

describe('the committed public/catalog.json', () => {
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

#!/usr/bin/env node
// Builds public/catalog.json: the committed, pre-built US music station catalogue.
// Run with `npm run catalog` (network). `npm run build` never fetches.
//
// Usage: node --use-env-proxy scripts/build-catalog.mjs [--raw <file.json>] [--out <file>] [--curated <file.json>]
//                                                       [--discovered <file.json>]
//   --raw         reuse a saved Radio Browser search response instead of fetching
//   --out         output path (default public/catalog.json)
//   --curated     curated stations file (default data/curated-stations.json)
//   --discovered  discovered stations file (default data/discovered-stations.json; a missing file counts as no discovered stations)
//
// Source: GET <server>/json/stations/search?countrycode=US&hidebroken=true
//         &limit=100000&order=clickcount&reverse=true ; server from /json/servers, fallback de1/de2/fi1.
// The query has no is_https filter. An http:// stream (or favicon) is upgraded to https:// only when its
// host:port also serves an https stream in the same data (httpsHostKeys / upgradeHttpUrl); otherwise it is dropped.
// Curated stations (data/curated-stations.json, src/catalog/curated.mjs) are hand-checked extra stations that
// Radio Browser does not list. They are merged after the Radio Browser stations, through the same rules, and a
// curated entry whose stream is already in the Radio Browser data is skipped. An invalid curated file fails the build.
// Discovered stations (data/discovered-stations.json, from `npm run discover`, src/catalog/discovered.mjs) are merged
// after the curated ones through the same rules. A missing discovered file means no discovered stations; it is not an
// error. Directory and curated stations win: a discovered entry is skipped when
// its stream is already listed, or when a directory or curated station has the same call sign and state. Then the FCC
// transmitter coordinates (data/fcc-stations.json) fill directory stations that have none, when exactly one licence matches
// (scripts/fcc-coords.mjs). Directory coordinates always win.
// Rules (genres, excludes, state parsing, coordinates) live in src/catalog/rules.mjs and are shared
// with the unit tests.
//
// Output shape: { generatedAt: ISO string, source: 'radio-browser', count, stations: [...] }
// Station keys are short to keep the file small (CATALOG_KEYS in src/catalog/rules.mjs; the loader expands them):
//   i id (stationuuid)   n name   u streamUrl (https; url_resolved, else url)   h homepage (http(s) or absent)
//   f favicon (https or absent)   s stateCode (2-letter US state/territory, never guessed)
//   c city (from the raw state text, or absent)   t tags (lower case, max 3)   g genres (ids; [] when none)
//   x hls (present only when true)   a lat, o lng (inside a US box, 4 decimals; absent when none)
//   y uncategorized (present only when true): no tags at all, genres [] ; shows "Genre not listed"
//   k clickCount (directory popularity)
// A key whose value is null, false or an empty list is left out; the app reads a missing key as that empty value.
// codec and bitrate are not written: no screen or player reads them, and the sanitiser fills them with null.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  cleanStreamUrl,
  dedupeCatalog,
  httpsHostKeys,
  normalizeRaw,
  stateAtPoint,
  STATE_BY_FIPS,
  GENRES,
  CATALOG_KEYS,
} from '../src/catalog/rules.mjs';
import {
  curatedRecords,
  mergeCurated,
  parseCurated,
  radioBrowserStreamKeys,
  streamKey,
} from '../src/catalog/curated.mjs';
import { mergeDiscovered, parseDiscovered } from '../src/catalog/discovered.mjs';
import { fillFccCoords, sameCallStation } from './fcc-coords.mjs';
import { parseDataFile } from './fcc-gap.mjs';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const args = process.argv.slice(2);
const argOf = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const rawPath = argOf('--raw');
const outPath = resolve(root, argOf('--out') ?? 'public/catalog.json');
const curatedPath = resolve(root, argOf('--curated') ?? 'data/curated-stations.json');
const discoveredPath = resolve(root, argOf('--discovered') ?? 'data/discovered-stations.json');
const fccPath = resolve(root, 'data/fcc-stations.json');

const DISCOVERY = 'https://all.api.radio-browser.info/json/servers';
const FALLBACK = ['de1', 'de2', 'fi1'].map((h) => `${h}.api.radio-browser.info`);
const SEARCH_QS = 'countrycode=US&hidebroken=true&limit=100000&order=clickcount&reverse=true';
const HOST_RE = /^[a-z0-9-]+\.api\.radio-browser\.info$/;

/** GET JSON through Node fetch (honours --use-env-proxy); falls back to curl when fetch cannot connect. */
async function getJson(url, timeoutMs) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    const body = execFileSync('curl', ['-sS', '--fail', '--max-time', String(Math.ceil(timeoutMs / 1000)), url], {
      maxBuffer: 256 * 1024 * 1024,
    }).toString('utf8');
    if (body.length === 0) throw err;
    return JSON.parse(body);
  }
}

async function loadRaw() {
  if (rawPath) return JSON.parse(readFileSync(resolve(rawPath), 'utf8'));
  let hosts = [];
  try {
    const servers = await getJson(DISCOVERY, 15000);
    hosts = servers.map((e) => String(e?.name ?? '').trim().toLowerCase()).filter((n) => HOST_RE.test(n));
  } catch (err) {
    console.warn(`server discovery failed (${err.message}); using fallback hosts`);
  }
  const all = [...new Set([...hosts, ...FALLBACK])];
  let lastErr = null;
  for (const h of all.slice(0, 4)) {
    try {
      const data = await getJson(`https://${h}/json/stations/search?${SEARCH_QS}`, 240000);
      if (!Array.isArray(data)) throw new Error('unexpected response');
      console.log(`fetched ${data.length} raw US records from ${h}`);
      return data;
    } catch (err) {
      lastErr = err;
      console.warn(`${h} failed: ${err.message}`);
    }
  }
  throw new Error(`no Radio Browser server answered: ${lastErr?.message}`);
}

/** State polygons from us-atlas (FIPS ids mapped to USPS codes). Build time only. */
function loadStateShapes() {
  const topo = require('us-atlas/states-10m.json');
  const topojson = require('topojson-client');
  const fc = topojson.feature(topo, topo.objects.states);
  const shapes = [];
  for (const f of fc.features) {
    const code = STATE_BY_FIPS[String(f.id).padStart(2, '0')];
    if (!code) continue;
    const g = f.geometry;
    if (!g) continue;
    const polygons = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    shapes.push({ code, polygons });
  }
  return shapes;
}

/**
 * Drops keys whose value is the empty value (null, false, []); the app reads a missing key as that value.
 * Keys are written short (CATALOG_KEYS: id -> i, name -> n, ...); the loader expands them.
 */
function compact(station) {
  const out = {};
  for (const [key, value] of Object.entries(station)) {
    if (value === null || value === false) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[CATALOG_KEYS[key] ?? key] = value;
  }
  return out;
}

const pct = (n, d) => (d === 0 ? '0.0' : ((100 * n) / d).toFixed(1));

/** Reads the curated file. Throws, naming every bad entry, when the file is not valid. */
function loadCurated() {
  const { stations, errors } = parseCurated(JSON.parse(readFileSync(curatedPath, 'utf8')));
  if (errors.length > 0) throw new Error(`invalid curated stations in ${curatedPath}:\n  ${errors.join('\n  ')}`);
  return stations;
}

/**
 * Reads the discovered file. A missing file is an empty list (present: false). Any other read error, or any invalid
 * entry, fails the build.
 */
function loadDiscovered() {
  let text;
  try {
    text = readFileSync(discoveredPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { stations: [], present: false };
    throw new Error(`cannot read discovered stations ${discoveredPath} (${err.code ?? err.message})`);
  }
  const { stations, errors } = parseDiscovered(JSON.parse(text));
  if (errors.length > 0) throw new Error(`invalid discovered stations in ${discoveredPath}:\n  ${errors.join('\n  ')}`);
  return { stations, present: true };
}

async function main() {
  const raw = await loadRaw();
  const shapes = loadStateShapes();
  const polygonState = (lng, lat) => stateAtPoint(lng, lat, shapes);
  const httpsKeys = httpsHostKeys(raw);
  const curatedEntries = loadCurated();

  const drop = { junk: 0, 'non-https': 0, untagged: 0, 'hard-exclude': 0, 'no-genre': 0, duplicate: 0 };
  const sources = { iso: 0, name: 0, polygon: 0, null: 0 };
  let coordsDropped = 0;
  let byName = 0;
  const kept = [];
  const upgradedIds = new Map(); // id -> { stream, favicon } for kept stations that were upgraded
  for (const row of raw) {
    const r = normalizeRaw(row, polygonState, httpsKeys);
    if (r.reason) {
      drop[r.reason] = (drop[r.reason] ?? 0) + 1;
      continue;
    }
    sources[r.stateSource] += 1;
    if (r.by === 'name') byName += 1;
    if (r.coordsDropped) coordsDropped += 1;
    if (r.upgraded.stream || r.upgraded.favicon) upgradedIds.set(r.station.id, r.upgraded);
    kept.push(r.station);
  }
  const radio = dedupeCatalog(kept);
  drop.duplicate = kept.length - radio.length;
  const merge = mergeCurated(radio, curatedRecords(curatedEntries, polygonState), radioBrowserStreamKeys(raw), raw);
  for (const id of merge.missing) {
    const entry = curatedEntries.find((e) => e.id === id);
    console.warn(`WARNING ${id} replaces ${entry.replaces}, which is not in the Radio Browser data; added as ${id} with no directory clicks.`);
  }
  const discovered = loadDiscovered();
  const disc = mergeDiscovered(merge.stations, discovered.stations, {
    streamKeys: [...new Set([...radioBrowserStreamKeys(raw), ...merge.stations.map((s) => streamKey(s.streamUrl))])],
    sameStation: sameCallStation,
    polygonState,
  });
  const fill = fillFccCoords(disc.stations, parseDataFile(readFileSync(fccPath, 'utf8')).stations);
  const unique = disc.stations;

  // Upgrade counts over the stations that are in the file (after dedupe).
  const up = { musicStreams: 0, uncategorizedStreams: 0, favicons: 0 };
  for (const s of unique) {
    const u = upgradedIds.get(s.id);
    if (!u) continue;
    if (u.stream) {
      if (s.uncategorized === true) up.uncategorizedStreams += 1;
      else up.musicStreams += 1;
    }
    if (u.favicon) up.favicons += 1;
  }

  const stations = unique.sort((a, b) => b.clickCount - a.clickCount);
  const genreCounts = Object.fromEntries(GENRES.map((g) => [g, 0]));
  let noGenre = 0;
  let withCoords = 0;
  let uncategorized = 0;
  for (const s of stations) {
    if (s.genres.length === 0) noGenre += 1;
    if (s.uncategorized === true) uncategorized += 1;
    for (const g of s.genres) genreCounts[g] += 1;
    if (s.lat !== undefined) withCoords += 1;
  }

  const doc = {
    generatedAt: new Date().toISOString(),
    source: 'radio-browser',
    count: stations.length,
    stations: stations.map(compact),
  };
  const json = JSON.stringify(doc);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, json);
  const bytes = Buffer.byteLength(json);
  const gz = gzipSync(json).length;

  const kept_ = stations.length;
  console.log(`raw ${raw.length}; kept ${kept_} (${pct(kept_, raw.length)}%)`);
  console.log(
    `dropped: untagged (no tags, name excluded) ${drop.untagged}, hard-exclude ${drop['hard-exclude']}, no-genre ${drop['no-genre']}, ` +
      `non-https (no https twin) ${drop['non-https']}, duplicate ${drop.duplicate}, junk ${drop.junk}`,
  );
  console.log(
    `http upgraded to https (host:port also serves https; ${httpsKeys.size} https host keys): ` +
      `streams in music ${up.musicStreams}, streams uncategorized ${up.uncategorizedStreams}, favicons ${up.favicons}`,
  );
  console.log(`genres (a station may count twice): ${GENRES.map((g) => `${g} ${genreCounts[g]}`).join(', ')}`);
  console.log(`admitted by name (no genre from tags): ${byName}`);
  const cleaned = raw.filter((row) => {
    const t = [row?.url_resolved, row?.url].map((v) => (typeof v === 'string' ? v.trim() : '')).find((v) => v !== '');
    return t !== undefined && cleanStreamUrl(t) !== t;
  }).length;
  console.log(`stream URLs cleaned (listener and tracking params removed): ${cleaned} of ${raw.length} raw records`);
  console.log(`uncategorized (no tags at all, kept with genres []): ${uncategorized}`);
  console.log(`genre-less kept (All only): ${noGenre}`);
  console.log(`with coords: ${withCoords}; coords dropped as outside US: ${coordsDropped}`);
  console.log(`stateCode sources: iso ${sources.iso}, name ${sources.name}, polygon ${sources.polygon}, null ${sources.null}`);
  const droppedCurated = Object.entries(merge.dropped).map(([r, n]) => `${r} ${n}`).join(', ') || 'none';
  const droppedDisc = Object.entries(disc.dropped).map(([r, n]) => `${r} ${n}`).join(', ') || 'none';
  console.log(
    `curated (${curatedEntries.length} in ${curatedPath}): added ${merge.added}, ` +
      `skipped (Radio Browser has the stream) ${merge.skipped.length}, dropped by the rules ${droppedCurated}`,
  );
  console.log(
    `curated replaces (directory station corrected, its id and clicks kept): ${merge.replaced.length}` +
      (merge.replaced.length > 0 ? ` (${merge.replaced.join(', ')})` : ''),
  );
  if (discovered.present) {
    console.log(
      `discovered (${discovered.stations.length} in ${discoveredPath}): added ${disc.added}, ` +
        `skipped (stream already listed) ${disc.skipped.stream.length}, ` +
        `skipped (same call sign and state as a directory or curated station) ${disc.skipped.call.length}, ` +
        `dropped by the rules ${droppedDisc}`,
    );
  } else {
    console.log('discovered: 0 (file not present)');
  }
  console.log(`FCC coordinates filled (directory stations with none, one licence matches): ${fill.filled}; ambiguous, left without: ${fill.ambiguous}`);
  console.log(`file ${outPath}: raw ${bytes} bytes (${(bytes / 1024).toFixed(0)} KiB), gzip ${gz} bytes`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

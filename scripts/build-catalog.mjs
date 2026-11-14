#!/usr/bin/env node
// Builds public/catalog.json: the committed, pre-built US music station catalogue.
// Run with `npm run catalog` (network). `npm run build` never fetches.
//
// Usage: node --use-env-proxy scripts/build-catalog.mjs [--raw <file.json>] [--out <file>]
//   --raw  reuse a saved Radio Browser search response instead of fetching
//   --out  output path (default public/catalog.json)
//
// Source: GET <server>/json/stations/search?countrycode=US&hidebroken=true&is_https=true
//         &limit=100000&order=clickcount&reverse=true ; server from /json/servers, fallback de1/de2/fi1.
// Rules (genres, excludes, state parsing, coordinates) live in src/catalog/rules.mjs and are shared
// with the unit tests.
//
// Output shape: { generatedAt: ISO string, source: 'radio-browser', count, stations: [...] }
// Station keys are the app's Station fields. To keep the file small, a key whose value is null, false or
// an empty list is left out; the app's sanitiser reads a missing key as that empty value.
//   id           stationuuid
//   name         display name
//   streamUrl    https stream URL (url_resolved, else url)
//   homepage     http(s) URL or null
//   favicon      https URL or null
//   stateCode    2-letter US state/territory code or null (never guessed)
//   city         city text from the raw state field, or null
//   tags         lower-case tags, max 5
//   genres       genre ids (may be [] for bare "music" / "variety" stations)
//   codec        string or null
//   bitrate      kbps or null
//   hls          boolean
//   lat, lng     coordinates inside a US box; keys omitted when there are none
//   clickCount   directory click count (popularity)

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  dedupeCatalog,
  normalizeRaw,
  stateAtPoint,
  STATE_BY_FIPS,
  GENRES,
} from '../src/catalog/rules.mjs';

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

const DISCOVERY = 'https://all.api.radio-browser.info/json/servers';
const FALLBACK = ['de1', 'de2', 'fi1'].map((h) => `${h}.api.radio-browser.info`);
const SEARCH_QS = 'countrycode=US&hidebroken=true&is_https=true&limit=100000&order=clickcount&reverse=true';
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

/** Drops keys whose value is the empty value (null, false, []); the app reads a missing key as that value. */
function compact(station) {
  const out = {};
  for (const [key, value] of Object.entries(station)) {
    if (value === null || value === false) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

const pct = (n, d) => (d === 0 ? '0.0' : ((100 * n) / d).toFixed(1));

async function main() {
  const raw = await loadRaw();
  const shapes = loadStateShapes();
  const polygonState = (lng, lat) => stateAtPoint(lng, lat, shapes);

  const drop = { junk: 0, 'non-https': 0, untagged: 0, 'hard-exclude': 0, 'no-genre': 0, duplicate: 0 };
  const sources = { iso: 0, name: 0, polygon: 0, null: 0 };
  let coordsDropped = 0;
  const kept = [];
  for (const row of raw) {
    const r = normalizeRaw(row, polygonState);
    if (r.reason) {
      drop[r.reason] = (drop[r.reason] ?? 0) + 1;
      continue;
    }
    sources[r.stateSource] += 1;
    if (r.coordsDropped) coordsDropped += 1;
    kept.push(r.station);
  }
  const unique = dedupeCatalog(kept);
  drop.duplicate = kept.length - unique.length;

  const stations = unique.sort((a, b) => b.clickCount - a.clickCount);
  const genreCounts = Object.fromEntries(GENRES.map((g) => [g, 0]));
  let noGenre = 0;
  let withCoords = 0;
  for (const s of stations) {
    if (s.genres.length === 0) noGenre += 1;
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
  const gz = gzipSync(json).length;

  const kept_ = stations.length;
  console.log(`raw ${raw.length}; kept ${kept_} (${pct(kept_, raw.length)}%)`);
  console.log(
    `dropped: untagged ${drop.untagged}, hard-exclude ${drop['hard-exclude']}, no-genre ${drop['no-genre']}, ` +
      `non-https ${drop['non-https']}, duplicate ${drop.duplicate}, junk ${drop.junk}`,
  );
  console.log(`genres (a station may count twice): ${GENRES.map((g) => `${g} ${genreCounts[g]}`).join(', ')}`);
  console.log(`genre-less kept (All only): ${noGenre}`);
  console.log(`with coords: ${withCoords}; coords dropped as outside US: ${coordsDropped}`);
  console.log(`stateCode sources: iso ${sources.iso}, name ${sources.name}, polygon ${sources.polygon}, null ${sources.null}`);
  console.log(`file ${outPath}: raw ${json.length} bytes (${(json.length / 1024).toFixed(0)} KB), gzip ${gz} bytes`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

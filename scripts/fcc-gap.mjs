#!/usr/bin/env node
// FCC coverage report: how many licensed US broadcast stations the catalogue covers, per state.
// Run with `npm run coverage` (network). Nothing here runs at build or app time.
//
// Usage: node --use-env-proxy scripts/fcc-gap.mjs [--offline] [--missing <file.json>]
//   --offline   reuse data/fcc-stations.json instead of querying the FCC
//   --missing   also write the unmatched full-power FM and AM stations to this file (scratch; not committed)
//
// Source: FCC public data (US government, public domain). Three no-state queries, status filtered locally
// because the server ignores status=:
//   fmq serv=FM  (full-power FM)   fmq serv=FL  (LPFM)   amq (AM)
// Outputs: data/fcc-stations.json (compact, one row per licence facility) and docs/coverage.md.
// The catalogue (public/catalog.json) is read only. It is never written.
//
// Pure parsers and matchers are exported for scripts/fcc-gap.test.mjs. The main run is skipped on import.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expandCatalogRecord } from '../src/catalog/rules.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const DATA_PATH = resolve(root, 'data/fcc-stations.json');
const CATALOG_PATH = resolve(root, 'public/catalog.json');
const DOC_PATH = resolve(root, 'docs/coverage.md');
const UA = 'RoadtripRadio-coverage/1.0';
const FCC = 'https://transition.fcc.gov/fcc-bin';

/** The three FCC queries. The server ignores `status` and `size`; rows are filtered by status and country locally. */
export const FCC_QUERIES = [
  { service: 'FM', url: `${FCC}/fmq?serv=FM&status=L&list=4&size=9` },
  { service: 'FL', url: `${FCC}/fmq?serv=FL&status=L&list=4&size=9` },
  { service: 'AM', url: `${FCC}/amq?status=L&list=4&size=9` },
];

const KEPT_SERVICES = new Set(['FM', 'FL', 'AM']);
const US_STATE_CODES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA',
  'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR',
  'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
];

const NUM = /^\d+(\.\d+)?$/;

/**
 * DMS to signed decimal degrees. Hemisphere S or W is negative. Returns null for bad input.
 * dmsToDecimal('109', '27', '42.4', 'W') === -109.4612 (rounded to 6 places).
 */
export function dmsToDecimal(deg, min, sec, hemi) {
  if (![deg, min, sec].every((v) => NUM.test(String(v).trim()))) return null;
  const d = Number(deg);
  const m = Number(min);
  const s = Number(sec);
  if (m >= 60 || s >= 60) return null;
  let v = d + m / 60 + s / 3600;
  if (hemi === 'S' || hemi === 'W') v = -v;
  else if (hemi !== 'N' && hemi !== 'E') return null;
  return Math.round(v * 1e6) / 1e6;
}

/**
 * Parses one pipe-delimited FCC row (fmq or amq). Returns null for lines that are not rows.
 * Columns, after split('|') and trim: [1] call, [2] frequency ("88.1  MHz" or "570   kHz"), [3] service,
 * [9] status, [10] city, [11] state, [12] country, [13] file number, then ERP and HAAT,
 * then the facility id, then N/S, lat D M S, E/W, lng D M S, then the licensee.
 * The coordinate block is located by its pattern, not by a fixed column, because AM rows have fewer power columns.
 */
export function parseFccRow(line) {
  if (typeof line !== 'string' || !line.startsWith('|')) return null;
  const f = line.split('|').map((s) => s.trim());
  if (f.length < 28) return null;
  let at = -1;
  for (let i = 14; i + 8 < f.length; i++) {
    if ((f[i] === 'N' || f[i] === 'S') && (f[i + 4] === 'E' || f[i + 4] === 'W')) {
      if ([1, 2, 3, 5, 6, 7].every((k) => NUM.test(f[i + k]))) {
        at = i;
        break;
      }
    }
  }
  const freqMatch = /^([\d.]+)\s*(MHz|kHz)$/.exec(f[2] ?? '');
  const lat = at < 0 ? null : dmsToDecimal(f[at + 1], f[at + 2], f[at + 3], f[at]);
  const lng = at < 0 ? null : dmsToDecimal(f[at + 5], f[at + 6], f[at + 7], f[at + 4]);
  return {
    call: callBase(f[1]),
    band: f[3] === 'AM' ? 'AM' : 'FM',
    freq: freqMatch ? Number(freqMatch[1]) : null,
    service: f[3],
    status: f[9],
    city: f[10] || null,
    state: f[11] || null,
    country: f[12] || null,
    lat,
    lng,
    facilityId: at < 0 ? null : f[at - 1] || null,
    licensee: f[at + 8] || null,
  };
}

/** Call sign without a service suffix: "KSFI-FM" to "KSFI". Upper case. */
export function callBase(call) {
  return String(call ?? '').trim().replace(/-(FM|AM|LP|CD|FL)$/i, '').trim().toUpperCase();
}

/**
 * Keeps licensed US full-power FM, LPFM and AM rows. Dedupes by facility id (a station with day and night
 * rows, or several licence records, is one facility). Rows without a facility id dedupe on service+call+freq+city.
 */
export function licensedStations(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (!r || r.status !== 'LIC' || r.country !== 'US' || !KEPT_SERVICES.has(r.service) || !r.call || r.freq == null) continue;
    const key = r.facilityId ? `id:${r.facilityId}` : `k:${r.service}|${r.call}|${r.freq}|${r.city}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** Host of a URL, lower case, or null. */
export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * True when the call sign is a whole word in a station name. Accepted forms: the call in upper case
 * ("KSFI", "FM100.3 KSFI", "KSFI-FM", "KSFI FM"); a mixed or lower case call only when followed by FM or AM
 * ("Ksfi FM"), and only for calls of four or more letters, so ordinary words such as "who" do not match.
 */
export function callInName(call, name) {
  if (!call || !name) return false;
  const c = callBase(call);
  if (!/^[A-Z]{3,4}$/.test(c)) return false;
  if (new RegExp(`(?<![A-Za-z0-9])${c}(?![A-Za-z0-9])`).test(name)) return true;
  if (c.length >= 4) {
    const loose = new RegExp(`(?<![A-Za-z0-9])${c}(?![A-Za-z0-9])[\\s-]*(FM|AM)\\b`, 'i');
    return loose.test(name);
  }
  return false;
}

/** True when the call sign is a whole label of the homepage host ("ksfi.example.com", "kbznfm.com" also count). */
export function callInHost(call, homepage) {
  const c = callBase(call).toLowerCase();
  const host = hostOf(homepage);
  if (!host || c.length < 3) return false;
  return host.split('.').some((label) => label === c || label === `${c}fm` || label === `${c}am`);
}

/** Frequency in a station name with its band word or unit. FM "100.3" (or "FM100.3"). AM "570 AM", "AM 570", "570 kHz". */
export function freqInName(station, name) {
  if (!name || station.freq == null) return false;
  if (station.band === 'FM') {
    const s = station.freq.toFixed(1).replace('.', '\\.');
    return new RegExp(`(?<![\\d.])${s}(?!\\d)`).test(name);
  }
  const k = String(Math.round(station.freq));
  return new RegExp(`\\bAM\\s*${k}(?![\\d.])|(?<![\\d.])${k}\\s*(AM|kHz)\\b`, 'i').test(name);
}

/** Catalogue state agrees with the FCC state, or the catalogue record has no state. */
export function stateAgrees(stationState, recState) {
  return recState == null || recState === stationState;
}

/** Great-circle distance in km between two {lat, lng} points. */
export function haversineKm(a, b) {
  const rad = (x) => (x * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Place evidence for a frequency match. With coordinates on both sides, the catalogue point must be within
 * PROBABLE_KM of the licence point. Without them, the city names must agree. With neither, there is no evidence.
 */
export const PROBABLE_KM = 60;
export function placeAgrees(station, rec) {
  if (rec.lat != null && rec.lng != null && station.lat != null && station.lng != null) {
    return haversineKm({ lat: station.lat, lng: station.lng }, { lat: rec.lat, lng: rec.lng }) <= PROBABLE_KM;
  }
  const norm = (c) => String(c ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  return Boolean(rec.city && station.city) && norm(rec.city) === norm(station.city);
}

/**
 * Classifies one FCC station against candidate catalogue records (state-filtered by the caller).
 * Returns { how: 'call' | 'probable' | null, freqOnly }. freqOnly is true when a frequency and state match
 * exists but no place evidence supports it; such matches are reported, not counted as probable.
 */
export function classifyStation(station, candidates) {
  const inState = candidates.filter((r) => stateAgrees(station.state, r.stateCode));
  if (inState.some((r) => callInName(station.call, r.name) || callInHost(station.call, r.homepage))) {
    return { how: 'call', freqOnly: false };
  }
  const freqRecs = inState.filter((r) => freqInName(station, r.name));
  if (freqRecs.some((r) => placeAgrees(station, r))) return { how: 'probable', freqOnly: false };
  return { how: null, freqOnly: freqRecs.length > 0 };
}

/** Counts per service and per state, and the unmatched full-power list. Catalogue records are read, never changed. */
export function buildReport(stations, catalogRecords) {
  const byState = new Map();
  const noState = [];
  for (const rec of catalogRecords) {
    if (rec.stateCode == null) noState.push(rec);
    else {
      if (!byState.has(rec.stateCode)) byState.set(rec.stateCode, []);
      byState.get(rec.stateCode).push(rec);
    }
  }
  const catalogByState = new Map();
  for (const rec of catalogRecords) {
    if (rec.stateCode != null) catalogByState.set(rec.stateCode, (catalogByState.get(rec.stateCode) ?? 0) + 1);
  }
  const blank = () => ({ licensed: 0, call: 0, probable: 0, freqOnly: 0, missing: 0 });
  const services = { FM: blank(), FL: blank(), AM: blank() };
  const states = new Map();
  const missingFull = [];
  const candCache = new Map();
  for (const s of stations) {
    if (!candCache.has(s.state)) candCache.set(s.state, [...(byState.get(s.state) ?? []), ...noState]);
    const { how, freqOnly } = classifyStation(s, candCache.get(s.state));
    const bucket = (b) => {
      b.licensed++;
      if (how === 'call') b.call++;
      else if (how === 'probable') b.probable++;
      else {
        b.missing++;
        if (freqOnly) b.freqOnly++;
      }
    };
    bucket(services[s.service]);
    const st = s.state ?? '??';
    if (!states.has(st)) states.set(st, blank());
    bucket(states.get(st));
    if (!how && (s.service === 'FM' || s.service === 'AM')) {
      missingFull.push({ call: s.call, band: s.band, freq: s.freq, service: s.service, city: s.city, state: s.state, licensee: s.licensee });
    }
  }
  const total = blank();
  for (const b of Object.values(services)) {
    total.licensed += b.licensed;
    total.call += b.call;
    total.probable += b.probable;
    total.freqOnly += b.freqOnly;
    total.missing += b.missing;
  }
  return { services, total, states, catalogByState, missingFull, catalogCount: catalogRecords.length };
}

/** Top licensees among missing full-power stations. Names are trimmed and upper-cased for grouping. */
export function topLicensees(missingFull, n = 20) {
  const counts = new Map();
  for (const m of missingFull) {
    const k = (m.licensee ?? '(none)').replace(/\s+/g, ' ').trim().toUpperCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
}

/** Compact data file: a fields header and one array per station, one station per line. */
export const DATA_FIELDS = ['call', 'band', 'freq', 'service', 'city', 'state', 'lat', 'lng', 'facilityId', 'licensee'];

export function serializeData({ source, fetched, queries, raw, stations }) {
  const head = JSON.stringify({ source, fetched, queries, raw, count: stations.length, fields: DATA_FIELDS }, null, 0);
  const rows = stations.map((s) => '  ' + JSON.stringify(DATA_FIELDS.map((k) => s[k] ?? null)));
  return `${head.slice(0, -1)},\n"rows": [\n${rows.join(',\n')}\n]\n}\n`;
}

export function parseDataFile(text) {
  const d = JSON.parse(text);
  return {
    ...d,
    stations: d.rows.map((r) => Object.fromEntries(DATA_FIELDS.map((k, i) => [k, r[i]]))),
  };
}

function pct(n, d) {
  return d ? `${((100 * n) / d).toFixed(1)}%` : '-';
}

function renderDoc({ data, report, catalogGeneratedAt, date }) {
  const { services, total, states, catalogByState, catalogCount } = report;
  const lines = [];
  const row = (label, b) => `| ${label} | ${b.licensed} | ${b.call} (${pct(b.call, b.licensed)}) | ${b.probable} (${pct(b.probable, b.licensed)}) | ${b.missing} (${pct(b.missing, b.licensed)}) | ${b.freqOnly} |`;
  lines.push('# FCC coverage: licensed US broadcast stations and the catalogue', '');
  lines.push(`Generated by \`npm run coverage\` (\`scripts/fcc-gap.mjs\`) on ${date}. Re-run the script to refresh; do not edit the numbers by hand.`, '');
  lines.push('## Source and date', '');
  lines.push(`- Licence data: FCC public data (US government, public domain). Queries (no state, status filtered locally): ${data.queries.join('; ')}.`);
  lines.push(`- Fetched ${data.fetched}. Stations kept in \`data/fcc-stations.json\`: ${data.count} (status LIC, country US, full-power FM, LPFM and AM; one row per facility id).`);
  lines.push(`- Catalogue: \`public/catalog.json\`, generated ${catalogGeneratedAt}, ${catalogCount} records. Read only.`, '');
  lines.push('## US totals by service', '');
  lines.push('| Service | Licensed | Matched by call sign | Probable by frequency and place | Missing | Frequency and state only (not counted) |', '|---|---:|---:|---:|---:|---:|');
  lines.push(row('FM (full power)', services.FM), row('FL (LPFM)', services.FL), row('AM', services.AM), row('**All**', total), '');
  lines.push(`"Matched by call sign": a catalogue record's name has the call sign as a whole word (for example "KSFI-FM" or "KSFI FM"), or its homepage host has it as a label, and the state agrees or the record has no state. "Probable": no call sign match, but a record's name has the frequency (with FM, or AM / kHz), the state agrees, and the place agrees: the catalogue point is within ${PROBABLE_KM} km of the licence point, or, with no coordinates, the city names are equal. "Missing": neither. The last column counts stations where only a frequency and state match exists (no place evidence). Those are not counted as probable, so they are not subtracted from missing.`, '');
  lines.push('## Per state, sorted by missing count', '');
  lines.push('| State | Licensed (FM+FL+AM) | Matched | Probable | Missing | Catalogue records with this state |', '|---|---:|---:|---:|---:|---:|');
  const rows = [...states.entries()].sort((a, b) => b[1].missing - a[1].missing || a[0].localeCompare(b[0]));
  for (const [st, b] of rows) {
    lines.push(`| ${st} | ${b.licensed} | ${b.call} | ${b.probable} | ${b.missing} | ${catalogByState.get(st) ?? 0} |`);
  }
  lines.push('', 'Territories (PR, VI, GU, AS, MP) appear in the table and the totals when FCC lists them; the app covers the 50 states and DC.', '');
  lines.push('## Methods and limits', '');
  lines.push(
    '- Name matching misses stations. A station whose catalogue entry has no call sign, a different name, or a different state is counted as missing. "Missing" means "not found by this check", not "not in the app".',
    '- Frequency matching is a weak signal. Many stations share a frequency in one state, so a frequency match alone is not evidence. Probable needs a place match as well (see the table note), and frequency-only matches are shown but not counted.',
    '- Records with no state in the catalogue are compared with every state. This can match a call sign to a wrong station with the same call letters.',
    '- FCC data has no genre. Music versus talk, news or sports is unknown for every station here, so these numbers do not say how many music stations are missing.',
    '- The FCC list covers licences only. Construction permits (CP), applications and silent or modified records are excluded, as are translators (FX) and boosters (FB).',
    '- Several licence records for one facility are counted once (deduped by facility id). Day and night AM rows are one station.',
    '- The FCC queries do not honour `status`, so non-LIC rows are dropped in the script. Service, country and status are checked on every row.',
    '- Coordinates are converted from degrees, minutes and seconds to decimal. Hemisphere letters set the sign.',
    '',
  );
  lines.push('## Largest licensees among missing full-power stations', '');
  lines.push('| Licensee | Missing FM and AM stations |', '|---|---:|');
  for (const [name, n] of topLicensees(report.missingFull, 20)) lines.push(`| ${name.replace(/\|/g, '\\|')} | ${n} |`);
  lines.push('');
  return lines.join('\n');
}

async function getText(url) {
  const timeoutMs = 120000;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    // fetch could not connect: fall back to curl (honours the proxy env vars).
    const body = execFileSync('curl', ['-sS', '--fail', '-A', UA, '--max-time', String(timeoutMs / 1000), url], {
      maxBuffer: 256 * 1024 * 1024,
    }).toString('utf8');
    if (body.length === 0) throw err;
    return body;
  }
}

async function fetchFcc(date) {
  const raw = {};
  const rows = [];
  for (const q of FCC_QUERIES) {
    const text = await getText(q.url);
    const parsed = text.split('\n').map(parseFccRow).filter(Boolean);
    if (parsed.length === 0) throw new Error(`no rows parsed from ${q.url}`);
    raw[q.service] = parsed.length;
    rows.push(...parsed);
    console.log(`${q.service}: ${parsed.length} rows`);
  }
  const stations = licensedStations(rows).map((s) => ({
    call: s.call, band: s.band, freq: s.freq, service: s.service, city: s.city, state: s.state,
    lat: s.lat, lng: s.lng, facilityId: s.facilityId, licensee: s.licensee,
  }));
  return {
    source: 'FCC public data (transition.fcc.gov fmq and amq), public domain',
    fetched: date,
    queries: FCC_QUERIES.map((q) => q.url),
    raw,
    stations,
  };
}

function argOf(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

async function main() {
  const args = process.argv.slice(2);
  const date = new Date().toISOString().slice(0, 10);
  const missingOut = argOf(args, '--missing');
  let data;
  if (args.includes('--offline')) {
    data = parseDataFile(readFileSync(DATA_PATH, 'utf8'));
  } else {
    data = await fetchFcc(date);
    writeFileSync(DATA_PATH, serializeData(data));
  }
  const cat = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
  const records = cat.stations.map(expandCatalogRecord);
  const report = buildReport(data.stations, records);
  writeFileSync(DOC_PATH, renderDoc({
    data: { ...data, count: data.stations.length, queries: data.queries.map((q) => q.replace(/^https:\/\/transition\.fcc\.gov\/fcc-bin\//, '')) },
    report,
    catalogGeneratedAt: cat.generatedAt,
    date: data.fetched ?? date,
  }));
  if (missingOut) writeFileSync(resolve(missingOut), JSON.stringify(report.missingFull, null, 1) + '\n');
  const t = report.total;
  console.log(`stations ${data.stations.length}: licensed ${t.licensed}, call ${t.call}, probable ${t.probable}, missing ${t.missing}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

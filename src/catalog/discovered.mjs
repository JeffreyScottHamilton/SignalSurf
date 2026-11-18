// Discovered stations: licensed US music stations found by scripts/discover-streams.mjs, with an official
// Triton (StreamTheWorld) livestream-redirect URL. The source file is data/discovered-stations.json (rules in
// docs/data-source.md, "Discovered stations"). Plain ES module shared by scripts/build-catalog.mjs (Node) and the
// unit tests. It imports only ./rules.mjs and ./curated.mjs and never an app module.
//
// A discovered entry goes through the same normalizeRaw rules as a directory record (https stream, music tags,
// coordinates in a US box, state text). Directory and curated stations win: an entry is skipped when its stream
// is already listed (cleaned stream URL, http or https), or when a directory or curated station has the same call
// sign in the same state (the caller supplies sameStation, which uses the FCC matcher in scripts/fcc-gap.mjs).

import { inUsBox, normalizeRaw, STATE_NAMES } from './rules.mjs';
import { streamKey } from './curated.mjs';

/** Discovered ids: "fcc:" then the FCC facility id (digits). */
export const DISCOVERED_ID_RE = /^fcc:\d+$/;
const CALL_RE = /^[A-Z]{3,4}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

function httpsOk(v) {
  if (!nonEmpty(v)) return false;
  try {
    return new URL(v.trim()).protocol === 'https:';
  } catch {
    return false;
  }
}

/** The problems with one entry. An empty list means the entry is valid. */
export function checkDiscoveredEntry(e) {
  if (typeof e !== 'object' || e === null || Array.isArray(e)) return ['entry is not an object'];
  const problems = [];
  if (!(typeof e.id === 'string' && DISCOVERED_ID_RE.test(e.id))) problems.push('id must look like "fcc:123456"');
  if (!(typeof e.call === 'string' && CALL_RE.test(e.call))) problems.push('call must be a 3 or 4 letter call sign in upper case');
  if (e.band !== 'FM' && e.band !== 'AM') problems.push('band must be FM or AM');
  if (typeof e.freq !== 'number' || !Number.isFinite(e.freq) || e.freq <= 0) problems.push('freq must be a positive number');
  if (!nonEmpty(e.name)) problems.push('name missing');
  if (!httpsOk(e.streamUrl)) problems.push('streamUrl missing or not an https URL');
  if (e.homepage != null && !(typeof e.homepage === 'string' && /^https?:\/\//i.test(e.homepage))) {
    problems.push('homepage must be an http(s) URL or null');
  }
  if (!(typeof e.state === 'string' && /^[A-Z]{2}$/.test(e.state) && STATE_NAMES[e.state] !== undefined)) {
    problems.push('state must be a US state or DC code');
  }
  if (e.city != null && !nonEmpty(e.city)) problems.push('city must be a non-empty string or null');
  if (!Array.isArray(e.tags) || e.tags.length === 0 || !e.tags.every((t) => nonEmpty(t) && !t.includes(','))) {
    problems.push('tags must be a non-empty list of tag strings (no commas)');
  }
  const { lat, lng } = e;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    problems.push('lat and lng must be numbers');
  } else if (!inUsBox(lat, lng)) {
    problems.push('lat and lng are outside the US');
  }
  if (!nonEmpty(e.coordsSource)) problems.push('coordsSource missing');
  if (!nonEmpty(e.wikiTitle)) problems.push('wikiTitle missing');
  if (!(nonEmpty(e.tritonMount) && e.tritonMount.startsWith(String(e.call)))) {
    problems.push('tritonMount must start with the call sign');
  }
  if (!nonEmpty(e.codec)) problems.push('codec missing (the Triton audio codec)');
  if (!nonEmpty(e.source)) problems.push('source missing');
  if (!(typeof e.verified === 'string' && DATE_RE.test(e.verified) && !Number.isNaN(Date.parse(e.verified)))) {
    problems.push('verified must be a date, YYYY-MM-DD');
  }
  return problems;
}

/**
 * Validates a parsed discovered file. Returns { stations, errors }: stations are the valid entries in file order;
 * errors name each bad entry. Repeated ids and repeated stream URLs are errors too.
 */
export function parseDiscovered(doc) {
  const stations = [];
  const errors = [];
  if (typeof doc !== 'object' || doc === null || !Array.isArray(doc.stations)) {
    return { stations, errors: ['the file must be an object with a stations array'] };
  }
  const ids = new Set();
  const keys = new Set();
  doc.stations.forEach((e, i) => {
    const label = `stations[${i}]${typeof e?.id === 'string' ? ` (${e.id})` : ''}`;
    const problems = checkDiscoveredEntry(e);
    if (problems.length === 0) {
      if (ids.has(e.id)) problems.push('duplicate id');
      if (keys.has(streamKey(e.streamUrl))) problems.push('duplicate stream URL');
    }
    if (problems.length > 0) {
      for (const p of problems) errors.push(`${label}: ${p}`);
      return;
    }
    ids.add(e.id);
    keys.add(streamKey(e.streamUrl));
    stations.push(e);
  });
  return { stations, errors };
}

/** The entry as a directory record, so that normalizeRaw applies the same rules to both. */
export function discoveredToRaw(e) {
  return {
    stationuuid: e.id,
    name: e.name,
    url: e.streamUrl,
    url_resolved: e.streamUrl,
    homepage: e.homepage ?? null,
    favicon: null,
    tags: e.tags.join(','),
    iso_3166_2: `US-${e.state}`,
    state: e.city ? `${e.city}, ${e.state}` : e.state,
    hls: 0,
    clickcount: 0,
    geo_lat: e.lat,
    geo_long: e.lng,
  };
}

/**
 * Adds the discovered stations after the directory and curated stations.
 *
 * stations: the directory and curated station records (not changed).
 * entries: the valid discovered entries (parseDiscovered).
 * options.streamKeys: stream keys (streamKey) that are already listed: the Radio Browser rows, kept or not, and the
 *   kept stations. A discovered entry with one of them is skipped.
 * options.sameStation(entry, station): true when the station is the same licensed station (call sign and state).
 *   Compared with the directory and curated stations only, not with other discovered entries (an FM and an AM with
 *   the same call letters are two stations).
 * options.polygonState: as in normalizeRaw.
 *
 * Returns { stations, added, skipped: { stream: [id], call: [id] }, dropped: { reason: count } }.
 * The stations array is new; the inputs are not changed.
 */
export function mergeDiscovered(stations, entries, options) {
  const { streamKeys, sameStation, polygonState = null } = options;
  const keys = new Set(streamKeys);
  const out = [...stations];
  const skipped = { stream: [], call: [] };
  const dropped = {};
  let added = 0;
  for (const e of entries) {
    const key = streamKey(e.streamUrl);
    if (keys.has(key)) {
      skipped.stream.push(e.id);
      continue;
    }
    const result = normalizeRaw(discoveredToRaw(e), polygonState, null);
    if (result.reason) {
      dropped[result.reason] = (dropped[result.reason] ?? 0) + 1;
      continue;
    }
    if (stations.some((s) => sameStation(e, s))) {
      skipped.call.push(e.id);
      continue;
    }
    out.push(result.station);
    keys.add(key);
    added += 1;
  }
  return { stations: out, added, skipped, dropped };
}

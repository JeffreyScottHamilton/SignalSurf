// Hand-curated stations merged into the catalogue build. The source file is data/curated-stations.json
// (rules in docs/data-source.md). Plain ES module shared by scripts/build-catalog.mjs (Node) and the unit
// tests. It imports only ./rules.mjs and never an app module.
//
// A curated entry goes through the same normalizeRaw rules as a Radio Browser record (https stream,
// music tags, coordinates in a US box, state text). Radio Browser wins: a curated entry whose stream
// is already in the Radio Browser data (raw stream URL, http or https) is skipped.

import { inUsBox, normalizeRaw, parseStateText } from './rules.mjs';

/** Curated ids: "curated:" then lower-case letters, digits and hyphens. */
export const CURATED_ID_RE = /^curated:[a-z0-9][a-z0-9-]*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

/** Stream key for matching: trimmed, with http:// read as https://, so an http twin in Radio Browser matches. */
export function streamKey(url) {
  return String(url).trim().replace(/^http:\/\//i, 'https://');
}

function parsesAs(v, protocols) {
  if (!nonEmpty(v)) return false;
  try {
    return protocols.includes(new URL(v.trim()).protocol);
  } catch {
    return false;
  }
}

/** The problems with one entry. An empty list means the entry is valid. */
export function checkCuratedEntry(e) {
  if (typeof e !== 'object' || e === null || Array.isArray(e)) return ['entry is not an object'];
  const problems = [];
  if (!(typeof e.id === 'string' && CURATED_ID_RE.test(e.id))) problems.push('id must look like "curated:kbzn"');
  if (!nonEmpty(e.name)) problems.push('name missing');
  if (nonEmpty(e.streamUrl) && /^http:\/\//i.test(e.streamUrl.trim())) problems.push('streamUrl must be https, not http');
  else if (!parsesAs(e.streamUrl, ['https:'])) problems.push('streamUrl missing or not an https URL');
  if (e.homepage != null && !parsesAs(e.homepage, ['http:', 'https:'])) problems.push('homepage must be an http(s) URL');
  if (e.favicon != null && !parsesAs(e.favicon, ['https:'])) problems.push('favicon must be an https URL');
  if (!nonEmpty(e.state) || parseStateText(e.state).code === null || parseStateText(e.state).city !== null) {
    problems.push('state must be a US state name or code, with no city');
  }
  if (e.city != null && !nonEmpty(e.city)) problems.push('city must be a non-empty string');
  if (!Array.isArray(e.tags) || e.tags.length === 0 || !e.tags.every((t) => nonEmpty(t) && !t.includes(','))) {
    problems.push('tags must be a non-empty list of tag strings (no commas)');
  }
  if (e.codec != null && !nonEmpty(e.codec)) problems.push('codec must be a non-empty string');
  if (e.bitrate != null && !(typeof e.bitrate === 'number' && Number.isFinite(e.bitrate) && e.bitrate > 0)) {
    problems.push('bitrate must be a positive number');
  }
  const { lat, lng } = e;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    problems.push('lat and lng must be numbers');
  } else if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    problems.push('lat or lng out of range');
  } else if (lat === 0 && lng === 0) {
    problems.push('lat and lng are 0,0');
  } else if (!inUsBox(lat, lng)) {
    problems.push('lat and lng are outside the US');
  }
  if (!nonEmpty(e.source)) problems.push('source missing (where the stream URL came from)');
  if (!(typeof e.verified === 'string' && DATE_RE.test(e.verified) && !Number.isNaN(Date.parse(e.verified)))) {
    problems.push('verified must be a date, YYYY-MM-DD');
  }
  if (!nonEmpty(e.coordsSource)) problems.push('coordsSource missing (where the coordinates came from)');
  return problems;
}

/**
 * Validates a parsed curated file. Returns { stations, errors }: stations are the valid entries in file
 * order; errors name each bad entry by index and id. Repeated ids and repeated stream URLs are errors too.
 */
export function parseCurated(doc) {
  const stations = [];
  const errors = [];
  if (typeof doc !== 'object' || doc === null || !Array.isArray(doc.stations)) {
    return { stations, errors: ['the file must be an object with a stations array'] };
  }
  const ids = new Set();
  const keys = new Set();
  doc.stations.forEach((e, i) => {
    const label = `stations[${i}]${typeof e?.id === 'string' ? ` (${e.id})` : ''}`;
    const problems = checkCuratedEntry(e);
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

/** The entry as a Radio Browser record, so that normalizeRaw applies the same rules to both. */
export function curatedToRaw(e) {
  return {
    stationuuid: e.id,
    name: e.name,
    url: e.streamUrl,
    url_resolved: e.streamUrl,
    homepage: e.homepage ?? null,
    favicon: e.favicon ?? null,
    tags: e.tags.join(','),
    iso_3166_2: null,
    state: e.city ? `${e.city}, ${e.state}` : e.state,
    codec: e.codec ?? null,
    bitrate: e.bitrate ?? 0,
    hls: 0,
    clickcount: 0,
    geo_lat: e.lat,
    geo_long: e.lng,
  };
}

/** Runs each valid entry through normalizeRaw. Returns [{ entry, result }] where result is the normalizeRaw result. */
export function curatedRecords(entries, polygonState) {
  return entries.map((entry) => ({ entry, result: normalizeRaw(curatedToRaw(entry), polygonState, null) }));
}

/** Every stream key of the Radio Browser rows, kept or not: the directory has the station if it lists the stream. */
export function radioBrowserStreamKeys(rows) {
  const keys = new Set();
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    for (const v of [r.url_resolved, r.url]) if (nonEmpty(v)) keys.add(streamKey(v));
  }
  return keys;
}

/**
 * Adds the curated stations after the Radio Browser stations. A curated entry is skipped when its stream
 * key is in radioStreamKeys (Radio Browser wins). A curated entry that the music or https rules drop is
 * counted in dropped, by reason, and not added.
 * Returns { stations, added, skipped: [id], dropped: { reason: count } }.
 */
export function mergeCurated(radioStations, curated, radioStreamKeys) {
  const stations = [...radioStations];
  const skipped = [];
  const dropped = {};
  let added = 0;
  for (const { entry, result } of curated) {
    if (radioStreamKeys.has(streamKey(entry.streamUrl))) {
      skipped.push(entry.id);
      continue;
    }
    if (result.reason) {
      dropped[result.reason] = (dropped[result.reason] ?? 0) + 1;
      continue;
    }
    stations.push(result.station);
    added += 1;
  }
  return { stations, added, skipped, dropped };
}

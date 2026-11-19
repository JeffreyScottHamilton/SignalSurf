#!/usr/bin/env node
// Discovers licensed US music stations that Radio Browser does not list, with an official Triton (StreamTheWorld)
// livestream-redirect URL. Run with `npm run discover` (network). Writes data/discovered-stations.json, which is
// committed: `npm run catalog` reads that file and never runs this script.
//
// Usage: node --use-env-proxy scripts/discover-streams.mjs [--cache <dir>] [--limit <n>]
//   --cache  cache directory (default: $DISCOVER_CACHE_DIR or a tmp dir). It holds the Wikipedia answers (wp/), the
//            Triton answers (triton/) and the Triton progress (triton-progress.jsonl, one line per station). A re-run,
//            or a re-run after a stop, repeats no request that was already answered.
//   --limit  process only the first n candidates (a quick check; the committed file is not written)
//
// Order: Triton first, Wikipedia second. Wikipedia is rate limited, so it is asked only about the stations that
// Triton already answered for.
//   1. Candidates: FCC full-power FM and AM licences (data/fcc-stations.json) in the 50 states and DC, with no
//      catalogue station matched (the fcc-gap matcher). Single-feed network licensees are skipped (SKIPPED_LICENSEES).
//      Discovered entries from an earlier build (ids "fcc:") are not part of the catalogue used for matching.
//      Ordered by orderCandidates: commercial-band FM (92.0 MHz and up), then AM, then FM below 92.0; stable within each.
//   2. Triton: the first mount that answers status 200 for that exact mount (CALL+BAND+AAC, CALL+BAND, CALL+AAC,
//      CALL; at most four requests). The codec in the XML decides the extension (aac or mp3). Paced at 4 req/s at most.
//      On an error or an HTTP status other than 200 and 404, back off (60 s, 120 s, 240 s) and retry; after three
//      retries the stage stops, and a re-run resumes from the progress file.
//   3. Wikipedia, for the Triton hits with a usable codec only: the station's article (CALL, then CALL-FM or CALL (AM)
//      when needed). The infobox gives the format, branding, website, city and frequency. A station is kept only when
//      the page is for the same call sign, the frequency and city or state agree with the FCC record, and the format
//      is music with a genre. Paced at 3 s; 120 s back-off on HTTP 429 or maxlag, three retries, then the stage stops
//      and the stations already judged are kept.
//
// Honest limits: the audio is not fetched. The stream is trusted from Triton's mount record and the official
// call-sign mount name. Wikipedia formats can be stale. The FCC coordinates are the licensed transmitter.
//
// Pure parsers and runDiscovery are exported for scripts/discover-streams.test.mjs. The main run is skipped on import.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { classifyDetailed, expandCatalogRecord, foldTag, HARD_EXCLUDES, parseTags, STATE_NAMES } from '../src/catalog/rules.mjs';
import { classifyStation, parseDataFile } from './fcc-gap.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const FCC_DATA = resolve(root, 'data/fcc-stations.json');
const CATALOG = resolve(root, 'public/catalog.json');
const OUT = resolve(root, 'data/discovered-stations.json');

const WP_API = 'https://en.wikipedia.org/w/api.php';
export const WP_UA = 'RoadtripRadio-coverage/1.0 (station format lookup; one-off, batched, 1 req/3s)';
const TRITON_API = 'https://playerservices.streamtheworld.com/api/livestream';
const TRITON_REDIRECT = 'https://playerservices.streamtheworld.com/api/livestream-redirect';
const TRITON_UA = 'RoadtripRadio-coverage/1.0 (stream mount lookup; about 4 req/s)';
/** Triton pacing: at most 4 requests a second. On an error or HTTP status other than 200/404: back off, three retries. */
export const TRITON_PACING = { gapMs: 250, retryMs: [60000, 120000, 240000], maxRetries: 3 };
const WP_BATCH = 50;
/** Wikipedia pacing: at least 3 s between calls; on HTTP 429 or maxlag wait 120 s, at most 3 retries, then stop. */
export const WP_PACING = { gapMs: 3000, retryMs: 120000, maxRetries: 3 };
const FREQ_TOLERANCE = { FM: 0.05, AM: 0.5 };

/** The 50 states and DC. Territories (AS, GU, MP, PR, VI) are out of scope. */
export const US_STATE_CODES = Object.keys(STATE_NAMES).filter((c) => !['AS', 'GU', 'MP', 'PR', 'VI'].includes(c));

/**
 * Single-feed network licensees. Their stations carry the same network programme, so each one would add a
 * duplicate stream. iHeart (IHM LICENSES) is skipped because its streams are reached only through iHeart's own app
 * API, which the app does not use. Matched against the FCC licensee name, case-insensitively.
 */
export const SKIPPED_LICENSEES = [
  { label: 'K-LOVE (Educational Media Foundation)', re: /\bK-?LOVE\b|EDUCATIONAL MEDIA FOUNDATION/i },
  { label: 'American Family Association', re: /AMERICAN FAMILY ASSOCIATION/i },
  { label: 'Relevant Radio', re: /RELEVANT RADIO/i },
  { label: 'Bible Broadcasting Network', re: /BIBLE BROADCASTING NETWORK/i },
  { label: 'Family Life Ministries', re: /FAMILY LIFE MINISTRIES/i },
  { label: 'Hope Media Group (Air1)', re: /HOPE MEDIA GROUP/i },
  { label: 'Moody Bible Institute (Moody Radio)', re: /MOODY BIBLE INSTITUTE/i },
  { label: 'iHeartMedia (IHM Licenses)', re: /IHM LICENSES/i },
];

/** The skip label for an FCC licensee, or null when it is not a skipped network. */
export function skippedLicensee(licensee) {
  if (typeof licensee !== 'string') return null;
  const hit = SKIPPED_LICENSEES.find((s) => s.re.test(licensee));
  return hit ? hit.label : null;
}

/**
 * Candidates: FM and AM full-power licences in the states and DC, with no catalogue station matched by
 * classifyStation (fcc-gap), and not from a skipped network. catalogRecords are expanded catalogue records;
 * records with ids "fcc:" (discovered in an earlier build) are left out of the matching.
 * Returns { candidates, skipped: { label: n }, matched, outOfScope }.
 */
export function candidateStations(fccStations, catalogRecords) {
  const inCatalog = catalogRecords.filter((r) => !String(r.id).startsWith('fcc:'));
  const byState = new Map();
  const noState = [];
  for (const rec of inCatalog) {
    if (rec.stateCode == null) noState.push(rec);
    else {
      if (!byState.has(rec.stateCode)) byState.set(rec.stateCode, []);
      byState.get(rec.stateCode).push(rec);
    }
  }
  const candidates = [];
  const skipped = {};
  let matched = 0;
  let outOfScope = 0;
  for (const s of fccStations) {
    if ((s.service !== 'FM' && s.service !== 'AM') || !US_STATE_CODES.includes(s.state)) {
      outOfScope += 1;
      continue;
    }
    const cands = [...(byState.get(s.state) ?? []), ...noState];
    if (classifyStation(s, cands).how !== null) {
      matched += 1;
      continue;
    }
    const label = skippedLicensee(s.licensee);
    if (label !== null) {
      skipped[label] = (skipped[label] ?? 0) + 1;
      continue;
    }
    candidates.push(s);
  }
  return { candidates, skipped, matched, outOfScope };
}

/**
 * The group a candidate is checked in: 0 commercial-band FM (92.0 MHz and up), 1 AM, 2 FM below 92.0 MHz. The
 * noncommercial band was the first run's whole result (the FCC file is in frequency order), so it goes last.
 */
export function candidateGroup(s) {
  if (s.band === 'FM' && s.freq >= 92.0) return 0;
  if (s.band === 'AM') return 1;
  return 2;
}

/** The candidates in run order: group 0, then 1, then 2 (candidateGroup). Stable within each group. Returns a new array. */
export function orderCandidates(candidates) {
  return [0, 1, 2].flatMap((g) => candidates.filter((c) => candidateGroup(c) === g));
}

/** The Triton mounts to try, in order: CALL+BAND+AAC, CALL+BAND, CALL+AAC, CALL. Every one starts with the call sign. */
export function mountCandidates(call, band) {
  const c = String(call).toUpperCase();
  return [`${c}${band}AAC`, `${c}${band}`, `${c}AAC`, c];
}

/** Wikipedia titles to try, in order: the base call sign, then CALL-FM (FM) or CALL (AM). */
export function wikiTitleCandidates(call, band) {
  const c = String(call).toUpperCase();
  return band === 'FM' ? [c, `${c}-FM`] : [c, `${c} (AM)`];
}

/**
 * Parses one Triton livestream XML response. Returns { status, mount, codec, hasServers }: status is the
 * mountpoint status code from the XML (the HTTP code is 200 for both a hit and a miss), mount the <mount>
 * element, codec the first <audio codec="..."> value. Missing parts are null.
 */
export function parseLivestreamXml(xml) {
  const text = typeof xml === 'string' ? xml : '';
  const block = /<mountpoint\b[^>]*>([\s\S]*?)<\/mountpoint>/.exec(text)?.[1] ?? '';
  const code = /<status-code>\s*(\d+)\s*<\/status-code>/.exec(block)?.[1];
  const mount = /<mount>\s*([^<]*?)\s*<\/mount>/.exec(block)?.[1] ?? null;
  const codec = /<audio\b[^>]*\bcodec="([^"]+)"/.exec(block)?.[1] ?? null;
  return { status: code === undefined ? null : Number(code), mount, codec, hasServers: /<servers>/.test(block) };
}

/**
 * The extension for a Triton codec: 'aac' for any AAC family codec (aac, heaac, heaacv2 ...), 'mp3' for mp3.
 * Any other codec, or none, gives { ext: null }, and the station is not kept. A mount named ...AAC whose XML codec
 * is mp3 is a conflict and is not kept either: the XML codec is never overridden by the mount name.
 */
export function codecToExt(codec, mount) {
  if (typeof codec !== 'string' || codec.trim() === '') return { ext: null, reason: 'no codec in the Triton XML' };
  const c = codec.trim().toLowerCase();
  let ext = null;
  if (c.includes('aac')) ext = 'aac';
  else if (c === 'mp3') ext = 'mp3';
  if (ext === null) return { ext: null, reason: `codec ${codec} not supported` };
  if (ext === 'mp3' && /AAC$/i.test(String(mount ?? ''))) return { ext: null, reason: 'mount named AAC but codec mp3' };
  return { ext, reason: null };
}

/** The livestream-redirect URL for a mount and extension (a 302 to the NNNN.live.streamtheworld.com server). */
export function redirectUrl(mount, ext) {
  return `${TRITON_REDIRECT}/${mount}.${ext}`;
}

/** Removes wiki markup: comments, refs, templates (wrappers keep their text, lists become ", "), links, italics, HTML. */
export function stripWiki(value) {
  let s = String(value ?? '');
  s = s.replace(/<!--[\s\S]*?-->/g, '').replace(/<ref\b[^>]*\/>/gi, '').replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '');
  // Innermost templates first (they hold no braces).
  for (let i = 0; i < 10; i++) {
    const before = s;
    s = s.replace(/\{\{([^{}]*)\}\}/g, (_, body) => {
      const parts = body.split('|');
      const name = parts[0].trim().toLowerCase();
      if (['nowrap', 'nobr', 'small', 'big', 'lang'].includes(name)) return parts.slice(1).join('|').trim();
      if (['ubl', 'plainlist', 'flatlist', 'hlist', 'unbulleted list'].includes(name)) {
        return parts.slice(1).map((p) => p.trim()).filter(Boolean).join(', ');
      }
      return '';
    });
    if (s === before) break;
  }
  s = s.replace(/\[\[([^[\]]*)\]\]/g, (_, body) => body.split('|').pop());
  s = s.replace(/\[(https?:\/\/[^\s\]]+)(?:\s+([^\]]*))?\]/g, (_, url, text) => text ?? '');
  s = s.replace(/'{2,}/g, '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '');
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&ndash;/g, '–');
  return s.replace(/\s+/g, ' ').trim();
}

/** Splits at top-level '|' (not inside {{ }} or [[ ]]). */
function splitTop(s) {
  const parts = [];
  let cur = '';
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2);
    if (two === '{{' || two === '[[') {
      depth += 1;
      cur += two;
      i += 1;
      continue;
    }
    if (two === '}}' || two === ']]') {
      depth = Math.max(0, depth - 1);
      cur += two;
      i += 1;
      continue;
    }
    if (s[i] === '|' && depth === 0) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += s[i];
  }
  parts.push(cur);
  return parts;
}

/**
 * The parameters of the {{Infobox radio station}} template in a page's lead. Returns a Map from the lower-case
 * parameter name to its raw wiki text (links and refs left in), or null when the page has no such infobox.
 */
export function parseInfobox(content) {
  if (typeof content !== 'string') return null;
  const start = content.search(/\{\{\s*Infobox\s+radio\s+station\b/i);
  if (start < 0) return null;
  let depth = 0;
  let close = -1;
  for (let i = start; i < content.length - 1; i++) {
    const two = content.slice(i, i + 2);
    if (two === '{{') {
      depth += 1;
      i += 1;
    } else if (two === '}}') {
      depth -= 1;
      i += 1;
      if (depth === 0) {
        close = i - 1;
        break;
      }
    }
  }
  if (close < 0) return null;
  const inner = content.slice(start + 2, close);
  const params = new Map();
  for (const part of splitTop(inner).slice(1)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    if (!params.has(key)) params.set(key, part.slice(eq + 1).trim());
  }
  return params;
}

/** True when the page carries a disambiguation template. */
export function isDisambiguation(content) {
  return typeof content === 'string' && /\{\{\s*(disambig|disambiguation|dab|hndis|geodis|surname)\b/i.test(content);
}

/**
 * Format tags from the raw infobox format text. Lines, <br>, list templates, "/" and "," separate formats. Links keep
 * their display text; parenthetical notes such as "(Public)" are dropped. At most six tags.
 */
export function formatTags(raw) {
  let s = String(raw ?? '');
  s = s.replace(/<!--[\s\S]*?-->/g, '').replace(/<ref\b[^>]*\/>/gi, '').replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/\[\[([^[\]]*)\]\]/g, (_, body) => body.split('|').pop());
  s = s.replace(/\{\{\s*(?:flatlist|plainlist|hlist|ubl|unbulleted list|nowrap)\s*\|?/gi, '\n');
  s = s.replace(/\}\}/g, '\n');
  const out = [];
  for (const line of s.split(/\n|\|/)) {
    const cleaned = stripWiki(line).replace(/\([^)]*\)/g, ' ').replace(/^[\s*;#:]+/, '');
    for (const piece of cleaned.split(/[/,]/)) {
      const t = piece.replace(/\s+/g, ' ').trim();
      if (t !== '' && !out.includes(t)) out.push(t);
    }
  }
  return out.slice(0, 6);
}

/** The first number in a text (a frequency): FM "102.7 MHz" gives 102.7, AM "1160 kHz" gives 1160. Null when none. */
export function firstNumber(text) {
  const raw = String(text ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/<ref\b[^>]*\/>/gi, '').replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '');
  const m = /(\d{2,4}(?:\.\d+)?)/.exec(raw);
  return m ? Number(m[1]) : null;
}

/** A website value that is one plain https URL, or null. Brackets and link text are removed; anything else is refused. */
export function plainHttpsUrl(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '').replace(/<ref\b[^>]*\/>/gi, '').trim();
  // Accepted forms: https://x, [https://x link text], {{URL|https://x}} or {{URL|https://x|text}}.
  const m =
    /^(https:\/\/[^\s[\]{}|<>"']+)$/.exec(s) ??
    /^\[(https:\/\/[^\s[\]{}|<>"']+)(?:\s[^\]]*)?\]$/.exec(s) ??
    /^\{\{\s*URL\s*\|\s*(https:\/\/[^\s[\]{}|<>"']+)\s*(?:\|[^{}]*)?\}\}$/i.exec(s);
  if (m === null) return null;
  try {
    return new URL(m[1]).protocol === 'https:' ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * The first hard-exclude tag (news, talk, sports ...) in a station's format tags, or null. classifyDetailed keeps a
 * station whose genre tags outnumber its excluded tags; docs/decisions.md says a station with any excluded tag is
 * dropped, so the discovery check is stricter. Whole-word match, as in the classifier.
 */
export function hardExcludeTag(tags) {
  for (const t of tags) {
    const sp = ` ${foldTag(t)} `;
    const hit = HARD_EXCLUDES.find((h) => sp.includes(` ${foldTag(h)} `));
    if (hit !== undefined) return t;
  }
  return null;
}

/** Title-cases an FCC city ("SALT LAKE CITY" becomes "Salt Lake City"). Words split on spaces and hyphens. */
export function titleCase(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/(^|[\s-])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase())
    .trim();
}

/** Whether a page title is the station's own call sign page: CALL, CALL-FM, CALL-AM, CALL (AM) or CALL (FM). */
export function titleIsCall(title, call) {
  const c = String(call).toUpperCase();
  return new RegExp(`^${c}(?:-FM|-AM| \\((?:FM|AM)\\))?$`, 'i').test(String(title ?? '').trim());
}

/** The state code a text names (a state name or code, D.C. included), or null. */
function stateOfText(text) {
  const t = String(text).trim();
  if (/^(d\.?\s?c\.?|district of columbia)$/i.test(t)) return 'DC';
  if (t.length === 2 && STATE_NAMES[t.toUpperCase()] !== undefined) return t.toUpperCase();
  const f = foldTag(t);
  for (const [code, name] of Object.entries(STATE_NAMES)) if (foldTag(name) === f) return code;
  return null;
}

/**
 * Whether the infobox city text places the station in the FCC record. A text that ends in a state ("Salt Lake City,
 * Utah", "Utah") must name the FCC state. A text with no state must name the FCC city ("Midvale" is not Salt Lake).
 */
export function locationMatches(cityText, fcc) {
  const text = stripWiki(cityText ?? '');
  if (text === '') return false;
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
  const lastState = stateOfText(parts[parts.length - 1]);
  if (lastState !== null) return lastState === fcc.state;
  return foldTag(parts[0]) === foldTag(titleCase(fcc.city));
}

/**
 * The station name: "CALL FREQ Branding". Branding is kept without the frequency or band words, and dropped when
 * nothing else is left. FM frequency with one decimal ("93.3"); AM as a whole number ("570").
 */
export function stationName(fcc, branding) {
  const freqText = fcc.band === 'FM' ? fcc.freq.toFixed(1) : String(Math.round(fcc.freq));
  let brand = stripWiki(branding ?? '');
  brand = brand
    .split(/\s+/)
    .filter((w) => w !== freqText && !/^(FM|AM|MHz|kHz)$/i.test(w))
    .join(' ');
  if (brand.length < 2 || brand.toUpperCase() === fcc.call.toUpperCase()) brand = '';
  return [fcc.call.toUpperCase(), freqText, brand].filter(Boolean).join(' ');
}

/**
 * Judges one Wikipedia page for one FCC licence. Returns one of:
 *   { outcome: 'accept', wikiTitle, tags, branding, website, city, name }
 *   { outcome: 'fallback', kind, reason }  try the next title: missing page, disambiguation, another call sign's page,
 *                                          no infobox, or an infobox frequency that is not this licence's
 *   { outcome: 'reject', kind, reason }    the page is for this call sign but does not fit: location or format
 * rec: { final, missing, content } from the Wikipedia lookup. fcc: a licence row (call, band, freq, city, state).
 */
export function evaluateWikiPage(rec, fcc) {
  const fallback = (kind, reason) => ({ outcome: 'fallback', kind, reason });
  if (!rec || rec.missing || typeof rec.content !== 'string') return fallback('missing', 'missing page');
  if (isDisambiguation(rec.content)) return fallback('disambiguation', 'disambiguation page');
  if (!titleIsCall(rec.final, fcc.call)) return fallback('other title', `title ${rec.final} is not this call sign`);
  const box = parseInfobox(rec.content);
  if (box === null) return fallback('no infobox', 'no radio station infobox');
  const freqWiki = box.get('frequency');
  if (freqWiki !== undefined) {
    const n = firstNumber(freqWiki);
    if (n !== null && Math.abs(n - fcc.freq) > FREQ_TOLERANCE[fcc.band]) {
      return fallback('frequency', `infobox frequency ${n} is not ${fcc.freq}`);
    }
  }
  const cityText = box.get('city') ?? '';
  if (!locationMatches(cityText, fcc)) {
    return { outcome: 'reject', kind: 'location', reason: `location "${stripWiki(cityText) || 'none'}" is not ${titleCase(fcc.city)}, ${fcc.state}` };
  }
  const tags = parseTags(formatTags(box.get('format') ?? '').join(','));
  const branding = stripWiki(box.get('branding') ?? '');
  const name = stationName(fcc, branding);
  const excluded = hardExcludeTag(tags);
  if (excluded !== null) {
    return { outcome: 'reject', kind: 'format', reason: `format has an excluded tag "${excluded}" (${tags.join(', ')})` };
  }
  const cls = classifyDetailed(tags, name);
  // The genre must come from the format tags. A name guess ("The Edge" for "College radio") is not enough.
  if (cls.reason !== null || cls.by !== 'tags' || cls.genres.length === 0) {
    return { outcome: 'reject', kind: 'format', reason: `format is not music with a genre (${tags.join(', ') || 'none'})` };
  }
  return {
    outcome: 'accept',
    wikiTitle: rec.final,
    tags,
    branding,
    website: plainHttpsUrl(box.get('website') ?? ''),
    city: titleCase(fcc.city),
    name,
  };
}

/**
 * The Triton verdict for one station from its mount answers, in the order tried. Each answer is a parsed response
 * or { error }. 'hit': the first mount that answers status 200 for that exact mount name. 'miss': no hit, and every
 * mount gave an answer. 'incomplete': no hit, and some mount gave no usable answer, so the check did not complete.
 */
export function tritonVerdict(answers) {
  let errored = false;
  for (const { mount, answer } of answers) {
    if (answer.error) {
      errored = true;
      continue;
    }
    if (answer.status === 200 && typeof answer.mount === 'string' && answer.mount.toUpperCase() === mount) {
      return { status: 'hit', mount, parsed: answer };
    }
  }
  return { status: errored ? 'incomplete' : 'miss' };
}

/** One discovered entry (the shape data/discovered-stations.json holds) from a licence, its Wikipedia check and its Triton mount. */
export function buildEntry({ fcc, wiki, mount, codec, ext, verified }) {
  return {
    // Padded to 8 characters: the app rejects station ids shorter than that (sanitizeStation).
    id: `fcc:${String(fcc.facilityId).padStart(4, '0')}`,
    call: fcc.call.toUpperCase(),
    band: fcc.band,
    freq: fcc.freq,
    name: wiki.name,
    streamUrl: redirectUrl(mount, ext),
    homepage: wiki.website,
    state: fcc.state,
    city: wiki.city,
    lat: fcc.lat,
    lng: fcc.lng,
    coordsSource: 'FCC transmitter',
    tags: wiki.tags,
    wikiTitle: wiki.wikiTitle,
    tritonMount: mount,
    codec,
    source: `Wikipedia "${wiki.wikiTitle}" infobox (format, branding, website; CC BY-SA 4.0). Triton livestream mount ${mount} (codec ${codec}); the stream URL is the Triton livestream-redirect, not fetched. Licence: FCC facility ${fcc.facilityId} (FCC public data).`,
    verified,
  };
}

/** One station per line, so the committed file diffs cleanly. */
export function serializeDiscovered({ generated, stations }) {
  const head = {
    schemaVersion: 1,
    description:
      'Licensed US music stations found by scripts/discover-streams.mjs (npm run discover). Merged by npm run catalog after the curated stations. Rules: docs/data-source.md, "Discovered stations".',
    source: 'FCC licence (public domain), Wikipedia infobox (CC BY-SA 4.0), Triton livestream (StreamTheWorld) mount record',
    generated,
    count: stations.length,
  };
  const body = stations.map((s) => '  ' + JSON.stringify(s));
  return `${JSON.stringify(head).slice(0, -1)},\n"stations": [\n${body.join(',\n')}\n]\n}\n`;
}

// ---------- network, cache and progress (main run only) ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TRITON_HOST = 'playerservices.streamtheworld.com';
const WP_HOST = 'en.wikipedia.org';

function cachePath(dir, key) {
  return join(dir, `${createHash('sha1').update(key).digest('hex')}.json`);
}

function readCache(dir, key) {
  const p = cachePath(dir, key);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

function writeCache(dir, key, value) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(cachePath(dir, key), JSON.stringify(value));
}

/** Hard deadline for one request, covering the response headers and the body. */
export const REQUEST_TIMEOUT_MS = 30000;

/**
 * One fetch with a hard deadline. The deadline rejects even when fetch ignores its abort signal, so a request
 * can never hang the run. A timeout is marked with timedOut = true.
 */
function fetchWithDeadline(url, headers, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const err = new Error(`no response within ${timeoutMs / 1000} s`);
      err.timedOut = true;
      reject(err);
    }, timeoutMs);
  });
  const request = (async () => {
    const res = await fetch(url, { headers, signal: controller.signal });
    return { status: res.status, body: await res.text() };
  })();
  return Promise.race([request, deadline]).finally(() => clearTimeout(timer));
}

/**
 * GET through fetch (honours --use-env-proxy). A timeout is retried once, and a second timeout is thrown for the
 * caller to record. Other fetch failures fall back to curl, which has its own 60 s limit.
 */
export async function getText(url, headers, timeoutMs = REQUEST_TIMEOUT_MS) {
  let err;
  try {
    return await fetchWithDeadline(url, headers, timeoutMs);
  } catch (e) {
    err = e;
  }
  if (err.timedOut) return fetchWithDeadline(url, headers, timeoutMs);
  try {
    const out = execFileSync('curl', ['-sS', '--max-time', '60', '-A', headers['User-Agent'], '-w', '\n%{http_code}', url], {
      maxBuffer: 64 * 1024 * 1024,
    }).toString('utf8');
    const cut = out.lastIndexOf('\n');
    return { status: Number(out.slice(cut + 1)), body: out.slice(0, cut) };
  } catch {
    throw err;
  }
}

/** The real network, clock and console, as runDiscovery's deps. */
export function realDeps() {
  return {
    getText,
    sleep,
    now: () => Date.now(),
    log: (m) => console.log(m),
    warn: (m) => console.warn(m),
  };
}

/** A stage that stopped after its retries. The stages before it keep what they judged. */
export class StageStop extends Error {
  constructor(stage, message) {
    super(message);
    this.name = 'StageStop';
    this.stage = stage;
  }
}

/**
 * The Triton progress file: one JSON line per station (id, call, status, mount, codec, ext, reason). A missing file is
 * an empty map. A torn last line is ignored, so that station is checked again.
 */
export function readProgress(file) {
  const map = new Map();
  if (!existsSync(file)) return map;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    try {
      const rec = JSON.parse(line);
      if (rec && typeof rec.id === 'string') map.set(rec.id, rec);
    } catch {
      // torn line: ignored
    }
  }
  return map;
}

const countBy = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
const summary = (map) => [...map.entries()].map(([k, v]) => `${k} ${v}`).join('; ') || 'none';

/**
 * The whole run, Triton first. Stage 1: Triton for every candidate, in the order given (use orderCandidates). Each
 * station's verdict is appended to the progress file, so a re-run skips it. Stage 2: Wikipedia, only for the Triton
 * hits whose codec is usable. A station is kept only with a Wikipedia music format that agrees with the FCC record.
 *
 * candidates: FCC licence rows (call, band, freq, city, state, lat, lng, facilityId, ...), already ordered.
 * cacheDir: the cache root (wp/, triton/, triton-progress.jsonl). deps: see realDeps (getText, sleep, now, log, warn).
 * limit: process only the first n candidates.
 *
 * Returns { kept, stopped, counts, requests }. kept: the entries for the stations judged (sorted by facility id).
 * stopped: null, or { stage: 'triton' | 'wikipedia', message }. A Triton stop keeps nothing (the Wikipedia stage does
 * not run), and the caller should not write the committed file. A Wikipedia stop keeps the judged stations only.
 */
export async function runDiscovery({ candidates, cacheDir, deps, verified, limit = Infinity }) {
  const wpDir = join(cacheDir, 'wp');
  const tDir = join(cacheDir, 'triton');
  const progressFile = join(cacheDir, 'triton-progress.jsonl');
  mkdirSync(cacheDir, { recursive: true });
  const todo = candidates.slice(0, limit);
  const requests = { [WP_HOST]: 0, [TRITON_HOST]: 0 };
  const cacheHits = { wikipedia: 0, triton: 0 };
  const progress = readProgress(progressFile);
  const resumedBefore = todo.filter((row) => progress.has(`fcc:${row.facilityId}`)).length;
  const gate = { triton: 0, wikipedia: 0 };

  /** Waits so that calls of one host are at least gapMs apart. */
  async function paced(host, gapMs) {
    const wait = gate[host] + gapMs - deps.now();
    if (wait > 0) await deps.sleep(wait);
    gate[host] = deps.now();
  }

  // ----- stage 1: Triton -----

  /** One mount's answer: a parsed response (cached when it is a mountpoint), or a 404 miss. Retries, then StageStop. */
  async function tritonAnswer(mount) {
    const cached = readCache(tDir, mount);
    if (cached) {
      cacheHits.triton += 1;
      return parseLivestreamXml(cached.body);
    }
    const url = `${TRITON_API}?mount=${encodeURIComponent(mount)}&transports=http,hls&version=1.10`;
    for (let attempt = 0; ; attempt++) {
      await paced('triton', TRITON_PACING.gapMs);
      requests[TRITON_HOST] += 1;
      let problem;
      try {
        const res = await deps.getText(url, { 'User-Agent': TRITON_UA, Accept: 'application/xml' });
        if (res.status === 404) return { status: 404, mount: null, codec: null, hasServers: false };
        if (res.status === 200 && res.body.includes('<mountpoint')) {
          writeCache(tDir, mount, { mount, body: res.body });
          return parseLivestreamXml(res.body);
        }
        problem = `HTTP ${res.status}${res.status === 200 ? ' with no mountpoint' : ''}`;
      } catch (err) {
        problem = err.message;
      }
      if (attempt >= TRITON_PACING.maxRetries) {
        throw new StageStop('triton', `Triton ${problem} for ${mount} after ${TRITON_PACING.maxRetries} retries; stopped`);
      }
      const wait = TRITON_PACING.retryMs[attempt];
      deps.warn(`Triton ${problem} for ${mount}; waiting ${wait / 1000} s (retry ${attempt + 1} of ${TRITON_PACING.maxRetries})`);
      await deps.sleep(wait);
    }
  }

  /** The Triton verdict for one station: 'hit' (with mount, codec, ext or reason) or 'miss'. */
  async function tritonStation(row) {
    const id = `fcc:${row.facilityId}`;
    const answers = [];
    for (const mount of mountCandidates(row.call, row.band)) {
      answers.push({ mount, answer: await tritonAnswer(mount) });
      if (tritonVerdict(answers).status === 'hit') break;
    }
    const verdict = tritonVerdict(answers);
    if (verdict.status === 'incomplete') throw new StageStop('triton', `Triton check incomplete for ${row.call}`);
    if (verdict.status === 'miss') return { id, call: row.call, status: 'miss' };
    const { ext, reason } = codecToExt(verdict.parsed.codec, verdict.mount);
    return { id, call: row.call, status: 'hit', mount: verdict.mount, codec: verdict.parsed.codec, ext, reason };
  }

  let stopped = null;
  let checked = 0;
  try {
    for (const row of todo) {
      const id = `fcc:${row.facilityId}`;
      if (!progress.has(id)) {
        const rec = await tritonStation(row);
        appendFileSync(progressFile, `${JSON.stringify(rec)}\n`);
        progress.set(id, rec);
        checked += 1;
        if (checked % 500 === 0) deps.log(`Triton: ${checked} checked this run (${todo.length} in this run)`);
      }
    }
  } catch (err) {
    if (!(err instanceof StageStop)) throw err;
    stopped = { stage: err.stage, message: err.message };
  }

  const tritonKinds = new Map();
  const hits = [];
  for (const row of todo) {
    const rec = progress.get(`fcc:${row.facilityId}`);
    if (rec === undefined) continue;
    if (rec.status === 'miss') countBy(tritonKinds, 'no Triton mount');
    else if (rec.ext === null) countBy(tritonKinds, rec.reason);
    else hits.push({ row, rec });
  }
  const tritonHits = todo.filter((row) => progress.get(`fcc:${row.facilityId}`)?.status === 'hit').length;
  const counts = {
    candidates: todo.length,
    tritonResumed: resumedBefore,
    tritonHits,
    tritonUsable: hits.length,
    tritonNotKept: summary(tritonKinds),
    wikipedia: { checked: 0, accepted: 0, kinds: 'none', notChecked: 0 },
  };
  if (stopped !== null) return { kept: [], stopped, counts, requests, cacheHits };

  // ----- stage 2: Wikipedia, for the Triton hits only -----

  /** Per-title records from the cache, else from one batched request for the rest. A stop returns the records held. */
  async function wikiLookup(titles) {
    const out = new Map();
    const need = [];
    for (const t of new Set(titles)) {
      const c = readCache(wpDir, t);
      if (c) {
        cacheHits.wikipedia += 1;
        out.set(t, c);
      } else need.push(t);
    }
    for (let i = 0; i < need.length; i += WP_BATCH) {
      const batch = need.slice(i, i + WP_BATCH);
      let json;
      try {
        json = await wpRequest(batch);
      } catch (err) {
        if (!(err instanceof StageStop)) throw err;
        return { recs: out, stopped: err.message };
      }
      const q = json.query ?? {};
      const norm = new Map((q.normalized ?? []).map((x) => [x.from, x.to]));
      const redir = new Map((q.redirects ?? []).map((x) => [x.from, x.to]));
      const pages = new Map((q.pages ?? []).map((p) => [p.title, p]));
      for (const t of batch) {
        const n = norm.get(t) ?? t;
        const final = redir.get(n) ?? n;
        const p = pages.get(final);
        const rec = {
          requested: t,
          final,
          missing: !p || p.missing === true || p.invalid === true,
          content: p?.revisions?.[0]?.slots?.main?.content ?? null,
        };
        writeCache(wpDir, t, rec);
        out.set(t, rec);
      }
      deps.log(`wikipedia batch ${Math.floor(i / WP_BATCH) + 1}: ${batch.length} titles`);
    }
    return { recs: out, stopped: null };
  }

  /** One batched MediaWiki request. Retries HTTP 429 and maxlag three times, 120 s apart, then StageStop. */
  async function wpRequest(titles) {
    const url =
      `${WP_API}?action=query&prop=revisions&rvprop=content&rvslots=main&rvsection=0&format=json&formatversion=2` +
      `&redirects=1&maxlag=5&titles=${titles.map(encodeURIComponent).join('|')}`;
    for (let attempt = 0; ; attempt++) {
      await paced('wikipedia', WP_PACING.gapMs);
      requests[WP_HOST] += 1;
      let res;
      try {
        res = await deps.getText(url, { 'User-Agent': WP_UA, Accept: 'application/json' });
      } catch (err) {
        res = { status: 0, body: '', error: err.message };
      }
      let json = null;
      try {
        json = JSON.parse(res.body);
      } catch {
        json = null;
      }
      const lagged = json?.error?.code === 'maxlag';
      if (res.status === 429 || lagged || res.error !== undefined) {
        const why = res.error !== undefined ? `network error (${res.error})` : `HTTP ${res.status}${lagged ? ' maxlag' : ''}`;
        if (attempt >= WP_PACING.maxRetries) {
          throw new StageStop('wikipedia', `Wikipedia still ${why} after ${WP_PACING.maxRetries} retries; stopped`);
        }
        deps.warn(`Wikipedia ${why}; waiting ${WP_PACING.retryMs / 1000} s (retry ${attempt + 1} of ${WP_PACING.maxRetries})`);
        await deps.sleep(WP_PACING.retryMs);
        continue;
      }
      if (res.status !== 200 || json === null || json.error) {
        throw new StageStop('wikipedia', `Wikipedia request failed: HTTP ${res.status} ${json?.error?.code ?? ''}; stopped`);
      }
      return json;
    }
  }

  // Attempt 0 is the base call sign. Attempt 1 (CALL-FM or CALL (AM)) runs only for the stations whose attempt 0 was a
  // fallback. A reject stops at once. A stop ends the stage: the stations it did not reach stay incomplete and are not
  // kept, and the stations already judged are.
  const state = hits.map(({ row, rec }) => ({ row, rec, result: null, lastFallback: null }));
  let wpStopped = null;
  for (let k = 0; k < 2 && wpStopped === null; k++) {
    const pending = state.filter((st) => st.result === null);
    if (pending.length === 0) break;
    const titleOf = (st) => wikiTitleCandidates(st.row.call, st.row.band)[k];
    const looked = await wikiLookup(pending.map(titleOf));
    wpStopped = looked.stopped;
    for (const st of pending) {
      const page = looked.recs.get(titleOf(st));
      if (page === undefined) continue;
      const ev = evaluateWikiPage(page, st.row);
      if (ev.outcome === 'fallback') st.lastFallback = ev;
      else st.result = ev;
    }
  }
  const wpKinds = new Map();
  let wpIncomplete = 0;
  for (const st of state) {
    if (st.result === null) {
      if (st.lastFallback === null || wpStopped !== null) {
        wpIncomplete += 1;
        continue;
      }
      st.result = { outcome: 'reject', kind: `no usable page (${st.lastFallback.kind})`, reason: st.lastFallback.reason };
    }
    if (st.result.outcome !== 'accept') countBy(wpKinds, st.result.kind);
  }
  const accepted = state.filter((st) => st.result !== null && st.result.outcome === 'accept');
  counts.wikipedia = {
    checked: state.filter((st) => st.result !== null).length,
    accepted: accepted.length,
    kinds: summary(wpKinds),
    notChecked: wpIncomplete,
  };
  // One stream is one station: when two licences resolve to the same mount, the first in run order is kept.
  const seenStream = new Set();
  const kept = [];
  for (const st of accepted) {
    const entry = buildEntry({ fcc: st.row, wiki: st.result, mount: st.rec.mount, codec: st.rec.codec, ext: st.rec.ext, verified });
    if (seenStream.has(entry.streamUrl)) {
      counts.duplicateStream = (counts.duplicateStream ?? 0) + 1;
      continue;
    }
    seenStream.add(entry.streamUrl);
    kept.push(entry);
  }
  kept.sort((a, b) => Number(a.id.slice(4)) - Number(b.id.slice(4)));
  const stop = wpStopped === null ? null : { stage: 'wikipedia', message: wpStopped };
  return { kept, stopped: stop, counts, requests, cacheHits };
}

function argOf(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

// The main run starts only when this file is the entry point (not when a test imports it).
async function main() {
  const args = process.argv.slice(2);
  const cacheDir = resolve(argOf(args, '--cache') ?? process.env.DISCOVER_CACHE_DIR ?? join(tmpdir(), 'roadtrip-radio-discover'));
  const limit = argOf(args, '--limit') ? Number(argOf(args, '--limit')) : Infinity;
  const verified = new Date().toISOString().slice(0, 10);

  const fcc = parseDataFile(readFileSync(FCC_DATA, 'utf8'));
  const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
  const records = catalog.stations.map(expandCatalogRecord);
  const { candidates, skipped, matched, outOfScope } = candidateStations(fcc.stations, records);
  const ordered = orderCandidates(candidates);
  const groupCount = [0, 1, 2].map((g) => candidates.filter((c) => candidateGroup(c) === g).length);
  console.log(`FCC licences ${fcc.stations.length}; out of scope (LPFM, territories) ${outOfScope}; matched in catalogue ${matched}`);
  console.log(`candidates (FM and AM, 50 states and DC, unmatched) ${candidates.length}; skipped networks: ${summary(new Map(Object.entries(skipped)))}`);
  console.log(`order: commercial FM 92.0 MHz and up ${groupCount[0]}; AM ${groupCount[1]}; FM below 92.0 ${groupCount[2]}`);
  console.log(`processing ${Math.min(ordered.length, limit)} (Triton first; Wikipedia only for the Triton hits); cache ${cacheDir}`);

  const result = await runDiscovery({ candidates: ordered, cacheDir, deps: realDeps(), verified, limit });
  const { counts, requests, cacheHits, kept, stopped } = result;
  console.log(`Triton: ${counts.candidates} candidates; ${counts.tritonResumed} from the progress file; hits ${counts.tritonHits}; usable codec ${counts.tritonUsable}; not kept: ${counts.tritonNotKept}`);
  console.log(`Wikipedia (Triton hits only): checked ${counts.wikipedia.checked}; accepted ${counts.wikipedia.accepted}; not kept: ${counts.wikipedia.kinds}`);
  if (counts.wikipedia.notChecked > 0) console.log(`Wikipedia: ${counts.wikipedia.notChecked} Triton hits not checked (stopped); not kept`);
  console.log(`requests: ${Object.entries(requests).map(([h, n]) => `${h} ${n}`).join('; ')}; cache hits: wikipedia ${cacheHits.wikipedia}, triton ${cacheHits.triton}`);

  if (Number.isFinite(limit)) {
    console.log(`--limit run: ${OUT} not written (${kept.length} kept in this sample)`);
  } else if (stopped?.stage === 'triton') {
    console.log(`${OUT} not written: the Triton stage stopped`);
  } else {
    writeFileSync(OUT, serializeDiscovered({ generated: verified, stations: kept }));
    console.log(`wrote ${OUT}: ${kept.length} stations`);
  }
  if (stopped !== null) {
    console.error(`STOPPED (${stopped.stage}): ${stopped.message}. Re-run to resume from the cache.`);
    process.exitCode = stopped.stage === 'triton' ? 3 : 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

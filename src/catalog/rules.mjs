// Shared pure catalogue rules. Imported by scripts/build-catalog.mjs (Node) and by
// the unit tests. Plain ES module so Node runs it without a TypeScript step.
// Keep this file free of imports from the app (@/...) and of browser APIs.

/** Genre ids in display order. */
export const GENRES = [
  'rock', 'country', 'pop', 'hiphop', 'jazz', 'classical', 'electronic', 'oldies',
  'latin', 'christian', 'indie', 'folk',
];

export const GENRE_LABELS = {
  rock: 'Rock',
  country: 'Country',
  pop: 'Pop',
  hiphop: 'Hip-Hop & R&B',
  jazz: 'Jazz & Blues',
  classical: 'Classical',
  electronic: 'Electronic',
  oldies: 'Oldies',
  latin: 'Latin',
  christian: 'Christian & Gospel',
  indie: 'Indie & College',
  folk: 'Folk & Americana',
};

/** Tags that make a station non-music, whole tag or whole word. */
export const HARD_EXCLUDES = [
  'news', 'talk', 'sports', 'sport', 'preaching', 'teaching', 'sermons', 'bible',
  'scanner', 'weather', 'traffic', 'old time radio', 'otr', 'comedy', 'audiobooks', 'podcast',
];

/** Tags that carry no genre and mean "music, unspecified". A station made only of these is kept with genres []. */
export const GENERIC_MUSIC_TAGS = ['music', 'variety', 'music variety', 'various music', 'various'];

/**
 * Whole-tag rules, checked before the word rules. A tag equal to a key maps to the
 * listed genres and is not matched by the word lists.
 */
const EXACT_TAG_GENRES = {
  hits: ['pop'],
};

/**
 * Whole-word keyword lists per genre. A keyword matches when its words appear, in order and
 * consecutively, in the folded tag ("hip-hop" folds to "hip hop", "r&b" to "r b", "80's" to "80 s").
 */
const WORD_GENRES = {
  rock: [
    'rock', 'alternative', 'punk', 'metal', 'grunge', 'new wave', 'emo', 'ska', 'rockabilly',
    'garage', 'adult album alternative', 'modern rock', 'active rock', 'n roll',
  ],
  country: ['country', 'western swing', 'honky tonk', 'outlaw'],
  pop: [
    'pop', 'top 40', 'adult contemporary', 'adult hits', 'contemporary hits', 'contemporary hits radio', 'easy listening',
    'variety hits', 'lite', 'hot ac', 'adult standards',
  ],
  hiphop: [
    'hip hop', 'hiphop', 'rap', 'r b', 'rnb', 'rhythm and blues', 'soul', 'funk', 'urban',
    'urban contemporary', 'trap',
  ],
  jazz: ['jazz', 'blues', 'big band', 'swing', 'lounge', 'bebop', 'bossa nova'],
  classical: ['classical', 'opera', 'baroque', 'symphony', 'symphonic', 'orchestra', 'orchestral', 'chamber', 'choral'],
  electronic: [
    'electronic', 'electronica', 'edm', 'dance', 'house', 'techno', 'trance', 'ambient', 'chillout',
    'chill out', 'downtempo', 'dubstep', 'drum and bass', 'drum bass', 'dnb', 'synthpop', 'trip hop', 'disco',
    'electro', 'idm', 'dj', 'new age', 'vaporwave', 'chiptune',
  ],
  oldies: [
    'oldies', 'golden oldies', 'classic oldies', 'retro', 'classic hits',
    '50s', '60s', '70s', '80s', '90s', '50 s', '60 s', '70 s', '80 s', '90 s',
    '1940s', '1950s', '1960s', '1970s', '1980s', '1990s',
  ],
  latin: [
    'latin', 'latino', 'regional mexican', 'regional mexicano', 'reggaeton', 'salsa', 'banda', 'bachata', 'cumbia',
    'merengue', 'tejano', 'mariachi', 'norteno', 'ranchera', 'tropical',
  ],
  christian: [
    'christian', 'cristiana', 'cristiano', 'gospel', 'ccm', 'worship', 'praise', 'hymns', 'hymn', 'religious',
    'inspirational', 'sacred music',
  ],
  indie: ['indie', 'college', 'student radio', 'university radio', 'freeform', 'experimental', 'independent', 'eclectic'],
  folk: ['folk', 'americana', 'bluegrass', 'singer songwriter', 'acoustic', 'celtic'],
};

/** Folds a tag for matching: accents removed, lower case, every run of non-letters/digits becomes one space. */
export function foldTag(text) {
  return String(text)
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const padded = (s) => ` ${foldTag(s)} `;
const HARD_PADDED = HARD_EXCLUDES.map(padded);
const GENERIC_SET = new Set(GENERIC_MUSIC_TAGS.map(foldTag));
const WORD_PADDED = Object.fromEntries(
  GENRES.map((g) => [g, WORD_GENRES[g].map(padded)]),
);
const EXACT_MAP = new Map(Object.entries(EXACT_TAG_GENRES).map(([k, v]) => [foldTag(k), v]));

/**
 * Classifies a station's raw tag list.
 * Returns { reason, genres }: reason is null when the station is kept, otherwise
 * 'untagged' | 'hard-exclude' | 'no-genre'. genres is in GENRES order.
 * A station is kept when no tag is a hard exclude and either a tag maps to a genre
 * or every tag is a generic music tag (then genres is []).
 */
export function classifyStation(tags) {
  const folded = (Array.isArray(tags) ? tags : [])
    .map((t) => foldTag(t ?? ''))
    .filter((t) => t.length > 0);
  if (folded.length === 0) return { reason: 'untagged', genres: [] };
  const spaced = folded.map((t) => ` ${t} `);
  if (spaced.some((t) => HARD_PADDED.some((kw) => t.includes(kw)))) {
    return { reason: 'hard-exclude', genres: [] };
  }
  const found = new Set();
  for (const t of folded) {
    const exact = EXACT_MAP.get(t);
    if (exact !== undefined) {
      for (const g of exact) found.add(g);
      continue;
    }
    const sp = ` ${t} `;
    for (const g of GENRES) {
      if (WORD_PADDED[g].some((kw) => sp.includes(kw))) found.add(g);
    }
  }
  if (found.size > 0) return { reason: null, genres: GENRES.filter((g) => found.has(g)) };
  if (folded.every((t) => GENERIC_SET.has(t))) return { reason: null, genres: [] };
  return { reason: 'no-genre', genres: [] };
}

/** US states and territories with the codes used by us-atlas (FIPS id -> USPS code). */
export const STATE_BY_FIPS = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE',
  '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA',
  '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN',
  '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM',
  '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
  '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA',
  '54': 'WV', '55': 'WI', '56': 'WY', '60': 'AS', '66': 'GU', '69': 'MP', '72': 'PR', '78': 'VI',
};

/** Code -> English name, as used by the app's location text. */
export const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', AS: 'American Samoa',
  GU: 'Guam', MP: 'Northern Mariana Islands', PR: 'Puerto Rico', VI: 'U.S. Virgin Islands',
};

const CODES = new Set(Object.values(STATE_BY_FIPS));
const NAME_TO_CODE = new Map(Object.entries(STATE_NAMES).map(([c, n]) => [n.toLowerCase(), c]));
// Extra spellings seen in Radio Browser data. Lower case.
NAME_TO_CODE.set('d.c.', 'DC');
NAME_TO_CODE.set('dc', 'DC');
NAME_TO_CODE.set('washington dc', 'DC');
NAME_TO_CODE.set('us virgin islands', 'VI');
/**
 * Candidates for a trailing state, longest first so "West Virginia" beats "Virginia".
 * Names match case-insensitively; two-letter codes must match in upper case, so "in" is not Indiana.
 */
const TRAILING = [
  ...[...NAME_TO_CODE.entries()].map(([name, code]) => ({ text: name, code, exact: false })),
  ...[...CODES].map((code) => ({ text: code, code, exact: true })),
].sort((a, b) => b.text.length - a.text.length);

function collapse(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}

/**
 * Parses a Radio Browser `state` value. Returns { code, city } where code is a state
 * code known to the table, or null, and city is the text before a trailing state
 * (null when there is none). Never guesses: unknown text gives { code: null, city: null }.
 *   "CA" / "California" -> CA, city null
 *   "New York NY" -> NY, city "New York"; "Seattle, Washington" -> WA, city "Seattle"
 *   "Las Vegas" -> null (no state in the text)
 */
export function parseStateText(raw) {
  if (typeof raw !== 'string') return { code: null, city: null };
  const t = collapse(raw).replace(/[,\s]+$/, '');
  if (t.length === 0) return { code: null, city: null };
  const lower = t.toLowerCase();
  if (CODES.has(t)) return { code: t, city: null };
  if (NAME_TO_CODE.has(lower)) return { code: NAME_TO_CODE.get(lower), city: null };
  if (/^US-[A-Z]{2}$/.test(t) && CODES.has(t.slice(3))) return { code: t.slice(3), city: null };
  for (const { text: name, code, exact } of TRAILING) {
    const tail = t.slice(-name.length);
    const match = exact ? tail === name : tail.toLowerCase() === name;
    if (!match) continue;
    const before = t.slice(0, t.length - name.length);
    if (before.length === 0 || !/[\s,]$/.test(before)) continue;
    const city = before.replace(/[\s,]+$/, '');
    if (city.length === 0) continue;
    return { code, city };
  }
  return { code: null, city: null };
}

/** Code from an ISO 3166-2 value such as "US-CA". Other countries and junk give null. */
export function stateFromIso(iso) {
  if (typeof iso !== 'string') return null;
  const m = /^US-([A-Z]{2})$/.exec(iso.trim());
  return m && CODES.has(m[1]) ? m[1] : null;
}

/**
 * Bounding boxes that may hold US stations (lower 48, Alaska incl. Aleutians across 180,
 * Hawaii, Puerto Rico and US Virgin Islands, Guam and the Northern Marianas, American Samoa).
 * [minLat, maxLat, minLng, maxLng].
 */
export const US_BOXES = [
  [24, 50, -125.5, -66],
  [51, 72, -180, -129],
  [51, 72, 172, 180],
  [18.5, 23, -161, -154],
  [17.5, 18.7, -67.5, -64.5],
  [13, 21.5, 144, 146.5],
  [-14.5, -14, -171, -169],
];

export function inUsBox(lat, lng) {
  return US_BOXES.some(([a, b, c, d]) => lat >= a && lat <= b && lng >= c && lng <= d);
}

/** Ray-casting test for one ring of [lng, lat] pairs. */
function inRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** True when the point is inside a polygon given as [outer, hole, ...] rings of [lng, lat]. */
export function inPolygon(lng, lat, rings) {
  if (rings.length === 0 || !inRing(lng, lat, rings[0])) return false;
  for (let k = 1; k < rings.length; k++) if (inRing(lng, lat, rings[k])) return false;
  return true;
}

/**
 * Finds the state whose shape contains the point. shapes: [{ code, polygons }] where
 * polygons is a list of polygons (each a list of rings). Returns the code or null.
 */
export function stateAtPoint(lng, lat, shapes) {
  for (const shape of shapes) {
    for (const poly of shape.polygons) {
      if (inPolygon(lng, lat, poly)) return shape.code;
    }
  }
  return null;
}

/**
 * Normalises one raw Radio Browser record into the compact catalogue record, or returns
 * { reason } when it is dropped. Rules mirror the former src/api/normalize.ts:
 * uuid and name required, https stream (url_resolved, else url), https favicon,
 * http(s) homepage. Coordinates: both finite, in range, not (0,0), inside a US box, else
 * dropped (never moved). stateCode: iso, then state text, then polygon, else null.
 * polygonState(lng, lat) supplies the shape lookup (may return null).
 * Returns { station, reason, stateSource, coordsDropped }.
 */
export function normalizeRaw(raw, polygonState) {
  const str = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
  if (!raw || typeof raw !== 'object') return { reason: 'junk' };
  const id = str(raw.stationuuid);
  const name = str(raw.name)?.replace(/\s+/g, ' ') ?? null;
  if (id === null || name === null) return { reason: 'junk' };

  const streamText = str(raw.url_resolved) ?? str(raw.url);
  const streamOk = streamText !== null && /^https:\/\//i.test(streamText) && isUrl(streamText);
  if (!streamOk) return { reason: 'non-https' };

  const tags = parseTags(raw.tags);
  const cls = classifyStation(tags);
  if (cls.reason !== null) return { reason: cls.reason };

  const home = str(raw.homepage);
  const homepage = home !== null && /^https?:\/\//i.test(home) && isUrl(home) ? home : null;
  const fav = str(raw.favicon);
  const favicon = fav !== null && /^https:\/\//i.test(fav) && isUrl(fav) ? fav : null;

  const iso = stateFromIso(raw.iso_3166_2);
  const text = parseStateText(raw.state);
  let stateCode = null;
  let stateSource = null;
  if (iso !== null) {
    stateCode = iso;
    stateSource = 'iso';
  } else if (text.code !== null) {
    stateCode = text.code;
    stateSource = 'name';
  }

  const lat = finite(raw.geo_lat);
  const lng = finite(raw.geo_long);
  let coords = null;
  let coordsDropped = false;
  if (lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat === 0 && lng === 0)) {
    if (inUsBox(lat, lng)) {
      // Inside a box but outside every state shape (Canada, Mexico, sea): only kept when the state is already known.
      const poly = polygonState ? polygonState(lng, lat) : null;
      if (poly === null && stateCode === null) {
        coordsDropped = true;
      } else {
        coords = { lat, lng };
        if (stateCode === null) {
          stateCode = poly;
          stateSource = 'polygon';
        }
      }
    } else {
      coordsDropped = true;
    }
  }
  // The city only comes from the state text, and only when that text agreed with the chosen code.
  const city = text.city !== null && (text.code === null || text.code === stateCode) ? text.city : null;

  const station = {
    id,
    name,
    streamUrl: streamText,
    homepage,
    favicon,
    stateCode,
    city,
    tags: tags.slice(0, 5),
    genres: cls.genres,
    codec: str(raw.codec),
    bitrate: finite(raw.bitrate) !== null && raw.bitrate > 0 ? raw.bitrate : null,
    hls: raw.hls === 1 || raw.hls === '1' || raw.hls === true,
    ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
    clickCount: Math.max(0, finite(raw.clickcount) ?? 0),
  };
  return { station, reason: null, stateSource: stateSource ?? 'null', coordsDropped };
}

function finite(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function isUrl(s) {
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}

/** Lower-cased, trimmed, deduplicated tags (max 24 chars each), first occurrence kept. */
export function parseTags(v) {
  const raw = typeof v === 'string' ? v : '';
  const out = [];
  for (const part of raw.split(',')) {
    const t = part.trim().replace(/\s+/g, ' ').toLowerCase();
    if (t.length === 0 || t.length > 24 || out.includes(t)) continue;
    out.push(t);
  }
  return out;
}

/** Removes repeats, keeping the first occurrence: same id, or same stream URL. */
export function dedupeCatalog(list) {
  const ids = new Set();
  const urls = new Set();
  const out = [];
  for (const s of list) {
    if (ids.has(s.id) || urls.has(s.streamUrl)) continue;
    ids.add(s.id);
    urls.add(s.streamUrl);
    out.push(s);
  }
  return out;
}

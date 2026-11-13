import type { Category, Coords, Station, StationCategory } from '@/types';
import { dedupeStations, normalizeStation } from './normalize';

export class RadioApiError extends Error {
  kind: 'network' | 'http' | 'parse' | 'aborted';

  constructor(kind: 'network' | 'http' | 'parse' | 'aborted', message: string) {
    super(message);
    this.name = 'RadioApiError';
    this.kind = kind;
  }
}

/** Failures worth one retry on the next server: network errors, timeouts, 5xx. */
class TransientError extends RadioApiError {}

const DISCOVERY_URL = 'https://all.api.radio-browser.info/json/servers';
const FALLBACK_HOSTS = ['de1', 'de2', 'fi1'].map((h) => `${h}.api.radio-browser.info`);
const HOST_PATTERN = /^[a-z0-9-]+\.api\.radio-browser\.info$/;
const DISCOVERY_TIMEOUT_MS = 5000;
const REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_SEARCH_LIMIT = 60;
const TOP_UP_THRESHOLD = 20;
const TOP_UP_LIMIT = 500;
const NEAR_DEFAULT_LIMIT = 200;
const NEAR_MAX_RADIUS_KM = 20000;
const NEAR_CACHE_MAX = 50;
const MAP_LIMIT = 1000;

/** Radio Browser tag hint per station category (server-side pre-filter). */
const TAG_HINT: Record<StationCategory, string> = {
  music: 'music',
  news: 'news',
  talk: 'talk',
  sports: 'sport',
};

// Session state: resolved once, shared by every request.
let hostsPromise: Promise<string[]> | null = null;
let activeHost = 0;
let mapPromise: Promise<Station[]> | null = null;
const nearCache = new Map<string, Promise<Station[]>>();

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function cancelled(): RadioApiError {
  return new RadioApiError('aborted', 'Request was cancelled.');
}

/** Fetches JSON with a timeout. Caller abort -> 'aborted'; timeout/network -> TransientError. */
async function getJson(url: string, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
  if (signal?.aborted) throw cancelled();
  const ctrl = new AbortController();
  let timedOut = false;
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  try {
    let res: Response;
    try {
      // No custom headers: a plain GET is a CORS "simple request" (no preflight).
      res = await fetch(url, { signal: ctrl.signal, credentials: 'omit' });
    } catch {
      if (signal?.aborted) throw cancelled();
      throw new TransientError('network', timedOut ? 'The station directory timed out.' : 'Network request failed.');
    }
    if (!res.ok) {
      if (res.status >= 500) throw new TransientError('http', `Station directory error ${res.status}.`);
      throw new RadioApiError('http', `Station directory rejected the request (${res.status}).`);
    }
    try {
      return await res.json();
    } catch {
      if (signal?.aborted) throw cancelled();
      if (timedOut) throw new TransientError('network', 'The station directory timed out.');
      throw new RadioApiError('parse', 'Unreadable response from the station directory.');
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Rejects early when the signal aborts, without cancelling the shared promise. */
function raceAbort<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(cancelled());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(cancelled());
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function discoverHosts(): Promise<string[]> {
  let discovered: string[] = [];
  try {
    const data = await getJson(DISCOVERY_URL, DISCOVERY_TIMEOUT_MS);
    if (Array.isArray(data)) {
      discovered = data
        .map((e) => (isRecord(e) && typeof e.name === 'string' ? e.name.trim().toLowerCase() : ''))
        .filter((n) => HOST_PATTERN.test(n));
    }
  } catch {
    // Discovery is best effort: the static list below still works.
  }
  const names = [...new Set([...shuffle([...new Set(discovered)]), ...FALLBACK_HOSTS])];
  return names.map((h) => `https://${h}`);
}

function resolveHosts(): Promise<string[]> {
  hostsPromise ??= discoverHosts();
  return hostsPromise;
}

/** GET a list endpoint on the active server; on a transient failure retry once on the next server. */
async function apiList(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<unknown[]> {
  const hosts = await raceAbort(resolveHosts(), signal);
  const qs = new URLSearchParams({ hidebroken: 'true', is_https: 'true', ...params });
  for (let attempt = 0; ; attempt++) {
    const base = hosts[activeHost % hosts.length];
    try {
      const data = await getJson(`${base}${path}?${qs.toString()}`, REQUEST_TIMEOUT_MS, signal);
      if (!Array.isArray(data)) throw new RadioApiError('parse', 'Unexpected response from the station directory.');
      return data;
    } catch (err) {
      if (!(err instanceof TransientError) || attempt >= 1) throw err;
      activeHost = (activeHost + 1) % hosts.length;
    }
  }
}

function toStations(rows: unknown[]): Station[] {
  const out: Station[] = [];
  for (const row of rows) {
    const s = normalizeStation(row);
    if (s !== null) out.push(s);
  }
  return out;
}

function inCategory(list: Station[], category: Category): Station[] {
  return category === 'all' ? list : list.filter((s) => s.categories.includes(category));
}

function byPopularity(a: Station, b: Station): number {
  return b.clickCount - a.clickCount;
}

const COUNTRY_ALIASES: Record<string, string> = {
  usa: 'US',
  us: 'US',
  america: 'US',
  uk: 'GB',
  britain: 'GB',
  england: 'GB',
  uae: 'AE',
  korea: 'KR',
  russia: 'RU',
};
const COUNTRY_PREFIX_MIN = 4;

/** Lower-cased English region name or alias -> ISO 3166-1 alpha-2. Built once. */
let countryIndex: Map<string, string> | null = null;

function getCountryIndex(): Map<string, string> {
  if (countryIndex !== null) return countryIndex;
  const index = new Map<string, string>();
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const a of letters) {
    for (const b of letters) {
      const code = `${a}${b}`;
      let name: string;
      try {
        name = names.of(code) ?? code;
      } catch {
        continue;
      }
      if (name === code) continue; // no real English name for this code
      index.set(name.toLowerCase(), code);
    }
  }
  for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) index.set(alias, code);
  countryIndex = index;
  return index;
}

/**
 * Maps a free-text query to a country code: an exact name or alias, or a prefix
 * of at least 4 characters that matches exactly one name. Anything else is null.
 */
export function countryCodeForQuery(query: string): string | null {
  const key = query.trim().toLowerCase();
  if (key.length === 0) return null;
  const index = getCountryIndex();
  const exact = index.get(key);
  if (exact !== undefined) return exact;
  if (key.length < COUNTRY_PREFIX_MIN) return null;
  const hits = [...index.keys()].filter((name) => name.startsWith(key));
  return hits.length === 1 ? (index.get(hits[0]) ?? null) : null;
}

function firstFailure(results: PromiseSettledResult<unknown[]>[]): RadioApiError {
  for (const r of results) {
    if (r.status === 'rejected') {
      return r.reason instanceof RadioApiError ? r.reason : new RadioApiError('network', 'Network request failed.');
    }
  }
  return new RadioApiError('network', 'Network request failed.');
}

/**
 * Searches stations. Empty query: popular stations (optionally hinted by tag,
 * topped up from a larger popular list when the hint yields too few).
 * Query: name and state matches, plus a country-code match when the query names a country; merged, deduped and sorted by clicks.
 */
export async function searchStations(
  p: { query: string; category: Category; limit?: number },
  signal?: AbortSignal,
): Promise<Station[]> {
  const query = p.query.trim();
  const limit = Math.max(1, Math.floor(p.limit ?? DEFAULT_SEARCH_LIMIT));
  const hint = p.category === 'all' ? undefined : TAG_HINT[p.category];
  const common: Record<string, string> = { order: 'clickcount', reverse: 'true', limit: String(limit) };
  if (hint) common.tag = hint;
  const path = '/json/stations/search';

  let rows: Station[];
  if (query.length > 0) {
    const countryCode = countryCodeForQuery(query);
    const requests: Promise<unknown[]>[] = [
      apiList(path, { ...common, name: query }, signal),
      apiList(path, { ...common, state: query }, signal),
    ];
    if (countryCode !== null) requests.push(apiList(path, { ...common, countrycode: countryCode }, signal));
    const settled = await Promise.allSettled(requests);
    if (signal?.aborted) throw cancelled();
    const ok = settled.filter((r): r is PromiseFulfilledResult<unknown[]> => r.status === 'fulfilled');
    if (ok.length === 0) throw firstFailure(settled);
    rows = ok.flatMap((r) => toStations(r.value));
  } else {
    rows = toStations(await apiList(path, common, signal));
    if (hint && inCategory(rows, p.category).length < TOP_UP_THRESHOLD) {
      const wide = await apiList(path, { order: 'clickcount', reverse: 'true', limit: String(TOP_UP_LIMIT) }, signal);
      rows = rows.concat(toStations(wide));
    }
  }

  const unique = dedupeStations(inCategory(rows, p.category));
  unique.sort(byPopularity);
  return unique.slice(0, limit);
}

/** Popular stations that have coordinates, world-wide. One request per session. */
export function fetchMapStations(signal?: AbortSignal): Promise<Station[]> {
  if (mapPromise === null) {
    const p = apiList('/json/stations/search', {
      has_geo_info: 'true',
      order: 'clickcount',
      reverse: 'true',
      limit: String(MAP_LIMIT),
    }).then((rows) => dedupeStations(toStations(rows).filter((s) => s.coords !== null)));
    mapPromise = p;
    // A failed load is not cached, so the next call retries.
    p.catch(() => {
      if (mapPromise === p) mapPromise = null;
    });
  }
  return raceAbort(mapPromise, signal);
}

function isValidCoords(c: Coords): boolean {
  return Number.isFinite(c.lat) && Number.isFinite(c.lng) && Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180;
}

/** Centre snapped to a 0.5 degree grid. Used for both the cache key and the request, so a hit always matches. */
function snapToHalfDegree(v: number): number {
  return Math.round(v * 2) / 2;
}

/** Stations with coordinates within radiusKm of c, most popular first. Cached per 0.5 degree cell and radius. */
export function fetchStationsNear(
  c: Coords,
  radiusKm: number,
  limit: number = NEAR_DEFAULT_LIMIT,
  signal?: AbortSignal,
): Promise<Station[]> {
  if (!isValidCoords(c)) return Promise.reject(new RadioApiError('parse', 'Invalid map position.'));
  const km = Number.isFinite(radiusKm) ? Math.min(Math.max(radiusKm, 1), NEAR_MAX_RADIUS_KM) : 50;
  const size = Math.max(1, Math.floor(limit));
  const lat = snapToHalfDegree(c.lat);
  const lng = snapToHalfDegree(c.lng);
  const key = `${lat}|${lng}|${km}|${size}`;

  let p = nearCache.get(key);
  if (p === undefined) {
    const req = apiList('/json/stations/search', {
      geo_lat: String(lat),
      geo_long: String(lng),
      geo_distance: String(Math.round(km * 1000)),
      order: 'clickcount',
      reverse: 'true',
      limit: String(size),
    }).then((rows) => dedupeStations(toStations(rows).filter((s) => s.coords !== null)));
    p = req;
    nearCache.set(key, req);
    req.catch(() => {
      if (nearCache.get(key) === req) nearCache.delete(key);
    });
    if (nearCache.size > NEAR_CACHE_MAX) {
      const oldest = nearCache.keys().next().value;
      if (oldest !== undefined) nearCache.delete(oldest);
    }
  }
  return raceAbort(p, signal);
}

/** Counts a station play, as the Radio Browser docs request. Fire-and-forget; never throws. */
export function reportClick(stationId: string): void {
  try {
    if (typeof stationId !== 'string' || stationId.trim() === '') return;
    const id = encodeURIComponent(stationId.trim());
    void resolveHosts()
      .then((hosts) => fetch(`${hosts[activeHost % hosts.length]}/json/url/${id}`, { credentials: 'omit' }))
      .catch(() => undefined);
  } catch {
    // swallow everything: a failed count must never affect playback
  }
}

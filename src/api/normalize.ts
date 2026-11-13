import type { Coords, Station } from '@/types';
import { classifyTags } from './categories';

const MAX_TAGS = 8;
const MAX_TAG_LENGTH = 24;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Trimmed non-empty string, or null. */
function text(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** Trimmed, internal whitespace collapsed to single spaces. */
function line(v: unknown): string | null {
  const t = text(v);
  return t === null ? null : t.replace(/\s+/g, ' ');
}

function parseUrl(s: string | null): URL | null {
  if (s === null) return null;
  try {
    return new URL(s);
  } catch {
    return null;
  }
}

function finiteNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Radio Browser encodes booleans as 0/1 (sometimes as strings). */
function flag(v: unknown): boolean {
  return v === 1 || v === '1' || v === true;
}

function coordsOf(lat: unknown, lng: unknown): Coords | null {
  const la = finiteNumber(lat);
  const ln = finiteNumber(lng);
  if (la === null || ln === null) return null;
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
  if (la === 0 && ln === 0) return null;
  return { lat: la, lng: ln };
}

let regionNames: Intl.DisplayNames | null | undefined;

/** English country name from the ISO code; falls back to the raw `country` field. */
function countryName(code: string | null, raw: string | null): string | null {
  if (code !== null) {
    if (regionNames === undefined) {
      try {
        regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
      } catch {
        regionNames = null;
      }
    }
    try {
      const name = regionNames?.of(code);
      if (name && name !== code) return name;
    } catch {
      // unknown code: use the raw field below
    }
  }
  return raw;
}

/** All valid tags (lower case, trimmed, no empties, at most 24 chars), first occurrence kept. */
function parseTags(v: unknown): string[] {
  const raw = typeof v === 'string' ? v : '';
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const t = part.trim().replace(/\s+/g, ' ').toLowerCase();
    if (t.length === 0 || t.length > MAX_TAG_LENGTH || out.includes(t)) continue;
    out.push(t);
  }
  return out;
}

/**
 * Turns one raw Radio Browser record into a Station. Returns null when the
 * record cannot be played safely (no uuid, no name, or a non-https stream).
 * Never invents values: missing optional fields become null.
 */
export function normalizeStation(raw: unknown): Station | null {
  if (!isRecord(raw)) return null;

  const id = text(raw.stationuuid);
  if (id === null) return null;

  const name = line(raw.name);
  if (name === null) return null;

  // Prefer the resolved URL, as the contract specifies.
  const streamText = text(raw.url_resolved) ?? text(raw.url);
  const stream = parseUrl(streamText);
  if (streamText === null || stream === null || stream.protocol !== 'https:') return null;

  const homepageUrl = parseUrl(text(raw.homepage));
  const homepage =
    homepageUrl !== null && (homepageUrl.protocol === 'https:' || homepageUrl.protocol === 'http:')
      ? text(raw.homepage)
      : null;

  const faviconUrl = parseUrl(text(raw.favicon));
  const favicon = faviconUrl !== null && faviconUrl.protocol === 'https:' ? text(raw.favicon) : null;

  const rawCode = text(raw.countrycode);
  const countryCode = rawCode !== null && /^[A-Za-z]{2}$/.test(rawCode) ? rawCode.toUpperCase() : null;

  const allTags = parseTags(raw.tags);

  const bitrate = finiteNumber(raw.bitrate);
  const lastCheckTime = text(raw.lastchecktime_iso8601);

  return {
    id,
    name,
    streamUrl: streamText,
    homepage,
    favicon,
    country: countryName(countryCode, line(raw.country)),
    countryCode,
    region: line(raw.state),
    tags: allTags.slice(0, MAX_TAGS),
    categories: classifyTags(allTags),
    codec: text(raw.codec),
    bitrate: bitrate !== null && bitrate > 0 ? bitrate : null,
    hls: flag(raw.hls),
    coords: coordsOf(raw.geo_lat, raw.geo_long),
    lastCheckOk: flag(raw.lastcheckok),
    lastCheckTime: lastCheckTime !== null && !Number.isNaN(Date.parse(lastCheckTime)) ? lastCheckTime : null,
    clickCount: Math.max(0, finiteNumber(raw.clickcount) ?? 0),
    votes: Math.max(0, finiteNumber(raw.votes) ?? 0),
  };
}

/**
 * Removes repeats, keeping the first occurrence. A station is a repeat when its
 * id or its stream URL was already seen. Same-named stations in one country are
 * kept: they are often distinct regional broadcasters.
 */
export function dedupeStations(list: Station[]): Station[] {
  const ids = new Set<string>();
  const urls = new Set<string>();
  const out: Station[] = [];
  for (const s of list) {
    if (ids.has(s.id) || urls.has(s.streamUrl)) continue;
    ids.add(s.id);
    urls.add(s.streamUrl);
    out.push(s);
  }
  return out;
}

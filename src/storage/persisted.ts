import { createStore, type Store } from '@/lib/createStore';
import { readJSON, writeJSON } from '@/lib/safeStorage';
import type { Coords, Station, StationCategory } from '@/types';

const CATEGORIES: readonly string[] = ['music', 'news', 'talk', 'sports'];
const MIN_ID_LENGTH = 8;
const MIN_NAME_LENGTH = 2;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Trimmed non-empty string, or null. */
function text(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function isUrlWith(s: string, protocols: readonly string[]): boolean {
  try {
    return protocols.includes(new URL(s).protocol);
  } catch {
    return false;
  }
}

function nonNegative(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

function coordsOf(v: unknown): Coords | null {
  if (!isRecord(v)) return null;
  const { lat, lng } = v;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

/**
 * Strict check for a stored station snapshot. Returns a fully typed Station with
 * every field validated, or null when id (8+ characters), name (2+ characters) or the https stream is unusable.
 * Other bad fields are replaced by their empty value, so nothing unsafe is kept.
 */
export function sanitizeStation(v: unknown): Station | null {
  if (!isRecord(v)) return null;
  const id = text(v.id);
  const name = text(v.name);
  const streamUrl = text(v.streamUrl);
  // Real ids are UUIDs, and no station is named with a single character.
  if (id === null || id.length < MIN_ID_LENGTH) return null;
  if (name === null || name.length < MIN_NAME_LENGTH) return null;
  if (streamUrl === null || !isUrlWith(streamUrl, ['https:'])) return null;

  const homepage = text(v.homepage);
  const favicon = text(v.favicon);
  const lastCheckTime = text(v.lastCheckTime);
  const bitrate = v.bitrate;

  return {
    id,
    name,
    streamUrl,
    homepage: homepage !== null && isUrlWith(homepage, ['http:', 'https:']) ? homepage : null,
    favicon: favicon !== null && isUrlWith(favicon, ['https:']) ? favicon : null,
    country: text(v.country),
    countryCode: text(v.countryCode),
    region: text(v.region),
    tags: Array.isArray(v.tags) ? v.tags.filter((t): t is string => typeof t === 'string') : [],
    categories: Array.isArray(v.categories)
      ? v.categories.filter((c): c is StationCategory => typeof c === 'string' && CATEGORIES.includes(c))
      : [],
    codec: text(v.codec),
    bitrate: typeof bitrate === 'number' && Number.isFinite(bitrate) ? bitrate : null,
    hls: v.hls === true,
    coords: coordsOf(v.coords),
    lastCheckOk: v.lastCheckOk === true,
    lastCheckTime: lastCheckTime !== null && !Number.isNaN(Date.parse(lastCheckTime)) ? lastCheckTime : null,
    clickCount: nonNegative(v.clickCount),
    votes: nonNegative(v.votes),
  };
}

export interface Persisted<T> {
  store: Store<T>;
  /** Updates memory first, then writes through. A failed write keeps the in-memory state. */
  commit(next: T): void;
}

export interface StorageHealth {
  /** True once any write-through has failed in this session. */
  writeFailed: boolean;
}

/** Session-wide write health, read by the settings notice. */
export const storageHealth: Store<StorageHealth> = createStore<StorageHealth>({ writeFailed: false });

/**
 * Hydrates a store from one localStorage key, writes every commit back, and
 * re-reads the key when another tab changes it.
 */
export function createPersisted<T>(key: string, parse: (raw: unknown) => T): Persisted<T> {
  const store = createStore<T>(parse(readJSON<unknown>(key, null)));

  const commit = (next: T): void => {
    store.set(next);
    if (!writeJSON(key, next) && !storageHealth.get().writeFailed) storageHealth.set({ writeFailed: true });
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      // e.key is null when another tab cleared all of localStorage.
      if (e.key === key || e.key === null) store.set(parse(readJSON<unknown>(key, null)));
    });
  }

  return { store, commit };
}

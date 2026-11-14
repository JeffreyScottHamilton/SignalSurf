import type { Station } from '@/types';
import { absorbLegacyFavorites } from './favorites';
import { absorbLegacyHistory } from './history';
import { absorbLegacySettings } from './settings';

/** Keys written by SignalSurf before the Roadtrip Radio rename. */
export const LEGACY_KEYS = {
  favorites: 'signalsurf:favorites:v1',
  history: 'signalsurf:history:v1',
  settings: 'signalsurf:settings:v1',
} as const;

const NEW_KEYS = {
  favorites: 'roadtrip:favorites:v1',
  history: 'roadtrip:history:v1',
  settings: 'roadtrip:settings:v1',
} as const;

const LEGACY_LOCATION_FIELDS = ['country', 'countryCode', 'region', 'categories'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Old snapshot to current shape. A station that is in the catalogue takes the catalogue record.
 * Otherwise region and country are dropped (never mapped to a guessed state or city) and the
 * station keeps everything else, so it stays playable.
 */
function adaptStation(v: unknown, byId: ReadonlyMap<string, Station>): unknown {
  if (!isRecord(v)) return v;
  const id = typeof v.id === 'string' ? v.id : null;
  const fromCatalog = id !== null ? byId.get(id) : undefined;
  if (fromCatalog !== undefined) return fromCatalog;
  const rest: Record<string, unknown> = { ...v };
  for (const key of LEGACY_LOCATION_FIELDS) delete rest[key];
  return { ...rest, stateCode: null, city: null, genres: [] };
}

/** Favourites are station lists; history entries wrap a station as { station, playedAt }. */
function adaptList(raw: unknown, byId: ReadonlyMap<string, Station>, history: boolean): unknown[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    if (!history) return adaptStation(item, byId);
    if (!isRecord(item)) return item;
    return { ...item, station: adaptStation(item.station, byId) };
  });
}

/** Reads a legacy key: null when absent, undefined when corrupt. */
function readLegacy(key: string): { raw: unknown } | null | undefined {
  let text: string | null;
  try {
    text = globalThis.localStorage.getItem(key);
  } catch {
    return null;
  }
  if (text === null) return null;
  try {
    return { raw: JSON.parse(text) as unknown };
  } catch {
    return undefined;
  }
}

function removeLegacy(key: string): void {
  try {
    globalThis.localStorage.removeItem(key);
  } catch {
    // Storage blocked: nothing to remove.
  }
}

function newKeyAbsent(key: string): boolean {
  try {
    return globalThis.localStorage.getItem(key) === null;
  } catch {
    return true;
  }
}

let done = false;

/**
 * One-time move of the SignalSurf keys to the Roadtrip Radio keys. For each store: when the legacy
 * key exists it is read, adapted, merged into the store (which writes the new key) and removed.
 * A corrupt legacy value is removed without being used. Runs once per session, after the catalogue
 * settles, so catalogue records can replace old snapshots. Pass [] when the catalogue failed.
 */
export function migrateLegacyStorage(catalog: readonly Station[]): void {
  if (done) return;
  done = true;
  const byId = new Map(catalog.map((s) => [s.id, s]));

  const fav = readLegacy(LEGACY_KEYS.favorites);
  if (fav) absorbLegacyFavorites(adaptList(fav.raw, byId, false));
  if (fav !== null) removeLegacy(LEGACY_KEYS.favorites);

  const hist = readLegacy(LEGACY_KEYS.history);
  if (hist) absorbLegacyHistory(adaptList(hist.raw, byId, true));
  if (hist !== null) removeLegacy(LEGACY_KEYS.history);

  const set = readLegacy(LEGACY_KEYS.settings);
  if (set && newKeyAbsent(NEW_KEYS.settings)) absorbLegacySettings(set.raw);
  if (set !== null) removeLegacy(LEGACY_KEYS.settings);
}

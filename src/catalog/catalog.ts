import { createStore, type Store } from '@/lib/createStore';
import type { LoadStatus, Station } from '@/types';
import { migrateLegacyStorage } from '@/storage/migrate';
import { sanitizeStation } from './sanitize';

export interface CatalogState {
  status: LoadStatus;
  stations: Station[];
  /** ISO time the catalogue was built, from the file. */
  generatedAt: string | null;
  error: string | null;
}

export const CATALOG_ERROR = "Couldn't load the station catalogue. Check your connection and try again.";

export const catalogStore: Store<CatalogState> = createStore<CatalogState>({
  status: 'idle',
  stations: [],
  generatedAt: null,
  error: null,
});

/** Catalogue record fields lat/lng become the Station coords object. Anything else is left to sanitizeStation. */
function withCoords(v: unknown): unknown {
  if (typeof v !== 'object' || v === null) return v;
  const { lat, lng, ...rest } = v as Record<string, unknown>;
  return { ...rest, coords: typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null };
}

/**
 * Validates a catalogue document. Records that fail the station check, or repeat an id, are skipped.
 * Returns null when the document has no stations array.
 */
export function parseCatalog(raw: unknown): { stations: Station[]; generatedAt: string | null } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const doc = raw as { stations?: unknown; generatedAt?: unknown };
  if (!Array.isArray(doc.stations)) return null;
  const seen = new Set<string>();
  const stations: Station[] = [];
  for (const item of doc.stations) {
    const s = sanitizeStation(withCoords(item));
    if (s === null || seen.has(s.id)) continue;
    seen.add(s.id);
    stations.push(s);
  }
  const generatedAt =
    typeof doc.generatedAt === 'string' && !Number.isNaN(Date.parse(doc.generatedAt)) ? doc.generatedAt : null;
  return { stations, generatedAt };
}

/** Same origin as the app. Relative to the Vite base so it works under a sub-path. */
export function catalogUrl(): string {
  return `${import.meta.env.BASE_URL}catalog.json`;
}

let generation = 0;

async function fetchCatalog(): Promise<{ stations: Station[]; generatedAt: string | null }> {
  const res = await fetch(catalogUrl());
  if (!res.ok) throw new Error(`catalogue HTTP ${res.status}`);
  const doc = parseCatalog(await res.json());
  if (doc === null) throw new Error('catalogue unreadable');
  return doc;
}

function load(): void {
  const gen = ++generation;
  catalogStore.set((prev) => ({ ...prev, status: 'loading', error: null }));
  fetchCatalog().then(
    (doc) => {
      if (gen !== generation) return;
      catalogStore.set({ status: 'ready', stations: doc.stations, generatedAt: doc.generatedAt, error: null });
      migrateLegacyStorage(doc.stations);
    },
    () => {
      if (gen !== generation) return;
      catalogStore.set((prev) => ({ ...prev, status: 'error', stations: [], error: CATALOG_ERROR }));
      // Legacy favourites still need moving, just without catalogue lookups.
      migrateLegacyStorage([]);
    },
  );
}

/** Loads the catalogue once per session. Idempotent while loading or after a successful load. */
export function initCatalog(): void {
  const { status } = catalogStore.get();
  if (status === 'loading' || status === 'ready') return;
  load();
}

/** Loads the catalogue again after a failure. */
export function retryCatalog(): void {
  load();
}

import { createStore, type Store } from '@/lib/createStore';
import { catalogStore, initCatalog, retryCatalog, type CatalogState } from '@/catalog/catalog';
import { filterStations } from '@/catalog/search';
import type { GenreFilter, LoadStatus, Station } from '@/types';

export interface ExploreState {
  query: string;
  genre: GenreFilter;
  /** Every station matching query and genre, most popular first. */
  results: Station[];
  /** How many of `results` the list shows. Grows by PAGE_SIZE on loadMore. */
  visibleCount: number;
  /** More matches exist beyond visibleCount. Derived: visibleCount < results.length. */
  hasMore: boolean;
  /** Mirrors the catalogue load. */
  status: LoadStatus;
  error: string | null;
}

export const PAGE_SIZE = 150;
export const SEARCH_DEBOUNCE_MS = 150;

export const exploreStore: Store<ExploreState> = createStore<ExploreState>({
  query: '',
  genre: 'all',
  results: [],
  visibleCount: PAGE_SIZE,
  hasMore: false,
  status: 'idle',
  error: null,
});

let debounceTimer: ReturnType<typeof setTimeout> | undefined;
/** Trimmed query waiting for the debounce to finish. */
let pendingQuery: string | null = null;

/** The state for a query and genre against a catalogue snapshot. Resets the visible count when asked. */
function derive(prev: ExploreState, query: string, genre: GenreFilter, catalog: CatalogState, resetVisible: boolean): ExploreState {
  const ready = catalog.status === 'ready';
  const results = ready ? filterStations(catalog.stations, { query, genre }) : [];
  const visibleCount = resetVisible ? PAGE_SIZE : prev.visibleCount;
  return {
    ...prev,
    query,
    genre,
    results,
    visibleCount,
    hasMore: visibleCount < results.length,
    status: catalog.status,
    error: catalog.error,
  };
}

function clearDebounce(): void {
  if (debounceTimer !== undefined) clearTimeout(debounceTimer);
  debounceTimer = undefined;
}

/** Applies a query and genre. A change restarts the list at the first page. */
function apply(query: string, genre: GenreFilter): void {
  const prev = exploreStore.get();
  if (prev.query === query && prev.genre === genre) return;
  const changed = prev.query !== query || prev.genre !== genre;
  exploreStore.set((p) => derive(p, query, genre, catalogStore.get(), changed));
}

// Keep the list in step with the catalogue: loading, ready, error, retry.
catalogStore.subscribe(() => {
  exploreStore.set((p) => derive(p, p.query, p.genre, catalogStore.get(), false));
});

/** Debounced (150 ms) and local. Trims the query. Each completed debounce applies it. */
export function setQuery(q: string): void {
  pendingQuery = q.trim();
  clearDebounce();
  debounceTimer = setTimeout(() => {
    debounceTimer = undefined;
    const query = pendingQuery ?? '';
    pendingQuery = null;
    apply(query, exploreStore.get().genre);
  }, SEARCH_DEBOUNCE_MS);
}

/** Immediate. A query still waiting for its debounce is applied with the genre change. */
export function setGenre(g: GenreFilter): void {
  clearDebounce();
  const query = pendingQuery ?? exploreStore.get().query;
  pendingQuery = null;
  apply(query, g);
}

/** Reveals the next PAGE_SIZE stations from the local results. No network. */
export function loadMore(): void {
  exploreStore.set((prev) => {
    if (prev.visibleCount >= prev.results.length) return prev;
    const visibleCount = Math.min(prev.results.length, prev.visibleCount + PAGE_SIZE);
    return { ...prev, visibleCount, hasMore: visibleCount < prev.results.length };
  });
}

export function resetExplore(): void {
  clearDebounce();
  pendingQuery = null;
  apply('', 'all');
}

/** Loads the catalogue again after an error. */
export function retryExplore(): void {
  retryCatalog();
}

/** First load of the catalogue. Idempotent. */
export function initExplore(): void {
  initCatalog();
}

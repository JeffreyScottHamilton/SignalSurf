import { createStore, type Store } from '@/lib/createStore';
import { RadioApiError, SEARCH_PAGE_SIZE, searchStationsPage } from '@/api/radioBrowser';
import type { Category, LoadStatus, Station } from '@/types';

export interface ExploreState {
  query: string;
  category: Category;
  results: Station[];
  status: LoadStatus;
  error: string | null;
  /** The directory may hold more results for this query: the next page can be requested. */
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError: string | null;
  /** Stations the last successful load-more added after de-duplication. 0 otherwise. */
  addedLastPage: number;
}

const DEBOUNCE_MS = 350;
const ERROR_MESSAGE = "Couldn't reach the station directory. Check your connection and try again.";
const LOAD_MORE_ERROR_MESSAGE = "Couldn't load more stations. Try again.";

export const exploreStore: Store<ExploreState> = createStore<ExploreState>({
  query: '',
  category: 'all',
  results: [],
  status: 'idle',
  error: null,
  hasMore: false,
  loadingMore: false,
  loadMoreError: null,
  addedLastPage: 0,
});

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
/** Trimmed query waiting for the debounce to finish. */
let pendingQuery: string | null = null;
let inFlight: AbortController | null = null;
/** Incremented per request; a response is applied only if it is still the newest. */
let requestId = 0;
/** Pages of the current query applied to the list. The next page starts at loadedPages x SEARCH_PAGE_SIZE. */
let loadedPages = 0;
let loadMoreCtrl: AbortController | null = null;
let initialized = false;

function abortLoadMore(): void {
  loadMoreCtrl?.abort();
  loadMoreCtrl = null;
}

/** Incoming stations not already listed (by id or stream URL), first occurrence kept. */
function freshStations(listed: Station[], incoming: Station[]): Station[] {
  const ids = new Set(listed.map((s) => s.id));
  const urls = new Set(listed.map((s) => s.streamUrl));
  const out: Station[] = [];
  for (const s of incoming) {
    if (ids.has(s.id) || urls.has(s.streamUrl)) continue;
    ids.add(s.id);
    urls.add(s.streamUrl);
    out.push(s);
  }
  return out;
}

function clearDebounce(): void {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = null;
}

/** Runs a search for the current store query and category, cancelling any earlier one. */
function run(): void {
  inFlight?.abort();
  abortLoadMore();
  const ctrl = new AbortController();
  inFlight = ctrl;
  const id = ++requestId;
  loadedPages = 0;
  const { query, category } = exploreStore.get();
  exploreStore.set((prev) => ({
    ...prev,
    status: 'loading',
    error: null,
    hasMore: false,
    loadingMore: false,
    loadMoreError: null,
    addedLastPage: 0,
  }));

  searchStationsPage({ query, category, limit: SEARCH_PAGE_SIZE, offset: 0 }, ctrl.signal).then(
    (page) => {
      if (id !== requestId) return;
      inFlight = null;
      loadedPages = 1;
      exploreStore.set((prev) => ({
        ...prev,
        results: page.stations,
        status: 'ready',
        error: null,
        hasMore: page.hasMore,
      }));
    },
    (err: unknown) => {
      if (id !== requestId) return;
      if (err instanceof RadioApiError && err.kind === 'aborted') return;
      inFlight = null;
      exploreStore.set((prev) => ({ ...prev, results: [], status: 'error', error: ERROR_MESSAGE }));
    },
  );
}

/** Applies the pending (debounced) query to the store, if any, and returns the patch. */
function takePendingQuery(): Partial<ExploreState> {
  if (pendingQuery === null) return {};
  const query = pendingQuery;
  pendingQuery = null;
  return { query };
}

/** Debounced (350 ms). Trims the query. Each completed debounce starts a new search. */
export function setQuery(q: string): void {
  pendingQuery = q.trim();
  clearDebounce();
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const patch = takePendingQuery();
    exploreStore.set((prev) => ({ ...prev, ...patch }));
    run();
  }, DEBOUNCE_MS);
}

/** Immediate. A query still waiting for its debounce is applied with the category change. */
export function setCategory(c: Category): void {
  clearDebounce();
  const patch = takePendingQuery();
  exploreStore.set((prev) => ({ ...prev, ...patch, category: c }));
  run();
}

/**
 * Requests the next page of the current query and appends its new stations.
 * No-op unless the list is ready, has more, and no page is already loading.
 * A new search aborts this load, so a late response can never reach the new results.
 */
export function loadMore(): void {
  const s = exploreStore.get();
  if (s.status !== 'ready' || !s.hasMore || s.loadingMore || loadMoreCtrl !== null) return;
  const ctrl = new AbortController();
  loadMoreCtrl = ctrl;
  const id = requestId;
  const offset = loadedPages * SEARCH_PAGE_SIZE;
  exploreStore.set((prev) => ({ ...prev, loadingMore: true, loadMoreError: null }));

  searchStationsPage({ query: s.query, category: s.category, limit: SEARCH_PAGE_SIZE, offset }, ctrl.signal).then(
    (page) => {
      if (id !== requestId || loadMoreCtrl !== ctrl) return;
      loadMoreCtrl = null;
      loadedPages += 1;
      exploreStore.set((prev) => {
        const added = freshStations(prev.results, page.stations);
        return {
          ...prev,
          results: added.length > 0 ? [...prev.results, ...added] : prev.results,
          hasMore: page.hasMore,
          loadingMore: false,
          loadMoreError: null,
          addedLastPage: added.length,
        };
      });
    },
    () => {
      if (id !== requestId || loadMoreCtrl !== ctrl) return;
      loadMoreCtrl = null;
      exploreStore.set((prev) => ({ ...prev, loadingMore: false, loadMoreError: LOAD_MORE_ERROR_MESSAGE }));
    },
  );
}

export function resetExplore(): void {
  clearDebounce();
  pendingQuery = null;
  exploreStore.set((prev) => ({ ...prev, query: '', category: 'all' }));
  run();
}

export function retryExplore(): void {
  run();
}

/** First load. Idempotent. */
export function initExplore(): void {
  if (initialized) return;
  initialized = true;
  run();
}

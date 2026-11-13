import { createStore, type Store } from '@/lib/createStore';
import { RadioApiError, searchStations } from '@/api/radioBrowser';
import type { Category, LoadStatus, Station } from '@/types';

export interface ExploreState {
  query: string;
  category: Category;
  results: Station[];
  status: LoadStatus;
  error: string | null;
}

const DEBOUNCE_MS = 350;
const ERROR_MESSAGE = "Couldn't reach the station directory. Check your connection and try again.";

export const exploreStore: Store<ExploreState> = createStore<ExploreState>({
  query: '',
  category: 'all',
  results: [],
  status: 'idle',
  error: null,
});

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
/** Trimmed query waiting for the debounce to finish. */
let pendingQuery: string | null = null;
let inFlight: AbortController | null = null;
/** Incremented per request; a response is applied only if it is still the newest. */
let requestId = 0;
let initialized = false;

function clearDebounce(): void {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = null;
}

/** Runs a search for the current store query and category, cancelling any earlier one. */
function run(): void {
  inFlight?.abort();
  const ctrl = new AbortController();
  inFlight = ctrl;
  const id = ++requestId;
  const { query, category } = exploreStore.get();
  exploreStore.set((prev) => ({ ...prev, status: 'loading', error: null }));

  searchStations({ query, category }, ctrl.signal).then(
    (results) => {
      if (id !== requestId) return;
      inFlight = null;
      exploreStore.set((prev) => ({ ...prev, results, status: 'ready', error: null }));
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

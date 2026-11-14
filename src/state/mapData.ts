import { createStore, type Store } from '@/lib/createStore';
import { fetchMapStationsPage, fetchStationsNear } from '@/api/radioBrowser';
import type { Coords, LoadStatus, Station } from '@/types';

/**
 * Progress of the background pages after page 0. 'skipped' when data-saver or a 2G connection is set.
 * A failed background page ends as 'done' and keeps what is loaded.
 */
export type BackgroundStatus = 'idle' | 'loading' | 'done' | 'skipped';

export interface MapDataState {
  stations: Station[];
  status: LoadStatus;
  backgroundStatus: BackgroundStatus;
}

const CAP = 6000;
/** Map pages loaded after page 0, one at a time: 1000 + 2000 more stations in the background. */
const BACKGROUND_PAGES: readonly number[] = [1, 2];
/** Start delay when requestIdleCallback is missing, and the idle deadline when it is present. */
const IDLE_FALLBACK_MS = 1500;

export const mapStore: Store<MapDataState> = createStore<MapDataState>({
  stations: [],
  status: 'idle',
  backgroundStatus: 'idle',
});

/** Merges by id (incoming wins, moves to the end) and keeps the newest CAP entries. */
function mergeStations(prev: Station[], incoming: Station[]): Station[] {
  const byId = new Map<string, Station>();
  for (const s of prev) byId.set(s.id, s);
  for (const s of incoming) {
    byId.delete(s.id);
    byId.set(s.id, s);
  }
  const all = [...byId.values()];
  return all.length > CAP ? all.slice(all.length - CAP) : all;
}

function saveDataOrSlow(): boolean {
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return conn?.saveData === true || conn?.effectiveType === 'slow-2g' || conn?.effectiveType === '2g';
}

/** Runs `task` when the browser is idle; falls back to a plain timer where requestIdleCallback is missing. */
function whenIdle(task: () => void): void {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(task, { timeout: IDLE_FALLBACK_MS });
  } else {
    setTimeout(task, IDLE_FALLBACK_MS);
  }
}

function setBackgroundStatus(backgroundStatus: BackgroundStatus): void {
  mapStore.set((prev) => ({ ...prev, backgroundStatus }));
}

/** Loads the next page when the browser is idle. Stops at the first failure or page that adds no new station. */
function loadBackgroundPages(pages: readonly number[]): void {
  const [page, ...rest] = pages;
  if (page === undefined) {
    setBackgroundStatus('done');
    return;
  }
  whenIdle(() => {
    fetchMapStationsPage(page).then(
      (list) => {
        const known = new Set(mapStore.get().stations.map((s) => s.id));
        const addsNew = list.some((s) => !known.has(s.id));
        mapStore.set((prev) => ({ ...prev, stations: mergeStations(prev.stations, list) }));
        if (addsNew) loadBackgroundPages(rest);
        else setBackgroundStatus('done');
      },
      () => setBackgroundStatus('done'),
    );
  });
}

/** Starts the background pages once. Skipped on data-saver or 2G connections. */
function startBackground(): void {
  if (mapStore.get().backgroundStatus !== 'idle') return;
  if (saveDataOrSlow()) {
    setBackgroundStatus('skipped');
    return;
  }
  setBackgroundStatus('loading');
  loadBackgroundPages(BACKGROUND_PAGES);
}

/**
 * Loads the popular world-wide stations with coordinates (page 0), then the background pages.
 * Retries page 0 after a failure; no-op while loading or loaded. Background loading starts once.
 */
export function initMapData(): void {
  const { status } = mapStore.get();
  if (status === 'loading' || status === 'ready') return;
  mapStore.set((prev) => ({ ...prev, status: 'loading' }));
  fetchMapStationsPage(0).then(
    (list) => {
      mapStore.set((prev) => ({ ...prev, stations: mergeStations(prev.stations, list), status: 'ready' }));
      startBackground();
    },
    () => mapStore.set((prev) => ({ ...prev, status: 'error' })),
  );
}

/** Adds stations near a point to the map. Failures are ignored; the map keeps what it has. */
export function loadNear(c: Coords, radiusKm: number): void {
  fetchStationsNear(c, radiusKm).then(
    (list) => mapStore.set((prev) => ({ ...prev, stations: mergeStations(prev.stations, list) })),
    () => undefined,
  );
}

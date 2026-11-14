import { createStore, type Store } from '@/lib/createStore';
import { fetchMapStationsPage, fetchStationsNear, nearKey } from '@/api/radioBrowser';
import type { Coords, LoadStatus, Station } from '@/types';

/** 'loading' only while a nearby request has been in flight for more than NEAR_CHIP_DELAY_MS. */
export type NearStatus = 'idle' | 'loading';

export interface MapDataState {
  stations: Station[];
  status: LoadStatus;
  nearStatus: NearStatus;
}

const CAP = 8000;
/** A nearby request shows its status chip only after this long, so quick answers never flash it. */
const NEAR_CHIP_DELAY_MS = 400;

export const mapStore: Store<MapDataState> = createStore<MapDataState>({
  stations: [],
  status: 'idle',
  nearStatus: 'idle',
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

/** Loads the popular world-wide stations with coordinates (page 0). Nothing else is loaded up front. */
export function initMapData(): void {
  const { status } = mapStore.get();
  if (status === 'loading' || status === 'ready') return;
  mapStore.set((prev) => ({ ...prev, status: 'loading' }));
  fetchMapStationsPage(0).then(
    (list) => mapStore.set((prev) => ({ ...prev, stations: mergeStations(prev.stations, list), status: 'ready' })),
    () => mapStore.set((prev) => ({ ...prev, status: 'error' })),
  );
}

/** The nearby request in flight, if any. Only the latest one may update the store. */
let nearCtrl: AbortController | null = null;
let nearTimer: ReturnType<typeof setTimeout> | undefined;
/** Keys (snapped centre and radius bucket) whose stations are already on the map. */
const loadedNear = new Set<string>();

function setNearStatus(nearStatus: NearStatus): void {
  mapStore.set((prev) => (prev.nearStatus === nearStatus ? prev : { ...prev, nearStatus }));
}

/**
 * Adds the most popular stations near a point to the map. A new call aborts the one in flight.
 * An area already loaded (same snapped centre and radius bucket) is not requested again.
 * Failures are ignored; the map keeps what it has.
 */
export function loadNear(c: Coords, radiusKm: number): void {
  nearCtrl?.abort();
  nearCtrl = null;
  clearTimeout(nearTimer);
  setNearStatus('idle');
  const key = nearKey(c, radiusKm);
  if (key === null || loadedNear.has(key)) return;

  const ctrl = new AbortController();
  nearCtrl = ctrl;
  nearTimer = setTimeout(() => {
    if (nearCtrl === ctrl) setNearStatus('loading');
  }, NEAR_CHIP_DELAY_MS);

  /** Ends this request's status. False when a newer request has replaced it. */
  const finish = (): boolean => {
    if (nearCtrl !== ctrl) return false;
    nearCtrl = null;
    clearTimeout(nearTimer);
    setNearStatus('idle');
    return true;
  };

  fetchStationsNear(c, radiusKm, undefined, ctrl.signal).then(
    (list) => {
      if (!finish()) return;
      loadedNear.add(key);
      mapStore.set((prev) => ({ ...prev, stations: mergeStations(prev.stations, list) }));
    },
    () => {
      finish();
    },
  );
}

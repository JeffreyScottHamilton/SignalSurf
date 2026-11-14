import { createStore, type Store } from '@/lib/createStore';
import { fetchMapStations, fetchStationsNear } from '@/api/radioBrowser';
import type { Coords, LoadStatus, Station } from '@/types';

export interface MapDataState {
  stations: Station[];
  status: LoadStatus;
}

const CAP = 6000;

export const mapStore: Store<MapDataState> = createStore<MapDataState>({
  stations: [],
  status: 'idle',
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

/** Loads the popular world-wide stations with coordinates. Retries after a failure; no-op while loading or loaded. */
export function initMapData(): void {
  const { status } = mapStore.get();
  if (status === 'loading' || status === 'ready') return;
  mapStore.set((prev) => ({ ...prev, status: 'loading' }));
  fetchMapStations().then(
    (list) => mapStore.set((prev) => ({ stations: mergeStations(prev.stations, list), status: 'ready' })),
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

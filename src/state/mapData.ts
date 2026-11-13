// STUB — replaced by slice S1
import { createStore, type Store } from '@/lib/createStore';
import type { Coords, LoadStatus, Station } from '@/types';

export interface MapDataState {
  stations: Station[];
  status: LoadStatus;
}

export const mapStore: Store<MapDataState> = createStore<MapDataState>({
  stations: [],
  status: 'idle',
});

export function initMapData(): void {}

export function loadNear(c: Coords, radiusKm: number): void {
  void c;
  void radiusKm;
}

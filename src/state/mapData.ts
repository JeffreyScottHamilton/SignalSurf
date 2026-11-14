import { useMemo } from 'react';
import { catalogStore } from '@/catalog/catalog';
import { useStore } from '@/lib/createStore';
import { hasValidCoords } from '@/map/markerSet';
import type { LoadStatus, Station } from '@/types';
import { exploreStore } from './explore';

/** The stations to draw: those with coordinates among the list's matches (same query and genre). */
export function mapStationsFor(matches: readonly Station[]): Station[] {
  return matches.filter((s) => hasValidCoords(s.coords));
}

/** Derived from the explore results, so the map and the list always agree. */
export function useMapStations(): Station[] {
  const results = useStore(exploreStore, (s) => s.results);
  return useMemo(() => mapStationsFor(results), [results]);
}

export function useMapStatus(): LoadStatus {
  return useStore(catalogStore, (s) => s.status);
}

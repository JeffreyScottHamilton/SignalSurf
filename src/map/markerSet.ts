import type { Coords, Station } from '@/types';

/** True when coords are finite, in range, and not the (0,0) placeholder. */
export function hasValidCoords(c: Coords | null | undefined): c is Coords {
  if (!c || typeof c !== 'object') return false;
  const { lat, lng } = c;
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return !(lat === 0 && lng === 0);
}

/**
 * Stations that can be drawn on the map: valid coords only, one entry per id.
 * Map data comes first, so its copy wins over an explore result with the same id.
 */
export function mergeMarkerStations(
  mapStations: readonly Station[],
  results: readonly Station[],
): Station[] {
  const seen = new Set<string>();
  const out: Station[] = [];
  for (const list of [mapStations, results]) {
    for (const s of list) {
      if (!s || typeof s.id !== 'string' || seen.has(s.id)) continue;
      if (!hasValidCoords(s.coords)) continue;
      seen.add(s.id);
      out.push(s);
    }
  }
  return out;
}

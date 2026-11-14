import type { Coords } from '@/types';

/** True when coords are finite, in range, and not the (0,0) placeholder. */
export function hasValidCoords(c: Coords | null | undefined): c is Coords {
  if (!c || typeof c !== 'object') return false;
  const { lat, lng } = c;
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return !(lat === 0 && lng === 0);
}

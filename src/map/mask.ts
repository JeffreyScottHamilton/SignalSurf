import type { Feature, FeatureCollection, Geometry, Polygon, Position } from 'geojson';

/** A rectangle covering every longitude the map can show, with a margin, and the Mercator latitude range. */
const WORLD_RING: Position[] = [
  [-360, -85],
  [360, -85],
  [360, 85],
  [-360, 85],
  [-360, -85],
];

/**
 * The dimming mask: the world rectangle with every US state ring as a hole, so the states are clear and everything
 * else is covered. Filled with evenodd (the default for Leaflet paths), a state ring inside the outer ring is a hole.
 */
export function buildMaskFeature(states: FeatureCollection<Geometry>): Feature<Polygon> {
  const holes: Position[][] = [];
  for (const f of states.features) {
    const g = f.geometry;
    if (g.type === 'Polygon') {
      holes.push(...g.coordinates);
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates) holes.push(...poly);
    }
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [WORLD_RING, ...holes] },
  };
}

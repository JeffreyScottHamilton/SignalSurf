import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';

type Ring = Position[];
type Polygon = Ring[];

/** Makes a ring continuous in longitude: no step between neighbours is larger than 180 degrees. */
export function unwrapRing(ring: Ring): Ring {
  if (ring.length === 0) return [];
  const out: Ring = [[ring[0][0], ring[0][1]]];
  let offset = 0;
  for (let i = 1; i < ring.length; i++) {
    const d = ring[i][0] - ring[i - 1][0];
    if (d > 180) offset -= 360;
    else if (d < -180) offset += 360;
    out.push([ring[i][0] + offset, ring[i][1]]);
  }
  return out;
}

/**
 * A ring that winds fully around a pole (Antarctica) does not close after unwrapping.
 * Close it through the pole so it fills the band instead of drawing a stray line.
 */
function closeAroundPole(ring: Ring): Ring {
  if (ring.length < 3) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  const turns = Math.round((last[0] - first[0]) / 360);
  if (turns === 0) return ring;
  const meanLat = ring.reduce((sum, p) => sum + p[1], 0) / ring.length;
  const pole = meanLat < 0 ? -90 : 90;
  return [...ring, [last[0], pole], [first[0], pole]];
}

/**
 * Unwraps one polygon (outer ring first, then holes). Holes are moved by whole turns to sit
 * next to the outer ring. Then copies shifted by -360 or +360 are added wherever the polygon
 * reaches past the antimeridian, so both map edges are filled. Copies that do not overlap
 * -180..180 are dropped.
 */
export function normalizePolygon(rings: Polygon): Polygon[] {
  if (rings.length === 0 || rings[0].length === 0) return [];
  const outer = closeAroundPole(unwrapRing(rings[0]));
  const ref = outer[0][0];
  const holes = rings.slice(1).map((h) => {
    const u = unwrapRing(h);
    if (u.length === 0) return u;
    const turns = Math.round((ref - u[0][0]) / 360);
    return u.map((p): Position => [p[0] + turns * 360, p[1], ...p.slice(2)]);
  });
  const all: Polygon = [outer, ...holes];

  let min = Infinity;
  let max = -Infinity;
  for (const r of all) {
    for (const p of r) {
      if (p[0] < min) min = p[0];
      if (p[0] > max) max = p[0];
    }
  }

  const copies: Polygon[] = [];
  for (const dx of [-360, 0, 360]) {
    if (max + dx > -180 && min + dx < 180) {
      copies.push(all.map((r) => r.map((p): Position => [p[0] + dx, p[1], ...p.slice(2)])));
    }
  }
  return copies.length > 0 ? copies : [all];
}

/** Country feature with unwrapped, edge-complete polygons. Non-polygon geometry passes through. */
export function normalizeFeature(f: Feature<Geometry>): Feature<Geometry> {
  const g = f.geometry;
  if (g.type === 'Polygon') {
    const polys = normalizePolygon(g.coordinates as Polygon);
    return { ...f, geometry: { type: 'MultiPolygon', coordinates: polys } };
  }
  if (g.type === 'MultiPolygon') {
    const polys = (g.coordinates as Polygon[]).flatMap((p) => normalizePolygon(p));
    return { ...f, geometry: { type: 'MultiPolygon', coordinates: polys } };
  }
  return f;
}

/** Natural Earth 1:50m country shapes converted from TopoJSON. Loaded as a separate chunk. */
export async function loadLandFeatures(): Promise<FeatureCollection<Geometry>> {
  const [{ default: atlas }, { feature }] = await Promise.all([
    import('world-atlas/countries-50m.json'),
    import('topojson-client'),
  ]);
  // A GeometryCollection converts to a FeatureCollection.
  const fc = feature(atlas, atlas.objects.countries) as FeatureCollection<Geometry>;
  return { ...fc, features: fc.features.map(normalizeFeature) };
}

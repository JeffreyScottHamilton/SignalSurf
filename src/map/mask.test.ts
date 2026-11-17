import type { Feature, FeatureCollection, Geometry, Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import { buildMaskFeature } from './mask';

const square = (x: number, y: number, s: number): number[][] => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
  [x, y],
];

function states(features: Feature<Geometry>[]): FeatureCollection<Geometry> {
  return { type: 'FeatureCollection', features };
}

describe('buildMaskFeature', () => {
  it('is one polygon whose first ring is the world rectangle, and whose other rings are the states', () => {
    const mask = buildMaskFeature(
      states([
        { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [square(-100, 30, 5)] } },
        { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [square(-90, 30, 5)] } },
      ]),
    );
    const g = mask.geometry as Polygon;
    expect(mask.geometry.type).toBe('Polygon');
    expect(g.coordinates).toHaveLength(3);
    expect(g.coordinates[0]).toEqual([
      [-360, -85],
      [360, -85],
      [360, 85],
      [-360, 85],
      [-360, -85],
    ]);
    expect(g.coordinates[1]).toEqual(square(-100, 30, 5));
    expect(g.coordinates[2]).toEqual(square(-90, 30, 5));
  });

  it('adds every ring of a multipolygon, including the rings of a polygon with a hole', () => {
    const withHole = [square(-120, 40, 10), square(-118, 42, 2)];
    const mask = buildMaskFeature(
      states([
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'MultiPolygon', coordinates: [[withHole[0]], [withHole[1]]] },
        },
      ]),
    );
    expect((mask.geometry as Polygon).coordinates).toHaveLength(3);
  });

  it('ignores non-polygon geometry and an empty state list still gives the world rectangle', () => {
    const mask = buildMaskFeature(states([]));
    expect((mask.geometry as Polygon).coordinates).toHaveLength(1);
    const withPoint = buildMaskFeature(
      states([{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [-100, 40] } }]),
    );
    expect((withPoint.geometry as Polygon).coordinates).toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';
import type { Feature, Geometry, Position } from 'geojson';
import { normalizeFeature, normalizePolygon, unwrapRing } from './landData';

const lngs = (ring: Position[]) => ring.map((p) => p[0]);

describe('unwrapRing', () => {
  it('makes a ring that crosses the antimeridian continuous', () => {
    // A small shape straddling 180: east side reads 170..180, west side -175.
    const ring: Position[] = [
      [170, 60],
      [-175, 60],
      [-175, 70],
      [170, 70],
      [170, 60],
    ];
    expect(lngs(unwrapRing(ring))).toEqual([170, 185, 185, 170, 170]);
  });

  it('leaves a ring that does not cross the antimeridian unchanged', () => {
    const ring: Position[] = [
      [10, 0],
      [20, 0],
      [20, 5],
      [10, 0],
    ];
    expect(unwrapRing(ring)).toEqual(ring.map((p) => [p[0], p[1]]));
  });

  it('keeps every step at most 180 degrees', () => {
    const ring: Position[] = [
      [179, 0],
      [-179, 0],
      [-170, 1],
      [175, 1],
      [179, 0],
    ];
    const out = unwrapRing(ring);
    for (let i = 1; i < out.length; i++) {
      expect(Math.abs(out[i][0] - out[i - 1][0])).toBeLessThanOrEqual(180);
    }
  });

  it('returns an empty ring for an empty input', () => {
    expect(unwrapRing([])).toEqual([]);
  });
});

describe('normalizePolygon', () => {
  it('adds a copy shifted by -360 so the western edge is filled too', () => {
    const shape: Position[][] = [
      [
        [170, 60],
        [-175, 60],
        [-175, 70],
        [170, 70],
        [170, 60],
      ],
    ];
    const polys = normalizePolygon(shape);
    expect(polys).toHaveLength(2);
    const west = polys.find((p) => p[0][0][0] < 0);
    expect(west).toBeDefined();
    expect(Math.max(...lngs(west![0]))).toBeGreaterThan(-180);
    expect(Math.min(...lngs(west![0]))).toBeLessThan(-170);
  });

  it('does not copy a polygon that stays inside -180..180', () => {
    const shape: Position[][] = [
      [
        [-10, 0],
        [10, 0],
        [10, 10],
        [-10, 0],
      ],
    ];
    expect(normalizePolygon(shape)).toEqual([shape]);
  });

  it('closes a ring that winds around the south pole through the pole', () => {
    const band: Position[][] = [
      [
        [-180, -70],
        [-90, -70],
        [0, -70],
        [90, -70],
        [179.9, -70],
        [180, -70],
        [-180, -70],
      ],
    ];
    const [poly] = normalizePolygon(band);
    const ring = poly[0];
    expect(ring.some((p) => p[1] === -90)).toBe(true);
  });
});

describe('normalizeFeature', () => {
  it('passes non-polygon geometry through unchanged', () => {
    const f: Feature<Geometry> = { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [1, 2] } };
    expect(normalizeFeature(f)).toBe(f);
  });

  it('turns a polygon feature into a MultiPolygon and keeps its properties', () => {
    const f: Feature<Geometry> = {
      type: 'Feature',
      properties: { name: 'X' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [5, 0],
            [5, 5],
            [0, 0],
          ],
        ],
      },
    };
    const out = normalizeFeature(f);
    expect(out.properties).toEqual({ name: 'X' });
    expect(out.geometry.type).toBe('MultiPolygon');
  });
});

import { describe, expect, it } from 'vitest';
import { LOWER_48_LNG_SPAN, LOWER_48_MIN_SHARE, minZoomFor, panBoxFor } from './zoom';

// Degrees of longitude per pixel at zoom z on a 256px world: 2^z * 256 / 360 pixels per degree.
const lower48Share = (zoom: number, width: number) => (LOWER_48_LNG_SPAN * ((2 ** zoom) * 256) / 360) / width;

describe('minZoomFor', () => {
  const widths = [240, 320, 375, 390, 768, 1024, 1088, 1280, 1440, 1920];

  it('is always a whole zoom level, so markercluster keeps every marker', () => {
    for (const w of widths) expect(Number.isInteger(minZoomFor(w)), `width ${w}`).toBe(true);
  });

  it('keeps the lower 48 at least the target share of the panel width', () => {
    for (const w of widths) {
      expect(lower48Share(minZoomFor(w), w), `width ${w}`).toBeGreaterThanOrEqual(LOWER_48_MIN_SHARE);
    }
  });

  it('is zero for an unmeasured panel', () => {
    expect(minZoomFor(0)).toBe(0);
    expect(minZoomFor(Number.NaN)).toBe(0);
  });
});

describe('panBoxFor', () => {
  const base = { south: 5, west: -180, north: 75, east: -50 };
  const centre = { lat: 37, lng: -95.75 };
  // Lat/lng of a pixel offset from the centre at a zoom: the inverse of the box maths, for checking containment.
  const latAt = (zoom: number, dyPx: number) => {
    const y = Math.log(Math.tan(Math.PI / 4 + (centre.lat * Math.PI) / 360)) - dyPx / ((256 * 2 ** zoom) / (2 * Math.PI));
    return ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;
  };

  it('keeps the base box for a panel whose view already fits inside it', () => {
    const box = panBoxFor(600, 500, 4, centre, base);
    expect(box).toEqual(base);
  });

  it('contains a centred view on a tall phone panel, so the lower 48 are not pulled off centre', () => {
    for (const [w, h] of [[357, 553], [357, 812], [372, 585], [357, 171]] as const) {
      for (const zoom of [minZoomFor(w), minZoomFor(w) + 0.5, minZoomFor(w) + 2]) {
        const box = panBoxFor(w, h, minZoomFor(w), centre, base);
        expect(box.north, `north ${w}x${h} z${zoom}`).toBeGreaterThanOrEqual(latAt(zoom, -h / 2));
        expect(box.south, `south ${w}x${h} z${zoom}`).toBeLessThanOrEqual(latAt(zoom, h / 2));
      }
    }
  });

  it('widens the box east when a wide panel view would pass the base edge', () => {
    const box = panBoxFor(1082, 714, 4, centre, base);
    expect(box.east).toBeGreaterThan(base.east);
    expect(box.west).toBe(base.west);
  });

  it('never leaves the Mercator range', () => {
    const box = panBoxFor(100, 20000, 0, centre, base);
    expect(box.north).toBeLessThanOrEqual(85.0511);
    expect(box.south).toBeGreaterThanOrEqual(-85.0511);
  });

  it('returns the base box for an unmeasured panel', () => {
    expect(panBoxFor(0, 0, 3, centre, base)).toEqual(base);
  });
});

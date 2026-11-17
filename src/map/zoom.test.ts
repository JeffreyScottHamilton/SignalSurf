import { describe, expect, it } from 'vitest';
import { LOWER_48_LNG_SPAN, LOWER_48_MIN_SHARE, minZoomFor } from './zoom';

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

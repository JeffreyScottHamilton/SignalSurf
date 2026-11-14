import { describe, expect, it } from 'vitest';
import { hasValidCoords } from './markerSet';

const at = (lat: number, lng: number) => ({ lat, lng });

describe('hasValidCoords', () => {
  it('accepts finite in-range coords', () => {
    expect(hasValidCoords(at(51.5, -0.12))).toBe(true);
    expect(hasValidCoords(at(-90, 180))).toBe(true);
  });

  it('rejects missing, non-finite, out-of-range and (0,0) coords', () => {
    expect(hasValidCoords(null)).toBe(false);
    expect(hasValidCoords(undefined)).toBe(false);
    expect(hasValidCoords(at(Number.NaN, 1))).toBe(false);
    expect(hasValidCoords(at(1, Infinity))).toBe(false);
    expect(hasValidCoords(at(91, 0))).toBe(false);
    expect(hasValidCoords(at(0, 181))).toBe(false);
    expect(hasValidCoords(at(0, 0))).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import type { Station } from '@/types';
import { dayLabel, formatPlayedAt, stationLocation } from './format';

// Fixed "now": Friday 13 November 2026, 15:30 local time.
const NOW = new Date(2026, 10, 13, 15, 30).getTime();

function station(overrides: Partial<Station>): Station {
  return {
    id: 'id-1',
    name: 'Test FM',
    streamUrl: 'https://example.com/stream',
    homepage: null,
    favicon: null,
    country: null,
    countryCode: null,
    region: null,
    tags: [],
    categories: [],
    codec: null,
    bitrate: null,
    hls: false,
    coords: null,
    lastCheckOk: true,
    lastCheckTime: null,
    clickCount: 0,
    votes: 0,
    ...overrides,
  };
}

describe('stationLocation', () => {
  it('joins region and country when both exist', () => {
    expect(stationLocation(station({ region: 'Oslo', country: 'Norway' }))).toBe('Oslo, Norway');
  });

  it('returns only the country when region is missing', () => {
    expect(stationLocation(station({ region: null, country: 'Norway' }))).toBe('Norway');
  });

  it('returns only the region when country is missing', () => {
    expect(stationLocation(station({ region: 'Oslo', country: null }))).toBe('Oslo');
  });

  it('returns an empty string when neither part exists', () => {
    expect(stationLocation(station({ region: '  ', country: null }))).toBe('');
  });
});

describe('formatPlayedAt', () => {
  it('shows a clock time for something played today', () => {
    const at = new Date(2026, 10, 13, 14, 14).getTime();
    expect(formatPlayedAt(at, NOW)).toBe('2:14 PM');
  });

  it('shows a short date for something played on an earlier day', () => {
    const at = new Date(2026, 10, 12, 14, 14).getTime();
    expect(formatPlayedAt(at, NOW)).toBe('Nov 12');
  });
});

describe('dayLabel', () => {
  it('returns Today for the current calendar day', () => {
    expect(dayLabel(new Date(2026, 10, 13, 0, 1).getTime(), NOW)).toBe('Today');
  });

  it('returns Yesterday for the previous calendar day, even late at night', () => {
    expect(dayLabel(new Date(2026, 10, 12, 23, 59).getTime(), NOW)).toBe('Yesterday');
  });

  it('returns a short date for older days in the same year', () => {
    expect(dayLabel(new Date(2026, 10, 10, 9, 0).getTime(), NOW)).toBe('Nov 10');
  });

  it('includes the year when the day is in a different year', () => {
    expect(dayLabel(new Date(2025, 11, 31, 9, 0).getTime(), NOW)).toBe('Dec 31, 2025');
  });
});

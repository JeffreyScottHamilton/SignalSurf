import { describe, expect, it } from 'vitest';
import type { Station } from '@/types';
import { dayLabel, externalHref, formatPlayedAt, stationLocation } from './format';

// Fixed "now": Friday 13 November 2026, 15:30 local time.
const NOW = new Date(2026, 10, 13, 15, 30).getTime();

function station(overrides: Partial<Station>): Station {
  return {
    id: 'id-1',
    name: 'Test FM',
    streamUrl: 'https://example.com/stream',
    homepage: null,
    favicon: null,
    stateCode: null,
    city: null,
    tags: [],
    genres: [],
    codec: null,
    bitrate: null,
    hls: false,
    coords: null,
    clickCount: 0,
    ...overrides,
  };
}

describe('stationLocation', () => {
  it('shows "City, ST" when both are known', () => {
    expect(stationLocation(station({ city: 'Austin', stateCode: 'TX' }))).toBe('Austin, TX');
  });

  it('shows the full state name when only the state is known', () => {
    expect(stationLocation(station({ stateCode: 'TX' }))).toBe('Texas');
    expect(stationLocation(station({ stateCode: 'DC' }))).toBe('District of Columbia');
  });

  it('shows the city alone when no state is known', () => {
    expect(stationLocation(station({ city: 'Austin' }))).toBe('Austin');
  });

  it('falls back to "United States" when neither is known, and never invents a state', () => {
    expect(stationLocation(station({}))).toBe('United States');
    expect(stationLocation(station({ stateCode: 'ZZ' }))).toBe('United States');
  });

  it('treats a blank city as unknown', () => {
    expect(stationLocation(station({ city: '   ', stateCode: 'NY' }))).toBe('New York');
  });
});

describe('externalHref', () => {
  it('returns http and https homepages unchanged', () => {
    expect(externalHref('https://example.com/')).toBe('https://example.com/');
    expect(externalHref('http://example.com/')).toBe('http://example.com/');
  });

  it('returns null for anything else', () => {
    expect(externalHref('javascript:alert(1)')).toBeNull();
    expect(externalHref('ftp://example.com/')).toBeNull();
    expect(externalHref('example.com')).toBeNull();
    expect(externalHref('')).toBeNull();
    expect(externalHref(null)).toBeNull();
    expect(externalHref(undefined)).toBeNull();
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

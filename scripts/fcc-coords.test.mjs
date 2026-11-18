// Tests for the FCC coordinate fill (scripts/fcc-coords.mjs). Licence rows are shaped like data/fcc-stations.json
// rows, written by hand for these tests. No network access.
import { describe, expect, it } from 'vitest';
import { fillFccCoords, sameCallStation } from './fcc-coords.mjs';

const KSFI = { call: 'KSFI', band: 'FM', freq: 100.3, service: 'FM', city: 'SALT LAKE CITY', state: 'UT', lat: 40.659, lng: -112.202, facilityId: '60452', licensee: 'X' };
const KSL_FM = { call: 'KSL', band: 'FM', freq: 102.7, service: 'FM', city: 'SALT LAKE CITY', state: 'UT', lat: 40.7, lng: -111.9, facilityId: '1', licensee: 'X' };
const KSL_AM = { call: 'KSL', band: 'AM', freq: 1160, service: 'AM', city: 'SALT LAKE CITY', state: 'UT', lat: 40.8, lng: -111.8, facilityId: '2', licensee: 'X' };

describe('sameCallStation', () => {
  it('matches a call sign in the name, in the same state, with no other frequency named', () => {
    expect(sameCallStation(KSFI, { stateCode: 'UT', name: 'KSFI 100.3' })).toBe(true);
    expect(sameCallStation(KSFI, { stateCode: 'UT', name: 'KSFI FM' })).toBe(true);
  });

  it('refuses a different state, a missing call sign, or a different frequency named in the name', () => {
    expect(sameCallStation(KSFI, { stateCode: 'ID', name: 'KSFI 100.3' })).toBe(false);
    expect(sameCallStation(KSFI, { stateCode: 'UT', name: 'Salt Lake FM' })).toBe(false);
    expect(sameCallStation(KSFI, { stateCode: 'UT', name: 'KSFI 93.3' })).toBe(false);
  });
});

describe('fillFccCoords', () => {
  it('fills coordinates for a directory station with one matching licence, rounded to four places', () => {
    const stations = [{ id: 'dir:1', name: 'KSFI 100.3', stateCode: 'UT', homepage: null }];
    const r = fillFccCoords(stations, [KSFI]);
    expect(r).toEqual({ filled: 1, ambiguous: 0 });
    expect(stations[0].lat).toBe(40.659);
    expect(stations[0].lng).toBe(-112.202);
  });

  it('keeps directory coordinates and does not touch curated or discovered stations', () => {
    const stations = [
      { id: 'dir:2', name: 'KSFI 100.3', stateCode: 'UT', lat: 1, lng: 2 },
      { id: 'curated:x', name: 'KSFI 100.3', stateCode: 'UT' },
      { id: 'fcc:5', name: 'KSFI 100.3', stateCode: 'UT' },
    ];
    const r = fillFccCoords(stations, [KSFI]);
    expect(r.filled).toBe(0);
    expect(stations[0].lat).toBe(1);
    expect(stations[1].lat).toBeUndefined();
    expect(stations[2].lat).toBeUndefined();
  });

  it('leaves a station with two matching licences (KSL FM and AM, no frequency in the name) without coordinates', () => {
    const stations = [{ id: 'dir:3', name: 'KSL', stateCode: 'UT' }];
    const r = fillFccCoords(stations, [KSL_FM, KSL_AM]);
    expect(r).toEqual({ filled: 0, ambiguous: 1 });
    expect(stations[0].lat).toBeUndefined();
  });

  it('uses the frequency to pick between FM and AM with the same call sign', () => {
    const stations = [{ id: 'dir:4', name: 'KSL 102.7', stateCode: 'UT' }];
    const r = fillFccCoords(stations, [KSL_FM, KSL_AM]);
    expect(r.filled).toBe(1);
    expect(stations[0].lat).toBe(40.7);
  });
});

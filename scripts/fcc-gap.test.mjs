// Tests for the FCC coverage parsers and matchers (scripts/fcc-gap.mjs). Fixture rows are real FCC output,
// copied verbatim from the fmq and amq responses on 2026-11-18. No network access in these tests.
import { describe, expect, it } from 'vitest';
import {
  dmsToDecimal,
  parseFccRow,
  callBase,
  callInName,
  callInHost,
  freqInName,
  classifyStation,
  licensedStations,
  serializeData,
  parseDataFile,
  topLicensees,
  haversineKm,
} from './fcc-gap.mjs';

const FX = {
  "kuhu": "|KUHU        |88.1  MHz |FM |201 |ND  |H                   |C2 |-  |LIC    |MONTICELLO               |UT |US |BLED-20130819AFO    |0.252  kW |0.252  kW |1070.0  |1070.0  |172928     |N |37 |50 |24.9  |W |109 |27 |42.4  |UNIVERSITY OF UTAH                                                          |   0.00 km |   0.00 mi |  0.00 deg |3478.  m|3478.0 m|-         |-       |-       |       m|201308193 |2114cda6c91147d2ba81c1b6063ebeb7   |71a88bc10c20402ba9bfc1b6063ebeb7   |",
  "knkl": "|KNKL        |88.1  MHz |FM |201 |ND  |                    |C2 |-  |LIC    |TREMONTON                |UT |US |BLED-20190722AAN    |8.6    kW |8.6    kW |359.0   |359.0   |71394      |N |41 |53 |42.9  |W |112 |4  |45.9  |K-LOVE, INC.                                                                |   0.00 km |   0.00 mi |  0.00 deg |1849.  m|1849.0 m|-         |-       |1061009 |       m|201907229 |f06bfff4fe3741b8ba95c1b6063ebeb7   |855d51608b734e0c8f20c1b6063ebeb7   |",
  "knrs": "|KNRS        |570   kHz |AM |    |UNL |Unlimited           |B  |B  |LIC    |SALT LAKE CITY           |UT |US |BL-19910522AB          |5.0    kW |Directional|        |-       |63818      |N |40 |49 |8.8   |W |111 |55 |58.8  |IHM LICENSES, LLC                                                           |   0.00 km |   0.00 mi |  0.00 deg |161454    |7d56c5dd73a34e17aab5c1b6063ebeb7   |ba6240ef575043f98b6ec1b6063ebeb7   |",
  "ksub": "|KSUB        |590   kHz |AM |    |DAY |Daytime             |D  |B  |LIC    |CEDAR CITY               |UT |US |0000222879             |5.0    kW |           |A       |-       |61384      |N |37 |41 |51.0  |W |113 |10 |54.4  |TOWNSQUARE LICENSE, LLC                                                     |   0.00 km |   0.00 mi |  0.00 deg |222879    |25076f918f32c5fa018f356181e601e6   |25076f918f32c5fa018f3561832201f3   |",
  "fl": "|WDSW-LP     |88.1  MHz |FL |201 |ND  |                    |LP1|-  |LIC    |CLEVELAND                |MS |US |BLL-20150724AID     |0.1    kW |0.1    kW |24.6    |0.0     |193426     |N |33 |44 |40.4  |W |90  |44 |8.3   |DELTA STATE UNIVERSITY                                                      |   0.00 km |   0.00 mi |  0.00 deg |65.    m|0.0    m|-         |-       |-       |       m|201507240 |7596bc8446254a00a9e3c1b6063ebeb7   |db99dda6b3f14cc1a701c1b6063ebeb7   |",
  "ca": "|NEW         |88.1  MHz |FM |201 |DA  |                    |D  |-  |LIC    |CHILLIWACK               |BC |CA |-                   |0.01   kW |0.01   kW |151.0   |0.0     |158662     |N |49 |6  |35.5  |W |121 |50 |51.5  |-                                                                           |   0.00 km |   0.00 mi |  0.00 deg |0.     m|0.0    m|-         |0.      |-       |       m|0         |842-2019-08-06                     |842-2019-08-06                     |",
  "mod": "|WSJL        |88.1  MHz |FM |201 |DA  |                    |C0 |-  |MOD    |BESSEMER                 |AL |US |0000300871          |16.5   kW |16.5   kW |665.0   |665.0   |88660      |N |33 |28 |51.0  |W |87  |24 |3.0   |ELIJAH RADIO, INC.                                                          |   0.00 km |   0.00 mi |  0.00 deg |810.   m|810.0  m|-         |0.      |1035175 |       m|300871    |25076ff39f23c4a5019f3798b39702cf   |25076ff39f23c4a5019f3798b74c02d6   |"
};

const station = (over) => ({
  call: 'KSFI', band: 'FM', freq: 100.3, service: 'FM', city: 'SALT LAKE CITY', state: 'UT',
  lat: 40.659722, lng: -112.202083, facilityId: '60452', licensee: 'BONNEVILLE', ...over,
});

describe('dmsToDecimal', () => {
  it('converts north and west degrees, minutes, seconds with a negative sign for W', () => {
    expect(dmsToDecimal('37', '50', '24.9', 'N')).toBeCloseTo(37.84025, 5);
    expect(dmsToDecimal('109', '27', '42.4', 'W')).toBeCloseTo(-109.461778, 5);
  });
  it('makes south and west negative and keeps east positive', () => {
    expect(dmsToDecimal('33', '52', '0', 'S')).toBeCloseTo(-33.866667, 5);
    expect(dmsToDecimal('144', '0', '0', 'E')).toBe(144);
  });
  it('rejects bad input', () => {
    expect(dmsToDecimal('', '1', '1', 'N')).toBeNull();
    expect(dmsToDecimal('37', '60', '0', 'N')).toBeNull();
    expect(dmsToDecimal('37', '1', '60', 'N')).toBeNull();
    expect(dmsToDecimal('37', '1', '1', 'X')).toBeNull();
    expect(dmsToDecimal('-3', '1', '1', 'N')).toBeNull();
  });
});

describe('parseFccRow', () => {
  it('parses a full-power FM row (KUHU, Monticello UT)', () => {
    const r = parseFccRow(FX.kuhu);
    expect(r).toMatchObject({
      call: 'KUHU', band: 'FM', freq: 88.1, service: 'FM', status: 'LIC', city: 'MONTICELLO',
      state: 'UT', country: 'US', facilityId: '172928', licensee: 'UNIVERSITY OF UTAH',
    });
    expect(r.lat).toBeCloseTo(37.84025, 5);
    expect(r.lng).toBeCloseTo(-109.461778, 5);
  });

  it('parses an AM row with its kHz frequency and blank channel columns (KSUB, Cedar City UT)', () => {
    const r = parseFccRow(FX.ksub);
    expect(r).toMatchObject({ call: 'KSUB', band: 'AM', freq: 590, service: 'AM', state: 'UT', facilityId: '61384' });
    expect(r.lat).toBeCloseTo(37.6975, 5);
    expect(r.lng).toBeCloseTo(-113.181778, 5);
  });

  it('keeps the suffix out of the call and keeps the service code (WDSW-LP, LPFM)', () => {
    const r = parseFccRow(FX.fl);
    expect(r).toMatchObject({ call: 'WDSW', service: 'FL', band: 'FM', state: 'MS', status: 'LIC' });
  });

  it('reads the country and status columns, so Canadian and modified rows can be dropped', () => {
    expect(parseFccRow(FX.ca)).toMatchObject({ country: 'CA', status: 'LIC' });
    expect(parseFccRow(FX.mod)).toMatchObject({ status: 'MOD', country: 'US' });
  });

  it('returns null for lines that are not rows', () => {
    expect(parseFccRow('')).toBeNull();
    expect(parseFccRow('<html>not found</html>')).toBeNull();
    expect(parseFccRow('|too|short|')).toBeNull();
  });
});

describe('licensedStations', () => {
  it('keeps licensed US FM, FL and AM rows and dedupes by facility id', () => {
    const rows = [FX.kuhu, FX.kuhu, FX.ksub, FX.ksub, FX.fl, FX.ca, FX.mod].map(parseFccRow);
    const kept = licensedStations(rows);
    expect(kept.map((s) => s.call)).toEqual(['KUHU', 'KSUB', 'WDSW']);
  });
});

describe('callBase and call matching', () => {
  it('strips the service suffix and upper-cases', () => {
    expect(callBase('KSFI-FM')).toBe('KSFI');
    expect(callBase('wdsw-lp')).toBe('WDSW');
    expect(callBase('WXYZ')).toBe('WXYZ');
  });

  it('matches a call as a whole word in the name, with or without the -FM or FM suffix', () => {
    expect(callInName('KSFI', 'FM100.3 KSFI')).toBe(true);
    expect(callInName('KSFI', 'KSFI-FM')).toBe(true);
    expect(callInName('KSFI', 'KSFI FM')).toBe(true);
    expect(callInName('KSFI', 'Ksfi FM')).toBe(true);
    expect(callInName('KSFI', 'KSFIX')).toBe(false);
    expect(callInName('KSFI', 'WKSFI')).toBe(false);
    expect(callInName('KSFI', 'Ksfi')).toBe(false);
  });

  it('does not match a three-letter call written in mixed case', () => {
    expect(callInName('WHO', 'Who Radio')).toBe(false);
    expect(callInName('WHO', 'WHO 1040')).toBe(true);
  });

  it('matches a homepage host label, with or without an fm suffix', () => {
    expect(callInHost('KSFI', 'https://ksfi.example.com/')).toBe(true);
    expect(callInHost('KBZN', 'https://kbznfm.com/')).toBe(true);
    expect(callInHost('KSFI', 'https://fm100.com/')).toBe(false);
    expect(callInHost('KSFI', null)).toBe(false);
    expect(callInHost('KSFI', 'not a url')).toBe(false);
  });
});

describe('freqInName', () => {
  it('matches an FM frequency with its decimal, bare or with FM', () => {
    expect(freqInName(station({ freq: 100.3 }), 'FM100.3 Hot Hits')).toBe(true);
    expect(freqInName(station({ freq: 100.3 }), 'Hot 100.3')).toBe(true);
    expect(freqInName(station({ freq: 100.3 }), 'Mix 1100.3')).toBe(false);
  });
  it('matches an AM frequency only with AM or kHz next to it', () => {
    const am = station({ band: 'AM', service: 'AM', freq: 590 });
    expect(freqInName(am, 'AM 590 Talk')).toBe(true);
    expect(freqInName(am, '590 kHz News')).toBe(true);
    expect(freqInName(am, 'Channel 590')).toBe(false);
    expect(freqInName(am, 'Route 1590 Radio')).toBe(false);
  });
});

describe('classifyStation', () => {
  const near = { lat: 40.66, lng: -112.2 };
  it('classifies a call match only when the state agrees or the record has no state', () => {
    const s = station();
    expect(classifyStation(s, [{ name: 'FM100.3 KSFI', stateCode: 'UT' }]).how).toBe('call');
    expect(classifyStation(s, [{ name: 'FM100.3 KSFI', stateCode: null }]).how).toBe('call');
    expect(classifyStation(s, [{ name: 'KSFI Radio', stateCode: 'NV' }]).how).toBeNull();
  });
  it('classifies a frequency match as probable only with place evidence', () => {
    const s = station({ freq: 88.1, call: 'KZZZ', lat: 40.66, lng: -112.2, city: 'MIDVALE' });
    const close = { name: 'Hot 88.1', stateCode: 'UT', lat: 40.7, lng: -112.0 };
    const far = { name: 'Hot 88.1', stateCode: 'UT', lat: 37.7, lng: -113.1 };
    const cityOnly = { name: 'Hot 88.1', stateCode: 'UT', city: 'Midvale' };
    expect(haversineKm(near, { lat: 40.7, lng: -112.0 })).toBeLessThan(20);
    expect(classifyStation(s, [close])).toEqual({ how: 'probable', freqOnly: false });
    expect(classifyStation(s, [cityOnly])).toEqual({ how: 'probable', freqOnly: false });
    expect(classifyStation(s, [far])).toEqual({ how: null, freqOnly: true });
  });
});

describe('data file and summaries', () => {
  it('round-trips the compact data file', () => {
    const stations = licensedStations([FX.kuhu, FX.ksub].map(parseFccRow));
    const text = serializeData({ source: 's', fetched: '2026-11-18', queries: ['q'], raw: { FM: 1 }, stations });
    const back = parseDataFile(text);
    expect(back.count).toBe(2);
    expect(back.stations[0]).toMatchObject({ call: 'KUHU', band: 'FM', freq: 88.1, state: 'UT', facilityId: '172928' });
    expect(back.stations[1]).toMatchObject({ call: 'KSUB', band: 'AM', freq: 590 });
  });
  it('groups licensees case-insensitively and sorts by count', () => {
    const top = topLicensees([
      { licensee: 'K-LOVE, INC.' }, { licensee: 'k-love, inc.' }, { licensee: 'OTHER' }, { licensee: null },
    ], 2);
    expect(top).toEqual([['K-LOVE, INC.', 2], ['(NONE)', 1]]);
  });
});

// Tests for discovered stations (src/catalog/discovered.mjs): validation, merge and dedupe precedence. Entries here
// are shaped like data/discovered-stations.json; they are written by hand for these tests, not from a live run.
import { describe, expect, it } from 'vitest';
import { discoveredToRaw, mergeDiscovered, parseDiscovered, checkDiscoveredEntry } from './discovered.mjs';
import { streamKey } from './curated.mjs';

const KUBL_STREAM = 'https://playerservices.streamtheworld.com/api/livestream-redirect/KUBLFMAAC.aac';

function entry(overrides = {}) {
  return {
    id: 'fcc:11238',
    call: 'KUBL',
    band: 'FM',
    freq: 93.3,
    name: 'KUBL 93.3 The Bull',
    streamUrl: KUBL_STREAM,
    homepage: 'https://www.933thebull.com',
    state: 'UT',
    city: 'Salt Lake City',
    lat: 40.6,
    lng: -111.9,
    coordsSource: 'FCC transmitter',
    tags: ['Country'],
    wikiTitle: 'KUBL-FM',
    tritonMount: 'KUBLFMAAC',
    codec: 'heaacv2',
    source: 'test fixture',
    verified: '2026-11-18',
    ...overrides,
  };
}

const curatedStation = { id: 'curated:kbzn', name: 'KBZN 97.9', stateCode: 'MT', call: 'KBZN', streamUrl: 'https://a.example/x' };
const sameCall = (e, s) => s.call === e.call && s.stateCode === e.state;

describe('parseDiscovered validation', () => {
  it('accepts a valid file', () => {
    const { stations, errors } = parseDiscovered({ stations: [entry()] });
    expect(errors).toEqual([]);
    expect(stations).toHaveLength(1);
  });

  it('rejects a plain http stream URL and an entry with lat and lng outside the US', () => {
    expect(checkDiscoveredEntry(entry({ streamUrl: 'http://x.example/a.mp3' }))).toEqual(
      expect.arrayContaining(['streamUrl missing or not an https URL']),
    );
    expect(checkDiscoveredEntry(entry({ lat: 51.5, lng: -0.1 }))).toEqual(expect.arrayContaining(['lat and lng are outside the US']));
  });

  it('rejects repeated ids and repeated stream URLs, keeping the first', () => {
    const doc = { stations: [entry(), entry({ id: 'fcc:11238', name: 'again' }), entry({ id: 'fcc:999' })] };
    const { stations, errors } = parseDiscovered(doc);
    expect(stations.map((s) => s.id)).toEqual(['fcc:11238']);
    expect(errors.join('\n')).toMatch(/duplicate id/);
    expect(errors.join('\n')).toMatch(/duplicate stream URL/);
  });

  it('rejects a file without a stations array', () => {
    expect(parseDiscovered({}).errors).toHaveLength(1);
    expect(parseDiscovered(null).stations).toEqual([]);
  });

  it('requires the Triton mount to start with the call sign', () => {
    expect(checkDiscoveredEntry(entry({ tritonMount: 'OTHERFM' }))).toEqual(expect.arrayContaining(['tritonMount must start with the call sign']));
  });
});

describe('discoveredToRaw', () => {
  it('maps an entry to a directory record that normalizeRaw can read', () => {
    const raw = discoveredToRaw(entry());
    expect(raw).toMatchObject({ stationuuid: 'fcc:11238', url_resolved: KUBL_STREAM, iso_3166_2: 'US-UT', geo_lat: 40.6, geo_long: -111.9 });
    expect(raw.state).toBe('Salt Lake City, UT');
  });
});

describe('mergeDiscovered precedence', () => {
  it('adds a new station after the existing ones', () => {
    const r = mergeDiscovered([curatedStation], [entry()], { streamKeys: [], sameStation: sameCall });
    expect(r.added).toBe(1);
    expect(r.stations.map((s) => s.id)).toEqual(['curated:kbzn', 'fcc:11238']);
    expect(r.stations[1].name).toBe('KUBL 93.3 The Bull');
  });

  it('skips an entry whose stream is already listed, whether http or https in the listed row', () => {
    const listed = [streamKey(KUBL_STREAM.replace('https://', 'http://'))];
    const r = mergeDiscovered([], [entry()], { streamKeys: listed, sameStation: sameCall });
    expect(r.added).toBe(0);
    expect(r.skipped.stream).toEqual(['fcc:11238']);
  });

  it('skips an entry when a directory or curated station has the same call sign and state', () => {
    const existing = [{ id: 'dir:1', call: 'KUBL', stateCode: 'UT', name: 'KUBL 93.3' }];
    const r = mergeDiscovered(existing, [entry()], { streamKeys: [], sameStation: sameCall });
    expect(r.added).toBe(0);
    expect(r.skipped.call).toEqual(['fcc:11238']);
    expect(r.stations).toEqual(existing);
  });

  it('does not treat an FM and an AM with the same call letters as the same station in another state', () => {
    const r = mergeDiscovered([{ id: 'dir:1', call: 'KUBL', stateCode: 'CA' }], [entry()], { streamKeys: [], sameStation: sameCall });
    expect(r.added).toBe(1);
  });

  it('does not change the inputs', () => {
    const stations = [curatedStation];
    const entries = [entry()];
    mergeDiscovered(stations, entries, { streamKeys: [], sameStation: sameCall });
    expect(stations).toEqual([curatedStation]);
    expect(entries[0].id).toBe('fcc:11238');
  });

  it('counts an entry that normalizeRaw drops (no music genre) and does not add it', () => {
    const r = mergeDiscovered([], [entry({ tags: ['Public radio'], name: 'KUBL 93.3' })], { streamKeys: [], sameStation: sameCall });
    expect(r.added).toBe(0);
    expect(Object.values(r.dropped).reduce((a, b) => a + b, 0)).toBe(1);
  });
});

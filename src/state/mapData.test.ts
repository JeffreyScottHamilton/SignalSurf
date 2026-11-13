import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MapData = typeof import('./mapData');

const DISCOVERY_HOST = 'all.api.radio-browser.info';
const DE1 = 'de1.api.radio-browser.info';

let md: MapData;
let calls: URL[];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

function geoRec(id: string, lat: number, lng: number): Record<string, unknown> {
  return {
    stationuuid: id,
    name: `Station ${id}`,
    url_resolved: `https://stream.test/${id}`,
    url: `https://stream.test/${id}`,
    tags: '',
    country: 'Germany',
    countrycode: 'DE',
    state: '',
    clickcount: 1,
    votes: 0,
    lastcheckok: 1,
    geo_lat: lat,
    geo_long: lng,
  };
}

type Handler = (url: URL) => Response | Promise<Response>;

function installFetch(handler: Handler): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      calls.push(url);
      if (url.hostname === DISCOVERY_HOST) return json([{ ip: '10.0.0.1', name: DE1 }]);
      return handler(url);
    }),
  );
}

beforeEach(async () => {
  calls = [];
  vi.resetModules();
  md = await import('./mapData');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('mapStore', () => {
  it('starts idle with no stations', () => {
    expect(md.mapStore.get()).toEqual({ stations: [], status: 'idle' });
  });

  it('initMapData loads popular geo stations once', async () => {
    installFetch(() => json([geoRec('g1', 52.5, 13.4), geoRec('g2', 0, 0)]));
    md.initMapData();
    md.initMapData();
    await vi.waitFor(() => expect(md.mapStore.get().status).toBe('ready'));
    expect(md.mapStore.get().stations.map((s) => s.id)).toEqual(['g1']);
    const geoCalls = calls.filter((u) => u.searchParams.get('has_geo_info') === 'true');
    expect(geoCalls).toHaveLength(1);
  });

  it('initMapData reports an error and retries on the next call', async () => {
    let fail = true;
    installFetch(() => {
      if (fail) throw new TypeError('fetch failed');
      return json([geoRec('g1', 1, 2)]);
    });
    md.initMapData();
    await vi.waitFor(() => expect(md.mapStore.get().status).toBe('error'));
    fail = false;
    md.initMapData();
    await vi.waitFor(() => expect(md.mapStore.get().status).toBe('ready'));
    expect(md.mapStore.get().stations.map((s) => s.id)).toEqual(['g1']);
  });

  it('loadNear merges by id into the existing stations', async () => {
    installFetch((url) => {
      if (url.searchParams.get('geo_lat') === '10') return json([geoRec('a', 10, 10), geoRec('b', 10.1, 10)]);
      return json([geoRec('b', 20, 20), geoRec('c', 20.1, 20)]);
    });
    md.loadNear({ lat: 10, lng: 10 }, 50);
    await vi.waitFor(() => expect(md.mapStore.get().stations.length).toBe(2));
    md.loadNear({ lat: 20, lng: 20 }, 50);
    await vi.waitFor(() => expect(md.mapStore.get().stations.length).toBe(3));
    expect(md.mapStore.get().stations.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('caps the stations at 3000, dropping the oldest', async () => {
    installFetch((url) => {
      const lat = Number(url.searchParams.get('geo_lat'));
      const batch = Array.from({ length: 200 }, (_, k) => geoRec(`${lat}-${k}`, 1, 1));
      return json(batch);
    });
    for (let i = 0; i < 16; i++) md.loadNear({ lat: i * 5, lng: 0 }, 50);
    await vi.waitFor(() => expect(md.mapStore.get().stations.length).toBe(3000));
    const ids = md.mapStore.get().stations.map((s) => s.id);
    expect(ids.includes('0-0')).toBe(false);
    expect(ids.at(-1)).toBe('75-199');
  });

  it('loadNear ignores failures silently', async () => {
    installFetch(() => {
      throw new TypeError('fetch failed');
    });
    expect(() => md.loadNear({ lat: 1, lng: 1 }, 50)).not.toThrow();
    await vi.waitFor(() => expect(calls.some((u) => u.searchParams.get('geo_lat') === '1')).toBe(true));
    await new Promise((r) => setTimeout(r, 0));
    expect(md.mapStore.get()).toEqual({ stations: [], status: 'idle' });
  });
});

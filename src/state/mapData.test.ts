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

/** Geo map requests seen so far, as their offset strings ('0', '1000', ...). */
function geoOffsets(): string[] {
  return calls
    .filter((u) => u.pathname === '/json/stations/search' && u.searchParams.get('has_geo_info') === 'true')
    .map((u) => u.searchParams.get('offset') ?? '0');
}

/** Answers each map page by its offset. Missing offsets answer an empty list; 'fail' throws. */
function pagesHandler(pages: Record<number, Record<string, unknown>[] | 'fail'>): Handler {
  return (url) => {
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const page = pages[offset];
    if (page === 'fail') throw new TypeError('fetch failed');
    return json(page ?? []);
  };
}

function setConnection(value: unknown): void {
  Object.defineProperty(navigator, 'connection', { value, configurable: true });
}

beforeEach(async () => {
  calls = [];
  vi.resetModules();
  // Idle callbacks run on the next task, so background pages are quick and deterministic in tests.
  vi.stubGlobal('requestIdleCallback', (cb: () => void) => setTimeout(cb, 0));
  md = await import('./mapData');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'connection');
});

describe('mapStore', () => {
  it('starts idle with no stations', () => {
    expect(md.mapStore.get()).toEqual({ stations: [], status: 'idle', backgroundStatus: 'idle' });
  });

  it('initMapData loads popular geo stations once', async () => {
    installFetch(() => json([geoRec('g1', 52.5, 13.4), geoRec('g2', 0, 0)]));
    md.initMapData();
    md.initMapData();
    await vi.waitFor(() => expect(md.mapStore.get().backgroundStatus).toBe('done'));
    expect(md.mapStore.get().stations.map((s) => s.id)).toEqual(['g1']);
    expect(geoOffsets().filter((o) => o === '0')).toHaveLength(1);
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
    await vi.waitFor(() => expect(md.mapStore.get().backgroundStatus).toBe('done'));
    expect(md.mapStore.get().status).toBe('ready');
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

  it('caps the stations at 6000, dropping the oldest', async () => {
    installFetch((url) => {
      const lat = Number(url.searchParams.get('geo_lat'));
      const batch = Array.from({ length: 200 }, (_, k) => geoRec(`${lat}-${k}`, 1, 1));
      return json(batch);
    });
    for (let i = 0; i < 31; i++) md.loadNear({ lat: -60 + i * 4, lng: 0 }, 50);
    await vi.waitFor(() => expect(md.mapStore.get().stations.length).toBe(6000));
    const ids = md.mapStore.get().stations.map((s) => s.id);
    expect(ids.includes('-60-0')).toBe(false);
    expect(ids.at(-1)).toBe('60-199');
  });

  it('loadNear ignores failures silently', async () => {
    installFetch(() => {
      throw new TypeError('fetch failed');
    });
    expect(() => md.loadNear({ lat: 1, lng: 1 }, 50)).not.toThrow();
    await vi.waitFor(() => expect(calls.some((u) => u.searchParams.get('geo_lat') === '1')).toBe(true));
    await new Promise((r) => setTimeout(r, 0));
    expect(md.mapStore.get()).toEqual({ stations: [], status: 'idle', backgroundStatus: 'idle' });
  });
});

describe('background map pages', () => {
  it('loads pages 1 and 2 after page 0, merged by id and deduped', async () => {
    installFetch(
      pagesHandler({
        0: [geoRec('a', 1, 1), geoRec('b', 2, 2)],
        1000: [geoRec('b', 2, 2), geoRec('c', 3, 3)],
        2000: [geoRec('d', 4, 4), geoRec('c', 3, 3)],
      }),
    );
    md.initMapData();
    await vi.waitFor(() => expect(md.mapStore.get().backgroundStatus).toBe('done'));
    const state = md.mapStore.get();
    expect(state.status).toBe('ready');
    expect(state.stations.map((s) => s.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(geoOffsets()).toEqual(['0', '1000', '2000']);
  });

  it('starts each page through requestIdleCallback', async () => {
    const idle = vi.fn((cb: () => void) => setTimeout(cb, 0));
    vi.stubGlobal('requestIdleCallback', idle);
    installFetch(pagesHandler({ 0: [geoRec('a', 1, 1)], 1000: [geoRec('b', 2, 2)], 2000: [geoRec('c', 3, 3)] }));
    md.initMapData();
    await vi.waitFor(() => expect(md.mapStore.get().backgroundStatus).toBe('done'));
    expect(idle).toHaveBeenCalledTimes(2);
  });

  it('stops when a page adds no new stations', async () => {
    installFetch(
      pagesHandler({
        0: [geoRec('a', 1, 1)],
        1000: [geoRec('a', 1, 1)],
        2000: [geoRec('z', 9, 9)],
      }),
    );
    md.initMapData();
    await vi.waitFor(() => expect(md.mapStore.get().backgroundStatus).toBe('done'));
    expect(md.mapStore.get().stations.map((s) => s.id)).toEqual(['a']);
    expect(geoOffsets()).toEqual(['0', '1000']);
  });

  it('a failure on page 1 keeps page 0, ends as done without an error status, and stops', async () => {
    installFetch(pagesHandler({ 0: [geoRec('a', 1, 1), geoRec('b', 2, 2)], 1000: 'fail', 2000: [geoRec('c', 3, 3)] }));
    md.initMapData();
    await vi.waitFor(() => expect(md.mapStore.get().backgroundStatus).toBe('done'));
    const state = md.mapStore.get();
    expect(state.status).toBe('ready');
    expect(state.stations.map((s) => s.id)).toEqual(['a', 'b']);
    expect(geoOffsets()).toEqual(['0', '1000', '1000']);
  });

  it('does not start background loading when page 0 fails', async () => {
    installFetch(pagesHandler({ 0: 'fail', 1000: [geoRec('b', 2, 2)] }));
    md.initMapData();
    await vi.waitFor(() => expect(md.mapStore.get().status).toBe('error'));
    await new Promise((r) => setTimeout(r, 0));
    expect(md.mapStore.get().backgroundStatus).toBe('idle');
    expect(geoOffsets()).not.toContain('1000');
  });

  it.each([
    ['saveData', { saveData: true }],
    ['2g', { effectiveType: '2g' }],
    ['slow-2g', { effectiveType: 'slow-2g' }],
  ])('skips background loading when the connection is %s', async (_name, connection) => {
    setConnection(connection);
    installFetch(pagesHandler({ 0: [geoRec('a', 1, 1)], 1000: [geoRec('b', 2, 2)] }));
    md.initMapData();
    await vi.waitFor(() => expect(md.mapStore.get().backgroundStatus).toBe('skipped'));
    expect(md.mapStore.get().status).toBe('ready');
    expect(geoOffsets()).toEqual(['0']);
  });

  it('keeps background loading on a fast connection that is not data-saving', async () => {
    setConnection({ saveData: false, effectiveType: '4g' });
    installFetch(pagesHandler({ 0: [geoRec('a', 1, 1)], 1000: [geoRec('b', 2, 2)] }));
    md.initMapData();
    await vi.waitFor(() => expect(md.mapStore.get().backgroundStatus).toBe('done'));
    expect(md.mapStore.get().stations.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('initMapData called again loads each page once', async () => {
    installFetch(pagesHandler({ 0: [geoRec('a', 1, 1)], 1000: [geoRec('b', 2, 2)], 2000: [geoRec('c', 3, 3)] }));
    md.initMapData();
    md.initMapData();
    await vi.waitFor(() => expect(md.mapStore.get().status).toBe('ready'));
    md.initMapData();
    await vi.waitFor(() => expect(md.mapStore.get().backgroundStatus).toBe('done'));
    md.initMapData();
    await new Promise((r) => setTimeout(r, 0));
    expect(geoOffsets()).toEqual(['0', '1000', '2000']);
    expect(md.mapStore.get().stations.map((s) => s.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('waits for the 1500 ms fallback timer before each page when requestIdleCallback is missing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      vi.stubGlobal('requestIdleCallback', undefined);
      installFetch(pagesHandler({ 0: [geoRec('a', 1, 1)], 1000: [geoRec('b', 2, 2)], 2000: [geoRec('c', 3, 3)] }));
      md.initMapData();
      await settle(() => md.mapStore.get().status === 'ready');
      expect(geoOffsets()).toEqual(['0']);
      await vi.advanceTimersByTimeAsync(1499);
      expect(geoOffsets()).toEqual(['0']);
      await vi.advanceTimersByTimeAsync(1);
      await settle(() => geoOffsets().length === 2);
      expect(geoOffsets()).toEqual(['0', '1000']);
      await vi.advanceTimersByTimeAsync(1500);
      await settle(() => md.mapStore.get().backgroundStatus === 'done');
      expect(geoOffsets()).toEqual(['0', '1000', '2000']);
    } finally {
      vi.useRealTimers();
    }
  });
});

/** Lets pending promise callbacks run. Uses the real timer, captured before fake timers are installed. */
const realSetTimeout = globalThis.setTimeout;
async function settle(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 500 && !cond(); i++) await new Promise((r) => realSetTimeout(r, 0));
  expect(cond()).toBe(true);
}

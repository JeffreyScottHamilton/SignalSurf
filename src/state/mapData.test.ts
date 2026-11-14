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

beforeEach(async () => {
  calls = [];
  vi.resetModules();
  md = await import('./mapData');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Lets pending promise callbacks run. Uses the real timer, captured before fake timers are installed. */
const realSetTimeout = globalThis.setTimeout;
async function settle(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 500 && !cond(); i++) await new Promise((r) => realSetTimeout(r, 0));
  expect(cond()).toBe(true);
}

/** Records each change of nearStatus, starting from idle. */
function recordNearTransitions(): string[] {
  const seen: string[] = [];
  let last = 'idle';
  md.mapStore.subscribe(() => {
    const now = md.mapStore.get().nearStatus;
    if (now === last) return;
    last = now;
    seen.push(now);
  });
  return seen;
}

/** Near requests seen so far (geo_distance set). */
function nearCalls(): URL[] {
  return calls.filter((u) => u.searchParams.has('geo_distance'));
}

describe('mapStore', () => {
  it('starts idle with no stations and no nearby request in flight', () => {
    expect(md.mapStore.get()).toEqual({ stations: [], status: 'idle', nearStatus: 'idle' });
  });

  it('initMapData loads the popular geo stations (page 0) once', async () => {
    installFetch(() => json([geoRec('g1', 52.5, 13.4), geoRec('g2', 0, 0)]));
    md.initMapData();
    md.initMapData();
    await vi.waitFor(() => expect(md.mapStore.get().status).toBe('ready'));
    expect(md.mapStore.get().stations.map((s) => s.id)).toEqual(['g1']);
    expect(geoOffsets()).toEqual(['0']);
  });

  it('makes no background requests after init: only page 0 is loaded', async () => {
    installFetch(
      pagesHandler({
        0: [geoRec('a', 1, 1)],
        1000: [geoRec('b', 2, 2)],
        2000: [geoRec('c', 3, 3)],
      }),
    );
    md.initMapData();
    await vi.waitFor(() => expect(md.mapStore.get().status).toBe('ready'));
    await new Promise((r) => realSetTimeout(r, 50));
    expect(geoOffsets()).toEqual(['0']);
    expect(calls.filter((u) => u.pathname === '/json/stations/search')).toHaveLength(1);
    expect(md.mapStore.get().stations.map((s) => s.id)).toEqual(['a']);
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

  it('caps the stations at 8000, dropping the oldest', async () => {
    installFetch((url) => {
      const lat = Number(url.searchParams.get('geo_lat'));
      const batch = Array.from({ length: 200 }, (_, k) => geoRec(`${lat}-${k}`, 1, 1));
      return json(batch);
    });
    // One request at a time: a new near request aborts the one in flight.
    for (let i = 0; i < 41; i++) {
      const lat = -80 + i * 4;
      md.loadNear({ lat, lng: 0 }, 50);
      await settle(() => md.mapStore.get().stations.some((s) => s.id === `${lat}-199`));
    }
    const ids = md.mapStore.get().stations.map((s) => s.id);
    expect(ids).toHaveLength(8000);
    expect(ids.includes('-80-0')).toBe(false);
    expect(ids.at(-1)).toBe('80-199');
  });

  it('loadNear ignores failures silently', async () => {
    installFetch(() => {
      throw new TypeError('fetch failed');
    });
    expect(() => md.loadNear({ lat: 1, lng: 1 }, 50)).not.toThrow();
    await settle(() => calls.some((u) => u.searchParams.get('geo_lat') === '1'));
    await new Promise((r) => realSetTimeout(r, 0));
    expect(md.mapStore.get()).toEqual({ stations: [], status: 'idle', nearStatus: 'idle' });
  });
});

describe('loadNear requests', () => {
  it('asks for the radius bucket, 500 stations, most popular first', async () => {
    installFetch(() => json([]));
    md.loadNear({ lat: 48.2, lng: 16.4 }, 420);
    await settle(() => nearCalls().length === 1);
    const u = nearCalls()[0];
    expect(u.searchParams.get('geo_distance')).toBe('600000');
    expect(u.searchParams.get('limit')).toBe('500');
    expect(u.searchParams.get('order')).toBe('clickcount');
    expect(u.searchParams.get('reverse')).toBe('true');
  });

  it('skips the request when the snapped centre and radius bucket were already loaded', async () => {
    installFetch(() => json([geoRec('a', 48, 16)]));
    md.loadNear({ lat: 48.2, lng: 16.2 }, 200);
    await settle(() => md.mapStore.get().stations.length === 1);
    // Same snapped centre (48, 16) and same bucket (300 km): no request.
    md.loadNear({ lat: 48.1, lng: 16.1 }, 290);
    await new Promise((r) => realSetTimeout(r, 20));
    expect(nearCalls()).toHaveLength(1);
    md.loadNear({ lat: 48.1, lng: 16.1 }, 700);
    await settle(() => nearCalls().length === 2);
    expect(nearCalls()[1].searchParams.get('geo_distance')).toBe('1200000');
  });

  it('does not skip a failed request, so moving back retries it', async () => {
    let fail = true;
    installFetch(() => {
      if (fail) throw new TypeError('fetch failed');
      return json([geoRec('a', 48, 16)]);
    });
    md.loadNear({ lat: 48, lng: 16 }, 200);
    // Both attempts of the failed request (one retry on the next server) have been made.
    await settle(() => nearCalls().length === 2);
    await new Promise((r) => realSetTimeout(r, 20));
    fail = false;
    md.loadNear({ lat: 48, lng: 16 }, 200);
    await settle(() => md.mapStore.get().stations.length === 1);
    expect(nearCalls()).toHaveLength(3);
  });

  it('aborts the previous near request when a new one starts, and never merges its stations', async () => {
    const signals = new Map<string, AbortSignal>();
    const release: Record<string, (r: Response) => void> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        calls.push(url);
        if (url.hostname === DISCOVERY_HOST) return Promise.resolve(json([{ ip: '10.0.0.1', name: DE1 }]));
        const lat = url.searchParams.get('geo_lat') ?? '';
        if (init?.signal) signals.set(lat, init.signal);
        return new Promise<Response>((resolve) => {
          release[lat] = resolve;
        });
      }),
    );
    md.loadNear({ lat: 10, lng: 10 }, 200);
    await settle(() => signals.has('10'));
    md.loadNear({ lat: 30, lng: 30 }, 200);
    await settle(() => signals.has('30'));
    expect(signals.get('10')?.aborted).toBe(true);
    expect(signals.get('30')?.aborted).toBe(false);
    // The stale answer arrives late: it must not reach the store.
    release['10'](json([geoRec('stale', 10, 10)]));
    release['30'](json([geoRec('fresh', 30, 30)]));
    await settle(() => md.mapStore.get().stations.length === 1);
    expect(md.mapStore.get().stations.map((s) => s.id)).toEqual(['fresh']);
    expect(md.mapStore.get().nearStatus).toBe('idle');
  });
});

describe('nearStatus', () => {
  /** Answers near requests by hand, so the test controls when they finish. Keyed by the request's latitude. */
  function manualNear(): Record<string, (r: Response) => void> {
    const release: Record<string, (r: Response) => void> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        calls.push(url);
        if (url.hostname === DISCOVERY_HOST) return Promise.resolve(json([{ ip: '10.0.0.1', name: DE1 }]));
        return new Promise<Response>((resolve) => {
          release[url.searchParams.get('geo_lat') ?? ''] = resolve;
        });
      }),
    );
    return release;
  }

  it('shows loading only after a near request has been in flight for more than 400 ms, and clears it when done', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const release = manualNear();
      const seen = recordNearTransitions();
      md.loadNear({ lat: 10, lng: 10 }, 200);
      await settle(() => release['10'] !== undefined);
      expect(md.mapStore.get().nearStatus).toBe('idle');
      await vi.advanceTimersByTimeAsync(399);
      expect(md.mapStore.get().nearStatus).toBe('idle');
      await vi.advanceTimersByTimeAsync(2);
      expect(md.mapStore.get().nearStatus).toBe('loading');
      release['10'](json([geoRec('a', 10, 10)]));
      await settle(() => md.mapStore.get().nearStatus === 'idle');
      expect(seen).toEqual(['loading', 'idle']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never shows loading for a request that finishes within 400 ms', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const release = manualNear();
      const seen = recordNearTransitions();
      md.loadNear({ lat: 10, lng: 10 }, 200);
      await settle(() => release['10'] !== undefined);
      await vi.advanceTimersByTimeAsync(200);
      release['10'](json([geoRec('a', 10, 10)]));
      await settle(() => md.mapStore.get().stations.length === 1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(seen).not.toContain('loading');
      expect(md.mapStore.get().nearStatus).toBe('idle');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows nothing on failure: the status returns to idle and no error is stored', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const release = manualNear();
      md.loadNear({ lat: 10, lng: 10 }, 200);
      await settle(() => release['10'] !== undefined);
      await vi.advanceTimersByTimeAsync(500);
      expect(md.mapStore.get().nearStatus).toBe('loading');
      // A 400 is not retried on another server, so one answer settles the request as a failure.
      release['10'](new Response('nope', { status: 400 }));
      await settle(() => md.mapStore.get().nearStatus === 'idle');
      expect(md.mapStore.get()).toEqual({ stations: [], status: 'idle', nearStatus: 'idle' });
    } finally {
      vi.useRealTimers();
    }
  });
});

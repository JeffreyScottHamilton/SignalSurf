import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Api = typeof import('./radioBrowser');

const DISCOVERY_HOST = 'all.api.radio-browser.info';
const DE1 = 'de1.api.radio-browser.info';

let api: Api;
let calls: URL[];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

function rec(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    stationuuid: id,
    name: `Station ${id}`,
    url: `https://stream.test/${id}`,
    url_resolved: `https://stream.test/${id}`,
    homepage: '',
    favicon: '',
    tags: '',
    country: 'Germany',
    countrycode: 'DE',
    state: '',
    codec: 'MP3',
    bitrate: 128,
    hls: 0,
    lastcheckok: 1,
    lastchecktime_iso8601: null,
    clickcount: 10,
    votes: 1,
    geo_lat: null,
    geo_long: null,
    ...overrides,
  };
}

type Handler = (url: URL) => Response | Promise<Response>;

/** Installs a fetch mock that records every URL and answers with `handler`. The discovery list is de1 only. */
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

function searchCalls(): URL[] {
  return calls.filter((u) => u.pathname === '/json/stations/search');
}

function param(url: URL, key: string): string | null {
  return url.searchParams.get(key);
}

beforeEach(async () => {
  calls = [];
  vi.resetModules();
  api = await import('./radioBrowser');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('searchStations request parameters', () => {
  it('sends name and state queries with the safety filters, and no country query for a non-country', async () => {
    installFetch(() => json([]));
    await api.searchStations({ query: 'jazz', category: 'all' });
    const search = searchCalls();
    expect(search).toHaveLength(2);
    expect(search.map((u) => param(u, 'name') ?? param(u, 'state'))).toEqual(['jazz', 'jazz']);
    for (const u of search) {
      expect(u.hostname).toBe(DE1);
      expect(param(u, 'hidebroken')).toBe('true');
      expect(param(u, 'is_https')).toBe('true');
      expect(param(u, 'order')).toBe('clickcount');
      expect(param(u, 'reverse')).toBe('true');
      expect(param(u, 'limit')).toBe('150');
      expect(param(u, 'tag')).toBeNull();
    }
  });

  it.each([
    ['japan', 'JP'],
    ['JAPAN', 'JP'],
    ['usa', 'US'],
    ['uk', 'GB'],
    ['Germany', 'DE'],
    ['germ', 'DE'],
  ])('queries the country code for "%s" -> %s', async (query, code) => {
    installFetch(() => json([]));
    await api.searchStations({ query, category: 'all' });
    const byCode = searchCalls().filter((u) => param(u, 'countrycode') !== null);
    expect(byCode.map((u) => param(u, 'countrycode'))).toEqual([code]);
    expect(searchCalls().some((u) => param(u, 'country') !== null)).toBe(false);
  });

  it('sends no country request when the query matches no country', async () => {
    installFetch(() => json([]));
    await api.searchStations({ query: 'nonsense', category: 'all' });
    expect(searchCalls().some((u) => param(u, 'countrycode') !== null)).toBe(false);
    expect(searchCalls()).toHaveLength(2);
  });

  it('does not treat a 3-letter prefix as a country', async () => {
    installFetch(() => json([]));
    await api.searchStations({ query: 'ger', category: 'all' });
    expect(searchCalls().some((u) => param(u, 'countrycode') !== null)).toBe(false);
  });

  it('adds the tag hint to every query for a category', async () => {
    installFetch(() => json([]));
    await api.searchStations({ query: 'x', category: 'sports' });
    expect(searchCalls().every((u) => param(u, 'tag') === 'sport')).toBe(true);
  });

  it('uses popular stations for an empty query', async () => {
    installFetch(() => json([rec('a')]));
    await api.searchStations({ query: '  ', category: 'all' });
    const search = searchCalls();
    expect(search).toHaveLength(1);
    expect(param(search[0], 'name')).toBeNull();
    expect(param(search[0], 'order')).toBe('clickcount');
  });

  it('honours a custom limit', async () => {
    installFetch(() => json([]));
    await api.searchStations({ query: '', category: 'all', limit: 5 });
    expect(param(searchCalls()[0], 'limit')).toBe('5');
  });
});

describe('searchStations results', () => {
  it('merges the name, state and country queries, dedupes, and sorts by clicks', async () => {
    installFetch((url) => {
      if (param(url, 'name')) return json([rec('a', { clickcount: 10 }), rec('b', { clickcount: 50 })]);
      if (param(url, 'countrycode')) return json([rec('b', { clickcount: 50 }), rec('c', { clickcount: 30 })]);
      return json([rec('d', { clickcount: 5 })]);
    });
    const out = await api.searchStations({ query: 'japan', category: 'all' });
    expect(out.map((s) => s.id)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('drops records that cannot be played', async () => {
    installFetch(() =>
      json([rec('ok'), rec('insecure', { url_resolved: 'http://stream.test/x', url: 'http://stream.test/x' })]),
    );
    const out = await api.searchStations({ query: '', category: 'all' });
    expect(out.map((s) => s.id)).toEqual(['ok']);
  });

  it('keeps only stations in the chosen category', async () => {
    installFetch((url) => {
      if (!param(url, 'name')) return json([]);
      return json([rec('news1', { tags: 'news' }), rec('music1', { tags: 'jazz' }), rec('both', { tags: 'news,jazz' })]);
    });
    const out = await api.searchStations({ query: 'x', category: 'news' });
    expect(out.map((s) => s.id).sort()).toEqual(['both', 'news1']);
  });

  it('tops up a thin tag-hinted popular list from one larger unhinted request', async () => {
    installFetch((url) => {
      if (param(url, 'tag')) return json([rec('m1', { tags: 'jazz' }), rec('m2', { tags: 'jazz' })]);
      const extra = Array.from({ length: 25 }, (_, i) => rec(`w${i}`, { tags: 'pop', clickcount: 100 - i }));
      return json(extra);
    });
    const out = await api.searchStations({ query: '', category: 'music' });
    const wide = searchCalls().filter((u) => param(u, 'tag') === null);
    expect(wide).toHaveLength(1);
    expect(param(wide[0], 'limit')).toBe('500');
    expect(out).toHaveLength(27);
  });

  it('does not top up when the hinted list is large enough', async () => {
    installFetch((url) => {
      if (param(url, 'tag')) return json(Array.from({ length: 25 }, (_, i) => rec(`m${i}`, { tags: 'jazz' })));
      return json([]);
    });
    await api.searchStations({ query: '', category: 'music' });
    expect(searchCalls()).toHaveLength(1);
  });

  it('rejects with the network kind when every server is unreachable', async () => {
    installFetch(() => {
      throw new TypeError('fetch failed');
    });
    await expect(api.searchStations({ query: '', category: 'all' })).rejects.toMatchObject({ kind: 'network' });
  });

  it('rejects with the parse kind for a non-JSON body', async () => {
    installFetch(() => new Response('<html>oops</html>', { status: 200 }));
    await expect(api.searchStations({ query: '', category: 'all' })).rejects.toMatchObject({ kind: 'parse' });
  });

  it('rejects with the aborted kind when the signal is already aborted', async () => {
    installFetch(() => json([]));
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(api.searchStations({ query: 'x', category: 'all' }, ctrl.signal)).rejects.toMatchObject({
      kind: 'aborted',
    });
  });
});

describe('server selection', () => {
  it('fails over to the next server after a network error, and remembers it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        calls.push(url);
        if (url.hostname === DISCOVERY_HOST) return json([{ ip: '10.0.0.2', name: 'bad1.api.radio-browser.info' }]);
        if (url.hostname === 'bad1.api.radio-browser.info') throw new TypeError('fetch failed');
        return json([rec('ok')]);
      }),
    );

    const first = await api.searchStations({ query: '', category: 'all' });
    expect(first.map((s) => s.id)).toEqual(['ok']);
    expect(calls.map((u) => u.hostname)).toEqual([DISCOVERY_HOST, 'bad1.api.radio-browser.info', DE1]);

    calls = [];
    await api.searchStations({ query: '', category: 'all' });
    expect(calls.map((u) => u.hostname)).toEqual([DE1]);
  });

  it('retries once on a 5xx from the first server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        calls.push(url);
        if (url.hostname === DISCOVERY_HOST) return json([{ ip: '10.0.0.3', name: 'bad2.api.radio-browser.info' }]);
        if (url.hostname === 'bad2.api.radio-browser.info') return json([], 503);
        return json([rec('ok')]);
      }),
    );
    const out = await api.searchStations({ query: '', category: 'all' });
    expect(out.map((s) => s.id)).toEqual(['ok']);
    expect(calls.map((u) => u.hostname)).toEqual([DISCOVERY_HOST, 'bad2.api.radio-browser.info', DE1]);
  });

  it('does not retry a 4xx and reports the http kind', async () => {
    installFetch(() => json({ error: 'bad' }, 400));
    await expect(api.searchStations({ query: '', category: 'all' })).rejects.toMatchObject({ kind: 'http' });
    expect(searchCalls()).toHaveLength(1);
  });

  it('ignores discovered names that are not Radio Browser hosts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        calls.push(url);
        if (url.hostname === DISCOVERY_HOST) return json([{ name: 'evil.example.com' }]);
        return json([rec('ok')]);
      }),
    );
    await api.searchStations({ query: '', category: 'all' });
    expect(calls.some((u) => u.hostname === 'evil.example.com')).toBe(false);
    expect(calls.some((u) => u.hostname === DE1)).toBe(true);
  });
});

describe('fetchMapStations', () => {
  it('requests geo stations once per session and keeps only those with coords', async () => {
    installFetch(() =>
      json([rec('g1', { geo_lat: 52.5, geo_long: 13.4 }), rec('n1'), rec('g2', { geo_lat: 0, geo_long: 0 })]),
    );
    const first = await api.fetchMapStations();
    const second = await api.fetchMapStations();
    expect(first.map((s) => s.id)).toEqual(['g1']);
    expect(second).toBe(first);
    const search = searchCalls();
    expect(search).toHaveLength(1);
    expect(param(search[0], 'has_geo_info')).toBe('true');
    expect(param(search[0], 'limit')).toBe('1000');
    expect(param(search[0], 'order')).toBe('clickcount');
  });

  it('drops stations without coordinates before dedupe, so a coord-less copy cannot hide the mapped one', async () => {
    installFetch(() =>
      json([
        rec('nocoord', { url_resolved: 'https://stream.test/shared' }),
        rec('mapped', { url_resolved: 'https://stream.test/shared', geo_lat: 1, geo_long: 2 }),
      ]),
    );
    const out = await api.fetchMapStations();
    expect(out.map((s) => s.id)).toEqual(['mapped']);
  });

  it('does not cache a failed load', async () => {
    let fail = true;
    installFetch(() => {
      if (fail) throw new TypeError('fetch failed');
      return json([rec('g1', { geo_lat: 1, geo_long: 2 })]);
    });
    await expect(api.fetchMapStations()).rejects.toMatchObject({ kind: 'network' });
    fail = false;
    const out = await api.fetchMapStations();
    expect(out.map((s) => s.id)).toEqual(['g1']);
  });
});

describe('fetchStationsNear', () => {
  it('sends the position, distance in metres, and the default limit', async () => {
    installFetch(() => json([]));
    await api.fetchStationsNear({ lat: 52.5, lng: 13.5 }, 50);
    const u = searchCalls()[0];
    expect(param(u, 'geo_lat')).toBe('52.5');
    expect(param(u, 'geo_long')).toBe('13.5');
    expect(param(u, 'geo_distance')).toBe('50000');
    expect(param(u, 'limit')).toBe('200');
  });

  it('snaps the request centre to a 0.5 degree grid, the same centre the cache key uses', async () => {
    installFetch(() => json([]));
    await api.fetchStationsNear({ lat: 52.4, lng: 13.2 }, 50);
    const u = searchCalls()[0];
    expect(param(u, 'geo_lat')).toBe('52.5');
    expect(param(u, 'geo_long')).toBe('13');
  });

  it('caches by position snapped to 0.5 degrees and by radius', async () => {
    installFetch(() => json([rec('g1', { geo_lat: 52.5, geo_long: 13.4 })]));
    await api.fetchStationsNear({ lat: 52.4, lng: 13.2 }, 50);
    await api.fetchStationsNear({ lat: 52.3, lng: 13.1 }, 50);
    expect(searchCalls()).toHaveLength(1);
    await api.fetchStationsNear({ lat: 52.3, lng: 13.1 }, 100);
    expect(searchCalls()).toHaveLength(2);
  });

  it('does not share a cached answer between areas half a degree apart', async () => {
    installFetch((url) => json([rec(`at-${url.searchParams.get('geo_lat')}`, { geo_lat: 1, geo_long: 2 })]));
    const north = await api.fetchStationsNear({ lat: 52.4, lng: 13.2 }, 50);
    const south = await api.fetchStationsNear({ lat: 52.8, lng: 13.2 }, 50);
    expect(searchCalls()).toHaveLength(2);
    expect(north.map((s) => s.id)).toEqual(['at-52.5']);
    expect(south.map((s) => s.id)).toEqual(['at-53']);
  });

  it('drops stations without coordinates before dedupe, so a coord-less copy cannot hide the mapped one', async () => {
    installFetch(() => {
      return json([
        rec('nocoord', { url_resolved: 'https://stream.test/shared' }),
        rec('mapped', { url_resolved: 'https://stream.test/shared', geo_lat: 52.5, geo_long: 13.5 }),
      ]);
    });
    const out = await api.fetchStationsNear({ lat: 52.5, lng: 13.5 }, 50);
    expect(out.map((s) => s.id)).toEqual(['mapped']);
  });

  it('rejects an invalid position', async () => {
    installFetch(() => json([]));
    await expect(api.fetchStationsNear({ lat: 120, lng: 0 }, 50)).rejects.toMatchObject({ kind: 'parse' });
    expect(searchCalls()).toHaveLength(0);
  });
});

describe('reportClick', () => {
  it('counts a click on the active server and never throws', async () => {
    installFetch(() => json([]));
    expect(() => api.reportClick('station-uuid-1')).not.toThrow();
    await vi.waitFor(() => expect(calls.some((u) => u.pathname === '/json/url/station-uuid-1')).toBe(true));
    expect(calls.find((u) => u.pathname === '/json/url/station-uuid-1')?.hostname).toBe(DE1);
  });

  it('swallows a failing request', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))));
    expect(() => api.reportClick('station-uuid-2')).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe('searchStationsPage paging', () => {
  it('sends offset on the popular request and on every name, state and country request', async () => {
    installFetch(() => json([]));
    await api.searchStationsPage({ query: '', category: 'all', limit: 150, offset: 150 });
    expect(searchCalls().map((u) => param(u, 'offset'))).toEqual(['150']);

    calls = [];
    installFetch(() => json([]));
    await api.searchStationsPage({ query: 'japan', category: 'all', limit: 150, offset: 300 });
    const search = searchCalls();
    expect(search).toHaveLength(3);
    expect(search.every((u) => param(u, 'offset') === '300')).toBe(true);
  });

  it('sends offset on the category tag-hinted request', async () => {
    installFetch(() => json([]));
    await api.searchStationsPage({ query: '', category: 'news', limit: 150, offset: 150 });
    expect(searchCalls().every((u) => param(u, 'offset') === '150' && param(u, 'tag') === 'news')).toBe(true);
  });

  it('reports hasMore true when the popular page is full in raw rows, even if filtering shrinks it', async () => {
    const rows = [rec('a'), rec('b', { url_resolved: 'http://stream.test/x', url: 'http://stream.test/x' }), rec('c')];
    installFetch(() => json(rows));
    const page = await api.searchStationsPage({ query: '', category: 'all', limit: 3 });
    expect(page.stations.map((s) => s.id)).toEqual(['a', 'c']);
    expect(page.hasMore).toBe(true);
  });

  it('reports hasMore false when the popular page is short', async () => {
    installFetch(() => json([rec('a'), rec('b')]));
    const page = await api.searchStationsPage({ query: '', category: 'all', limit: 3 });
    expect(page.hasMore).toBe(false);
  });

  it('reports hasMore true when any query request is full, even if another is short', async () => {
    installFetch((url) => {
      if (param(url, 'name')) return json([rec('a'), rec('b')]);
      return json([rec('c')]);
    });
    const page = await api.searchStationsPage({ query: 'jazz', category: 'all', limit: 2 });
    expect(page.hasMore).toBe(true);
  });

  it('reports hasMore false when every query request is short', async () => {
    installFetch((url) => (param(url, 'name') ? json([rec('a')]) : json([rec('b')])));
    const page = await api.searchStationsPage({ query: 'jazz', category: 'all', limit: 2 });
    expect(page.hasMore).toBe(false);
  });

  it('skips the category top-up for offset > 0', async () => {
    installFetch((url) => {
      if (param(url, 'tag')) return json([rec('m1', { tags: 'jazz' })]);
      return json(Array.from({ length: 25 }, (_, i) => rec(`w${i}`, { tags: 'pop' })));
    });
    const page = await api.searchStationsPage({ query: '', category: 'music', limit: 150, offset: 150 });
    expect(searchCalls()).toHaveLength(1);
    expect(page.stations.map((s) => s.id)).toEqual(['m1']);
  });

  it('keeps the top-up on the first page', async () => {
    installFetch((url) => {
      if (param(url, 'tag')) return json([rec('m1', { tags: 'jazz' })]);
      return json([]);
    });
    await api.searchStationsPage({ query: '', category: 'music', limit: 150, offset: 0 });
    expect(searchCalls()).toHaveLength(2);
  });

  it('does not count the top-up request towards hasMore', async () => {
    installFetch((url) => {
      if (param(url, 'tag')) return json([rec('m1', { tags: 'jazz' })]);
      return json(Array.from({ length: 500 }, (_, i) => rec(`w${i}`, { tags: 'pop', clickcount: 500 - i })));
    });
    const page = await api.searchStationsPage({ query: '', category: 'music', limit: 150 });
    expect(page.hasMore).toBe(false);
  });

  it('searchStations still returns only the stations, from offset 0', async () => {
    installFetch(() => json([rec('a')]));
    const out = await api.searchStations({ query: '', category: 'all' });
    expect(out.map((s) => s.id)).toEqual(['a']);
    expect(searchCalls().every((u) => param(u, 'offset') === '0')).toBe(true);
  });
});

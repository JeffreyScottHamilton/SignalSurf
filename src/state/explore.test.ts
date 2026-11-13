import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Explore = typeof import('./explore');

const DISCOVERY_HOST = 'all.api.radio-browser.info';
const DE1 = 'de1.api.radio-browser.info';
const ERROR = "Couldn't reach the station directory. Check your connection and try again.";

let ex: Explore;
let calls: URL[];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

function rec(id: string, name = `Station ${id}`): Record<string, unknown> {
  return {
    stationuuid: id,
    name,
    url_resolved: `https://stream.test/${id}`,
    url: `https://stream.test/${id}`,
    tags: '',
    country: 'Germany',
    countrycode: 'DE',
    state: '',
    clickcount: 1,
    votes: 0,
    lastcheckok: 1,
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

function searchCalls(): URL[] {
  return calls.filter((u) => u.pathname === '/json/stations/search');
}

/** Lets pending promises and fake-timer callbacks run. */
async function settle(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

beforeEach(async () => {
  calls = [];
  vi.useFakeTimers();
  vi.resetModules();
  ex = await import('./explore');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('explore store', () => {
  it('starts idle with an empty query and the all category', () => {
    const s = ex.exploreStore.get();
    expect(s).toMatchObject({ query: '', category: 'all', results: [], status: 'idle', error: null });
  });

  it('debounces setQuery by 350 ms and trims the query', async () => {
    installFetch(() => json([rec('a')]));
    ex.setQuery('  jazz  ');
    await settle(349);
    expect(searchCalls()).toHaveLength(0);
    await settle(1);
    expect(ex.exploreStore.get().query).toBe('jazz');
    expect(searchCalls().some((u) => u.searchParams.get('name') === 'jazz')).toBe(true);
    await settle();
    expect(ex.exploreStore.get()).toMatchObject({ status: 'ready' });
    expect(ex.exploreStore.get().results.map((s) => s.id)).toEqual(['a']);
  });

  it('only the last query in a burst is searched', async () => {
    installFetch(() => json([]));
    ex.setQuery('j');
    await settle(200);
    ex.setQuery('ja');
    await settle(200);
    ex.setQuery('jaz');
    await settle(350);
    const names = searchCalls().map((u) => u.searchParams.get('name'));
    expect(names).toContain('jaz');
    expect(names).not.toContain('j');
    expect(names).not.toContain('ja');
  });

  it('ignores a late response from an aborted request', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    installFetch(async (url) => {
      const name = url.searchParams.get('name');
      if (name === 'slow') await gate;
      if (name === 'slow') return json([rec('slow1')]);
      if (name === 'fast') return json([rec('fast1')]);
      return json([]);
    });

    ex.setQuery('slow');
    await settle(350);
    ex.setQuery('fast');
    await settle(350);
    await settle();
    expect(ex.exploreStore.get()).toMatchObject({ query: 'fast', status: 'ready' });
    expect(ex.exploreStore.get().results.map((s) => s.id)).toEqual(['fast1']);

    release();
    await settle();
    expect(ex.exploreStore.get().query).toBe('fast');
    expect(ex.exploreStore.get().results.map((s) => s.id)).toEqual(['fast1']);
  });

  it('sets an error state with a user-facing sentence, and retry recovers', async () => {
    installFetch(() => {
      throw new TypeError('fetch failed');
    });
    ex.initExplore();
    await settle();
    expect(ex.exploreStore.get()).toMatchObject({ status: 'error', error: ERROR, results: [] });

    installFetch(() => json([rec('a')]));
    ex.retryExplore();
    await settle();
    expect(ex.exploreStore.get()).toMatchObject({ status: 'ready', error: null });
    expect(ex.exploreStore.get().results.map((s) => s.id)).toEqual(['a']);
  });

  it('setCategory is immediate and sends the tag hint', async () => {
    installFetch(() => json([]));
    ex.setCategory('news');
    expect(ex.exploreStore.get().category).toBe('news');
    await settle();
    expect(searchCalls().length).toBeGreaterThan(0);
    expect(searchCalls()[0].searchParams.get('tag')).toBe('news');
  });

  it('setCategory applies a query still waiting for its debounce, with one search', async () => {
    installFetch(() => json([]));
    ex.setQuery('jazz');
    ex.setCategory('music');
    await settle();
    expect(ex.exploreStore.get().query).toBe('jazz');
    const before = searchCalls().length;
    await settle(1000);
    expect(searchCalls().length).toBe(before);
    expect(before).toBe(2); // name + state; "jazz" is not a country
  });

  it('resetExplore clears the query and category and reloads popular stations', async () => {
    installFetch(() => json([]));
    ex.setCategory('sports');
    ex.setQuery('abc');
    await settle(400);
    calls = [];
    ex.resetExplore();
    expect(ex.exploreStore.get()).toMatchObject({ query: '', category: 'all' });
    await settle();
    expect(searchCalls()).toHaveLength(1);
    expect(searchCalls()[0].searchParams.get('name')).toBeNull();
    expect(searchCalls()[0].searchParams.get('tag')).toBeNull();
  });

  it('initExplore loads once', async () => {
    installFetch(() => json([rec('a')]));
    ex.initExplore();
    ex.initExplore();
    await settle();
    expect(searchCalls()).toHaveLength(1);
    expect(ex.exploreStore.get().results.map((s) => s.id)).toEqual(['a']);
  });
});

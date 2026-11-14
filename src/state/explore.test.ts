import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Explore = typeof import('./explore');
type Catalog = typeof import('@/catalog/catalog');

function rec(i: number, extra: Record<string, unknown> = {}) {
  const id = `station-${String(i).padStart(4, '0')}`;
  return {
    id,
    name: `Station ${i}`,
    streamUrl: `https://stream.test/${id}`,
    homepage: null,
    favicon: null,
    stateCode: 'TX',
    city: null,
    tags: ['jazz'],
    genres: ['jazz'],
    codec: null,
    bitrate: null,
    hls: false,
    clickCount: 1000 - i,
    ...extra,
  };
}

let ex: Explore;
let cat: Catalog;
let fetchMock: ReturnType<typeof vi.fn>;

async function loadWith(stations: unknown[]): Promise<void> {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ stations })));
  vi.stubGlobal('fetch', fetchMock);
  ex.initExplore();
  await vi.waitFor(() => expect(cat.catalogStore.get().status).toBe('ready'));
}

beforeEach(async () => {
  localStorage.clear();
  vi.resetModules();
  ex = await import('@/state/explore');
  cat = await import('@/catalog/catalog');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('explore loading', () => {
  it('loads the catalogue on first use and lists every match, most popular first', async () => {
    await loadWith([rec(1), rec(2, { clickCount: 5000, stateCode: 'NY' }), rec(3, { genres: [] })]);
    const s = ex.exploreStore.get();
    expect(s.status).toBe('ready');
    expect(s.results.map((x) => x.id)).toEqual(['station-0002', 'station-0001', 'station-0003']);
  });

  it('calls the network only for the catalogue file', async () => {
    await loadWith([rec(1)]);
    ex.setGenre('jazz');
    ex.setGenre('all');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('mirrors a catalogue error, and retry loads it', async () => {
    fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(
      new Response(JSON.stringify({ stations: [rec(1)] })),
    );
    vi.stubGlobal('fetch', fetchMock);
    ex.initExplore();
    await vi.waitFor(() => expect(ex.exploreStore.get().status).toBe('error'));
    expect(ex.exploreStore.get().error).toBe(cat.CATALOG_ERROR);
    expect(ex.exploreStore.get().results).toEqual([]);
    ex.retryExplore();
    await vi.waitFor(() => expect(ex.exploreStore.get().status).toBe('ready'));
    expect(ex.exploreStore.get().results).toHaveLength(1);
  });
});

describe('explore query and genre', () => {
  it('debounces the query by 150 ms and trims it', async () => {
    await loadWith([rec(1, { name: 'Alpha FM' }), rec(2, { name: 'Beta FM' })]);
    vi.useFakeTimers();
    ex.setQuery('  alpha  ');
    expect(ex.exploreStore.get().query).toBe('');
    vi.advanceTimersByTime(149);
    expect(ex.exploreStore.get().results).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(ex.exploreStore.get().query).toBe('alpha');
    expect(ex.exploreStore.get().results.map((s) => s.name)).toEqual(['Alpha FM']);
  });

  it('applies only the last query typed within the debounce window', async () => {
    await loadWith([rec(1, { name: 'Alpha FM' }), rec(2, { name: 'Beta FM' })]);
    vi.useFakeTimers();
    ex.setQuery('a');
    vi.advanceTimersByTime(100);
    ex.setQuery('beta');
    vi.advanceTimersByTime(100);
    expect(ex.exploreStore.get().query).toBe('');
    vi.advanceTimersByTime(60);
    expect(ex.exploreStore.get().query).toBe('beta');
  });

  it('applies a genre change at once and flushes a pending query with it', async () => {
    await loadWith([rec(1, { name: 'Alpha FM' }), rec(2, { name: 'Beta FM', genres: ['rock'] })]);
    vi.useFakeTimers();
    ex.setQuery('beta');
    ex.setGenre('rock');
    const s = ex.exploreStore.get();
    expect(s.genre).toBe('rock');
    expect(s.query).toBe('beta');
    expect(s.results.map((x) => x.id)).toEqual(['station-0002']);
    vi.advanceTimersByTime(500);
    expect(ex.exploreStore.get().query).toBe('beta');
  });

  it('reports no results for a query that matches nothing', async () => {
    await loadWith([rec(1)]);
    ex.setGenre('all');
    vi.useFakeTimers();
    ex.setQuery('zzz');
    vi.advanceTimersByTime(150);
    expect(ex.exploreStore.get().results).toEqual([]);
    expect(ex.exploreStore.get().hasMore).toBe(false);
  });
});

describe('explore paging (local)', () => {
  it('shows 150 at a time and reveals the next 150 without a request', async () => {
    const many = Array.from({ length: 400 }, (_, i) => rec(i + 1));
    await loadWith(many);
    expect(ex.exploreStore.get().results).toHaveLength(400);
    expect(ex.exploreStore.get().visibleCount).toBe(150);
    expect(ex.exploreStore.get().hasMore).toBe(true);

    ex.loadMore();
    expect(ex.exploreStore.get().visibleCount).toBe(300);
    expect(ex.exploreStore.get().hasMore).toBe(true);

    ex.loadMore();
    ex.loadMore();
    expect(ex.exploreStore.get().visibleCount).toBe(400);
    expect(ex.exploreStore.get().hasMore).toBe(false);
    ex.loadMore();
    expect(ex.exploreStore.get().visibleCount).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('starts from the first page again when the query changes', async () => {
    await loadWith(Array.from({ length: 300 }, (_, i) => rec(i + 1)));
    ex.loadMore();
    expect(ex.exploreStore.get().visibleCount).toBe(300);
    vi.useFakeTimers();
    ex.setQuery('station 1');
    vi.advanceTimersByTime(150);
    expect(ex.exploreStore.get().visibleCount).toBe(150);
  });

  it('has no more pages when the matches fit one page', async () => {
    await loadWith([rec(1), rec(2)]);
    expect(ex.exploreStore.get().hasMore).toBe(false);
  });
});

describe('explore reset', () => {
  it('clears the query and genre and returns to the first page', async () => {
    await loadWith(Array.from({ length: 200 }, (_, i) => rec(i + 1, { genres: i % 2 ? ['jazz'] : ['rock'] })));
    ex.setGenre('rock');
    ex.loadMore();
    vi.useFakeTimers();
    ex.setQuery('station');
    ex.resetExplore();
    vi.advanceTimersByTime(500);
    const s = ex.exploreStore.get();
    expect(s.query).toBe('');
    expect(s.genre).toBe('all');
    expect(s.results).toHaveLength(200);
    expect(s.visibleCount).toBe(150);
  });
});

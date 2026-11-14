import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Catalog = typeof import('./catalog');

const GOOD = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Station ${id}`,
  streamUrl: `https://stream.test/${id}`,
  homepage: null,
  favicon: null,
  stateCode: 'TX',
  city: 'Austin',
  tags: ['jazz'],
  genres: ['jazz'],
  codec: 'MP3',
  bitrate: 128,
  hls: false,
  lat: 30.27,
  lng: -97.74,
  clickCount: 3,
  ...extra,
});

function doc(stations: unknown[]) {
  return { generatedAt: '2026-11-14T06:00:00.000Z', source: 'radio-browser', count: stations.length, stations };
}

let cat: Catalog;

beforeEach(async () => {
  localStorage.clear();
  vi.resetModules();
  cat = await import('./catalog');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('parseCatalog', () => {
  it('skips bad records and keeps the good ones, in file order', () => {
    const out = cat.parseCatalog(
      doc([
        GOOD('station-0001'),
        { id: 'short', name: 'x', streamUrl: 'https://s/x' },
        GOOD('station-0002', { streamUrl: 'http://insecure.test/a' }),
        'junk',
        null,
        GOOD('station-0003', { name: '   ' }),
        GOOD('station-0004', { lat: undefined, lng: undefined }),
      ]),
    );
    expect(out?.stations.map((s) => s.id)).toEqual(['station-0001', 'station-0004']);
    expect(out?.stations[1].coords).toBeNull();
    expect(out?.stations[0].coords).toEqual({ lat: 30.27, lng: -97.74 });
  });

  it('removes repeated ids, keeping the first', () => {
    const out = cat.parseCatalog(doc([GOOD('station-0001', { name: 'First' }), GOOD('station-0001', { name: 'Second' })]));
    expect(out?.stations).toHaveLength(1);
    expect(out?.stations[0].name).toBe('First');
  });

  it('reads the build time, or null when it is not a date', () => {
    expect(cat.parseCatalog(doc([]))?.generatedAt).toBe('2026-11-14T06:00:00.000Z');
    expect(cat.parseCatalog({ stations: [], generatedAt: 'yesterday' })?.generatedAt).toBeNull();
  });

  it('returns null when there is no stations array', () => {
    expect(cat.parseCatalog(null)).toBeNull();
    expect(cat.parseCatalog({ generatedAt: 'x' })).toBeNull();
    expect(cat.parseCatalog({ stations: 'nope' })).toBeNull();
  });
});

describe('initCatalog', () => {
  it('loads the catalogue from the app base path, once', async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(
      async () => new Response(JSON.stringify(doc([GOOD('station-0001')]))),
    );
    vi.stubGlobal('fetch', fetchMock);
    cat.initCatalog();
    cat.initCatalog();
    await vi.waitFor(() => expect(cat.catalogStore.get().status).toBe('ready'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/catalog\.json$/);
    expect(cat.catalogStore.get().stations.map((s) => s.id)).toEqual(['station-0001']);
    expect(cat.catalogStore.get().generatedAt).toBe('2026-11-14T06:00:00.000Z');
  });

  it('turns a network failure into an error, and retry loads the catalogue', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(new Response(JSON.stringify(doc([GOOD('station-0001')]))));
    vi.stubGlobal('fetch', fetchMock);
    cat.initCatalog();
    await vi.waitFor(() => expect(cat.catalogStore.get().status).toBe('error'));
    expect(cat.catalogStore.get().error).toBe(cat.CATALOG_ERROR);
    expect(cat.catalogStore.get().stations).toEqual([]);

    cat.retryCatalog();
    expect(cat.catalogStore.get().status).toBe('loading');
    await vi.waitFor(() => expect(cat.catalogStore.get().status).toBe('ready'));
    expect(cat.catalogStore.get().error).toBeNull();
    expect(cat.catalogStore.get().stations).toHaveLength(1);
  });

  it('treats an HTTP error as a failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    cat.initCatalog();
    await vi.waitFor(() => expect(cat.catalogStore.get().status).toBe('error'));
  });

  it('treats an unreadable document as a failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"stations": 3}')));
    cat.initCatalog();
    await vi.waitFor(() => expect(cat.catalogStore.get().status).toBe('error'));
    expect(cat.catalogStore.get().error).toBe(cat.CATALOG_ERROR);
  });
});

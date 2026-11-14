import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const OLD_FAV = 'signalsurf:favorites:v1';
const OLD_HIST = 'signalsurf:history:v1';
const OLD_SET = 'signalsurf:settings:v1';
const NEW_FAV = 'roadtrip:favorites:v1';
const NEW_HIST = 'roadtrip:history:v1';
const NEW_SET = 'roadtrip:settings:v1';

const CATALOG_ID = 'a1b2c3d4-0000-4000-8000-00000000c0de';
const OTHER_ID = 'f00dfeed-0000-4000-8000-00000000beef';

/** A snapshot as SignalSurf wrote it: region and country, no stateCode, categories. */
function legacy(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Old ${id.slice(0, 4)}`,
    streamUrl: `https://stream.test/${id}`,
    homepage: null,
    favicon: null,
    country: 'Norway',
    countryCode: 'NO',
    region: 'Oslo',
    tags: ['jazz'],
    categories: ['music'],
    codec: 'MP3',
    bitrate: 128,
    hls: false,
    coords: null,
    lastCheckOk: true,
    lastCheckTime: null,
    clickCount: 4,
    votes: 2,
    ...overrides,
  };
}

const catalogRecord = {
  id: CATALOG_ID,
  name: 'Catalogue Radio',
  streamUrl: 'https://stream.test/catalogue',
  homepage: null,
  favicon: null,
  stateCode: 'TX',
  city: 'Austin',
  tags: ['jazz'],
  genres: ['jazz'],
  codec: 'AAC',
  bitrate: 64,
  hls: false,
  lat: 30.27,
  lng: -97.74,
  clickCount: 99,
};

/** Loads the catalogue (with the given records) and waits until the migration has run. */
async function runCatalog(records: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ stations: records }))),
  );
  const cat = await import('@/catalog/catalog');
  cat.initCatalog();
  await vi.waitFor(() => expect(cat.catalogStore.get().status).toBe('ready'));
}

async function loadStores() {
  vi.resetModules();
  const favorites = (await import('./favorites')).favorites;
  const history = (await import('./history')).history;
  const settings = (await import('./settings')).settings;
  return { favorites, history, settings };
}

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('legacy storage migration', () => {
  it('moves old favourites, history and settings to the new keys and removes the old keys', async () => {
    localStorage.setItem(OLD_FAV, JSON.stringify([legacy(OTHER_ID)]));
    localStorage.setItem(
      OLD_HIST,
      JSON.stringify([{ station: legacy(OTHER_ID), playedAt: 1_700_000_000_000 }]),
    );
    localStorage.setItem(OLD_SET, JSON.stringify({ defaultVolume: 0.4 }));

    const { favorites, history, settings } = await loadStores();
    await runCatalog([]);

    expect(localStorage.getItem(OLD_FAV)).toBeNull();
    expect(localStorage.getItem(OLD_HIST)).toBeNull();
    expect(localStorage.getItem(NEW_HIST)).not.toBeNull();
    expect(localStorage.getItem(OLD_SET)).toBeNull();
    expect(localStorage.getItem(NEW_SET)).not.toBeNull();
    expect(settings.get().defaultVolume).toBe(0.4);
    expect(history.list()).toHaveLength(1);
    expect(history.list()[0].playedAt).toBe(1_700_000_000_000);
    expect(favorites.list()).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(NEW_FAV) ?? '[]')).toHaveLength(1);
  });

  it('replaces an old snapshot with the catalogue record when the id is in the catalogue', async () => {
    localStorage.setItem(OLD_FAV, JSON.stringify([legacy(CATALOG_ID)]));
    const { favorites } = await loadStores();
    await runCatalog([catalogRecord]);

    const [fav] = favorites.list();
    expect(fav.name).toBe('Catalogue Radio');
    expect(fav.stateCode).toBe('TX');
    expect(fav.city).toBe('Austin');
    expect(fav.coords).toEqual({ lat: 30.27, lng: -97.74 });
  });

  it('keeps a non-catalogue favourite playable, with no invented location', async () => {
    localStorage.setItem(OLD_FAV, JSON.stringify([legacy(OTHER_ID)]));
    const { favorites } = await loadStores();
    await runCatalog([catalogRecord]);

    const [fav] = favorites.list();
    expect(fav.id).toBe(OTHER_ID);
    expect(fav.streamUrl).toBe(`https://stream.test/${OTHER_ID}`);
    expect(fav.stateCode).toBeNull();
    expect(fav.city).toBeNull();
    expect(fav.genres).toEqual([]);
    expect(fav).not.toHaveProperty('region');
    expect(fav).not.toHaveProperty('country');
  });

  it('does nothing when no old keys exist', async () => {
    const { favorites, history, settings } = await loadStores();
    await runCatalog([catalogRecord]);
    expect(favorites.list()).toEqual([]);
    expect(history.list()).toEqual([]);
    expect(settings.get().defaultVolume).toBe(0.75);
    expect(localStorage.getItem(NEW_FAV)).toBeNull();
    expect(localStorage.getItem(NEW_SET)).toBeNull();
  });

  it('removes corrupt old values without using them or crashing', async () => {
    localStorage.setItem(OLD_FAV, '{not json');
    localStorage.setItem(OLD_SET, '[broken');
    const { favorites, settings } = await loadStores();
    await runCatalog([]);
    expect(favorites.list()).toEqual([]);
    expect(settings.get().defaultVolume).toBe(0.75);
    expect(localStorage.getItem(OLD_FAV)).toBeNull();
    expect(localStorage.getItem(OLD_SET)).toBeNull();
    expect(localStorage.getItem(NEW_FAV)).toBeNull();
  });

  it('keeps the new settings when the new key already exists, but still moves the old favourites', async () => {
    localStorage.setItem(NEW_SET, JSON.stringify({ defaultVolume: 0.9 }));
    localStorage.setItem(OLD_SET, JSON.stringify({ defaultVolume: 0.1 }));
    localStorage.setItem(OLD_FAV, JSON.stringify([legacy(OTHER_ID)]));
    const { favorites, settings } = await loadStores();
    await runCatalog([]);
    expect(settings.get().defaultVolume).toBe(0.9);
    expect(localStorage.getItem(OLD_SET)).toBeNull();
    expect(favorites.list().map((s) => s.id)).toEqual([OTHER_ID]);
  });

  it('runs at most once per session', async () => {
    localStorage.setItem(OLD_FAV, JSON.stringify([legacy(OTHER_ID)]));
    const { favorites } = await loadStores();
    await runCatalog([]);
    localStorage.setItem(OLD_FAV, JSON.stringify([legacy('0000aaaa-0000-4000-8000-000000000001')]));
    const { migrateLegacyStorage } = await import('./migrate');
    migrateLegacyStorage([]);
    expect(favorites.list().map((s) => s.id)).toEqual([OTHER_ID]);
    expect(localStorage.getItem(OLD_FAV)).not.toBeNull();
  });
});

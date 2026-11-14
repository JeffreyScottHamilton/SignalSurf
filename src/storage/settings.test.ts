import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'roadtrip:settings:v1';

async function loadSettings() {
  vi.resetModules();
  return import('./settings');
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('settings', () => {
  it('defaults the volume to 0.75 when nothing is stored', async () => {
    const { settings } = await loadSettings();
    expect(settings.get()).toEqual({ defaultVolume: 0.75 });
  });

  it('stores a new volume and reads it back after re-hydration', async () => {
    const first = await loadSettings();
    first.settings.setDefaultVolume(0.4);
    expect(first.settings.get().defaultVolume).toBe(0.4);

    const second = await loadSettings();
    expect(second.settings.get().defaultVolume).toBe(0.4);
  });

  it('clamps out-of-range volumes and ignores non-finite ones', async () => {
    const { settings } = await loadSettings();

    settings.setDefaultVolume(2);
    expect(settings.get().defaultVolume).toBe(1);

    settings.setDefaultVolume(-1);
    expect(settings.get().defaultVolume).toBe(0);

    settings.setDefaultVolume(0.5);
    settings.setDefaultVolume(Number.NaN);
    expect(settings.get().defaultVolume).toBe(0.5);
  });

  it('falls back to the default for corrupt stored values', async () => {
    localStorage.setItem(KEY, JSON.stringify({ defaultVolume: 'loud' }));
    expect((await loadSettings()).settings.get().defaultVolume).toBe(0.75);

    localStorage.setItem(KEY, '{broken');
    expect((await loadSettings()).settings.get().defaultVolume).toBe(0.75);

    localStorage.setItem(KEY, JSON.stringify([1, 2]));
    expect((await loadSettings()).settings.get().defaultVolume).toBe(0.75);
  });

  it('clamps an out-of-range stored value on read', async () => {
    localStorage.setItem(KEY, JSON.stringify({ defaultVolume: 9 }));
    expect((await loadSettings()).settings.get().defaultVolume).toBe(1);
  });
});

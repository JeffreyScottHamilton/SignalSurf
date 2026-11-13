import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readJSON, removeKey, storageAvailable, writeJSON } from './safeStorage';

const KEY = 'signalsurf:test:v1';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('storageAvailable', () => {
  it('is true when localStorage works', () => {
    expect(storageAvailable()).toBe(true);
  });

  it('is false when setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });
    expect(storageAvailable()).toBe(false);
  });
});

describe('readJSON / writeJSON', () => {
  it('round-trips a value', () => {
    expect(writeJSON(KEY, { a: [1, 2] })).toBe(true);
    expect(readJSON(KEY, null)).toEqual({ a: [1, 2] });
  });

  it('returns the fallback when the key is missing', () => {
    expect(readJSON<string[]>(KEY, [])).toEqual([]);
  });

  it('returns the fallback when stored JSON is corrupt and never throws', () => {
    localStorage.setItem(KEY, '{not valid json');
    expect(readJSON(KEY, { ok: false })).toEqual({ ok: false });
  });

  it('returns false instead of throwing when setItem fails', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(writeJSON(KEY, { a: 1 })).toBe(false);
  });
});

describe('removeKey', () => {
  it('removes a stored key', () => {
    localStorage.setItem(KEY, '1');
    removeKey(KEY);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('does not throw when removeItem fails', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(() => removeKey(KEY)).not.toThrow();
  });
});

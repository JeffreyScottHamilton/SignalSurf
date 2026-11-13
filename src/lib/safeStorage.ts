/**
 * The only module allowed to touch localStorage. Every function is safe to call
 * when storage is blocked, full, or holds corrupt JSON.
 */

const PROBE_KEY = 'signalsurf:probe';

export function storageAvailable(): boolean {
  try {
    const ls = globalThis.localStorage;
    ls.setItem(PROBE_KEY, '1');
    ls.removeItem(PROBE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = globalThis.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJSON(key: string, value: unknown): boolean {
  try {
    globalThis.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string): void {
  try {
    globalThis.localStorage.removeItem(key);
  } catch {
    // Storage unavailable: nothing persisted, nothing to remove.
  }
}

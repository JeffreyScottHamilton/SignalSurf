import { createStore, type Store } from '@/lib/createStore';
import { readJSON, writeJSON } from '@/lib/safeStorage';
import type { Station } from '@/types';

/** Shape check for a stored station snapshot. Corrupt entries are dropped, never thrown. */
export function isStationSnapshot(v: unknown): v is Station {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.name === 'string' && typeof o.streamUrl === 'string';
}

export interface Persisted<T> {
  store: Store<T>;
  /** Updates memory first, then writes through. A failed write keeps the in-memory state. */
  commit(next: T): void;
}

/**
 * Hydrates a store from one localStorage key, writes every commit back, and
 * re-reads the key when another tab changes it.
 */
export function createPersisted<T>(key: string, parse: (raw: unknown) => T): Persisted<T> {
  const store = createStore<T>(parse(readJSON<unknown>(key, null)));

  const commit = (next: T): void => {
    store.set(next);
    writeJSON(key, next);
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      // e.key is null when another tab cleared all of localStorage.
      if (e.key === key || e.key === null) store.set(parse(readJSON<unknown>(key, null)));
    });
  }

  return { store, commit };
}

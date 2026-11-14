import { createStore, type Store } from '@/lib/createStore';
import { readJSON, writeJSON } from '@/lib/safeStorage';

export interface Persisted<T> {
  store: Store<T>;
  /** Updates memory first, then writes through. A failed write keeps the in-memory state. */
  commit(next: T): void;
}

export interface StorageHealth {
  /** True once any write-through has failed in this session. */
  writeFailed: boolean;
}

/** Session-wide write health, read by the settings notice. */
export const storageHealth: Store<StorageHealth> = createStore<StorageHealth>({ writeFailed: false });

/**
 * Hydrates a store from one localStorage key, writes every commit back, and
 * re-reads the key when another tab changes it.
 */
export function createPersisted<T>(key: string, parse: (raw: unknown) => T): Persisted<T> {
  const store = createStore<T>(parse(readJSON<unknown>(key, null)));

  const commit = (next: T): void => {
    store.set(next);
    if (!writeJSON(key, next) && !storageHealth.get().writeFailed) storageHealth.set({ writeFailed: true });
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      // e.key is null when another tab cleared all of localStorage.
      if (e.key === key || e.key === null) store.set(parse(readJSON<unknown>(key, null)));
    });
  }

  return { store, commit };
}

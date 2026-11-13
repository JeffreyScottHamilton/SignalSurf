import { useSyncExternalStore } from 'react';

export interface Store<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(fn: () => void): () => void;
}

/** Minimal observable store. `set` always notifies subscribers. */
export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();

  return {
    get: () => state,
    set(next) {
      state = typeof next === 'function' ? (next as (prev: T) => T)(state) : next;
      for (const fn of [...listeners]) fn();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

/**
 * Subscribes a component to a store. A selector must return a stable value
 * (same reference while the slice is unchanged), otherwise React re-renders forever.
 */
export function useStore<T, S = T>(store: Store<T>, selector?: (s: T) => S): S {
  const select = selector ?? ((s: T) => s as unknown as S);
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}

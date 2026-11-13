// STUB — replaced by slice S5
import { createStore, useStore } from '@/lib/createStore';
import type { Station } from '@/types';

const store = createStore<Station[]>([]);

export const favorites: {
  list(): Station[];
  has(id: string): boolean;
  toggle(s: Station): void;
  remove(id: string): void;
  clear(): void;
} = {
  list: () => store.get(),
  has: (id) => store.get().some((s) => s.id === id),
  toggle(s) {
    void s;
  },
  remove(id) {
    void id;
  },
  clear() {},
};

export function useFavorites(): Station[] {
  return useStore(store);
}

export function useIsFavorite(id: string | undefined): boolean {
  return useStore(store, (list) => id !== undefined && list.some((s) => s.id === id));
}

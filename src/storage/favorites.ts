import { useStore } from '@/lib/createStore';
import { sanitizeStation } from '@/catalog/sanitize';
import type { Station } from '@/types';
import { createPersisted } from './persisted';

export const FAVORITES_KEY = 'roadtrip:favorites:v1';

/** Newest first. Corrupt entries and duplicate ids are dropped. */
function parseFavorites(raw: unknown): Station[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Station[] = [];
  for (const item of raw) {
    const s = sanitizeStation(item);
    if (s === null || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

const { store, commit } = createPersisted<Station[]>(FAVORITES_KEY, parseFavorites);

/** Adds legacy favourites after the current ones (duplicates dropped). Used by the one-time migration. */
export function absorbLegacyFavorites(raw: unknown[]): void {
  commit(parseFavorites([...store.get(), ...raw]));
}

export interface FavoritesApi {
  list(): Station[];
  has(id: string): boolean;
  toggle(s: Station): void;
  remove(id: string): void;
  clear(): void;
}

export const favorites: FavoritesApi = {
  list: () => store.get(),
  has: (id) => store.get().some((s) => s.id === id),
  toggle(s) {
    const current = store.get();
    if (current.some((x) => x.id === s.id)) {
      commit(current.filter((x) => x.id !== s.id));
    } else {
      commit([s, ...current]);
    }
  },
  remove(id) {
    const current = store.get();
    if (current.some((x) => x.id === id)) commit(current.filter((x) => x.id !== id));
  },
  clear() {
    if (store.get().length > 0) commit([]);
  },
};

export function useFavorites(): Station[] {
  return useStore(store);
}

export function useIsFavorite(id: string | undefined): boolean {
  return useStore(store, (list) => id !== undefined && list.some((s) => s.id === id));
}

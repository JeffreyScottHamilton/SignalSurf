// STUB — replaced by slice S5
import { createStore, useStore } from '@/lib/createStore';
import type { HistoryEntry, Station } from '@/types';

const store = createStore<HistoryEntry[]>([]);

export const history: {
  list(): HistoryEntry[];
  add(s: Station, at?: number): void;
  clear(): void;
} = {
  list: () => store.get(),
  add(s, at) {
    void s;
    void at;
  },
  clear() {},
};

export function useHistory(): HistoryEntry[] {
  return useStore(store);
}

// STUB — replaced by slice S1
import { createStore, type Store } from '@/lib/createStore';
import type { Category, LoadStatus, Station } from '@/types';

export interface ExploreState {
  query: string;
  category: Category;
  results: Station[];
  status: LoadStatus;
  error: string | null;
}

export const exploreStore: Store<ExploreState> = createStore<ExploreState>({
  query: '',
  category: 'all',
  results: [],
  status: 'idle',
  error: null,
});

export function setQuery(q: string): void {
  void q;
}

export function setCategory(c: Category): void {
  void c;
}

export function resetExplore(): void {}

export function retryExplore(): void {}

export function initExplore(): void {}

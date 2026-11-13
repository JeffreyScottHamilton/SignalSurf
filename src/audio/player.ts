// STUB — replaced by slice S4
import { createStore, useStore } from '@/lib/createStore';
import type { PlayerState, Station } from '@/types';

const store = createStore<PlayerState>({
  station: null,
  status: 'idle',
  error: null,
  volume: 0.75,
  muted: false,
  hasPrev: false,
  hasNext: false,
});

export const player: {
  getState(): PlayerState;
  subscribe(fn: () => void): () => void;
  play(station: Station, queue?: Station[]): void;
  toggle(): void;
  pause(): void;
  retry(): void;
  next(): void;
  prev(): void;
  setVolume(v: number): void;
  toggleMute(): void;
  onStarted(fn: (s: Station) => void): () => void;
} = {
  getState: () => store.get(),
  subscribe: (fn) => store.subscribe(fn),
  play(station, queue) {
    void station;
    void queue;
  },
  toggle() {},
  pause() {},
  retry() {},
  next() {},
  prev() {},
  setVolume(v) {
    void v;
  },
  toggleMute() {},
  onStarted(fn) {
    void fn;
    return () => {};
  },
};

export function usePlayer(): PlayerState {
  return useStore(store);
}

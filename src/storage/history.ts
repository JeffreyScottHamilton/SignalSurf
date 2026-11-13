import { useStore } from '@/lib/createStore';
import type { HistoryEntry, Station } from '@/types';
import { createPersisted, isStationSnapshot } from './persisted';

export const HISTORY_KEY = 'signalsurf:history:v1';
export const HISTORY_LIMIT = 50;

/** Newest first, one entry per station id. Corrupt entries are dropped. */
function parseHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: HistoryEntry[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const { station, playedAt } = item as { station?: unknown; playedAt?: unknown };
    if (!isStationSnapshot(station)) continue;
    if (typeof playedAt !== 'number' || !Number.isFinite(playedAt)) continue;
    if (seen.has(station.id)) continue;
    seen.add(station.id);
    out.push({ station, playedAt });
    if (out.length >= HISTORY_LIMIT) break;
  }
  return out;
}

const { store, commit } = createPersisted<HistoryEntry[]>(HISTORY_KEY, parseHistory);

export const history: {
  list(): HistoryEntry[];
  add(s: Station, at?: number): void;
  clear(): void;
} = {
  list: () => store.get(),
  add(s, at = Date.now()) {
    if (!Number.isFinite(at)) return;
    const others = store.get().filter((e) => e.station.id !== s.id);
    commit([{ station: s, playedAt: at }, ...others].slice(0, HISTORY_LIMIT));
  },
  clear() {
    if (store.get().length > 0) commit([]);
  },
};

export function useHistory(): HistoryEntry[] {
  return useStore(store);
}

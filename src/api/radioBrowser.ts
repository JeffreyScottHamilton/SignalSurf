// STUB — replaced by slice S1
import type { Category, Coords, Station } from '@/types';

export class RadioApiError extends Error {
  kind: 'network' | 'http' | 'parse' | 'aborted';

  constructor(kind: 'network' | 'http' | 'parse' | 'aborted', message: string) {
    super(message);
    this.name = 'RadioApiError';
    this.kind = kind;
  }
}

export function searchStations(
  p: { query: string; category: Category; limit?: number },
  signal?: AbortSignal,
): Promise<Station[]> {
  void p;
  void signal;
  return Promise.resolve([]);
}

export function fetchMapStations(signal?: AbortSignal): Promise<Station[]> {
  void signal;
  return Promise.resolve([]);
}

export function fetchStationsNear(
  c: Coords,
  radiusKm: number,
  limit?: number,
  signal?: AbortSignal,
): Promise<Station[]> {
  void c;
  void radiusKm;
  void limit;
  void signal;
  return Promise.resolve([]);
}

export function reportClick(stationId: string): void {
  void stationId;
}

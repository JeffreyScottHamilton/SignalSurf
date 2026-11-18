// Types for the plain-JS curated-stations module (src/catalog/curated.mjs).
import type { CatalogRecord, DropReason, NormalizeResult } from './rules.mjs';

export declare const CURATED_ID_RE: RegExp;

/** One entry of data/curated-stations.json, as written by hand. */
export interface CuratedEntry {
  id: string;
  name: string;
  streamUrl: string;
  homepage?: string | null;
  favicon?: string | null;
  state: string;
  city?: string | null;
  tags: string[];
  codec?: string | null;
  bitrate?: number | null;
  lat: number;
  lng: number;
  source: string;
  verified: string;
  coordsSource: string;
}

export declare function streamKey(url: string): string;
export declare function checkCuratedEntry(e: unknown): string[];
export declare function parseCurated(doc: unknown): { stations: CuratedEntry[]; errors: string[] };
export declare function curatedToRaw(e: CuratedEntry): Record<string, unknown>;
export declare function curatedRecords(
  entries: readonly CuratedEntry[],
  polygonState?: ((lng: number, lat: number) => string | null) | null,
): { entry: CuratedEntry; result: NormalizeResult }[];
export declare function radioBrowserStreamKeys(rows: readonly unknown[]): Set<string>;
export declare function mergeCurated(
  radioStations: CatalogRecord[],
  curated: { entry: CuratedEntry; result: NormalizeResult }[],
  radioStreamKeys: ReadonlySet<string>,
): { stations: CatalogRecord[]; added: number; skipped: string[]; dropped: Partial<Record<DropReason, number>> };

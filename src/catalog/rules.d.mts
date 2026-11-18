// Types for the plain-JS shared catalogue rules (src/catalog/rules.mjs).

export declare const GENRES: readonly ['rock', 'country', 'pop', 'hiphop', 'jazz', 'classical', 'electronic', 'oldies', 'latin', 'christian', 'indie', 'folk'];
export type GenreId = (typeof GENRES)[number];
export declare const GENRE_LABELS: Record<GenreId, string>;
export declare const HARD_EXCLUDES: readonly string[];
export declare const GENERIC_MUSIC_TAGS: readonly string[];
export declare const STATE_BY_FIPS: Record<string, string>;
export declare const STATE_NAMES: Record<string, string>;
export declare const US_BOXES: ReadonlyArray<readonly [number, number, number, number]>;

export type DropReason = 'untagged' | 'hard-exclude' | 'no-genre' | 'junk' | 'non-https';

export declare function foldTag(text: string): string;
export declare function classifyStation(tags: readonly string[], name?: string): { reason: DropReason | null; genres: GenreId[] };
export declare function classifyDetailed(tags: readonly string[], name?: string): { reason: DropReason | null; genres: GenreId[]; by: 'tags' | 'name' | 'uncategorized' | null };
export declare function nameGenres(name: string): { genres: GenreId[]; hard: boolean };
export declare function parseStateText(raw: unknown): { code: string | null; city: string | null };
export declare function stateFromIso(iso: unknown): string | null;
export declare function inUsBox(lat: number, lng: number): boolean;
export declare function inPolygon(lng: number, lat: number, rings: number[][][]): boolean;
export declare function stateAtPoint(lng: number, lat: number, shapes: { code: string; polygons: number[][][][] }[]): string | null;

export interface CatalogRecord {
  id: string;
  name: string;
  streamUrl: string;
  homepage: string | null;
  favicon: string | null;
  stateCode: string | null;
  city: string | null;
  tags: string[];
  genres: GenreId[];
  codec: string | null;
  bitrate: number | null;
  hls: boolean;
  lat?: number;
  lng?: number;
  uncategorized?: boolean;
  clickCount: number;
}
export type NormalizeResult =
  | { reason: DropReason }
  | { station: CatalogRecord; reason: null; by: 'tags' | 'name' | 'uncategorized' | null; stateSource: 'iso' | 'name' | 'polygon' | 'null'; coordsDropped: boolean; upgraded: { stream: boolean; favicon: boolean } };
export declare function normalizeRaw(raw: unknown, polygonState?: ((lng: number, lat: number) => string | null) | null, httpsKeys?: ReadonlySet<string> | null): NormalizeResult;
export declare function httpsHostKeys(rawRows: readonly unknown[]): Set<string>;
export declare function upgradeHttpUrl(url: unknown, httpsKeys: ReadonlySet<string> | null): string | null;
export declare function parseTags(v: unknown): string[];
export declare function dedupeCatalog<T extends { id: string; streamUrl: string }>(list: T[]): T[];
export declare const CATALOG_KEYS: Record<string, string>;
export declare function expandCatalogRecord<T>(rec: T): T;

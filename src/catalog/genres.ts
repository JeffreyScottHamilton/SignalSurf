import type { Genre, GenreFilter } from '@/types';
// The genre ids, labels and state names come from the shared rules module, so the build script and the app agree.
import { GENRE_LABELS, GENRES, STATE_NAMES } from './rules.mjs';

/** Genre ids in display order. */
export const GENRE_ORDER: readonly Genre[] = GENRES;

export const GENRE_LABEL: Readonly<Record<Genre, string>> = GENRE_LABELS;

/** Filter choices: All first, then the genres. */
export const GENRE_FILTERS: readonly GenreFilter[] = ['all', ...GENRES];

/** Full English name for a two-letter state or territory code, or null when unknown. */
export function stateName(code: string | null | undefined): string | null {
  if (typeof code !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(STATE_NAMES, code) ? STATE_NAMES[code] : null;
}

export function isStateCode(v: unknown): v is string {
  return typeof v === 'string' && stateName(v) !== null;
}

export function isGenre(v: unknown): v is Genre {
  return typeof v === 'string' && (GENRES as readonly string[]).includes(v);
}

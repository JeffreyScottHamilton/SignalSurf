import type { GenreFilter, Station } from '@/types';
import { GENRE_LABEL, stateName } from './genres';

export interface StationQuery {
  query: string;
  genre: GenreFilter;
}

/** Lower-case text a term is matched against: name, city, state name, tags and genre ids and labels. The state code is matched exactly. */
function fieldsOf(s: Station): string[] {
  const out = [s.name, s.city ?? '', stateName(s.stateCode) ?? '', ...s.tags];
  for (const g of s.genres) out.push(g, GENRE_LABEL[g]);
  return out.map((f) => f.toLowerCase());
}

function matches(fields: readonly string[], stateCode: string | null, term: string): boolean {
  if (stateCode !== null && stateCode.toLowerCase() === term) return true;
  return fields.some((f) => f.includes(term));
}

/**
 * Stations matching the query and genre, most popular first.
 * The query is trimmed and case-insensitive. Every whitespace-separated term must match one field
 * (name, city, state name or code, tag, genre). A multi-word phrase also matches when it is a
 * whole state name or city ("new york"). A blank query and the "all" genre return everything.
 */
export function filterStations(stations: readonly Station[], { query, genre }: StationQuery): Station[] {
  const phrase = query.trim().toLowerCase();
  // Terms made only of punctuation ("&", "-") are ignored.
  const terms = phrase.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t));
  const out = stations.filter((s) => {
    if (genre !== 'all' && !s.genres.includes(genre)) return false;
    if (terms.length === 0) return true;
    const fields = fieldsOf(s);
    if (terms.every((t) => matches(fields, s.stateCode, t))) return true;
    return terms.length > 1 && fields.some((f) => f.includes(phrase));
  });
  return out.sort((a, b) => b.clickCount - a.clickCount);
}

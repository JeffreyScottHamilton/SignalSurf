import type { Category, StationCategory } from '@/types';

export const CATEGORY_LABELS: Record<Category, string> = {
  all: 'All',
  music: 'Music',
  news: 'News',
  talk: 'Talk',
  sports: 'Sports',
};

export const CATEGORY_ORDER: Category[] = ['all', 'music', 'news', 'talk', 'sports'];

/** Output order of classifyTags (same as CATEGORY_ORDER without 'all'). */
const STATION_ORDER: StationCategory[] = ['music', 'news', 'talk', 'sports'];

/**
 * Keyword lists per category. A keyword matches when it equals a whole tag or
 * appears as whole words inside a tag ("sports news" hits sports and news;
 * "transport" does not hit sports). Written in plain ASCII; tags are folded
 * (accents removed, punctuation to spaces) before matching.
 */
const KEYWORDS: Record<StationCategory, readonly string[]> = {
  music: [
    'music', 'musica', 'musik', 'pop', 'rock', 'jazz', 'classical', 'hits', 'top 40',
    'dance', 'electronic', 'hip hop', 'rap', 'country', 'oldies', '70s', '80s', '90s',
    'indie', 'metal', 'folk', 'latin', 'reggae', 'blues', 'soul', 'techno', 'house',
    'ambient', 'lounge', 'trance', 'edm', 'rnb',
  ],
  news: [
    'news', 'nachrichten', 'noticias', 'noticia', 'notizie', 'info', 'information',
    'actualite', 'actualites', 'nouvelles', 'headlines',
  ],
  talk: [
    'talk', 'spoken', 'spoken word', 'discussion', 'comedy', 'culture', 'public radio',
    'politics', 'politik', 'debate', 'interview',
  ],
  sports: [
    'sport', 'sports', 'football', 'soccer', 'deportes', 'deporte', 'futbol', 'fussball',
    'nfl', 'nba', 'mlb', 'nhl', 'baseball', 'basketball', 'hockey', 'tennis', 'cricket',
  ],
};

/** Folds a tag for matching: lower case, no accents, punctuation becomes single spaces. */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+]+/gu, ' ')
    .trim();
}

const pad = (list: readonly string[]): string[] => list.map((k) => ` ${fold(k)} `);

const PADDED: Record<StationCategory, readonly string[]> = {
  music: pad(KEYWORDS.music),
  news: pad(KEYWORDS.news),
  talk: pad(KEYWORDS.talk),
  sports: pad(KEYWORDS.sports),
};

/** Maps raw Radio Browser tags to zero or more station categories. */
export function classifyTags(tags: string[]): StationCategory[] {
  const folded: string[] = [];
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    const f = fold(tag);
    if (f) folded.push(` ${f} `);
  }
  if (folded.length === 0) return [];
  return STATION_ORDER.filter((cat) =>
    PADDED[cat].some((kw) => folded.some((tag) => tag.includes(kw))),
  );
}

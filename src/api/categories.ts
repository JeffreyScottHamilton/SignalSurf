// STUB — replaced by slice S1
import type { Category, StationCategory } from '@/types';

export function classifyTags(tags: string[]): StationCategory[] {
  void tags;
  return [];
}

export const CATEGORY_LABELS: Record<Category, string> = {
  all: 'All',
  music: 'Music',
  news: 'News',
  talk: 'Talk',
  sports: 'Sports',
};

export const CATEGORY_ORDER: Category[] = ['all', 'music', 'news', 'talk', 'sports'];

import { describe, expect, it } from 'vitest';
import { CATEGORY_LABELS, CATEGORY_ORDER, classifyTags } from './categories';

describe('classifyTags', () => {
  it('maps news tags', () => {
    expect(classifyTags(['news'])).toEqual(['news']);
    expect(classifyTags(['nachrichten'])).toEqual(['news']);
    expect(classifyTags(['actualité'])).toEqual(['news']);
  });

  it('maps talk tags', () => {
    expect(classifyTags(['talk'])).toEqual(['talk']);
    expect(classifyTags(['public radio'])).toEqual(['talk']);
    expect(classifyTags(['comedy'])).toEqual(['talk']);
  });

  it('maps sports tags', () => {
    expect(classifyTags(['sport'])).toEqual(['sports']);
    expect(classifyTags(['deportes'])).toEqual(['sports']);
    expect(classifyTags(['nfl'])).toEqual(['sports']);
  });

  it('maps music genres', () => {
    expect(classifyTags(['jazz'])).toEqual(['music']);
    expect(classifyTags(['hip-hop'])).toEqual(['music']);
    expect(classifyTags(['top 40'])).toEqual(['music']);
    expect(classifyTags(['80s'])).toEqual(['music']);
  });

  it('returns several categories for a station that spans them', () => {
    expect(classifyTags(['jazz', 'news', 'talk'])).toEqual(['music', 'news', 'talk']);
    expect(classifyTags(['sports news'])).toEqual(['news', 'sports']);
  });

  it('does not match a keyword inside another word', () => {
    expect(classifyTags(['transport'])).toEqual([]);
    expect(classifyTags(['transporter radio'])).toEqual([]);
  });

  it('returns an empty list for no tags or no match', () => {
    expect(classifyTags([])).toEqual([]);
    expect(classifyTags(['', '   '])).toEqual([]);
    expect(classifyTags(['regional', 'german'])).toEqual([]);
  });
});

describe('category constants', () => {
  it('lists every category in order with a label', () => {
    expect(CATEGORY_ORDER).toEqual(['all', 'music', 'news', 'talk', 'sports']);
    for (const c of CATEGORY_ORDER) expect(CATEGORY_LABELS[c]).toBeTruthy();
  });
});

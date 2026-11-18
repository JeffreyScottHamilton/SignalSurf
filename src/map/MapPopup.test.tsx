// The station details card (map popup) links the Wikipedia article for a discovered station (CC BY-SA attribution).
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Station } from '@/types';
import { MapPopupCard } from './MapPopup';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const base: Station = {
  id: 'fcc:11238',
  name: 'KUBL 93.3 The Bull',
  streamUrl: 'https://playerservices.streamtheworld.com/api/livestream-redirect/KUBLFMAAC.aac',
  homepage: 'https://www.933thebull.com',
  favicon: null,
  stateCode: 'UT',
  city: 'Salt Lake City',
  tags: ['country'],
  genres: ['country'],
  codec: null,
  bitrate: null,
  hls: false,
  coords: { lat: 40.6, lng: -111.9 },
  clickCount: 0,
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('station details card: Wikipedia format link', () => {
  it('links the article with the Format info label, opened in a new tab', () => {
    act(() => root.render(<MapPopupCard station={{ ...base, wikiTitle: 'KUBL-FM' }} />));
    const link = host.querySelector<HTMLAnchorElement>('a.ss-map-card__format');
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe('Format info: Wikipedia');
    expect(link?.getAttribute('href')).toBe('https://en.wikipedia.org/wiki/KUBL-FM');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('shows no format link for a station without a Wikipedia title', () => {
    act(() => root.render(<MapPopupCard station={base} />));
    expect(host.querySelector('a.ss-map-card__format')).toBeNull();
    expect(host.textContent).not.toContain('Format info');
  });
});

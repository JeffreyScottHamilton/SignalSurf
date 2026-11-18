import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Station } from '@/types';
import { MapPopupCard } from '@/map/MapPopup';
import { StationRow } from './StationRow';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LABEL = 'Genre not listed';

const station: Station = {
  id: 'uncat-1',
  name: '101.5 Kiss FM',
  genres: [],
  uncategorized: true,
  country: 'United States',
  state: 'New York',
  city: 'New York City',
  url: 'https://example.com/stream',
  lat: 40.7,
  lng: -74,
} as unknown as Station;

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

describe('uncategorized stations', () => {
  it('does not show "Genre not listed" in the list row', () => {
    act(() => root.render(<StationRow station={station} onActivate={() => undefined} />));
    expect(host.textContent).not.toContain(LABEL);
    expect(host.querySelector('.ss-station-row__meta')).toBeNull();
  });

  it('still shows "Genre not listed" in the map popup', () => {
    act(() => root.render(<MapPopupCard station={station} />));
    expect(host.textContent).toContain(LABEL);
  });
});

import { useEffect, useRef } from 'react';
import { CATEGORY_LABELS } from '@/api/categories';
import { StationRow } from '@/components/common/StationRow';
import { player, usePlayer } from '@/audio/player';
import { useStore } from '@/lib/createStore';
import { exploreStore, initExplore, resetExplore, retryExplore } from '@/state/explore';
import { selectStation, setSheetOpen, uiStore } from '@/state/ui';
import type { Station } from '@/types';
import './StationList.css';

const SKELETON_ROWS = 6;

/** Scrollable station list with loading, error, empty and ready states. */
export function StationList() {
  const { query, category, results, status, error } = useStore(exploreStore);
  const selectedId = useStore(uiStore, (s) => s.selected?.id ?? null);
  const playback = usePlayer();
  const playingId = playback.status === 'playing' && playback.station ? playback.station.id : null;
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    initExplore();
  }, []);

  // Keep the selected station visible, whether it was picked here or on the map.
  useEffect(() => {
    if (selectedId === null) return;
    scrollRef.current
      ?.querySelector('[aria-current="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedId, results]);

  const busy = status === 'idle' || status === 'loading';

  function activate(s: Station) {
    selectStation(s);
    player.play(s, results);
    setSheetOpen(false);
  }

  let content;
  if (busy) {
    content = (
      <ul className="ss-list__items">
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <li key={i} className="ss-list__item ss-list__skeleton" aria-hidden="true">
            <span className="ss-list__skeleton-logo" />
            <span className="ss-list__skeleton-lines">
              <span className="ss-list__skeleton-line ss-list__skeleton-line--long" />
              <span className="ss-list__skeleton-line" />
            </span>
          </li>
        ))}
      </ul>
    );
  } else if (status === 'error') {
    content = (
      <div className="ss-list__state" role="alert">
        <p className="ss-list__title">{error ?? 'Stations could not be loaded.'}</p>
        <button type="button" className="ss-list__button" onClick={retryExplore}>
          Try again
        </button>
      </div>
    );
  } else if (results.length === 0) {
    content = (
      <div className="ss-list__state">
        <p className="ss-list__title">
          {query ? `No stations match “${query}”` : 'No stations found'}
        </p>
        {category !== 'all' && (
          <p className="ss-list__note">Category: {CATEGORY_LABELS[category]}</p>
        )}
        <button type="button" className="ss-list__button" onClick={resetExplore}>
          Reset search
        </button>
      </div>
    );
  } else {
    content = (
      <ul className="ss-list__items">
        {results.map((s, index) => {
          const selected = selectedId === s.id;
          return (
            <li
              key={s.id}
              className={
                selected
                  ? 'ss-list__item ss-list__item--selected'
                  : index > 0 && results[index - 1].id === selectedId
                    ? 'ss-list__item ss-list__item--after-selected'
                    : 'ss-list__item'
              }
            >
              <StationRow
                station={s}
                selected={selected}
                playing={playingId === s.id}
                onActivate={() => activate(s)}
              />
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="ss-list">
      <div ref={scrollRef} className="ss-list__scroll" aria-busy={busy}>
        {content}
      </div>
      <div className="ss-sr-only" role="status" aria-live="polite">
        {status === 'ready'
          ? results.length === 0
            ? 'No stations found'
            : `${results.length} ${results.length === 1 ? 'station' : 'stations'} found`
          : ''}
      </div>
    </div>
  );
}

import { BookmarkIcon } from '@/components/common/icons';
import { IconButton } from '@/components/common/IconButton';
import { StationRow } from '@/components/common/StationRow';
import { setView } from '@/state/ui';
import { favorites, useFavorites } from '@/storage/favorites';
import { playStation, usePlayingId, useSelectedId } from './viewState';
import './views.css';

export function FavoritesView() {
  const list = useFavorites();
  const selectedId = useSelectedId();
  const playingId = usePlayingId();

  return (
    <section className="ss-view" aria-labelledby="ss-favorites-title">
      <div className="ss-view__head">
        <h2 id="ss-favorites-title" className="ss-view__title">
          Favorites
        </h2>
        <span className="ss-view__count">
          {list.length} {list.length === 1 ? 'station' : 'stations'}
        </span>
      </div>

      {list.length === 0 ? (
        <div className="ss-empty">
          <p className="ss-empty__title">No favorites yet</p>
          <p>Save a station with the bookmark button and it will appear here.</p>
          <button type="button" className="ss-btn ss-btn--primary" onClick={() => setView('explore')}>
            Explore stations
          </button>
        </div>
      ) : (
        <ul className="ss-list">
          {list.map((s) => (
            <li key={s.id} className="ss-view-row">
              <StationRow
                station={s}
                selected={selectedId === s.id}
                playing={playingId === s.id}
                onActivate={() => playStation(s, list)}
              />
              <IconButton
                label="Remove from favorites"
                pressed
                onClick={() => favorites.remove(s.id)}
              >
                <BookmarkIcon filled />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

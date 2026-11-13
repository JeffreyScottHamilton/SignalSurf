import { player, usePlayer } from '@/audio/player';
import { IconButton } from '@/components/common/IconButton';
import { BookmarkIcon, PauseIcon, PlayIcon } from '@/components/common/icons';
import { stationLocation } from '@/lib/format';
import { exploreStore } from '@/state/explore';
import { favorites, useIsFavorite } from '@/storage/favorites';
import type { Station } from '@/types';

/** Compact dark card rendered into the Leaflet popup for one station. */
export function MapPopupCard({ station }: { station: Station }) {
  const state = usePlayer();
  const isFav = useIsFavorite(station.id);
  const isCurrent = state.station?.id === station.id;
  const busy =
    isCurrent && (state.status === 'playing' || state.status === 'buffering' || state.status === 'loading');
  const location = stationLocation(station);

  function onPlay() {
    if (isCurrent) {
      player.toggle();
      return;
    }
    const results = exploreStore.get().results;
    player.play(station, results.some((s) => s.id === station.id) ? results : [station]);
  }

  return (
    <div className="ss-map-card">
      <div className="ss-map-card__head">
        <div className="ss-map-card__text">
          <div className="ss-map-card__name" title={station.name}>
            {station.name}
          </div>
          {location && <div className="ss-map-card__loc">{location}</div>}
        </div>
        <IconButton
          label={isFav ? 'Remove from favorites' : 'Add to favorites'}
          pressed={isFav}
          className="ss-map-card__fav"
          onClick={() => favorites.toggle(station)}
        >
          <BookmarkIcon filled={isFav} size={16} />
        </IconButton>
      </div>
      <button type="button" className="ss-map-card__play" onClick={onPlay}>
        {busy ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
        <span>{busy ? 'Pause' : 'Play'}</span>
      </button>
    </div>
  );
}

import { useEffect, useState, type CSSProperties } from 'react';
import { player, usePlayer } from '@/audio/player';
import { externalHref, stationLocation } from '@/lib/format';
import { favorites, useIsFavorite } from '@/storage/favorites';
import { selectStation } from '@/state/ui';
import type { PlayerStatus, Station } from '@/types';
import { IconButton } from '@/components/common/IconButton';
import { StationLogo } from '@/components/common/StationLogo';
import {
  BookmarkIcon,
  ExternalIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  SpinnerIcon,
  VolumeIcon,
  VolumeMuteIcon,
} from '@/components/common/icons';
import './PlayerBar.css';

/** Shows "Buffering…" only once the buffer has been empty for over a second. Mounted only while buffering. */
function BufferingNote() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 1000);
    return () => clearTimeout(timer);
  }, []);
  return slow ? <>Buffering…</> : null;
}

function StatusLine({ status, error }: { status: PlayerStatus; error: string | null }) {
  if (status === 'error') {
    // Short sentence on screen; the full reason is visually hidden in the live region and in the title.
    return (
      <>
        <span className="ss-player__error">Couldn't play this station</span>
        <button type="button" className="ss-player__text-btn" onClick={() => player.retry()}>
          Try again
        </button>
        {error && <span className="ss-sr-only">{error}</span>}
      </>
    );
  }
  if (status === 'loading') return <>Connecting…</>;
  if (status === 'buffering') return <BufferingNote />;
  if (status === 'playing') return <>Live</>;
  if (status === 'paused') return <>Paused</>;
  return null;
}

/** Logo, name and location, with the single polite status region under them. */
function Info({ station, status, error }: { station: Station | null; status: PlayerStatus; error: string | null }) {
  if (!station) {
    return (
      <div className="ss-player__info">
        <span className="ss-player__logo-slot" aria-hidden="true" />
        <span className="ss-player__text">
          <span className="ss-player__empty">
            <span className="ss-player__empty-long">Select a station to start listening</span>
            <span className="ss-player__empty-short">Select a station</span>
          </span>
          <span className="ss-player__status" role="status" aria-live="polite" />
        </span>
      </div>
    );
  }
  const location = stationLocation(station);
  return (
    <div className="ss-player__info">
      <StationLogo station={station} size={48} />
      <span className="ss-player__text">
        <button type="button" className="ss-player__station" onClick={() => selectStation(station)}>
          <span className="ss-player__name">{station.name}</span>
          {location && <span className="ss-player__location">{location}</span>}
        </button>
        <span
          className={status === 'error' ? 'ss-player__status ss-player__status--error' : 'ss-player__status'}
          role="status"
          aria-live="polite"
          title={status === 'error' && error ? error : undefined}
        >
          <StatusLine status={status} error={error} />
        </span>
      </span>
    </div>
  );
}

function MainButton({ status, hasStation }: { status: PlayerStatus; hasStation: boolean }) {
  const active = status === 'playing' || status === 'loading' || status === 'buffering';
  const label = status === 'playing' ? 'Pause' : active ? 'Stop' : status === 'error' ? 'Retry' : 'Play';
  return (
    <button
      type="button"
      className="ss-player__main"
      aria-label={label}
      title={label}
      disabled={!hasStation}
      onClick={() => {
        if (status === 'error') player.retry();
        else player.toggle();
      }}
    >
      {status === 'loading' || status === 'buffering' ? (
        <SpinnerIcon size={20} />
      ) : status === 'playing' ? (
        <PauseIcon size={20} />
      ) : (
        <PlayIcon size={20} />
      )}
    </button>
  );
}

function FavoriteButton({ station }: { station: Station | null }) {
  const isFav = useIsFavorite(station?.id);
  return (
    <IconButton
      label={isFav ? 'Remove from favorites' : 'Add to favorites'}
      pressed={isFav}
      disabled={!station}
      className="ss-player__fav"
      onClick={() => {
        if (station) favorites.toggle(station);
      }}
    >
      <BookmarkIcon filled={isFav} size={20} />
    </IconButton>
  );
}

export function PlayerBar() {
  const { station, status, error, volume, muted, hasPrev, hasNext } = usePlayer();
  const hasStation = station !== null;

  // Space toggles playback unless focus is on a control that uses Space itself.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.code !== 'Space') return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(target.tagName))) return;
      if (player.getState().station === null) return;
      e.preventDefault();
      player.toggle();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const homepage = externalHref(station?.homepage);
  return (
    <footer className="ss-player" aria-label="Player">
      <div className="ss-player__left">
        <Info station={station} status={status} error={error} />
      </div>

      <div className="ss-player__centre">
        <IconButton
          label="Previous station"
          disabled={!hasPrev}
          className="ss-player__prev"
          onClick={() => player.prev()}
        >
          <PrevIcon size={20} />
        </IconButton>
        <MainButton status={status} hasStation={hasStation} />
        <IconButton
          label="Next station"
          disabled={!hasNext}
          className="ss-player__next"
          onClick={() => player.next()}
        >
          <NextIcon size={20} />
        </IconButton>
      </div>

      <div className="ss-player__right">
        <div className="ss-player__tools">
          <IconButton
            label="Mute"
            pressed={muted}
            disabled={!hasStation}
            className="ss-player__mute"
            onClick={() => player.toggleMute()}
          >
            {muted ? <VolumeMuteIcon size={20} /> : <VolumeIcon size={20} />}
          </IconButton>
          <input
            className="ss-range ss-player__volume"
            type="range"
            min={0}
            max={1}
            step={0.01}
            aria-label="Volume"
            value={volume}
            style={{ '--ss-fill': `${Math.round(volume * 100)}%` } as CSSProperties}
            onChange={(e) => player.setVolume(Number(e.currentTarget.value))}
          />
          <FavoriteButton station={station} />
          {homepage ? (
            <a
              className="ss-icon-btn ss-player__ext"
              href={homepage}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open station website"
              title="Open station website"
            >
              <ExternalIcon size={20} />
            </a>
          ) : null}
        </div>
      </div>
    </footer>
  );
}

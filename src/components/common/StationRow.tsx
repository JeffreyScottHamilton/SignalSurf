import type { ReactNode } from 'react';
import type { Station } from '@/types';
import { stationLocation } from '@/lib/format';
import { SignalIcon } from './icons';
import { StationLogo } from './StationLogo';
import './StationRow.css';

export interface StationRowProps {
  station: Station;
  selected?: boolean;
  playing?: boolean;
  onActivate: () => void;
  meta?: ReactNode;
  trailing?: ReactNode;
}

export function StationRow({ station, selected, playing, onActivate, meta, trailing }: StationRowProps) {
  const location = stationLocation(station);
  return (
    <button
      type="button"
      className="ss-station-row"
      aria-current={selected ? 'true' : undefined}
      onClick={onActivate}
    >
      <StationLogo station={station} />
      <span className="ss-station-row__text">
        <span className="ss-station-row__name">{station.name}</span>
        {location && <span className="ss-station-row__location">{location}</span>}
      </span>
      {meta !== undefined && meta !== null && <span className="ss-station-row__meta">{meta}</span>}
      {trailing ?? (
        <SignalIcon className={playing ? 'ss-station-row__signal ss-station-row__signal--playing' : 'ss-station-row__signal'} />
      )}
      {playing && <span className="ss-sr-only">Now playing</span>}
    </button>
  );
}

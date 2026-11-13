import { useState, type CSSProperties } from 'react';
import type { Station } from '@/types';
import './StationLogo.css';

export interface StationLogoProps {
  station: Station;
  size?: number;
}

/** Up to two initials from the station name; "•" when the name has no letters. */
export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return '•';
  if (words.length === 1) return Array.from(words[0]).slice(0, 2).join('').toUpperCase();
  return (Array.from(words[0])[0] + Array.from(words[1])[0]).toUpperCase();
}

export function StationLogo({ station, size = 40 }: StationLogoProps) {
  // Remember which favicon failed, so a new station gets a fresh attempt without an effect.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const style = { '--ss-logo-size': `${size}px` } as CSSProperties;
  const showImage = station.favicon !== null && station.favicon !== failedUrl;

  if (!showImage) {
    return (
      <span className="ss-logo ss-logo--initials" style={style} aria-hidden="true">
        {initialsFor(station.name)}
      </span>
    );
  }

  return (
    <span className="ss-logo" style={style}>
      <img
        src={station.favicon ?? undefined}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailedUrl(station.favicon)}
      />
    </span>
  );
}

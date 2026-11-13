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

interface ImageState {
  url: string;
  status: 'loaded' | 'failed';
}

/**
 * Initials tile is always rendered. The favicon sits on top and is shown only after its `load`
 * event; after an `error` it is removed. Either way the box never changes size.
 */
export function StationLogo({ station, size = 40 }: StationLogoProps) {
  const [image, setImage] = useState<ImageState | null>(null);
  const style = { '--ss-logo-size': `${size}px` } as CSSProperties;
  const url = station.favicon;
  const current = url !== null && image !== null && image.url === url ? image.status : null;
  const showImage = url !== null && current !== 'failed';

  return (
    <span className="ss-logo" style={style}>
      <span className="ss-logo__initials" aria-hidden="true">
        {initialsFor(station.name)}
      </span>
      {showImage && (
        <img
          className={current === 'loaded' ? 'ss-logo__img ss-logo__img--loaded' : 'ss-logo__img'}
          src={url}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={() => setImage({ url, status: 'loaded' })}
          onError={() => setImage({ url, status: 'failed' })}
        />
      )}
    </span>
  );
}

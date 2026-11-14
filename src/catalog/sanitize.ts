import type { Coords, Genre, Station } from '@/types';
import { isGenre, isStateCode } from './genres';

const MAX_TAGS = 5;
const MIN_ID_LENGTH = 8;
const MIN_NAME_LENGTH = 2;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Trimmed non-empty string, or null. */
function text(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function isUrlWith(s: string, protocols: readonly string[]): boolean {
  try {
    return protocols.includes(new URL(s).protocol);
  } catch {
    return false;
  }
}

function nonNegative(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

function coordsOf(v: unknown): Coords | null {
  if (!isRecord(v)) return null;
  const { lat, lng } = v;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

/**
 * Strict check for a station record (catalogue entry, favourite or history snapshot).
 * Returns a fully typed Station, or null when id (8+ characters), name (2+ characters) or
 * the https stream is unusable. Other bad fields are replaced by their empty value.
 */
export function sanitizeStation(v: unknown): Station | null {
  if (!isRecord(v)) return null;
  const id = text(v.id);
  const name = text(v.name);
  const streamUrl = text(v.streamUrl);
  // Real ids are UUIDs, and no station is named with a single character.
  if (id === null || id.length < MIN_ID_LENGTH) return null;
  if (name === null || name.length < MIN_NAME_LENGTH) return null;
  if (streamUrl === null || !isUrlWith(streamUrl, ['https:'])) return null;

  const homepage = text(v.homepage);
  const favicon = text(v.favicon);
  const bitrate = v.bitrate;
  const stateCode = typeof v.stateCode === 'string' ? v.stateCode.trim() : '';

  return {
    id,
    name,
    streamUrl,
    homepage: homepage !== null && isUrlWith(homepage, ['http:', 'https:']) ? homepage : null,
    favicon: favicon !== null && isUrlWith(favicon, ['https:']) ? favicon : null,
    stateCode: isStateCode(stateCode) ? stateCode : null,
    city: text(v.city),
    tags: Array.isArray(v.tags)
      ? v.tags.filter((t): t is string => typeof t === 'string' && t.trim() !== '').slice(0, MAX_TAGS)
      : [],
    genres: Array.isArray(v.genres) ? (v.genres.filter(isGenre) as Genre[]) : [],
    codec: text(v.codec),
    bitrate: typeof bitrate === 'number' && Number.isFinite(bitrate) && bitrate > 0 ? bitrate : null,
    hls: v.hls === true,
    coords: coordsOf(v.coords),
    clickCount: nonNegative(v.clickCount),
  };
}

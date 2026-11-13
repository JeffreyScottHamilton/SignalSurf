export type Category = 'all' | 'music' | 'news' | 'talk' | 'sports';
export type StationCategory = Exclude<Category, 'all'>;
export interface Coords { lat: number; lng: number }
export interface Station {
  id: string;                 // stationuuid
  name: string;               // trimmed, non-empty
  streamUrl: string;          // url_resolved || url; https only
  homepage: string | null;    // http(s) only
  favicon: string | null;     // https only
  country: string | null;     // display name
  countryCode: string | null; // ISO 3166-1 alpha-2, upper case
  region: string | null;      // Radio Browser `state` (city/region as entered)
  tags: string[];             // lower case, trimmed, max 8
  categories: StationCategory[];
  codec: string | null;
  bitrate: number | null;     // kbps, null when 0
  hls: boolean;
  coords: Coords | null;      // null unless both finite, in range, and not (0,0)
  lastCheckOk: boolean;
  lastCheckTime: string | null; // ISO 8601
  clickCount: number;
  votes: number;
}
export interface HistoryEntry { station: Station; playedAt: number } // epoch ms
export type View = 'explore' | 'favorites' | 'history';
export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';
export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'buffering' | 'paused' | 'error';
export interface PlayerState {
  station: Station | null;
  status: PlayerStatus;
  error: string | null;   // user-facing sentence, only when status === 'error'
  volume: number;         // 0..1
  muted: boolean;
  hasPrev: boolean;
  hasNext: boolean;
}

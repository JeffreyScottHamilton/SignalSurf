export type Genre =
  | 'rock' | 'country' | 'pop' | 'hiphop' | 'jazz' | 'classical' | 'electronic'
  | 'oldies' | 'latin' | 'christian' | 'indie' | 'folk';
export type GenreFilter = 'all' | Genre;
export interface Coords { lat: number; lng: number }
export interface Station {
  id: string;                 // stationuuid
  name: string;               // trimmed, non-empty
  streamUrl: string;          // https only
  homepage: string | null;    // http(s) only
  favicon: string | null;     // https only
  stateCode: string | null;   // 2-letter US state or territory code; never guessed
  city: string | null;        // city as written in the directory, when a state was found with it
  tags: string[];             // lower case, trimmed, max 5
  genres: Genre[];            // may be empty for bare "music" / "variety" stations
  codec: string | null;
  bitrate: number | null;     // kbps, null when unknown
  hls: boolean;
  coords: Coords | null;      // null unless inside a US box
  clickCount: number;         // directory popularity, used for ordering
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

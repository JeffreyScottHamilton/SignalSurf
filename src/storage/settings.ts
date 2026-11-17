import { useStore } from '@/lib/createStore';
import type { MapStyle } from '@/types';
import { createPersisted } from './persisted';

export const SETTINGS_KEY = 'roadtrip:settings:v1';
export const DEFAULT_VOLUME = 0.75;
export const DEFAULT_MAP_STYLE: MapStyle = 'streets';

export interface SettingsState {
  defaultVolume: number;
  mapStyle: MapStyle;
}

export function clampVolume(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Only the two known styles are kept; anything else falls back to the street map. */
export function parseMapStyle(raw: unknown): MapStyle {
  return raw === 'satellite' || raw === 'streets' ? raw : DEFAULT_MAP_STYLE;
}

/** Missing or non-numeric values fall back to the default; numbers are clamped to 0..1. */
function parseSettings(raw: unknown): SettingsState {
  const obj = typeof raw === 'object' && raw !== null ? (raw as { defaultVolume?: unknown; mapStyle?: unknown }) : {};
  const value = obj.defaultVolume;
  return {
    defaultVolume: typeof value === 'number' && Number.isFinite(value) ? clampVolume(value) : DEFAULT_VOLUME,
    mapStyle: parseMapStyle(obj.mapStyle),
  };
}

const { store, commit } = createPersisted<SettingsState>(SETTINGS_KEY, parseSettings);

/** Used by the one-time migration only when the new key is absent. */
export function absorbLegacySettings(raw: unknown): void {
  commit(parseSettings(raw));
}

export const settings: {
  get(): SettingsState;
  setDefaultVolume(v: number): void;
  setMapStyle(style: MapStyle): void;
} = {
  get: () => store.get(),
  setDefaultVolume(v) {
    if (!Number.isFinite(v)) return;
    commit({ ...store.get(), defaultVolume: clampVolume(v) });
  },
  setMapStyle(style) {
    if (parseMapStyle(style) !== style) return;
    commit({ ...store.get(), mapStyle: style });
  },
};

export function useSettings(): SettingsState {
  return useStore(store);
}

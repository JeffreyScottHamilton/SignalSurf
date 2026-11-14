import { useStore } from '@/lib/createStore';
import { createPersisted } from './persisted';

export const SETTINGS_KEY = 'roadtrip:settings:v1';
export const DEFAULT_VOLUME = 0.75;

export interface SettingsState {
  defaultVolume: number;
}

export function clampVolume(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Missing or non-numeric values fall back to the default; numbers are clamped to 0..1. */
function parseSettings(raw: unknown): SettingsState {
  const value = typeof raw === 'object' && raw !== null ? (raw as { defaultVolume?: unknown }).defaultVolume : undefined;
  return {
    defaultVolume: typeof value === 'number' && Number.isFinite(value) ? clampVolume(value) : DEFAULT_VOLUME,
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
} = {
  get: () => store.get(),
  setDefaultVolume(v) {
    if (!Number.isFinite(v)) return;
    commit({ defaultVolume: clampVolume(v) });
  },
};

export function useSettings(): SettingsState {
  return useStore(store);
}

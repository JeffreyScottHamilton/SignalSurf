// STUB — replaced by slice S5
import { createStore, useStore } from '@/lib/createStore';

export interface SettingsState {
  defaultVolume: number;
}

const store = createStore<SettingsState>({ defaultVolume: 0.75 });

export const settings: {
  get(): SettingsState;
  setDefaultVolume(v: number): void;
} = {
  get: () => store.get(),
  setDefaultVolume(v) {
    void v;
  },
};

export function useSettings(): SettingsState {
  return useStore(store);
}

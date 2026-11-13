import { createStore, type Store } from '@/lib/createStore';
import type { Station, View } from '@/types';

export interface UiState {
  view: View;
  selected: Station | null;
  settingsOpen: boolean;
  sheetOpen: boolean;
}

export const uiStore: Store<UiState> = createStore<UiState>({
  view: 'explore',
  selected: null,
  settingsOpen: false,
  sheetOpen: false,
});

export function setView(v: View): void {
  uiStore.set((s) => ({ ...s, view: v }));
}

export function selectStation(s: Station | null): void {
  uiStore.set((prev) => ({ ...prev, selected: s }));
}

export function setSettingsOpen(open: boolean): void {
  uiStore.set((s) => ({ ...s, settingsOpen: open }));
}

export function setSheetOpen(open: boolean): void {
  uiStore.set((s) => ({ ...s, sheetOpen: open }));
}

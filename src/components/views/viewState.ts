import { player, usePlayer } from '@/audio/player';
import { useStore } from '@/lib/createStore';
import { selectStation, uiStore } from '@/state/ui';
import type { Station } from '@/types';

/** Id of the selected station, or undefined. */
export function useSelectedId(): string | undefined {
  return useStore(uiStore, (s) => s.selected?.id);
}

/** Id of the station whose stream has actually started playing, or undefined. */
export function usePlayingId(): string | undefined {
  const p = usePlayer();
  return p.status === 'playing' ? p.station?.id : undefined;
}

/** Row activation: select the station and start it, queued from the list it came from. */
export function playStation(s: Station, queue: Station[]): void {
  selectStation(s);
  player.play(s, queue);
}

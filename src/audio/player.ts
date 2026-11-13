// One playback controller for the whole app. Owns the only HTMLAudioElement.
// Every transition bumps `token`; every event handler and async continuation
// captures the token and returns early when it is no longer current.
import { reportClick } from '@/api/radioBrowser';
import { createStore, useStore } from '@/lib/createStore';
import { stationLocation } from '@/lib/format';
import { settings } from '@/storage/settings';
import type { PlayerState, Station } from '@/types';

const LOAD_TIMEOUT_MS = 15_000;
const STALL_TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 1_500;
const HLS_MIME = 'application/vnd.apple.mpegurl';
const MEDIA_ERR_DECODE = 3;
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

const MESSAGES = {
  unsupported: "This station uses a stream format this browser can't play.",
  unplayable: "This station couldn't be played. It may be offline or use a format this browser doesn't support.",
  network: "This station isn't responding right now. Try again or pick another station.",
  timeout: 'This station took too long to respond.',
} as const;

/**
 * `ended`, `network` and `unplayable` get one automatic retry each. `unplayable` covers
 * media errors that Chrome also raises for unreachable streams, so it is not treated as
 * a definite format problem. `timeout` and `unsupported` never retry; `unsupported` is
 * only used when no HLS support exists at all.
 */
type FailKind = 'network' | 'unplayable' | 'unsupported' | 'timeout' | 'ended';

const store = createStore<PlayerState>({
  station: null,
  status: 'idle',
  error: null,
  volume: settings.get().defaultVolume,
  muted: false,
  hasPrev: false,
  hasNext: false,
});

let audio: HTMLAudioElement | null = null;
let volumeTouched = false;
let token = 0;
let queue: Station[] = [];
let autoRetryUsed = false;
let reconnectUsed = false;
let startedToken = 0;
let loadTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let stallTimer: ReturnType<typeof setTimeout> | null = null;
let listeners: [string, EventListener][] = [];
let hlsInstance: { destroy(): void } | null = null;
const startedListeners = new Set<(s: Station) => void>();

function invalidate(): number {
  token += 1;
  return token;
}

function setState(patch: Partial<PlayerState>): void {
  const prev = store.get();
  const keys = Object.keys(patch) as (keyof PlayerState)[];
  if (keys.every((k) => Object.is(prev[k], patch[k]))) return;
  store.set({ ...prev, ...patch });
}

function navFor(station: Station | null, list: Station[]): Pick<PlayerState, 'hasPrev' | 'hasNext'> {
  const i = station ? list.findIndex((s) => s.id === station.id) : -1;
  return { hasPrev: i > 0, hasNext: i >= 0 && i < list.length - 1 };
}

function clearTimers(): void {
  if (loadTimer !== null) clearTimeout(loadTimer);
  if (retryTimer !== null) clearTimeout(retryTimer);
  if (stallTimer !== null) clearTimeout(stallTimer);
  loadTimer = null;
  retryTimer = null;
  stallTimer = null;
}

function detachListeners(): void {
  if (!audio) return;
  for (const [type, fn] of listeners) audio.removeEventListener(type, fn);
  listeners = [];
}

/** Stops the current stream and releases it. Does not change the session token. */
function unload(): void {
  clearTimers();
  detachListeners();
  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }
  if (audio) {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
}

function updateMediaMetadata(station: Station | null): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  if (typeof MediaMetadata === 'undefined') return;
  navigator.mediaSession.metadata = station
    ? new MediaMetadata({ title: station.name, artist: stationLocation(station) })
    : null;
}

function setupMediaSession(): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
    ['play', () => mediaPlay()],
    ['pause', () => pause()],
    ['previoustrack', () => prev()],
    ['nexttrack', () => next()],
  ];
  for (const [action, handler] of handlers) {
    try {
      ms.setActionHandler(action, handler);
    } catch {
      // This browser does not support the action; the bar still works.
    }
  }
}

function ensureAudio(): HTMLAudioElement {
  if (audio) return audio;
  const el = new Audio();
  el.preload = 'none';
  if (!volumeTouched) setState({ volume: settings.get().defaultVolume });
  el.volume = store.get().volume;
  el.muted = store.get().muted;
  audio = el;
  setupMediaSession();
  return el;
}

function needsHls(station: Station): boolean {
  if (station.hls) return true;
  let path = station.streamUrl;
  try {
    path = new URL(station.streamUrl).pathname;
  } catch {
    // Keep the raw string when it is not an absolute URL.
  }
  return /\.m3u8$/i.test(path);
}

function fail(kind: FailKind): void {
  unload();
  const t = invalidate();
  if ((kind === 'network' || kind === 'unplayable') && !autoRetryUsed) {
    autoRetryUsed = true;
    scheduleRetry(t);
    return;
  }
  if (kind === 'ended' && !reconnectUsed) {
    reconnectUsed = true;
    scheduleRetry(t);
    return;
  }
  setState({ status: 'error', error: messageFor(kind) });
}

function messageFor(kind: FailKind): string {
  switch (kind) {
    case 'unsupported':
      return MESSAGES.unsupported;
    case 'unplayable':
      return MESSAGES.unplayable;
    case 'timeout':
      return MESSAGES.timeout;
    default:
      return MESSAGES.network;
  }
}

function scheduleRetry(t: number): void {
  setState({ status: 'loading', error: null });
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (t !== token) return;
    const station = store.get().station;
    if (station) beginLoad(station);
  }, RETRY_DELAY_MS);
}

function onPlayRejected(t: number, err: unknown): void {
  if (t !== token) return;
  const name = (err as { name?: unknown } | null)?.name;
  if (name === 'AbortError') return; // a newer call superseded this one
  if (name === 'NotAllowedError') {
    // Browser blocked autoplay: the user presses play.
    invalidate();
    unload();
    setState({ status: 'paused', error: null });
    return;
  }
  fail(name === 'NotSupportedError' ? 'unplayable' : 'network');
}

function attachListeners(el: HTMLAudioElement, t: number): void {
  const add = (type: string, fn: () => void): void => {
    const listener: EventListener = () => {
      if (t !== token) return;
      fn();
    };
    el.addEventListener(type, listener);
    listeners.push([type, listener]);
  };

  // Starts a 15s clock when playback stops for buffering. If it never recovers, the normal failure path runs.
  const onBuffering = () => {
    if (store.get().status !== 'playing') return;
    setState({ status: 'buffering' });
    if (stallTimer !== null) return;
    stallTimer = setTimeout(() => {
      stallTimer = null;
      if (t !== token) return;
      fail('network');
    }, STALL_TIMEOUT_MS);
  };

  add('playing', () => {
    if (loadTimer !== null) clearTimeout(loadTimer);
    loadTimer = null;
    if (stallTimer !== null) clearTimeout(stallTimer);
    stallTimer = null;
    // A stream that plays again has earned a fresh retry budget for its next drop.
    autoRetryUsed = false;
    reconnectUsed = false;
    setState({ status: 'playing', error: null });
    if (startedToken !== token) {
      startedToken = token;
      const station = store.get().station;
      if (station) {
        reportClick(station.id);
        for (const fn of [...startedListeners]) fn(station);
      }
    }
  });
  add('waiting', onBuffering);
  add('stalled', onBuffering);
  add('error', () => {
    const code = el.error?.code ?? 0;
    // SRC_NOT_SUPPORTED is also raised for unreachable streams, so it is not a definite format error.
    const unplayable = code === MEDIA_ERR_SRC_NOT_SUPPORTED || code === MEDIA_ERR_DECODE;
    fail(unplayable ? 'unplayable' : 'network');
  });
  add('ended', () => fail('ended'));
}

async function startSession(station: Station, t: number): Promise<void> {
  const el = ensureAudio();
  attachListeners(el, t);
  try {
    if (needsHls(station)) {
      if (el.canPlayType(HLS_MIME)) {
        el.src = station.streamUrl;
      } else {
        const mod = await import('hls.js');
        if (t !== token) return;
        const Hls = mod.default;
        if (!Hls.isSupported()) {
          fail('unsupported');
          return;
        }
        const hls = new Hls();
        hlsInstance = hls;
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (t !== token || !data.fatal) return;
          fail(data.type === Hls.ErrorTypes.NETWORK_ERROR ? 'network' : 'unplayable');
        });
        hls.loadSource(station.streamUrl);
        hls.attachMedia(el);
      }
    } else {
      el.src = station.streamUrl;
    }
  } catch {
    if (t === token) fail('network');
    return;
  }
  if (t !== token) return;
  el.play().catch((err: unknown) => onPlayRejected(t, err));
}

/** Starts a fresh session for `station`: unloads the previous stream first. */
function beginLoad(station: Station): void {
  const t = invalidate();
  unload();
  setState({ station, status: 'loading', error: null, ...navFor(station, queue) });
  updateMediaMetadata(station);
  loadTimer = setTimeout(() => {
    loadTimer = null;
    if (t !== token) return;
    fail('timeout');
  }, LOAD_TIMEOUT_MS);
  void startSession(station, t);
}

/** User-initiated start: resets the automatic retry budget. */
function startStation(station: Station, list?: Station[]): void {
  autoRetryUsed = false;
  reconnectUsed = false;
  if (list) queue = list;
  else if (!queue.some((s) => s.id === station.id)) queue = [];
  beginLoad(station);
}

function pause(): void {
  const { station } = store.get();
  if (!station) return;
  invalidate();
  unload();
  setState({ status: 'paused', error: null });
}

function mediaPlay(): void {
  const { station, status } = store.get();
  if (station && (status === 'paused' || status === 'error' || status === 'idle')) startStation(station);
}

function next(): void {
  const { station } = store.get();
  if (!station) return;
  const i = queue.findIndex((s) => s.id === station.id);
  if (i >= 0 && i < queue.length - 1) startStation(queue[i + 1], queue);
}

function prev(): void {
  const { station } = store.get();
  if (!station) return;
  const i = queue.findIndex((s) => s.id === station.id);
  if (i > 0) startStation(queue[i - 1], queue);
}

export const player: {
  getState(): PlayerState;
  subscribe(fn: () => void): () => void;
  play(station: Station, queue?: Station[]): void;
  toggle(): void;
  pause(): void;
  retry(): void;
  next(): void;
  prev(): void;
  setVolume(v: number): void;
  toggleMute(): void;
  onStarted(fn: (s: Station) => void): () => void;
} = {
  getState: () => store.get(),
  subscribe: (fn) => store.subscribe(fn),
  play(station, list) {
    startStation(station, list);
  },
  toggle() {
    const { station, status } = store.get();
    if (!station) return;
    if (status === 'playing' || status === 'loading' || status === 'buffering') pause();
    else startStation(station);
  },
  pause,
  retry() {
    const { station } = store.get();
    if (station) startStation(station);
  },
  next,
  prev,
  setVolume(v) {
    if (!Number.isFinite(v)) return;
    const clamped = Math.min(1, Math.max(0, v));
    volumeTouched = true;
    setState({ volume: clamped });
    if (audio) audio.volume = clamped;
  },
  toggleMute() {
    const muted = !store.get().muted;
    setState({ muted });
    if (audio) audio.muted = muted;
  },
  onStarted(fn) {
    startedListeners.add(fn);
    return () => {
      startedListeners.delete(fn);
    };
  },
};

export function usePlayer(): PlayerState {
  return useStore(store);
}

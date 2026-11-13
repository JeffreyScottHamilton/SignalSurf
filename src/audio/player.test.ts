import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerState, Station } from '@/types';

const reportClick = vi.hoisted(() => vi.fn());
vi.mock('@/api/radioBrowser', () => ({ reportClick }));

const UNSUPPORTED = "This station uses a stream format this browser can't play.";
const UNPLAYABLE = "This station couldn't be played. It may be offline or use a format this browser doesn't support.";
const NETWORK = "This station isn't responding right now. Try again or pick another station.";
const TIMEOUT = 'This station took too long to respond.';

/** Hand-written stand-in for HTMLAudioElement. Records every operation in `log`. */
class FakeAudio {
  static instances: FakeAudio[] = [];
  static mpegurlSupport = '';

  volume = 1;
  muted = false;
  preload = '';
  error: { code: number } | null = null;
  readonly log: string[] = [];
  private current = '';
  private handlers = new Map<string, EventListener[]>();
  private pendingPlay: ((err: unknown) => void)[] = [];

  constructor() {
    FakeAudio.instances.push(this);
  }

  get src(): string {
    return this.current;
  }

  set src(url: string) {
    this.current = url;
    this.log.push(`src:${url}`);
  }

  addEventListener(type: string, fn: EventListener): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  }

  removeEventListener(type: string, fn: EventListener): void {
    this.handlers.set(type, (this.handlers.get(type) ?? []).filter((f) => f !== fn));
  }

  listeners(type: string): EventListener[] {
    return [...(this.handlers.get(type) ?? [])];
  }

  emit(type: string): void {
    for (const fn of this.listeners(type)) fn(new Event(type));
  }

  play(): Promise<void> {
    this.log.push('play');
    return new Promise<void>((_resolve, reject) => {
      this.pendingPlay.push(reject);
    });
  }

  /** Rejects the most recent play() call with an error of this name. */
  rejectPlay(name: string): void {
    const reject = this.pendingPlay.pop();
    reject?.(Object.assign(new Error(name), { name }));
  }

  pause(): void {
    this.log.push('pause');
  }

  load(): void {
    this.log.push('load');
  }

  removeAttribute(name: string): void {
    if (name !== 'src') return;
    this.current = '';
    this.log.push('removeAttribute:src');
  }

  canPlayType(type: string): string {
    return type === 'application/vnd.apple.mpegurl' ? FakeAudio.mpegurlSupport : '';
  }
}

function station(id: string, extra: Partial<Station> = {}): Station {
  return {
    id,
    name: `Station ${id}`,
    streamUrl: `https://stream.example.test/${id}.mp3`,
    homepage: null,
    favicon: null,
    country: 'Testland',
    countryCode: 'TL',
    region: null,
    tags: [],
    categories: [],
    codec: 'MP3',
    bitrate: 128,
    hls: false,
    coords: null,
    lastCheckOk: true,
    lastCheckTime: null,
    clickCount: 0,
    votes: 0,
    ...extra,
  };
}

type Player = typeof import('./player').player;
type PlayerModule = typeof import('./player');

let player: Player;
let usePlayerHook: PlayerModule['usePlayer'];

function el(): FakeAudio {
  const last = FakeAudio.instances[FakeAudio.instances.length - 1];
  if (!last) throw new Error('no audio element created yet');
  return last;
}

function status(): PlayerState['status'] {
  return player.getState().status;
}

/** Lets pending promise continuations run (fake timers are in use). */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(async () => {
  vi.useFakeTimers();
  FakeAudio.instances = [];
  FakeAudio.mpegurlSupport = '';
  vi.stubGlobal('Audio', FakeAudio);
  vi.resetModules();
  reportClick.mockClear();
  const mod = await import('./player');
  player = mod.player;
  usePlayerHook = mod.usePlayer;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('player controller', () => {
  it('goes loading then playing only after the playing event', async () => {
    const a = station('a');
    player.play(a);
    expect(player.getState()).toMatchObject({ station: a, status: 'loading', error: null });
    await settle();
    expect(status()).toBe('loading');
    expect(reportClick).not.toHaveBeenCalled();

    el().emit('playing');
    expect(status()).toBe('playing');
    expect(reportClick).toHaveBeenCalledTimes(1);
    expect(reportClick).toHaveBeenCalledWith('a');
  });

  it('keeps exactly one audio element and unloads the first stream before the second', () => {
    player.play(station('a'));
    const first = el();
    first.emit('playing');
    player.play(station('b'));

    expect(FakeAudio.instances).toHaveLength(1);
    const log = first.log;
    const unloadAt = log.indexOf('removeAttribute:src');
    const secondSrcAt = log.indexOf('src:https://stream.example.test/b.mp3');
    expect(unloadAt).toBeGreaterThan(-1);
    expect(log.indexOf('load')).toBeGreaterThan(-1);
    expect(log.indexOf('load')).toBeLessThan(secondSrcAt);
    expect(unloadAt).toBeLessThan(secondSrcAt);
    expect(log.indexOf('src:https://stream.example.test/a.mp3')).toBeLessThan(unloadAt);
    expect(player.getState().station?.id).toBe('b');
  });

  it('ignores late playing and error events from the previous station', () => {
    player.play(station('a'));
    const staleListeners = [...el().listeners('playing'), ...el().listeners('error')];
    player.play(station('b'));
    el().error = { code: 2 };

    for (const fn of staleListeners) fn(new Event('playing'));
    for (const fn of staleListeners) fn(new Event('error'));

    expect(player.getState()).toMatchObject({ status: 'loading', error: null });
    expect(player.getState().station?.id).toBe('b');
    expect(reportClick).not.toHaveBeenCalled();
  });

  it('treats NotAllowedError as paused, not as an error', async () => {
    player.play(station('a'));
    el().rejectPlay('NotAllowedError');
    await settle();
    expect(player.getState()).toMatchObject({ status: 'paused', error: null });
    expect(player.getState().station?.id).toBe('a');
  });

  it('retries an SRC_NOT_SUPPORTED error once like a network error, then shows the neutral message', async () => {
    player.play(station('a'));
    el().error = { code: 4 };
    el().emit('error');
    expect(player.getState()).toMatchObject({ status: 'loading', error: null });
    await vi.advanceTimersByTimeAsync(1_500);
    expect(el().log.filter((l) => l === 'play')).toHaveLength(2);

    el().emit('error');
    expect(player.getState()).toMatchObject({ status: 'error', error: UNPLAYABLE });
    expect(player.getState().error).not.toBe(UNSUPPORTED);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(el().log.filter((l) => l === 'play')).toHaveLength(2);
  });

  it('shows the neutral message for a play() NotSupportedError after its one retry', async () => {
    player.play(station('a'));
    el().rejectPlay('NotSupportedError');
    await settle();
    expect(status()).toBe('loading');
    await vi.advanceTimersByTimeAsync(1_500);
    el().rejectPlay('NotSupportedError');
    await settle();
    expect(player.getState()).toMatchObject({ status: 'error', error: UNPLAYABLE });
  });

  it('retries a network error once after 1.5s, then stays in error', async () => {
    player.play(station('a'));
    el().error = { code: 2 };
    el().emit('error');
    expect(player.getState()).toMatchObject({ status: 'loading', error: null });

    await vi.advanceTimersByTimeAsync(1_499);
    expect(el().log.filter((l) => l === 'play')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(el().log.filter((l) => l === 'play')).toHaveLength(2);
    expect(status()).toBe('loading');

    el().emit('error');
    expect(player.getState()).toMatchObject({ status: 'error', error: NETWORK });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(el().log.filter((l) => l === 'play')).toHaveLength(2);
    expect(status()).toBe('error');
  });

  it('retry() restarts the station and resets the automatic retry budget', () => {
    player.play(station('a'));
    el().error = { code: 2 };
    el().emit('error');
    vi.advanceTimersByTime(1_500);
    el().emit('error');
    expect(status()).toBe('error');

    player.retry();
    expect(status()).toBe('loading');
    el().emit('error');
    expect(status()).toBe('loading');
  });

  it('fails with a timeout after 15s without playing', async () => {
    player.play(station('a'));
    await vi.advanceTimersByTimeAsync(14_999);
    expect(status()).toBe('loading');
    await vi.advanceTimersByTimeAsync(1);
    expect(player.getState()).toMatchObject({ status: 'error', error: TIMEOUT });
  });

  it('pause() stops and unloads the stream and reports paused', () => {
    player.play(station('a'));
    el().emit('playing');
    player.pause();
    expect(player.getState()).toMatchObject({ status: 'paused', error: null });
    expect(el().src).toBe('');
    expect(el().log).toContain('removeAttribute:src');
  });

  it('toggle() pauses while playing and reloads the live stream when paused', () => {
    player.play(station('a'));
    el().emit('playing');
    player.toggle();
    expect(status()).toBe('paused');
    player.toggle();
    expect(status()).toBe('loading');
    expect(el().log.filter((l) => l === 'play')).toHaveLength(2);
  });

  it('moves next and previous within the queue and stops at the ends', () => {
    const [a, b, c] = [station('a'), station('b'), station('c')];
    const queue = [a, b, c];
    player.play(b, queue);
    expect(player.getState()).toMatchObject({ hasPrev: true, hasNext: true });

    player.next();
    expect(player.getState().station?.id).toBe('c');
    expect(player.getState()).toMatchObject({ hasPrev: true, hasNext: false });
    player.next();
    expect(player.getState().station?.id).toBe('c');

    player.prev();
    player.prev();
    expect(player.getState().station?.id).toBe('a');
    expect(player.getState()).toMatchObject({ hasPrev: false, hasNext: true });
    player.prev();
    expect(player.getState().station?.id).toBe('a');
  });

  it('reports no prev or next for a station that is not in the queue', () => {
    player.play(station('x'), [station('a'), station('b')]);
    expect(player.getState()).toMatchObject({ hasPrev: false, hasNext: false });
    player.next();
    player.prev();
    expect(player.getState().station?.id).toBe('x');
  });

  it('clamps volume to 0..1, applies it to the element and toggles mute', () => {
    player.play(station('a'));
    player.setVolume(2);
    expect(player.getState().volume).toBe(1);
    player.setVolume(-1);
    expect(player.getState().volume).toBe(0);
    player.setVolume(0.4);
    expect(player.getState().volume).toBe(0.4);
    expect(el().volume).toBe(0.4);

    player.toggleMute();
    expect(player.getState().muted).toBe(true);
    expect(el().muted).toBe(true);
    player.toggleMute();
    expect(player.getState().muted).toBe(false);
    expect(el().muted).toBe(false);
  });

  it('fires onStarted once per start, not on buffering recovery', () => {
    const started = vi.fn();
    const off = player.onStarted(started);
    player.play(station('a'));
    el().emit('playing');
    el().emit('waiting');
    expect(status()).toBe('buffering');
    el().emit('playing');
    expect(status()).toBe('playing');
    expect(started).toHaveBeenCalledTimes(1);
    expect(started.mock.calls[0]?.[0]).toMatchObject({ id: 'a' });
    expect(reportClick).toHaveBeenCalledTimes(1);

    player.play(station('b'));
    el().emit('playing');
    expect(started).toHaveBeenCalledTimes(2);
    off();
    player.play(station('c'));
    el().emit('playing');
    expect(started).toHaveBeenCalledTimes(2);
  });

  it('reconnects once when a live stream ends, then shows an error', async () => {
    player.play(station('a'));
    el().emit('playing');
    el().emit('ended');
    expect(status()).toBe('loading');
    await vi.advanceTimersByTimeAsync(1_500);
    el().emit('ended');
    expect(player.getState()).toMatchObject({ status: 'error', error: NETWORK });
  });

  it('gives a long-running stream one retry per drop: a playing event resets the budget', async () => {
    player.play(station('a'));
    el().emit('playing');
    el().emit('ended');
    await vi.advanceTimersByTimeAsync(1_500);
    el().emit('playing');
    el().emit('ended');
    expect(status()).toBe('loading');
    await vi.advanceTimersByTimeAsync(1_500);
    expect(el().log.filter((l) => l === 'play')).toHaveLength(3);
    expect(status()).toBe('loading');
  });

  it('gives a fresh network retry after a successful playing event', async () => {
    player.play(station('a'));
    el().error = { code: 2 };
    el().emit('error');
    await vi.advanceTimersByTimeAsync(1_500);
    el().emit('playing');
    el().emit('error');
    expect(status()).toBe('loading');
    await vi.advanceTimersByTimeAsync(1_500);
    expect(el().log.filter((l) => l === 'play')).toHaveLength(3);
  });

  it('shows buffering while stalled and returns to playing when data resumes', async () => {
    player.play(station('a'));
    el().emit('playing');
    el().emit('waiting');
    expect(status()).toBe('buffering');
    await vi.advanceTimersByTimeAsync(5_000);
    el().emit('playing');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(status()).toBe('playing');
    expect(player.getState().error).toBeNull();
  });

  it('runs the failure path when a buffering stall never recovers for 15s: one retry, then error', async () => {
    player.play(station('a'));
    el().emit('playing');
    el().emit('stalled');
    await vi.advanceTimersByTimeAsync(14_999);
    expect(status()).toBe('buffering');
    await vi.advanceTimersByTimeAsync(1);
    expect(status()).toBe('loading');
    expect(el().log.filter((l) => l === 'play')).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1_500);
    expect(el().log.filter((l) => l === 'play')).toHaveLength(2);
    el().error = { code: 2 };
    el().emit('error');
    expect(player.getState()).toMatchObject({ status: 'error', error: NETWORK });
  });

  it('gives a stall a fresh retry when the stream plays again before stalling', async () => {
    player.play(station('a'));
    el().emit('playing');
    el().emit('waiting');
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(1_500);
    el().emit('playing');
    el().emit('waiting');
    await vi.advanceTimersByTimeAsync(15_000);
    expect(status()).toBe('loading');
    await vi.advanceTimersByTimeAsync(1_500);
    expect(el().log.filter((l) => l === 'play')).toHaveLength(3);
  });

  it('cancels the stall timer on pause', async () => {
    player.play(station('a'));
    el().emit('playing');
    el().emit('waiting');
    player.pause();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(player.getState()).toMatchObject({ status: 'paused', error: null });
  });

  it('uses native HLS when the browser supports it', () => {
    FakeAudio.mpegurlSupport = 'maybe';
    const hls = station('h', { streamUrl: 'https://stream.example.test/h.m3u8', hls: true });
    player.play(hls);
    expect(el().src).toBe('https://stream.example.test/h.m3u8');
    expect(status()).toBe('loading');
  });

  it('keeps the unsupported-format sentence for HLS when neither native nor hls.js support exists', async () => {
    const hls = station('h', { streamUrl: 'https://stream.example.test/h.m3u8', hls: true });
    player.play(hls);
    await vi.waitFor(() => expect(status()).toBe('error'));
    expect(player.getState().error).toBe(UNSUPPORTED);
  });

  it('exposes changes through usePlayer-compatible snapshots', () => {
    expect(typeof usePlayerHook).toBe('function');
    const before = player.getState();
    expect(player.getState()).toBe(before);
    player.setVolume(0.5);
    expect(player.getState()).not.toBe(before);
  });
});

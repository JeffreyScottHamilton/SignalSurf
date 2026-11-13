import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore, useStore } from './createStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('createStore', () => {
  it('returns the initial state from get()', () => {
    const store = createStore({ count: 1 });
    expect(store.get()).toEqual({ count: 1 });
  });

  it('replaces state on set(value) and notifies subscribers', () => {
    const store = createStore(0);
    const fn = vi.fn();
    store.subscribe(fn);
    store.set(5);
    expect(store.get()).toBe(5);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('passes the previous value to an updater function', () => {
    const store = createStore(2);
    store.set((prev) => prev * 10);
    expect(store.get()).toBe(20);
  });

  it('stops notifying after unsubscribe', () => {
    const store = createStore('a');
    const fn = vi.fn();
    const unsubscribe = store.subscribe(fn);
    store.set('b');
    unsubscribe();
    store.set('c');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(store.get()).toBe('c');
  });

  it('notifies every subscriber', () => {
    const store = createStore(0);
    const a = vi.fn();
    const b = vi.fn();
    store.subscribe(a);
    store.subscribe(b);
    store.set(1);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe('useStore', () => {
  let root: ReturnType<typeof createRoot> | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it('renders the selected slice and re-renders when it changes', () => {
    const store = createStore({ name: 'one', other: 0 });
    const seen: string[] = [];
    function Probe() {
      const name = useStore(store, (s) => s.name);
      seen.push(name);
      return createElement('span', null, name);
    }

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(createElement(Probe)));
    expect(container.textContent).toBe('one');

    act(() => store.set((s) => ({ ...s, name: 'two' })));
    expect(container.textContent).toBe('two');
    expect(seen).toEqual(['one', 'two']);
  });
});

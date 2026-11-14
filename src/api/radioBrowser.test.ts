import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Api = typeof import('./radioBrowser');

const DISCOVERY_HOST = 'all.api.radio-browser.info';
const DE1 = 'de1.api.radio-browser.info';

let api: Api;
let calls: URL[];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

type Handler = (url: URL) => Response | Promise<Response>;

/** Installs a fetch mock that records every URL and answers with `handler`. The discovery list is de1 only. */
function installFetch(handler: Handler): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      calls.push(url);
      if (url.hostname === DISCOVERY_HOST) return json([{ ip: '10.0.0.1', name: DE1 }]);
      return handler(url);
    }),
  );
}

beforeEach(async () => {
  calls = [];
  vi.resetModules();
  api = await import('./radioBrowser');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('reportClick', () => {
  it('counts a click on the active server and never throws', async () => {
    installFetch(() => json([]));
    expect(() => api.reportClick('station-uuid-1')).not.toThrow();
    await vi.waitFor(() => expect(calls.some((u) => u.pathname === '/json/url/station-uuid-1')).toBe(true));
    expect(calls.find((u) => u.pathname === '/json/url/station-uuid-1')?.hostname).toBe(DE1);
  });

  it('swallows a failing request', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))));
    expect(() => api.reportClick('station-uuid-2')).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});

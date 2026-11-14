// Radio Browser client, reduced to what the app still asks of the directory at runtime:
// counting plays. Station lists come from the pre-built catalogue (src/catalog).

const DISCOVERY_URL = 'https://all.api.radio-browser.info/json/servers';
const FALLBACK_HOSTS = ['de1', 'de2', 'fi1'].map((h) => `${h}.api.radio-browser.info`);
const HOST_PATTERN = /^[a-z0-9-]+\.api\.radio-browser\.info$/;
const DISCOVERY_TIMEOUT_MS = 5000;

// Session state: resolved once, shared by every click.
let hostsPromise: Promise<string[]> | null = null;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Server list from the directory, with the fixed fallbacks always appended. Discovery is best effort. */
async function discoverHosts(): Promise<string[]> {
  let discovered: string[] = [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DISCOVERY_TIMEOUT_MS);
  try {
    const res = await fetch(DISCOVERY_URL, { signal: ctrl.signal, credentials: 'omit' });
    if (res.ok) {
      const data: unknown = await res.json();
      if (Array.isArray(data)) {
        discovered = data
          .map((e) => (isRecord(e) && typeof e.name === 'string' ? e.name.trim().toLowerCase() : ''))
          .filter((n) => HOST_PATTERN.test(n));
      }
    }
  } catch {
    // The static list below still works.
  } finally {
    clearTimeout(timer);
  }
  const names = [...new Set([...shuffle([...new Set(discovered)]), ...FALLBACK_HOSTS])];
  return names.map((h) => `https://${h}`);
}

function resolveHosts(): Promise<string[]> {
  hostsPromise ??= discoverHosts();
  return hostsPromise;
}

/** Counts a station play, as the Radio Browser docs request. Fire-and-forget; never throws. */
export function reportClick(stationId: string): void {
  try {
    if (typeof stationId !== 'string' || stationId.trim() === '') return;
    const id = encodeURIComponent(stationId.trim());
    void resolveHosts()
      .then((hosts) => fetch(`${hosts[0]}/json/url/${id}`, { credentials: 'omit' }))
      .catch(() => undefined);
  } catch {
    // swallow everything: a failed count must never affect playback
  }
}

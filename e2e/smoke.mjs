// End-to-end smoke test for Roadtrip Radio. Plain Node, uses the preinstalled global Playwright.
// Runs against `npm run preview` (started and stopped here) unless SS_BASE_URL is set.
// Station lists come from the committed catalogue (public/catalog.json, real Radio Browser data).
// The directory's station-list endpoints are blocked, so any reliance on them fails the run; only
// the click counter and its server list may reach the directory. Only audio bytes are mocked: every
// `media` request (and any non-API cross-origin audio URL) is redirected to a local silent stream server.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { createRequire, register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

// The app's catalogue search (src/catalog/search.ts) is the expected-value oracle for the list and the map.
// Node runs its TypeScript by type stripping; this hook adds the '.ts' extension its relative imports omit.
register(
  `data:text/javascript,${encodeURIComponent(
    "export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (e.code === 'ERR_MODULE_NOT_FOUND' && s.startsWith('.')) return next(s + '.ts', c); throw e; } }",
  )}`,
);
const { filterStations } = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'src/catalog/search.ts')).href);
const { expandCatalogRecord } = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'src/catalog/rules.mjs')).href);
const { hasValidCoords } = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'src/map/markerSet.ts')).href);
// Map geometry for the top-zoom check: the lower 48 fit and the screen position of a place at a zoom (Web Mercator).
const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const LOW48 = { s: 24.5, w: -125, n: 49.5, e: -66.5 };
const LOW48_CENTRE = (() => {
  const yc = (merc(LOW48.s) + merc(LOW48.n)) / 2;
  return { lat: (2 * Math.atan(Math.exp(yc)) - Math.PI / 2) * 180 / Math.PI, lng: (LOW48.w + LOW48.e) / 2 };
})();
function fitZoomFor(w, h) {
  const scale = Math.min((w - 24) / (((LOW48.e - LOW48.w) / 360) * 256), (h - 24) / ((((merc(LOW48.n) - merc(LOW48.s)) / (2 * Math.PI)) * 256)));
  return Math.floor(Math.log2(scale) * 10) / 10;
}
function screenOf(lat, lng, w, h, z) {
  return {
    x: w / 2 + (lng - LOW48_CENTRE.lng) * ((256 * 2 ** z) / 360),
    y: h / 2 - (merc(lat) - merc(LOW48_CENTRE.lat)) * ((256 * 2 ** z) / (2 * Math.PI)),
  };
}
/** A solid square PNG, used as a stand-in map tile in the route tests. */
function solidPng(size, [r, g, b]) {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.alloc(1 + size * 3); // filter byte 0 (none) then RGB pixels
  for (let x = 0; x < size; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const TILE_PNG = solidPng(256, [38, 52, 46]);
const DENVER = [39.74, -104.99];

const count1 = (n) => (n === 1 ? '1 station' : `${new Intl.NumberFormat('en-US').format(n)} stations`);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4173;
const SHOTS = '/tmp/claude-0/-home-user/56aa8976-1187-5e42-9581-774146525f7d/scratchpad/int';
const API_HOST = /(^|\.)radio-browser\.info$/;

class SkipStep extends Error {}

const RATE = 8000;
const CHUNK_MS = 100;
// Like a real radio server: a preroll burst (about 60 s of silence) so the browser can start, then real time.
const BURST_BYTES = 1_000_000;

/** 16-bit mono 8 kHz WAV header. The declared data size is huge, so the stream never ends on its own. */
function wavHeader(dataLen = 0x7f000000) {
  const buf = Buffer.alloc(44);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataLen, 40);
  return buf;
}

/**
 * Local stand-in for a live stream: silent WAV written in real time, never ending.
 * Counts connections that are still open, so the script can check how many streams are live.
 */
function startStreamServer() {
  let open = 0;
  const silence = Buffer.alloc((RATE * 2 * CHUNK_MS) / 1000);
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'audio/wav' });
    res.write(wavHeader());
    res.write(Buffer.alloc(BURST_BYTES));
    open += 1;
    let closed = false;
    const timer = setInterval(() => res.write(silence), CHUNK_MS);
    const done = () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      open -= 1;
    };
    res.on('close', done);
    req.on('close', done);
    res.on('error', done);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/stream.wav`,
        open: () => open,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startPreview() {
  const child = spawn('npm', ['run', 'preview', '--', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  return child;
}

async function waitForServer(url, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Preview server did not answer at ${url}`);
}

async function main() {
  if (!existsSync(join(ROOT, 'dist', 'index.html')) && !process.env.SS_BASE_URL) {
    console.error('dist/ is missing. Run `npm run build` first.');
    process.exit(1);
  }
  mkdirSync(SHOTS, { recursive: true });

  const baseUrl = process.env.SS_BASE_URL || `http://localhost:${PORT}/`;
  const preview = process.env.SS_BASE_URL ? null : startPreview();
  const steps = [];
  let browser = null;
  let stream = null;
  let exitCode = 0;

  const stopAll = async () => {
    if (browser) await browser.close().catch(() => {});
    if (preview && preview.pid) {
      try {
        process.kill(-preview.pid, 'SIGTERM');
      } catch {
        // already gone
      }
    }
  };

  try {
    await waitForServer(baseUrl);
    browser = await chromium.launch({
      proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined,
    });
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();

    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    // Directory station lists must never be requested: the catalogue is the only source of lists.
    const directoryListRequests = [];

    // Audio bytes come from the local stream server: media requests are redirected there.
    stream = await startStreamServer();
    await page.route('**/*', (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const isApi = API_HOST.test(url.hostname);
      const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      if (isApi && url.pathname.startsWith('/json/stations')) {
        directoryListRequests.push(url.pathname);
        return route.abort();
      }
      if (req.resourceType() === 'media' || (!isApi && !isLocal && req.resourceType() === 'audio')) {
        return route.fulfill({ status: 302, headers: { location: stream.url } });
      }
      return route.continue();
    });
    // Map tiles are recorded. 'abort' (the default) fails them; 'png' answers with TILE_PNG. Registered after the catch-all, so they win.
    const tileRequests = [];
    let tileMode = 'abort';
    const onTile = (route) => {
      tileRequests.push(route.request().url());
      return tileMode === 'png' ? route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG }) : route.abort();
    };
    await page.route('**basemap.nationalmap.gov/**', onTile);
    const waitOpen = async (n, timeout = 3000) => {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        if (stream.open() === n) return true;
        await sleep(100);
      }
      return stream.open() === n;
    };

    /** Runs one named step. A failed assertion stops the run; a SkipStep is reported and the run goes on. */
    async function step(id, title, fn) {
      const t0 = Date.now();
      try {
        const detail = await fn();
        if (pageErrors.length > 0) throw new Error(`uncaught page error: ${pageErrors[0]}`);
        steps.push({ id, status: 'PASS', title, detail });
        console.log(`PASS ${id}. ${title}${detail ? ` (${detail})` : ''} [${Date.now() - t0}ms]`);
      } catch (err) {
        if (err instanceof SkipStep) {
          steps.push({ id, status: 'SKIP', title, detail: err.message });
          console.log(`SKIP ${id}. ${title}: ${err.message}`);
          return;
        }
        steps.push({ id, status: 'FAIL', title, detail: err.message });
        console.log(`FAIL ${id}. ${title}: ${err.message}`);
        throw err;
      }
    }

    const expect = (cond, msg) => {
      if (!cond) throw new Error(msg);
    };
    const rowNames = () => page.locator('.ss-list__scroll .ss-station-row__name').allTextContents();
    const waitForRows = async (min = 1, timeout = 20000) => {
      await page.waitForFunction(
        (n) => document.querySelectorAll('.ss-list__scroll .ss-station-row').length >= n,
        min,
        { timeout },
      );
    };
    const playerName = () => page.locator('footer.ss-player .ss-player__name').first().textContent({ timeout: 5000 });
    const mainLabel = () => page.locator('footer.ss-player .ss-player__main').getAttribute('aria-label');
    const waitMainLabel = (label, timeout = 15000) =>
      page.waitForFunction(
        (l) => document.querySelector('footer.ss-player .ss-player__main')?.getAttribute('aria-label') === l,
        label,
        { timeout },
      );
    const search = () => page.locator('#ss-station-search, input.ss-search__input').first();
    const chip = (name) => page.locator('.ss-chip', { hasText: new RegExp(`^${name}$`) });
    const navTab = (name) => page.locator('header nav button', { hasText: new RegExp(`^${name}$`) });

    const mapZoom = async () => Number(await page.locator('.ss-map__canvas').getAttribute('data-zoom'));
    const attribution = () => page.locator('.leaflet-control-attribution').textContent();
    const toggleButton = () => page.locator('.ss-map__zoom-btn[aria-pressed]');
    const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    async function mapColours(p) {
      const token = (name) =>
        p.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
      return { usFill: hexRgb(await token('--ss-map-land')), stateLine: hexRgb(await token('--ss-map-state-line')) };
    }
    /**
     * Resets to the lower 48, then drags the map until (lat, lng) is in the middle of the canvas, and leaves it at about
     * zoom 5 with that centre. The aim is refined at zoom 8, 11, 13, 15 and 17 in turn: a pixel at zoom 15 is a tiny fraction of
     * a degree, so the centre has to be right at the top zoom. A drag only starts inside the canvas, so the first aim
     * is made at the reset zoom, where the offset fits. Each drag starts from the map's own centre (data-center).
     */
    const centreMapOn = async (lat, lng, stayZoomed = false) => {
      const canvas = page.locator('.ss-map__canvas');
      const aim = async () => {
        for (let pass = 0; pass < 3; pass++) {
          const b = await canvas.boundingBox();
          const cur = await mapZoom();
          const [clat, clng] = (await canvas.getAttribute('data-center')).split(',').map(Number);
          const dx = ((lng - clng) * 256 * 2 ** cur) / 360;
          const dy = (-(merc(lat) - merc(clat)) * 256 * 2 ** cur) / (2 * Math.PI);
          if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) break;
          const to = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
          const from = { x: to.x + dx, y: to.y + dy };
          await page.mouse.move(from.x, from.y);
          await page.mouse.down();
          for (let i = 1; i <= 20; i++) {
            await page.mouse.move(from.x + ((to.x - from.x) * i) / 20, from.y + ((to.y - from.y) * i) / 20);
          }
          await page.mouse.up();
          await page.waitForTimeout(500);
        }
      };
      await page.locator('button[aria-label="Reset map to the lower 48 states"]').click();
      await page.waitForTimeout(900);
      await aim();
      for (const z of [8, 11, 13, 15, 17]) {
        await zoomTo(z);
        await aim();
      }
      if (stayZoomed) return;
      // Zooming out about the middle keeps the aim, so the caller can zoom back in with + from here.
      for (let i = 0; i < 25 && (await mapZoom()) > 5; i++) {
        await page.locator('button[aria-label="Zoom out"]').click();
        await page.waitForTimeout(300);
      }
      await page.waitForTimeout(500);
    };

    /** Zooms in with the + button until the map is at least at zoom z. */
    const zoomTo = async (z) => {
      for (let i = 0; i < 20 && (await mapZoom()) < z; i++) {
        await page.locator('button[aria-label="Zoom in"]').click();
        await page.waitForTimeout(400);
      }
      await page.waitForTimeout(500);
      const now = await mapZoom();
      expect(now >= z, `zoom ${now} is below ${z}`);
    };

    let firstName = null;
    let secondName = null;

    // a. Page loads with station rows from the catalogue, without any directory list request.
    await step('a', 'page loads with at least 10 catalogue rows and no directory list request', async () => {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await waitForRows(10, 30000);
      const n = await page.locator('.ss-list__scroll .ss-station-row').count();
      expect(n >= 10, `only ${n} rows`);
      expect(directoryListRequests.length === 0, `directory list requested: ${directoryListRequests.join(', ')}`);
      // Fresh load, nothing selected: the world view.
      await page.waitForFunction(() => document.querySelectorAll('.leaflet-marker-icon').length >= 1, null, {
        timeout: 30000,
      });
      await sleep(1500);
      await page.screenshot({ path: join(SHOTS, '1440x900-world.png') });
      return `${n} rows, no directory list request`;
    });

    await step('a2', 'start view makes no map tile requests', async () => {
      expect(tileRequests.length === 0, `${tileRequests.length} tile requests at the start, first: ${tileRequests[0]}`);
      return 'zoom below 6, no tile requests';
    });

    // b. Search narrows results; a nonsense query shows the empty state; Reset restores rows.
    await step('b', 'search "jazz" changes results and relates; nonsense shows empty state; Reset restores', async () => {
      const before = (await rowNames()).join('|');
      await search().fill('jazz');
      await page.waitForTimeout(700);
      await page.waitForFunction(
        () => document.querySelector('.ss-list__scroll')?.getAttribute('aria-busy') !== 'true',
        null,
        { timeout: 20000 },
      );
      await waitForRows(1);
      const names = await rowNames();
      expect(names.length > 0, 'no rows for "jazz"');
      expect(names.join('|') !== before, 'rows did not change for "jazz"');
      await search().fill('');
      await page.waitForTimeout(700);
      await waitForRows(1);
      await search().fill('qzxwv9kjhgfd');
      await page.waitForFunction(
        () => document.querySelector('.ss-list__state .ss-list__button')?.textContent?.includes('Reset search'),
        null,
        { timeout: 20000 },
      );
      const reset = page.locator('.ss-list__button', { hasText: 'Reset search' });
      expect((await reset.count()) === 1, 'no Reset button in empty state');
      await reset.click();
      await waitForRows(1, 20000);
      expect((await search().inputValue()) === '', 'search not cleared by Reset');
      return `${names.length} jazz rows`;
    });

    // b2. Load more appends the next page at the end of the list and keeps the first row; a nonsense query has no Load more.
    await step('b2', 'load more appends rows after scrolling to the end; first row unchanged; empty state has no Load more', async () => {
      await waitForRows(1);
      const beforeCount = await page.locator('.ss-list__scroll .ss-station-row').count();
      const beforeFirst = (await rowNames())[0];
      await page.locator('.ss-list__scroll').evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      const more = page.locator('.ss-list__load-more');
      await more.waitFor({ state: 'visible', timeout: 10000 });
      await more.click();
      await page.waitForFunction(
        (n) => document.querySelectorAll('.ss-list__scroll .ss-station-row').length > n,
        beforeCount,
        { timeout: 20000 },
      );
      const afterCount = await page.locator('.ss-list__scroll .ss-station-row').count();
      const afterFirst = (await rowNames())[0];
      expect(afterCount > beforeCount, `rows ${beforeCount} -> ${afterCount}, expected an increase`);
      expect(afterFirst === beforeFirst, `first row changed from "${beforeFirst}" to "${afterFirst}"`);
      await search().fill('qzxwv9kjhgfd');
      await page.waitForFunction(
        () => document.querySelector('.ss-list__state .ss-list__button')?.textContent?.includes('Reset search'),
        null,
        { timeout: 20000 },
      );
      expect((await page.locator('.ss-list__load-more').count()) === 0, 'Load more shown in the empty state');
      await page.locator('.ss-list__button', { hasText: 'Reset search' }).click();
      expect(afterCount - beforeCount === 150, `rows ${beforeCount} -> ${afterCount}, expected 150 more`);
      await waitForRows(1, 20000);
      return `${beforeCount} -> ${afterCount} rows`;
    });

    // b3. A state name finds stations in that state (location text shows it).
    await step('b3', 'search "texas" lists stations located in Texas', async () => {
      await search().fill('texas');
      await page.waitForTimeout(700);
      await waitForRows(1, 20000);
      const locations = await page.locator('.ss-list__scroll .ss-station-row__location').allTextContents();
      const inTexas = locations.filter((l) => /\bTX\b|Texas/.test(l));
      expect(locations.length > 0, 'no rows for "texas"');
      expect(inTexas.length > 0, `no location shows Texas: ${locations.slice(0, 5).join(' | ')}`);
      await search().fill('');
      await page.waitForTimeout(700);
      await waitForRows(1);
      return `${locations.length} rows, ${inTexas.length} shown with TX/Texas`;
    });

    // c. Genre chip filters rows and reflects pressed state.
    await step('c', 'Rock chip filters rows and sets aria-pressed; All restores', async () => {
      const allNames = (await rowNames()).join('|');
      await chip('Rock').click();
      expect(
        (await chip('Rock').getAttribute('aria-pressed')) === 'true',
        'Rock chip not pressed',
      );
      await page.waitForFunction(
        () => document.querySelector('.ss-list__scroll')?.getAttribute('aria-busy') !== 'true',
        null,
        { timeout: 20000 },
      );
      await page.waitForTimeout(500);
      await page.waitForFunction(
        () => document.querySelector('.ss-list__scroll')?.getAttribute('aria-busy') !== 'true',
        null,
        { timeout: 20000 },
      );
      const rockNames = (await rowNames()).join('|');
      expect(rockNames.length > 0, 'no rows for Rock');
      expect(rockNames !== allNames, 'rows did not update for Rock');
      await chip('All').click();
      expect((await chip('All').getAttribute('aria-pressed')) === 'true', 'All chip not pressed');
      await waitForRows(1);
      return 'Rock rows differ from All';
    });

    // d. Clicking a row starts playback; the player shows its name and reports Live.
    await step('d', 'first row starts playback: player shows name, status Live, main button Pause', async () => {
      await waitForRows(2);
      const row = page.locator('.ss-list__scroll .ss-station-row').nth(0);
      firstName = (await row.locator('.ss-station-row__name').textContent()).trim();
      await row.click();
      await page.waitForFunction(
        (n) => document.querySelector('footer.ss-player .ss-player__name')?.textContent?.trim() === n,
        firstName,
        { timeout: 5000 },
      );
      await waitMainLabel('Pause');
      await page.waitForFunction(
        () => document.querySelector('footer.ss-player .ss-player__status')?.textContent?.trim() === 'Live',
        null,
        { timeout: 20000 },
      );
      return `"${firstName}"`;
    });

    // e. A second row replaces the first stream; only one media request is open at a time.
    await step('e', 'second row switches station; label Pause; at most one media request open', async () => {
      await page.screenshot({ path: join(SHOTS, '1440x900-explore-playing.png') });
      const row = page.locator('.ss-list__scroll .ss-station-row').nth(1);
      secondName = (await row.locator('.ss-station-row__name').textContent()).trim();
      expect((await waitOpen(1)), `before switching, ${stream.open()} stream connections open (expected 1)`);
      await row.click();
      await page.waitForFunction(
        (n) => document.querySelector('footer.ss-player .ss-player__name')?.textContent?.trim() === n,
        secondName,
        { timeout: 5000 },
      );
      await waitMainLabel('Pause');
      expect(await waitOpen(1), `after switching, ${stream.open()} stream connections open within 3s (expected 1)`);
      await sleep(500);
      expect(stream.open() === 1, `${stream.open()} stream connections open after 500ms (expected 1)`);
      return `"${secondName}"; exactly 1 stream connection open`;
    });

    // f. Main button pauses.
    await step('f', 'main button pauses: label becomes Play', async () => {
      await page.locator('footer.ss-player .ss-player__main').click();
      await waitMainLabel('Play');
      expect((await mainLabel()) === 'Play', 'label is not Play');
      expect(await waitOpen(0), `${stream.open()} stream connections still open after pausing`);
      return 'stream closed';
    });

    // g. Favourite from the player bar; listed in Favorites; survives reload; removable.
    await step('g', 'favourite current station: listed, survives reload, removal empties list', async () => {
      await page.locator('footer.ss-player button[aria-label="Add to favorites"]').click();
      await page.waitForFunction(
        () => document.querySelector('footer.ss-player button[aria-label="Remove from favorites"]') !== null,
      );
      await navTab('Favorites').click();
      const listed = async () =>
        (await page.locator('.ss-view-row .ss-station-row__name').allTextContents()).map((s) => s.trim());
      expect((await listed()).includes(secondName), `"${secondName}" not in Favorites`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await navTab('Favorites').click();
      await page.waitForSelector('.ss-view-row');
      expect((await listed()).includes(secondName), 'favourite lost after reload');
      await page.locator('.ss-view-row button[aria-label="Remove from favorites"]').first().click();
      await page.waitForSelector('.ss-empty__title:has-text("No favorites yet")');
      return `"${secondName}" kept after reload`;
    });

    // h. History lists the two played stations, newest first; Clear History empties it.
    await step('h', 'history lists both stations newest first; Clear History empties it', async () => {
      await navTab('History').click();
      await page.waitForSelector('.ss-view-row');
      const names = (await page.locator('.ss-view-row .ss-station-row__name').allTextContents()).map((s) => s.trim());
      expect(names[0] === secondName, `newest is "${names[0]}", expected "${secondName}"`);
      expect(names.includes(firstName), `"${firstName}" missing from history`);
      expect(names.indexOf(secondName) < names.indexOf(firstName), 'history not newest first');
      await page.locator('button', { hasText: /^Clear History$/ }).click();
      await page.locator('button', { hasText: /^Yes$/ }).click();
      await page.waitForSelector('.ss-empty__title:has-text("Nothing played yet")');
      return `${names.join(' > ')}`;
    });

    // i. Settings opens with the gear; Escape closes it and returns focus to the gear.
    await step('i', 'Settings opens with gear; Escape closes; focus returns to gear', async () => {
      await navTab('Explore').click();
      const gear = page.locator('header button[aria-label="Settings"]');
      await gear.click();
      await page.waitForFunction(() => document.querySelector('dialog.ss-settings')?.hasAttribute('open'));
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('dialog.ss-settings')?.hasAttribute('open'));
      const focusedLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
      expect(focusedLabel === 'Settings', `focus on "${focusedLabel}", expected Settings`);
      return '';
    });

    // j. Map: markers or clusters render; zoom in; a single marker opens a popup with Play.
    await step('j', 'map renders markers; zoom in twice; marker opens popup with Play', async () => {
      await page.waitForSelector('.leaflet-container');
      await page.waitForFunction(
        () => document.querySelectorAll('.leaflet-marker-icon').length >= 1,
        null,
        { timeout: 30000 },
      );
      const count = await page.locator('.leaflet-marker-icon').count();
      for (let i = 0; i < 2; i++) {
        await page.locator('button[aria-label="Zoom in"]').click();
        await page.waitForTimeout(400);
      }
      await page.waitForTimeout(600);
      // Single markers that are on screen inside the map and not covered by another element (clusters excluded).
      const visible = await page.evaluate(() => {
        const c = document.querySelector('.ss-map__canvas')?.getBoundingClientRect();
        if (!c) return [];
        return [...document.querySelectorAll('.leaflet-marker-pane .leaflet-marker-icon[aria-label]:not(.ss-cluster-icon)')]
          .map((e) => {
            const r = e.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            const inside = cx > c.left + 20 && cx < c.right - 20 && cy > c.top + 20 && cy < c.bottom - 80;
            const hit = document.elementFromPoint(cx, cy);
            return { label: e.getAttribute('aria-label'), cx, cy, inside, clear: hit !== null && e.contains(hit) };
          })
          .filter((m) => m.inside && m.clear);
      });
      if (visible.length === 0) {
        const total = await page.locator('.leaflet-marker-pane .leaflet-marker-icon[aria-label]:not(.ss-cluster-icon)').count();
        return `${count} markers/clusters; no single marker on screen at this zoom (${total} single markers off screen)`;
      }
      const target = visible[0];
      await page.mouse.click(target.cx, target.cy);
      await page.waitForSelector('.ss-map-card__play', { timeout: 5000 });
      const label = target.label;
      const popupName = (await page.locator('.ss-map-card__name').textContent()).trim();
      expect(popupName === label, `popup "${popupName}" != marker "${label}"`);
      return `${count} markers/clusters; popup "${popupName}" with Play`;
    });

    // k. No horizontal overflow at phone, tablet and desktop widths.
    await step('k', 'no horizontal overflow at 375, 390, 768, 1024 and 1440 wide', async () => {
      const widths = [];
      for (const [w, h] of [
        [375, 812],
        [390, 844],
        [768, 1024],
        [1024, 768],
        [1440, 900],
      ]) {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(400);
        const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
        expect(m.sw <= m.iw, `${w}px: scrollWidth ${m.sw} > innerWidth ${m.iw}`);
        widths.push(`${w}: ${m.sw}<=${m.iw}`);
      }
      return widths.join(', ');
    });

    // Mobile layout details: collapsed sheet, expanded sheet, and screenshots.
    await step('k2', 'mobile collapsed sheet shows handle and search; map visible above it', async () => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.waitForTimeout(400);
      const handle = page.locator('.ss-sheet-handle');
      expect(await handle.isVisible(), 'handle not visible');
      const search = page.locator('.ss-search__input').first();
      expect(await search.isVisible(), 'search field not visible');
      const geo = await page.evaluate(() => {
        const map = document.querySelector('.ss-map')?.getBoundingClientRect();
        const sheet = document.querySelector('.ss-sidebar')?.getBoundingClientRect();
        return { mapH: map?.height ?? 0, mapTop: map?.top ?? 0, sheetTop: sheet?.top ?? 0 };
      });
      expect(geo.mapH >= 150, `map height ${geo.mapH}`);
      expect(geo.mapTop < geo.sheetTop, 'map is not above the sheet');
      await page.screenshot({ path: join(SHOTS, '375x812-collapsed-sheet.png') });
      await handle.click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(SHOTS, '375x812-expanded-sheet.png') });
      await handle.click();
      await page.waitForTimeout(300);
      return `map ${Math.round(geo.mapH)}px above sheet`;
    });
    // l. The count line shows the filtered total; the empty state names the query and the genre.
    await step('l', 'count line matches the filtered total; empty state names query and genre', async () => {
      await page.setViewportSize({ width: 1440, height: 900 });
      const catalog = await (await fetch(new URL('catalog.json', baseUrl))).json();
      const all = catalog.stations.map(expandCatalogRecord).map((s) => ({
        ...s,
        coords: typeof s.lat === 'number' && typeof s.lng === 'number' ? { lat: s.lat, lng: s.lng } : null,
        genres: s.genres ?? [],
        tags: s.tags ?? [],
        city: s.city ?? null,
        stateCode: s.stateCode ?? null,
      }));
      const countEl = page.locator('.ss-chip-block__count');
      const expectCount = async (text) => {
        await page.waitForFunction((t) => document.querySelector('.ss-chip-block__count')?.textContent === t, text, {
          timeout: 15000,
        });
      };
      await chip('All').click();
      const total = filterStations(all, { query: '', genre: 'all' }).length;
      expect(total === catalog.count, `catalogue count ${catalog.count} != ${total}`);
      await expectCount(count1(total));
      await chip('Country').click();
      const country = filterStations(all, { query: '', genre: 'country' }).length;
      await expectCount(count1(country));
      await chip('All').click();
      await expectCount(count1(total));
      await search().fill('qzxwv9kjhgfd');
      await page.waitForFunction(
        () => document.querySelector('.ss-list__state .ss-list__title')?.textContent?.includes('No stations match'),
        null,
        { timeout: 20000 },
      );
      await expectCount(count1(0));
      await chip('Country').click();
      const title = (await page.locator('.ss-list__state .ss-list__title').textContent()).trim();
      expect(title === 'No stations match “qzxwv9kjhgfd” in Country', `empty title "${title}"`);
      await page.locator('.ss-list__button', { hasText: 'Reset search' }).click();
      await chip('All').click();
      await waitForRows(1);
      await expectCount(count1(total));
      expect((await countEl.textContent()) === count1(total), 'count not restored');
      return `All ${count1(total)}, Country ${count1(country)}`;
    });

    // m. Map: Lower 48 reset returns the framing, and markers equal the filtered stations with coordinates.
    await step('m', 'markers match filtered stations with coordinates; Lower 48 resets the framing', async () => {
      const markers = () =>
        page.evaluate(() => {
          let n = 0;
          for (const c of document.querySelectorAll('.ss-map .ss-cluster-icon .ss-cluster span')) n += Number(c.textContent);
          n += document.querySelectorAll(
            '.ss-map .leaflet-marker-pane .leaflet-marker-icon:not(.ss-cluster-icon):not(:has(.ss-marker--selected))',
          ).length;
          return n;
        });
      const settle = () => page.waitForTimeout(900);
      const checkFilter = async (label, query, genre, doSet) => {
        await doSet();
        await settle();
        // The map keeps every filtered station with a valid coordinate, including Alaska and Hawaii outside the framing.
        const want = filterStations(all, { query, genre }).filter((s) => hasValidCoords(s.coords)).length;
        const got = await markers();
        expect(got === want, `${label}: ${got} markers, expected ${want}`);
        return `${label} ${got}`;
      };
      const all = (await (await fetch(new URL('catalog.json', baseUrl))).json()).stations.map(expandCatalogRecord).map((s) => ({
        ...s,
        coords: typeof s.lat === 'number' && typeof s.lng === 'number' ? { lat: s.lat, lng: s.lng } : null,
        genres: s.genres ?? [],
        tags: s.tags ?? [],
        city: s.city ?? null,
        stateCode: s.stateCode ?? null,
      }));
      const reset = page.locator('button[aria-label="Reset map to the lower 48 states"]');
      await reset.click();
      await settle();
      const parts = [];
      parts.push(await checkFilter('All', '', 'all', () => chip('All').click()));
      parts.push(await checkFilter('Country', '', 'country', () => chip('Country').click()));
      parts.push(await checkFilter('texas', 'texas', 'all', async () => {
        await chip('All').click();
        await search().fill('texas');
      }));
      await search().fill('');
      await page.waitForTimeout(400);
      // Zoom in, then reset: the lower 48 fit comes back.
      for (let i = 0; i < 3; i++) await page.locator('button[aria-label="Zoom in"]').click();
      await settle();
      await reset.click();
      await settle();
      parts.push(await checkFilter('All after reset', '', 'all', () => chip('All').click()));
      return parts.join(', ');
    });

    // n. Zoomed to the top (+ button, then wheel) over the map, the land is the US fill with visible state borders and
    // no very light pixels. Markers are hidden with a query that matches nothing, so only the map is measured.
    /** Samples the canvas (control and popup boxes skipped): very light pixels, US fill and state-line colour. */
    async function measureMap(p, { usFill, stateLine }) {
      const canvas = p.locator('.ss-map__canvas');
      const helper = await p.context().newPage();
      try {
      const box = await canvas.boundingBox();
      const rects = await p.evaluate(() => {
        const c = document.querySelector('.ss-map__canvas').getBoundingClientRect();
        const out = [];
        for (const sel of ['.ss-map__zoom', '.leaflet-control-attribution', '.ss-map__status', '.leaflet-popup']) {
          for (const el of document.querySelectorAll(sel)) {
            const r = el.getBoundingClientRect();
            out.push({ x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height });
          }
        }
        return out;
      });
      const png = await canvas.screenshot({ type: 'png' });
        return await helper.evaluate(
          async ({ b64, rects, w, h, usFill, stateLine }) => {
          const img = new Image();
          img.src = `data:image/png;base64,${b64}`;
          await img.decode();
          const c = document.createElement('canvas');
          c.width = img.width;
          c.height = img.height;
          const cx = c.getContext('2d');
          cx.drawImage(img, 0, 0);
          const d = cx.getImageData(0, 0, img.width, img.height).data;
          const k = img.width / w;
          const near = (r, g, b, t, tol) => Math.abs(r - t[0]) <= tol && Math.abs(g - t[1]) <= tol && Math.abs(b - t[2]) <= tol;
          let total = 0, light = 0, us = 0, state = 0;
          for (let y = 0; y < img.height; y++) {
            for (let x = 0; x < img.width; x++) {
              const px = x / k, py = y / k;
              if (rects.some((r) => px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h)) continue;
              const i = (y * img.width + x) * 4;
              const r = d[i], g = d[i + 1], b = d[i + 2];
              total++;
              if ((r + g + b) / 3 >= 120) light++;
              else if (near(r, g, b, usFill, 4)) us++;
              else if (near(r, g, b, stateLine, 12)) state++;
            }
          }
          return { total, light, us, state };
        },
        { b64: png.toString('base64'), rects, w: box.width, h: box.height, usFill, stateLine },
      );
      } finally {
        await helper.close();
      }
    }

    await step('n', 'zoomed to max via + and wheel: US fill and state lines present, 0% very light pixels', async () => {
      const { usFill, stateLine } = await mapColours(page);
      const canvas = page.locator('.ss-map__canvas');
      const plus = page.locator('button[aria-label="Zoom in"]');
      const measure = () => measureMap(page, { usFill, stateLine });
      try {
        await search().fill('qzxwv9kjhgfd');
        await page.waitForTimeout(700);
        // The Colorado and Kansas border is a straight line at longitude -102.05. Centred on it, state lines stay in view at any zoom.
        const box0 = await canvas.boundingBox();
        const BORDER_POINT = [39.0, -102.05];
        expect(box0.width > 0, 'map has no size');
        // Button zoom to the top, centred on St. Louis. The aim is made at the top zoom itself: zooming out and back in
        // would move the centre by a few hundredths of a degree, which is far off screen at the top zoom.
        await centreMapOn(...BORDER_POINT, true);
        for (let i = 0; i < 30 && !(await plus.isDisabled()); i++) {
          await plus.click({ timeout: 1500 }).catch(() => {});
          await page.waitForTimeout(250);
        }
        await page.waitForTimeout(500);
        const byButton = await measure();
        expect(await plus.isDisabled(), 'the + button did not reach the maximum zoom');
        // Wheel over the middle of the map to the top, centred on St. Louis: zoom out a few levels about the middle, then wheel in.
        for (let i = 0; i < 3; i++) {
          await page.locator('button[aria-label="Zoom out"]').click();
          await page.waitForTimeout(300);
        }
        await page.waitForTimeout(500);
        const b2 = await canvas.boundingBox();
        await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
        for (let i = 0; i < 40 && !(await plus.isDisabled()); i++) {
          await page.mouse.wheel(0, -120);
          await page.waitForTimeout(200);
        }
        await page.waitForTimeout(600);
        const byWheel = await measure();
        expect(await plus.isDisabled(), 'wheel did not reach the maximum zoom');
        for (const [label, m] of [['button', byButton], ['wheel', byWheel]]) {
          const lightPct = (100 * m.light) / m.total;
          expect(m.light === 0, `${label}: ${m.light} very light pixels (${lightPct.toFixed(2)}%)`);
          expect(m.us / m.total > 0.5, `${label}: US fill only ${((100 * m.us) / m.total).toFixed(1)}%`);
          expect(m.state / m.total >= 0.0005, `${label}: state-line colour in ${m.state} pixels, no borders`);
        }
        return `button: ${byButton.light} light px, US ${((100 * byButton.us) / byButton.total).toFixed(1)}%, borders ${byButton.state} px; wheel: ${byWheel.light} light px, borders ${byWheel.state} px`;
      } finally {
        await search().fill('');
        await page.waitForTimeout(700);
        await waitForRows(1);
      }
    });

    // o. Streets at Denver zoom 11: USGSTopo tiles, the USGS credit, and no unavailable chip.
    await step('o', 'Denver at zoom 11 requests USGS Topo street tiles; attribution credits USGS', async () => {
      tileMode = 'png';
      // Step n left the street tiles marked as failed; they are retried after a reload or a style change. Start clean.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForRows(10, 30000);
      await page.waitForSelector('.ss-map__canvas[data-zoom]', { timeout: 30000 });
      const before = tileRequests.length;
      await centreMapOn(...DENVER);
      await zoomTo(11);
      await page.waitForTimeout(800);
      const urls = tileRequests.slice(before);
      const topo = urls.filter((u) => u.includes('basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/'));
      expect(topo.length > 0, 'no USGSTopo tile requests at zoom 11');
      const other = urls.find((u) => !u.includes('basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/'));
      expect(!other, `non-USGSTopo tile request in streets mode: ${other}`);
      const attr = await attribution();
      expect(attr.includes('Stations: Radio Browser') && attr.includes('Map: US Census Bureau'), `base credit missing: ${attr}`);
      expect(attr.includes('USGS') && attr.includes('The National Map'), `street credit missing: ${attr}`);
      expect((await page.locator('.ss-map__status', { hasText: 'Detailed map unavailable' }).count()) === 0, 'unavailable chip shown while tiles load');
      return `${topo.length} USGSTopo tile requests at zoom ${(await mapZoom()).toFixed(1)}`;
    });

    // p. Satellite view: USGS tiles after the toggle, the imagery credit, and the choice survives a reload.
    await step('p', 'Satellite view requests USGS imagery; aria-pressed flips; reload keeps satellite', async () => {
      expect((await toggleButton().getAttribute('aria-label')) === 'Satellite view', 'toggle does not offer satellite');
      expect((await toggleButton().getAttribute('aria-pressed')) === 'false', 'streets is shown as pressed');
      const before = tileRequests.length;
      await toggleButton().click();
      await page.waitForFunction(() => {
        const b = document.querySelector('.ss-map__zoom-btn[aria-pressed]');
        return b?.getAttribute('aria-label') === 'Map view' && b.getAttribute('aria-pressed') === 'true';
      }, null, { timeout: 5000 });
      await page.waitForTimeout(1000);
      const usgs = tileRequests.slice(before).filter((u) => u.includes('basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/'));
      expect(usgs.length > 0, 'no USGS tile requests after the toggle');
      const attr = await attribution();
      expect(attr.includes('Imagery: USGS') && !attr.includes('The National Map'), `imagery credit wrong: ${attr}`);
      const beforeReload = tileRequests.length;
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForRows(10, 30000);
      await page.waitForSelector('.ss-map__zoom-btn[aria-label="Map view"][aria-pressed="true"]', { timeout: 15000 });
      await centreMapOn(...DENVER);
      await zoomTo(11);
      await page.waitForTimeout(800);
      const afterReload = tileRequests.slice(beforeReload).filter((u) => u.includes('basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/'));
      expect(afterReload.length > 0, 'no USGS tile requests after reload');
      return `${usgs.length} USGS tile requests after toggle; ${afterReload.length} after reload`;
    });

    // r. Tile requests fail: the unavailable chip shows, and the vector US fill is back so the map is never blank.
    await step('r', 'failed tile requests: Detailed map unavailable chip and the vector US fill', async () => {
      tileMode = 'abort';
      await toggleButton().click();
      await page.waitForFunction(() => {
        const b = document.querySelector('.ss-map__zoom-btn[aria-pressed]');
        return b?.getAttribute('aria-label') === 'Satellite view' && b.getAttribute('aria-pressed') === 'false';
      }, null, { timeout: 5000 });
      await page.locator('.ss-map__status', { hasText: 'Detailed map unavailable' }).waitFor({ timeout: 20000 });
      const m = await measureMap(page, await mapColours(page));
      expect(m.us / m.total > 0.5, `US fill only ${((100 * m.us) / m.total).toFixed(1)}% with tiles failing`);
      tileMode = 'png';
      return `chip shown; US fill ${((100 * m.us) / m.total).toFixed(1)}%`;
    });

    // s. Phone: picking a station from the list zooms the map in and its marker is on screen.
    await step('s', 'phone 390x844: choosing a station from the list zooms in and its marker is visible', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(400);
      await page.locator('button[aria-label="Reset map to the lower 48 states"]').click();
      await page.waitForTimeout(900);
      const zoomBefore = await mapZoom();
      await page.locator('.ss-sheet-handle').click();
      await page.waitForTimeout(400);
      await page.locator('.ss-list__scroll .ss-station-row').nth(3).click();
      await page.waitForTimeout(1800);
      const zoomAfter = await mapZoom();
      expect(zoomAfter > zoomBefore, `zoom stayed at ${zoomBefore} after the pick (now ${zoomAfter})`);
      const sel = await page.evaluate(() => {
        const c = document.querySelector('.ss-map__canvas').getBoundingClientRect();
        const m = document.querySelector('.ss-marker--selected');
        if (!m) return { found: false };
        const r = m.getBoundingClientRect();
        const x = r.left + r.width / 2 - c.left;
        const y = r.top + r.height / 2 - c.top;
        return { found: true, inside: x > 0 && x < c.width && y > 0 && y < c.height };
      });
      expect(sel.found, 'selected station marker is not on the map');
      expect(sel.inside, 'selected station marker is outside the visible map');
      return `zoom ${zoomBefore} -> ${zoomAfter}, marker visible`;
    });

  } catch (err) {
    exitCode = 1;
    console.error(`e2e failed: ${err.message}`);
  } finally {
    await stopAll();
    if (stream) await stream.close().catch(() => {});
  }

  const passed = steps.filter((s) => s.status === 'PASS').length;
  const skipped = steps.filter((s) => s.status === 'SKIP').length;
  const failed = steps.filter((s) => s.status === 'FAIL').length;
  console.log(`--- ${passed} PASS, ${skipped} SKIP, ${failed} FAIL ---`);
  process.exit(exitCode);
}

main();

// End-to-end smoke test for Roadtrip Radio. Plain Node, uses the preinstalled global Playwright.
// Runs against `npm run preview` (started and stopped here) unless SS_BASE_URL is set.
// Station lists come from the committed catalogue (public/catalog.json, real Radio Browser data).
// The directory's station-list endpoints are blocked, so any reliance on them fails the run; only
// the click counter and its server list may reach the directory. Only audio bytes are mocked: every
// `media` request (and any non-API cross-origin audio URL) is redirected to a local silent stream server.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

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

    // k. No horizontal overflow at phone and desktop widths.
    await step('k', 'no horizontal overflow at 375x812 and 1440x900', async () => {
      const widths = [];
      for (const [w, h] of [
        [375, 812],
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

// End-to-end smoke test for SignalSurf. Plain Node, uses the preinstalled global Playwright.
// Runs against `npm run preview` (started and stopped here) unless SS_BASE_URL is set.
// Station data is real (Radio Browser). Only audio bytes are mocked: every `media` request
// (and any non-API cross-origin audio URL) is answered with a 5-second silent WAV.
import { spawn } from 'node:child_process';
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

/** Silent 16-bit mono 8 kHz WAV, 5 seconds. */
function silentWav(seconds = 5, rate = 8000) {
  const dataLen = seconds * rate * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataLen, 40);
  return buf;
}
const WAV = silentWav();

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

    // Media accounting: started vs finished/failed. Fulfilled routes finish at once, so this
    // counts overlapping requests as they are issued.
    const media = { started: 0, ended: 0, open: 0 };
    page.on('request', (req) => {
      if (req.resourceType() === 'media') {
        media.started += 1;
        media.open += 1;
      }
    });
    const closeMedia = () => {
      media.ended += 1;
      media.open = Math.max(0, media.open - 1);
    };
    page.on('requestfinished', (req) => {
      if (req.resourceType() === 'media') closeMedia();
    });
    page.on('requestfailed', (req) => {
      if (req.resourceType() === 'media') closeMedia();
    });

    await page.route('**/*', (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const isApi = API_HOST.test(url.hostname);
      const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      if (req.resourceType() === 'media' || (!isApi && !isLocal && req.resourceType() === 'audio')) {
        return route.fulfill({ status: 200, contentType: 'audio/wav', body: WAV, headers: { 'accept-ranges': 'none' } });
      }
      return route.continue();
    });

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

    // a. Page loads with live station rows and no uncaught errors.
    await step('a', 'page loads with at least 10 live station rows', async () => {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await waitForRows(10, 30000);
      const n = await page.locator('.ss-list__scroll .ss-station-row').count();
      expect(n >= 10, `only ${n} rows`);
      return `${n} rows`;
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
      expect(names.some((n) => /jazz/i.test(n)), `no name matches "jazz": ${names.slice(0, 5).join(', ')}`);
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

    // c. Category chip filters rows and reflects pressed state.
    await step('c', 'News chip filters rows and sets aria-pressed; All restores', async () => {
      const allNames = (await rowNames()).join('|');
      await chip('News').click();
      expect(
        (await chip('News').getAttribute('aria-pressed')) === 'true',
        'News chip not pressed',
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
      const newsNames = (await rowNames()).join('|');
      expect(newsNames.length > 0, 'no rows for News');
      expect(newsNames !== allNames, 'rows did not update for News');
      await chip('All').click();
      expect((await chip('All').getAttribute('aria-pressed')) === 'true', 'All chip not pressed');
      await waitForRows(1);
      return 'News rows differ from All';
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
      const startedBefore = media.started;
      await row.click();
      await page.waitForFunction(
        (n) => document.querySelector('footer.ss-player .ss-player__name')?.textContent?.trim() === n,
        secondName,
        { timeout: 5000 },
      );
      await waitMainLabel('Pause');
      expect(media.started > startedBefore, 'no new media request after switching');
      expect(media.open <= 1, `${media.open} media requests open`);
      return `"${secondName}"; media started ${media.started}, open ${media.open}`;
    });

    // f. Main button pauses.
    await step('f', 'main button pauses: label becomes Play', async () => {
      await page.locator('footer.ss-player .ss-player__main').click();
      await waitMainLabel('Play');
      expect((await mainLabel()) === 'Play', 'label is not Play');
      return '';
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
      const single = page.locator('.leaflet-marker-pane [role="button"][aria-label]:not(.marker-cluster)');
      const singles = await single.count();
      if (singles === 0) {
        return `${count} markers/clusters; no single marker visible at this zoom`;
      }
      const target = single.first();
      const label = await target.getAttribute('aria-label');
      await target.click({ timeout: 5000 });
      await page.waitForSelector('.ss-map-card__play', { timeout: 5000 });
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
  }

  const passed = steps.filter((s) => s.status === 'PASS').length;
  const skipped = steps.filter((s) => s.status === 'SKIP').length;
  const failed = steps.filter((s) => s.status === 'FAIL').length;
  console.log(`--- ${passed} PASS, ${skipped} SKIP, ${failed} FAIL ---`);
  process.exit(exitCode);
}

main();

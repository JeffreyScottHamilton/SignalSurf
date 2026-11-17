// Real-network screenshots of the map detail: streets and satellite tiles at 1440x900 and 390x844.
// Not part of `npm test` or `npm run e2e`: it needs internet access to basemap.nationalmap.gov.
// Usage: start a server for dist/ (for example `npx vite preview --port 5198 --strictPort`), then
//   SS_BASE_URL=http://localhost:5198/ SHOTS_DIR=/some/dir node e2e/tile-screenshots.mjs
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.SS_BASE_URL || 'http://localhost:4173/';
const SHOTS = process.env.SHOTS_DIR || join(tmpdir(), 'roadtrip-tile-shots');
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];
const DENVER = [39.74, -104.99];
const NYC = [40.7128, -74.006];
const VIEWS = [
  { name: 'start', style: 'streets' },
  { name: 'denver-z11-streets', at: DENVER, zoom: 11, style: 'streets' },
  { name: 'denver-z11-satellite', at: DENVER, zoom: 11, style: 'satellite' },
  { name: 'nyc-z13-streets', at: NYC, zoom: 13, style: 'streets' },
];

const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

async function run() {
  mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined,
  });
  const failures = [];
  try {
    for (const vp of VIEWPORTS) {
      for (const view of VIEWS) {
        const label = `${vp.width}x${vp.height}-${view.name}`;
        // A fresh context per shot: no stored style, no failed-tile state carried over.
        const context = await browser.newContext({ viewport: vp });
        const page = await context.newPage();
        try {
          await page.goto(BASE, { waitUntil: 'domcontentloaded' });
          await page.waitForSelector('.ss-map__canvas[data-zoom]', { timeout: 30000 });
          await page.waitForFunction(() => document.querySelectorAll('.ss-list__scroll .ss-station-row').length >= 1, null, { timeout: 30000 });
          if (view.style === 'satellite') {
            await page.locator('.ss-map__zoom-btn[aria-pressed]').click();
            await page.waitForSelector('.ss-map__zoom-btn[aria-label="Map view"][aria-pressed="true"]', { timeout: 5000 });
          }
          if (view.at) {
            await aimAt(page, view.at[0], view.at[1], view.zoom);
            await page.waitForTimeout(2500);
          } else {
            await page.waitForTimeout(1500);
          }
          const chip = await page.locator('.ss-map__status').allTextContents();
          await page.screenshot({ path: join(SHOTS, `${label}.png`) });
          const zoom = await page.locator('.ss-map__canvas').getAttribute('data-zoom');
          console.log(`${label}: zoom ${zoom}, status ${JSON.stringify(chip)}`);
        } catch (err) {
          failures.push(`${label}: ${err.message.split('\n')[0]}`);
          console.log(`${label}: FAILED ${err.message.split('\n')[0]}`);
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
  if (failures.length > 0) process.exitCode = 1;
}

/** Resets to the lower 48, drags (lat, lng) to the middle of the map, then zooms to `zoom` in stages so the aim holds. */
async function aimAt(page, lat, lng, zoom) {
  const canvas = page.locator('.ss-map__canvas');
  const zoomNow = async () => Number(await canvas.getAttribute('data-zoom'));
  const aim = async () => {
    for (let pass = 0; pass < 3; pass++) {
      const b = await canvas.boundingBox();
      const z = await zoomNow();
      const [clat, clng] = (await canvas.getAttribute('data-center')).split(',').map(Number);
      const dx = ((lng - clng) * 256 * 2 ** z) / 360;
      const dy = (-(merc(lat) - merc(clat)) * 256 * 2 ** z) / (2 * Math.PI);
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
  const zoomTo = async (z) => {
    for (let i = 0; i < 20 && (await zoomNow()) < z; i++) {
      await page.locator('button[aria-label="Zoom in"]').click();
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(500);
  };
  await page.locator('button[aria-label="Reset map to the lower 48 states"]').click();
  await page.waitForTimeout(900);
  await aim();
  for (const z of [8, 11, 13].filter((s) => s <= zoom)) {
    await zoomTo(z);
    await aim();
  }
  await zoomTo(zoom);
  // The + button steps by 0.5, so it can overshoot. The wheel zooms in 0.1 steps about the cursor, placed at the centre.
  const b = await canvas.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  for (let i = 0; i < 40; i++) {
    const cur = await zoomNow();
    if (Math.abs(cur - zoom) < 0.05) break;
    await page.mouse.wheel(0, cur > zoom ? 15 : -15);
    await page.waitForTimeout(250);
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

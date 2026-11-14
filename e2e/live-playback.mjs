// Live playback check. Plain Node, uses the preinstalled global Playwright.
// Real internet radio: stations come from the committed catalogue (public/catalog.json), are found
// with the app's own search box and clicked. No media request is intercepted or replaced. The only
// route used is the deliberate abort in the error test. Test-side hook: an init script remembers every
// HTMLMediaElement (window.__ssMedia).
// Targets are catalogue stations on a stream host that answers a probe from this machine. When none
// does, the run prints a SKIP line with the most common catalogue stream hosts and exits 0.
// Runs against `npm run preview` (started and stopped here) unless LIVE_BASE_URL is set.
//
// Every target is tried. A target that never reaches Live stays in the table with the observed reason.
// The switching test uses the first two stations that reached Live. Exit 0 needs at least two
// stations playing and switching, pause, volume, history and error all passing.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4173;
const OUT = '/tmp/claude-0/-home-user/56aa8976-1187-5e42-9581-774146525f7d/scratchpad/live';
const API_HOST = /(^|\.)radio-browser\.info$/;
const CATALOG = join(ROOT, 'public', 'catalog.json');
const PROBE_TIMEOUT_MS = 8000;
const MAX_TARGETS = 4;
const WINDOW_MS = 12_000;
const SAMPLE_MS = 250;
const MIN_PLAYING = 2;
const STREAM_TYPES = ['media', 'audio', 'xhr', 'fetch'];

// Stream hosts this script will try. Each is probed before use; the catalogue is US-only.
const LIVE_HOSTS = [
  'ice6.somafm.com',
  'stream.live.vc.bbcmedia.co.uk',
  'liveradio.swr.de',
  'stream.radiofrance.fr',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};
/** Reads the catalogue from disk (no network): the stations and their stream hosts. */
function catalogStations() {
  return JSON.parse(readFileSync(CATALOG, 'utf8')).stations;
}

/** True when the stream answers with a success status from this machine (redirects followed, body not read). */
async function probe(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'icy-metadata': '0' } });
    await res.body?.cancel();
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Catalogue stations on a LIVE_HOSTS stream that answer a probe, at most one per host, at most MAX_TARGETS.
 * Target shape: { n, id, name, query, host, url }.
 */
async function chooseTargets() {
  const candidates = catalogStations().filter((s) => LIVE_HOSTS.includes(hostOf(s.streamUrl)));
  const perHost = new Map();
  for (const s of candidates) {
    const host = hostOf(s.streamUrl);
    if (!perHost.has(host)) perHost.set(host, s);
  }
  const targets = [];
  for (const [host, s] of perHost) {
    if (targets.length >= MAX_TARGETS) break;
    if (await probe(s.streamUrl)) {
      targets.push({ n: targets.length + 1, id: s.id, name: s.name, query: s.name, host, url: s.streamUrl });
    } else {
      console.log(`probe ${host}: not reachable from this machine (${s.name})`);
    }
  }
  return targets;
}

/** The most common stream hosts in the catalogue, for the report. */
function topHosts(n = 15) {
  const counts = new Map();
  for (const s of catalogStations()) {
    const h = hostOf(s.streamUrl) || '?';
    counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, n);
}

const fmt = (v) => (v === null || v === undefined ? '-' : typeof v === 'number' ? v.toFixed(2) : String(v));

/** Read-only snapshot of the player UI and every media element the page created. */
function pageState() {
  const q = (s) => document.querySelector(s);
  // The status line's visible text only: the visually hidden copy of the error sentence is dropped.
  const statusNode = q('footer.ss-player .ss-player__status');
  let statusText = null;
  if (statusNode) {
    const copy = statusNode.cloneNode(true);
    copy.querySelectorAll('.ss-sr-only').forEach((n) => n.remove());
    statusText = copy.textContent.trim();
  }
  const els = window.__ssMedia ?? [];
  const el = els.length ? els[els.length - 1] : null;
  const playing = els.filter((e) => !e.paused);
  return {
    label: q('footer.ss-player .ss-player__main')?.getAttribute('aria-label') ?? null,
    status: statusText,
    errText: q('footer.ss-player .ss-player__error')?.textContent ?? null,
    tryAgain: [...document.querySelectorAll('footer.ss-player .ss-player__text-btn')].some(
      (b) => b.textContent === 'Try again',
    ),
    count: els.length,
    nonPaused: playing.length,
    srcs: playing.map((e) => e.currentSrc || e.src || ''),
    paused: el ? el.paused : null,
    readyState: el ? el.readyState : null,
    networkState: el ? el.networkState : null,
    currentTime: el ? Number(el.currentTime.toFixed(2)) : null,
    volume: el ? el.volume : null,
    errorCode: el?.error?.code ?? null,
    src: el ? el.currentSrc || el.src || '' : '',
    mediaTitle: navigator.mediaSession?.metadata?.title ?? null,
  };
}

/** Lists the station rows currently shown, with the station object behind each (React props, read-only). */
function rowInfo() {
  return [...document.querySelectorAll('.ss-list__scroll .ss-station-row')].map((btn, index) => {
    const name = btn.querySelector('.ss-station-row__name')?.textContent ?? '';
    const key = Object.keys(btn).find((k) => k.startsWith('__reactFiber$'));
    let f = key ? btn[key] : null;
    let station = null;
    while (f && !station) {
      if (f.memoizedProps?.station) station = f.memoizedProps.station;
      f = f.return;
    }
    return { index, name, id: station?.id ?? null, streamUrl: station?.streamUrl ?? null };
  });
}

const INIT_SCRIPT = () => {
  const RealAudio = window.Audio;
  window.__ssMedia = [];
  const remember = (el) => {
    if (!window.__ssMedia.includes(el)) window.__ssMedia.push(el);
    return el;
  };
  const Wrapped = function Audio(src) {
    return remember(arguments.length ? new RealAudio(src) : new RealAudio());
  };
  Wrapped.prototype = RealAudio.prototype;
  window.Audio = Wrapped;
  const realPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function play(...args) {
    remember(this);
    return realPlay.apply(this, args);
  };
};

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
    await sleep(250);
  }
  throw new Error(`Preview server did not answer at ${url}`);
}

async function main() {
  if (!existsSync(join(ROOT, 'dist', 'index.html')) && !process.env.LIVE_BASE_URL) {
    console.error('dist/ is missing. Run `npm run build` first.');
    return 1;
  }
  const targets = await chooseTargets();
  if (targets.length === 0) {
    console.log('SKIP live-playback: no reachable stream host in catalogue.');
    console.log('Most common stream hosts in the catalogue (count, host):');
    for (const [host, count] of topHosts()) console.log(`  ${String(count).padStart(4)}  ${host}`);
    console.log('Allow one of these hosts from this network to run live playback.');
    return 0;
  }
  console.log(`live targets: ${targets.map((t) => `${t.name} (${t.host})`).join('; ')}`);
  mkdirSync(OUT, { recursive: true });
  const baseUrl = process.env.LIVE_BASE_URL || `http://localhost:${PORT}/`;
  const appHost = hostOf(baseUrl);
  const preview = process.env.LIVE_BASE_URL ? null : startPreview();
  let browser = null;
  let exitCode = 1;
  const log = [];
  const say = (line) => {
    log.push(line);
    console.log(line);
  };
  const progress = (line) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`);

  try {
    await waitForServer(baseUrl);
    browser = await chromium.launch({
      proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined,
    });
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
    await context.addInitScript(INIT_SCRIPT);
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    // Stream traffic: open requests (for the switch check), every response (status, redirect target)
    // and every failed request, for the reason column.
    const openReqs = new Map();
    const netLog = [];
    const failLog = [];
    const isStreamReq = (req) =>
      STREAM_TYPES.includes(req.resourceType()) && !API_HOST.test(hostOf(req.url())) && hostOf(req.url()) !== appHost;
    page.on('request', (req) => {
      if (isStreamReq(req)) openReqs.set(req, { url: req.url(), t: Date.now() });
    });
    page.on('requestfinished', (req) => openReqs.delete(req));
    page.on('requestfailed', (req) => {
      openReqs.delete(req);
      if (isStreamReq(req)) {
        failLog.push({
          t: Date.now(),
          host: hostOf(req.url()),
          via: hostOf(req.redirectedFrom()?.url() ?? ''),
          text: req.failure()?.errorText ?? '',
        });
      }
    });
    page.on('response', (resp) => {
      const req = resp.request();
      if (!isStreamReq(req)) return;
      const headers = resp.headers();
      netLog.push({
        t: Date.now(),
        host: hostOf(req.url()),
        status: resp.status(),
        location: headers.location ? hostOf(new URL(headers.location, req.url()).href) : '',
        via: hostOf(req.redirectedFrom()?.url() ?? ''),
        ct: headers['content-type'] ?? '',
      });
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('.ss-list__scroll .ss-station-row').length >= 1, null, {
      timeout: 60000,
    });

    const liveLog = []; // every station that reached Live, in order (for the history test)
    const searchBox = () => page.locator('#ss-station-search');

    async function search(q) {
      await searchBox().fill(q);
      await sleep(900);
      await page.waitForFunction(
        () => document.querySelector('.ss-list__scroll')?.getAttribute('aria-busy') !== 'true',
        null,
        { timeout: 30000 },
      );
      await sleep(300);
    }

    /** Searches the target by name, then picks the row with its catalogue id. */
    async function findRow(target) {
      await search(target.query);
      const rows = await page.evaluate(rowInfo);
      const considered = rows.filter((r) => r.name === target.name).map((r) => `${r.name} -> ${hostOf(r.streamUrl ?? '') || '?'}`);
      const row = rows.find((r) => r.id === target.id);
      if (!row) return { found: false, considered };
      return { found: true, index: row.index, name: row.name, id: row.id, url: row.streamUrl, host: hostOf(row.streamUrl ?? ''), codec: '?', considered };
    }

    const clickRow = async (row) => {
      await page.locator('.ss-list__scroll .ss-station-row').nth(row.index).click();
      return Date.now();
    };

    const snapshot = () => page.evaluate(pageState);
    const isLive = (s) => s.label === 'Pause' && s.status === 'Live';

    async function waitForLive(timeoutMs) {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) {
        const s = await snapshot();
        if (isLive(s)) return true;
        await sleep(SAMPLE_MS);
      }
      return false;
    }

    /** Samples the player every 250ms for `durationMs`. Records status transitions. */
    async function watch(durationMs, onSample) {
      const start = Date.now();
      const samples = [];
      const seq = [];
      let last = '';
      for (;;) {
        const t = (Date.now() - start) / 1000;
        const s = await snapshot();
        s.t = t;
        samples.push(s);
        const key = `${s.label}/${s.status}`;
        if (key !== last) {
          seq.push(`${t.toFixed(1)}s ${key}`);
          last = key;
        }
        if (onSample) onSample(s);
        if (t * 1000 >= durationMs) break;
        await sleep(SAMPLE_MS);
      }
      return { samples, seq };
    }

    /** What the network showed for one station after its click: statuses, redirects, failures. */
    function observedReason(rec, clickAt) {
      const hops = netLog
        .filter((n) => n.t >= clickAt && (n.host === rec.host || n.via === rec.host))
        .slice(0, 4)
        .map((n) => (n.status >= 300 && n.status < 400 ? `${n.status} ${n.host} -> ${n.location || '?'}` : `HTTP ${n.status} ${n.host}`));
      const fails = failLog
        .filter((f) => f.t >= clickAt && (f.host === rec.host || f.via === rec.host))
        .map((f) => `${f.text || 'failed'} ${f.host}`);
      const parts = [];
      if (hops.length) parts.push([...new Set(hops)].join('; '));
      if (fails.length) parts.push(`request failed: ${fails[0]}`);
      if (!hops.length && !fails.length) parts.push('no request reached the stream host');
      return parts.join('; ');
    }

    // ---- Every target, in order: click, then 12s of observation each.
    const results = [];
    let screenshotPlaying = false;
    for (const target of targets) {
      const rec = { target, row: null, live: false, pass: false };
      results.push(rec);
      progress(`station ${target.n}: searching "${target.query}"`);
      const row = await findRow(target);
      rec.row = row;
      progress(`station ${target.n}: row ${row.found ? `${row.name} on ${row.host}` : 'not found'} (considered: ${row.considered.join('; ') || 'none'})`);
      if (!row.found) {
        say(`  station ${target.n}: no row on ${target.host} (rows seen: ${row.considered.join('; ') || 'none'})`);
        continue;
      }
      const clickAt = await clickRow(row);
      progress(`station ${target.n}: clicked, observing ${WINDOW_MS / 1000}s`);
      const w = await watch(WINDOW_MS, (s) => {
        if (isLive(s) && !rec.live) {
          rec.live = true;
          liveLog.push({ id: row.id, name: row.name });
        }
      });
      progress(`station ${target.n}: label=${w.samples.at(-1).label} status=${w.samples.at(-1).status} live=${rec.live}`);
      const at = (sec) => w.samples.find((s) => s.t >= sec) ?? w.samples[w.samples.length - 1];
      const t2 = at(2);
      const t10 = at(10);
      const end = w.samples[w.samples.length - 1];
      rec.name = row.name;
      rec.host = row.host;
      rec.codec = row.codec;
      rec.t2 = t2;
      rec.t10 = t10;
      rec.seq = w.seq;
      rec.reason = observedReason(rec, clickAt);
      rec.errCodes = [...new Set(w.samples.map((s) => s.errorCode).filter((c) => c !== null))];
      rec.sawTryAgain = w.samples.some((s) => s.tryAgain);
      rec.advance = t2.currentTime !== null && t10.currentTime !== null ? t10.currentTime - t2.currentTime : null;
      rec.pass =
        isLive(t10) &&
        t10.paused === false &&
        t10.errorCode === null &&
        !rec.sawTryAgain &&
        rec.advance !== null &&
        rec.advance >= 5 &&
        rec.live;
      rec.mediaTitle = t10.mediaTitle;
      rec.end = `${end.label}/${end.status}`;
      rec.url = row.url;
      if (!screenshotPlaying && isLive(end)) {
        await page.screenshot({ path: join(OUT, 'playing-1440.png') });
        screenshotPlaying = true;
      }
    }

    const liveResults = results.filter((r) => r.live);
    progress(`reached Live: ${liveResults.map((r) => `#${r.target.n}`).join(', ') || 'none'}`);

    // ---- Switching: the first two stations that reached Live. From the first, click the second.
    progress('switching, volume, pause, error, history');
    let switchOk = false;
    let switchLine = `switching: needs two stations that reached Live (have ${liveResults.length}); not measured`;
    if (liveResults.length >= 2) {
      const [from, to] = liveResults;
      const now = await snapshot();
      let fromPlaying = isLive(now) && now.srcs.some((x) => x.includes(from.host));
      if (!fromPlaying) {
        const again = await findRow(from.target);
        if (again.found) {
          await clickRow(again);
          fromPlaying = await waitForLive(20000);
          if (fromPlaying) liveLog.push({ id: again.id, name: again.name });
        }
      }
      const again = await findRow(to.target);
      if (fromPlaying && again.found) {
        const prevSet = new Set([...openReqs.keys()].filter((r) => hostOf(r.url()) === from.host));
        await clickRow(again);
        let at5 = null;
        let toLive = false;
        await watch(WINDOW_MS, (s) => {
          if (s.t >= 5 && at5 === null) {
            at5 = {
              nonPaused: s.nonPaused,
              srcs: s.srcs,
              prevOpen: [...prevSet].filter((r) => openReqs.has(r)).length,
              prevCount: prevSet.size,
            };
          }
          if (isLive(s) && !toLive) {
            toLive = true;
            liveLog.push({ id: again.id, name: again.name });
          }
        });
        switchOk =
          !!at5 &&
          toLive &&
          at5.nonPaused === 1 &&
          !at5.srcs.some((x) => x.includes(from.host)) &&
          at5.prevCount > 0 &&
          at5.prevOpen === 0;
        switchLine =
          `switching ${from.target.n}->${to.target.n}: at t=5s non-paused=${at5?.nonPaused} ` +
          `srcs=[${(at5?.srcs ?? []).map((x) => hostOf(x) || 'none').join(',')}] ` +
          `station ${from.target.n} requests open=${at5?.prevOpen}/${at5?.prevCount} (at click); reached Live=${toLive} ${switchOk ? 'PASS' : 'FAIL'}`;
      } else {
        switchLine = `switching ${from.target.n}->${to.target.n}: ${fromPlaying ? 'second station row not found' : 'first station did not play again'} FAIL`;
      }
    }

    // ---- Volume and pause need a station that is Live (the switch target is playing after the switch).
    const liveRec = [...liveResults].reverse()[0];
    let playingNow = false;
    if (liveRec) {
      if (isLive(await snapshot())) {
        playingNow = true;
      } else {
        const again = await findRow(liveRec.target);
        if (again.found) {
          await clickRow(again);
          playingNow = await waitForLive(20000);
          if (playingNow) liveLog.push({ id: again.id, name: again.name });
        }
      }
    }

    let volumeOk = false;
    let volumeLine = 'volume: no Live station to test';
    let pauseOk = false;
    let pauseLine = 'pause: no Live station to test';
    if (playingNow) {
      await page.locator('input.ss-player__volume').fill('0.3');
      await sleep(400);
      const v = (await snapshot()).volume;
      volumeOk = v !== null && Math.abs(v - 0.3) < 0.01;
      volumeLine = `volume: slider 0.3 -> element.volume=${fmt(v)} ${volumeOk ? 'PASS' : 'FAIL'}`;

      await page.locator('footer.ss-player .ss-player__main').click();
      await sleep(1500);
      const p1 = await snapshot();
      await sleep(3000);
      const p2 = await snapshot();
      pauseOk = p1.label === 'Play' && p1.paused === true && p2.paused === true && p2.currentTime === p1.currentTime;
      pauseLine =
        `pause: label=${p1.label} status=${p1.status} paused=${p1.paused} currentTime ${fmt(p1.currentTime)} -> ${fmt(p2.currentTime)} ` +
        `${pauseOk ? 'PASS' : 'FAIL'}`;
      // Resume so the error test starts from a playing state.
      if (pauseOk) {
        await page.locator('footer.ss-player .ss-player__main').click();
        await waitForLive(20000);
      }
    }

    // ---- Error: abort the host of a station that played, click it, expect an error sentence and Try again.
    const errRec = liveResults.find((r) => r.row?.found) ?? results.find((r) => r.row?.found);
    let errorOk = false;
    let errorLine = 'error: no station to test';
    if (errRec) {
      const errHost = errRec.host;
      const predicate = (url) => url.hostname === errHost;
      const handler = (route) => route.abort();
      await page.route(predicate, handler);
      const row = await findRow(errRec.target);
      const clickAt = Date.now();
      await clickRow(row);
      const shown = await page
        .waitForFunction(
          () =>
            [...document.querySelectorAll('footer.ss-player .ss-player__text-btn')].some((b) => b.textContent === 'Try again') &&
            (document.querySelector('footer.ss-player .ss-player__error')?.textContent ?? '').length > 0,
          null,
          { timeout: 25000 },
        )
        .then(() => true)
        .catch(() => false);
      const secs = ((Date.now() - clickAt) / 1000).toFixed(1);
      const errState = await snapshot();
      if (shown) await page.screenshot({ path: join(OUT, 'error-1440.png') });
      await page.unroute(predicate, handler);
      const other =
        liveResults.find((r) => r.host !== errHost) ??
        results.find((r) => r.row?.found && r.host !== errHost && r.n !== errRec.target.n);
      let otherOk = false;
      let otherLine = 'no other station to test';
      if (other) {
        const again = await findRow(other.target);
        if (again.found) {
          await clickRow(again);
          const ok = await waitForLive(20000);
          let adv = null;
          if (ok) {
            const a = await snapshot();
            await sleep(5000);
            const b = await snapshot();
            adv = b.currentTime - a.currentTime;
          }
          otherOk = ok && adv !== null && adv >= 3;
          if (ok) liveLog.push({ id: again.id, name: again.name });
          otherLine = `then station ${other.target.n} (${again.host}): Live=${ok} currentTime advance over 5s=${fmt(adv)}`;
        }
      }
      errorOk = shown && otherOk;
      errorLine =
        `error: aborted ${errHost}; error sentence=${shown ? JSON.stringify(errState.errText) : 'none'} ` +
        `Try again=${errState.tryAgain} after ${secs}s; ${otherLine} ${errorOk ? 'PASS' : 'FAIL'}`;
    }

    // ---- History: must list the stations that reached Live, newest first.
    await page.locator('header nav button', { hasText: /^History$/ }).click();
    await page.waitForSelector('#ss-history-title', { timeout: 10000 });
    await sleep(500);
    const names = await page.locator('.ss-view-row .ss-station-row__name').allTextContents();
    const seen = new Map();
    for (const e of liveLog) seen.set(e.id, e.name); // last Live occurrence wins
    const order = [];
    for (const e of [...liveLog].reverse()) {
      if (!order.includes(e.id)) order.push(e.id);
    }
    const expected = order.map((id) => seen.get(id));
    const historyOk = expected.length > 0 && JSON.stringify(expected) === JSON.stringify(names);
    const historyLine = `history: expected newest first=[${expected.join(' | ')}] shown=[${names.join(' | ')}] ${historyOk ? 'PASS' : 'FAIL'}`;

    progress('report');
    // ---- Report.
    const header = [
      'Station', 'Host', 'Stream path', 'Codec', 'Label(t10)', 'Status(t10)', 'paused', 'readyState', 'networkState',
      'ct t2', 'ct t10', 'advance', 'error', 'Observed reason', 'Result',
    ];
    const rows = results.map((r) => {
      if (!r.row || !r.row.found) {
        return [`#${r.target.n} ${r.target.query}`, r.target.host, '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-',
          `no search row (rows seen: ${(r.row?.considered ?? []).join('; ') || 'none'})`, 'FAIL'];
      }
      const path = r.url ? new URL(r.url).pathname.slice(0, 28) : '-';
      return [
        r.name,
        r.host,
        path,
        r.codec,
        r.t10.label,
        r.t10.status,
        fmt(r.t10.paused),
        fmt(r.t10.readyState),
        fmt(r.t10.networkState),
        fmt(r.t2.currentTime),
        fmt(r.t10.currentTime),
        fmt(r.advance),
        r.errCodes.length ? r.errCodes.join(',') : 'none',
        r.pass ? '-' : r.reason,
        r.pass ? 'PASS' : 'FAIL',
      ];
    });
    const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
    const pad = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join(' | ');
    say('');
    say(`Live playback at ${new Date().toISOString()} against ${baseUrl}, window ${WINDOW_MS / 1000}s`);
    say(pad(header));
    say(widths.map((w) => '-'.repeat(w)).join('-+-'));
    for (const r of rows) say(pad(r));
    say('');
    for (const r of results) {
      if (r.seq) say(`  station ${r.target.n} status sequence: ${r.seq.join(' -> ')}`);
    }
    say(`  ${switchLine}`);
    say(`  ${volumeLine}`);
    say(`  ${pauseLine}`);
    say(`  ${errorLine}`);
    say(`  ${historyLine}`);
    say(`  switching ${switchOk ? 'PASS' : 'FAIL'}`);
    if (pageErrors.length) say(`  uncaught page errors: ${pageErrors.length} (first: ${pageErrors[0]})`);

    const playedCount = results.filter((r) => r.pass).length;
    const allOk = playedCount >= MIN_PLAYING && switchOk && pauseOk && volumeOk && historyOk && errorOk;
    say('');
    say(`LIVE-PLAYBACK: ${playedCount}/4 stations played`);
    say(`overall: ${allOk ? 'PASS' : 'FAIL'}`);
    writeFileSync(join(OUT, 'report.txt'), log.join('\n') + '\n');
    exitCode = allOk ? 0 : 1;
  } catch (err) {
    say(`ERROR: ${err && err.stack ? err.stack : err}`);
    writeFileSync(join(OUT, 'report.txt'), log.join('\n') + '\n');
    exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (preview && preview.pid) {
      try {
        process.kill(-preview.pid, 'SIGTERM');
      } catch {
        // already gone
      }
    }
  }
  return exitCode;
}

process.exitCode = await main();

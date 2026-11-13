// Live playback check. Plain Node, uses the preinstalled global Playwright.
// Real internet radio: stations are found with the app's own search box and clicked from the
// live directory. No media request is intercepted or replaced. The only route used is the
// deliberate abort in the error test. Test-side hooks: an init script remembers every
// HTMLMediaElement (window.__ssMedia) and the Radio Browser JSON is read from responses only.
// Runs against `npm run preview` (started and stopped here) unless LIVE_BASE_URL is set.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4173;
const OUT = '/tmp/claude-0/-home-user/56aa8976-1187-5e42-9581-774146525f7d/scratchpad/live';
const API_HOST = /(^|\.)radio-browser\.info$/;
const WINDOW_MS = 12_000;
const SAMPLE_MS = 250;
const STREAM_HOSTS = ['ice6.somafm.com', 'stream.live.vc.bbcmedia.co.uk', 'liveradio.swr.de', 'stream.radiofrance.fr'];

const TARGETS = [
  { n: 1, query: 'SomaFM Groove Salad', nameRe: /SomaFM Groove Salad/i, host: 'ice6.somafm.com' },
  { n: 2, query: 'BBC World Service', nameRe: /BBC World Service/i, host: 'stream.live.vc.bbcmedia.co.uk' },
  { n: 3, query: 'SWR3', nameRe: /SWR3/i, host: 'liveradio.swr.de' },
  { n: 4, query: 'FIP', nameRe: /\bFIP\b/i, host: 'stream.radiofrance.fr' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};
const fmt = (v) => (v === null || v === undefined ? '-' : typeof v === 'number' ? v.toFixed(2) : String(v));

/** Read-only snapshot of the player UI and every media element the page created. */
function pageState() {
  const q = (s) => document.querySelector(s);
  const els = window.__ssMedia ?? [];
  const el = els.length ? els[els.length - 1] : null;
  const playing = els.filter((e) => !e.paused);
  return {
    label: q('footer.ss-player .ss-player__main')?.getAttribute('aria-label') ?? null,
    status: q('footer.ss-player .ss-player__status')?.textContent?.trim() ?? null,
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
  mkdirSync(OUT, { recursive: true });
  const baseUrl = process.env.LIVE_BASE_URL || `http://localhost:${PORT}/`;
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

    // Radio Browser JSON, read from responses only: uuid -> stream url, codec.
    const apiRecords = new Map();
    const apiPending = [];
    page.on('response', (resp) => {
      const url = resp.url();
      if (!API_HOST.test(hostOf(url)) || !url.includes('/json/')) return;
      apiPending.push(
        resp
          .json()
          .then((data) => {
            if (!Array.isArray(data)) return;
            for (const s of data) {
              if (s && typeof s.stationuuid === 'string') {
                apiRecords.set(s.stationuuid, { url: s.url_resolved || s.url || '', codec: s.codec || '' });
              }
            }
          })
          .catch(() => {}),
      );
    });

    // Media traffic to the stream hosts: open requests (for the switch check) and responses.
    const openReqs = new Map();
    const mediaLog = [];
    const failLog = [];
    const isStream = (req) => STREAM_HOSTS.includes(hostOf(req.url()));
    page.on('request', (req) => {
      if (isStream(req)) openReqs.set(req, { url: req.url(), t: Date.now() });
    });
    page.on('requestfinished', (req) => openReqs.delete(req));
    page.on('requestfailed', (req) => {
      openReqs.delete(req);
      if (isStream(req)) failLog.push({ t: Date.now(), host: hostOf(req.url()), text: req.failure()?.errorText ?? '' });
    });
    page.on('response', (resp) => {
      const req = resp.request();
      if (isStream(req)) {
        mediaLog.push({
          t: Date.now(),
          host: hostOf(req.url()),
          status: resp.status(),
          ct: resp.headers()['content-type'] ?? '',
        });
      }
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
      // Bounded: a body that never finishes must not stall the run.
      await Promise.race([Promise.allSettled(apiPending.splice(0)), sleep(5000)]);
      await sleep(300);
    }

    /** Searches, then picks the first row whose stream host is the wanted one. */
    async function findRow(target) {
      await search(target.query);
      const rows = await page.evaluate(rowInfo);
      const considered = [];
      for (const r of rows) {
        if (!target.nameRe.test(r.name)) continue;
        const api = r.id ? apiRecords.get(r.id) : undefined;
        const url = api?.url || r.streamUrl || '';
        const host = hostOf(url);
        considered.push(`${r.name} -> ${host || '?'}`);
        if (host === target.host) {
          return { found: true, index: r.index, name: r.name, id: r.id, url, host, codec: api?.codec || '?', considered };
        }
      }
      return { found: false, considered };
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

    // ---- Stations 1-4: click, then 12s of observation each. Station 2's click is the switch from station 1.
    const results = [];
    let screenshotPlaying = false;
    let playingHost = null; // host of the station that was Live when its window ended
    for (const target of TARGETS) {
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
      // A click while another station plays is a switch: remember that station's open requests.
      const prevHost = isLive(await snapshot()) ? playingHost : null;
      const prevSet = prevHost
        ? new Set([...openReqs.keys()].filter((r) => hostOf(r.url()) === prevHost))
        : null;
      let switchAt5 = null;
      const clickAt = await clickRow(row);
      progress(`station ${target.n}: clicked, observing ${WINDOW_MS / 1000}s`);
      const w = await watch(WINDOW_MS, (s) => {
        if (s.t >= 5 && prevSet && switchAt5 === null) {
          switchAt5 = {
            nonPaused: s.nonPaused,
            srcs: s.srcs,
            prevOpen: [...prevSet].filter((r) => openReqs.has(r)).length,
            prevCount: prevSet.size,
          };
        }
        if (isLive(s) && !rec.live) {
          rec.live = true;
          liveLog.push({ id: row.id, name: row.name });
        }
      });
      progress(`station ${target.n}: label=${w.samples.at(-1).label} status=${w.samples.at(-1).status} pass=${rec.pass}`);
      const at = (sec) => w.samples.find((s) => s.t >= sec) ?? w.samples[w.samples.length - 1];
      const t2 = at(2);
      const t10 = at(10);
      const end = w.samples[w.samples.length - 1];
      const mediaHere = mediaLog.filter((m) => m.host === row.host && m.t >= clickAt);
      rec.name = row.name;
      rec.host = row.host;
      rec.codec = row.codec;
      rec.t2 = t2;
      rec.t10 = t10;
      rec.seq = w.seq;
      rec.media = mediaHere[0] ? `${mediaHere[0].status} ${mediaHere[0].ct}` : 'none';
      rec.mediaCount = mediaHere.length;
      rec.failures = failLog.filter((f) => f.host === row.host && f.t >= clickAt).map((f) => f.text);
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
      rec.prevHost = prevHost;
      rec.switch = switchAt5;
      rec.url = row.url;
      playingHost = isLive(end) ? row.host : null;
      if (!screenshotPlaying && isLive(end)) {
        await page.screenshot({ path: join(OUT, 'playing-1440.png') });
        screenshotPlaying = true;
        rec.screenshot = true;
      }
    }

    // ---- Supplementary switch, reported but not part of the exit code: BBC playing, then FIP clicked.
    let supp = null;
    const bbc = results[1];
    const fip = results[3];
    if (bbc?.live && fip?.row?.found) {
      const ensure = await findRow(bbc.target);
      if (ensure.found) {
        await clickRow(ensure);
        if (await waitForLive(20000)) {
          liveLog.push({ id: ensure.id, name: ensure.name });
          const prevSet = new Set([...openReqs.keys()].filter((r) => hostOf(r.url()) === bbc.host));
          const again = await findRow(fip.target);
          if (again.found) {
            await clickRow(again);
            let at5 = null;
            let liveSeen = false;
            const w = await watch(WINDOW_MS, (s) => {
              if (s.t >= 5 && at5 === null) {
                at5 = {
                  nonPaused: s.nonPaused,
                  srcs: s.srcs,
                  prevOpen: [...prevSet].filter((r) => openReqs.has(r)).length,
                  prevCount: prevSet.size,
                };
              }
              if (isLive(s) && !liveSeen) {
                liveSeen = true;
                liveLog.push({ id: again.id, name: again.name });
              }
            });
            const end = w.samples[w.samples.length - 1];
            supp = {
              at5,
              end: `${end.label}/${end.status}`,
              ok:
                !!at5 &&
                at5.nonPaused === 1 &&
                !at5.srcs.some((x) => x.includes(bbc.host)) &&
                at5.prevCount > 0 &&
                at5.prevOpen === 0,
            };
          }
        }
      }
    }

    progress('switching, volume, pause, error, history');
    // ---- Switching: station 1 playing, then station 2 clicked.
    const s2 = results[1];
    const switchOk =
      !!s2?.switch &&
      s2.prevHost === TARGETS[0].host &&
      s2.switch.nonPaused === 1 &&
      !s2.switch.srcs.some((src) => src.includes(TARGETS[0].host)) &&
      s2.switch.prevCount > 0 &&
      s2.switch.prevOpen === 0;
    const switchLine = s2?.switch
      ? `switching 1->2: station 1 Live before click=${s2.prevHost === TARGETS[0].host}; at t=5s non-paused elements=${s2.switch.nonPaused} ` +
        `srcs=[${s2.switch.srcs.map((x) => hostOf(x) || x || 'none').join(',')}] station-1 requests open=${s2.switch.prevOpen}/${s2.switch.prevCount} (of those at click)`
      : 'switching 1->2: not measured (station 1 was not playing when station 2 was clicked)';
    const extraSwitch = results
      .filter((r) => r.switch && r.n !== 2)
      .map((r) => `switch into station ${r.target.n} from ${r.prevHost}: non-paused=${r.switch.nonPaused} ` +
        `srcs=[${r.switch.srcs.map((x) => hostOf(x) || 'none').join(',')}] previous requests open=${r.switch.prevOpen}/${r.switch.prevCount}`);

    // ---- Volume and pause need a station that is Live.
    const liveRec = [...results].reverse().find((r) => r.live && r.row?.found);
    let playingNow = false;
    if (liveRec) {
      const cur = await snapshot();
      if (isLive(cur)) {
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
    }

    // ---- Error: abort one stream host, click its station, expect an error sentence and Try again.
    const errRec = results[2]?.row?.found ? results[2] : results.find((r) => r.row?.found);
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
        results.find((r) => r.live && r.host !== errHost) ??
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
    let historyOk = false;
    let historyLine = 'history: not run';
    await page.locator('header nav button', { hasText: /^History$/ }).click();
    await page.waitForSelector('#ss-history-title', { timeout: 10000 });
    await sleep(500);
    const names = await page.locator('.ss-view-row .ss-station-row__name').allTextContents();
    const seen = new Map();
    for (const e of liveLog) seen.set(e.id, e.name); // last Live occurrence wins; insertion order = first occurrence
    const order = [];
    for (const e of [...liveLog].reverse()) {
      if (!order.includes(e.id)) order.push(e.id);
    }
    const expected = order.map((id) => seen.get(id));
    historyOk = expected.length > 0 && JSON.stringify(expected) === JSON.stringify(names);
    historyLine = `history: expected newest first=[${expected.join(' | ')}] shown=[${names.join(' | ')}] ${historyOk ? 'PASS' : 'FAIL'}`;

    progress('report');
    // ---- Report.
    const header = ['Station', 'Host', 'Stream path', 'Codec', 'Label(t10)', 'Status(t10)', 'paused', 'readyState', 'networkState', 'ct t2', 'ct t10', 'advance', 'error', 'media', 'mediaSession title', 'Result'];
    const rows = results.map((r) => {
      const path = r.row?.url ? new URL(r.row.url).pathname.slice(0, 28) : '-';
      if (!r.row || !r.row.found) return [`#${r.target.n} ${r.target.query}`, r.target.host, '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', `no row (${(r.row?.considered ?? []).join('; ') || 'none'})`, '-', 'FAIL'];
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
        r.media + (r.failures.length ? ` failed:${r.failures[0]}` : '') + ` (${r.mediaCount})`,
        fmt(r.mediaTitle),
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
    say(
      supp
        ? `  supplementary switch BBC->FIP (not in exit code): non-paused at t=5s=${supp.at5?.nonPaused} srcs=[${(supp.at5?.srcs ?? []).map((x) => hostOf(x) || 'none').join(',')}] ` +
            `BBC requests open=${supp.at5?.prevOpen}/${supp.at5?.prevCount} end=${supp.end} ${supp.ok ? 'PASS' : 'FAIL'}`
        : '  supplementary switch BBC->FIP: not measured (BBC or FIP unavailable)',
    );
    for (const line of extraSwitch) say(`  ${line}`);
    say(`  ${volumeLine}`);
    say(`  ${pauseLine}`);
    say(`  ${errorLine}`);
    say(`  ${historyLine}`);
    say(`  switching ${switchOk ? 'PASS' : 'FAIL'}`);
    if (pageErrors.length) say(`  uncaught page errors: ${pageErrors.length} (first: ${pageErrors[0]})`);

    const playedCount = results.filter((r) => r.pass).length;
    const allOk = playedCount >= 1 && switchOk && pauseOk && volumeOk && historyOk && errorOk;
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

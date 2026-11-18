// Tests for the discovery parsers (scripts/discover-streams.mjs). Fixtures in scripts/fixtures/discover are real
// responses saved on 2026-11-18: kublfm.xml and kublfmaac.xml (Triton livestream XML), wp1.json (one MediaWiki
// batch, with redirects and a disambiguation page). No network access in these tests.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  candidateGroup,
  candidateStations,
  codecToExt,
  evaluateWikiPage,
  firstNumber,
  formatTags,
  hardExcludeTag,
  isDisambiguation,
  locationMatches,
  mountCandidates,
  orderCandidates,
  parseInfobox,
  parseLivestreamXml,
  plainHttpsUrl,
  readProgress,
  redirectUrl,
  runDiscovery,
  skippedLicensee,
  stationName,
  stripWiki,
  titleCase,
  titleIsCall,
  TRITON_PACING,
  tritonVerdict,
  WP_PACING,
  WP_UA,
  wikiTitleCandidates,
} from './discover-streams.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, 'fixtures/discover', name), 'utf8');
const xmlMp3 = fixture('kublfm.xml');
const xmlAac = fixture('kublfmaac.xml');
const wpPages = JSON.parse(fixture('wp1.json')).query.pages;

/** The page record the lookup stores: { final, missing, content }, from the real batch. */
function wpRec(title) {
  const p = wpPages.find((x) => x.title === title);
  if (!p) throw new Error(`fixture has no page ${title}`);
  return { final: title, missing: p.missing === true, content: p.revisions?.[0]?.slots?.main?.content ?? null };
}

const KUBL = { call: 'KUBL', band: 'FM', freq: 93.3, city: 'SALT LAKE CITY', state: 'UT', lat: 40.6, lng: -111.9, facilityId: '11238' };
const KSFI = { call: 'KSFI', band: 'FM', freq: 100.3, city: 'SALT LAKE CITY', state: 'UT', lat: 40.6, lng: -111.9, facilityId: '60452' };

describe('Triton livestream XML (real responses)', () => {
  it('reads the mountpoint status, mount and codec from the mountpoint block', () => {
    expect(parseLivestreamXml(xmlMp3)).toMatchObject({ status: 200, mount: 'KUBLFM', codec: 'mp3' });
    expect(parseLivestreamXml(xmlAac)).toMatchObject({ status: 200, mount: 'KUBLFMAAC', codec: 'heaacv2' });
  });

  it('returns null fields for a response with no mountpoint block', () => {
    expect(parseLivestreamXml('<html>nothing here</html>')).toMatchObject({ status: null, mount: null, codec: null });
  });

  it('reads a miss (XML status 404 in a 200 response) as status 404, with no mount', () => {
    const miss = '<?xml version="1.0"?><live_stream_config><mountpoints><mountpoint><status><status-code>404</status-code>'
      + '<status-message>Not Found</status-message></status></mountpoint></mountpoints></live_stream_config>';
    expect(parseLivestreamXml(miss)).toMatchObject({ status: 404, mount: null });
  });
});

describe('mount order and codec to extension', () => {
  it('tries CALL+BAND+AAC, CALL+BAND, CALL+AAC, CALL, in that order', () => {
    expect(mountCandidates('KUBL', 'FM')).toEqual(['KUBLFMAAC', 'KUBLFM', 'KUBLAAC', 'KUBL']);
    expect(mountCandidates('kubl', 'AM')).toEqual(['KUBLAMAAC', 'KUBLAM', 'KUBLAAC', 'KUBL']);
  });

  it('maps the real Triton codecs to extensions (heaacv2 is aac, mp3 is mp3)', () => {
    expect(codecToExt('heaacv2', 'KUBLFMAAC')).toEqual({ ext: 'aac', reason: null });
    expect(codecToExt('mp3', 'KUBLFM')).toEqual({ ext: 'mp3', reason: null });
    expect(codecToExt('heaacv1', 'KRUAFMAAC')).toEqual({ ext: 'aac', reason: null });
  });

  it('does not keep a mount named AAC whose XML codec is mp3, nor an unknown or missing codec', () => {
    expect(codecToExt('mp3', 'KUBLFMAAC').ext).toBeNull();
    expect(codecToExt('ogg', 'KUBLFM').ext).toBeNull();
    expect(codecToExt(null, 'KUBLFM').ext).toBeNull();
  });

  it('builds the Triton livestream-redirect URL', () => {
    expect(redirectUrl('KUBLFMAAC', 'aac')).toBe('https://playerservices.streamtheworld.com/api/livestream-redirect/KUBLFMAAC.aac');
  });
});

describe('skipped single-feed networks', () => {
  it('skips K-LOVE, Air1, Moody, Bible Broadcasting, AFA, Relevant, Family Life and iHeart licensees', () => {
    expect(skippedLicensee('EDUCATIONAL MEDIA FOUNDATION')).toMatch(/K-LOVE/);
    expect(skippedLicensee('HOPE MEDIA GROUP, INC.')).toMatch(/Air1/);
    expect(skippedLicensee('MOODY BIBLE INSTITUTE OF CHICAGO')).toMatch(/Moody/);
    expect(skippedLicensee('BIBLE BROADCASTING NETWORK INC')).toMatch(/Bible/);
    expect(skippedLicensee('AMERICAN FAMILY ASSOCIATION INC')).toMatch(/American Family/);
    expect(skippedLicensee('RELEVANT RADIO INC')).toMatch(/Relevant/);
    expect(skippedLicensee('FAMILY LIFE MINISTRIES')).toMatch(/Family Life/);
    expect(skippedLicensee('IHM LICENSES, LLC')).toMatch(/iHeart/);
  });

  it('does not skip an independent licensee, or a missing one', () => {
    expect(skippedLicensee('ALEUTIAN PENINSULA BROADCASTING, INC.')).toBeNull();
    expect(skippedLicensee(null)).toBeNull();
  });

  it('leaves network licences out of the candidates and counts them by label', () => {
    const fcc = [
      { ...KUBL, service: 'FM', licensee: 'RADIO LICENSE HOLDING CBC, LLC' },
      { call: 'KXXX', band: 'FM', freq: 90.1, service: 'FM', city: 'PROVO', state: 'UT', lat: 40.2, lng: -111.6, facilityId: '1', licensee: 'EDUCATIONAL MEDIA FOUNDATION' },
      { call: 'KYYY', band: 'FM', freq: 91.1, service: 'FL', city: 'PROVO', state: 'UT', lat: 40.2, lng: -111.6, facilityId: '2', licensee: 'SOMEONE' },
      { call: 'KZZZ', band: 'FM', freq: 92.1, service: 'FM', city: 'GUAM', state: 'GU', lat: 13.4, lng: 144.7, facilityId: '3', licensee: 'SOMEONE' },
    ];
    const result = candidateStations(fcc, []);
    expect(result.candidates.map((c) => c.call)).toEqual(['KUBL']);
    expect(Object.keys(result.skipped)).toEqual(['K-LOVE (Educational Media Foundation)']);
    expect(result.outOfScope).toBe(2);
  });
});

describe('Wikipedia infobox parsing (real pages)', () => {
  it('reads the radio station infobox parameters from KUBL-FM', () => {
    const box = parseInfobox(wpRec('KUBL-FM').content);
    expect(box.get('branding')).toBe('93.3 The Bull');
    expect(box.get('format')).toBe('[[Country music|Country]]');
    expect(box.get('frequency')).toBe('93.3 [[MHz]]');
    expect(box.get('website')).toBe('[https://www.933thebull.com 933thebull.com]');
  });

  it('returns null when the page has no radio station infobox', () => {
    expect(parseInfobox(wpRec('KSL').content)).toBeNull();
    expect(parseInfobox(null)).toBeNull();
  });

  it('detects the disambiguation page (WXYZ)', () => {
    expect(isDisambiguation(wpRec('WXYZ').content)).toBe(true);
    expect(isDisambiguation(wpRec('KUBL-FM').content)).toBe(false);
  });

  it('turns the format into tags (links keep their text, parentheses dropped)', () => {
    expect(formatTags('[[Country music|Country]]')).toEqual(['Country']);
    expect(formatTags('[[Adult album alternative]] ([[Public broadcasting|Public]])')).toEqual(['Adult album alternative']);
    expect(formatTags('[[Public radio]]<ref name="Arbitron"/>')).toEqual(['Public radio']);
    expect(formatTags('')).toEqual([]);
  });

  it('reads the first frequency from raw text, including the {{Frequency}} template', () => {
    expect(firstNumber('93.3 [[MHz]]')).toBe(93.3);
    expect(firstNumber('{{Frequency|590|[[kHz]]}}')).toBe(590);
    expect(firstNumber('')).toBeNull();
  });

  it('strips wiki markup from text', () => {
    expect(stripWiki("''KSL'' [[Salt Lake City|Salt Lake City, Utah]]<ref>x</ref>")).toBe('KSL Salt Lake City, Utah');
  });

  it('accepts only https website values, and reads the link and URL template forms', () => {
    expect(plainHttpsUrl('[https://www.933thebull.com 933thebull.com]')).toBe('https://www.933thebull.com');
    expect(plainHttpsUrl('{{URL|https://fm100.com}}')).toBe('https://fm100.com');
    expect(plainHttpsUrl('https://example.org')).toBe('https://example.org');
    expect(plainHttpsUrl('http://example.org')).toBeNull();
    expect(plainHttpsUrl('javascript:alert(1)')).toBeNull();
    expect(plainHttpsUrl('')).toBeNull();
  });
});

describe('Wikipedia title and location checks', () => {
  it('tries the base call sign, then CALL-FM (FM) or CALL (AM)', () => {
    expect(wikiTitleCandidates('KUBL', 'FM')).toEqual(['KUBL', 'KUBL-FM']);
    expect(wikiTitleCandidates('KXXX', 'AM')).toEqual(['KXXX', 'KXXX (AM)']);
  });

  it('accepts the call-sign page titles and refuses another call sign (KUTX redirects to KUT)', () => {
    expect(titleIsCall('KUBL-FM', 'KUBL')).toBe(true);
    expect(titleIsCall('KUBL (FM)', 'KUBL')).toBe(true);
    expect(titleIsCall('KUT', 'KUTX')).toBe(false);
    expect(titleIsCall('KSL', 'KSFI')).toBe(false);
  });

  it('checks location by state when the text names one, by city otherwise', () => {
    expect(locationMatches('[[Salt Lake City|Salt Lake City, Utah]]', KUBL)).toBe(true);
    expect(locationMatches('Salt Lake City, Georgia', KUBL)).toBe(false);
    expect(locationMatches('Midvale', KUBL)).toBe(false);
    expect(locationMatches('Columbus', { ...KUBL, city: 'COLUMBUS', state: 'OH' })).toBe(true);
    expect(locationMatches('Columbus, Georgia', { ...KUBL, city: 'COLUMBUS', state: 'OH' })).toBe(false);
    expect(titleCase('SALT LAKE CITY')).toBe('Salt Lake City');
  });

  it('builds the station name from the call sign, the frequency and the branding, without the frequency words', () => {
    expect(stationName(KUBL, '93.3 The Bull')).toBe('KUBL 93.3 The Bull');
    expect(stationName(KSFI, 'FM 100.3')).toBe('KSFI 100.3');
    expect(stationName({ ...KUBL, band: 'AM', freq: 570 }, '')).toBe('KUBL 570');
  });
});

describe('evaluateWikiPage (real pages)', () => {
  it('accepts KUBL-FM for the KUBL FCC licence, with its music format and branding', () => {
    const ev = evaluateWikiPage(wpRec('KUBL-FM'), KUBL);
    expect(ev.outcome).toBe('accept');
    expect(ev.wikiTitle).toBe('KUBL-FM');
    expect(ev.tags).toEqual(['country']);
    expect(ev.name).toBe('KUBL 93.3 The Bull');
    expect(ev.website).toBe('https://www.933thebull.com');
    expect(ev.city).toBe('Salt Lake City');
  });

  it('falls back when the page is missing or a disambiguation page', () => {
    expect(evaluateWikiPage(wpRec('KSFI-FM'), KSFI)).toMatchObject({ outcome: 'fallback', kind: 'missing' });
    expect(evaluateWikiPage(wpRec('WXYZ'), { ...KUBL, call: 'WXYZ' })).toMatchObject({ outcome: 'fallback', kind: 'disambiguation' });
  });

  it('falls back when the page is for another call sign (KUT for KUTX; KSL for KSFI)', () => {
    expect(evaluateWikiPage(wpRec('KUT'), { ...KUBL, call: 'KUTX' })).toMatchObject({ outcome: 'fallback', kind: 'other title' });
    expect(evaluateWikiPage(wpRec('KSL'), KSFI)).toMatchObject({ outcome: 'fallback', kind: 'other title' });
  });

  it('falls back when the infobox frequency is not this licence (KSFI is 100.3, not 93.3)', () => {
    expect(evaluateWikiPage(wpRec('KSFI'), { ...KSFI, freq: 93.3 })).toMatchObject({ outcome: 'fallback', kind: 'frequency' });
  });

  it('rejects a page for this call sign whose city is in another state', () => {
    expect(evaluateWikiPage(wpRec('KSFI'), { ...KSFI, state: 'TX', city: 'DALLAS' })).toMatchObject({ outcome: 'reject', kind: 'location' });
  });

  it('rejects a page whose format is not music with a genre', () => {
    // KUBL-FM with the format changed to "Public radio" in the infobox text.
    const content = wpRec('KUBL-FM').content.replace('[[Country music|Country]]', '[[Public radio]]');
    expect(evaluateWikiPage({ final: 'KUBL-FM', missing: false, content }, KUBL)).toMatchObject({ outcome: 'reject', kind: 'format' });
  });
});

describe('Wikipedia pacing and Triton verdict', () => {
  it('spaces Wikipedia calls at least 3 s apart, and backs off 120 s with at most 3 retries', () => {
    expect(WP_PACING).toEqual({ gapMs: 3000, retryMs: 120000, maxRetries: 3 });
  });

  it('is a hit for the first mount that answers 200 for that exact name, even after an earlier error', () => {
    const answers = [
      { mount: 'KUBLFMAAC', answer: { error: 'HTTP 500' } },
      { mount: 'KUBLFM', answer: { status: 200, mount: 'KUBLFM', codec: 'mp3', hasServers: true } },
    ];
    expect(tritonVerdict(answers)).toMatchObject({ status: 'hit', mount: 'KUBLFM' });
  });

  it('is a miss only when every mount answered and none matched (a 404 inside a 200 is an answer)', () => {
    const answers = [
      { mount: 'KUBLFMAAC', answer: { status: 404, mount: null } },
      { mount: 'KUBLFM', answer: { status: 404, mount: null } },
    ];
    expect(tritonVerdict(answers)).toEqual({ status: 'miss' });
  });

  it('is incomplete when no mount matched and one gave no usable answer', () => {
    const answers = [
      { mount: 'KUBLFMAAC', answer: { error: 'HTTP 503' } },
      { mount: 'KUBLFM', answer: { status: 404, mount: null } },
    ];
    expect(tritonVerdict(answers)).toEqual({ status: 'incomplete' });
  });

  it('refuses a 200 whose mount name is another mount', () => {
    const answers = [{ mount: 'KUBLFM', answer: { status: 200, mount: 'KUBLFMX' } }];
    expect(tritonVerdict(answers)).toEqual({ status: 'miss' });
  });
});

describe('excluded format tags', () => {
  it('finds a news, talk or sports tag whole-word, whatever the genre tags beside it', () => {
    expect(hardExcludeTag(['public radio; jazz', 'classical', 'news'])).toBe('news');
    expect(hardExcludeTag(['talk radio'])).toBe('talk radio');
    expect(hardExcludeTag(['classic rock', 'newsworthy music'])).toBeNull();
    expect(hardExcludeTag(['old time radio'])).toBe('old time radio');
  });

  it('rejects a Wikipedia page whose format has an excluded tag, even with a genre tag too', () => {
    const content = wpRec('KUBL-FM').content.replace('[[Country music|Country]]', '[[Country music|Country]] and [[News radio|news]]');
    expect(evaluateWikiPage({ final: 'KUBL-FM', missing: false, content }, KUBL)).toMatchObject({ outcome: 'reject', kind: 'format' });
  });
});

describe('run order: commercial FM first, then AM, then FM below 92.0', () => {
  const row = (call, band, freq) => ({ call, band, freq, facilityId: call, state: 'UT', city: 'X', lat: 40, lng: -111 });

  it('puts FM 92.0 and up first, AM next, FM below 92.0 last, and keeps the file order within each group', () => {
    const cands = [
      row('K88', 'FM', 88.1),
      row('KAM1', 'AM', 570),
      row('K920', 'FM', 92.0),
      row('K101', 'FM', 101.1),
      row('K919', 'FM', 91.9),
      row('KAM2', 'AM', 1160),
    ];
    expect(orderCandidates(cands).map((c) => c.call)).toEqual(['K920', 'K101', 'KAM1', 'KAM2', 'K88', 'K919']);
  });

  it('gives each candidate one group (92.0 is commercial; 91.9 is not)', () => {
    expect(candidateGroup({ band: 'FM', freq: 92.0 })).toBe(0);
    expect(candidateGroup({ band: 'FM', freq: 91.9 })).toBe(2);
    expect(candidateGroup({ band: 'AM', freq: 1000 })).toBe(1);
  });

  it('returns a new array and does not change the input', () => {
    const input = [row('K88', 'FM', 88.1), row('K101', 'FM', 101.1)];
    const out = orderCandidates(input);
    expect(out).not.toBe(input);
    expect(input.map((c) => c.call)).toEqual(['K88', 'K101']);
  });
});

describe('Wikipedia User-Agent and pacing', () => {
  it('names the rate as 1 req/3s', () => {
    expect(WP_UA).toContain('1 req/3s');
  });

  it('paces Triton at four requests a second at most, with back-offs of 60, 120 and 240 s and three retries', () => {
    expect(TRITON_PACING).toEqual({ gapMs: 250, retryMs: [60000, 120000, 240000], maxRetries: 3 });
  });
});

describe('the run, Triton first (fake network and clock)', () => {
  const KUBL_HIT = 'KUBLFMAAC';
  const xmlHit = (mount) => readFileSync(join(here, 'fixtures/discover/kublfmaac.xml'), 'utf8').replace(/KUBLFMAAC/g, mount);
  const missXml = (mount) =>
    '<?xml version="1.0"?><live_stream_config><mountpoints><mountpoint><status><status-code>404</status-code>'
    + `<status-message>Not Found</status-message></status><mount>${mount}</mount></mountpoint></mountpoints></live_stream_config>`;
  const KUBL_CONTENT = wpRec('KUBL-FM').content;

  // Licences: KUBL (FM 93.3, Triton hit, Wikipedia accepts KUBL-FM); KSFI (FM 100.3, no mount); KZZZ (AM 570, Triton
  // hit, no Wikipedia page); KFM2 (FM 88.1, below 92.0).
  const KUBL_ROW = { ...KUBL, facilityId: '11238' };
  const KSFI_ROW = { ...KSFI, facilityId: '60452' };
  const KZZZ_ROW = { call: 'KZZZ', band: 'AM', freq: 570, city: 'SALT LAKE CITY', state: 'UT', lat: 40.6, lng: -111.9, facilityId: '900' };
  const KFM2_ROW = { call: 'KFM2', band: 'FM', freq: 88.1, city: 'PROVO', state: 'UT', lat: 40.2, lng: -111.6, facilityId: '777' };
  const ORDERED = orderCandidates([KFM2_ROW, KZZZ_ROW, KSFI_ROW, KUBL_ROW]);

  /** A fake network: Triton answers from `hits` (mount to XML), `scripted` (mount to a queue of responses first), else a
   *  404 miss; Wikipedia answers from `wikiPages` (title to content; missing otherwise), with 429 from call `wikiFailFrom`. */
  function world({ hits = {}, scripted = {}, wikiPages = {}, wikiFailFrom = Infinity } = {}) {
    let t = 1_000_000;
    const log = { triton: [], wiki: [], sleeps: [], order: [] };
    let wikiCalls = 0;
    const deps = {
      now: () => t,
      sleep: async (ms) => {
        log.sleeps.push(ms);
        t += ms;
      },
      log: () => {},
      warn: () => {},
      getText: async (url) => {
        const u = new URL(url);
        if (u.hostname === 'en.wikipedia.org') {
          const titles = u.searchParams.get('titles').split('|');
          log.wiki.push({ t, titles });
          log.order.push('wiki');
          const n = wikiCalls;
          wikiCalls += 1;
          if (n >= wikiFailFrom) return { status: 429, body: '{"error":{"code":"ratelimited"}}' };
          const pages = titles.map((title) =>
            wikiPages[title] !== undefined
              ? { title, revisions: [{ slots: { main: { content: wikiPages[title] } } }] }
              : { title, missing: true },
          );
          return { status: 200, body: JSON.stringify({ query: { pages } }) };
        }
        const mount = u.searchParams.get('mount');
        log.triton.push({ t, mount });
        log.order.push('triton');
        if (scripted[mount]?.length) return scripted[mount].shift();
        if (hits[mount] !== undefined) return { status: 200, body: hits[mount] };
        return { status: 200, body: missXml(mount) };
      },
    };
    return { deps, log };
  }

  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'discover-test-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const hitsFor = () => ({ [KUBL_HIT]: xmlHit(KUBL_HIT), KZZZAMAAC: xmlHit('KZZZAMAAC') });

  it('checks Triton for every candidate first, then asks Wikipedia only about the Triton hits', async () => {
    const w = world({ hits: hitsFor(), wikiPages: { 'KUBL-FM': KUBL_CONTENT } });
    const r = await runDiscovery({ candidates: ORDERED, cacheDir: dir, deps: w.deps, verified: '2026-11-18' });
    expect(r.stopped).toBeNull();
    const firstWiki = w.log.order.indexOf('wiki');
    expect(firstWiki).toBeGreaterThan(-1);
    expect(w.log.order.slice(0, firstWiki).every((x) => x === 'triton')).toBe(true);
    const titles = w.log.wiki.flatMap((c) => c.titles);
    expect(titles.some((x) => x.startsWith('KSFI') || x.startsWith('KFM2'))).toBe(false);
    expect(titles).toContain('KUBL-FM');
    expect(titles).toContain('KZZZ (AM)');
  });

  it('keeps only the Wikipedia-accepted Triton hit, with its title and mount', async () => {
    const w = world({ hits: hitsFor(), wikiPages: { 'KUBL-FM': KUBL_CONTENT } });
    const r = await runDiscovery({ candidates: ORDERED, cacheDir: dir, deps: w.deps, verified: '2026-11-18' });
    expect(r.kept.map((e) => e.id)).toEqual(['fcc:11238']);
    expect(r.kept[0]).toMatchObject({ call: 'KUBL', wikiTitle: 'KUBL-FM', tritonMount: KUBL_HIT, codec: 'heaacv2' });
    expect(r.counts.tritonHits).toBe(2);
    expect(r.counts.wikipedia.accepted).toBe(1);
  });

  it('asks Triton the four mounts for a station with no hit, and makes no Wikipedia call for it', async () => {
    const w = world({ hits: hitsFor(), wikiPages: { 'KUBL-FM': KUBL_CONTENT } });
    await runDiscovery({ candidates: ORDERED, cacheDir: dir, deps: w.deps, verified: '2026-11-18' });
    const ksfi = w.log.triton.filter((c) => c.mount.startsWith('KSFI')).map((c) => c.mount);
    expect(ksfi).toEqual(['KSFIFMAAC', 'KSFIFM', 'KSFIAAC', 'KSFI']);
  });

  it('spaces Triton requests at least 250 ms apart and Wikipedia requests at least 3 s apart', async () => {
    const w = world({ hits: hitsFor(), wikiPages: { 'KUBL-FM': KUBL_CONTENT } });
    await runDiscovery({ candidates: ORDERED, cacheDir: dir, deps: w.deps, verified: '2026-11-18' });
    for (let i = 1; i < w.log.triton.length; i++) {
      expect(w.log.triton[i].t - w.log.triton[i - 1].t).toBeGreaterThanOrEqual(TRITON_PACING.gapMs);
    }
    for (let i = 1; i < w.log.wiki.length; i++) {
      expect(w.log.wiki[i].t - w.log.wiki[i - 1].t).toBeGreaterThanOrEqual(WP_PACING.gapMs);
    }
  });

  it('backs off and retries a Triton 503, then carries on', async () => {
    const w = world({ hits: hitsFor(), wikiPages: { 'KUBL-FM': KUBL_CONTENT }, scripted: { KFM2FMAAC: [{ status: 503, body: 'x' }] } });
    const r = await runDiscovery({ candidates: ORDERED, cacheDir: dir, deps: w.deps, verified: '2026-11-18' });
    expect(r.stopped).toBeNull();
    expect(w.log.sleeps).toContain(60000);
    expect(w.log.triton.filter((c) => c.mount === 'KFM2FMAAC')).toHaveLength(2);
  });

  it('stops Triton after three retries on a 403, keeps nothing, and makes no Wikipedia call', async () => {
    const w = world({ hits: hitsFor(), wikiPages: { 'KUBL-FM': KUBL_CONTENT }, scripted: { KFM2FMAAC: Array(5).fill({ status: 403, body: 'no' }) } });
    const r = await runDiscovery({ candidates: ORDERED, cacheDir: dir, deps: w.deps, verified: '2026-11-18' });
    expect(r.stopped).toMatchObject({ stage: 'triton' });
    expect(w.log.triton.filter((c) => c.mount === 'KFM2FMAAC')).toHaveLength(4);
    expect(w.log.sleeps.filter((ms) => ms > TRITON_PACING.gapMs)).toEqual([60000, 120000, 240000]);
    expect(r.kept).toEqual([]);
    expect(w.log.wiki).toEqual([]);
  });

  it('resumes after a stop from the progress file: finished stations are not asked again', async () => {
    const first = world({ hits: hitsFor(), wikiPages: { 'KUBL-FM': KUBL_CONTENT }, scripted: { KFM2FMAAC: Array(5).fill({ status: 403, body: 'no' }) } });
    await runDiscovery({ candidates: ORDERED, cacheDir: dir, deps: first.deps, verified: '2026-11-18' });
    expect(readProgress(join(dir, 'triton-progress.jsonl')).size).toBe(3);
    rmSync(join(dir, 'triton'), { recursive: true, force: true }); // the mount cache is gone: only the progress file remains
    const second = world({ hits: hitsFor(), wikiPages: { 'KUBL-FM': KUBL_CONTENT } });
    const r = await runDiscovery({ candidates: ORDERED, cacheDir: dir, deps: second.deps, verified: '2026-11-18' });
    expect(r.stopped).toBeNull();
    expect(second.log.triton.map((c) => c.mount).filter((m) => /^(KUBL|KSFI|KZZZ)/.test(m))).toEqual([]);
    expect(second.log.triton.map((c) => c.mount)).toEqual(['KFM2FMAAC', 'KFM2FM', 'KFM2AAC', 'KFM2']);
    expect(r.kept.map((e) => e.id)).toEqual(['fcc:11238']);
    expect(readProgress(join(dir, 'triton-progress.jsonl')).size).toBe(4);
  });

  it('stops Wikipedia after its retries (429), keeps nothing unjudged, and a re-run finishes it', async () => {
    const w = world({ hits: hitsFor(), wikiPages: { 'KUBL-FM': KUBL_CONTENT }, wikiFailFrom: 0 });
    const r = await runDiscovery({ candidates: ORDERED, cacheDir: dir, deps: w.deps, verified: '2026-11-18' });
    expect(r.stopped).toMatchObject({ stage: 'wikipedia' });
    expect(w.log.wiki).toHaveLength(4);
    expect(w.log.sleeps.filter((ms) => ms === 120000)).toHaveLength(3);
    expect(r.kept).toEqual([]);
    expect(readProgress(join(dir, 'triton-progress.jsonl')).size).toBe(4);
    const again = world({ hits: hitsFor(), wikiPages: { 'KUBL-FM': KUBL_CONTENT } });
    const r2 = await runDiscovery({ candidates: ORDERED, cacheDir: dir, deps: again.deps, verified: '2026-11-18' });
    expect(r2.stopped).toBeNull();
    expect(r2.kept.map((e) => e.id)).toEqual(['fcc:11238']);
    expect(again.log.triton).toEqual([]);
  });

  it('keeps the Triton hits judged before a Wikipedia stop', async () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ ...KUBL, call: `KT${String(i).padStart(2, '0')}`, facilityId: String(5000 + i) }));
    const hits = {};
    const wikiPages = {};
    for (const r of many) {
      hits[`${r.call}FMAAC`] = xmlHit(`${r.call}FMAAC`);
      wikiPages[r.call] = KUBL_CONTENT;
    }
    // Batch 1 (50 titles) is judged; batch 2 (one title) hits 429 on every try, so the stage stops.
    const w = world({ hits, wikiPages, wikiFailFrom: 1 });
    const r = await runDiscovery({ candidates: many, cacheDir: dir, deps: w.deps, verified: '2026-11-18' });
    expect(r.stopped).toMatchObject({ stage: 'wikipedia' });
    expect(r.kept).toHaveLength(50);
    expect(r.counts.wikipedia.notChecked).toBe(1);
  });

  it('does not keep a Triton hit whose Wikipedia page is missing (no format, no station)', async () => {
    const w = world({ hits: hitsFor(), wikiPages: {} });
    const r = await runDiscovery({ candidates: ORDERED, cacheDir: dir, deps: w.deps, verified: '2026-11-18' });
    expect(r.stopped).toBeNull();
    expect(r.kept).toEqual([]);
  });

  it('reads a progress file and ignores a torn last line', () => {
    const file = join(dir, 'triton-progress.jsonl');
    writeFileSync(file, '{"id":"fcc:1","status":"miss"}\n{"id":"fcc:2","stat');
    expect([...readProgress(file).keys()]).toEqual(['fcc:1']);
    expect(readProgress(join(dir, 'missing.jsonl')).size).toBe(0);
  });
});

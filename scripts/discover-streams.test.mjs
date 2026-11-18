// Tests for the discovery parsers (scripts/discover-streams.mjs). Fixtures in scripts/fixtures/discover are real
// responses saved on 2026-11-18: kublfm.xml and kublfmaac.xml (Triton livestream XML), wp1.json (one MediaWiki
// batch, with redirects and a disambiguation page). No network access in these tests.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  candidateStations,
  codecToExt,
  evaluateWikiPage,
  firstNumber,
  formatTags,
  isDisambiguation,
  locationMatches,
  mountCandidates,
  parseInfobox,
  parseLivestreamXml,
  plainHttpsUrl,
  redirectUrl,
  skippedLicensee,
  stationName,
  stripWiki,
  titleCase,
  titleIsCall,
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

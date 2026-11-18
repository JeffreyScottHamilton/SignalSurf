#!/usr/bin/env node
// FCC transmitter coordinates for directory stations that have none. Pure functions, used by
// scripts/build-catalog.mjs (fillFccCoords) and by scripts/discover-streams.mjs (sameCallStation).
// Matching uses the call-sign matcher of scripts/fcc-gap.mjs. Nothing here fetches anything.
//
// A station gets FCC coordinates only when exactly one FCC licence in its state has its call sign in the station's
// name or homepage host, and no other frequency is named in the station's name. Two or more candidates (for
// example KSL FM and KSL AM with no frequency in the name) are ambiguous: the station keeps no coordinates.
import { inUsBox } from '../src/catalog/rules.mjs';
import { callInHost, callInName, freqInName } from './fcc-gap.mjs';

const round4 = (v) => Math.round(v * 1e4) / 1e4;

/** Frequencies named in a station name that do not match the licence (FM 87.5-108.0 with a decimal, AM 530-1710). */
function otherFrequencyNamed(fcc, name) {
  if (freqInName(fcc, name)) return false;
  const fm = [...name.matchAll(/(?<![\d.])(\d{2,3}\.\d)(?!\d)/g)]
    .map((m) => Number(m[1]))
    .filter((v) => v >= 87.5 && v <= 108);
  const am = [...name.matchAll(/(?<![\d.])(\d{3,4})\s*(?:AM|kHz)\b/gi), ...name.matchAll(/\bAM\s*(\d{3,4})(?![\d.])/gi)]
    .map((m) => Number(m[1]))
    .filter((v) => v >= 530 && v <= 1710);
  return fm.length > 0 || am.length > 0;
}

/**
 * True when the FCC licence (fcc: call, band, freq, state) is the station (station: name, homepage, stateCode or state).
 * Call sign in the name or homepage host, the same state, and no other frequency named in the name.
 */
export function sameCallStation(fcc, station) {
  const state = station.stateCode ?? station.state ?? null;
  if (state !== fcc.state) return false;
  const name = station.name ?? '';
  const called = callInName(fcc.call, name) || callInHost(fcc.call, station.homepage ?? null);
  return called && !otherFrequencyNamed(fcc, name);
}

/**
 * Sets lat and lng on each directory station that has none, from the one FCC licence that matches it (see above).
 * Mutates the station records in place. Curated and discovered stations already have coordinates and are not touched.
 * Returns { filled, ambiguous }.
 */
export function fillFccCoords(stations, fccStations) {
  const byState = new Map();
  for (const f of fccStations) {
    if (f.lat == null || f.lng == null || !inUsBox(f.lat, f.lng)) continue;
    if (!byState.has(f.state)) byState.set(f.state, []);
    byState.get(f.state).push(f);
  }
  let filled = 0;
  let ambiguous = 0;
  for (const s of stations) {
    if (s.lat !== undefined || s.lng !== undefined) continue;
    if (s.stateCode == null || s.id.startsWith('curated:') || s.id.startsWith('fcc:')) continue;
    const hits = (byState.get(s.stateCode) ?? []).filter((f) => sameCallStation(f, { stateCode: s.stateCode, name: s.name, homepage: s.homepage }));
    if (hits.length === 1) {
      s.lat = round4(hits[0].lat);
      s.lng = round4(hits[0].lng);
      filled += 1;
    } else if (hits.length > 1) {
      ambiguous += 1;
    }
  }
  return { filled, ambiguous };
}

# Data source: Radio Browser and the Roadtrip Radio catalogue

The app plays stations from a catalogue it ships as `public/catalog.json`. The catalogue is built once from the Radio Browser community directory by `npm run catalog` (`scripts/build-catalog.mjs`). The browser never queries the directory.

API facts below were checked on 2026-11-13 with the commands or URLs shown. The catalogue numbers are from the build run on 2026-11-17. Anything that could not be checked is marked **not verified**.

## Licence and attribution

1. **Licence (verified 2026-11-13):** the station data is public domain.
   - `https://www.radio-browser.info/` (home page): "Data license: public domain, software license: GPL, server software: open source" and "Everyone is free to use the collected data (station names, tags, links to stream, links to homepages, language, country, state) in their works. I give all the rights I have at the accumulated data to the public domain."
   - `https://gitlab.com/radiobrowser/radio-database/-/raw/main/README.md` (`## License`): "All of the content of this repository is in the public domain."
   - The API server code is AGPL-3.0 (`https://gitlab.com/radiobrowser/radiobrowser-api-rust/-/raw/master/LICENSE`). That licence covers the server software, not the data, and the app does not include the server.
2. **Attribution:** no page fetched requires credit. The app credits Radio Browser in the map attribution ("Stations: Radio Browser") and in the About panel anyway.
3. **Credentials:** none. The build makes unauthenticated GET requests.

## What the build asks for

- **Server discovery:** `GET https://all.api.radio-browser.info/json/servers`. Host names are checked against `*.api.radio-browser.info`. If discovery fails, the fallbacks `de1`, `de2` and `fi1` are used.
- **Query:** `GET https://<server>/json/stations/search?countrycode=US&hidebroken=true&limit=100000&order=clickcount&reverse=true`. One query returns every US station the directory lists as working, HTTP or HTTPS. The build does not filter on `is_https`; see "HTTP streams on HTTPS hosts" for how HTTP streams are handled.
- **Failover:** a failed host is followed by the next one (up to four). The first answer is used.
- **Node's `fetch`** is used first with `--use-env-proxy`; `curl` is the fallback when `fetch` cannot connect.
- **User-Agent:** the build sends Node's default. The API docs ask clients for a descriptive `User-Agent` ("appname/appversion"). This is an open item: the build should send one. **Not done.**

The API docs (`https://de1.api.radio-browser.info/`) say: "This webservice can be used freely but without guarantee to work." The directory is volunteer-run, so the catalogue is built by hand and committed, not fetched at runtime.

## Catalogue build, 2026-11-18 (with the http upgrade)

Command: `npm run catalog` (exit 0). Source: de1.api.radio-browser.info. The query has no `is_https` filter, so the raw count is larger than in the earlier build (4,736 with the filter). Records whose stream is `http://` are either upgraded to `https://` (see "HTTP streams on HTTPS hosts") or dropped as `non-https`.

| Measure | Value |
|---|---|
| Raw US records returned | 7,002 |
| Kept | 4,418 (63.1%) from Radio Browser, plus 1 curated station (4,419 in the file; see "Curated stations") |
| Kept as uncategorized (no tags at all; genres `[]`; marked `uncategorized`) | 1,253 |
| Kept with no genre, tags only generic (All only) | 128 |
| Kept with an http stream upgraded to https (in the file): music / uncategorized | 455 / 106 |
| Kept with an http favicon upgraded to https (in the file) | 4 |
| Dropped: untagged, with a non-music word in the name | 68 |
| Dropped: hard-exclude tag or name word | 596 |
| Dropped: no genre | 278 |
| Dropped: non-HTTPS stream with no https host match (no https twin) | 1,542 |
| Dropped: duplicate (same id, then same stream URL) | 100 |
| Dropped: unreadable record | 0 |
| Kept by name (no genre from tags) | 268 |
| With coordinates (shown on the map) | 1,298 |
| Coordinates dropped (outside every US box) | 14 |
| `stateCode` from ISO code | 198 |
| `stateCode` from state text | 2,703 |
| `stateCode` from coordinates in a state outline | 152 |
| `stateCode` null | 1,465 |

Compared with the same raw data without the upgrade, the file has 522 more stations: 561 upgraded stations are added and 39 https stations are removed by dedupe, because an upgraded station that ranks higher by clicks has the same stream URL. Utah (`UT`) has 31 Radio Browser stations, 3 of them upgraded, and 32 with the curated KBZN station (see "Curated stations").

Genre counts (a station can count in more than one genre):

| Genre | Stations | Genre | Stations |
|---|---|---|---|
| Rock | 729 | Latin & World | 181 |
| Country | 279 | Christian & Gospel | 421 |
| Pop | 584 | Indie & College | 264 |
| Hip-Hop & R&B | 319 | Folk & Americana | 100 |
| Jazz & Blues | 304 | Oldies | 446 |
| Classical | 182 | Electronic | 338 |

Every genre has at least 30 stations, so none was dropped from the genre list.

File size (`public/catalog.json`):

| | Bytes | KiB |
|---|---|---|
| Before the uncategorized stations (2,721 stations, build of 2026-11-17) | 826,808 | 807.4 |
| Before the http upgrade (3,895 stations, build of 2026-11-18) | 1,112,640 | 1,086.6 |
| After the http upgrade (4,418 stations, build of 2026-11-18) | 1,252,168 | 1,222.8 |
| Gzip, after the http upgrade (Node zlib, level 6) | 420,789 | 410.9 |

The size limit for this change is 1.6 MB raw. The file is under it, so no field was dropped. Earlier, the target was 900 KiB and the trim (short keys, coordinates to four decimals, three tags, no `codec` or `bitrate`) brought the file under that. Homepage query strings were left in place.

## Curated stations

`data/curated-stations.json` lists stations that Radio Browser does not have, checked by hand. `npm run catalog` reads it after the Radio Browser fetch (`src/catalog/curated.mjs`, used by `scripts/build-catalog.mjs`) and merges the valid entries into the catalogue.

Rules:

1. **Only official stream links, checked by hand.** An entry is added only when its stream URL was taken from the station's own site or official player and then checked by hand (the request, the content type and that it decodes). Do not add a stream from a directory, a guess, or a third-party aggregator. Record where the URL came from in `source`.
2. **Same rules as Radio Browser.** Each entry is passed through `normalizeRaw` (`src/catalog/rules.mjs`) as a directory record: https stream, music tags (`classifyDetailed`), coordinates inside a US box, and state text (`parseStateText`). An entry the rules drop is counted in the build summary by reason and is not added.
3. **https only.** An `http://` stream is rejected when the file is read. The build does not upgrade it.
4. **Radio Browser wins.** A curated entry is skipped when any Radio Browser record lists the same stream (`http://` and `https://` count as the same stream). A station the rules dropped on the Radio Browser side still counts as listed. The exception is an entry with `replaces`, which corrects a directory station (see "Corrections: replaces").
5. **Invalid file fails the build.** A missing field, a bad id, an http stream, a repeated id or stream, or coordinates that are 0,0, not numbers, out of range or outside the US, makes `npm run catalog` exit with an error that names each bad entry. Nothing is written.
6. **Stable ids.** The id is `curated:<slug>`, lower-case letters, digits and hyphens (for example `curated:kbzn`). The app stores it in favourites and history like any id. The app's sanitiser needs 8 or more characters, and `curated:kbzn` has 12.

Fields (one object per station in the `stations` array; `schemaVersion` is 1):

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | `curated:<slug>`, unique |
| `name` | yes | Station name as the station shows it |
| `streamUrl` | yes | `https://` stream, from the official source |
| `homepage` | no | `http(s)://` homepage |
| `favicon` | no | `https://` logo |
| `state` | yes | US state name or code, with no city (`Utah` or `UT`) |
| `city` | no | City, written before the state in the catalogue |
| `tags` | yes | List of tag strings, no commas. The genre comes from them through the same rules |
| `codec`, `bitrate` | no | As documented; not written to the catalogue (see `scripts/build-catalog.mjs`) |
| `lat`, `lng` | yes | Coordinates in decimal degrees. Use the transmitter only when it is verified, otherwise city-centre coordinates, and say so in `coordsSource` |
| `source` | yes | Where the stream URL came from and what was checked |
| `verified` | yes | Date of the check, `YYYY-MM-DD` |
| `coordsSource` | yes | Where the coordinates came from, and whether they are city-centre or transmitter |
| `replaces` | no | Radio Browser `stationuuid` (lower-case uuid) of a directory station this entry corrects. See "Corrections: replaces" |

### How to add a station

1. Find the station's official player or site, and copy the stream URL it uses. It must be `https://`. If it is only `http://`, leave it out.
2. Check it by hand: `curl -sSI <url>` should return 200 and an audio `Content-Type`, and a short download should decode as audio.
3. Add an entry to `data/curated-stations.json` with every required field. Use today's date for `verified`.
4. Run `npm run catalog`. Check the summary line `curated (...): added 1`, then run `npm test`. The build fails if the entry is not valid.
5. Commit `data/curated-stations.json` and `public/catalog.json` together.

### Corrections: replaces

Some directory records are wrong in ways the build cannot fix from the record alone: a stream URL that carries another listener's session id and coordinates, no tags (so no genre and no map pin), or no coordinates. An entry with `replaces` set to a Radio Browser `stationuuid` corrects that record.

When the uuid is in the fetch:

1. The curated entry takes the directory station's place. The directory record is removed, and the curated fields (name, clean `streamUrl`, homepage, state, city, tags, coordinates) are used.
2. The station keeps the directory's uuid as its id, so favourites and history that already hold it still match. Its `clickCount` is the directory's.
3. Click reports still go to Radio Browser (`reportClick` is not skipped), because the station is a directory station.
4. The entry goes through the same rules as any curated entry. If the music or https rules drop it, the directory record stays, and the drop is counted in the summary line.
5. If another directory row (a different uuid) lists the same clean stream, the replacement is skipped and counted as skipped. The directory's other record wins, as in rule 4 above.

When the uuid is not in the fetch, the build does not fail. The entry is added as a normal curated station with id `curated:<slug>`, and a `WARNING` line names the entry and the missing uuid.

Validation: `replaces` must be a lower-case uuid (`checkCuratedEntry`). A repeated `replaces` in the file is an error. Without `replaces`, the rules above are unchanged: the directory wins on a stream match.

The build summary has a line `curated replaces (...): N (uuid, ...)`. The build with the KSFI entry (2026-11-18, after the directory had changed since the table above): raw 7,004 records, kept 4,420 in the file, of which one is a curated station (KBZN) and one is the KSFI correction, which is a directory station. Utah (`UT`) has 32 stations, including KBZN and KSFI. KSFI is in the file as `curated:ksfi`, replacing `b0dc24e6-1484-41e8-a18e-25f33aa4dd9c`.

### Current entries

| id | Station | Stream | Checked | Coordinates |
|---|---|---|---|---|
| `curated:kbzn` | NOW 97.9 KBZN, Salt Lake City (licensed to Ogden) | `https://capitalslc.cdnstream1.com/2283_96.aac` (AAC, about 96 kbps, from the station's player at `live.mystreamplayer.com/kbzn`, linked from `https://www.kbzn.com`) | 2026-11-18: 200, `audio/aac`, `Access-Control-Allow-Origin: *`, decodes as AAC-LC 44.1 kHz stereo | City centre of Salt Lake City, `40.7608, -111.8910`, from the Wikipedia article. **Not the transmitter location.** |

KBZN is in the catalogue as format "hot adult contemporary", which the tag rules map to Pop, state Utah (`UT`), city Salt Lake City, with the coordinates above. Its catalogue record has no click count.

| `curated:ksfi` (replaces `b0dc24e6-1484-41e8-a18e-25f33aa4dd9c`) | FM100.3 KSFI, Salt Lake City | `https://bonneville.cdnstream1.com/2702_48.aac` (AAC, 48 kbps from the mount name; the directory's URL with its query string removed, which carried another listener's session id and coordinates) | 2026-11-18: 200, `audio/aacp`, `Access-Control-Allow-Origin: *`, icy-name `Bonneville - KSFIFM`, decodes as AAC-LC 24 kHz mono. `fm100.com` returns 403 to automated requests, so it was not read | City centre of Salt Lake City, `40.7608, -111.8910`, the same point as KBZN. **Not the transmitter location.** Format "adult contemporary" from Wikipedia (KSFI) |

KSFI keeps the directory uuid and its click count. Before the correction it had no coordinates and no tags, so it was not on the map and was listed as uncategorized.

Limits: the stream was checked once, on 2026-11-18. The app does not re-check curated streams. The map and About panel credit Radio Browser for the station data; a curated station is not from Radio Browser, and the credit does not say so yet.

## HTTP streams on HTTPS hosts

The directory marks many stations as HTTP only, even when the same server also serves other stations over HTTPS. Examples in the 2026-11-18 data: `stream.revma.ihrhls.com` (88 https stations), `streaming.live365.com` (48), `stream.radioparadise.com` (39), `listen.181fm.com` (37).

Rule (`httpsHostKeys` and `upgradeHttpUrl` in `src/catalog/rules.mjs`, used by `scripts/build-catalog.mjs`):

1. The build collects the `host:port` of every `https://` stream (`url_resolved`, else `url`) in the query result. The port is shown only when it is not the https default.
2. A station whose stream is `http://` is written as `https://` only when its own `host:port` is in that set. The path and query are kept. The port is never changed: `http://host:8000` is upgraded only when `host:8000` serves https, and `http://host` only when `host` does.
3. A favicon gets the same rule. A favicon that does not match is omitted. Homepages are not changed.
4. Everything else is unchanged: the music rules, the uncategorized rule, dedupe (by id, then by final stream URL) and state derivation. An upgraded station has no marker in the file; it looks like any https station.

A station whose host is not in the set is dropped as `non-https`, as before.

Limits: the upgrade is inferred from the host, not from a test of each station. Some upgraded streams will fail in the browser (the mount may not exist over https, or a CDN redirect may refuse). The app does not test them, and does not hide or mark them. A failing stream shows the player's normal error message and Try again button.

Spot-check, 2026-11-18, from the build sandbox (its proxy denies some hosts; results are as seen, not for every listener):

| Upgraded URL | Result from the sandbox |
|---|---|
| `https://stream.revma.ihrhls.com/zc185` | `200` (`HEAD`); `302` to `https://cloud.revma.ihrhls.com/...`, which the proxy refused (`403` on CONNECT) |
| `https://streaming.live365.com/b48071_128mp3` | `302` to a `cdnstream.com` host, which the proxy refused (`403`) |
| `https://stream.revma.ihrhls.com/zc5060/hls.m3u8` | `302` to a `revma.ihrhls.com` token URL, which the proxy refused (`403`) |
| `https://streaming.live365.com/b05055_128mp3` | `302` to a `cdnstream.com` host, which the proxy refused (`403`) |
| `https://listen.181fm.com/181-blues_128k.mp3` | `200`, `Content-Type: audio/mpeg` (`HEAD` and ranged `GET`; the server ignored the range, so the body was cut at 15 s) |

So the https hosts answer, and one stream was confirmed as audio. Four redirect to CDN hosts the sandbox cannot reach, so their playback is not verified.

## Data quality notes

- Names can carry leading or doubled spaces. Names are trimmed and whitespace is collapsed.
- Tags are comma-separated, lower-cased, de-duplicated, and tags over 24 characters are dropped. Three tags are kept per station.
- `favicon` values can be `http://`. They are upgraded to `https://` only when their host:port is an https host in the data (the rule above), and omitted otherwise. `homepage` can be `http` or `https` and is not changed.
- The directory has coordinates for a minority of stations, and a few are wrong. The build drops a coordinate pair outside the US boxes instead of moving it (14 in this build). A swapped pair that stays inside a US box cannot be detected.
- The directory's `state` text is free text. A state code is used only when it is an ISO code, an exact state name or abbreviation, or lies inside a state outline (see `docs/decisions.md`).
- Stations whose stream is `http://` on a host with no https stream in the data are not in the catalogue (1,542 in this build). Those that are upgraded are in it; see "HTTP streams on HTTPS hosts".
- Uncategorized stations (no tags at all in the directory) are in the catalogue with no genre. The directory gives them no content description, so some are not music (talk, local or religious programming, and similar). Only names with a non-music word are kept out; see `docs/decisions.md`.

## Live checks made by the app's tests

- `e2e/smoke.mjs` checks the count line, the list and the map against the catalogue file (`npm run e2e`).
- `e2e/live-playback.mjs` plays one station per stream host (`npm run e2e:live`). Stream hosts are not Radio Browser; the report lists the answer of each.

## Not verified

- Rate limits of the directory under load. No rate-limit headers were seen on 2026-11-13.
- Whether a real play increments `clickcount` through `/json/url/{stationuuid}`. The player calls it once per station when the stream reaches Playing (`reportClick` in `src/api/radioBrowser.ts`; errors are ignored). The catalogue's click counts come from the build query and are not updated by the app.
- The US Census Bureau data's licence terms as shipped in `us-atlas`; see `docs/licenses.md`.
- Playback of upgraded streams in a browser. Four of the five spot-checked redirects went to CDN hosts the sandbox cannot reach (see "HTTP streams on HTTPS hosts").
- Hosts `fi1` and `at1` (not reachable from the sandbox on 2026-11-13).

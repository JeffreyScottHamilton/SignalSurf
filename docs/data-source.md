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
- **Query:** `GET https://<server>/json/stations/search?countrycode=US&hidebroken=true&is_https=true&limit=100000&order=clickcount&reverse=true`. One query returns every US station the directory lists as working with an HTTPS stream.
- **Failover:** a failed host is followed by the next one (up to four). The first answer is used.
- **Node's `fetch`** is used first with `--use-env-proxy`; `curl` is the fallback when `fetch` cannot connect.
- **User-Agent:** the build sends Node's default. The API docs ask clients for a descriptive `User-Agent` ("appname/appversion"). This is an open item: the build should send one. **Not done.**

The API docs (`https://de1.api.radio-browser.info/`) say: "This webservice can be used freely but without guarantee to work." The directory is volunteer-run, so the catalogue is built by hand and committed, not fetched at runtime.

## Catalogue build, 2026-11-18

Command: `npm run catalog` (exit 0). Source: de1.api.radio-browser.info.

| Measure | Value |
|---|---|
| Raw US records returned | 4,736 |
| Kept | 3,895 (82.2%) |
| Kept as uncategorized (no tags at all; genres `[]`; marked `uncategorized`) | 1,157 |
| Kept with no genre, tags only generic (All only) | 103 |
| Dropped: untagged, with a non-music word in the name | 58 |
| Dropped: hard-exclude tag or name word | 538 |
| Dropped: no genre | 226 |
| Dropped: non-HTTPS stream | 0 |
| Dropped: duplicate (same id, then same stream URL) | 19 |
| Dropped: unreadable record | 0 |
| Kept by name (no genre from tags) | 231 |
| With coordinates (shown on the map) | 1,187 |
| Coordinates dropped (outside every US box) | 13 |
| `stateCode` from ISO code | 168 |
| `stateCode` from state text | 2,355 |
| `stateCode` from coordinates in a state outline | 136 |
| `stateCode` null | 1,255 |

Genre counts (a station can count in more than one genre):

| Genre | Stations | Genre | Stations |
|---|---|---|---|
| Rock | 613 | Latin & World | 169 |
| Country | 231 | Christian & Gospel | 399 |
| Pop | 484 | Indie & College | 235 |
| Hip-Hop & R&B | 297 | Folk & Americana | 86 |
| Jazz & Blues | 263 | Oldies | 381 |
| Classical | 159 | Electronic | 316 |

Every genre has at least 30 stations, so none was dropped from the genre list.

File size (`public/catalog.json`):

| | Bytes | KiB |
|---|---|---|
| Before the uncategorized stations (2,721 stations, build of 2026-11-17) | 826,808 | 807.4 |
| After (3,895 stations, build of 2026-11-18) | 1,112,640 | 1,086.6 |
| Gzip, after (Node zlib, level 6) | 377,400 | 368.6 |

The target for this build was 1.4 MB raw. The file is under it, so no field was dropped. Earlier, the target was 900 KiB and the trim (short keys, coordinates to four decimals, three tags, no `codec` or `bitrate`) brought the file under that. Homepage query strings were left in place.

## Data quality notes

- Names can carry leading or doubled spaces. Names are trimmed and whitespace is collapsed.
- Tags are comma-separated, lower-cased, de-duplicated, and tags over 24 characters are dropped. Three tags are kept per station.
- `favicon` values can be `http://` and are dropped. `homepage` can be `http` or `https`.
- The directory has coordinates for a minority of stations, and a few are wrong. The build drops a coordinate pair outside the US boxes instead of moving it (11 in this build). A swapped pair that stays inside a US box cannot be detected.
- The directory's `state` text is free text. A state code is used only when it is an ISO code, an exact state name or abbreviation, or lies inside a state outline (see `docs/decisions.md`).
- Stations with a stream that is only `http://` are not in the catalogue (the query asks for HTTPS streams, so this count is 0).
- Uncategorized stations (no tags at all in the directory) are in the catalogue with no genre. The directory gives them no content description, so some are not music (talk, local or religious programming, and similar). Only names with a non-music word are kept out; see `docs/decisions.md`.

## Live checks made by the app's tests

- `e2e/smoke.mjs` checks the count line, the list and the map against the catalogue file (`npm run e2e`).
- `e2e/live-playback.mjs` plays one station per stream host (`npm run e2e:live`). Stream hosts are not Radio Browser; the report lists the answer of each.

## Not verified

- Rate limits of the directory under load. No rate-limit headers were seen on 2026-11-13.
- Whether a real play increments `clickcount` through `/json/url/{stationuuid}`. The player calls it once per station when the stream reaches Playing (`reportClick` in `src/api/radioBrowser.ts`; errors are ignored). The catalogue's click counts come from the build query and are not updated by the app.
- The US Census Bureau data's licence terms as shipped in `us-atlas`; see `docs/licenses.md`.
- Hosts `fi1` and `at1` (not reachable from the sandbox on 2026-11-13).

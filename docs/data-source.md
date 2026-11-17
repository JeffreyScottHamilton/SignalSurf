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

## Catalogue build, 2026-11-17

Command: `npm run catalog` (exit 0). Source: de1.api.radio-browser.info.

| Measure | Value |
|---|---|
| Raw US records returned | 4,712 |
| Kept | 2,721 (57.7%) |
| Dropped: untagged | 1,220 |
| Dropped: hard-exclude tag or name word | 534 |
| Dropped: no genre | 226 |
| Dropped: non-HTTPS stream | 0 |
| Dropped: duplicate (same id, then same stream URL) | 11 |
| Dropped: unreadable record | 0 |
| Kept by name (no genre from tags) | 231 |
| Kept with no genre (All only) | 103 |
| With coordinates (shown on the map) | 998 |
| Coordinates dropped (outside every US box) | 11 |
| `stateCode` from ISO code | 164 |
| `stateCode` from state text | 1,818 |
| `stateCode` from coordinates in a state outline | 91 |
| `stateCode` null | 659 |

Genre counts (a station can count in more than one genre):

| Genre | Stations | Genre | Stations |
|---|---|---|---|
| Rock | 609 | Latin & World | 168 |
| Country | 229 | Christian & Gospel | 398 |
| Pop | 477 | Indie & College | 231 |
| Hip-Hop & R&B | 292 | Folk & Americana | 86 |
| Jazz & Blues | 262 | Oldies | 376 |
| Classical | 160 | Electronic | 312 |

Every genre has at least 30 stations, so none was dropped from the genre list.

File size (`public/catalog.json`):

| | Bytes | KiB |
|---|---|---|
| Before the trim (2,689 stations, long keys, five tags, six-decimal coordinates) | 1,042,598 | 1,018 |
| After the trim (2,721 stations) | 826,808 | 807.4 |
| Gzip, after the trim (Node zlib, level 6) | 271,575 | 265.2 |

The target was 900 KiB. The trim (short keys, coordinates to four decimals, three tags, no `codec` or `bitrate`) brought the file under it. Homepage query strings were left in place: they total under 1 KB.

## Data quality notes

- Names can carry leading or doubled spaces. Names are trimmed and whitespace is collapsed.
- Tags are comma-separated, lower-cased, de-duplicated, and tags over 24 characters are dropped. Three tags are kept per station.
- `favicon` values can be `http://` and are dropped. `homepage` can be `http` or `https`.
- The directory has coordinates for a minority of stations, and a few are wrong. The build drops a coordinate pair outside the US boxes instead of moving it (11 in this build). A swapped pair that stays inside a US box cannot be detected.
- The directory's `state` text is free text. A state code is used only when it is an ISO code, an exact state name or abbreviation, or lies inside a state outline (see `docs/decisions.md`).
- Stations with a stream that is only `http://` are not in the catalogue (the query asks for HTTPS streams, so this count is 0).

## Live checks made by the app's tests

- `e2e/smoke.mjs` checks the count line, the list and the map against the catalogue file (`npm run e2e`).
- `e2e/live-playback.mjs` plays one station per stream host (`npm run e2e:live`). Stream hosts are not Radio Browser; the report lists the answer of each.

## Not verified

- Rate limits of the directory under load. No rate-limit headers were seen on 2026-11-13.
- Whether a real play increments `clickcount` through `/json/url/{stationuuid}`. The player calls it once per station when the stream reaches Playing (`reportClick` in `src/api/radioBrowser.ts`; errors are ignored). The catalogue's click counts come from the build query and are not updated by the app.
- Natural Earth's own terms (`naturalearthdata.com` answered 403 through the sandbox proxy).
- The US Census Bureau data's licence terms as shipped in `us-atlas`; see `docs/licenses.md`.
- Hosts `fi1` and `at1` (not reachable from the sandbox on 2026-11-13).

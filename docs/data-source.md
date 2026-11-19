# Data source: Radio Browser and the Roadtrip Radio catalogue

The app plays stations from a catalogue it ships as `public/catalog.json`. The catalogue is built once from the Radio Browser community directory by `npm run catalog` (`scripts/build-catalog.mjs`). The browser never queries the directory.

API facts below were checked on 2026-11-13 with the commands or URLs shown. The catalogue numbers are from the build run on 2026-11-17. Anything that could not be checked is marked **not verified**.

## Licence and attribution

1. **Licence (verified 2026-11-13):** the station data is public domain.
   - `https://www.radio-browser.info/` (home page): "Data license: public domain, software license: GPL, server software: open source" and "Everyone is free to use the collected data (station names, tags, links to stream, links to homepages, language, country, state) in their works. I give all the rights I have at the accumulated data to the public domain."
   - `https://gitlab.com/radiobrowser/radio-database/-/raw/main/README.md` (`## License`): "All of the content of this repository is in the public domain."
   - The API server code is AGPL-3.0 (`https://gitlab.com/radiobrowser/radiobrowser-api-rust/-/raw/master/LICENSE`). That licence covers the server software, not the data, and the app does not include the server.
2. **Attribution:** no page fetched requires credit. The app credits Radio Browser in the map attribution ("Stations: Radio Browser") and in the About panel anyway. Station locations filled from FCC data are credited as "Some locations: FCC" in both places (FCC data is public domain).
3. **Credentials:** none. The build makes unauthenticated GET requests.

## What the build asks for

- **Server discovery:** `GET https://all.api.radio-browser.info/json/servers`. Host names are checked against `*.api.radio-browser.info`. If discovery fails, the fallbacks `de1`, `de2` and `fi1` are used.
- **Query:** `GET https://<server>/json/stations/search?countrycode=US&hidebroken=true&limit=100000&order=clickcount&reverse=true`. One query returns every US station the directory lists as working, HTTP or HTTPS. The build does not filter on `is_https`; see "HTTP streams on HTTPS hosts" for how HTTP streams are handled.
- **Failover:** a failed host is followed by the next one (up to four). The first answer is used.
- **Node's `fetch`** is used first with `--use-env-proxy`; `curl` is the fallback when `fetch` cannot connect.
- **User-Agent:** the build sends Node's default. The API docs ask clients for a descriptive `User-Agent` ("appname/appversion"). This is an open item: the build should send one. **Not done.**

The API docs (`https://de1.api.radio-browser.info/`) say: "This webservice can be used freely but without guarantee to work." The directory is volunteer-run, so the catalogue is built by hand and committed, not fetched at runtime.

## Catalogue build, 2026-11-18 (FCC coordinate fill)

Command: `npm run catalog` (exit 0), after the FCC coordinate fill (`scripts/fcc-coords.mjs`) was added. The discovered merge is wired but there is no discovered file yet, so it adds nothing (`discovered: 0 (file not present)`; see "Discovered stations").

| Measure | Before (committed file) | After |
|---|---|---|
| Stations in `public/catalog.json` | 4,416 | 4,420 |
| Stations with coordinates | 1,304 | 1,873 |
| Stations with FCC transmitter coordinates | 0 | 565 (9 ambiguous, left without) |
| Utah (`UT`) stations | 30 (15 with coordinates) | 30 (24 with coordinates; 9 from FCC) |
| Raw US records returned | not recorded | 7,014 |
| `public/catalog.json` raw bytes | 1,243,323 | 1,258,826 (1,229 KiB) |
| Gzip (Node zlib, level 6) | 415,685 | 423,961 |

The directory changed between the two builds (new records, new click counts), so not every difference is from the FCC fill. Of the 569 stations that have coordinates now and did not before, 565 match an FCC licence point in their state; the other 4 are not matched to one.

Spot-checks of three filled stations (call sign against the station name, state against the FCC licence):

| Station (name, state) | Coordinates in the file | FCC licence |
|---|---|---|
| `95.5 The Pass - KNLT` (AK) | 61.6942, -149.2672 | KNLT FM 95.5, Palmer, AK |
| `KPBS-HD2 Classical San Diego` (CA) | 32.8381, -117.25 | KPBS FM 89.5, San Diego, CA (the HD2 subchannel uses the KPBS transmitter) |
| `KWAV 96.9` (CA) | 36.5347, -121.6216 | KWAV FM 96.9, Monterey, CA |

Some FCC points are shared by several licences in one city (for example San Diego), so the point alone does not identify a station. The call sign in the name is what selects the licence.

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

## Discovered stations

Licensed US music stations that Radio Browser does not list, and that have an official Triton (StreamTheWorld) livestream. They are found by `npm run discover` (`scripts/discover-streams.mjs`, needs network), written to `data/discovered-stations.json` (committed), and merged by `npm run catalog` after the curated stations. The catalogue build never fetches; it reads the committed file. A missing file counts as no discovered stations (the build does not fail).

### How a station is found

1. **Candidates.** FCC full-power FM and AM licences (`data/fcc-stations.json`) in the 50 states and DC that the catalogue does not already match, by call sign, or by frequency and place (the matcher in `scripts/fcc-gap.mjs`). LPFM and the territories are out of scope.
2. **Skipped networks.** Single-feed networks whose stations all carry one network programme, so each would add a duplicate stream: K-LOVE (Educational Media Foundation), Air1 (Hope Media Group), Moody Radio, Bible Broadcasting Network, American Family Association, Relevant Radio, Family Life Ministries, and iHeartMedia (IHM Licenses; its streams are reached only through iHeart's own app API). The run prints the count per network.
3. **Run order.** The candidates are checked in this order: commercial-band FM (92.0 MHz and up), then AM, then FM below 92.0 MHz; each group keeps the FCC file order. The Triton check (step 4) runs first for every candidate. Wikipedia (step 5) is asked only about the Triton hits, after the whole Triton pass. Reason: Wikipedia rate-limits this network address, so its requests are spent only where a station can be kept.
4. **Triton mount.** The mounts tried in order are `CALL+BAND+AAC`, `CALL+BAND`, `CALL+AAC`, `CALL`, at most four requests. The first mount that answers with XML status 200 and names that exact mount is used. A miss is HTTP 200 with a 404 status inside the XML (an HTTP 404 is also a miss). Requests are paced at 4 a second at most. On an error, or an HTTP status other than 200 and 404 (for example 403, 429 or 5xx), the request is retried after 60 s, 120 s and 240 s; after three retries the Triton stage stops and nothing is written. A re-run resumes: each station's verdict is appended to `triton-progress.jsonl` in the cache, and a station already in it is not asked again. The codec in the XML sets the file extension: `aac`, `heaacv1` and `heaacv2` give `aac`; `mp3` gives `mp3`. A mount named `...AAC` whose codec is `mp3` is not kept. Stream URL: `https://playerservices.streamtheworld.com/api/livestream-redirect/<MOUNT>.<ext>`.
5. **Wikipedia format**, for the Triton hits with a usable codec only. The station's article is read through the MediaWiki API, in batches of 50 titles, at least 3 s between requests (User-Agent "1 req/3s"), with a 120 s back-off and up to three retries on HTTP 429 or maxlag. A stop after the retries ends the stage: the stations not yet checked are not kept, and the stations already checked are still judged. The title tried first is the call sign; if that is not the station's page, CALL-FM (FM) or CALL (AM) is tried. A station is kept only when the page:
   - is for this call sign (a redirect to another station's page, such as KUTX-FM to KUT, is refused);
   - is not a disambiguation page;
   - has a radio station infobox whose frequency matches the licence (FM within 0.05 MHz, AM within 0.5 kHz) when it gives one;
   - has a city or state that agrees with the licence (a state named in the text must be the licence's state; a bare city must be the licence's city);
   - has a format with no excluded tag (news, talk, sports and the other hard-exclude tags in `src/catalog/rules.mjs`; any one of them drops the station, even beside a genre tag, as `docs/decisions.md` says) and whose tags name a music genre under the catalogue's rules. A genre guessed from the station name does not count: a "College radio" station called "The Edge" is not kept.
6. **Entry.** `id` is `fcc:<facility id>`, padded with zeros to four digits (the app rejects station ids under 8 characters); `name` is the call sign, the frequency and the branding (`KUBL 93.3 The Bull`); `homepage` is the Wikipedia website when it is one plain https link (a bracketed link or a `{{URL}}` template is read; anything else is left empty); `lat`/`lng` are the FCC transmitter; `tags` are the format tags; `wikiTitle`, `tritonMount`, `codec`, `source` and `verified` (the run date) say where each fact came from.

The cache (`--cache`, default a temp directory) holds one file per Wikipedia title (`wp/`) and per Triton mount (`triton/`), and `triton-progress.jsonl` with one Triton verdict per station. A re-run, or a re-run after a stop, repeats no request that was already answered and rechecks no station already in `triton-progress.jsonl`. A `--limit <n>` run does not write the committed file.

### How it is merged (`src/catalog/discovered.mjs`)

Discovered entries are merged after the directory and curated stations, through the same `normalizeRaw` rules (https stream, US box, state, music tags). Directory and curated stations win:

- an entry is skipped when its stream is already listed (cleaned URL, http or https, from the Radio Browser rows or from the stations kept so far);
- an entry is skipped when a directory or curated station has the same call sign and the same state (`sameCallStation`). An FM and an AM with the same letters are two stations: the frequency named in the station name must agree.

The file is validated on every build: a bad entry, a repeated id or a repeated stream URL fails the build and names the entry.

### FCC coordinates for directory stations (`scripts/fcc-coords.mjs`)

The build also fills the FCC transmitter point for directory stations that have none. A station gets it only when exactly one FCC licence in its state matches by call sign (in the name or the homepage host) and no other frequency is named in the name. Two matches (for example KSL FM and KSL AM, with no frequency in the name) leave the station without coordinates. Directory coordinates are never changed; curated and discovered stations are not changed by this step. The coordinate source is recorded in the discovered entries (`coordsSource: "FCC transmitter"`).

### Limits

- The audio is not fetched. A Triton mount that answers 200 is trusted as the station's live stream. Nothing here plays the stream; check a few by hand before relying on them.
- Wikipedia is a secondary source and can be stale, missing, or for another station. A station with no usable article is not kept, so coverage is partial by design.
- A Triton mount named for a call sign can belong to a different station with the same letters. The call sign, frequency and place checks reduce that risk; they do not remove it.
- The FCC point is the licensed transmitter site, not the city. For a station on a tower outside its city, the map point is at the tower.
- Triton's terms for third-party players are not verified (see `docs/licenses.md`).
- Wikipedia text is CC BY-SA 4.0. The entries carry the article title, and the map attribution and the About panel name Wikipedia (see `docs/licenses.md`).

### Run status (2026-11-19)

The run checked Triton first for all 12,423 candidates, then asked Wikipedia only about the 1,103 Triton hits. Wikipedia answered HTTP 429 from this network address during the first runs, so the stage stopped and was resumed from the cache; the final pass completed without a stop. Nothing is pending.

| Measure | Value |
|---|---|
| FCC licences | 17,621 |
| Candidates (FM and AM, 50 states and DC, not matched in the catalogue) | 12,423: commercial FM 92.0 MHz and up 5,782; AM 3,612; FM below 92.0 MHz 3,029 |
| Triton hits (an exact mount answered 200 with a usable codec) | 1,103 of 12,423 |
| Triton misses (no mount answered) | 11,320 |
| Wikipedia checked (Triton hits only) | 1,103 of 1,103 |
| Wikipedia not kept | 413: format 350, location 11, no usable page 52 (missing page 35, other title 13, no infobox 2, disambiguation 1, frequency 1) |
| Wikipedia accepted | 690 |
| Duplicate stream dropped | 1 (KUZZ 550 AM, fcc:7695, shares the mount KUZZAAC with KUZZ 107.9 FM, fcc:7697; the first in run order, the FM, is kept) |
| Written to `data/discovered-stations.json` | 689 |
| Added to the catalogue after dedupe | 678 (11 skipped because their stream is already listed) |

The catalogue build adds 673 stations in all, including one curated station. The 689 discovered stations are in 45 states; the top states are CA 43, IL 39, TX 36, FL 35, MN 35, WI 31, NC 31, IN 28, PA 27 and MI 26. Utah has three: KBER 101.1 (Ogden), KUBL 93.3 (Salt Lake City) and KBEE 98.7 (Salt Lake City).

Request totals. Wikipedia: 14 + 4 + 24 + 3 = 45 HTTP requests over the runs, most of them answered 429; the final pass made 3 and read 1,220 answers from the cache. Triton (`playerservices.streamtheworld.com`): 507 requests in the last session; the verdicts of the earlier sessions were made before the logs were kept with request counts, so their total is not recorded. The Triton pass saved its verdicts to `triton-progress.jsonl`, so no station was checked twice.

A Triton request that stalled for two hours (no response, no timeout) stopped the first resumed run. Requests now have a 30 s deadline, one retry on timeout, and the run resumes from the cache.

To rebuild the list, run `npm run discover -- --cache <dir>`. The cache keeps the answers already received, so only the rest is requested. Then run `npm run catalog`.

Build (`npm run catalog`, exit 0): `public/catalog.json` is 1,430,072 bytes raw (1.4 MB, under the 2.5 MB limit) and 456,793 bytes gzipped (Node zlib). Before this change it was 4,429 stations, 1,878 with coordinates, 1,258,826 bytes raw and 435,302 gzipped. After it is 5,102 stations and 2,551 with coordinates (1,244 from FCC transmitter points: 678 discovered and 566 directory stations filled by `scripts/fcc-coords.mjs`). The directory part was fetched live for this build (7,021 raw records). `docs/coverage.md` (offline): matched by call sign 1,382 to 2,089, probable 338 to 346, missing 15,901 to 15,186, of 17,621 licences.

Until a discovered file exists, `npm run catalog` treats it as an empty list and prints `discovered: 0 (file not present)`. The build does not fail.

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

## Listener and tracking parameters in stream URLs

Many directory stream URLs carry another listener's session or tracking data in the query string, for example `?aw_0_1st.playerid=Tuner&newListeningSessionID=...&lat=..&lon=..`, or the iHeart `zip=`, `profileId=`, `listenerId=`, `terminalId=`, `birthYear=` and `us_privacy=`. A player sends that query on every play, and a stale token in it can break a stream.

`cleanStreamUrl` (`src/catalog/rules.mjs`) removes those parameters. `normalizeRaw` applies it to the stream URL after any http-to-https upgrade and before the https check and dedupe, so two records that differ only in those parameters are one station.

Rules:

1. **Names match case-insensitively**, after percent-decoding. Exact names are in `CLEAN_PARAM_NAMES`: `newListeningSessionID`, `listeningSessionID`, `playSessionID`, `sessionid`, `session-id`, `lat`, `lon`, `zip`, `uid`, `listenerId`, `profileId`, `birthYear`, `age`, `gender`, `us_privacy`, `init_id`, `modTime`, `terminalId`, `deviceName`, `fb_broadcast`, `companionAds`, `playedFrom`, `pname`, `host`, `clientType`, `dist`, `territory`, `callLetters`, `rj-ttl`, `rj-tok`. Prefixes are in `CLEAN_PARAM_PREFIXES`: `aw_0_1st.*` (any), `aw_0_req.*`, `aw_0_azn.*`, `gdpr*`, `utm_*`.
2. **Every other parameter is kept**, in its original order and encoding. Some servers need parameters the directory does not document (`streamid`, `type`), so an unknown name is never removed.
3. **The scheme, host, port, path and fragment are never changed.** An empty query loses its `?`. A URL that does not parse, or has nothing to remove, is returned unchanged.

Build result, `npm run catalog` on 2026-11-18 (live, exit 0):

- Stream URLs cleaned: **190 of 7,009** raw records (the `stream URLs cleaned` line of the build summary).
- Newly collapsed in dedupe: **6 stations**. On one saved directory snapshot (7,009 records), the old rules leave 4,421 Radio Browser stations after dedupe and the new rules 4,415. The six are 103.7 The Oasis, The Light FM, KUTX AMX, WVCO - 94.9 The Surf, 100.3 The Edge and KUTC the Boss 95.7. Each one keeps the other record with the same clean stream.
- Total in the file: **4,416** (4,415 Radio Browser plus 1 curated). The committed file before this change had 4,420, but it came from an earlier directory snapshot, so the difference mixes directory changes with cleaning. The snapshot comparison above is the measure of this change.

Examples (before, then after; `u` in the file):

| Station | Before | After |
|---|---|---|
| KEXP | `kexp160.aac?listenerid=f4bcb5c7...&awparams=companionAds%3Atrue` | `kexp160.aac?awparams=companionAds%3Atrue` |
| 100hitz - Top 40 | `6025_128.mp3?DIST=TuneIn&TGT=TuneIn&maxServers=2&gdpr=0&us_privacy=1YNY&partnertok=...` | `6025_128.mp3?TGT=TuneIn&maxServers=2&partnertok=...` |
| La Mega 97.9 | `NY_WSKQ_icy?source=TuneIn&bundle=tunein.com&lat=36.3933&long=-97.9158` | `NY_WSKQ_icy?source=TuneIn&bundle=tunein.com&long=-97.9158` |
| 97.1 The Eagle Rocks | `zc2241/hls.m3u8?streamid=2241&zip=&aw_0_1st.playerid=iHeartRadioWebPlayer&...&listenerId=...&profileId=...&terminalId=159&...` | `zc2241/hls.m3u8?streamid=2241&stationid=2241` |
| 103.7 The Oasis | `KOAZAM?playSessionID=EE67F132-DB59-0E2B-D5F260EC5335C908` | `KOAZAM` |

Remaining query strings: **400 of 4,416** stream URLs still have a query. The ten most common parameter names: `mp` 112, `uuid` 29, `ref` 29, `streamid` 22, `source` 18, `partnertok` 14, `zt` 14, `type` 14, `TGT` 13, `maxServers` 13. They were left in place for these reasons:

- `mp` is a mount path (`/stream/;`, `/1`), not listener data. `streamid` and `type` are kept on purpose (rule 2).
- `partnertok` and `zt` are TuneIn partner or stream tokens (JWTs). They are not listener data, but they may be stale. Removing them is a decision for the manager.
- `uuid` is either a device id or a mount name, depending on the host. `ref=radiobrowser` is the directory's own tag. `TGT`, `source` and `maxServers` are targeting or source tags, the same kind as `DIST`, which is removed.

Spot-checks, 2026-11-18, `curl` from the build sandbox through the normal proxy, with a ranged request (`-r 0-4095`) and a 20 s limit. The redirects were not followed. The servers ignored the range and streamed the body, so `curl` stopped at 20 s; the status and content-type are the headers:

| URL (cleaned) | Result |
|---|---|
| `https://stream.revma.ihrhls.com/zc2241/hls.m3u8?streamid=2241&stationid=2241` | `302` to `https://n01a-e2.revma.ihrhls.com/zc2241/hls.m3u8?rj-ttl=5&rj-tok=...&streamid=2241&stationid=2241`. The server added its own `rj-ttl`/`rj-tok` to the redirect, so those tokens are per play and not needed in the directory URL. |
| `https://bonneville.cdnstream1.com/2617_48.aac` | `200`, `Content-Type: audio/aacp`, audio streamed (299,996 bytes before the 20 s limit). |
| `https://streaming.live365.com/a37180` | `302` to `https://das-edge93-live365-dal05.cdnstream.com/a37180`. The redirect target was not checked. |
| Control, `https://listen.181fm.com/181-blues_128k.mp3` (not cleaned; the file has no cleaned 181fm URL) | `200`, `Content-Type: audio/mpeg`, audio streamed. |

Limits:

- The list is a judgement from the URLs seen in this data. A server may need one of the removed names; the three spot-checks do not test every host, and nothing was played in a browser.
- The curated skip check compares stream keys (`streamKey` in `src/catalog/curated.mjs`), and both sides are cleaned with `cleanStreamUrl` first. A directory URL with a session therefore matches the clean curated URL, and the curated entry is skipped (test in `curated.test.ts`). Before this change the comparison used the raw directory URL.

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

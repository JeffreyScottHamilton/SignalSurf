# Decisions

Short log of the decisions in this repository, with the reason for each. Each entry describes what the code does today; file references point to where it happens.

## US music only

Roadtrip Radio lists US music stations and nothing else. The product decision (`.ultimatum/specs/roadtrip.md`) was to make the app a map of American music radio, not a directory of every station worldwide. The earlier app searched the whole directory and had news, talk and sports filters, which did not fit a music map. Reason: a smaller, clearer product, and a catalogue that can be checked. Stations outside the US, and non-music stations, are not in the catalogue (`scripts/build-catalog.mjs`, `src/catalog/rules.mjs`).

## A prebuilt static catalogue instead of live queries

The app ships one file, `public/catalog.json`. The build script (`npm run catalog`) fetches the US stations from the Radio Browser directory once, applies the music rules, and writes the file. Search, genre filters, the station list and the map all run in the browser from that file (`src/catalog/`, `src/state/mapData.ts`). Reasons:

- The directory is run by volunteers and can be slow or unavailable. A live query per search or per map area made the app depend on it at every step.
- The map shows every station at once, so it needs the whole list locally, not one page at a time.
- Builds are deterministic: `npm run build` makes no network requests.
- Fewer requests to a third party, and no per-keystroke traffic.

The trade-off is that the catalogue is a snapshot, refreshed by hand (see the README).

## The music rule: tags first, names second

A station is kept only when all of these hold (`classifyDetailed` in `src/catalog/rules.mjs`):

1. No tag is a hard exclude. The list is `news`, `talk`, `sports`, `sport`, `preaching`, `teaching`, `sermons`, `bible`, `scanner`, `weather`, `traffic`, `old time radio`, `otr`, `comedy`, `audiobooks` and `podcast`, matched as a whole tag or whole word. A station with one is dropped.
2. Its tags give at least one genre. Each tag is matched against a keyword list for each genre (whole words, accents and punctuation folded). A station can have several genres.

Only when the tags give no genre is the **name** used (`nameGenres`): a whole-word genre word in the name ("Classic Rock 101") admits the station, marked `by: name`. Two guards apply to names:

- A hard-exclude word in the name blocks name admission (the tag list above plus `espn`, `npr`, `sermon`, `police`, `weather`, `traffic`, `scanner`, `bible`).
- A decade word ("80s", "90's") does not admit a station when the name also holds a Christian network word (`Christian`, `K-LOVE`, `KLOVE`, `Air1`, `Salem`, `Moody`, `Family Radio`, `CCM`). Such a name is religious programming, not oldies.

A station whose tags are only generic music words (`music`, `variety`, `eclectic`, `freeform`, `various`, `community radio` and similar, see `GENERIC_MUSIC_TAGS`) is kept with no genres: it shows under All only. Any other tags that give no genre, with no genre word in the name, drop the station as `no-genre`. A station with no tags at all is kept as uncategorized (see the next section) unless its name holds a non-music word, in which case it is dropped as `untagged`. Reason: tags are what stations provide about themselves; names are a fallback that is only used when the tags say nothing, and the guards stop the fallback from admitting news, sermons or religious stations.

## Untagged US stations are kept as uncategorized

A US station with an HTTPS stream (or an http stream on a host that serves HTTPS, see the HTTP upgrade section) and no tags at all is kept with `genres: []` and the flag `uncategorized: true` (short key `y` in the file). It appears under All and in search only, and the list and map show "Genre not listed". It is not filtered by any genre chip. Reason: a large group of US stations had no evidence either way, and leaving them all out removed them without a check. Whether they are music is not known; the directory gives no content for them. Keeping them under All and in search, with a visible "Genre not listed", lets the user decide. In the 2026-11-18 query, 1,436 US https stations had no tags: 213 kept a genre from their name, 58 were dropped by the name check, and 1,165 became uncategorized (1,157 after dedupe). In the 2026-11-18 build with the HTTP upgrade, 1,253 stations are uncategorized.

The cost is that some are not music. The directory gives no content for them, so talk, local, religious or spoken-word programming can be in this group. To limit that, an untagged station is still dropped when its name holds a whole word from this list: news, talk, sports, sport, scanner, police, fire, sheriff, ems, dispatch, weather, traffic, sermon(s), preaching, teaching, bible, church, ministry, ministries, podcast, comedy, audiobook(s), npr news, and the hard-exclude and name guards above. A name that states a genre ("Classic Rock 101") still gets that genre and is not uncategorized. This rule is in `classifyDetailed` (`src/catalog/rules.mjs`), and the build summary prints the uncategorized count and the untagged drops (`excluded by name`). Dedupe is unchanged.

## State and city: never guessed

`stateCode` is the first of these that applies (`normalizeRaw`, `stateFromIso`, `parseStateText`, `stateAtPoint`):

1. The ISO code in the directory (`US-CA` and similar).
2. An exact state name or abbreviation in the directory's `state` text.
3. The point-in-polygon test of the station's coordinates against the US Census state outlines in `us-atlas` (build time only). Coordinates inside a US box but in no state (sea, Canada, Mexico) are kept only when the state is already known.
4. Otherwise `null`.

`city` is the remainder of the `state` text when it clearly contains more than the state ("New York NY" gives "New York"), and only when that text agrees with the chosen state code. Coordinates outside the US boxes (lower 48, Alaska, Hawaii and the territories) are dropped to `null`, never moved (`inUsBox`). Reason: a wrong state is worse than no state; the search and the list show "United States" for a station with no state.

## Catalogue format: short keys and rounding

To fit the file under 900 KiB without dropping stations, records use short keys (`CATALOG_KEYS` in `src/catalog/rules.mjs`: `i` id, `n` name, `u` stream, `h` homepage, `f` favicon, `s` state, `c` city, `t` tags, `g` genres, `x` hls, `a` lat, `o` lng, `y` uncategorized, `k` clicks). `expandCatalogRecord` maps them back to the `Station` field names in the loader (`src/catalog/catalog.ts`) and in the e2e checks. Coordinates are rounded to 4 decimals, tags are capped at 3, and `codec` and `bitrate` are not written because no screen or player reads them. Keys whose value is null, false or empty are left out. Reason: the file is loaded on every visit, and the key names were most of its size.

## Session and favourites are browser-local

Favourites and history are stored in `localStorage` under `roadtrip:favorites:v1`, `roadtrip:history:v1` and `roadtrip:settings:v1` (`src/storage/`). History keeps 50 entries, newest first. A snapshot of each station is kept, so a saved station still shows its name if the catalogue changes. All storage goes through `safeStorage`, so the app still works when storage is blocked. Reason: no account or server to sync with.

## Storage key migration from the old app

The earlier app wrote `signalsurf:favorites:v1`, `signalsurf:history:v1` and `signalsurf:settings:v1`. On start, `migrateLegacyStorage` (`src/storage/migrate.ts`) does this for each store: when the new key is absent and the old key exists, it reads the old value through the sanitiser, adapts old snapshots (the old `region` and `country` fields become `city: null, stateCode: null`, or the catalogue record when the station id is in the catalogue), writes the new key, and removes the old one. Stations that are not in the catalogue, or not in the US, are kept and stay playable. Reason: favourites a user already saved should survive the change of app. The old key names remain only in this migration and its tests.

## Map: US states only, whole-number zoom

- Below zoom 6 the map draws only the US: the state outlines from `us-atlas/states-10m.json` (`src/map/landData.ts`), a separate chunk loaded with a dynamic import. Everything outside them is the ocean colour. The world-atlas land layer was removed. From zoom 6 the imagery section below applies.
- The map opens fitted to the lower 48 (`LOWER_48` in `mapController.tsx`). Pan bounds are `[14,-190]` to `[74,-60]` (`PAN_BASE`), so Alaska (the Aleutians reach -188), Hawaii and Puerto Rico are reachable and nothing else. The minimum zoom shows the whole US, centred.
- The state borders get wider as the map zooms (`stateWeightFor` in `src/map/zoom.ts`): a hairline at the start view, at least about 1px from zoom 6.
- Attribution: "Stations: Radio Browser, plus a few hand-checked official station streams · Map: US Census Bureau", with the street credit after it ("... Map: US Census Bureau, USGS The National Map"; phones show "Radio Browser · US Census Bureau, USGS"). The note covers the curated stations (`data/curated-stations.json`), which are not from Radio Browser.
- The minimum zoom is a whole number (`minZoomFor` in `src/map/zoom.ts`), rounded down so the whole US (from -188 to -64) fits the panel width. Reason: markercluster walks its grid from `minZoom - 1` but builds its top level at `floor(minZoom) - 1`. With a fractional minimum, stations that never cluster were dropped from the map; the grids are also rebuilt whenever the whole minimum changes.

## Map imagery: tiles from zoom 6, with a fallback

Below zoom 6 the map is the vector outline view, and it makes no tile requests. From zoom 6 the map shows imagery, because at city scale the outline view does not show where a station sits. Two sources, both without a key or an account:

- **Streets:** the USGS `USGSTopo` service (`basemap.nationalmap.gov`, The National Map, public domain). Its native top level is 16 (checked at Denver, New York and San Francisco: 16 returns tiles, 17 returns 404); the view allows one level of upscaling to 17. A basemap that needs a key or shows a watermark is not used. The class `ss-tiles--streets` on the layer applies a CSS filter (`invert(1) hue-rotate(180deg) brightness(0.85) contrast(0.9) saturate(0.6)`) so the light topo map reads on the dark panel; the satellite layer is not filtered.
- **Satellite:** the USGS `USGSImageryOnly` service (`basemap.nationalmap.gov`). The `ImageryTopo` service is not published on that host, so the satellite view has no road or place labels. The service's top level is 16; the view allows one level of upscaling to 17.

From zoom 6 a non-interactive mask dims land outside the US (a world rectangle with the state outlines cut out, at 0.8 opacity), and the state borders are drawn above the tiles.

**Privacy.** At zoom 6 and above the browser requests map images from USGS (streets or satellite) only. Those requests reveal the area being viewed, at tile precision, to that host. The app does not proxy tiles, sends no search text or favourites anywhere, and adds no analytics. The street or satellite choice is saved in `roadtrip:settings:v1` on this device.

**Fallback.** If at least 4 tile requests fail and none loads (`tilesUnavailable` in `src/map/zoom.ts`), the vector fill comes back, the mask and imagery are hidden, and the map shows "Detailed map unavailable". Markers and the outlines keep working, so the map is never blank.

The marker clusters are rebuilt when the zoom range changes, because markercluster reads the map's minimum and maximum zoom only once, when the group is added.

Attribution: the base credit is "Stations: Radio Browser, plus a few hand-checked official station streams · Map: US Census Bureau". The active tile credit follows it, separated by a comma (Leaflet's join): "USGS The National Map" for streets, or "Imagery: USGS" for satellite. So the streets line reads "Stations: Radio Browser, plus a few hand-checked official station streams · Map: US Census Bureau, USGS The National Map". On phones the short forms are used ("Radio Browser · US Census Bureau, USGS"), and the credit stays on screen.

## Search and the list are local

The search (`filterStations` in `src/catalog/search.ts`) is case-insensitive. Every whitespace-separated term must match a name, city, state name or code, tag or genre label, and the list is sorted by clicks. The list shows the first 150 matches, and "Load more" reveals the next 150 from the same local result (`src/state/explore.ts`). The map shows the same matches that have valid coordinates (`src/state/mapData.ts`), so the list and the map always agree. Reason: no requests per search, and one source of truth for both views.

## Stations without coordinates are listed, never placed

A station with missing or invalid coordinates is listed, searchable and playable, but it is never drawn on the map (`hasValidCoords` in `src/map/markerSet.ts`). Coordinates are never guessed or copied from a region. Reason: a made-up position would show a real station in the wrong place.

## One audio element; pause stops the stream

The player (`src/audio/player.ts`) owns one `HTMLAudioElement`. Every change of station or state increments a token, and each event or async step returns early when its token is stale, so two streams never play at once and late events cannot change the UI. Pausing unloads the source, so resuming reconnects to the live stream instead of resuming a buffer. Reason: live radio has no meaningful position to resume.

## hls.js is loaded on demand

`hls.js` is imported only for a station marked `hls` or whose stream path ends in `.m3u8` (`needsHls`, then `import('hls.js')` in `src/audio/player.ts`). Plain streams never download it.

## Curated stations: a small hand-checked list, merged after the directory

Radio Browser does not list every station a listener wants. For a station the directory lacks, `data/curated-stations.json` holds a hand-checked entry, merged by `npm run catalog` (`src/catalog/curated.mjs`). Reasons:

- The catalogue is the only source of stations, so a station that matters must be in the file, and a hand-curated list is the simplest way to add one without a second source.
- A curated entry goes through the same rules as a directory record (https stream, music tags, US coordinates, state text), so it cannot bypass the music or https rules.
- Radio Browser wins on a shared stream, so the directory's record and its counts are never replaced by a hand-made copy, unless the entry names the record in `replaces` (next section).
- Only an official stream link checked by hand is accepted. A guessed or third-party stream would be a stream the app cannot stand behind.
- An invalid entry fails the build. A silent skip would hide the mistake.

Coordinates in the file are city-centre coordinates unless the entry says otherwise, and `coordsSource` states which. A city-centre point is not the transmitter, so the marker is approximate. Details and the list: `docs/data-source.md`, "Curated stations".

## A curated entry may correct a directory station, keeping its uuid

Some directory records are wrong and cannot be fixed by the rules. FM100.3 KSFI's record has a stream URL with another listener's session id and coordinates, no tags (so no genre and no map pin), and no coordinates. Deleting the record would lose the station's id and click count, and leaving it would keep a bad stream in the app.

So a curated entry can set `replaces` to the directory's uuid. The entry takes the directory station's place, keeps the uuid as the station id and the directory's click count, and still reports clicks to Radio Browser.

Reasons:

- Favourites and history store the id. Keeping the uuid means a listener's saved station still matches after the correction.
- The corrected station is still a directory station, so clicks belong to the directory. A new `curated:` id would have lost them.
- The correction goes through the same rules as any curated entry. A correction the music or https rules drop does not remove the directory record.
- A uuid that is missing from the fetch does not fail the build. The entry is added as `curated:<slug>` and the build prints a warning, so the mistake is visible.

Details: `docs/data-source.md`, "Corrections: replaces".

## HTTP streams are upgraded only on hosts that serve HTTPS

The app is served over HTTPS, and a browser blocks `http:` audio on an HTTPS page (mixed content), so a catalogue stream must be `https:`. Before this change the directory query asked for HTTPS streams only (`is_https=true`), which hid many stations on servers that also serve HTTPS.

Now the query has no `is_https` filter. An `http://` stream is written as `https://` only when its own host:port is the host:port of an https stream of some station in the same result (`httpsHostKeys`, `upgradeHttpUrl` in `src/catalog/rules.mjs`). Path and query are kept, and the port is never changed. A stream on any other host is dropped as `non-https`. A favicon gets the same rule and is omitted otherwise. Homepages are links and are not changed; they may be `http:` or `https:`.

Reason: the host is evidence that the server does serve HTTPS. In the 2026-11-18 data, 561 stations (455 music, 106 uncategorized) were added this way. The rule is by host, not by test: some upgraded streams will fail, because the mount may not exist over HTTPS, or a CDN redirect may refuse. The app does not test them and does not mark them. A failing one shows the player's normal error and Try again. Trade-off accepted: more stations, with some that do not play, rather than a list that hides stations that do. Details and the spot-check: `docs/data-source.md`.

## Small custom store and plain CSS

`src/lib/createStore.ts` is a small store with a `useStore` hook built on `useSyncExternalStore`. The three views switch with state, and the URL does not change, so there is no router. Colours, spacing and type are CSS custom properties in `src/styles/tokens.css`; components use plain CSS with the `ss-` class prefix. Reason: the app has a few shared values and a fixed visual system, so a state library, a router or a CSS framework would add weight without a benefit.

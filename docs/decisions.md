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

A station whose tags are only generic music words (`music`, `variety`, `eclectic`, `freeform`, `various`, `community radio` and similar, see `GENERIC_MUSIC_TAGS`) is kept with no genres: it shows under All only. Any other tags that give no genre, with no genre word in the name, drop the station as `no-genre`; a station with no tags at all is `untagged` and dropped. Reason: tags are what stations provide about themselves; names are a fallback that is only used when the tags say nothing, and the guards stop the fallback from admitting news, sermons or religious stations.

## State and city: never guessed

`stateCode` is the first of these that applies (`normalizeRaw`, `stateFromIso`, `parseStateText`, `stateAtPoint`):

1. The ISO code in the directory (`US-CA` and similar).
2. An exact state name or abbreviation in the directory's `state` text.
3. The point-in-polygon test of the station's coordinates against the US Census state outlines in `us-atlas` (build time only). Coordinates inside a US box but in no state (sea, Canada, Mexico) are kept only when the state is already known.
4. Otherwise `null`.

`city` is the remainder of the `state` text when it clearly contains more than the state ("New York NY" gives "New York"), and only when that text agrees with the chosen state code. Coordinates outside the US boxes (lower 48, Alaska, Hawaii and the territories) are dropped to `null`, never moved (`inUsBox`). Reason: a wrong state is worse than no state; the search and the list show "United States" for a station with no state.

## Catalogue format: short keys and rounding

To fit the file under 900 KiB without dropping stations, records use short keys (`CATALOG_KEYS` in `src/catalog/rules.mjs`: `i` id, `n` name, `u` stream, `h` homepage, `f` favicon, `s` state, `c` city, `t` tags, `g` genres, `x` hls, `a` lat, `o` lng, `k` clicks). `expandCatalogRecord` maps them back to the `Station` field names in the loader (`src/catalog/catalog.ts`) and in the e2e checks. Coordinates are rounded to 4 decimals, tags are capped at 3, and `codec` and `bitrate` are not written because no screen or player reads them. Keys whose value is null, false or empty are left out. Reason: the file is loaded on every visit, and the key names were most of its size.

## Session and favourites are browser-local

Favourites and history are stored in `localStorage` under `roadtrip:favorites:v1`, `roadtrip:history:v1` and `roadtrip:settings:v1` (`src/storage/`). History keeps 50 entries, newest first. A snapshot of each station is kept, so a saved station still shows its name if the catalogue changes. All storage goes through `safeStorage`, so the app still works when storage is blocked. Reason: no account or server to sync with.

## Storage key migration from the old app

The earlier app wrote `signalsurf:favorites:v1`, `signalsurf:history:v1` and `signalsurf:settings:v1`. On start, `migrateLegacyStorage` (`src/storage/migrate.ts`) does this for each store: when the new key is absent and the old key exists, it reads the old value through the sanitiser, adapts old snapshots (the old `region` and `country` fields become `city: null, stateCode: null`, or the catalogue record when the station id is in the catalogue), writes the new key, and removes the old one. Stations that are not in the catalogue, or not in the US, are kept and stay playable. Reason: favourites a user already saved should survive the change of app. The old key names remain only in this migration and its tests.

## Map: US states from us-atlas, world land dimmed, whole-number zoom

- The US state outlines come from `us-atlas/states-10m.json` (`src/map/landData.ts`). They are a separate chunk, loaded with a dynamic import, drawn as the lighter land with thin borders.
- The rest of the world is `world-atlas/countries-50m.json`, drawn darker and muted (`--ss-map-land-dim`), so Canada and Mexico stay in view but do not compete with the US.
- The map opens fitted to the lower 48 (`LOWER_48` in `mapController.tsx`). Pan bounds are `[5,-180]` to `[75,-50]`, so Alaska, Hawaii and Puerto Rico are reachable. Attribution: "Stations: Radio Browser · Map: US Census Bureau, Natural Earth".
- The minimum zoom is a whole number (`minZoomFor` in `src/map/zoom.ts`), rounded up so the lower 48 span at least 60% of the panel. Reason: markercluster walks its grid from `minZoom - 1` but builds its top level at `floor(minZoom) - 1`. With a fractional minimum, stations that never cluster were dropped from the map; the grids are also rebuilt whenever the whole minimum changes.

## Search and the list are local

The search (`filterStations` in `src/catalog/search.ts`) is case-insensitive. Every whitespace-separated term must match a name, city, state name or code, tag or genre label, and the list is sorted by clicks. The list shows the first 150 matches, and "Load more" reveals the next 150 from the same local result (`src/state/explore.ts`). The map shows the same matches that have valid coordinates (`src/state/mapData.ts`), so the list and the map always agree. Reason: no requests per search, and one source of truth for both views.

## Stations without coordinates are listed, never placed

A station with missing or invalid coordinates is listed, searchable and playable, but it is never drawn on the map (`hasValidCoords` in `src/map/markerSet.ts`). Coordinates are never guessed or copied from a region. Reason: a made-up position would show a real station in the wrong place.

## One audio element; pause stops the stream

The player (`src/audio/player.ts`) owns one `HTMLAudioElement`. Every change of station or state increments a token, and each event or async step returns early when its token is stale, so two streams never play at once and late events cannot change the UI. Pausing unloads the source, so resuming reconnects to the live stream instead of resuming a buffer. Reason: live radio has no meaningful position to resume.

## hls.js is loaded on demand

`hls.js` is imported only for a station marked `hls` or whose stream path ends in `.m3u8` (`needsHls`, then `import('hls.js')` in `src/audio/player.ts`). Plain streams never download it.

## HTTPS-only streams and favicons

A catalogue station is kept only when its stream is `https:` (`normalizeRaw`, `non-https` drop reason). Favicons must be `https:`; homepages may be `http:` or `https:`. Reason: the app is served over HTTPS, and a browser blocks `http:` streams as mixed content, so such a station could never play. The number dropped for this reason in the current build is 0, since the directory query already asks for HTTPS streams.

## Small custom store and plain CSS

`src/lib/createStore.ts` is a small store with a `useStore` hook built on `useSyncExternalStore`. The three views switch with state, and the URL does not change, so there is no router. Colours, spacing and type are CSS custom properties in `src/styles/tokens.css`; components use plain CSS with the `ss-` class prefix. Reason: the app has a few shared values and a fixed visual system, so a state library, a router or a CSS framework would add weight without a benefit.

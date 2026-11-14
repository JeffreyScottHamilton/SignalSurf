# Decisions

Short log of the architectural decisions in this repository, with the reason for each. Each entry describes what the code does today; the file references point to where it happens.

## No backend, static site

SignalSurf is a single-page React, TypeScript and Vite app. `npm run build` writes a static `dist/` folder, and no server code is in the repository. There are no accounts, no analytics and no tracking. No secrets are needed, so the build reads no environment variables.

## Radio Browser as the only data source, with runtime server discovery

All station data comes from the Radio Browser API (`src/api/radioBrowser.ts`). The first request in a session asks `https://all.api.radio-browser.info/json/servers` for the current server list. Names are checked against `*.api.radio-browser.info`, shuffled, and followed by `de1`, `de2` and `fi1` as fallbacks. A network error, timeout or 5xx is retried once on the next server, and the server that worked is remembered for the session. Discovery is resolved once per session. Reason: the service is volunteer-run and its hostnames can change, so a hard-coded list alone would break over time.

## Requests use `hidebroken` and `is_https`

Every API request sends `hidebroken=true&is_https=true` (`apiList`). The app is served over HTTPS, and a browser would block an `http://` stream as mixed content anyway. Reason: fewer dead or unplayable results, and no requests the browser cannot complete.

## HTTPS-only streams

A station is dropped unless its stream URL is `https:` (`src/api/normalize.ts`). Favicons must also be `https:`; homepages may be `http:` or `https:`. Reason: the same mixed-content rule. Stations that only offer `http:` are not shown, so the player never tries them.

## Leaflet with bundled Natural Earth shapes, no tile provider

The map is Leaflet (`src/map/mapController.tsx`) drawn over country shapes from `world-atlas/countries-50m.json`, which is bundled and loaded as a separate chunk (`src/map/landData.ts`). There are no raster or vector tile requests. Reason: no third-party map requests (privacy), no API key, and a flat dark style that matches the design. The trade-off is less detail at high zoom. Zoom is capped at 8.

## Marker clustering, 1000 popular stations up front, nearby stations on demand from zoom 3

On load, the app asks for the 1000 most-clicked stations that have coordinates (`has_geo_info=true`, `order=clickcount`, `limit=1000`, `offset=0`, `fetchMapStationsPage`). Nothing else is loaded up front: there are no background pages, and data-saver or 2G settings do not change this. From zoom 3, once the map has rested for 600 ms, the app asks for the 500 most-clicked stations within half the visible diagonal of the centre (centre to corner, rounded up to 150, 300, 600, 1200 or 2500 km, capped at 2500 km), with the same 0.5 degree snapped centre and radius bucket in the cache key and the request (`scheduleLoad`, `loadNear`, `nearKey`). A request already loaded is not repeated. A new request aborts the one in flight, and an aborted request is cancelled on the wire unless another caller still waits for it. The chip "Loading stations in this area…" appears only after a nearby request has been in flight for more than 400 ms (`nearStatus`). Reason: the map shows what the user is looking at, and the starting set stays small. Markers are grouped with `leaflet.markercluster` (`maxClusterRadius` 22). Existing markers are not rebuilt when a nearby result arrives, and the map does not move. Stations from a search with coordinates are drawn as well, even when they are outside the starting set (`WorldMap` passes the explore results to `mergeMarkerStations`), and the map does not move for them either; selecting a result still pans to it. The map keeps at most 8000 stations (`mapData.ts`, `CAP`).

## Stations without coordinates are listed, never placed

A station with no coordinates, or with invalid ones, still appears in the lists and can be played. It is never drawn on the map (`mergeMarkerStations` in `src/map/markerSet.ts` keeps only stations where `hasValidCoords` is true). Coordinates are never guessed or copied from the country. Reason: a made-up position would show the wrong place for a real station.

## One audio element, session tokens, pause stops the stream

The player (`src/audio/player.ts`) owns a single `HTMLAudioElement`. Every change of station or state increments a `token`, and each event handler and async step returns early when its token is no longer current. This prevents two streams from playing at once and stops late events from an old station from changing the UI. Pausing a live stream stops it: `pause()` clears the source and reloads the element, so resuming reconnects to the live stream instead of resuming from a buffer. Reason: live radio has no meaningful position to resume from.

## hls.js is loaded on demand

`hls.js` is imported only when a station is marked `hls` or its stream path ends in `.m3u8` (`needsHls`, then `import('hls.js')` in `src/audio/player.ts`). Plain streams never download it. Reason: most stations do not need it.

## Category mapping is approximate

Radio Browser tags are free text. `classifyTags` (`src/api/categories.ts`) matches keyword lists for music, news, talk and sports, using whole-word matches after folding accents and punctuation. The category filter also sends a server-side `tag` hint for the four categories. Results can be wrong in both directions, and the UI does not claim otherwise. Reason: there is no controlled vocabulary to map onto.

## Favourites and history are local snapshots keyed by `stationuuid`

Favourites and history store a copy of each station, keyed by its Radio Browser `stationuuid` (`station.id`) in `localStorage` under `signalsurf:favorites:v1` and `signalsurf:history:v1` (`src/storage/`). History keeps 50 entries, newest first, and moves an existing station to the top. A snapshot is kept so a saved station still shows its name after the directory changes or the station goes offline. All storage access goes through `safeStorage`, so the app still works when storage is blocked. Reason: no account or server to sync with.

## The station list pages on demand with `offset`

The list starts with the first 150 results, and "Load more stations" requests the next page with `offset` = pages loaded x 150 (`searchStationsPage`, `loadMore` in `src/state/explore.ts`), appending only stations not already listed. Nothing is stored between presses, and a new search discards the paging. Reason: the whole Radio Browser catalogue can be reached without fetching it all up front, and the user decides when to spend the requests.

## Small custom store instead of a state library

`src/lib/createStore.ts` is about one module: `createStore` plus a `useStore` hook built on `useSyncExternalStore`. Routing is not a library either: the three views are switched with `uiStore` state, and the URL does not change. Reason: the app has a few shared values (explore results, map stations, selection, player state) and no need for a state library or a router. The package list in `package.json` has neither.

## Plain CSS with tokens

Colours, spacing, radii and type sizes are CSS custom properties in `src/styles/tokens.css`. Components use plain CSS files with the `ss-` class prefix. Reason: the visual system is small and fixed, and a CSS framework would add weight and a second source of styles.

# Roadtrip Radio

Roadtrip Radio is a free map of US music radio stations that you can play in the browser. Find stations on a map of the lower 48 states, search by city, state or station name, filter by genre, and play a live stream. It is a static React, TypeScript and Vite app: no backend, no accounts, no analytics.

## Features

- A map of US states with station markers grouped into clusters. It opens on the lower 48 states; Alaska, Hawaii and Puerto Rico are reachable by panning and zooming out. Selecting a station pans to it and opens a popup with Play. From zoom 6 the map adds street or satellite imagery (a button in the map's control stack switches between them), dims land outside the US and draws the state borders over the imagery.
- A station list that matches the map: the search box and genre chips filter both, and the count line shows how many stations match.
- Search by station name, city, state name or code, tag or genre. "texas", "tx" and "new york" all work.
- Genre chips: All, Rock, Country, Pop, Hip-Hop & R&B, Jazz & Blues, Classical, Electronic, Oldies, Latin & World, Christian & Gospel, Indie & College, Folk & Americana. A station can be in more than one genre.
- Playback of live streams with play and pause, previous and next through the list, volume and mute. The player shows "Live" only after the browser reports that the stream is playing.
- Browser media controls through the Media Session API.
- Favourites and history, kept in this browser only.
- Settings: default volume, clearing favourites and history, and an About panel with the data sources and the catalogue date.

Everything runs in the browser. The station catalogue is one static file, `public/catalog.json`, and search, filtering and the map are computed locally from it. The only network requests are the catalogue itself, station logos, the station streams you play, and, at zoom 6 and above, map tiles from USGS (street map or satellite imagery). If the tiles cannot load, the map keeps its outline view and says so.

## Quick start

```sh
npm install
npm run dev
```

`npm run dev` starts the Vite development server and prints its local URL.

## Scripts

| Script | Command | What it does |
|---|---|---|
| `npm run dev` | `vite` | Development server with hot reload |
| `npm run build` | `tsc -b && vite build` | Typecheck, then write the production build to `dist/`. Makes no network requests. |
| `npm run preview` | `vite preview` | Serve the built `dist/` folder locally |
| `npm run typecheck` | `tsc -b --noEmit` | TypeScript check without writing output |
| `npm run lint` | `eslint . --max-warnings=0` | ESLint with no warnings allowed |
| `npm test` | `vitest run` | Unit tests (Vitest, jsdom) |
| `npm run e2e` | `node e2e/smoke.mjs` | Browser smoke test against `npm run preview` on port 4173. Set `PK_BASE_URL` to test another server. Uses the Chromium that Playwright already has installed. |
| `npm run e2e:live` | `node e2e/live-playback.mjs` | Real playback on four catalogue stations, one per stream host. Needs internet access to those hosts. Prints a table and `LIVE-PLAYBACK: n/4`. |
| `npm run catalog` | `node --use-env-proxy scripts/build-catalog.mjs` | Rebuilds `public/catalog.json` from the Radio Browser directory and merges the hand-curated stations in `data/curated-stations.json`. Needs network access. |

### When to refresh the catalogue

The catalogue is a snapshot. Run `npm run catalog` when you want the station list to reflect the directory as it is now, for example before a release, or when stations you know are missing or closed. The script prints a summary (raw count, kept, drop reasons, genre counts, coordinates, state sources); commit the new `public/catalog.json` with any rule change. The build never fetches, so builds are the same for the same catalogue file.

## Deployment

Run `npm run build` and serve the static `dist/` folder from any static host.

- Serve it over HTTPS. Station streams and logos are HTTPS only, and an HTTPS page avoids mixed-content blocks.
- The build needs no environment variables and no secrets.
- The app has one page and no client-side routes, so the host needs no rewrite rules.
- `vite.config.ts` sets no `base`, so asset paths start at `/`. Serve from the root of the host, or set `base` before building for a sub-path.

## Data source and licences

- **Stations:** the [Radio Browser](https://www.radio-browser.info/) community directory. Its site states that the data is in the public domain. The catalogue keeps stations whose stream is HTTPS, or HTTP on a host that also serves HTTPS in the directory (written as HTTPS; some may not play), and either a tag that maps to a music genre with no non-music tag, or no tags at all (kept as uncategorized, unless the name holds a non-music word). Details: [docs/data-source.md](docs/data-source.md).
- **Station locations:** a directory station with no coordinates gets the FCC licensed transmitter point, when exactly one FCC licence in its state matches it by call sign and frequency. FCC licence data is US government data in the public domain. 565 stations in this build. See [docs/data-source.md](docs/data-source.md#fcc-coordinates-for-directory-stations-scriptsfcc-coordsmjs).
- **Curated stations:** a few stations the directory does not list are added by hand from `data/curated-stations.json`. Each one has its official stream link checked by hand, and goes through the same rules. Today there is one: NOW 97.9 KBZN, Salt Lake City. See [docs/data-source.md](docs/data-source.md#curated-stations).
- **Map shapes:** US state outlines from the US Census Bureau through the `us-atlas` package (ISC licence in the package). Below zoom 6 the map draws only the US.
- **Map imagery:** street tiles from USGS (`USGSTopo`, The National Map, dimmed with a CSS filter) and satellite tiles from USGS (`USGSImageryOnly`, no labels), requested only at zoom 6 and above. The terms for these tiles were not re-checked for this build; see [docs/licenses.md](docs/licenses.md) and [docs/decisions.md](docs/decisions.md).
- **Libraries:** Leaflet, markercluster, React, hls.js, Inter and others. Their licences and the notices are in [docs/licenses.md](docs/licenses.md) and [public/THIRD-PARTY-NOTICES.txt](public/THIRD-PARTY-NOTICES.txt), which ships with the app.

The map and the About panel credit Radio Browser, the FCC (some station locations), the US Census Bureau, and the active tile source (USGS).

## Known limitations

- **Only stations with coordinates appear on the map.** The catalogue has 4,420 stations and 1,873 of them have coordinates inside the US (565 of those from FCC transmitter points). The other stations are listed, searchable and playable, but they are never placed on the map.
- **Genre filters are approximate.** They come from the free-text tags and station names that stations provide. A station can be missing from a genre, or in one it does not fit. A station whose tags give a genre is classified by its tags. Only when the tags give none is a whole-word genre in its name used, and a hard-exclude word in the name (news, sports, sermon, and similar) blocks that (see [docs/decisions.md](docs/decisions.md)).
- **Uncategorized stations may not be music.** A US station with no tags at all in the directory is kept with no genre (1,249 in this build). It appears under All and in search only, and is marked "Genre not listed". Some are talk, local or religious programming. Names with a non-music word (news, sports, church, podcast and similar) are left out. Stations tagged only "music" or "variety" also appear under All only. See [docs/decisions.md](docs/decisions.md).
- **Some streams fail in browsers.** Common causes are a codec the browser cannot decode (AAC is not in every browser), a stream that refuses browser playback, a region restriction, or a station that has gone offline. The player shows a message and a Try again button.
- **The catalogue is a snapshot.** It is refreshed only when someone runs `npm run catalog`, so a station that closes stays until the next refresh.
- **Map tiles depend on USGS.** When tiles fail, the map shows the outline view and the message "Detailed map unavailable". The map is never blank.
- **Favourites and history are local.** They are stored in this browser's `localStorage` and are not synced between devices or browsers.
- **No track information.** The app shows the station name and the playback status, not the song or artist.

## Project structure

- `src/catalog`: the catalogue loader, the search and filter (`search.ts`), the music and state rules shared with the build script (`rules.mjs`), and the genre labels.
- `src/state`: the explore state (query, genre, list paging) and the map's station list, both derived from the catalogue.
- `src/map`: the Leaflet map, the US state layer, and marker helpers.
- `src/audio`: the playback controller, which owns the single audio element.
- `src/storage`: favourites, history, settings and the one-time migration from the old keys.
- `src/components`: the React UI, in `common`, `layout`, `sidebar`, `player`, `views` and `settings`.
- `src/lib`, `src/styles`: shared helpers, the store, formatting, and the design tokens.
- `scripts/build-catalog.mjs`: builds `public/catalog.json`.
- `e2e/`: the smoke test and the live playback check.
- `docs/`: design decisions, the data source, and licences.
- `src/brand.ts`: the app name, tagline and description.

## Accessibility and keyboard use

- Tab order follows the page: the skip link, the header tabs (Explore, Favorites, History), the settings button, the search box and genre chips, the station list, the map, then the player bar.
- Enter or Space on a station row plays that station. Rows are buttons.
- The map is one tab stop: the map container. Markers and clusters are not tab stops, and clicking a marker opens its popup.
- Escape closes the settings dialog and the map popup.
- Focus is shown with an outline on `:focus-visible`.
- Animations and transitions respect `prefers-reduced-motion`.

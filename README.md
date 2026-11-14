# SignalSurf

SignalSurf is a web app for finding and playing live internet radio stations on a flat dark world map. It is a single static React, TypeScript and Vite app with no backend and no accounts, and it reads station data from the Radio Browser directory.

## Features

- World map with station markers, grouped into clusters. The 1000 most-clicked stations with coordinates load at start, then 4000 more (pages 1 to 4) load in the background (unless data-saver or a 2G connection is set), and nearby stations load as you zoom in from zoom 4.
- Station search by name, city or country, with category filters: All, Music, News, Talk and Sports.
- "Load more stations" under the list fetches the next page of results on demand (150 at a time, using the API's `offset`), and nothing is stored between presses.
- Playback of live streams with play and pause, previous and next through the list you started from, volume and mute. The player shows "Live" only after the browser reports that the stream is playing.
- Browser media controls (play, pause, previous, next) through the Media Session API.
- Favourites and history, stored in this browser only.
- Settings: default volume, and an About panel with the data attribution.

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
| `npm run build` | `tsc -b && vite build` | Typecheck, then write the production build to `dist/` |
| `npm run preview` | `vite preview` | Serve the built `dist/` folder locally |
| `npm run typecheck` | `tsc -b --noEmit` | TypeScript check without writing output |
| `npm run lint` | `eslint . --max-warnings=0` | ESLint with no warnings allowed |
| `npm test` | `vitest run` | Unit tests (Vitest, jsdom) |
| `npm run e2e` | `node e2e/smoke.mjs` | Browser smoke test (see below) |

The end-to-end script starts `npm run preview` on port 4173 unless `SS_BASE_URL` points at a running server. It uses a Playwright install that must already be available globally, since Playwright is not in `package.json`. Station data comes from the live Radio Browser API. Only the audio bytes are replaced with a silent local stream.

## Production build and deployment

Run `npm run build`. The output is the static `dist/` folder, which any static file host can serve.

- Serve it over HTTPS. The app only requests HTTPS resources (the directory API, stream URLs and station icons), so an HTTPS page avoids mixed-content blocks.
- The build needs no environment variables and no secrets.
- The app has one page (`index.html`) and no client-side routes. The code does not use a router, `pushState` or `location` for navigation, so the host needs no rewrite rules.
- `vite.config.ts` sets no `base`, so asset paths start at `/`. Serve the app from the root of its host, or set `base` in `vite.config.ts` before building for a sub-path.

## Data source and attribution

Station data comes from the [Radio Browser](https://www.radio-browser.info/) community directory. The app finds a server at runtime from the directory's server list, with fixed fallbacks. Radio Browser is run by volunteers and can be slow or unavailable.

- [docs/data-source.md](docs/data-source.md): how the API is used, with the checks behind each claim.
- [docs/licenses.md](docs/licenses.md): licences of the bundled packages and the data, with the sources quoted.

Station data is public domain according to the Radio Browser site. Map shapes come from Natural Earth through the `world-atlas` package. The map and About panel credit both sources.

## Known limitations

- Some stations do not play in a browser. Common causes are a stream format the browser cannot decode, a stream that refuses browser playback, a region restriction, or a station that has gone offline. The player shows a message when this happens.
- Category filters are approximate. They are based on the free-text tags that stations provide, so a station can be missing from a category or appear in one it does not fit.
- Only stations with coordinates appear on the map. Stations without coordinates are listed and can be played, but are never placed on the map.
- The map loads the most-clicked stations first (1000, then up to 4000 more in the background), plus nearby stations as you zoom in, so it is not a complete index.
- Favourites and history are stored in this browser's `localStorage`. They are not synced between devices or browsers.
- The app does not show song titles or other track metadata. It shows the station name and the playback status.
- Station details come from Radio Browser's volunteer-maintained records and can be wrong. For example, one sampled station had a latitude outside the valid range; the app drops such coordinates but cannot detect a swapped pair (see [docs/data-source.md](docs/data-source.md)).

## Project structure

- `src/api`: Radio Browser client, record normalisation and category mapping.
- `src/audio`: the playback controller, which owns the single audio element.
- `src/components`: React UI, split into `common`, `layout`, `sidebar`, `player`, `views` and `settings`.
- `src/lib`: small shared helpers: the store, formatting and safe `localStorage` access.
- `src/map`: the Leaflet map, country shapes and marker helpers.
- `src/state`: stores for search results, view and selection, and map data.
- `src/storage`: favourites, history and settings, saved in `localStorage`.
- `src/styles`: design tokens and base CSS.

Top-level source files are `src/App.tsx`, `src/main.tsx` and `src/types.ts`. Other folders: `e2e/` (smoke test), `docs/` (decisions and data notes), `public/` (static files).

Design decisions are recorded in [docs/decisions.md](docs/decisions.md).

## Accessibility and keyboard use

- Tab order follows the page: a "Skip to stations" link, the header navigation (Explore, Favorites, History), the settings button, the station sidebar, the map (zoom buttons and station markers), then the player bar.
- Enter or Space on a station row starts that station. Rows are buttons.
- Enter on a focused map marker clicks it. Markers are focusable because `src/map/mapController.tsx` sets Leaflet's `keyboard` option to `true`.
- Space toggles playback when focus is not on a button, link, input, select or text area. On a focused button, Space activates that button.
- Escape closes the settings dialog and the open map popup. For the popup, focus must be inside the map.
- Focus is shown with a 2px outline on `:focus-visible`.
- The CSS has `prefers-reduced-motion` rules for transitions and animations in the sidebar, player and views.

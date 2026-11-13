# Licences and attribution

Checked 2026-11-13 against `node_modules/<pkg>/package.json` (`license` field) and the LICENSE file in each package. Versions are the ones installed in this repository.

| Package | Version | Licence | What we use it for | Attribution shown where |
|---|---|---|---|---|
| Radio Browser (station data, not an npm package) | n/a | Public domain (see below) | Station names, streams, tags, coordinates, favicons | Map attribution text "Stations: Radio Browser" (`src/map/mapController.tsx`); About panel link (`src/components/settings/SettingsDialog.tsx`) |
| leaflet | 1.9.4 | BSD-2-Clause (`LICENSE`: "Copyright (c) 2010-2023, Volodymyr Agafonkin") | Map rendering, markers, popups (`src/map/mapController.tsx`) | None in the UI. The Leaflet attribution prefix is turned off (`setPrefix(false)`). |
| leaflet.markercluster | 1.5.3 | MIT (`package.json`; licence file is `MIT-LICENCE.txt`) | Clustering of station markers | None in the UI |
| topojson-client | 3.1.0 | ISC (`LICENSE`: "Copyright 2012-2019 Michael Bostock") | Converts the bundled TopoJSON to GeoJSON for the land and country shapes (`src/map/landData.ts`) | None in the UI |
| world-atlas | 2.0.2 | ISC (`LICENSE`: "Copyright 2013-2019 Michael Bostock") | Bundled country shapes, `countries-50m.json` (`src/map/landData.ts`) | Map attribution text "Map: Natural Earth" (`src/map/mapController.tsx`); About panel "Natural Earth (public domain)" (`SettingsDialog.tsx`) |
| hls.js | 1.7.4 | Apache-2.0 (`LICENSE`) | HLS (`.m3u8`) playback, loaded on demand with a dynamic `import('hls.js')` (`src/audio/player.ts`) | None in the UI |
| @fontsource-variable/inter | 5.3.0 | OFL-1.1 (`LICENSE`: "Copyright 2016 The Inter Project Authors") | UI font, imported in `src/styles/base.css` | None in the UI |
| react | 19.3.1 | MIT (`LICENSE`) | UI framework | None in the UI |

## Evidence

### Radio Browser data

- `https://www.radio-browser.info/` (home page, fetched 2026-11-13): "Data license: public domain, software license: GPL, server software: open source". Also: "Everyone is free to use the collected data (station names, tags, links to stream, links to homepages, language, country, state) in their works. I give all the rights I have at the accumulated data to the public domain."
- `https://gitlab.com/radiobrowser/radio-database/-/raw/main/README.md` (`## License`): "All of the content of this repository is in the public domain."
- `https://www.radio-browser.info/faq`: "It is completely free. Free as in Beer/chocolate :)"
- `https://de1.api.radio-browser.info/` (API docs): "This webservice can be used freely but without guarantee to work." and "Please send a descriptive User-Agent in your HTTP requests". A browser cannot set `User-Agent`, so the app does not send one.
- The API server code is AGPL-3.0 (`https://gitlab.com/radiobrowser/radiobrowser-api-rust/-/raw/master/LICENSE`). This covers the server, which SignalSurf does not include.
- No page fetched asks for a credit line. Crediting Radio Browser is still done in the app.

### Natural Earth (world-atlas)

- `node_modules/world-atlas/README.md`: "This repository provides a convenient redistribution of [Natural Earth](http://www.naturalearthdata.com/)'s [vector data](http://www.naturalearthdata.com/downloads/), version 4.1.0 as TopoJSON."
- The README does not state a licence for the Natural Earth data. Its `package.json` says ISC for the packaging.
- Natural Earth's own terms: **not verified**. `https://www.naturalearthdata.com/about/terms-of-use/` returned HTTP 403 through the sandbox proxy. The "(public domain)" wording in the About panel is the app's own statement and has not been checked against Natural Earth.

## Notices and open items

- The app shows no licence notices for the MIT, ISC, BSD-2, Apache-2.0 or OFL packages. The built `dist/` contains no copyright or `@license` text (checked with `grep` over `dist/assets`; `dist/` may be from an earlier build).
- Leaflet (BSD-2-Clause), hls.js (Apache-2.0) and Inter (OFL-1.1) ask that their notices travel with redistributed copies. Keeping `LICENSE` files next to the build output, or listing them in the About panel, would cover this. Not done in this change.
- Station logos and streams are loaded from third-party hosts. SignalSurf does not host or license them.

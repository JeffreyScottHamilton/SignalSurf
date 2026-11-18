# Licences and attribution

Checked 2026-11-17 against `node_modules/<pkg>/package.json` (`license` field) and the LICENSE file in each package. Versions are the ones installed in this repository. The full notices are in `public/THIRD-PARTY-NOTICES.txt`, which the build copies to `dist/` and which is served with the app.

| Package | Version | Licence | What we use it for | Attribution shown where |
|---|---|---|---|---|
| Radio Browser (station data, not an npm package) | n/a | Public domain (see below) | Station names, streams, tags, coordinates, favicons, in the prebuilt catalogue | Map attribution "Stations: Radio Browser" (`src/map/mapController.tsx`); About panel (`src/components/settings/SettingsDialog.tsx`) |
| FCC licence database (station coordinates, call signs, facility ids; `data/fcc-stations.json`) | n/a | US government work, public domain (FCC public data) | Discovered stations: the licence, the call sign, and the transmitter coordinates; the coordinate fill for directory stations (`scripts/fcc-coords.mjs`) | Map attribution "Some locations: FCC" (`src/map/mapController.tsx`); About panel (`src/components/settings/SettingsDialog.tsx`) |
| Wikipedia station articles (format, branding, website, city, frequency; `data/discovered-stations.json`) | n/a | CC BY-SA 4.0 (text) | Facts only, read from the infobox by `npm run discover` and recorded per station with its article title | Map attribution "Station formats: Wikipedia (CC BY-SA 4.0)" (`src/map/mapController.tsx`); About panel (`src/components/settings/SettingsDialog.tsx`) |
| Triton (StreamTheWorld) livestream redirects (official mounts; not copies of audio) | n/a | Terms of use not verified | Stream links for discovered stations, played through Triton's redirect | About panel names "official streams found via FCC, Wikipedia and Triton"; notice in `public/THIRD-PARTY-NOTICES.txt` |
| us-atlas | 3.0.1 | ISC (`LICENSE`: "Copyright 2013-2019 Michael Bostock") | US state outlines, `states-10m.json`: map layer (`src/map/landData.ts`, own chunk, dynamic import) and state polygons in the catalogue build (`scripts/build-catalog.mjs`) | Map attribution "Map: US Census Bureau"; About panel "US Census Bureau" |
| leaflet | 1.9.4 | BSD-2-Clause (`LICENSE`: "Copyright (c) 2010-2023, Volodymyr Agafonkin") | Map rendering, markers, popups (`src/map/mapController.tsx`) | None in the UI. The Leaflet attribution prefix is turned off (`setPrefix(false)`). |
| leaflet.markercluster | 1.5.3 | MIT (`MIT-LICENCE.txt`) | Clustering of station markers | None in the UI |
| topojson-client | 3.1.0 | ISC (`LICENSE`: "Copyright 2012-2019 Michael Bostock") | Converts the TopoJSON files to GeoJSON (`src/map/landData.ts`, and the build script) | None in the UI |
| hls.js | 1.7.4 | Apache-2.0 (`LICENSE`) | HLS (`.m3u8`) playback, loaded on demand with `import('hls.js')` (`src/audio/player.ts`) | None in the UI; notice in `public/THIRD-PARTY-NOTICES.txt` |
| @fontsource-variable/inter | 5.3.0 | OFL-1.1 (`LICENSE`: "Copyright 2016 The Inter Project Authors") | UI font | None in the UI; notice in `public/THIRD-PARTY-NOTICES.txt` |
| react | 19.3.1 | MIT (`LICENSE`) | UI framework | None in the UI; notice in `public/THIRD-PARTY-NOTICES.txt` |

## Evidence

### Radio Browser data

- `https://www.radio-browser.info/` (home page, fetched 2026-11-13): "Data license: public domain, software license: GPL, server software: open source". Also: "Everyone is free to use the collected data (station names, tags, links to stream, links to homepages, language, country, state) in their works. I give all the rights I have at the accumulated data to the public domain."
- `https://gitlab.com/radiobrowser/radio-database/-/raw/main/README.md` (`## License`): "All of the content of this repository is in the public domain."
- The API server code is AGPL-3.0 (`https://gitlab.com/radiobrowser/radiobrowser-api-rust/-/raw/master/LICENSE`). This covers the server, which the app does not include.
- No page fetched asks for a credit line. Crediting Radio Browser is still done in the app.

### US state outlines (us-atlas)

- `node_modules/us-atlas/package.json`: `"description": "Pre-built TopoJSON from the U.S. Census Bureau."`, `"license": "ISC"`.
- `node_modules/us-atlas/README.md`: "This repository provides a convenient redistribution of the Census Bureau’s cartographic boundary shapefiles, 2017 edition as TopoJSON." For `states-10m.json` it says the topology "is derived from the Census Bureau’s cartographic state boundaries, 2017 edition".
- `node_modules/us-atlas/LICENSE` (ISC): "Copyright 2013-2019 Michael Bostock. Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies."
- The package states no licence for the Census Bureau data. The ISC licence covers the packaging and conversion. **The Census Bureau's own terms for these shapefiles are not verified** (not checked on the Census site from this sandbox).

## Map tile services (not npm packages, not bundled)

Loaded by the browser only at zoom 6 and above (`src/map/tileLayers.ts`). The terms below were not re-checked from this sandbox; each needs a check before release.

| Service | Host | Attribution shown | Terms to check |
|---|---|---|---|
| USGS `USGSTopo` map (streets) | `basemap.nationalmap.gov` | "Map: USGS The National Map" (short form on phones: "Map: USGS") | https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits |
| USGS `USGSImageryOnly` (satellite) | `basemap.nationalmap.gov` | "Imagery: USGS" | https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits |

## Discovered stations: FCC, Wikipedia and Triton

- FCC: the licence rows come from `transition.fcc.gov` (`fmq` and `amq` lists), which are FCC public data; see `docs/coverage.md`.
- Wikipedia: the MediaWiki API (`en.wikipedia.org/w/api.php`) returns the article text. Only the radio station infobox parameters are read, as short facts (format, branding, website, city, frequency). Each entry names its article in `wikiTitle`. The text is under CC BY-SA 4.0, which asks for attribution to the article and a link; the entry's `source` field carries both. The map attribution and the About panel now name Wikipedia and its licence (CC BY-SA 4.0). The entries carry the article title but not its URL (see Open items).
- Triton: each stream is `playerservices.streamtheworld.com/api/livestream-redirect/<MOUNT>.<ext>` for a mount that Triton's livestream record names for the station's call sign. The audio is not copied and not stored. Triton's terms of use for third-party players were not checked from this sandbox.

## Notices and open items

- The notices for every bundled package are in `public/THIRD-PARTY-NOTICES.txt`, which ships with the app (`dist/THIRD-PARTY-NOTICES.txt`).
- Station logos and streams are loaded from third-party hosts. The app does not host or license them.
- Open: the us-atlas terms above are not verified against the publisher. Re-check before a public release.
- Open: the USGS tile terms in the table above are not verified from this sandbox. Re-check before a public release.
- Wikipedia (CC BY-SA 4.0) is credited in the map attribution and the About panel ("Station formats: Wikipedia (CC BY-SA 4.0)"). The About panel links the Wikipedia home page (`https://en.wikipedia.org/`), not the licence text or each article. Open: add the licence link, and the article URL to each entry, before a public release.
- Open: the Triton terms for stream links are not verified. Re-check before a release.

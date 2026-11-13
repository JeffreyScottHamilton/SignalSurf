# Data source: Radio Browser API

Research date: 2026-11-13. Every claim below was checked with the command or URL shown. Anything that could not be checked is marked **not verified**.

## Key findings

1. **Licence:** not verified. The docs page says the service "can be used freely but without guarantee to work". The GitLab LICENSE file could not be read (GitLab answers 302 from this sandbox), and `radio-browser.info` returned no connection (`curl` exit 000). Treat the data as community data used under the operator's stated terms until the licence is confirmed.
2. **Attribution:** not stated by the docs page. Attributing "Radio Browser" is a courtesy we recommend, not a requirement we verified.
3. **Rate limits:** not documented. No rate-limit headers were returned (`curl -sS -D - ...` showed none). Not verified under load. The app keeps request volume low: one server lookup per session, one map load per session, cached near-queries, and no per-keystroke requests (350 ms debounce).
4. **Credentials:** none needed. Every request in this document was made without a key or login. The docs mention no key.
5. **Geo coverage:** only a minority of popular stations have coordinates. Of the top 1000 by clicks (hidebroken, https), 358 have coords (35.8%). With `has_geo_info=true`, the top 1000 are all geo-located, and 10,822 stations in total have coords (hidebroken only, no https filter). One sampled geo record is wrong: "Bangkok Community Radio" has `geo_lat=100.5018` (out of range; the longitude 13.7563 looks swapped in). The normaliser rejects out-of-range values but cannot detect a swap that stays in range.

## Who runs it and client etiquette

- Operator: one volunteer, per the docs page ("I have been keeping it online since December, 2015 ... downtimes are possible"). Contact details are on the docs page; they are not copied here. Check: `curl -sS https://de1.api.radio-browser.info/`.
- The docs ask for a descriptive `User-Agent` ("appname/appversion"). **Browsers do not let a page set `User-Agent`**, so the app sends none. The requests still succeed without it: `curl -A "" https://de1.api.radio-browser.info/json/stations/search?limit=1` returned HTTP 200.
- The docs ask clients to count a play with `GET /json/url/{stationuuid}`. Checked with an all-zero UUID (no real station is touched): HTTP 404, so the route exists and rejects unknown IDs. Not verified that a real play increments the count; the app calls it fire-and-forget.
- Server list: `curl -sS https://all.api.radio-browser.info/json/servers` returned `de1.api.radio-browser.info` twice (IPv4 and IPv6). `de2` answered `/json/stats` with HTTP 200. `fi1` and `at1` did not connect from this sandbox (environment limit). The app's order is: discovered hosts (random first pick), then `de1`, `de2`, `fi1`.
- CORS: `access-control-allow-origin: *` on API responses (`curl -sS -D - -H "Origin: https://example.org" ...`). A plain GET needs no preflight, so the app sends no custom headers.
- Server health: `GET /json/stats` returned `{"stations":52533,"stations_broken":1084,"countries":224,"software_version":"0.7.50", ...}`.
- Direct `https://api.radio-browser.info/` is refused by the sandbox proxy (CONNECT 403). The docs were read from `https://de1.api.radio-browser.info/` instead.

## Data quality (samples fetched 2026-11-13)

| Sample | Rows | Coords | `lastcheckok=1` | https stream | `hls=1` | favicon https |
|---|---|---|---|---|---|---|
| Top 1000 by clicks (hidebroken, https) | 1000 | 358 | 1000 | 1000 | 128 | 724 |
| Top 1000 with `has_geo_info=true` | 1000 | 1000 | 1000 | 1000 | 115 | 765 |
| Top 5000 with `has_geo_info=true` | 5000 | 5000 | 5000 | 5000 | 473 | 3642 |

- With `hidebroken=true`, every sampled row had `lastcheckok=1`. Not verified that `hidebroken` is exactly `lastcheckok=1`.
- No `(0,0)` coordinates were seen. One out-of-range latitude was seen (see finding 5).
- `countrycode` was present for 994 of the top 1000 and 100% of the geo samples. `state` was present for 445 of the top 1000 (45%) and 3606 of the top 5000 geo rows (72%).
- Some `favicon` values are `http://` (39 of the top 1000) and are dropped. Some are empty.
- Names can carry leading spaces (`" Kamakura FM"`), so names are trimmed and whitespace is collapsed.
- `tags` are comma separated. Individual tags can contain spaces (`"sports news"`) and can be very long (one tag was 79 characters). Tags over 24 characters are dropped.
- `country` is the long form, for example `"The United Kingdom Of Great Britain And Northern Ireland"`. The short name comes from `countrycode` via `Intl.DisplayNames`.
- Two samples (top 1000 and top 5000 geo) gave 6000 raw rows, 5528 after dedupe (the overlap was removed).

## Search behaviour (verified)

- `order=clickcount&reverse=true` sorts by popularity.
- `name=JAZZ` and `name=jazz` both returned results: `name` matches substrings, case-insensitively.
- `state=Berlin` and `state=berlin` both returned results.
- **`country` is case-sensitive.** `country=japan` returned 0, while `country=Japan` and `country=Jap` returned 60. The app therefore title-cases the query before sending it as `country=`.
- `tag=news` returns popular news-tagged stations.
- `has_geo_info=true`, `geo_lat`, `geo_long` and `geo_distance` (metres) work as documented.

## Live proof (2026-11-13)

Script: `/tmp/claude-0/-home-user/56aa8976-1187-5e42-9581-774146525f7d/scratchpad/s1-live.sh`. It uses `hidebroken=true&is_https=true&limit=60&order=clickcount&reverse=true`, except (f), which uses limit 1000.

```
(a) popular count=60 first3=RTL | Christmas FM Non-stop! | Radio Armisa
(b) name=jazz count=60 first3=IBIZA CHILLOUT LOUNGE - ... | Smooth Jazz Lounge | 0R - PIANO JAZZ LOUNGE || ...
(c) country=japan count=0 first3=
(c2) country=Japan count=60 first3=Retro-Ko Radio | SOUND UP STATION NFRS | NHK WORLD RADIO
(d) state=berlin count=60 first3=Deutschlandfunk | DLF | MP3 128k | Deutschlandfunk | DLF | AAC 192k | ...
(e) tag=news count=60 first3=RMC Info Talk Sport | SWR3 | Deutschlandfunk | DLF | MP3 128k
(f) map geo count=1000 first3=Christmas FM Non-stop! | Radio Armisa | Classic Vinyl HD
```

Line (c) is the literal `country=japan` from the brief. It returns 0 because of case sensitivity; (c2) shows the title-cased form that the app sends.

## How the app uses the API

- **Discovery:** `GET https://all.api.radio-browser.info/json/servers`, 5 s timeout, names validated against `*.api.radio-browser.info`, shuffled, then `de1`, `de2`, `fi1` appended. Resolved once per session.
- **Failover:** a network error, timeout, or 5xx triggers one retry on the next host. A 4xx is not retried. The working host is remembered.
- **Common filters:** `hidebroken=true&is_https=true` on every request.
- **Search:** empty query gives popular stations. A query runs three parallel requests (`name`, `country` title-cased, `state`), merged, deduped, and sorted by clicks. A category adds a `tag` hint (`music`, `news`, `talk`, `sport`) and a client-side filter. If an empty-query category returns fewer than 20 after filtering, one popular request with limit 500 is added and filtered.
- **Map:** `has_geo_info=true`, popularity order, limit 1000, cached for the session. A failed load is not cached.
- **Near:** `geo_lat`, `geo_long`, `geo_distance` in metres, default limit 200. Cache key is the position rounded to 1 degree, plus radius and limit. The request itself uses the exact position.
- **Click count:** `GET /json/url/{id}` after playback starts. Errors are ignored.
- **Normalisation:** a record is dropped without a uuid, a name, or an https stream. Coordinates must be finite, within range, and not (0,0). Favicons must be https. Homepages must be http(s). Tags are split, lower-cased, trimmed, de-duplicated, capped at 8 kept tags, and categories are classified from all valid tags.
- **Dedupe:** first occurrence wins, matched by id, then stream URL, then lower-cased name plus country code. Two different stations with the same name in one country collapse into one. This is the contract's rule; it can hide a real station.

## Not verified

- Licence and attribution terms (finding 1 and 2).
- Rate limits under real load.
- That a real play increments `clickcount` through `/json/url/{id}`.
- Server-side behaviour of the `User-Agent` request (the app cannot set it from a browser).
- Hosts `fi1` and `at1` (not reachable from this sandbox).

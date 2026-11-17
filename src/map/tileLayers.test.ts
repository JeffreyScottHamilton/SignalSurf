import { describe, expect, it } from 'vitest';
import { TILE_SOURCES } from './tileLayers';
import { mapMaxZoomFor, SATELLITE_MAX_ZOOM, STREETS_MAX_ZOOM } from './zoom';

describe('TILE_SOURCES', () => {
  it('streets come from CARTO dark tiles and credit both CARTO and OpenStreetMap in both credit forms', () => {
    const s = TILE_SOURCES.streets;
    expect(s.url).toBe('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png');
    expect(s.subdomains).toBe('abcd');
    expect(s.attribution).toContain('OpenStreetMap');
    expect(s.attribution).toContain('CARTO');
    expect(s.attribution).toContain('ss-attr--short');
  });

  it('satellite uses the USGS tile path with y before x, capped at its native level 16', () => {
    const s = TILE_SOURCES.satellite;
    expect(s.url).toBe('https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}');
    expect(s.maxNativeZoom).toBe(16);
    expect(s.attribution).toBe('Imagery: <a href="https://www.usgs.gov/">USGS</a>');
  });

  it('the map maximum matches each source: streets 15, satellite native 16 plus one', () => {
    expect(mapMaxZoomFor('streets')).toBe(STREETS_MAX_ZOOM);
    expect(mapMaxZoomFor('satellite')).toBe(SATELLITE_MAX_ZOOM);
    expect(SATELLITE_MAX_ZOOM).toBe(TILE_SOURCES.satellite.maxNativeZoom! + 1);
    expect(STREETS_MAX_ZOOM).toBeLessThanOrEqual(TILE_SOURCES.streets.maxZoom);
  });
});

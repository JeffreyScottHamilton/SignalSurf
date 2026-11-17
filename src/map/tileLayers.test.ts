import { describe, expect, it } from 'vitest';
import { TILE_SOURCES } from './tileLayers';
import { mapMaxZoomFor, SATELLITE_MAX_ZOOM, STREETS_MAX_ZOOM } from './zoom';

describe('TILE_SOURCES', () => {
  it('streets come from the USGS Topo tiles, y before x, capped at its native level 16, and credit USGS in both credit forms', () => {
    const s = TILE_SOURCES.streets;
    expect(s.url).toBe('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}');
    expect(s.maxNativeZoom).toBe(16);
    expect(s.className).toBe('ss-tiles--streets');
    expect(s.attribution).toContain('USGS');
    expect(s.attribution).toContain('The National Map');
    expect(s.attribution).toContain('ss-attr--short');
  });

  it('satellite uses the USGS tile path with y before x, capped at its native level 16, and is not filtered', () => {
    const s = TILE_SOURCES.satellite;
    expect(s.url).toBe('https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}');
    expect(s.maxNativeZoom).toBe(16);
    expect(s.className).toBeUndefined();
    expect(s.attribution).toBe('Imagery: <a href="https://www.usgs.gov/">USGS</a>');
  });

  it('the map maximum matches each source: native 16 plus one for both', () => {
    expect(mapMaxZoomFor('streets')).toBe(STREETS_MAX_ZOOM);
    expect(mapMaxZoomFor('satellite')).toBe(SATELLITE_MAX_ZOOM);
    expect(STREETS_MAX_ZOOM).toBe(TILE_SOURCES.streets.maxNativeZoom! + 1);
    expect(SATELLITE_MAX_ZOOM).toBe(TILE_SOURCES.satellite.maxNativeZoom! + 1);
    expect(STREETS_MAX_ZOOM).toBeLessThanOrEqual(TILE_SOURCES.streets.maxZoom);
  });
});

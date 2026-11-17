import type { MapStyle } from '@/types';

/** One raster tile source. Leaflet is given these values; nothing is proxied or rewritten. */
export interface TileSource {
  url: string;
  attribution: string;
  subdomains?: string;
  maxZoom: number;
  maxNativeZoom?: number;
}

// Phones get the short credit (CSS picks one under 768px). The streets credit must stay in both forms.
const CARTO_LONG =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>';
const CARTO_SHORT =
  '© <a href="https://www.openstreetmap.org/copyright">OSM</a> · © <a href="https://carto.com/attributions">CARTO</a>';

/**
 * Streets: CARTO dark basemap. Satellite: USGS ImageryOnly (public domain). The ImageryTopo service is not
 * published on basemap.nationalmap.gov, so the imagery has no road or place labels.
 * Note the USGS tile path order: {z}/{y}/{x}.
 */
export const TILE_SOURCES: Record<MapStyle, TileSource> = {
  streets: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    subdomains: 'abcd',
    attribution: `<span class="ss-attr--long">${CARTO_LONG}</span><span class="ss-attr--short">${CARTO_SHORT}</span>`,
    maxZoom: 15,
  },
  satellite: {
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery: <a href="https://www.usgs.gov/">USGS</a>',
    maxNativeZoom: 16,
    maxZoom: 17,
  },
};

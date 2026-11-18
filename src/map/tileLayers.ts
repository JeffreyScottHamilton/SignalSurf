import type { MapStyle } from '@/types';

/** One raster tile source. Leaflet is given these values; nothing is proxied or rewritten. */
export interface TileSource {
  url: string;
  attribution: string;
  subdomains?: string;
  maxZoom: number;
  maxNativeZoom?: number;
  /** Class on the layer's container; the streets layer is darkened by a CSS filter on it (WorldMap.css). */
  className?: string;
}

// Phones get the short credit (CSS picks one under 768px). The streets credit must stay in both forms.
const USGS_LONG = '<a href="https://www.usgs.gov/">USGS</a> The National Map';
const USGS_SHORT = '<a href="https://www.usgs.gov/">USGS</a>';

/**
 * Streets: USGS Topo (public domain), dimmed by a CSS filter in the map styles. Satellite: USGS ImageryOnly (public domain).
 * Both are on basemap.nationalmap.gov, whose tile path order is {z}/{y}/{x}. USGSTopo has native levels up to 16.
 */
export const TILE_SOURCES: Record<MapStyle, TileSource> = {
  streets: {
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
    attribution: `<span class="ss-attr--long">${USGS_LONG}</span><span class="ss-attr--short">${USGS_SHORT}</span>`,
    maxNativeZoom: 16,
    maxZoom: 17,
    className: 'ss-tiles--streets',
  },
  satellite: {
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery: <a href="https://www.usgs.gov/">USGS</a>',
    maxNativeZoom: 16,
    maxZoom: 17,
  },
};

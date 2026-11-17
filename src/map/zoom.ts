/** Lower 48 longitude span in degrees (-125 to -66.5). */
export const LOWER_48_LNG_SPAN = 58.5;
/** The lower 48 never get narrower than this share of the panel width. */
export const LOWER_48_MIN_SHARE = 0.6;

/**
 * Smallest WHOLE zoom at which the lower 48 span at least LOWER_48_MIN_SHARE of the panel width. Recomputed on every resize.
 *
 * The minimum must be an integer. markercluster builds its top grid level at floor(minZoom) - 1 but walks
 * the tree from minZoom - 1; with a fractional minZoom (say 3.97) that walk starts above the top level and
 * silently drops every marker that never clusters, so those stations vanish from the map.
 */
export function minZoomFor(width: number): number {
  if (!(width > 0)) return 0;
  const pixelsPerDegree = (LOWER_48_MIN_SHARE * width) / LOWER_48_LNG_SPAN;
  return Math.max(0, Math.ceil(Math.log2((pixelsPerDegree * 360) / 256)));
}

export interface PanBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Web Mercator stops at this latitude. */
const MERCATOR_LAT_LIMIT = 85.0511;

/**
 * The pan box for maxBounds: `base`, widened where needed so a view of width x height pixels centred on `centre`
 * at `zoom` still fits inside it. Leaflet clamps the view into maxBounds, and when the view is taller than the box
 * it centres the box instead of the view. A fixed box shorter than the view of a tall phone panel therefore pulled
 * the lower 48 down. The box is never narrowed below `base`.
 */
export function panBoxFor(width: number, height: number, zoom: number, centre: { lat: number; lng: number }, base: PanBox): PanBox {
  if (!(width > 0 && height > 0)) return { ...base };
  const pxPerRadian = (256 * 2 ** zoom) / (2 * Math.PI);
  const pxPerDegree = (256 * 2 ** zoom) / 360;
  // One pixel of slack per side so Leaflet's rounding never clamps the view.
  const halfY = (height / 2 + 1) / pxPerRadian;
  const halfX = (width / 2 + 1) / pxPerDegree;
  const centreY = Math.log(Math.tan(Math.PI / 4 + (centre.lat * Math.PI) / 360));
  const latOf = (y: number) => ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;
  return {
    south: Math.max(-MERCATOR_LAT_LIMIT, Math.min(base.south, latOf(centreY - halfY))),
    north: Math.min(MERCATOR_LAT_LIMIT, Math.max(base.north, latOf(centreY + halfY))),
    west: Math.min(base.west, centre.lng - halfX),
    east: Math.max(base.east, centre.lng + halfX),
  };
}

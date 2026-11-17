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

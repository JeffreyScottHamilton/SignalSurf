import type { FeatureCollection, Geometry } from 'geojson';

/** Natural Earth 1:50m country shapes converted from TopoJSON. Loaded as a separate chunk. */
export async function loadLandFeatures(): Promise<FeatureCollection<Geometry>> {
  const [{ default: atlas }, { feature }] = await Promise.all([
    import('world-atlas/countries-50m.json'),
    import('topojson-client'),
  ]);
  // A GeometryCollection converts to a FeatureCollection.
  return feature(atlas, atlas.objects.countries) as FeatureCollection<Geometry>;
}

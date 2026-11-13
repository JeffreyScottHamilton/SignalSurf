/// <reference types="leaflet.markercluster" />

// world-atlas ships TopoJSON as JSON without typings. tsconfig does not enable resolveJsonModule.
declare module 'world-atlas/countries-50m.json' {
  import type { GeometryCollection, Topology } from 'topojson-specification';
  const atlas: Topology<{ countries: GeometryCollection }>;
  export default atlas;
}

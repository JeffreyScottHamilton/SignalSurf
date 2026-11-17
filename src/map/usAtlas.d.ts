// us-atlas ships TopoJSON as JSON without typings. tsconfig does not enable resolveJsonModule.
declare module 'us-atlas/states-10m.json' {
  import type { GeometryCollection, Topology } from 'topojson-specification';
  const atlas: Topology<{ states: GeometryCollection }>;
  export default atlas;
}

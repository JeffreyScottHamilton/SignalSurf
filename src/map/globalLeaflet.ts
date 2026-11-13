import L from 'leaflet';

// leaflet.markercluster's build reads a global `L` when it is evaluated.
// Import this module before 'leaflet.markercluster'.
(globalThis as unknown as { L: typeof L }).L = L;

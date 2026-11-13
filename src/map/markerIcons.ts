import L from 'leaflet';

/** 24px hit area (WCAG target minimum); the visible dot is drawn inside by WorldMap.css. */
export const STATION_ICON = L.divIcon({
  className: 'ss-marker-icon',
  html: '<span class="ss-marker"></span>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

export const SELECTED_ICON = L.divIcon({
  className: 'ss-marker-icon',
  html: '<span class="ss-marker ss-marker--selected"></span>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

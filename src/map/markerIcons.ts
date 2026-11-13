import L from 'leaflet';

/** 16px hit area; the visible dot is drawn inside by WorldMap.css. */
export const STATION_ICON = L.divIcon({
  className: 'ss-marker-icon',
  html: '<span class="ss-marker"></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

export const SELECTED_ICON = L.divIcon({
  className: 'ss-marker-icon',
  html: '<span class="ss-marker ss-marker--selected"></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

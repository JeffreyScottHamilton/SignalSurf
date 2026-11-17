import L from 'leaflet';
import './globalLeaflet';
import 'leaflet.markercluster';
import { createRoot, type Root } from 'react-dom/client';
import { selectStation } from '@/state/ui';
import type { Station } from '@/types';
import { loadStateFeatures } from './landData';
import { SELECTED_ICON, STATION_ICON } from './markerIcons';
import { MapPopupCard } from './MapPopup';
import { hasValidCoords } from './markerSet';
import { detailShown, mapMaxZoomFor, minZoomFor, panBoxFor, stateWeightFor, tilesUnavailable, US_CENTRE_LNG } from './zoom';
import { TILE_SOURCES } from './tileLayers';
import { buildMaskFeature } from './mask';
import type { MapStyle } from '@/types';

export interface MapControllerOptions {
  onZoomLimits: (atMin: boolean, atMax: boolean) => void;
  /** The map style to start with (from settings). */
  initialStyle: MapStyle;
  /** Called with true when the detailed tiles have failed to load, and with false when that is cleared. */
  onTilesUnavailable: (unavailable: boolean) => void;
}

/** Imperative Leaflet side of the map. Created once per mount, disposed on unmount. */
export interface MapController {
  setStations(list: Station[]): void;
  setSelected(station: Station | null): void;
  zoomIn(): void;
  zoomOut(): void;
  /** Returns the view to the lower 48 states fit. */
  resetView(): void;
  /** Switches the tile imagery. Below the detail zoom this only sets the choice for later. */
  setMapStyle(style: MapStyle): void;
  dispose(): void;
}

// Phones get the short form (CSS picks one under 768px); both are one line.
const ATTRIBUTION =
  '<span class="ss-attr--long">Stations: Radio Browser · Map: US Census Bureau</span>' +
  '<span class="ss-attr--short">Radio Browser · US Census Bureau</span>';
// Bounds the pan to the US: the lower 48, Alaska (the Aleutians reach -188), Hawaii and Puerto Rico, with a margin.
// Widened by panBounds() when a panel's view is larger than this box, so the whole US can be shown at the minimum zoom.
const PAN_BASE = { south: 14, west: -190, north: 74, east: -60 };
const LOWER_48 = L.latLngBounds([24.5, -125], [49.5, -66.5]);
// fitBounds centres the view on the bounds' midpoint in Mercator, which is not the latitude midpoint.
const LOWER_48_CENTRE = (() => {
  const sw = L.CRS.EPSG3857.project(LOWER_48.getSouthWest());
  const ne = L.CRS.EPSG3857.project(LOWER_48.getNorthEast());
  const c = L.CRS.EPSG3857.unproject(L.point((sw.x + ne.x) / 2, (sw.y + ne.y) / 2));
  return { lat: c.lat, lng: c.lng };
})();
const FIT_PADDING: [number, number] = [12, 12];
// The dimming mask has its own pane: above the tiles (z 200), below the state outlines (overlay, z 400).
const MASK_PANE = 'ssMask';
const MASK_PANE_Z = 350;
const MASK_OPACITY = 0.8;
const STYLES: MapStyle[] = ['streets', 'satellite'];
// Selecting a station zooms to at least FOCUS_MIN_ZOOM, never deeper than FOCUS_MAX_ZOOM, so the region stays in view.
const FOCUS_MIN_ZOOM = 5;
const FOCUS_MAX_ZOOM = 6;
// Above every marker and cluster: marker z-index is the pixel y plus this offset.
const SELECTED_Z_OFFSET = 10000;

interface Entry {
  station: Station;
  marker: L.Marker;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Cluster badge: a 20px visual in a 24px hit area. Labelled with its station count. */
class ClusterIcon extends L.DivIcon {
  private readonly count: number;

  constructor(count: number) {
    super({
      className: 'ss-cluster-icon',
      html: `<div class="ss-cluster"><span>${count}</span></div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
    this.count = count;
  }

  override createIcon(oldIcon?: HTMLElement): HTMLElement {
    const el = super.createIcon(oldIcon);
    el.setAttribute('aria-label', `${this.count} stations`);
    return el;
  }
}

function clusterIcon(cluster: L.MarkerCluster): L.DivIcon {
  return new ClusterIcon(cluster.getChildCount());
}

// Clusters are not tab stops: the map container is the single tab stop.
L.MarkerCluster.mergeOptions({ keyboard: false });

/**
 * The pan box for the panel at its current size. Sized for the minimum zoom, the largest view, so every zoom stays inside.
 * Without this a tall panel's view is taller than the fixed box, and Leaflet centres the box rather than the lower 48.
 */
function panBounds(el: HTMLElement, zoom: number): L.LatLngBounds {
  // Latitude from the lower 48 centre, longitude from the whole US: the minimum zoom then shows all of it, centred.
  const centre = { lat: LOWER_48_CENTRE.lat, lng: US_CENTRE_LNG };
  const b = panBoxFor(el.clientWidth, el.clientHeight, zoom, centre, PAN_BASE);
  return L.latLngBounds([b.south, b.west], [b.north, b.east]);
}

export function createMapController(el: HTMLElement, opts: MapControllerOptions): MapController {
  const startZoom = minZoomFor(el.clientWidth);
  const map = L.map(el, {
    worldCopyJump: false,
    maxBounds: panBounds(el, startZoom),
    maxBoundsViscosity: 1,
    minZoom: startZoom,
    maxZoom: mapMaxZoomFor(opts.initialStyle),
    zoomSnap: 0.1,
    zoomDelta: 0.5,
    preferCanvas: true,
    zoomControl: false,
    attributionControl: true,
  });
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution(ATTRIBUTION);

  let mapStyle: MapStyle = opts.initialStyle;
  // Created now, added to the map only from DETAIL_ZOOM on: no tile request is made before then.
  const tileLayers = {} as Record<MapStyle, L.TileLayer>;
  for (const s of STYLES) {
    const src = TILE_SOURCES[s];
    tileLayers[s] = L.tileLayer(src.url, {
      attribution: src.attribution,
      subdomains: src.subdomains ?? 'abc',
      maxZoom: src.maxZoom,
      maxNativeZoom: src.maxNativeZoom,
      className: src.className,
    });
  }
  // Tile results for the current style. A failure is counted per style and cleared when the style changes.
  let tileStats = { loads: 0, errors: 0 };
  let tilesDown = false;
  for (const s of STYLES) {
    tileLayers[s].on('tileload', () => {
      if (s === mapStyle) tileStats.loads += 1;
    });
    tileLayers[s].on('tileerror', () => {
      if (s !== mapStyle || tilesDown) return;
      tileStats.errors += 1;
      if (tilesUnavailable(tileStats)) {
        tilesDown = true;
        opts.onTilesUnavailable(true);
        applyDetail();
      }
    });
  }
  map.createPane(MASK_PANE).style.zIndex = String(MASK_PANE_Z);
  // Set once the state shapes load (see the land section below).
  let maskLayer: L.GeoJSON | null = null;
  let statesLayer: L.GeoJSON | null = null;
  const land = readToken('--ss-map-land');
  const stateLine = readToken('--ss-map-state-line');
  const ocean = readToken('--ss-map-ocean');
  // Fits the lower 48 on load, on phones too. Deferred to the first non-zero width when the panel is hidden.
  function fitLower48(animate: boolean) {
    if (el.clientWidth <= 0) return;
    map.fitBounds(LOWER_48, { padding: FIT_PADDING, animate });
  }
  fitLower48(false);

  let disposed = false;
  let selectedId: string | null = null;
  let openId: string | null = null;
  let openRoot: Root | null = null;
  // At most one reveal is pending: the latest selection wins.
  let pendingReveal: (() => void) | null = null;
  // The station last focused and the zoom it was focused at: a resize keeps that station centred.
  let lastFocus: { id: string; zoom: number } | null = null;
  // The blue selected dot is its own marker on the map, outside the cluster group, so it is never hidden.
  let selectionMarker: L.Marker | null = null;
  const entries = new Map<string, Entry>();

  function makeCluster(): L.MarkerClusterGroup {
    return L.markerClusterGroup({
      chunkedLoading: true,
      showCoverageOnHover: false,
      maxClusterRadius: 22,
      spiderfyOnMaxZoom: true,
      iconCreateFunction: clusterIcon,
    });
  }
  // Replaced by rebuildClusters when the zoom range changes: markercluster reads the range once, when it is added.
  let cluster = makeCluster().addTo(map);
  // The lowest zoom markercluster has per-zoom grids for. See fitMinZoom.
  let clusterFloor = Math.floor(map.getMinZoom());

  const popup = L.popup({
    className: 'ss-map-popup',
    minWidth: 200,
    maxWidth: 240,
    offset: [0, -10],
    autoPanPadding: [24, 24],
    closeButton: false,
  });
  popup.on('remove', () => disposeOpen());

  /** Unmounts the React root behind the open popup. Deferred so it never runs during a React render. */
  function disposeOpen() {
    const root = openRoot;
    openRoot = null;
    openId = null;
    if (root) setTimeout(() => root.unmount(), 0);
  }

  function closePopup() {
    map.closePopup();
    disposeOpen();
  }

  function label(id: string) {
    const e = entries.get(id);
    const node = e?.marker.getElement();
    if (!e || !node) return;
    node.setAttribute('role', 'button');
    node.setAttribute('aria-label', e.station.name);
  }

  /** Keeps the selection dot on top of the selected station, whether or not its marker is clustered. */
  function syncSelection() {
    const e = selectedId !== null ? entries.get(selectedId) : undefined;
    if (!e) {
      selectionMarker?.remove();
      selectionMarker = null;
      return;
    }
    if (selectionMarker === null) {
      selectionMarker = L.marker(e.marker.getLatLng(), {
        icon: SELECTED_ICON,
        interactive: false,
        keyboard: false,
        zIndexOffset: SELECTED_Z_OFFSET,
      }).addTo(map);
    } else {
      selectionMarker.setLatLng(e.marker.getLatLng());
    }
  }

  function openPopupFor(id: string) {
    const e = entries.get(id);
    if (!e || disposed) return;
    disposeOpen();
    const node = document.createElement('div');
    const root = createRoot(node);
    root.render(<MapPopupCard station={e.station} />);
    popup.setLatLng(e.marker.getLatLng()).setContent(node).openOn(map);
    openRoot = root;
    openId = id;
  }

  function activate(id: string) {
    const e = entries.get(id);
    if (!e) return;
    selectStation(e.station);
    openPopupFor(id);
  }

  function createMarker(s: Station, lat: number, lng: number): L.Marker {
    const marker = L.marker([lat, lng], {
      icon: STATION_ICON,
      keyboard: false,
      title: s.name,
    });
    marker.on('click', () => activate(s.id));
    marker.on('add', () => label(s.id));
    return marker;
  }

  function setStations(list: Station[]) {
    if (disposed) return;
    const want = new Set(list.map((s) => s.id));

    const removed: L.Marker[] = [];
    for (const [id, e] of entries) {
      if (!want.has(id)) {
        removed.push(e.marker);
        entries.delete(id);
      }
    }
    if (removed.length > 0) cluster.removeLayers(removed);

    const added: L.Marker[] = [];
    for (const s of list) {
      const existing = entries.get(s.id);
      if (existing) {
        existing.station = s;
        continue;
      }
      const c = s.coords;
      if (!hasValidCoords(c)) continue;
      const marker = createMarker(s, c.lat, c.lng);
      entries.set(s.id, { station: s, marker });
      added.push(marker);
    }
    if (added.length > 0) cluster.addLayers(added);

    if (openId !== null && !entries.has(openId)) closePopup();
    syncSelection();
  }

  function cancelPendingReveal() {
    if (pendingReveal === null) return;
    map.off('moveend', pendingReveal);
    pendingReveal = null;
  }

  /** Pans and zooms so the marker is on screen, then opens its popup. Reduced motion: no animation. */
  function focusStation(e: Entry) {
    const ll = e.marker.getLatLng();
    const zoom = Math.min(FOCUS_MAX_ZOOM, Math.max(map.getZoom(), FOCUS_MIN_ZOOM));
    const id = e.station.id;
    lastFocus = { id, zoom };
    cancelPendingReveal();
    // The popup is anchored at the station's coordinates, so it opens even while the marker is inside a cluster.
    const reveal = () => {
      pendingReveal = null;
      // A later selection replaced this one while the map was moving: do not open it.
      if (selectedId !== id) return;
      openPopupFor(id);
    };

    if (prefersReducedMotion()) {
      map.setView(ll, zoom, { animate: false });
      reveal();
      return;
    }
    if (ll.equals(map.getCenter()) && zoom === map.getZoom()) {
      reveal();
      return;
    }
    pendingReveal = reveal;
    map.once('moveend', reveal);
    map.flyTo(ll, zoom, { duration: 0.6 });
  }

  function setSelected(station: Station | null) {
    if (disposed) return;
    selectedId = station ? station.id : null;
    syncSelection();
    const e = station ? entries.get(station.id) : undefined;
    if (!e) {
      cancelPendingReveal();
      closePopup();
      return;
    }
    // Opened by a marker click already: keep the map still.
    if (openId === e.station.id) return;
    focusStation(e);
  }

  function emitZoom() {
    const z = map.getZoom();
    // Exposed for the end-to-end test, which cannot read Leaflet's zoom any other way.
    el.dataset.zoom = String(z);
    opts.onZoomLimits(z <= map.getMinZoom(), z >= map.getMaxZoom());
  }
  map.on('zoomend', emitZoom);
  // Exposed for the end-to-end test, which aims the map at a point with it.
  function emitCentre() {
    const c = map.getCenter();
    el.dataset.center = `${c.lat},${c.lng}`;
  }
  map.on('moveend', emitCentre);
  // Tiles, mask and state style follow the zoom (and the state borders keep their on-screen width, see stateWeightFor).
  map.on('zoomend', applyDetail);
  emitZoom();

  /**
   * Replaces the cluster group, so markercluster builds its grids for the current zoom range (minimum and maximum)
   * and every marker is re-added.
   */
  function rebuildClusters() {
    clusterFloor = Math.floor(map.getMinZoom());
    cluster.clearLayers();
    cluster.remove();
    cluster = makeCluster().addTo(map);
    cluster.addLayers([...entries.values()].map((e) => e.marker));
  }

  /** Detail (tiles, mask, outlines) is on at DETAIL_ZOOM and above, unless the tiles have failed. */
  function detailNow(): boolean {
    return detailShown(map.getZoom()) && !tilesDown;
  }

  /** The state shapes: the vector fill below the detail zoom, outlines only above it. */
  function stateStyle(detail: boolean): L.PathOptions {
    const weight = stateWeightFor(map.getZoom());
    return detail
      ? { fill: false, color: stateLine, weight, opacity: 1 }
      : { fill: true, fillColor: land, fillOpacity: 1, color: stateLine, weight, opacity: 1 };
  }

  /** Shows or hides a layer, only when its state changes, so tiles are not re-requested needlessly. */
  function setShown(layer: L.Layer, shown: boolean) {
    if (shown && !map.hasLayer(layer)) layer.addTo(map);
    else if (!shown && map.hasLayer(layer)) map.removeLayer(layer);
  }

  /** Brings the tile layer, mask and state style in line with the zoom, the style and the tile health. */
  function applyDetail() {
    const detail = detailNow();
    for (const s of STYLES) setShown(tileLayers[s], detail && s === mapStyle);
    if (maskLayer) setShown(maskLayer, detail);
    if (statesLayer) {
      setShown(statesLayer, true);
      statesLayer.setStyle(stateStyle(detail));
    }
  }

  function setMapStyle(style: MapStyle) {
    if (disposed || style === mapStyle) return;
    mapStyle = style;
    tileStats = { loads: 0, errors: 0 };
    if (tilesDown) {
      tilesDown = false;
      opts.onTilesUnavailable(false);
    }
    // The street and satellite layers have different top levels, and markercluster reads the top level once.
    map.setMaxZoom(mapMaxZoomFor(style));
    rebuildClusters();
    applyDetail();
    emitZoom();
  }

  function fitMinZoom() {
    if (el.clientWidth <= 0) return;
    const min = minZoomFor(el.clientWidth);
    map.setMinZoom(min);
    map.setMaxBounds(panBounds(el, min));
    if (map.getZoom() < min) map.setZoom(min, { animate: false });
    // markercluster builds its per-zoom grids from the minimum zoom it had when filled, and its tree walk assumes
    // that minimum is the current one. Any change of the whole minimum (narrower or wider panel) rebuilds the grids.
    if (Math.floor(map.getMinZoom()) !== clusterFloor) rebuildClusters();
  }

  const ro = typeof ResizeObserver === 'undefined'
    ? null
    : new ResizeObserver(() => {
        if (disposed) return;
        // invalidateSize keeps the old centre, so refit: the lower 48 must be centred for every panel shape.
        map.invalidateSize();
        fitMinZoom();
        // A picked station stays centred at its focus zoom through a resize. On a phone the sheet collapses right after a
        // pick: refitting the lower 48 here cancelled the fly-to, and so did reading the zoom mid-flight. invalidateSize
        // also fires moveend, which ends the pending reveal early, so the flight state cannot be used here.
        const focused = selectedId !== null ? entries.get(selectedId) : undefined;
        if (focused && lastFocus !== null && lastFocus.id === focused.station.id) {
          map.setView(focused.marker.getLatLng(), lastFocus.zoom, { animate: false });
        } else {
          fitLower48(false);
        }
        emitZoom();
        // A resize can leave the open popup past the edge: pan it back inside.
        if (openId !== null && popup.isOpen()) {
          const ll = popup.getLatLng();
          if (ll) map.panInside(ll, { paddingTopLeft: [125, 150], paddingBottomRight: [125, 40] });
        }
      });
  ro?.observe(el);

  // Escape closes the popup. The close button is off because the card's bookmark sits top-right.
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && openId !== null) closePopup();
  }
  el.addEventListener('keydown', onKeyDown);

  // Land: the US states, one non-interactive layer over the ocean. A failed load leaves the ocean base map, with
  // markers still working. Above the detail zoom the mask dims everything outside the states.
  void loadStateFeatures()
    .then((states) => {
      if (disposed) return;
      maskLayer = L.geoJSON(buildMaskFeature(states), {
        pane: MASK_PANE,
        interactive: false,
        style: { stroke: false, fill: true, fillColor: ocean, fillOpacity: MASK_OPACITY },
      });
      statesLayer = L.geoJSON(states, { interactive: false, style: stateStyle(detailNow()) });
      applyDetail();
    })
    .catch(() => null);

  return {
    setStations,
    setSelected,
    zoomIn() {
      if (!disposed) map.zoomIn();
    },
    zoomOut() {
      if (!disposed) map.zoomOut();
    },
    resetView() {
      if (!disposed) fitLower48(!prefersReducedMotion());
    },
    setMapStyle,
    dispose() {
      if (disposed) return;
      disposed = true;
      ro?.disconnect();
      el.removeEventListener('keydown', onKeyDown);
      disposeOpen();
      entries.clear();
      selectionMarker = null;
      map.remove();
    },
  };
}

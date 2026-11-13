import L from 'leaflet';
import './globalLeaflet';
import 'leaflet.markercluster';
import { createRoot, type Root } from 'react-dom/client';
import { loadNear } from '@/state/mapData';
import { selectStation } from '@/state/ui';
import type { Station } from '@/types';
import { loadLandFeatures } from './landData';
import { SELECTED_ICON, STATION_ICON } from './markerIcons';
import { MapPopupCard } from './MapPopup';
import { hasValidCoords } from './markerSet';

export interface MapControllerOptions {
  onZoomLimits: (atMin: boolean, atMax: boolean) => void;
}

/** Imperative Leaflet side of the map. Created once per mount, disposed on unmount. */
export interface MapController {
  setStations(list: Station[]): void;
  setSelected(station: Station | null): void;
  zoomIn(): void;
  zoomOut(): void;
  dispose(): void;
}

const ATTRIBUTION = 'Stations: Radio Browser · Map: Natural Earth';
const WORLD_BOUNDS = L.latLngBounds([-75, -185], [85, 185]);
const MAX_ZOOM = 8;
const PROGRESS_MIN_ZOOM = 5;
const FOCUS_ZOOM = 6;
const LOAD_DEBOUNCE_MS = 600;
const MAX_RADIUS_KM = 600;
const START_CENTER: [number, number] = [20, 10];
const NARROW_PANEL_PX = 768;
const NARROW_EXTRA_ZOOM = 0.5;
const SELECTED_Z_OFFSET = 1000;

interface Entry {
  station: Station;
  marker: L.Marker;
}

/** Smallest zoom at which the whole 360 degrees of longitude fill the panel width (hundredth-step ceiling). */
function minZoomFor(width: number): number {
  if (!(width > 0)) return 0;
  return Math.max(0, Math.ceil(Math.log2(width / 256) * 100) / 100);
}

/** Initial zoom: the world fits the width; a narrow (phone) panel starts one notch closer so land is readable. */
function startZoomFor(width: number): number {
  const min = minZoomFor(width);
  return width > 0 && width < NARROW_PANEL_PX ? min + NARROW_EXTRA_ZOOM : min;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function clusterIcon(cluster: L.MarkerCluster): L.DivIcon {
  return L.divIcon({
    className: 'ss-cluster-icon',
    html: `<div class="ss-cluster"><span>${cluster.getChildCount()}</span></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

export function createMapController(el: HTMLElement, opts: MapControllerOptions): MapController {
  const map = L.map(el, {
    worldCopyJump: false,
    maxBounds: WORLD_BOUNDS,
    maxBoundsViscosity: 1,
    minZoom: minZoomFor(el.clientWidth),
    maxZoom: MAX_ZOOM,
    zoomSnap: 0.1,
    zoomDelta: 0.5,
    preferCanvas: true,
    zoomControl: false,
    attributionControl: true,
  });
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution(ATTRIBUTION);
  map.setView(START_CENTER, startZoomFor(el.clientWidth), { animate: false });

  let disposed = false;
  let selectedId: string | null = null;
  let openId: string | null = null;
  let openRoot: Root | null = null;
  let loadTimer: ReturnType<typeof setTimeout> | undefined;
  const entries = new Map<string, Entry>();

  const cluster = L.markerClusterGroup({
    chunkedLoading: true,
    showCoverageOnHover: false,
    maxClusterRadius: 22,
    spiderfyOnMaxZoom: true,
    iconCreateFunction: clusterIcon,
  });
  cluster.addTo(map);

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

  function setEntryIcon(id: string, selected: boolean) {
    const e = entries.get(id);
    if (!e) return;
    e.marker.setIcon(selected ? SELECTED_ICON : STATION_ICON);
    e.marker.setZIndexOffset(selected ? SELECTED_Z_OFFSET : 0);
    label(id); // setIcon rebuilds the element, so the label must be re-applied
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
    const selected = s.id === selectedId;
    const marker = L.marker([lat, lng], {
      icon: selected ? SELECTED_ICON : STATION_ICON,
      keyboard: true,
      title: s.name,
      zIndexOffset: selected ? SELECTED_Z_OFFSET : 0,
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
  }

  /** Pans and zooms so the marker is on screen, then opens its popup. Reduced motion: no animation. */
  function focusStation(e: Entry) {
    const ll = e.marker.getLatLng();
    const zoom = Math.max(map.getZoom(), FOCUS_ZOOM);
    const id = e.station.id;
    const reveal = () => cluster.zoomToShowLayer(e.marker, () => openPopupFor(id));

    if (prefersReducedMotion()) {
      map.setView(ll, zoom, { animate: false });
      reveal();
      return;
    }
    if (ll.equals(map.getCenter()) && zoom === map.getZoom()) {
      reveal();
      return;
    }
    map.once('moveend', reveal);
    map.flyTo(ll, zoom, { duration: 0.6 });
  }

  function setSelected(station: Station | null) {
    if (disposed) return;
    const id = station ? station.id : null;
    if (id !== selectedId) {
      const prev = selectedId;
      selectedId = id;
      if (prev !== null) setEntryIcon(prev, false);
      if (id !== null) setEntryIcon(id, true);
    }
    const e = station ? entries.get(station.id) : undefined;
    if (!e) {
      closePopup();
      return;
    }
    // Opened by a marker click already: keep the map still.
    if (openId === e.station.id) return;
    focusStation(e);
  }

  function emitZoom() {
    const z = map.getZoom();
    opts.onZoomLimits(z <= map.getMinZoom(), z >= map.getMaxZoom());
  }
  map.on('zoomend', emitZoom);

  function scheduleLoad() {
    clearTimeout(loadTimer);
    if (map.getZoom() < PROGRESS_MIN_ZOOM) return;
    loadTimer = setTimeout(() => {
      if (disposed || map.getZoom() < PROGRESS_MIN_ZOOM) return;
      const c = map.getCenter();
      const ne = map.getBounds().getNorthEast();
      const km = Math.min(MAX_RADIUS_KM, Math.max(1, Math.ceil(map.distance(c, ne) / 1000)));
      loadNear({ lat: Math.max(-85, Math.min(85, c.lat)), lng: wrapLng(c.lng) }, km);
    }, LOAD_DEBOUNCE_MS);
  }
  map.on('moveend', scheduleLoad);

  function fitMinZoom() {
    if (el.clientWidth <= 0) return;
    const min = minZoomFor(el.clientWidth);
    map.setMinZoom(min);
    if (map.getZoom() < min) map.setZoom(min, { animate: false });
  }

  const ro = typeof ResizeObserver === 'undefined'
    ? null
    : new ResizeObserver(() => {
        if (disposed) return;
        map.invalidateSize();
        fitMinZoom();
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

  // Land is drawn on one canvas layer. Failure leaves the ocean base map, with markers still working.
  const land = readToken('--ss-map-land');
  const line = readToken('--ss-map-line');
  loadLandFeatures()
    .then((fc) => {
      if (disposed) return;
      L.geoJSON(fc, {
        interactive: false,
        style: { fillColor: land, fillOpacity: 1, color: line, weight: 0.5, opacity: 1 },
      }).addTo(map);
    })
    .catch(() => undefined);

  return {
    setStations,
    setSelected,
    zoomIn() {
      if (!disposed) map.zoomIn();
    },
    zoomOut() {
      if (!disposed) map.zoomOut();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(loadTimer);
      ro?.disconnect();
      el.removeEventListener('keydown', onKeyDown);
      disposeOpen();
      entries.clear();
      map.remove();
    },
  };
}

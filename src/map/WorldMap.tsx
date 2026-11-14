import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import './WorldMap.css';
import { MinusIcon, PlusIcon } from '@/components/common/icons';
import { useStore } from '@/lib/createStore';
import { initExplore } from '@/state/explore';
import { useMapStations, useMapStatus } from '@/state/mapData';
import { uiStore } from '@/state/ui';
import { createMapController, type MapController } from './mapController';

export function WorldMap() {
  // Markers are the current filter's matches with coordinates, so the map and the list agree.
  const drawn = useMapStations();
  const mapStatus = useMapStatus();
  const selected = useStore(uiStore, (s) => s.selected);

  const canvasRef = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<MapController | null>(null);
  const [limits, setLimits] = useState({ atMin: true, atMax: false });

  useEffect(() => {
    initExplore();
  }, []);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ctrl = createMapController(el, {
      onZoomLimits: (atMin, atMax) =>
        setLimits((prev) => (prev.atMin === atMin && prev.atMax === atMax ? prev : { atMin, atMax })),
    });
    ctrlRef.current = ctrl;
    return () => {
      ctrl.dispose();
      ctrlRef.current = null;
    };
  }, []);

  // Declared after the controller effect so they always see a live controller.
  useEffect(() => {
    ctrlRef.current?.setStations(drawn);
  }, [drawn]);

  useEffect(() => {
    ctrlRef.current?.setSelected(selected);
  }, [selected]);

  const chip =
    mapStatus === 'loading'
      ? 'Loading stations…'
      : mapStatus === 'error'
        ? 'Station markers unavailable'
        : null;

  return (
    <section className="ss-map" aria-label="World map">
      {/* Leaflet makes this element the single tab stop (keyboard pan and zoom); markers are not tab stops. */}
      <div
        ref={canvasRef}
        className="ss-map__canvas"
        role="region"
        aria-label="World map of radio stations. Use the station list to browse stations by keyboard."
      />
      {chip && (
        <p className="ss-map__status" role="status">
          {chip}
        </p>
      )}
      <div className="ss-map__zoom">
        <button
          type="button"
          className="ss-map__zoom-btn"
          aria-label="Zoom in"
          title="Zoom in"
          disabled={limits.atMax}
          onClick={() => ctrlRef.current?.zoomIn()}
        >
          <PlusIcon size={18} />
        </button>
        <button
          type="button"
          className="ss-map__zoom-btn"
          aria-label="Zoom out"
          title="Zoom out"
          disabled={limits.atMin}
          onClick={() => ctrlRef.current?.zoomOut()}
        >
          <MinusIcon size={18} />
        </button>
      </div>
    </section>
  );
}

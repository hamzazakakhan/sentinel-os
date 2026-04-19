import { Map, Layers, Navigation } from 'lucide-react';

export function MapPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Map className="w-6 h-6 text-sentinel-400" />
          Tactical Map
        </h1>
        <div className="flex items-center gap-2">
          <button className="btn-secondary text-sm flex items-center gap-1">
            <Layers className="w-4 h-4" /> Layers
          </button>
          <button className="btn-secondary text-sm flex items-center gap-1">
            <Navigation className="w-4 h-4" /> Center
          </button>
        </div>
      </div>

      <div className="glass-panel overflow-hidden" style={{ height: 'calc(100vh - 180px)' }}>
        <div className="w-full h-full flex items-center justify-center bg-gray-900/50">
          <div className="text-center space-y-3">
            <Map className="w-16 h-16 text-gray-700 mx-auto" />
            <p className="text-gray-500 text-sm">MapLibre GL integration</p>
            <p className="text-gray-600 text-xs max-w-md">
              Displays sensors, detections, tracks, alerts, and drone positions on an interactive tactical map
              with real-time WebSocket updates, heatmaps, and geofence overlays.
            </p>
            <p className="text-gray-700 text-xs font-mono">
              Requires: npm install &amp;&amp; MAPLIBRE_STYLE_URL env var
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

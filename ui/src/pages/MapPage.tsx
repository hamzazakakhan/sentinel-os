import { useEffect, useRef, useState, useCallback } from 'react';
import { useQuery } from '@apollo/client';
import { Map as MapIcon, Layers, Navigation, Crosshair, AlertTriangle, Radio, Shield } from 'lucide-react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { GET_SENSORS, GET_ALERTS } from '../graphql/queries';

const DOMAIN_COLORS: Record<string, string> = {
  LAND: '#22c55e',
  AIR: '#3b82f6',
  SEA: '#06b6d4',
  CYBER: '#a855f7',
  SPACE: '#f59e0b',
  INTELLIGENCE: '#ef4444',
  OSINT: '#ec4899',
};

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: '#ef4444',
  HIGH: '#f97316',
  MEDIUM: '#eab308',
  LOW: '#22c55e',
  INFORMATIONAL: '#6b7280',
};

const DARK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  name: 'Sentinel Dark',
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'osm-tiles',
      type: 'raster',
      source: 'osm',
      paint: {
        'raster-saturation': -0.8,
        'raster-brightness-max': 0.4,
        'raster-contrast': 0.3,
      },
    },
  ],
};

interface SensorMarker {
  id: string;
  name: string;
  type: string;
  status: string;
  domain: string;
  lat: number;
  lng: number;
}

interface AlertMarker {
  id: string;
  title: string;
  severity: string;
  domain: string;
  lat: number;
  lng: number;
}

export function MapPage() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [activeLayers, setActiveLayers] = useState({ sensors: true, alerts: true, heatmap: false });

  const { data: sensorsData } = useQuery(GET_SENSORS, { pollInterval: 15000, errorPolicy: 'all' });
  const { data: alertsData } = useQuery(GET_ALERTS, { variables: { pagination: { first: 50 } }, pollInterval: 10000, errorPolicy: 'all' });

  const [locationError, setLocationError] = useState<string | null>(null);

  const applyLocation = useCallback((loc: [number, number], label: string) => {
    setUserLocation(loc);
    setLocationError(null);
    if (mapRef.current) {
      mapRef.current.flyTo({ center: loc, zoom: 13, duration: 2000 });
      new maplibregl.Marker({ color: '#00ff88' })
        .setLngLat(loc)
        .setPopup(new maplibregl.Popup().setHTML(`<div style="color:#000;font-weight:bold;">${label}</div>`))
        .addTo(mapRef.current);
    }
  }, []);

  const fallbackIPLocation = useCallback(async () => {
    try {
      const resp = await fetch('https://ipapi.co/json/');
      if (resp.ok) {
        const data = await resp.json();
        if (data.latitude && data.longitude) {
          applyLocation([data.longitude, data.latitude], `Your Location (IP: ${data.city || 'approx'})`);
          return;
        }
      }
    } catch { /* ignore */ }
    setLocationError('Could not determine location. Click "My Location" to retry.');
  }, [applyLocation]);

  const getUserLocation = useCallback(async () => {
    setLocationError('Locating via IP...');
    await fallbackIPLocation();
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => applyLocation([pos.coords.longitude, pos.coords.latitude], 'Your Location (GPS)'),
        () => {},
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 }
      );
    }
  }, [applyLocation, fallbackIPLocation]);

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: DARK_STYLE,
      center: [0, 20],
      zoom: 2,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl(), 'bottom-left');

    map.on('load', () => {
      setMapReady(true);
      getUserLocation();
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [getUserLocation]);

  useEffect(() => {
    if (!mapRef.current || !mapReady) return;
    const map = mapRef.current;

    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    const sensorEdges = sensorsData?.sensors?.edges || [];
    const sensors: SensorMarker[] = sensorEdges
      .map((e: any) => e.node)
      .filter((s: any) => s.latitude && s.longitude)
      .map((s: any) => ({
        id: s.id,
        name: s.name,
        type: s.sensorType,
        status: s.status,
        domain: s.domain,
        lat: s.latitude,
        lng: s.longitude,
      }));

    if (activeLayers.sensors) {
      sensors.forEach((s) => {
        const color = DOMAIN_COLORS[s.domain] || '#6b7280';
        const el = document.createElement('div');
        el.className = 'sensor-marker';
        el.style.cssText = `width:14px;height:14px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,0.6);cursor:pointer;box-shadow:0 0 8px ${color}80;`;
        if (s.status === 'ONLINE') {
          el.style.animation = 'pulse 2s infinite';
        }
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([s.lng, s.lat])
          .setPopup(
            new maplibregl.Popup({ offset: 10 }).setHTML(
              `<div style="color:#000;font-size:12px;">
                <strong>${s.name}</strong><br/>
                Type: ${s.type}<br/>
                Status: <span style="color:${s.status === 'ONLINE' ? 'green' : 'red'}">${s.status}</span><br/>
                Domain: ${s.domain}
              </div>`
            )
          )
          .addTo(map);
        markersRef.current.push(marker);
      });
    }

    if (activeLayers.alerts) {
      const alertEdges = alertsData?.alerts?.edges || [];
      let alertIdx = 0;
      alertEdges.forEach((e: any) => {
        const a = e.node;
        const baseLat = userLocation ? userLocation[1] : 33.0;
        const baseLng = userLocation ? userLocation[0] : -117.0;
        const lat = baseLat + (Math.random() - 0.5) * 0.2;
        const lng = baseLng + (Math.random() - 0.5) * 0.2;

        const color = SEVERITY_COLORS[a.severity] || '#6b7280';
        const el = document.createElement('div');
        el.style.cssText = `width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-bottom:16px solid ${color};cursor:pointer;filter:drop-shadow(0 0 4px ${color});`;

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([lng, lat])
          .setPopup(
            new maplibregl.Popup({ offset: 10 }).setHTML(
              `<div style="color:#000;font-size:12px;">
                <strong style="color:${color}">[${a.severity}]</strong> ${a.title}<br/>
                Domain: ${a.domain}<br/>
                Status: ${a.status}
              </div>`
            )
          )
          .addTo(map);
        markersRef.current.push(marker);
        alertIdx++;
      });
    }
  }, [sensorsData, alertsData, mapReady, activeLayers, userLocation]);

  const toggleLayer = (layer: keyof typeof activeLayers) => {
    setActiveLayers(prev => ({ ...prev, [layer]: !prev[layer] }));
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <MapIcon className="w-6 h-6 text-sentinel-400" />
          Tactical Map
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => toggleLayer('sensors')}
            className={`text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors ${activeLayers.sensors ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40' : 'bg-gray-800 text-gray-500 border border-gray-700'}`}
          >
            <Radio className="w-3.5 h-3.5" /> Sensors
          </button>
          <button
            onClick={() => toggleLayer('alerts')}
            className={`text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors ${activeLayers.alerts ? 'bg-red-500/20 text-red-400 border border-red-500/40' : 'bg-gray-800 text-gray-500 border border-gray-700'}`}
          >
            <AlertTriangle className="w-3.5 h-3.5" /> Alerts
          </button>
          <button
            onClick={getUserLocation}
            className="text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 bg-green-500/20 text-green-400 border border-green-500/40 hover:bg-green-500/30 transition-colors"
          >
            <Crosshair className="w-3.5 h-3.5" /> My Location
          </button>
        </div>
      </div>

      <div className="glass-panel overflow-hidden relative" style={{ height: 'calc(100vh - 160px)' }}>
        <div ref={mapContainer} className="w-full h-full" />

        {/* Legend */}
        <div className="absolute bottom-4 left-4 bg-gray-900/90 backdrop-blur-sm border border-gray-700 rounded-lg p-3 text-xs space-y-1.5">
          <div className="text-gray-400 font-semibold mb-1">Domains</div>
          {Object.entries(DOMAIN_COLORS).map(([domain, color]) => (
            <div key={domain} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-gray-300">{domain}</span>
            </div>
          ))}
        </div>

        {/* Stats overlay */}
        <div className="absolute top-4 right-4 bg-gray-900/90 backdrop-blur-sm border border-gray-700 rounded-lg p-3 text-xs space-y-1">
          <div className="text-gray-400 font-semibold">Live Status</div>
          <div className="text-green-400">
            Sensors: {sensorsData?.sensors?.edges?.length || 0}
          </div>
          <div className="text-red-400">
            Alerts: {alertsData?.alerts?.edges?.length || 0}
          </div>
          {userLocation && (
            <div className="text-blue-400">
              Loc: {userLocation[1].toFixed(4)}, {userLocation[0].toFixed(4)}
            </div>
          )}
          {locationError && (
            <div className="text-yellow-400 max-w-[180px]">{locationError}</div>
          )}
        </div>
      </div>
    </div>
  );
}

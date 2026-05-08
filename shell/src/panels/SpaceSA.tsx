// Space Situational Awareness — live satellite tracker via space-awareness-service
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const SSA_WS = (typeof window !== 'undefined' && (window as any).SENTINEL_SSA_WS)
  || 'ws://localhost:8093/space/stream';
const SSA_API = (typeof window !== 'undefined' && (window as any).SENTINEL_SSA_API)
  || 'http://localhost:8093';

interface SatPosition {
  noradId: string; name: string; group: string;
  lat: number; lon: number; alt_km: number;
  velocity_kms: number; epoch: string;
}

const GROUP_COLOR: Record<string, string> = {
  stations: '#4cc4ff', starlink: '#7dd87f', 'gps-ops': '#ffd23f',
  'glonass-ops': '#ff8c33', galileo: '#ce93d8', beidou: '#f06292',
  military: '#ff3344', intelsat: '#90caf9', weather: '#80deea',
  science: '#aed581',
};

export function SpaceSA() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObj = useRef<maplibregl.Map | null>(null);
  const [positions, setPositions] = useState<SatPosition[]>([]);
  const [groupFilter, setGroupFilter] = useState<string>('');
  const [connected, setConnected] = useState(false);
  const [conjunctions, setConjunctions] = useState<any[]>([]);
  const [showConjunctions, setShowConjunctions] = useState(false);

  useEffect(() => {
    if (!mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapRef.current,
      style: {
        version: 8,
        sources: { osm: { type: 'raster', tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'], tileSize: 256 } },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' as any }],
      } as any,
      center: [0, 0], zoom: 1.5, attributionControl: false,
    });
    mapObj.current = map;

    map.on('load', () => {
      map.addSource('sats', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } as any });
      map.addLayer({
        id: 'sats-layer', type: 'circle', source: 'sats',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'alt_km'], 200, 2, 36000, 5],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.85,
          'circle-stroke-width': 0.5, 'circle-stroke-color': '#0a0a14',
        },
      });
    });
    return () => { map.remove(); };
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null; let retry = 0;
    const connect = () => {
      try {
        ws = new WebSocket(SSA_WS);
        ws.onopen = () => { setConnected(true); retry = 0; };
        ws.onclose = () => { setConnected(false); retry++; setTimeout(connect, Math.min(15000, 1000 * retry)); };
        ws.onerror = () => ws?.close();
        ws.onmessage = (e) => {
          try {
            const m = JSON.parse(e.data);
            if (m.type === 'snapshot' || m.type === 'positions') {
              setPositions(m.objects ?? []);
            }
          } catch {}
        };
      } catch { setTimeout(connect, 5000); }
    };
    connect();
    return () => { try { ws?.close(); } catch {} };
  }, []);

  useEffect(() => {
    const map = mapObj.current; if (!map || !map.getSource('sats')) return;
    const filtered = groupFilter ? positions.filter((p) => p.group === groupFilter) : positions;
    const features = filtered.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: {
        noradId: p.noradId, name: p.name, group: p.group, alt_km: p.alt_km,
        color: GROUP_COLOR[p.group] ?? '#888',
      },
    }));
    (map.getSource('sats') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features } as any);
  }, [positions, groupFilter]);

  const refresh = () => fetch(`${SSA_API}/refresh`, { method: 'POST' });

  const findConjunctions = async () => {
    setShowConjunctions(true);
    try {
      const r = await fetch(`${SSA_API}/conjunctions`); const d = await r.json();
      setConjunctions(d.conjunctions ?? []);
    } catch {}
  };

  const groups = Array.from(new Set(positions.map((p) => p.group))).sort();
  const groupCounts = groups.reduce((acc, g) => {
    acc[g] = positions.filter((p) => p.group === g).length; return acc;
  }, {} as Record<string, number>);

  return (
    <div className="flex flex-col h-full bg-sentinel-void text-sentinel-text font-mono text-[11px]">
      <div className="px-2 py-1 border-b border-sentinel-rust/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sentinel-amber font-bold">SPACE SITUATIONAL AWARENESS</span>
          <span className={connected ? 'text-sentinel-lime' : 'text-sentinel-blood'}>{connected ? '● LIVE' : '○ OFFLINE'}</span>
          <span className="text-sentinel-muted">{positions.length} objects</span>
        </div>
        <div className="flex items-center gap-2">
          <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} className="bg-sentinel-void border border-sentinel-rust/30 px-1 py-0.5">
            <option value="">ALL GROUPS</option>
            {groups.map((g) => <option key={g} value={g}>{g} ({groupCounts[g]})</option>)}
          </select>
          <button onClick={findConjunctions} className="px-2 py-0.5 bg-sentinel-rust/20 text-sentinel-amber">⚠ CONJUNCTIONS</button>
          <button onClick={refresh} className="px-2 py-0.5 bg-sentinel-rust/20 text-sentinel-amber">↻ TLE</button>
        </div>
      </div>
      <div className="flex-1 flex min-h-0">
        <div ref={mapRef} className="flex-1" />
        {showConjunctions && (
          <div className="w-80 border-l border-sentinel-rust/30 overflow-auto p-2">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sentinel-amber font-bold">CONJUNCTION WARNINGS</div>
              <button onClick={() => setShowConjunctions(false)} className="text-sentinel-muted">×</button>
            </div>
            {conjunctions.length === 0 && <div className="text-sentinel-muted text-[10px]">No conjunctions within threshold.</div>}
            {conjunctions.map((c, i) => (
              <div key={i} className="border-b border-sentinel-rust/20 py-1 text-[10px]">
                <div className="font-bold text-sentinel-blood">{c.dist_km.toFixed(2)} km</div>
                <div>{c.a.name} ({c.a.noradId})</div>
                <div>↔ {c.b.name} ({c.b.noradId})</div>
                <div className="text-sentinel-muted">alt {c.a.alt_km.toFixed(0)} ↔ {c.b.alt_km.toFixed(0)} km</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="px-2 py-1 border-t border-sentinel-rust/30 flex flex-wrap gap-2 text-[9px]">
        {Object.entries(GROUP_COLOR).filter(([g]) => groupCounts[g]).map(([g, c]) => (
          <span key={g} className="flex items-center gap-1"><span style={{ color: c }}>●</span>{g} {groupCounts[g]}</span>
        ))}
      </div>
    </div>
  );
}

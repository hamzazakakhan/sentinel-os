// Mission Planner — submit mission, render COA routes on map
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const MP_API = (typeof window !== 'undefined' && (window as any).SENTINEL_MP_API)
  || 'http://localhost:8092';

interface COA {
  id: string; mission_id: string; name: string;
  route: { type: 'LineString'; coordinates: [number, number][] };
  distance_km: number; eta_min: number;
  risk_score: number; risk_factors: string[];
  intersected_threats: string[]; narrative: string;
  recommendation: 'PRIMARY'|'ALTERNATE'|'CONTINGENCY';
}

const COA_COLOR = ['#4cc4ff', '#ffd23f', '#ff8c33'];

export function MissionPlanner() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObj = useRef<maplibregl.Map | null>(null);
  const [objective, setObjective] = useState('Tactical recon mission');
  const [start, setStart] = useState({ lat: '34.0', lon: '69.2' });
  const [end, setEnd] = useState({ lat: '34.5', lon: '70.0' });
  const [assetType, setAssetType] = useState<'foot'|'vehicle'|'air'|'sea'>('vehicle');
  const [speed, setSpeed] = useState('60');
  const [coas, setCoas] = useState<COA[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<COA | null>(null);

  useEffect(() => {
    if (!mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapRef.current,
      style: {
        version: 8,
        sources: { osm: { type: 'raster', tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'], tileSize: 256 } },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' as any }],
      } as any,
      center: [69.5, 34.2], zoom: 8, attributionControl: false,
    });
    mapObj.current = map;
    return () => { map.remove(); };
  }, []);

  // Render COA routes
  useEffect(() => {
    const map = mapObj.current; if (!map || !map.isStyleLoaded()) {
      const t = setTimeout(() => setCoas([...coas]), 300); return () => clearTimeout(t);
    }
    // remove existing layers
    for (let i = 0; i < 5; i++) {
      const id = `coa-${i}`;
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
    }
    coas.forEach((coa, idx) => {
      const id = `coa-${idx}`;
      map.addSource(id, { type: 'geojson', data: { type: 'Feature', properties: { name: coa.name }, geometry: coa.route } as any });
      map.addLayer({
        id, type: 'line', source: id,
        paint: {
          'line-color': COA_COLOR[idx % COA_COLOR.length],
          'line-width': selected?.id === coa.id ? 4 : 2,
          'line-opacity': selected?.id === coa.id ? 1 : 0.7,
          'line-dasharray': coa.recommendation === 'CONTINGENCY' ? [2, 2] : [1, 0],
        },
      });
    });
    if (coas[0]) {
      const all = coas.flatMap((c) => c.route.coordinates);
      const lons = all.map((c) => c[0]); const lats = all.map((c) => c[1]);
      map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 40 });
    }
  }, [coas, selected]);

  const plan = async () => {
    setLoading(true); setError(null); setCoas([]); setSelected(null);
    try {
      const r = await fetch(`${MP_API}/missions/plan`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objective,
          start: { lat: parseFloat(start.lat), lon: parseFloat(start.lon) },
          end: { lat: parseFloat(end.lat), lon: parseFloat(end.lon) },
          asset_type: assetType, asset_speed_kmh: parseFloat(speed),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? 'planning failed');
      setCoas(d.coas ?? []);
      if (d.coas?.[0]) setSelected(d.coas[0]);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="flex h-full bg-sentinel-void text-sentinel-text font-mono text-[11px]">
      <div className="w-72 border-r border-sentinel-rust/30 p-2 overflow-auto">
        <div className="text-sentinel-amber font-bold mb-2">MISSION PLANNER</div>
        <label className="block text-sentinel-muted mb-1">Objective</label>
        <input value={objective} onChange={(e) => setObjective(e.target.value)} className="w-full bg-sentinel-void border border-sentinel-rust/30 px-1 py-0.5 mb-2" />
        <div className="grid grid-cols-2 gap-1 mb-2">
          <div>
            <label className="block text-sentinel-muted">Start lat</label>
            <input value={start.lat} onChange={(e) => setStart({ ...start, lat: e.target.value })} className="w-full bg-sentinel-void border border-sentinel-rust/30 px-1 py-0.5" />
          </div>
          <div>
            <label className="block text-sentinel-muted">Start lon</label>
            <input value={start.lon} onChange={(e) => setStart({ ...start, lon: e.target.value })} className="w-full bg-sentinel-void border border-sentinel-rust/30 px-1 py-0.5" />
          </div>
          <div>
            <label className="block text-sentinel-muted">End lat</label>
            <input value={end.lat} onChange={(e) => setEnd({ ...end, lat: e.target.value })} className="w-full bg-sentinel-void border border-sentinel-rust/30 px-1 py-0.5" />
          </div>
          <div>
            <label className="block text-sentinel-muted">End lon</label>
            <input value={end.lon} onChange={(e) => setEnd({ ...end, lon: e.target.value })} className="w-full bg-sentinel-void border border-sentinel-rust/30 px-1 py-0.5" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1 mb-2">
          <div>
            <label className="block text-sentinel-muted">Asset</label>
            <select value={assetType} onChange={(e) => setAssetType(e.target.value as any)} className="w-full bg-sentinel-void border border-sentinel-rust/30 px-1 py-0.5">
              <option value="foot">Foot</option><option value="vehicle">Vehicle</option>
              <option value="air">Air</option><option value="sea">Sea</option>
            </select>
          </div>
          <div>
            <label className="block text-sentinel-muted">Speed km/h</label>
            <input value={speed} onChange={(e) => setSpeed(e.target.value)} className="w-full bg-sentinel-void border border-sentinel-rust/30 px-1 py-0.5" />
          </div>
        </div>
        <button onClick={plan} disabled={loading} className="w-full bg-sentinel-rust/40 text-sentinel-amber py-1 mb-2">{loading ? 'PLANNING…' : 'GENERATE COAs'}</button>
        {error && <div className="text-sentinel-blood text-[10px] mb-2">{error}</div>}
        <div className="border-t border-sentinel-rust/30 pt-2 space-y-2">
          {coas.map((c, i) => (
            <button key={c.id} onClick={() => setSelected(c)}
              className={`block w-full text-left p-2 border ${selected?.id === c.id ? 'border-sentinel-amber bg-sentinel-rust/30' : 'border-sentinel-rust/30'}`}>
              <div className="flex items-center justify-between">
                <span style={{ color: COA_COLOR[i % COA_COLOR.length] }} className="font-bold">{c.name}</span>
                <span className="text-[9px] text-sentinel-muted">{c.recommendation}</span>
              </div>
              <div className="text-[10px] text-sentinel-muted">
                {c.distance_km.toFixed(1)} km · ETA {c.eta_min.toFixed(0)} min · risk <span style={{ color: c.risk_score > 60 ? '#ff3344' : c.risk_score > 30 ? '#ffd23f' : '#7dd87f' }}>{c.risk_score}</span>
              </div>
            </button>
          ))}
        </div>
        {selected && (
          <div className="mt-3 border-t border-sentinel-rust/30 pt-2">
            <div className="text-sentinel-amber font-bold mb-1">{selected.name}</div>
            <div className="text-[10px] whitespace-pre-wrap mb-2">{selected.narrative}</div>
            {selected.risk_factors.length > 0 && (
              <div>
                <div className="text-sentinel-muted text-[10px]">Risk factors:</div>
                <ul className="text-[10px] list-disc pl-4">
                  {selected.risk_factors.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
      <div ref={mapRef} className="flex-1 min-h-0" />
    </div>
  );
}

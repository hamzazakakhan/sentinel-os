// Blue Force Tracker — live TAK/CoT feed with MIL-STD-2525 symbology
// Connects to tak-service WebSocket (/tak/stream), renders all friendly,
// hostile, neutral, and unknown tracks with NATO joint symbology.
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

interface Track {
  uid: string; type: string; callsign?: string;
  affiliation: 'friendly'|'hostile'|'neutral'|'unknown';
  dimension: 'air'|'ground'|'sea-surface'|'sea-subsurface'|'space'|'unknown';
  point: { lat: number; lon: number; hae: number };
  time: string; stale: string;
}

const TAK_WS = (typeof window !== 'undefined' && (window as any).SENTINEL_TAK_WS)
  || 'ws://localhost:8090/tak/stream';

const AFFIL_COLOR: Record<Track['affiliation'], string> = {
  friendly: '#4cc4ff',   // NATO blue (cyan)
  hostile:  '#ff3344',   // NATO red
  neutral:  '#33dd33',   // NATO green
  unknown:  '#f5d76e',   // NATO yellow
};

const DIM_GLYPH: Record<Track['dimension'], string> = {
  air: '◇', ground: '□', 'sea-surface': '◯', 'sea-subsurface': '▽',
  space: '◯', unknown: '◇',
};

// MIL-STD-2525 frame: friendly=rectangle, hostile=diamond, neutral=square, unknown=cloverleaf
function symbolPath(affil: Track['affiliation'], dim: Track['dimension']): string {
  // Air: top half of frame; Ground: full frame; Subsurface: bottom half
  const w = 24, h = 24;
  if (affil === 'hostile') {
    // Diamond
    return `M ${w/2} 2 L ${w-2} ${h/2} L ${w/2} ${h-2} L 2 ${h/2} Z`;
  }
  if (affil === 'neutral') {
    // Square
    return `M 3 3 L ${w-3} 3 L ${w-3} ${h-3} L 3 ${h-3} Z`;
  }
  if (affil === 'friendly') {
    // Rectangle (taller)
    if (dim === 'air') return `M 3 ${h/2} L ${w-3} ${h/2} L ${w-3} ${h-3} A 6 6 0 0 1 3 ${h-3} Z`;
    return `M 3 4 L ${w-3} 4 L ${w-3} ${h-4} L 3 ${h-4} Z`;
  }
  // Unknown — cloverleaf-ish (rounded)
  return `M ${w/2} 2 Q ${w-2} 2 ${w-2} ${h/2} Q ${w-2} ${h-2} ${w/2} ${h-2} Q 2 ${h-2} 2 ${h/2} Q 2 2 ${w/2} 2 Z`;
}

function makeIconCanvas(affil: Track['affiliation'], dim: Track['dimension']): string {
  const color = AFFIL_COLOR[affil];
  const path = symbolPath(affil, dim);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
    <path d="${path}" fill="${color}22" stroke="${color}" stroke-width="2"/>
    <text x="12" y="16" text-anchor="middle" fill="${color}" font-family="monospace" font-size="11" font-weight="bold">${DIM_GLYPH[dim]}</text>
  </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

export function BlueForceTracker() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObj = useRef<maplibregl.Map | null>(null);
  const markers = useRef<Map<string, maplibregl.Marker>>(new Map());
  const [tracks, setTracks] = useState<Track[]>([]);
  const [connected, setConnected] = useState(false);
  const [counts, setCounts] = useState({ friendly: 0, hostile: 0, neutral: 0, unknown: 0 });

  useEffect(() => {
    if (!mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapRef.current,
      style: {
        version: 8,
        sources: { osm: { type: 'raster', tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'], tileSize: 256 } },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' as any }],
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      } as any,
      center: [0, 20], zoom: 2, attributionControl: false,
    });
    mapObj.current = map;
    return () => { map.remove(); };
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry = 0;
    const connect = () => {
      try {
        ws = new WebSocket(TAK_WS);
        ws.onopen = () => { setConnected(true); retry = 0; };
        ws.onclose = () => { setConnected(false); retry++; setTimeout(connect, Math.min(15000, 1000 * retry)); };
        ws.onerror = () => ws?.close();
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'snapshot' && Array.isArray(msg.tracks)) setTracks(msg.tracks);
            else if (msg.type === 'cot' && msg.event) {
              setTracks((prev) => {
                const next = prev.filter((t) => t.uid !== msg.event.uid);
                next.push(msg.event); return next;
              });
            }
          } catch {}
        };
      } catch { setTimeout(connect, 5000); }
    };
    connect();
    return () => { try { ws?.close(); } catch {} };
  }, []);

  // Update markers and counts
  useEffect(() => {
    const map = mapObj.current; if (!map) return;
    const seen = new Set<string>();
    const c = { friendly: 0, hostile: 0, neutral: 0, unknown: 0 };
    for (const t of tracks) {
      seen.add(t.uid);
      c[t.affiliation]++;
      const existing = markers.current.get(t.uid);
      if (existing) {
        existing.setLngLat([t.point.lon, t.point.lat]);
      } else {
        const el = document.createElement('div');
        el.style.cssText = 'width:24px;height:24px;cursor:pointer;';
        el.innerHTML = `<img src="${makeIconCanvas(t.affiliation, t.dimension)}" width="24" height="24" />`;
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([t.point.lon, t.point.lat])
          .setPopup(new maplibregl.Popup({ closeButton: false, offset: 12 }).setHTML(
            `<div style="font-family:monospace;font-size:11px;color:#0a0a14">
              <b>${t.callsign ?? t.uid}</b><br/>
              ${t.affiliation.toUpperCase()} / ${t.dimension}<br/>
              ${t.point.lat.toFixed(4)}, ${t.point.lon.toFixed(4)}<br/>
              alt ${t.point.hae?.toFixed(0) ?? '?'} m<br/>
              <span style="color:#666">stale ${new Date(t.stale).toISOString().slice(11,19)}Z</span>
            </div>`))
          .addTo(map);
        markers.current.set(t.uid, marker);
      }
    }
    // Remove stale markers
    for (const [uid, m] of markers.current) {
      if (!seen.has(uid)) { m.remove(); markers.current.delete(uid); }
    }
    setCounts(c);
  }, [tracks]);

  return (
    <div className="flex flex-col h-full bg-sentinel-void">
      <div className="px-2 py-1 border-b border-sentinel-rust/30 flex items-center justify-between text-[11px] font-mono">
        <div className="flex items-center gap-3">
          <span className="text-sentinel-amber font-bold">BLUE FORCE TRACKER</span>
          <span className={connected ? 'text-sentinel-lime' : 'text-sentinel-blood'}>
            {connected ? '● TAK ONLINE' : '○ TAK OFFLINE'}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[10px]">
          <span style={{ color: AFFIL_COLOR.friendly }}>FRIENDLY {counts.friendly}</span>
          <span style={{ color: AFFIL_COLOR.hostile }}>HOSTILE {counts.hostile}</span>
          <span style={{ color: AFFIL_COLOR.neutral }}>NEUTRAL {counts.neutral}</span>
          <span style={{ color: AFFIL_COLOR.unknown }}>UNKNOWN {counts.unknown}</span>
          <span className="text-sentinel-muted">TOTAL {tracks.length}</span>
        </div>
      </div>
      <div ref={mapRef} className="flex-1 min-h-0" />
    </div>
  );
}

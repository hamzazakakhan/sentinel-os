// Counter-UAS panel — live drone detections from RF anomaly detection
import { useEffect, useState } from 'react';

const CUAS_WS = (typeof window !== 'undefined' && (window as any).SENTINEL_CUAS_WS)
  || 'ws://localhost:8094/cuas/stream';
const CUAS_API = (typeof window !== 'undefined' && (window as any).SENTINEL_CUAS_API)
  || 'http://localhost:8094';

interface Detection {
  id: string; ts: string; signature_id: string;
  signature: { vendor: string; model: string; protocol: string; threat_level: string; bands_mhz: any[]; channel_bw_khz: number; hop_pattern: string; notes?: string };
  confidence: number;
  spectrum: { center_mhz: number; bandwidth_khz: number; power_dbm: number; pattern?: string };
  observer?: { lat: number; lon: number };
}

const THREAT_COLOR: Record<string, string> = { high: '#ff3344', medium: '#ffd23f', low: '#7dd87f' };

export function CounterUAS() {
  const [detections, setDetections] = useState<Detection[]>([]);
  const [signatures, setSignatures] = useState<any[]>([]);
  const [connected, setConnected] = useState(false);
  const [tab, setTab] = useState<'live'|'sigs'>('live');

  useEffect(() => {
    fetch(`${CUAS_API}/signatures`).then((r) => r.json()).then((d) => setSignatures(d.signatures ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null; let retry = 0;
    const connect = () => {
      try {
        ws = new WebSocket(CUAS_WS);
        ws.onopen = () => { setConnected(true); retry = 0; };
        ws.onclose = () => { setConnected(false); retry++; setTimeout(connect, Math.min(15000, 1000 * retry)); };
        ws.onerror = () => ws?.close();
        ws.onmessage = (e) => {
          try {
            const m = JSON.parse(e.data);
            if (m.type === 'snapshot') setDetections(m.detections ?? []);
            else if (m.type === 'detection') setDetections((prev) => [m.detection, ...prev].slice(0, 200));
          } catch {}
        };
      } catch { setTimeout(connect, 5000); }
    };
    connect();
    return () => { try { ws?.close(); } catch {} };
  }, []);

  const recentByThreat = detections.reduce((acc, d) => {
    acc[d.signature.threat_level] = (acc[d.signature.threat_level] ?? 0) + 1; return acc;
  }, {} as Record<string, number>);

  return (
    <div className="flex flex-col h-full bg-sentinel-void text-sentinel-text font-mono text-[11px]">
      <div className="px-2 py-1 border-b border-sentinel-rust/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sentinel-amber font-bold">COUNTER-UAS</span>
          <span className={connected ? 'text-sentinel-lime' : 'text-sentinel-blood'}>{connected ? '● ONLINE' : '○ OFFLINE'}</span>
          <button className={`px-2 py-0.5 ${tab==='live' ? 'bg-sentinel-rust/40 text-sentinel-amber' : 'text-sentinel-muted'}`} onClick={() => setTab('live')}>LIVE</button>
          <button className={`px-2 py-0.5 ${tab==='sigs' ? 'bg-sentinel-rust/40 text-sentinel-amber' : 'text-sentinel-muted'}`} onClick={() => setTab('sigs')}>SIGNATURES</button>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <span style={{ color: THREAT_COLOR.high }}>HIGH {recentByThreat.high ?? 0}</span>
          <span style={{ color: THREAT_COLOR.medium }}>MED {recentByThreat.medium ?? 0}</span>
          <span style={{ color: THREAT_COLOR.low }}>LOW {recentByThreat.low ?? 0}</span>
        </div>
      </div>

      {tab === 'live' && (
        <div className="flex-1 overflow-auto">
          {detections.length === 0 && <div className="p-4 text-sentinel-muted text-center">No drone detections — listening on sigint.spectrum…</div>}
          <table className="w-full text-[10px]">
            <thead className="sticky top-0 bg-sentinel-void">
              <tr className="text-sentinel-muted border-b border-sentinel-rust/30">
                <th className="text-left px-2 py-1">TIME</th>
                <th className="text-left px-1 py-1">THREAT</th>
                <th className="text-left px-1 py-1">VENDOR/MODEL</th>
                <th className="text-left px-1 py-1">PROTOCOL</th>
                <th className="text-right px-1 py-1">CENTER MHz</th>
                <th className="text-right px-1 py-1">BW kHz</th>
                <th className="text-right px-1 py-1">POWER</th>
                <th className="text-right px-1 py-1">CONF</th>
              </tr>
            </thead>
            <tbody>
              {detections.map((d) => (
                <tr key={d.id} className="border-b border-sentinel-rust/10 hover:bg-sentinel-rust/10">
                  <td className="px-2 py-1 text-sentinel-muted">{new Date(d.ts).toISOString().slice(11,19)}Z</td>
                  <td className="px-1 py-1"><span style={{ color: THREAT_COLOR[d.signature.threat_level] }}>● {d.signature.threat_level.toUpperCase()}</span></td>
                  <td className="px-1 py-1 text-sentinel-amber">{d.signature.vendor} {d.signature.model}</td>
                  <td className="px-1 py-1">{d.signature.protocol}</td>
                  <td className="px-1 py-1 text-right">{d.spectrum.center_mhz.toFixed(1)}</td>
                  <td className="px-1 py-1 text-right">{d.spectrum.bandwidth_khz.toFixed(0)}</td>
                  <td className="px-1 py-1 text-right">{d.spectrum.power_dbm.toFixed(0)} dBm</td>
                  <td className="px-1 py-1 text-right" style={{ color: d.confidence > 75 ? '#7dd87f' : d.confidence > 50 ? '#ffd23f' : '#ff8c33' }}>{d.confidence}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'sigs' && (
        <div className="flex-1 overflow-auto p-2">
          <div className="text-sentinel-muted text-[10px] mb-2">{signatures.length} signatures loaded — covering DJI, FrSky, TBS, ELRS, Wi-Fi/analog FPV, Shahed-136</div>
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-sentinel-muted border-b border-sentinel-rust/30">
                <th className="text-left px-2 py-1">VENDOR</th>
                <th className="text-left px-1 py-1">MODEL</th>
                <th className="text-left px-1 py-1">PROTOCOL</th>
                <th className="text-left px-1 py-1">BANDS (MHz)</th>
                <th className="text-right px-1 py-1">BW kHz</th>
                <th className="text-left px-1 py-1">PATTERN</th>
                <th className="text-left px-1 py-1">THREAT</th>
              </tr>
            </thead>
            <tbody>
              {signatures.map((s) => (
                <tr key={s.id} className="border-b border-sentinel-rust/10">
                  <td className="px-2 py-1 text-sentinel-amber">{s.vendor}</td>
                  <td className="px-1 py-1">{s.model}</td>
                  <td className="px-1 py-1">{s.protocol}</td>
                  <td className="px-1 py-1 text-sentinel-muted">{s.bands_mhz.map((b: any) => `${b.low}-${b.high}`).join(', ')}</td>
                  <td className="px-1 py-1 text-right">{s.channel_bw_khz}</td>
                  <td className="px-1 py-1">{s.hop_pattern.toUpperCase()}</td>
                  <td className="px-1 py-1"><span style={{ color: THREAT_COLOR[s.threat_level] }}>● {s.threat_level.toUpperCase()}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

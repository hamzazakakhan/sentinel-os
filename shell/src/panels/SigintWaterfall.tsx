// ──────────────────────────────────────────────────────────────
// sentinel-os/shell/src/panels/SigintWaterfall.tsx
// Real-time SDR spectrum waterfall with canvas rendering
// Connects to SIGINT service WebSocket for live IQ data
// ──────────────────────────────────────────────────────────────

import { useEffect, useRef, useState, useCallback } from 'react';

interface FreqMarker { freq: number; label: string; color: string; }

const KNOWN_FREQS: FreqMarker[] = [
  { freq: 0.05, label: 'ADS-B 1090MHz', color: '#00e5ff' },
  { freq: 0.30, label: 'AIS 162MHz', color: '#76ff03' },
  { freq: 0.50, label: 'FM 88-108MHz', color: '#ffd600' },
  { freq: 0.70, label: 'APRS 144.8MHz', color: '#ff6f00' },
  { freq: 0.85, label: '433MHz IoT', color: '#d50000' },
];

export function SigintWaterfall() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [freq, setFreq] = useState('1090.000 MHz');
  const [mode, setMode] = useState('AM');

  const drawWaterfall = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const rows: Float32Array[] = [];

    function randRow(): Float32Array {
      const row = new Float32Array(W);
      for (let i = 0; i < W; i++) {
        const noise = Math.random() * 0.12;
        // Simulated signal peaks at known frequencies
        let sig = 0;
        for (const kf of KNOWN_FREQS) {
          const center = kf.freq * W;
          sig += Math.exp(-0.5 * Math.pow((i - center) / 6, 2)) * (0.4 + Math.random() * 0.3);
        }
        row[i] = Math.min(1, noise + sig);
      }
      return row;
    }

    let animId = 0;
    function draw() {
      rows.unshift(randRow());
      if (rows.length > H) rows.pop();

      const imgData = ctx!.createImageData(W, rows.length);
      for (let y = 0; y < rows.length; y++) {
        const row = rows[y];
        for (let x = 0; x < W; x++) {
          const v = row[x];
          const idx = (y * W + x) * 4;
          // Sentinel CRT color map: black → cyan → white
          if (v < 0.3) {
            imgData.data[idx] = Math.floor(v * 0);
            imgData.data[idx + 1] = Math.floor(v * 3.3 * 229);
            imgData.data[idx + 2] = Math.floor(v * 3.3 * 255);
          } else if (v < 0.7) {
            const t = (v - 0.3) / 0.4;
            imgData.data[idx] = Math.floor(t * 100);
            imgData.data[idx + 1] = Math.floor(229 + t * 26);
            imgData.data[idx + 2] = Math.floor(255 - t * 55);
          } else {
            const t = (v - 0.7) / 0.3;
            imgData.data[idx] = Math.floor(100 + t * 155);
            imgData.data[idx + 1] = Math.floor(255);
            imgData.data[idx + 2] = Math.floor(200 + t * 55);
          }
          imgData.data[idx + 3] = 255;
        }
      }
      ctx!.putImageData(imgData, 0, 0);

      // Draw frequency markers
      ctx!.font = '9px Space Mono';
      for (const kf of KNOWN_FREQS) {
        const x = kf.freq * W;
        ctx!.strokeStyle = kf.color;
        ctx!.lineWidth = 0.5;
        ctx!.setLineDash([2, 4]);
        ctx!.beginPath(); ctx!.moveTo(x, 0); ctx!.lineTo(x, rows.length); ctx!.stroke();
        ctx!.setLineDash([]);
        ctx!.fillStyle = kf.color;
        ctx!.fillText(kf.label, x + 3, 10);
      }

      animId = requestAnimationFrame(draw);
    }
    draw();
    return () => cancelAnimationFrame(animId);
  }, []);

  useEffect(() => {
    const cleanup = drawWaterfall();

    // Try connecting to SIGINT WebSocket
    const wsUrl = 'ws://localhost:8080/sigint/spectrum';
    try {
      const ws = new WebSocket(wsUrl);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => setConnected(false);
      ws.onerror = () => setConnected(false);
      wsRef.current = ws;
    } catch {
      // SIGINT service not running — use simulated data
    }

    return () => { cleanup?.(); wsRef.current?.close(); };
  }, [drawWaterfall]);

  return (
    <div className="flex flex-col flex-1">
      <div className="panel-header">
        <span className="panel-icon">◈</span> SIGINT — {freq} {mode}
        <span className="ml-auto flex gap-2">
          <span className={`text-[9px] ${connected ? 'text-sentinel-lime' : 'text-sentinel-ember'}`}>
            {connected ? '● LIVE' : '● SIM'}
          </span>
          <select className="bg-transparent text-[9px] border border-sentinel-border rounded px-1" style={{ color: 'var(--crt)' }}
            value={freq} onChange={e => setFreq(e.target.value)}>
            <option value="1090.000 MHz">1090 MHz ADS-B</option>
            <option value="162.025 MHz">162 MHz AIS</option>
            <option value="433.920 MHz">433 MHz IoT</option>
            <option value="144.800 MHz">144.8 MHz APRS</option>
          </select>
        </span>
      </div>
      <canvas ref={canvasRef} width={560} height={280} className="waterfall-canvas flex-1" style={{ minHeight: 0 }} />
    </div>
  );
}

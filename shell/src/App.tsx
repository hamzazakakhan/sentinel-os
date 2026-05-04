// ──────────────────────────────────────────────────────────────
// sentinel-os/shell/src/App.tsx
// Sentinel OS HUD — Main Application Shell
// Military HUD interface running inside Tauri v2 desktop shell
// Panel-based layout with CRT aesthetic, live data streams
// ──────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ApolloProvider } from '@apollo/client';
import { apolloClient } from './lib/graphql';
import { TacticalMap } from './panels/TacticalMap';
import { SigintWaterfall } from './panels/SigintWaterfall';
import { IntelGraph } from './panels/IntelGraph';
import { CveDashboard } from './panels/CveDashboard';
import { Terminal } from './panels/Terminal';
import { EncryptionWorkbench } from './panels/EncryptionWorkbench';
import { ReportGenerator } from './panels/ReportGenerator';
import { SimulationRoom } from './panels/SimulationRoom';
import { OsintBrowser } from './panels/OsintBrowser';
import { PakistanFeed } from './panels/PakistanFeed';
import { WeatherGeo } from './panels/WeatherGeo';

type Workspace = 'INTEL' | 'CYBER' | 'COMMS' | 'SIGINT' | 'MAP' | 'TERMINAL' | 'GEO' | 'PAKISTAN';

interface SystemStatus {
  services_online: number;
  services_total: number;
  threat_level: string;
  tor_circuit_ok: boolean;
  sdr_detected: boolean;
  sdr_device: string;
}

const WORKSPACE_PANELS: Record<Workspace, { panels: string[]; layout: string }> = {
  INTEL:    { panels: ['graph', 'cve', 'osint', 'reports'], layout: 'grid-cols-4' },
  CYBER:    { panels: ['cve', 'simulation'], layout: 'grid-cols-2' },
  COMMS:    { panels: ['terminal', 'encryption'], layout: 'grid-cols-2' },
  SIGINT:   { panels: ['sigint', 'map'], layout: 'grid-cols-2' },
  MAP:      { panels: ['map', 'weather'], layout: 'grid-cols-2' },
  TERMINAL: { panels: ['terminal'], layout: 'grid-cols-1' },
  GEO:      { panels: ['weather', 'map'], layout: 'grid-cols-2' },
  PAKISTAN: { panels: ['pakistan', 'osint'], layout: 'grid-cols-2' },
};

const THREAT_COLORS: Record<string, string> = {
  NORMAL: 'text-sentinel-lime', ELEVATED: 'text-sentinel-gold',
  HIGH: 'text-sentinel-ember', CRITICAL: 'text-sentinel-blood',
};

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>('INTEL');
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [clock, setClock] = useState('');
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setBooting(false), 3500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const tick = () => setClock(new Date().toISOString().split('T')[1].slice(0, 8) + ' UTC');
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const poll = async () => {
      try {
        const s = await invoke<SystemStatus>('get_system_status');
        setStatus(s);
      } catch {
        // Tauri not available in dev mode — use defaults
      }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, []);

  if (booting) {
    return (
      <div className="boot-screen">
        <div className="boot-logo">SENTINEL</div>
        <div className="boot-log">
          <span>[ OK ] Initializing Sentinel OS kernel 6.12-sentinel-hardened...</span>
          <span>[ OK ] Loading squashfs root filesystem from /dev/sdb1...</span>
          <span>[ OK ] Mounting encrypted persistence partition (LUKS2/Argon2id)...</span>
          <span>[ OK ] Starting AppArmor mandatory access control...</span>
          <span>[ OK ] Loading Kafka event bus :: 3-broker cluster online...</span>
          <span>[ OK ] AI inference engine :: YOLOv8 + TorchSig loaded to VRAM...</span>
          <span>[ OK ] SIGINT service :: RTL-SDR detected on USB 3.0...</span>
          <span>[ OK ] Routing all traffic through Tor (exit node confirmed)...</span>
          <span>[ OK ] Wayland compositor :: Sentinel-WM online...</span>
          <span>[ OK ] SENTINEL OS v2.0 READY — OPERATOR ACCESS GRANTED</span>
        </div>
        <div className="boot-bar-wrap"><div className="boot-bar"></div></div>
      </div>
    );
  }

  const wsConfig = WORKSPACE_PANELS[workspace];

  const renderPanel = (panel: string) => {
    switch (panel) {
      case 'map': return <TacticalMap key="map" />;
      case 'sigint': return <SigintWaterfall key="sigint" />;
      case 'graph': return <IntelGraph key="graph" />;
      case 'cve': return <CveDashboard key="cve" />;
      case 'terminal': return <Terminal key="terminal" />;
      case 'encryption': return <EncryptionWorkbench key="encryption" />;
      case 'reports': return <ReportGenerator key="reports" />;
      case 'simulation': return <SimulationRoom key="simulation" />;
      case 'osint': return <OsintBrowser key="osint" />;
      case 'pakistan': return <PakistanFeed key="pakistan" />;
      case 'weather': return <WeatherGeo key="weather" />;
      default: return null;
    }
  };

  const threatLevel = status?.threat_level || 'ELEVATED';

  return (
    <ApolloProvider client={apolloClient}>
      <div className="hud-root fixed inset-0 flex flex-col bg-sentinel-void text-sentinel-text font-body">
        <div className="scanlines" />
        <div className="vignette" />

        {/* Top chrome bar */}
        <header className="os-chrome">
          <div className="chrome-left flex items-center">
            <div className="os-mark">SENTINEL//OS</div>
            <nav className="chrome-nav">
              {(Object.keys(WORKSPACE_PANELS) as Workspace[]).map(ws => (
                <a key={ws} className={workspace === ws ? 'active' : ''} onClick={() => setWorkspace(ws)}>
                  {ws}
                </a>
              ))}
            </nav>
          </div>
          <div className="chrome-right">
            <div className="chrome-stat">
              THREAT: <b className={THREAT_COLORS[threatLevel]}>{threatLevel}</b>
            </div>
            <div className="chrome-stat">
              NODES: <b>{status?.services_online ?? '?'}/{status?.services_total ?? '?'}</b>
            </div>
            <div className="chrome-stat">
              SDR: <b className={status?.sdr_detected ? 'text-sentinel-lime' : 'text-sentinel-muted'}>
                {status?.sdr_detected ? status.sdr_device : 'NONE'}
              </b>
            </div>
            <div className="chrome-stat">
              TOR: <b className={status?.tor_circuit_ok ? 'text-sentinel-lime' : 'text-sentinel-ember'}>
                {status?.tor_circuit_ok ? 'OK' : 'DOWN'}
              </b>
            </div>
            <div className="chrome-clock">{clock}</div>
          </div>
        </header>

        {/* Panel area */}
        <main className={`panel-area grid ${wsConfig.layout} gap-1 p-1`}>
          {wsConfig.panels.map(panel => (
            <div key={panel} className="panel flex flex-col overflow-hidden">
              {renderPanel(panel)}
            </div>
          ))}
        </main>
      </div>
    </ApolloProvider>
  );
}

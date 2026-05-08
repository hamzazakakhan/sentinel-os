// Counter-UAS Service
// - Subscribes to sigint-service spectrum events (Kafka topic: sigint.spectrum)
// - Maintains a signature database for known UAS controllers (DJI OcuSync,
//   Lightbridge, FrSky D8/D16, Crossfire, ELRS, Wi-Fi 2.4 video, 5.8 GHz analog)
// - Detects matches by frequency band + bandwidth + duty cycle
// - Publishes drone detection events on Kafka topic: cuas.detections
// - Provides REST and WebSocket APIs for HUD
import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { Kafka, logLevel, Consumer, Producer } from 'kafkajs';
import pino from 'pino';

const logger = pino({ name: 'counter-uas-service' });
const PORT = parseInt(process.env.PORT || '8094', 10);
const KAFKA_BROKER = process.env.KAFKA_BROKERS || 'localhost:9092';

// ── Drone RF signature database ───────────────────────────────
// Frequencies in MHz, bandwidth in kHz
interface UasSignature {
  id: string;
  vendor: string;
  model: string;
  protocol: string;
  bands_mhz: Array<{ low: number; high: number }>;
  channel_bw_khz: number;
  hop_pattern: 'fhss' | 'dsss' | 'ofdm' | 'analog' | 'unknown';
  threat_level: 'low' | 'medium' | 'high';
  notes?: string;
}

const SIGNATURES: UasSignature[] = [
  { id: 'dji-ocusync2', vendor: 'DJI', model: 'OcuSync 2.0 (Mavic 2/Air 2/Mini 2)',
    protocol: 'OcuSync 2.0',
    bands_mhz: [{ low: 2400, high: 2483.5 }, { low: 5725, high: 5850 }],
    channel_bw_khz: 10000, hop_pattern: 'fhss', threat_level: 'high',
    notes: 'Civilian DJI mid-range. Spoof-resistant.' },
  { id: 'dji-ocusync3', vendor: 'DJI', model: 'O3/O3+ (Mavic 3, FPV)',
    protocol: 'OcuSync 3',
    bands_mhz: [{ low: 2400, high: 2483.5 }, { low: 5725, high: 5850 }],
    channel_bw_khz: 20000, hop_pattern: 'fhss', threat_level: 'high' },
  { id: 'dji-lightbridge2', vendor: 'DJI', model: 'Lightbridge 2 (Phantom 4 Pro/Inspire 2)',
    protocol: 'Lightbridge 2',
    bands_mhz: [{ low: 2400, high: 2483.5 }, { low: 5725, high: 5850 }],
    channel_bw_khz: 10000, hop_pattern: 'fhss', threat_level: 'high' },
  { id: 'frsky-d16', vendor: 'FrSky', model: 'D16/X-series',
    protocol: 'ACCESS/D16',
    bands_mhz: [{ low: 2400, high: 2483.5 }],
    channel_bw_khz: 1500, hop_pattern: 'fhss', threat_level: 'medium',
    notes: 'Common FPV racing/freestyle.' },
  { id: 'tbs-crossfire', vendor: 'TBS', model: 'Crossfire',
    protocol: 'Crossfire',
    bands_mhz: [{ low: 868, high: 870 }, { low: 915, high: 928 }],
    channel_bw_khz: 250, hop_pattern: 'fhss', threat_level: 'high',
    notes: 'Long-range UHF, 25-50km, common for fixed-wing strike drones.' },
  { id: 'tbs-tracer', vendor: 'TBS', model: 'Tracer',
    protocol: 'Tracer',
    bands_mhz: [{ low: 2400, high: 2483.5 }],
    channel_bw_khz: 250, hop_pattern: 'fhss', threat_level: 'medium' },
  { id: 'expresslrs-2g4', vendor: 'ExpressLRS', model: 'ELRS 2.4 GHz',
    protocol: 'ELRS',
    bands_mhz: [{ low: 2400, high: 2483.5 }],
    channel_bw_khz: 1000, hop_pattern: 'fhss', threat_level: 'medium' },
  { id: 'expresslrs-900', vendor: 'ExpressLRS', model: 'ELRS 900 MHz',
    protocol: 'ELRS',
    bands_mhz: [{ low: 902, high: 928 }],
    channel_bw_khz: 1000, hop_pattern: 'fhss', threat_level: 'high',
    notes: 'Long-range FPV, weaponised in Ukraine conflict.' },
  { id: 'wifi-fpv-2g4', vendor: 'Generic', model: 'Wi-Fi FPV (Tello, Parrot)',
    protocol: '802.11n',
    bands_mhz: [{ low: 2400, high: 2483.5 }],
    channel_bw_khz: 20000, hop_pattern: 'ofdm', threat_level: 'low' },
  { id: 'analog-5g8', vendor: 'Generic', model: 'Analog FPV 5.8 GHz',
    protocol: 'NTSC/PAL',
    bands_mhz: [{ low: 5650, high: 5950 }],
    channel_bw_khz: 27000, hop_pattern: 'analog', threat_level: 'high',
    notes: 'Most common attack-drone video link in Ukraine/Gaza.' },
  { id: 'analog-1g3', vendor: 'Generic', model: 'Analog FPV 1.2/1.3 GHz',
    protocol: 'NTSC/PAL',
    bands_mhz: [{ low: 1080, high: 1360 }],
    channel_bw_khz: 18000, hop_pattern: 'analog', threat_level: 'high' },
  { id: 'shahed-136', vendor: 'IRGC/Geran-2', model: 'Shahed-136 / Geran-2',
    protocol: 'Inertial+GNSS (datalink optional)',
    bands_mhz: [{ low: 1500, high: 1620 }],
    channel_bw_khz: 2000, hop_pattern: 'unknown', threat_level: 'high',
    notes: 'Loitering munition. Primarily inertial/GPS; some variants telemetry on L-band.' },
];

// ── Spectrum event from sigint-service ────────────────────────
interface SpectrumEvent {
  ts: string;
  center_mhz: number;
  bandwidth_khz: number;
  power_dbm: number;
  hop_rate_hz?: number;
  pattern?: string;
  observer?: { lat: number; lon: number };
}
interface UasDetection {
  id: string;
  ts: string;
  signature_id: string;
  signature: UasSignature;
  confidence: number;     // 0-100
  spectrum: SpectrumEvent;
  observer?: { lat: number; lon: number };
}

function matchSignature(ev: SpectrumEvent): { sig: UasSignature; confidence: number } | null {
  let best: { sig: UasSignature; confidence: number } | null = null;
  for (const sig of SIGNATURES) {
    let bandHit = false;
    for (const b of sig.bands_mhz) {
      if (ev.center_mhz >= b.low && ev.center_mhz <= b.high) { bandHit = true; break; }
    }
    if (!bandHit) continue;
    let conf = 40;
    // Bandwidth match within 30%
    const bwRatio = Math.min(ev.bandwidth_khz, sig.channel_bw_khz) /
                    Math.max(ev.bandwidth_khz, sig.channel_bw_khz);
    if (bwRatio > 0.7) conf += 30;
    else if (bwRatio > 0.4) conf += 15;
    // Hop pattern match
    if (ev.pattern && ev.pattern.toLowerCase() === sig.hop_pattern) conf += 20;
    // Hop rate hint (FHSS typically 100-2000 Hz)
    if (sig.hop_pattern === 'fhss' && ev.hop_rate_hz && ev.hop_rate_hz > 50 && ev.hop_rate_hz < 5000) conf += 10;
    if (conf > (best?.confidence ?? 0)) best = { sig, confidence: Math.min(100, conf) };
  }
  return best && best.confidence >= 50 ? best : null;
}

// State
const detections: UasDetection[] = [];
const MAX_DETECTIONS = 1000;

// Kafka
const kafka = new Kafka({ brokers: [KAFKA_BROKER], clientId: 'counter-uas-service', logLevel: logLevel.WARN });
let producer: Producer | null = null;
let consumer: Consumer | null = null;

async function startKafka() {
  producer = kafka.producer();
  consumer = kafka.consumer({ groupId: 'counter-uas-service-group' });
  await producer.connect();
  await consumer.connect();
  await consumer.subscribe({ topic: 'sigint.spectrum', fromBeginning: false });
  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const ev = JSON.parse(message.value!.toString()) as SpectrumEvent;
        const m = matchSignature(ev);
        if (!m) return;
        const det: UasDetection = {
          id: `cuas-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
          ts: ev.ts ?? new Date().toISOString(),
          signature_id: m.sig.id, signature: m.sig,
          confidence: m.confidence, spectrum: ev, observer: ev.observer,
        };
        detections.push(det); if (detections.length > MAX_DETECTIONS) detections.shift();
        broadcast(det);
        try { await producer!.send({ topic: 'cuas.detections', messages: [{ key: det.id, value: JSON.stringify(det) }] }); } catch {}
        logger.info({ sig: det.signature.id, conf: det.confidence, mhz: ev.center_mhz }, 'UAS detected');
      } catch (err: any) { logger.debug({ err: err.message }, 'spectrum parse failed'); }
    },
  });
}

// HTTP + WS
const app = express();
app.use(express.json());
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/cuas/stream' });
const wsClients = new Set<WebSocket>();
wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
  ws.send(JSON.stringify({ type: 'snapshot', detections }));
});
function broadcast(det: UasDetection) {
  const m = JSON.stringify({ type: 'detection', detection: det });
  for (const ws of wsClients) if (ws.readyState === WebSocket.OPEN) ws.send(m);
}

app.get('/health', (_q, r) => r.json({ status: 'ok', service: 'counter-uas-service', signatures: SIGNATURES.length }));
app.get('/signatures', (_q, r) => r.json({ count: SIGNATURES.length, signatures: SIGNATURES }));
app.get('/detections', (req, r) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? '100'), 10), MAX_DETECTIONS);
  r.json({ count: detections.length, detections: detections.slice(-limit).reverse() });
});

// Manual injection (for ops without SDR)
app.post('/spectrum', async (req, res) => {
  const ev = req.body as SpectrumEvent;
  if (!ev?.center_mhz || !ev?.bandwidth_khz) return res.status(400).json({ error: 'center_mhz, bandwidth_khz required' });
  const m = matchSignature(ev);
  if (!m) return res.json({ matched: false });
  const det: UasDetection = {
    id: `cuas-manual-${Date.now()}`, ts: ev.ts ?? new Date().toISOString(),
    signature_id: m.sig.id, signature: m.sig,
    confidence: m.confidence, spectrum: ev, observer: ev.observer,
  };
  detections.push(det); if (detections.length > MAX_DETECTIONS) detections.shift();
  broadcast(det);
  if (producer) { try { await producer.send({ topic: 'cuas.detections', messages: [{ key: det.id, value: JSON.stringify(det) }] }); } catch {} }
  res.json({ matched: true, detection: det });
});

async function main() {
  startKafka().catch((err) => logger.warn({ err: err.message }, 'kafka init failed (will retry passively)'));
  server.listen(PORT, () => logger.info({ port: PORT }, 'counter-uas-service listening'));
}
main().catch((err) => { logger.error({ err }, 'startup failed'); process.exit(1); });

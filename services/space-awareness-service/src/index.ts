// Space Situational Awareness — TLE ingest + SGP4 propagation
// - Periodically fetches latest TLEs from CelesTrak (free, no auth)
// - Propagates orbits with satellite.js (full SGP4 implementation)
// - Computes ECF position, lat/lon/alt, ground-track and look angles
// - Conjunction warning: pairs of objects within configurable threshold
// - WebSocket stream for HUD; REST API for queries
import express from 'express';
import axios from 'axios';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as satellite from 'satellite.js';
import Redis from 'ioredis';
import pino from 'pino';
import { CronJob } from 'cron';

const logger = pino({ name: 'space-awareness-service' });
const PORT = parseInt(process.env.PORT || '8093', 10);
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const CONJUNCTION_KM = parseFloat(process.env.CONJUNCTION_KM || '10');

// CelesTrak GP groups (no auth needed)
const TLE_FEEDS: { group: string; url: string }[] = [
  { group: 'stations',     url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle' },
  { group: 'starlink',     url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle' },
  { group: 'gps-ops',      url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=tle' },
  { group: 'glonass-ops',  url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=glonass-ops&FORMAT=tle' },
  { group: 'galileo',      url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=galileo&FORMAT=tle' },
  { group: 'beidou',       url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=beidou&FORMAT=tle' },
  { group: 'military',     url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=military&FORMAT=tle' },
  { group: 'intelsat',     url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=intelsat&FORMAT=tle' },
  { group: 'weather',      url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=tle' },
  { group: 'science',      url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=science&FORMAT=tle' },
];

interface SatRecord {
  noradId: string;
  name: string;
  group: string;
  line1: string;
  line2: string;
  satrec: satellite.SatRec;
  classification: 'civil'|'military'|'gnss'|'starlink'|'station'|'unknown';
}
interface SatPosition {
  noradId: string; name: string; group: string;
  lat: number; lon: number; alt_km: number;
  velocity_kms: number; epoch: string;
}

const sats = new Map<string, SatRecord>();
const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: true });
redis.on('error', (e) => logger.debug({ err: e.message }, 'redis err'));

function classify(group: string): SatRecord['classification'] {
  if (group === 'military') return 'military';
  if (group === 'starlink') return 'starlink';
  if (['gps-ops','glonass-ops','galileo','beidou'].includes(group)) return 'gnss';
  if (group === 'stations') return 'station';
  return 'civil';
}

function parseTLE(text: string, group: string) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  let added = 0;
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i].trim();
    const l1 = lines[i + 1];
    const l2 = lines[i + 2];
    if (!l1.startsWith('1 ') || !l2.startsWith('2 ')) continue;
    try {
      const satrec = satellite.twoline2satrec(l1, l2);
      const noradId = l1.substring(2, 7).trim();
      sats.set(noradId, { noradId, name, group, line1: l1, line2: l2, satrec, classification: classify(group) });
      added++;
    } catch {}
  }
  return added;
}

async function fetchAllTLEs() {
  let total = 0;
  for (const f of TLE_FEEDS) {
    try {
      const { data } = await axios.get<string>(f.url, { timeout: 30_000, responseType: 'text' });
      const n = parseTLE(data, f.group);
      total += n;
      logger.info({ group: f.group, count: n }, 'TLE feed loaded');
    } catch (err: any) {
      logger.warn({ group: f.group, err: err.message }, 'TLE fetch failed');
    }
  }
  logger.info({ total, unique: sats.size }, 'TLE refresh complete');
  try { await redis.set('space:tle:last_refresh', new Date().toISOString()); } catch {}
}

function propagate(rec: SatRecord, when: Date): SatPosition | null {
  try {
    const pv = satellite.propagate(rec.satrec, when);
    if (!pv.position || typeof pv.position === 'boolean') return null;
    const gmst = satellite.gstime(when);
    const geo = satellite.eciToGeodetic(pv.position as satellite.EciVec3<number>, gmst);
    const v = pv.velocity as satellite.EciVec3<number>;
    const speed = Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z); // km/s
    return {
      noradId: rec.noradId, name: rec.name, group: rec.group,
      lat: satellite.degreesLat(geo.latitude),
      lon: satellite.degreesLong(geo.longitude),
      alt_km: geo.height,
      velocity_kms: speed,
      epoch: when.toISOString(),
    };
  } catch { return null; }
}

function snapshot(when = new Date()): SatPosition[] {
  const out: SatPosition[] = [];
  for (const rec of sats.values()) {
    const p = propagate(rec, when);
    if (p) out.push(p);
  }
  return out;
}

// Conjunction analysis: O(N^2) — limit to sample for performance
function findConjunctions(when = new Date(), limit = 500): Array<{a: SatPosition; b: SatPosition; dist_km: number}> {
  const all = snapshot(when);
  // Sample largest groups
  const sample = all.slice(0, limit);
  const results: Array<{a: SatPosition; b: SatPosition; dist_km: number}> = [];
  for (let i = 0; i < sample.length; i++) {
    for (let j = i + 1; j < sample.length; j++) {
      const a = sample[i]; const b = sample[j];
      // Quick filter: altitude diff
      if (Math.abs(a.alt_km - b.alt_km) > CONJUNCTION_KM) continue;
      // 3D distance via lla (good enough for proximity warning)
      const dLat = (a.lat - b.lat) * Math.PI / 180;
      const dLon = (a.lon - b.lon) * Math.PI / 180;
      const meanLat = ((a.lat + b.lat) / 2) * Math.PI / 180;
      const surface = Math.sqrt((dLat * 6371) ** 2 + (dLon * 6371 * Math.cos(meanLat)) ** 2);
      const altDiff = Math.abs(a.alt_km - b.alt_km);
      const dist = Math.sqrt(surface ** 2 + altDiff ** 2);
      if (dist <= CONJUNCTION_KM) results.push({ a, b, dist_km: dist });
    }
  }
  results.sort((x, y) => x.dist_km - y.dist_km);
  return results.slice(0, 50);
}

// Look angles for ground observer
function lookAngles(rec: SatRecord, observerLat: number, observerLon: number, observerAlt = 0, when = new Date()) {
  const pv = satellite.propagate(rec.satrec, when);
  if (!pv.position || typeof pv.position === 'boolean') return null;
  const gmst = satellite.gstime(when);
  const ecf = satellite.eciToEcf(pv.position as satellite.EciVec3<number>, gmst);
  const observerGd = {
    latitude: observerLat * Math.PI / 180,
    longitude: observerLon * Math.PI / 180,
    height: observerAlt,
  };
  const la = satellite.ecfToLookAngles(observerGd, ecf);
  return {
    azimuth_deg: la.azimuth * 180 / Math.PI,
    elevation_deg: la.elevation * 180 / Math.PI,
    range_km: la.rangeSat,
  };
}

// HTTP + WS
const app = express();
app.use(express.json());
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/space/stream' });
const wsClients = new Set<WebSocket>();
wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
  ws.send(JSON.stringify({ type: 'snapshot', objects: snapshot() }));
});

app.get('/health', (_q, r) => r.json({ status: 'ok', service: 'space-awareness-service', sats: sats.size }));

app.get('/satellites', (req, res) => {
  const group = req.query.group as string | undefined;
  const cls = req.query.class as string | undefined;
  const list = [];
  for (const rec of sats.values()) {
    if (group && rec.group !== group) continue;
    if (cls && rec.classification !== cls) continue;
    list.push({ noradId: rec.noradId, name: rec.name, group: rec.group, classification: rec.classification });
  }
  res.json({ count: list.length, satellites: list });
});

app.get('/satellites/:id', (req, res) => {
  const rec = sats.get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'not found' });
  const pos = propagate(rec, new Date());
  res.json({ ...rec, satrec: undefined, position: pos });
});

app.get('/positions', (_q, res) => {
  res.json({ epoch: new Date().toISOString(), objects: snapshot() });
});

app.get('/conjunctions', (req, res) => {
  const when = req.query.when ? new Date(String(req.query.when)) : new Date();
  res.json({ epoch: when.toISOString(), threshold_km: CONJUNCTION_KM, conjunctions: findConjunctions(when) });
});

app.get('/lookangles/:id', (req, res) => {
  const rec = sats.get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'not found' });
  const lat = parseFloat(req.query.lat as string);
  const lon = parseFloat(req.query.lon as string);
  if (!isFinite(lat) || !isFinite(lon)) return res.status(400).json({ error: 'lat,lon required' });
  const la = lookAngles(rec, lat, lon, parseFloat(String(req.query.alt ?? '0')));
  res.json({ noradId: rec.noradId, observer: { lat, lon }, look: la });
});

app.post('/refresh', async (_q, res) => {
  res.json({ started: true });
  void fetchAllTLEs();
});

// Periodic broadcast every 10s
setInterval(() => {
  if (wsClients.size === 0 || sats.size === 0) return;
  const positions = snapshot();
  const payload = JSON.stringify({ type: 'positions', epoch: new Date().toISOString(), objects: positions });
  for (const ws of wsClients) if (ws.readyState === WebSocket.OPEN) ws.send(payload);
}, 10_000);

async function main() {
  await fetchAllTLEs();
  // Refresh TLEs every 6 hours
  new CronJob('0 0 */6 * * *', () => { void fetchAllTLEs(); }).start();
  server.listen(PORT, () => logger.info({ port: PORT }, 'space-awareness-service listening'));
}
main().catch((err) => { logger.error({ err }, 'startup failed'); process.exit(1); });

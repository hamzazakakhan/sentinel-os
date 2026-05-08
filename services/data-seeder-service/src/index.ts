// Data Seeder Service — Ollama-driven continuous synthetic data generation
//
// Runs as a daemon. On a configurable schedule it uses a local Ollama LLM
// to invent realistic tactical scenarios and pumps them into:
//   - tak-service              (CoT XML tracks)
//   - threat-intel-service     (threat reports / IoC alerts)
//   - mission-planning-service (mission plan requests)
//   - counter-uas-service      (synthetic spectrum events)
//   - link16-service           (J-series messages)
//   - space-awareness-service  (auto-refresh trigger)
//   - coalition-auth-service   (audit auth events)
//
// Modes:
//   - exercise: high-tempo synthetic scenarios for training
//   - quiet:    sparse low-rate background traffic
//   - stop:     no synthetic generation
//
// All seeded data is tagged with `synthetic=true` in metadata so it is
// distinguishable from live operational data.
import express from 'express';
import axios from 'axios';
import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';

const logger = pino({ name: 'data-seeder-service' });

const PORT = parseInt(process.env.PORT || '8099', 10);
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'tinyllama';

const ENDPOINTS = {
  tak: process.env.TAK_URL || 'http://localhost:8090',
  ti:  process.env.TI_URL  || 'http://localhost:8091',
  mp:  process.env.MP_URL  || 'http://localhost:8092',
  ssa: process.env.SSA_URL || 'http://localhost:8093',
  cuas:process.env.CUAS_URL|| 'http://localhost:8094',
  auth:process.env.AUTH_URL|| 'http://localhost:8095',
  l16: process.env.L16_URL || 'http://localhost:8098',
};

let MODE: 'exercise'|'quiet'|'stop' = (process.env.SEED_MODE as any) || 'quiet';
let stats = { tak: 0, ti: 0, mp: 0, cuas: 0, l16: 0, auth: 0, ollama_calls: 0, ollama_failures: 0 };

// ── Ollama helper ─────────────────────────────────────────────
async function ollama(prompt: string, asJson = false, max = 200): Promise<string> {
  stats.ollama_calls++;
  try {
    const { data } = await axios.post(`${OLLAMA_URL}/api/generate`,
      { model: OLLAMA_MODEL, prompt, stream: false,
        format: asJson ? 'json' : undefined,
        options: { temperature: 0.7, num_predict: max } },
      { timeout: 60_000 });
    return String(data?.response ?? '').trim();
  } catch (err: any) {
    stats.ollama_failures++;
    logger.debug({ err: err.message }, 'ollama call failed');
    return '';
  }
}

// ── Geographic regions of interest (concentration biases) ─────
const REGIONS = [
  { name: 'Eastern_Europe', latRange: [44, 55], lonRange: [22, 40] },
  { name: 'Middle_East',    latRange: [25, 38], lonRange: [35, 60] },
  { name: 'South_China_Sea',latRange: [3, 25],  lonRange: [105, 122] },
  { name: 'Korean_Peninsula',latRange: [35, 41], lonRange: [125, 132] },
  { name: 'Pakistan_AF',    latRange: [29, 38], lonRange: [60, 75] },
];
const COT_TYPES = [
  'a-f-G-U-C',      // friendly ground combat
  'a-f-A-M-F',      // friendly air fixed-wing
  'a-h-G-U-C-I',    // hostile infantry
  'a-h-A-M-F',      // hostile fighter
  'a-n-S-X-M',      // neutral merchant
  'a-u-G',          // unknown ground
];
const CALLSIGNS = ['EAGLE','RAVEN','HAWK','VIPER','GHOST','BISON','LANCER','SENTRY','REBEL','TYPHOON'];

function randPick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function randInRange(min: number, max: number) { return min + Math.random() * (max - min); }

// ── 1. TAK CoT seeder ─────────────────────────────────────────
async function seedTAK() {
  const region = randPick(REGIONS);
  const lat = randInRange(region.latRange[0], region.latRange[1]);
  const lon = randInRange(region.lonRange[0], region.lonRange[1]);
  const type = randPick(COT_TYPES);
  const callsign = `${randPick(CALLSIGNS)}-${Math.floor(Math.random() * 99) + 1}`;
  const uid = uuidv4();
  const now = new Date();
  const stale = new Date(Date.now() + 5 * 60_000);
  const xml = `<?xml version="1.0" standalone="yes"?>
<event version="2.0" uid="${uid}" type="${type}" how="m-g"
       time="${now.toISOString()}" start="${now.toISOString()}" stale="${stale.toISOString()}">
  <point lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}" hae="${randInRange(0,5000).toFixed(0)}" ce="50" le="100"/>
  <detail><contact callsign="${callsign}"/><__group name="${region.name}" role="Team Member"/><synthetic value="true"/></detail>
</event>`;
  try {
    await axios.post(`${ENDPOINTS.tak}/cot`, xml, {
      headers: { 'Content-Type': 'application/xml' }, timeout: 5000,
    });
    stats.tak++;
  } catch (err: any) { logger.debug({ err: err.message }, 'TAK seed failed'); }
}

// ── 2. Threat intel — manual indicator injection via Ollama narrative ──
async function seedThreatIntel() {
  const prompt = `Generate one realistic cyber threat indicator as JSON with keys: type (one of ipv4,domain,url,hash-sha256), value (realistic example), description (1 sentence), severity (low|medium|high|critical), confidence (50-95). Output JSON only.`;
  const raw = await ollama(prompt, true, 150);
  let ioc: any = null;
  try { ioc = JSON.parse(raw); } catch { return; }
  if (!ioc?.type || !ioc?.value) return;
  // Trigger upstream ingest cycle (real feeds are also polled)
  try {
    await axios.post(`${ENDPOINTS.ti}/ingest/now`, {}, { timeout: 5000 });
    stats.ti++;
  } catch (err: any) { logger.debug({ err: err.message }, 'TI ingest trigger failed'); }
}

// ── 3. Mission planning — generate plausible missions ─────────
async function seedMissionPlanning() {
  const prompt = `Generate one military mission objective as a single sentence. Realistic but generic. Examples: "Conduct ISR sweep of grid square N4521", "Escort convoy from FOB Alpha to FOB Bravo". Output the objective only.`;
  const objective = (await ollama(prompt, false, 60)) || 'Conduct routine ISR patrol';
  const region = randPick(REGIONS);
  const startLat = randInRange(region.latRange[0], region.latRange[1]);
  const startLon = randInRange(region.lonRange[0], region.lonRange[1]);
  const endLat = startLat + randInRange(-0.5, 0.5);
  const endLon = startLon + randInRange(-0.5, 0.5);
  try {
    await axios.post(`${ENDPOINTS.mp}/missions/plan`, {
      objective, start: { lat: startLat, lon: startLon }, end: { lat: endLat, lon: endLon },
      asset_type: randPick(['foot','vehicle','air','sea'] as const),
      asset_speed_kmh: randPick([5, 60, 400, 30]),
    }, { timeout: 30_000 });
    stats.mp++;
  } catch (err: any) { logger.debug({ err: err.message }, 'mission seed failed'); }
}

// ── 4. Counter-UAS — synthetic RF detections ──────────────────
const FAKE_DRONE_BANDS: Array<{ center: number; bw: number; pattern: string }> = [
  { center: 2440, bw: 10000, pattern: 'fhss' },   // DJI OcuSync 2.4
  { center: 5750, bw: 20000, pattern: 'fhss' },   // DJI O3 5.8
  { center: 869,  bw: 250,   pattern: 'fhss' },   // TBS Crossfire
  { center: 915,  bw: 1000,  pattern: 'fhss' },   // ELRS 900
  { center: 5800, bw: 27000, pattern: 'analog' }, // Analog FPV
  { center: 1.55e3,bw: 2000, pattern: 'unknown' },// Shahed-like
];
async function seedCounterUAS() {
  const band = randPick(FAKE_DRONE_BANDS);
  const region = randPick(REGIONS);
  try {
    await axios.post(`${ENDPOINTS.cuas}/spectrum`, {
      ts: new Date().toISOString(),
      center_mhz: band.center + randInRange(-5, 5),
      bandwidth_khz: band.bw,
      power_dbm: randInRange(-90, -50),
      pattern: band.pattern,
      hop_rate_hz: band.pattern === 'fhss' ? randInRange(100, 2000) : undefined,
      observer: {
        lat: randInRange(region.latRange[0], region.latRange[1]),
        lon: randInRange(region.lonRange[0], region.lonRange[1]),
      },
    }, { timeout: 5000 });
    stats.cuas++;
  } catch (err: any) { logger.debug({ err: err.message }, 'cuas seed failed'); }
}

// ── 5. Link 16 J-message seeder ───────────────────────────────
async function seedLink16() {
  const labels = ['J2.2','J3.2','J3.3','J3.5','J3.7','J7.0'];
  const label = randPick(labels);
  const region = randPick(REGIONS);
  const fields: Record<string, any> = {
    position: {
      lat: randInRange(region.latRange[0], region.latRange[1]),
      lon: randInRange(region.lonRange[0], region.lonRange[1]),
    },
    altitude_ft: Math.floor(randInRange(0, 40000)),
    course_deg: Math.floor(randInRange(0, 360)),
    speed_kts: Math.floor(randInRange(0, 600)),
    iff: randPick(['Mode 1','Mode 2','Mode 3','Mode 4','Mode 5']),
    threat: randPick(['friendly','assumed_friend','hostile','suspect','neutral']),
    synthetic: true,
  };
  try {
    await axios.post(`${ENDPOINTS.l16}/messages`, {
      label, source_track: Math.floor(Math.random() * 0o7777),
      fields,
    }, { timeout: 5000 });
    stats.l16++;
  } catch (err: any) { logger.debug({ err: err.message }, 'link16 seed failed'); }
}

// ── 6. Coalition auth audit — periodic introspection probe ────
async function seedAuthProbe() {
  try {
    // Get a synthetic token cycle to keep audit logs warm
    const r = await axios.post(`${ENDPOINTS.auth}/token`,
      'grant_type=password&username=analyst&password=sentinel',
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 5000 });
    if (r.data?.access_token) stats.auth++;
  } catch (err: any) { logger.debug({ err: err.message }, 'auth probe failed'); }
}

// ── Schedulers ────────────────────────────────────────────────
function tickRates(): Record<string, number> {
  if (MODE === 'stop') return { tak: 0, ti: 0, mp: 0, cuas: 0, l16: 0, auth: 0 };
  if (MODE === 'exercise') return {
    tak: 5_000,    // 5s — many tracks
    ti: 60_000,    // 1min
    mp: 120_000,   // 2min
    cuas: 8_000,   // 8s
    l16: 6_000,    // 6s
    auth: 60_000,  // 1min
  };
  // quiet
  return {
    tak: 30_000, ti: 600_000, mp: 600_000,
    cuas: 60_000, l16: 30_000, auth: 300_000,
  };
}

const timers = new Map<string, NodeJS.Timeout>();
function schedule(name: string, fn: () => Promise<void>) {
  const rates = tickRates();
  if (timers.has(name)) clearTimeout(timers.get(name)!);
  if (rates[name] === 0) return;
  const tick = async () => { await fn().catch(() => {}); timers.set(name, setTimeout(tick, tickRates()[name])); };
  timers.set(name, setTimeout(tick, rates[name]));
}

function applyMode() {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  schedule('tak', seedTAK);
  schedule('ti', seedThreatIntel);
  schedule('mp', seedMissionPlanning);
  schedule('cuas', seedCounterUAS);
  schedule('l16', seedLink16);
  schedule('auth', seedAuthProbe);
  logger.info({ mode: MODE, rates: tickRates() }, 'seeding mode applied');
}

// ── HTTP control API ──────────────────────────────────────────
const app = express();
app.use(express.json());
app.get('/health', (_q, r) => r.json({ status: 'ok', service: 'data-seeder-service', mode: MODE, stats }));
app.get('/stats', (_q, r) => r.json({ mode: MODE, stats, endpoints: ENDPOINTS, model: OLLAMA_MODEL }));
app.post('/mode', (req, res) => {
  const m = req.body?.mode;
  if (!['exercise','quiet','stop'].includes(m)) return res.status(400).json({ error: 'mode must be exercise|quiet|stop' });
  MODE = m; applyMode();
  res.json({ mode: MODE });
});
app.post('/trigger/:type', async (req, res) => {
  const type = req.params.type;
  const map: Record<string, () => Promise<void>> = { tak: seedTAK, ti: seedThreatIntel, mp: seedMissionPlanning, cuas: seedCounterUAS, l16: seedLink16, auth: seedAuthProbe };
  const fn = map[type]; if (!fn) return res.status(400).json({ error: `unknown trigger; use ${Object.keys(map).join(', ')}` });
  await fn(); res.json({ triggered: type, stats });
});

// Wait for ollama, then start
async function waitForOllama(maxAttempts = 60) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 3000 });
      logger.info('ollama reachable');
      return true;
    } catch { await new Promise((r) => setTimeout(r, 5000)); }
  }
  logger.warn('ollama not reachable after wait period — proceeding without it');
  return false;
}

async function main() {
  await waitForOllama();
  applyMode();
  app.listen(PORT, () => logger.info({ port: PORT, mode: MODE }, 'data-seeder-service listening'));
}
main().catch((err) => { logger.error({ err }, 'startup failed'); process.exit(1); });

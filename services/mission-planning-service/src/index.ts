// Mission Planning Service — Course of Action (COA) generator
// - METT-TC analysis (Mission, Enemy, Terrain, Troops, Time, Civil)
// - Route planning over geographic terrain (haversine + slope cost)
// - Risk scoring against threat indicators from threat-intel-service
// - LLM-augmented COA narrative via Ollama
import express from 'express';
import axios from 'axios';
import pg from 'pg';
import pino from 'pino';
import { Kafka, logLevel } from 'kafkajs';
import * as turf from '@turf/turf';

const logger = pino({ name: 'mission-planning-service' });
const PORT = parseInt(process.env.PORT || '8092', 10);
const PG_URL = process.env.DATABASE_URL || 'postgres://sentinel:sentinel@localhost:5432/sentinel';
const KAFKA_BROKER = process.env.KAFKA_BROKERS || 'localhost:9092';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'tinyllama';

interface LatLon { lat: number; lon: number }
interface Threat { id: string; name: string; lat: number; lon: number; radius_km: number; severity: 1|2|3|4|5 }
interface MissionInput {
  mission_id?: string;
  objective: string;
  start: LatLon;
  end: LatLon;
  waypoints?: LatLon[];
  threats?: Threat[];
  asset_type?: 'foot'|'vehicle'|'air'|'sea';
  asset_speed_kmh?: number;
  time_constraint_min?: number;
}
interface COA {
  id: string; mission_id: string; name: string;
  route: { type: 'LineString'; coordinates: [number, number][] };
  distance_km: number; eta_min: number;
  risk_score: number;            // 0-100, lower=better
  risk_factors: string[];
  intersected_threats: string[];
  narrative: string;
  recommendation: 'PRIMARY'|'ALTERNATE'|'CONTINGENCY';
  generated_at: string;
}

const pool = new pg.Pool({ connectionString: PG_URL, max: 10 });
const kafka = new Kafka({ brokers: [KAFKA_BROKER], clientId: 'mission-planning-service', logLevel: logLevel.WARN });
const producer = kafka.producer();

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS missions (
      id TEXT PRIMARY KEY, objective TEXT NOT NULL, input JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS coas (
      id TEXT PRIMARY KEY, mission_id TEXT REFERENCES missions(id) ON DELETE CASCADE,
      name TEXT NOT NULL, route JSONB NOT NULL, distance_km DOUBLE PRECISION,
      eta_min DOUBLE PRECISION, risk_score INT, risk_factors TEXT[],
      intersected_threats TEXT[], narrative TEXT, recommendation TEXT,
      generated_at TIMESTAMPTZ DEFAULT NOW());
  `);
  logger.info('mission planning schema ready');
}

// Build route from start through optional waypoints to end
function buildRoute(input: MissionInput): { type: 'LineString'; coordinates: [number, number][] } {
  const pts: [number, number][] = [[input.start.lon, input.start.lat]];
  for (const wp of input.waypoints ?? []) pts.push([wp.lon, wp.lat]);
  pts.push([input.end.lon, input.end.lat]);
  return { type: 'LineString', coordinates: pts };
}

// Generate alternate routes by offsetting midpoint perpendicular
function alternateRoute(input: MissionInput, offsetKm: number): { type: 'LineString'; coordinates: [number, number][] } {
  const start = turf.point([input.start.lon, input.start.lat]);
  const end = turf.point([input.end.lon, input.end.lat]);
  const mid = turf.midpoint(start, end);
  const bearing = turf.bearing(start, end);
  const perp = bearing + 90;
  const offset = turf.destination(mid, offsetKm, perp, { units: 'kilometers' });
  const pts: [number, number][] = [
    [input.start.lon, input.start.lat],
    offset.geometry.coordinates as [number, number],
    [input.end.lon, input.end.lat],
  ];
  return { type: 'LineString', coordinates: pts };
}

function routeDistanceKm(route: { coordinates: [number, number][] }): number {
  return turf.length(turf.lineString(route.coordinates), { units: 'kilometers' });
}

// Risk scoring: each threat near the route adds risk by severity * proximity
function scoreRoute(route: { type: 'LineString'; coordinates: [number, number][] }, threats: Threat[]): { score: number; factors: string[]; intersected: string[] } {
  let score = 0; const factors: string[] = []; const intersected: string[] = [];
  if (route.coordinates.length < 2) return { score, factors, intersected };
  const line = turf.lineString(route.coordinates);
  for (const t of threats) {
    const tp = turf.point([t.lon, t.lat]);
    const distKm = turf.pointToLineDistance(tp, line, { units: 'kilometers' });
    if (distKm <= t.radius_km) {
      const proximity = 1 - distKm / t.radius_km;     // 1 at center, 0 at edge
      const contribution = t.severity * 8 * proximity; // sev 5 + center = 40 pts
      score += contribution;
      factors.push(`Within threat zone "${t.name}" (sev ${t.severity}, ${distKm.toFixed(1)}km from center)`);
      intersected.push(t.id);
    } else if (distKm <= t.radius_km * 2) {
      score += t.severity * 1.5;
      factors.push(`Near threat zone "${t.name}" (sev ${t.severity}, ${distKm.toFixed(1)}km away)`);
    }
  }
  return { score: Math.min(100, Math.round(score)), factors, intersected };
}

// Pull active high-severity IoCs as additional risk context (cyber threats)
async function fetchCyberThreatCount(): Promise<number> {
  try {
    const r = await pool.query(
      `SELECT COUNT(*) FROM threat_indicators
       WHERE severity IN ('high','critical') AND last_seen > NOW() - INTERVAL '24 hours'`);
    return Number(r.rows[0]?.count ?? 0);
  } catch { return 0; }
}

// LLM narrative via Ollama
async function generateNarrative(input: MissionInput, coa: Omit<COA, 'narrative'>): Promise<string> {
  const prompt = `You are a military mission planner. Write a concise 4-6 sentence Course of Action briefing.
Mission objective: ${input.objective}
COA: ${coa.name} (${coa.recommendation})
Route distance: ${coa.distance_km.toFixed(1)} km, ETA ${coa.eta_min.toFixed(0)} min
Risk score: ${coa.risk_score}/100
Risk factors: ${coa.risk_factors.join('; ') || 'none identified'}
Asset: ${input.asset_type ?? 'unspecified'} at ${input.asset_speed_kmh ?? 'unspecified'} km/h
Output a tight tactical briefing only.`;
  try {
    const { data } = await axios.post(`${OLLAMA_URL}/api/generate`,
      { model: OLLAMA_MODEL, prompt, stream: false, options: { temperature: 0.3, num_predict: 200 } },
      { timeout: 30_000 });
    return String(data?.response ?? '').trim();
  } catch (err: any) {
    logger.debug({ err: err.message }, 'Ollama narrative failed, using template');
    return `${coa.name}: ${coa.recommendation} route covering ${coa.distance_km.toFixed(1)} km with ETA ${coa.eta_min.toFixed(0)} min. Risk score ${coa.risk_score}/100. ${coa.risk_factors[0] ?? 'No major hazards identified.'}`;
  }
}

async function generateCOAs(input: MissionInput): Promise<COA[]> {
  const missionId = input.mission_id ?? `m-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  await pool.query('INSERT INTO missions(id,objective,input) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',
    [missionId, input.objective, input]);

  const speed = input.asset_speed_kmh ?? (input.asset_type === 'air' ? 400 : input.asset_type === 'sea' ? 30 : input.asset_type === 'vehicle' ? 60 : 5);
  const threats = input.threats ?? [];
  const cyberCount = await fetchCyberThreatCount();

  const variants = [
    { name: 'COA-1 Direct', route: buildRoute(input), recommendation: 'PRIMARY' as const },
    { name: 'COA-2 North Bypass', route: alternateRoute(input, 5), recommendation: 'ALTERNATE' as const },
    { name: 'COA-3 South Bypass', route: alternateRoute(input, -5), recommendation: 'CONTINGENCY' as const },
  ];

  const coas: COA[] = [];
  for (const v of variants) {
    const distance = routeDistanceKm(v.route);
    const eta = (distance / speed) * 60;
    const risk = scoreRoute(v.route, threats);
    const cyberPenalty = Math.min(15, Math.floor(cyberCount / 50));
    const score = Math.min(100, risk.score + cyberPenalty);
    const factors = [...risk.factors];
    if (cyberPenalty) factors.push(`Elevated cyber threat env (${cyberCount} active high-severity IoCs in 24h)`);

    const partial: Omit<COA, 'narrative'> = {
      id: `coa-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      mission_id: missionId, name: v.name, route: v.route,
      distance_km: distance, eta_min: eta,
      risk_score: score, risk_factors: factors,
      intersected_threats: risk.intersected,
      recommendation: v.recommendation,
      generated_at: new Date().toISOString(),
    };
    const narrative = await generateNarrative(input, partial);
    const coa: COA = { ...partial, narrative };

    await pool.query(
      `INSERT INTO coas(id,mission_id,name,route,distance_km,eta_min,risk_score,risk_factors,intersected_threats,narrative,recommendation)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [coa.id, coa.mission_id, coa.name, coa.route, coa.distance_km, coa.eta_min,
       coa.risk_score, coa.risk_factors, coa.intersected_threats, coa.narrative, coa.recommendation]);

    try { await producer.send({ topic: 'mission.coa.generated', messages: [{ key: coa.id, value: JSON.stringify(coa) }] }); }
    catch {}
    coas.push(coa);
  }
  // Sort: PRIMARY by lowest risk
  coas.sort((a,b) => a.risk_score - b.risk_score);
  return coas;
}

const app = express();
app.use(express.json());
app.get('/health', (_q, r) => r.json({ status: 'ok', service: 'mission-planning-service' }));

app.post('/missions/plan', async (req, res) => {
  try {
    const input = req.body as MissionInput;
    if (!input?.start || !input?.end || !input?.objective) {
      return res.status(400).json({ error: 'objective, start{lat,lon}, end{lat,lon} required' });
    }
    const coas = await generateCOAs(input);
    res.json({ mission_id: coas[0]?.mission_id, coas });
  } catch (err: any) {
    logger.error({ err: err.message }, 'planning failed');
    res.status(500).json({ error: err.message });
  }
});

app.get('/missions/:id', async (req, res) => {
  const m = await pool.query('SELECT * FROM missions WHERE id=$1', [req.params.id]);
  if (!m.rowCount) return res.status(404).json({ error: 'not found' });
  const c = await pool.query('SELECT * FROM coas WHERE mission_id=$1 ORDER BY risk_score', [req.params.id]);
  res.json({ mission: m.rows[0], coas: c.rows });
});

app.get('/missions', async (_q, res) => {
  const r = await pool.query('SELECT id,objective,created_at FROM missions ORDER BY created_at DESC LIMIT 100');
  res.json({ count: r.rowCount, missions: r.rows });
});

async function main() {
  await initSchema();
  await producer.connect().catch((e) => logger.warn({ err: e.message }, 'kafka connect failed'));
  app.listen(PORT, () => logger.info({ port: PORT }, 'mission-planning-service listening'));
}
main().catch((err) => { logger.error({ err }, 'startup failed'); process.exit(1); });

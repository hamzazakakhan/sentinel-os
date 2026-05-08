// Threat Intelligence service: STIX/TAXII 2.1, MITRE ATT&CK, abuse.ch
import express from 'express';
import axios from 'axios';
import { Kafka, logLevel } from 'kafkajs';
import pino from 'pino';
import pg from 'pg';
import { CronJob } from 'cron';

const logger = pino({ name: 'threat-intel-service' });
const PORT = parseInt(process.env.PORT || '8091', 10);
const KAFKA_BROKER = process.env.KAFKA_BROKERS || 'localhost:9092';
const PG_URL = process.env.DATABASE_URL || 'postgres://sentinel:sentinel@localhost:5432/sentinel';

interface Indicator {
  id: string;
  type: 'ipv4'|'ipv6'|'domain'|'url'|'hash-md5'|'hash-sha1'|'hash-sha256'|'email'|'cve'|'mitre-technique';
  value: string; source: string; confidence: number;
  severity: 'low'|'medium'|'high'|'critical';
  tags: string[]; first_seen: string; last_seen: string;
  description?: string; mitre_techniques?: string[];
}

const pool = new pg.Pool({ connectionString: PG_URL, max: 10 });

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS threat_indicators (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, value TEXT NOT NULL,
      source TEXT NOT NULL, confidence INT NOT NULL, severity TEXT NOT NULL,
      tags TEXT[] DEFAULT '{}', mitre_techniques TEXT[] DEFAULT '{}',
      description TEXT, first_seen TIMESTAMPTZ NOT NULL, last_seen TIMESTAMPTZ NOT NULL, raw JSONB);
    CREATE INDEX IF NOT EXISTS idx_indicators_value ON threat_indicators(value);
    CREATE INDEX IF NOT EXISTS idx_indicators_type ON threat_indicators(type);
    CREATE INDEX IF NOT EXISTS idx_indicators_last_seen ON threat_indicators(last_seen DESC);
    CREATE TABLE IF NOT EXISTS mitre_techniques (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, tactic TEXT, description TEXT,
      platforms TEXT[], data_sources TEXT[], detection TEXT, mitigation TEXT, url TEXT);
  `);
  logger.info('Postgres schema ready');
}

async function upsertIndicator(ioc: Indicator, raw: unknown) {
  await pool.query(
    `INSERT INTO threat_indicators(id,type,value,source,confidence,severity,tags,mitre_techniques,description,first_seen,last_seen,raw)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT(id) DO UPDATE SET last_seen=EXCLUDED.last_seen,
       confidence=GREATEST(threat_indicators.confidence,EXCLUDED.confidence),
       tags=ARRAY(SELECT DISTINCT unnest(threat_indicators.tags||EXCLUDED.tags))`,
    [ioc.id,ioc.type,ioc.value,ioc.source,ioc.confidence,ioc.severity,ioc.tags,
     ioc.mitre_techniques??[],ioc.description,ioc.first_seen,ioc.last_seen,raw]);
}

async function upsertMitre(t: any) {
  await pool.query(
    `INSERT INTO mitre_techniques(id,name,tactic,description,platforms,data_sources,detection,mitigation,url)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description`,
    [t.id,t.name,t.tactic,t.description,t.platforms??[],t.data_sources??[],t.detection,t.mitigation,t.url]);
}

const kafka = new Kafka({ brokers:[KAFKA_BROKER], clientId:'threat-intel-service', logLevel:logLevel.WARN });
const producer = kafka.producer();
async function publishIoC(ioc: Indicator) {
  try { await producer.send({ topic:'threat.intel.iocs', messages:[{ key:ioc.id, value:JSON.stringify(ioc) }] }); }
  catch(err){ logger.debug({err},'kafka pub failed'); }
}

// MITRE ATT&CK Enterprise STIX bundle
async function ingestMitreAttack() {
  const url = 'https://raw.githubusercontent.com/mitre/cti/master/enterprise-attack/enterprise-attack.json';
  logger.info('Fetching MITRE ATT&CK...');
  try {
    const { data } = await axios.get<any>(url, { timeout: 60_000 });
    let count = 0;
    for (const obj of (data.objects ?? [])) {
      if (obj.type !== 'attack-pattern') continue;
      const ext = (obj.external_references||[]).find((r: any) => r.external_id?.startsWith('T'));
      if (!ext?.external_id) continue;
      await upsertMitre({
        id: ext.external_id, name: obj.name ?? ext.external_id,
        tactic: obj.kill_chain_phases?.[0]?.phase_name,
        description: obj.description, platforms: obj.x_mitre_platforms,
        data_sources: obj.x_mitre_data_sources, detection: obj.x_mitre_detection, url: ext.url,
      });
      count++;
    }
    logger.info({ count }, 'MITRE ATT&CK loaded');
  } catch (err: any) { logger.warn({ err: err.message }, 'MITRE ATT&CK ingest failed'); }
}

// Abuse.ch URLhaus
async function ingestUrlhaus() {
  try {
    const { data } = await axios.get('https://urlhaus.abuse.ch/downloads/json_recent/', { timeout: 30_000 });
    let count = 0;
    for (const arr of Object.values(data) as any[]) {
      for (const e of arr) {
        if (!e?.url) continue;
        const ioc: Indicator = {
          id: `urlhaus-${e.id}`, type: 'url', value: e.url, source: 'abuse.ch/urlhaus',
          confidence: 90, severity: e.threat === 'malware_download' ? 'high' : 'medium',
          tags: [e.threat, ...(e.tags ?? [])].filter(Boolean),
          first_seen: e.dateadded ? new Date(e.dateadded).toISOString() : new Date().toISOString(),
          last_seen: new Date().toISOString(), description: `Malware URL: ${e.threat}`,
        };
        await upsertIndicator(ioc, e); await publishIoC(ioc); count++;
      }
    }
    logger.info({ count }, 'URLhaus ingested');
  } catch (err: any) { logger.warn({ err: err.message }, 'URLhaus failed'); }
}

// Abuse.ch Feodo Tracker
async function ingestFeodoTracker() {
  try {
    const { data } = await axios.get('https://feodotracker.abuse.ch/downloads/ipblocklist.json', { timeout: 30_000 });
    let count = 0;
    for (const e of data as any[]) {
      if (!e?.ip_address) continue;
      const ioc: Indicator = {
        id: `feodo-${e.ip_address}`, type: 'ipv4', value: e.ip_address, source: 'abuse.ch/feodo',
        confidence: 85, severity: 'high', tags: ['c2','botnet', e.malware].filter(Boolean),
        first_seen: e.first_seen ? new Date(e.first_seen).toISOString() : new Date().toISOString(),
        last_seen: e.last_online ? new Date(e.last_online).toISOString() : new Date().toISOString(),
        description: `Botnet C2: ${e.malware ?? 'unknown'}`,
      };
      await upsertIndicator(ioc, e); await publishIoC(ioc); count++;
    }
    logger.info({ count }, 'Feodo C2 IPs ingested');
  } catch (err: any) { logger.warn({ err: err.message }, 'Feodo failed'); }
}

// Abuse.ch ThreatFox (file hashes / domains / IPs)
async function ingestThreatFox() {
  try {
    const { data } = await axios.post('https://threatfox-api.abuse.ch/api/v1/',
      { query: 'get_iocs', days: 1 }, { timeout: 30_000 });
    let count = 0;
    for (const e of (data?.data ?? []) as any[]) {
      if (!e?.ioc) continue;
      const t = e.ioc_type as string;
      const map: Record<string, Indicator['type']> = {
        'ip:port': 'ipv4', 'domain': 'domain', 'url': 'url',
        'md5_hash': 'hash-md5', 'sha1_hash': 'hash-sha1', 'sha256_hash': 'hash-sha256',
      };
      const type = map[t]; if (!type) continue;
      const value = type === 'ipv4' ? String(e.ioc).split(':')[0] : e.ioc;
      const ioc: Indicator = {
        id: `threatfox-${e.id}`, type, value, source: 'abuse.ch/threatfox',
        confidence: e.confidence_level ?? 75, severity: 'high',
        tags: [e.malware, e.threat_type].filter(Boolean),
        first_seen: e.first_seen ? new Date(e.first_seen).toISOString() : new Date().toISOString(),
        last_seen: e.last_seen ? new Date(e.last_seen).toISOString() : new Date().toISOString(),
        description: `${e.threat_type}: ${e.malware ?? ''}`,
      };
      await upsertIndicator(ioc, e); await publishIoC(ioc); count++;
    }
    logger.info({ count }, 'ThreatFox IoCs ingested');
  } catch (err: any) { logger.warn({ err: err.message }, 'ThreatFox failed'); }
}

// Generic STIX/TAXII 2.1 collection poller
async function ingestTaxii(base: string, collectionId: string, source: string, auth?: string) {
  try {
    const headers: any = { 'Accept': 'application/taxii+json;version=2.1' };
    if (auth) headers.Authorization = auth;
    const { data } = await axios.get(`${base}/collections/${collectionId}/objects/`, { headers, timeout: 30_000 });
    let count = 0;
    for (const obj of (data.objects ?? []) as any[]) {
      if (obj.type !== 'indicator' || !obj.pattern) continue;
      const m = obj.pattern.match(/\[(\S+?):value\s*=\s*'([^']+)'\]/);
      if (!m) continue;
      const stixType = m[1]; const value = m[2];
      const tmap: Record<string, Indicator['type']> = {
        'ipv4-addr': 'ipv4', 'ipv6-addr': 'ipv6', 'domain-name': 'domain',
        'url': 'url', 'email-addr': 'email',
      };
      let type = tmap[stixType];
      if (!type) {
        const hm = obj.pattern.match(/\[file:hashes\.['"]?([A-Z0-9-]+)['"]?\s*=\s*'([^']+)'\]/);
        if (hm) { type = `hash-${hm[1].toLowerCase().replace('sha-','sha')}` as any; }
      }
      if (!type) continue;
      const ioc: Indicator = {
        id: obj.id, type, value, source, confidence: obj.confidence ?? 60,
        severity: 'medium', tags: obj.labels ?? [],
        first_seen: obj.created ?? new Date().toISOString(),
        last_seen: obj.modified ?? new Date().toISOString(),
        description: obj.description,
      };
      await upsertIndicator(ioc, obj); await publishIoC(ioc); count++;
    }
    logger.info({ count, source }, 'TAXII collection ingested');
  } catch (err: any) { logger.warn({ err: err.message, source }, 'TAXII ingest failed'); }
}

// HTTP API
const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'threat-intel-service' }));

app.get('/indicators', async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? '100'), 10), 1000);
  const type = req.query.type as string | undefined;
  const sev = req.query.severity as string | undefined;
  const where: string[] = []; const params: any[] = [];
  if (type) { params.push(type); where.push(`type=$${params.length}`); }
  if (sev) { params.push(sev); where.push(`severity=$${params.length}`); }
  params.push(limit);
  const sql = `SELECT id,type,value,source,confidence,severity,tags,mitre_techniques,description,first_seen,last_seen
               FROM threat_indicators ${where.length?'WHERE '+where.join(' AND '):''}
               ORDER BY last_seen DESC LIMIT $${params.length}`;
  const r = await pool.query(sql, params);
  res.json({ count: r.rowCount, indicators: r.rows });
});

app.get('/indicators/lookup/:value', async (req, res) => {
  const r = await pool.query('SELECT * FROM threat_indicators WHERE value=$1', [req.params.value]);
  res.json({ matches: r.rowCount, indicators: r.rows });
});

app.get('/mitre/techniques', async (req, res) => {
  const tactic = req.query.tactic as string | undefined;
  const r = tactic
    ? await pool.query('SELECT * FROM mitre_techniques WHERE tactic=$1 ORDER BY id', [tactic])
    : await pool.query('SELECT * FROM mitre_techniques ORDER BY id');
  res.json({ count: r.rowCount, techniques: r.rows });
});

app.get('/mitre/techniques/:id', async (req, res) => {
  const r = await pool.query('SELECT * FROM mitre_techniques WHERE id=$1', [req.params.id]);
  if (!r.rowCount) return res.status(404).json({ error: 'not found' });
  res.json(r.rows[0]);
});

app.post('/ingest/now', async (_req, res) => {
  res.json({ started: true });
  void ingestUrlhaus(); void ingestFeodoTracker(); void ingestThreatFox();
});

// Boot
async function main() {
  await initSchema();
  await producer.connect().catch((e) => logger.warn({ err: e.message }, 'kafka connect failed'));
  // Initial ingest
  void ingestMitreAttack();
  void ingestUrlhaus(); void ingestFeodoTracker(); void ingestThreatFox();
  // Schedule
  new CronJob('0 */15 * * * *', () => { void ingestUrlhaus(); void ingestFeodoTracker(); void ingestThreatFox(); }).start();
  new CronJob('0 0 4 * * *', () => { void ingestMitreAttack(); }).start();
  // Optional TAXII feeds via env
  const taxiiBase = process.env.TAXII_BASE_URL;
  const taxiiColl = process.env.TAXII_COLLECTION_ID;
  if (taxiiBase && taxiiColl) {
    new CronJob('0 0 */1 * * *', () => {
      void ingestTaxii(taxiiBase, taxiiColl, 'taxii', process.env.TAXII_AUTH);
    }).start();
  }
  app.listen(PORT, () => logger.info({ port: PORT }, 'threat-intel-service listening'));
}
main().catch((err) => { logger.error({ err }, 'startup failed'); process.exit(1); });

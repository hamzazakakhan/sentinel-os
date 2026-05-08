// ──────────────────────────────────────────────────────────────
// sentinel-os/services/tak-service/src/index.ts
// TAK (Team Awareness Kit) compatible CoT XML server
// Listens for Cursor-on-Target XML from ATAK/iTAK/WinTAK clients
// over UDP unicast/multicast (4242) and TCP (8087) per TAK spec.
// Publishes parsed CoT events to Kafka topic `tak.cot.events`
// and broadcasts to a WebSocket for the Sentinel HUD.
// ──────────────────────────────────────────────────────────────

import express from 'express';
import http from 'http';
import dgram from 'dgram';
import net from 'net';
import { WebSocketServer, WebSocket } from 'ws';
import { Kafka, logLevel } from 'kafkajs';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import pino from 'pino';
import Redis from 'ioredis';

const logger = pino({ name: 'tak-service' });

// ── Config ────────────────────────────────────────────────────
const HTTP_PORT = parseInt(process.env.PORT || '8090', 10);
const COT_UDP_PORT = parseInt(process.env.COT_UDP_PORT || '4242', 10);
const COT_TCP_PORT = parseInt(process.env.COT_TCP_PORT || '8087', 10);
const COT_MCAST_GROUP = process.env.COT_MCAST_GROUP || '239.2.3.1';
const KAFKA_BROKER = process.env.KAFKA_BROKERS || 'localhost:9092';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// ── CoT Event types ───────────────────────────────────────────
export interface CoTEvent {
  uid: string;
  type: string;            // e.g., a-f-G-U-C (atom-friendly-ground-unit-combat)
  how: string;             // e.g., m-g (machine-gps)
  time: string;
  start: string;
  stale: string;
  point: { lat: number; lon: number; hae: number; ce: number; le: number };
  detail?: Record<string, unknown>;
  affiliation: 'friendly' | 'hostile' | 'neutral' | 'unknown';
  dimension: 'air' | 'ground' | 'sea-surface' | 'sea-subsurface' | 'space' | 'unknown';
  callsign?: string;
  raw: string;
}

// MIL-STD-2525C affiliation field is the second char of CoT type
function parseAffiliation(type: string): CoTEvent['affiliation'] {
  const c = type.split('-')[1];
  switch (c) {
    case 'f': return 'friendly';
    case 'h': return 'hostile';
    case 'n': return 'neutral';
    default: return 'unknown';
  }
}
function parseDimension(type: string): CoTEvent['dimension'] {
  const c = type.split('-')[2];
  switch (c) {
    case 'A': return 'air';
    case 'G': return 'ground';
    case 'S': return 'sea-surface';
    case 'U': return 'sea-subsurface';
    case 'P': return 'space';
    default: return 'unknown';
  }
}

// ── XML parser ────────────────────────────────────────────────
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: true,
});
const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
});

export function parseCoT(xml: string): CoTEvent | null {
  try {
    const parsed = xmlParser.parse(xml);
    const ev = parsed?.event;
    if (!ev) return null;
    const point = ev.point || {};
    const type = String(ev['@_type'] ?? 'a-u-G');
    const detail = ev.detail || {};
    const callsign = detail?.contact?.['@_callsign'];
    return {
      uid: String(ev['@_uid'] ?? ''),
      type,
      how: String(ev['@_how'] ?? ''),
      time: String(ev['@_time'] ?? new Date().toISOString()),
      start: String(ev['@_start'] ?? new Date().toISOString()),
      stale: String(ev['@_stale'] ?? new Date(Date.now() + 60_000).toISOString()),
      point: {
        lat: Number(point['@_lat'] ?? 0),
        lon: Number(point['@_lon'] ?? 0),
        hae: Number(point['@_hae'] ?? 0),
        ce: Number(point['@_ce'] ?? 9999999),
        le: Number(point['@_le'] ?? 9999999),
      },
      detail: detail as Record<string, unknown>,
      affiliation: parseAffiliation(type),
      dimension: parseDimension(type),
      callsign: callsign ? String(callsign) : undefined,
      raw: xml,
    };
  } catch (err) {
    logger.warn({ err }, 'Failed to parse CoT XML');
    return null;
  }
}

export function buildCoT(ev: Partial<CoTEvent>): string {
  const obj = {
    event: {
      '@_version': '2.0',
      '@_uid': ev.uid,
      '@_type': ev.type ?? 'a-u-G',
      '@_how': ev.how ?? 'm-g',
      '@_time': ev.time ?? new Date().toISOString(),
      '@_start': ev.start ?? new Date().toISOString(),
      '@_stale': ev.stale ?? new Date(Date.now() + 60_000).toISOString(),
      point: {
        '@_lat': ev.point?.lat ?? 0,
        '@_lon': ev.point?.lon ?? 0,
        '@_hae': ev.point?.hae ?? 0,
        '@_ce': ev.point?.ce ?? 9999999,
        '@_le': ev.point?.le ?? 9999999,
      },
      detail: ev.detail ?? {},
    },
  };
  return '<?xml version="1.0" standalone="yes"?>\n' + xmlBuilder.build(obj);
}

// ── Storage layer (Redis: last-known position per UID) ────────
const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: true });
redis.on('error', (e) => logger.warn({ err: e.message }, 'Redis connection error'));

async function storeTrack(ev: CoTEvent) {
  try {
    if (!redis.status || redis.status === 'wait') await redis.connect().catch(() => {});
    await redis.hset(`tak:track:${ev.uid}`, {
      uid: ev.uid,
      type: ev.type,
      affiliation: ev.affiliation,
      dimension: ev.dimension,
      lat: ev.point.lat,
      lon: ev.point.lon,
      hae: ev.point.hae,
      time: ev.time,
      stale: ev.stale,
      callsign: ev.callsign ?? '',
    });
    await redis.expireat(`tak:track:${ev.uid}`, Math.floor(new Date(ev.stale).getTime() / 1000));
    await redis.sadd('tak:tracks:active', ev.uid);
  } catch (err) {
    logger.debug({ err }, 'Redis store failed (non-fatal)');
  }
}

async function listTracks(): Promise<CoTEvent[]> {
  try {
    const uids = await redis.smembers('tak:tracks:active');
    const tracks: CoTEvent[] = [];
    for (const uid of uids) {
      const data = await redis.hgetall(`tak:track:${uid}`);
      if (!data || !data.uid) {
        await redis.srem('tak:tracks:active', uid);
        continue;
      }
      tracks.push({
        uid: data.uid,
        type: data.type,
        how: '',
        time: data.time,
        start: data.time,
        stale: data.stale,
        point: { lat: Number(data.lat), lon: Number(data.lon), hae: Number(data.hae), ce: 0, le: 0 },
        affiliation: data.affiliation as CoTEvent['affiliation'],
        dimension: data.dimension as CoTEvent['dimension'],
        callsign: data.callsign || undefined,
        raw: '',
      });
    }
    return tracks;
  } catch {
    return [];
  }
}

// ── Kafka producer ────────────────────────────────────────────
const kafka = new Kafka({ brokers: [KAFKA_BROKER], clientId: 'tak-service', logLevel: logLevel.WARN });
const producer = kafka.producer();

async function publishCoT(ev: CoTEvent) {
  try {
    await producer.send({
      topic: 'tak.cot.events',
      messages: [{ key: ev.uid, value: JSON.stringify(ev) }],
    });
  } catch (err) {
    logger.debug({ err }, 'Kafka publish failed (non-fatal)');
  }
}

// ── WebSocket broadcast to HUD ────────────────────────────────
const wsClients = new Set<WebSocket>();
function broadcastToWs(ev: CoTEvent) {
  const payload = JSON.stringify({ type: 'cot', event: ev });
  for (const ws of wsClients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

// ── Common ingest pipeline ────────────────────────────────────
async function ingestCoT(xml: string, source: string) {
  const ev = parseCoT(xml);
  if (!ev || !ev.uid) return;
  logger.debug({ uid: ev.uid, source, affiliation: ev.affiliation }, 'CoT ingested');
  await storeTrack(ev);
  await publishCoT(ev);
  broadcastToWs(ev);
}

// ── UDP listener (unicast + multicast) ────────────────────────
function startUdpListener() {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  sock.on('error', (err) => logger.error({ err: err.message }, 'UDP socket error'));
  sock.on('message', (buf, rinfo) => {
    const xml = buf.toString('utf8');
    void ingestCoT(xml, `udp:${rinfo.address}:${rinfo.port}`);
  });
  sock.on('listening', () => {
    const addr = sock.address();
    logger.info({ addr }, 'CoT UDP listener bound');
    try {
      sock.addMembership(COT_MCAST_GROUP);
      logger.info({ group: COT_MCAST_GROUP }, 'Joined CoT multicast group');
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Multicast join failed (non-fatal)');
    }
  });
  sock.bind(COT_UDP_PORT);
  return sock;
}

// ── TCP listener (TAK Server compatible streaming) ────────────
function startTcpListener() {
  const server = net.createServer((socket) => {
    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      // CoT messages end with </event>; split on it
      const parts = buf.split(/<\/event>/);
      buf = parts.pop() ?? '';
      for (const part of parts) {
        const xml = part + '</event>';
        if (xml.includes('<event')) void ingestCoT(xml, `tcp:${socket.remoteAddress}`);
      }
    });
    socket.on('error', () => socket.destroy());
  });
  server.listen(COT_TCP_PORT, () => {
    logger.info({ port: COT_TCP_PORT }, 'CoT TCP listener bound');
  });
  return server;
}

// ── HTTP API + WebSocket ──────────────────────────────────────
const app = express();
app.use(express.text({ type: ['application/xml', 'text/xml', 'text/plain'], limit: '256kb' }));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'tak-service' }));

app.get('/tracks', async (_req, res) => {
  const tracks = await listTracks();
  res.json({ count: tracks.length, tracks });
});

app.post('/cot', async (req, res) => {
  const xml = typeof req.body === 'string' ? req.body : '';
  if (!xml) return res.status(400).json({ error: 'CoT XML body required' });
  await ingestCoT(xml, 'http');
  res.json({ accepted: true });
});

app.post('/cot/build', (req, res) => {
  const xml = buildCoT(req.body);
  res.set('Content-Type', 'application/xml').send(xml);
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/tak/stream' });
wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
  // Replay current tracks to new client
  void listTracks().then((tracks) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'snapshot', tracks }));
    }
  });
});

// ── Boot ──────────────────────────────────────────────────────
async function main() {
  await producer.connect().catch((err) => logger.warn({ err: err.message }, 'Kafka connect failed (continuing)'));
  startUdpListener();
  startTcpListener();
  server.listen(HTTP_PORT, () => {
    logger.info({ port: HTTP_PORT }, 'TAK service HTTP/WebSocket listening');
  });
}

main().catch((err) => {
  logger.error({ err }, 'TAK service failed to start');
  process.exit(1);
});

process.on('SIGTERM', () => {
  void producer.disconnect();
  process.exit(0);
});

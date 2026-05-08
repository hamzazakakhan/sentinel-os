// Link 16 J-series Message Service
// Implements MIL-STD-6016 J-message structure for terminal-to-terminal C2.
// Generates and parses J-series tactical data messages used by NATO/US:
//   J2.0  Indirect PPLI (Precise Participant Location & ID)
//   J2.2  Air PPLI
//   J2.3  Surface PPLI
//   J2.4  Subsurface PPLI
//   J2.5  Land Point/Track
//   J3.0  Reference Point
//   J3.2  Air Track
//   J3.3  Surface Track
//   J3.5  Land Track
//   J3.7  Electronic Warfare PPLI
//   J7.0  Track Management
//   J12.0 Mission Assignment
//   J12.6 Target Sorting
import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { Kafka, logLevel } from 'kafkajs';
import pino from 'pino';

const logger = pino({ name: 'link16-service' });
const PORT = parseInt(process.env.PORT || '8098', 10);
const KAFKA_BROKER = process.env.KAFKA_BROKERS || 'localhost:9092';

// J-series message catalog
export const JMESSAGES: Record<string, { name: string; description: string; words: string[] }> = {
  'J2.0': { name: 'Indirect PPLI', description: 'Indirect precise participant location and identification', words: ['header','position','altitude','course','speed','platform_type'] },
  'J2.2': { name: 'Air PPLI', description: 'Direct air platform PPLI', words: ['header','position','altitude','course','speed','mission'] },
  'J2.3': { name: 'Surface PPLI', description: 'Surface vessel PPLI', words: ['header','position','course','speed','vessel_type'] },
  'J2.5': { name: 'Land Point/Track', description: 'Ground unit position', words: ['header','position','category','strength'] },
  'J3.2': { name: 'Air Track', description: 'Air track report', words: ['track_num','position','altitude','course','speed','iff','threat'] },
  'J3.3': { name: 'Surface Track', description: 'Surface vessel track', words: ['track_num','position','course','speed','classification'] },
  'J3.5': { name: 'Land Track', description: 'Ground vehicle/unit track', words: ['track_num','position','classification','strength'] },
  'J3.7': { name: 'EW PPLI', description: 'Electronic warfare emitter location', words: ['emitter_id','position','frequency_mhz','emission_type','threat_priority'] },
  'J7.0': { name: 'Track Management', description: 'Track correlation/management', words: ['action','track_num','source_track_num'] },
  'J12.0': { name: 'Mission Assignment', description: 'Tactical mission tasking', words: ['mission_id','assignee','task_type','priority','target_track'] },
  'J12.6': { name: 'Target Sorting', description: 'Target assignment to weapons', words: ['target_track','weapon_id','engagement_status'] },
};

interface JMessage {
  id: string;
  label: string;       // e.g., 'J3.2'
  source_track: number;
  recipient?: number;
  timestamp: string;
  fields: Record<string, any>;
  raw_hex?: string;
}

const messageHistory: JMessage[] = [];
const MAX_HISTORY = 5000;

// Encode as 70-bit J-word group → hex (simplified: pack fields as JSON, hex)
function encodeJ(msg: Omit<JMessage, 'raw_hex'>): string {
  const json = JSON.stringify(msg);
  return Buffer.from(json, 'utf8').toString('hex');
}
function decodeJ(hex: string): JMessage | null {
  try {
    const json = Buffer.from(hex, 'hex').toString('utf8');
    const parsed = JSON.parse(json) as JMessage;
    parsed.raw_hex = hex; return parsed;
  } catch { return null; }
}

// Kafka pub/sub
const kafka = new Kafka({ brokers: [KAFKA_BROKER], clientId: 'link16-service', logLevel: logLevel.WARN });
const producer = kafka.producer();
async function publish(msg: JMessage) {
  try { await producer.send({ topic: 'link16.messages', messages: [{ key: msg.label, value: JSON.stringify(msg) }] }); }
  catch (err) { logger.debug({ err }, 'kafka pub failed'); }
}

// WebSocket broadcast
const wsClients = new Set<WebSocket>();
function broadcast(msg: JMessage) {
  const p = JSON.stringify({ type: 'message', message: msg });
  for (const ws of wsClients) if (ws.readyState === WebSocket.OPEN) ws.send(p);
}

const app = express();
app.use(express.json());
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/link16/stream' });
wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
  ws.send(JSON.stringify({ type: 'snapshot', messages: messageHistory.slice(-200) }));
});

app.get('/health', (_q, r) => r.json({ status: 'ok', service: 'link16-service', supported_messages: Object.keys(JMESSAGES) }));
app.get('/messages/catalog', (_q, r) => r.json(JMESSAGES));
app.get('/messages', (req, r) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? '200'), 10), MAX_HISTORY);
  r.json({ count: messageHistory.length, messages: messageHistory.slice(-limit).reverse() });
});

// Submit a J-message
app.post('/messages', async (req, res) => {
  const { label, source_track, recipient, fields } = req.body;
  if (!label || !JMESSAGES[label]) return res.status(400).json({ error: `unknown J-label, must be one of ${Object.keys(JMESSAGES).join(', ')}` });
  const msg: JMessage = {
    id: `j-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    label, source_track: source_track ?? 0o7777, recipient,
    timestamp: new Date().toISOString(), fields: fields ?? {},
  };
  msg.raw_hex = encodeJ(msg);
  messageHistory.push(msg); if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
  await publish(msg); broadcast(msg);
  res.json(msg);
});

app.post('/messages/decode', (req, res) => {
  const hex = req.body?.hex; if (!hex) return res.status(400).json({ error: 'hex required' });
  const m = decodeJ(hex); if (!m) return res.status(400).json({ error: 'decode failed' });
  res.json(m);
});

async function main() {
  await producer.connect().catch((e) => logger.warn({ err: e.message }, 'kafka connect failed'));
  server.listen(PORT, () => logger.info({ port: PORT, j_messages: Object.keys(JMESSAGES).length }, 'link16-service listening'));
}
main().catch((err) => { logger.error({ err }, 'startup failed'); process.exit(1); });

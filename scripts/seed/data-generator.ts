#!/usr/bin/env tsx
// ============================================================================
// Sentinel OS — Synthetic Data Generator
// Produces continuous realistic events across all domains for live demos
// Run: npx tsx scripts/seed/data-generator.ts
// ============================================================================

import { Kafka, Producer } from 'kafkajs';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const TICK_MS = parseInt(process.env.TICK_MS || '3000', 10);

const pgPool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432', 10),
  database: process.env.PG_DATABASE || 'sentinel',
  user: process.env.PG_USER || 'sentinel_admin',
  password: process.env.PG_PASSWORD || 'sentinel_pass',
});

const kafka = new Kafka({ clientId: 'data-generator', brokers: KAFKA_BROKERS });

// ── Synthetic data pools ────────────────────────────────────────────────────

const THREAT_IPS = [
  '185.220.101.34', '45.155.205.189', '91.219.236.174', '103.75.190.42',
  '194.26.29.65', '45.61.136.130', '198.98.54.81', '89.248.174.166',
  '5.188.206.18', '212.70.149.34',
];

const INTERNAL_IPS = [
  '10.0.1.50', '10.0.2.15', '10.0.3.1', '10.0.4.22', '10.0.5.10',
  '10.0.1.80', '10.0.6.33', '10.0.7.12', '10.0.8.5', '10.0.9.100',
];

const IDS_SIGNATURES = [
  { sid: 2024001, sig: 'ET EXPLOIT CVE-2024-1234 RCE Attempt', cat: 'Exploit', sev: 'CRITICAL' },
  { sid: 2009582, sig: 'ET SCAN Nmap SYN Scan', cat: 'Scan', sev: 'MEDIUM' },
  { sid: 2003068, sig: 'ET SCAN SSH Brute Force Attempt', cat: 'Brute Force', sev: 'HIGH' },
  { sid: 2019408, sig: 'ET WEB_SERVER SQL Injection Attempt', cat: 'Web Attack', sev: 'HIGH' },
  { sid: 2027863, sig: 'ET DNS Possible DNS Tunnel', cat: 'Anomaly', sev: 'HIGH' },
  { sid: 2024050, sig: 'MALWARE-CNC Cobalt Strike Beacon', cat: 'Malware', sev: 'CRITICAL' },
  { sid: 2030001, sig: 'ET POLICY Large Outbound Transfer', cat: 'Exfiltration', sev: 'HIGH' },
  { sid: 2100498, sig: 'GPL ATTACK_RESPONSE id check returned root', cat: 'Exploit', sev: 'CRITICAL' },
];

const DETECTION_TYPES = ['PERSON', 'VEHICLE', 'AIRCRAFT', 'VESSEL', 'UAV', 'WEAPON', 'ANOMALY'];
const DOMAINS = ['LAND', 'AIR', 'SEA', 'CYBER', 'SPACE'];
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

const SENSOR_IDS = [
  'sen-cam-001', 'sen-cam-002', 'sen-cam-003', 'sen-rad-001', 'sen-rad-002',
  'sen-rad-003', 'sen-iot-001', 'sen-iot-002', 'sen-iot-003', 'sen-drn-001',
  'sen-drn-003', 'sen-sonar-001', 'sen-net-001', 'sen-net-002', 'sen-net-003',
];

const BASE_LAT = 38.8977;
const BASE_LON = -77.0365;

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(min: number, max: number): number { return Math.random() * (max - min) + min; }
function randInt(min: number, max: number): number { return Math.floor(rand(min, max)); }
function jitter(base: number, amount: number): number { return base + (Math.random() - 0.5) * amount; }

// ── Event generators ────────────────────────────────────────────────────────

function generateDetection(): Record<string, any> {
  const type = pick(DETECTION_TYPES);
  const domain = type === 'AIRCRAFT' || type === 'UAV' ? 'AIR'
    : type === 'VESSEL' ? 'SEA'
    : type === 'ANOMALY' ? pick(['LAND', 'CYBER'])
    : 'LAND';
  const sensorPool = SENSOR_IDS.filter(s => {
    if (domain === 'AIR') return s.includes('rad') || s.includes('drn');
    if (domain === 'SEA') return s.includes('rad-003') || s.includes('sonar');
    if (domain === 'CYBER') return s.includes('net');
    return s.includes('cam') || s.includes('iot') || s.includes('drn');
  });

  return {
    id: `det-gen-${randomUUID().slice(0, 8)}`,
    organizationId: 'org-alpha-001',
    sensorId: pick(sensorPool),
    detectionType: type,
    domain,
    confidence: parseFloat(rand(0.65, 0.99).toFixed(2)),
    latitude: domain !== 'CYBER' ? jitter(BASE_LAT, 0.02) : null,
    longitude: domain !== 'CYBER' ? jitter(BASE_LON, 0.02) : null,
    metadata: generateDetectionMeta(type, domain),
    classification: pick(['CONFIDENTIAL', 'SECRET']),
    timestamp: new Date().toISOString(),
  };
}

function generateDetectionMeta(type: string, domain: string): Record<string, any> {
  switch (type) {
    case 'PERSON': return { model: 'yolov8x', bbox: [randInt(0,400), randInt(0,400), randInt(100,600), randInt(100,600)], speed_mph: rand(0, 8).toFixed(1), direction: pick(['N','NE','E','SE','S','SW','W','NW']) };
    case 'VEHICLE': return { model: 'yolov8x', label: pick(['sedan','suv','truck','van']), color: pick(['black','white','gray','red','blue']), speed_mph: rand(5, 60).toFixed(0) };
    case 'AIRCRAFT': return { type: pick(['fixed_wing','rotary_wing']), altitude_ft: randInt(1000, 35000), speed_kts: randInt(80, 350), heading: randInt(0, 360), squawk: String(randInt(1000, 7777)) };
    case 'UAV': return { type: 'small_uas', altitude_ft: randInt(100, 500), speed_kts: randInt(10, 40), rf_signature: pick(['2.4GHz','5.8GHz','900MHz']), heading: randInt(0, 360) };
    case 'VESSEL': return { type: pick(['small_craft','cargo','fishing']), speed_kts: randInt(3, 25), heading: randInt(0, 360), length_m: randInt(5, 200), ais: Math.random() > 0.3 };
    case 'WEAPON': return { model: 'yolov8x', label: pick(['rifle','handgun','knife']), associated_person: `det-gen-${randomUUID().slice(0,8)}` };
    case 'ANOMALY': return domain === 'CYBER'
      ? { model: 'isolation_forest', anomaly_score: rand(-1, -0.5).toFixed(2), feature: pick(['bytes_out','port_entropy','dns_queries','connection_rate']) }
      : { model: 'isolation_forest', anomaly_score: rand(-1, -0.5).toFixed(2), type: pick(['seismic','thermal','acoustic','magnetic']) };
    default: return {};
  }
}

function generateCyberEvent(): Record<string, any> {
  const sig = pick(IDS_SIGNATURES);
  return {
    id: `cev-gen-${randomUUID().slice(0, 8)}`,
    organizationId: 'org-bravo-002',
    eventType: pick(['IDS_ALERT', 'C2_BEACON', 'BRUTE_FORCE', 'PORT_SCAN', 'DNS_TUNNEL', 'MALWARE']),
    severity: sig.sev,
    sourceIp: Math.random() > 0.3 ? pick(THREAT_IPS) : pick(INTERNAL_IPS),
    destinationIp: pick(INTERNAL_IPS),
    destinationPort: pick([22, 80, 443, 8080, 3389, 53, 445, 135]),
    protocol: pick(['TCP', 'UDP', 'ICMP']),
    signature: sig.sig,
    signatureId: sig.sid,
    category: sig.cat,
    bytesIn: randInt(100, 50000),
    bytesOut: randInt(50, 10000),
    classification: 'SECRET',
    timestamp: new Date().toISOString(),
  };
}

function generateAlert(detection: Record<string, any>): Record<string, any> | null {
  if (detection.confidence < 0.80 && detection.detectionType !== 'WEAPON') return null;
  if (Math.random() > 0.4) return null;

  const sevMap: Record<string, string> = { WEAPON: 'CRITICAL', UAV: 'HIGH', ANOMALY: 'MEDIUM', VESSEL: 'HIGH', AIRCRAFT: 'MEDIUM' };
  const severity = sevMap[detection.detectionType] || pick(SEVERITIES);

  const titles: Record<string, string[]> = {
    PERSON: ['Unauthorized individual detected in restricted zone', 'Person detected in exclusion area', 'Individual observed near perimeter'],
    VEHICLE: ['Unregistered vehicle in controlled area', 'Suspicious vehicle movement detected', 'Vehicle breached checkpoint'],
    WEAPON: ['Armed individual detected', 'Weapon identified by AI detection system', 'Threat object (weapon) detected'],
    UAV: ['Unauthorized UAV in restricted airspace', 'Drone incursion detected', 'Small UAS violated no-fly zone'],
    VESSEL: ['Unidentified vessel in restricted waters', 'Ship approaching without AIS', 'Maritime contact on intercept course'],
    AIRCRAFT: ['Unknown aircraft in controlled airspace', 'Unresponsive aircraft detected', 'Aircraft squawking emergency'],
    ANOMALY: ['Anomalous sensor reading detected', 'AI model flagged abnormal pattern', 'Statistical anomaly in sensor telemetry'],
  };

  return {
    id: `alt-gen-${randomUUID().slice(0, 8)}`,
    organizationId: detection.organizationId,
    title: pick(titles[detection.detectionType] || titles.ANOMALY),
    description: `Automated alert generated from ${detection.detectionType} detection by sensor ${detection.sensorId}. Confidence: ${detection.confidence}. ${detection.domain} domain.`,
    severity,
    domain: detection.domain,
    status: 'OPEN',
    sourceDetectionId: detection.id,
    latitude: detection.latitude,
    longitude: detection.longitude,
    classification: detection.classification,
    timestamp: new Date().toISOString(),
  };
}

function generateCyberAlert(event: Record<string, any>): Record<string, any> | null {
  if (event.severity !== 'CRITICAL' && Math.random() > 0.3) return null;

  return {
    id: `alt-gen-${randomUUID().slice(0, 8)}`,
    organizationId: event.organizationId,
    title: `${event.signature}`,
    description: `IDS alert: ${event.category}. Source: ${event.sourceIp} → ${event.destinationIp}:${event.destinationPort}/${event.protocol}. Bytes: ${event.bytesIn}/${event.bytesOut}.`,
    severity: event.severity,
    domain: 'CYBER',
    status: 'OPEN',
    classification: event.classification,
    timestamp: new Date().toISOString(),
  };
}

function generateSensorHeartbeat(): Record<string, any> {
  const sensorId = pick(SENSOR_IDS);
  return {
    sensorId,
    status: Math.random() > 0.05 ? 'ONLINE' : pick(['DEGRADED', 'OFFLINE']),
    metrics: {
      cpu: rand(10, 85).toFixed(1),
      memory: rand(30, 80).toFixed(1),
      dataRate: rand(1, 200).toFixed(1),
      uptime_hours: randInt(1, 720),
      temperature_c: rand(25, 55).toFixed(1),
    },
    timestamp: new Date().toISOString(),
  };
}

// ── Main loop ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const producer: Producer = kafka.producer();
  await producer.connect();
  console.log('Data generator connected to Kafka');

  let tick = 0;

  const interval = setInterval(async () => {
    tick++;
    try {
      const messages: { topic: string; messages: { key: string; value: string }[] }[] = [];

      // Every tick: sensor heartbeats
      const heartbeat = generateSensorHeartbeat();
      messages.push({
        topic: 'sentinel.ingestion.sensor-telemetry',
        messages: [{ key: heartbeat.sensorId, value: JSON.stringify(heartbeat) }],
      });

      // Every tick: physical detection
      const detection = generateDetection();
      messages.push({
        topic: 'sentinel.detections.raw',
        messages: [{ key: detection.id, value: JSON.stringify(detection) }],
      });

      // Write detection to PG
      try {
        await pgPool.query(
          `INSERT INTO detections (id, organization_id, sensor_id, detection_type, domain, confidence, latitude, longitude, metadata, classification)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
          [detection.id, detection.organizationId, detection.sensorId, detection.detectionType,
           detection.domain, detection.confidence, detection.latitude, detection.longitude,
           JSON.stringify(detection.metadata), detection.classification],
        );
      } catch { /* table may not exist yet */ }

      // Maybe generate alert from detection
      const alert = generateAlert(detection);
      if (alert) {
        messages.push({
          topic: 'sentinel.alerts.new',
          messages: [{ key: alert.id, value: JSON.stringify(alert) }],
        });
        try {
          await pgPool.query(
            `INSERT INTO alerts (id, organization_id, title, description, severity, domain, status, source_detection_id, latitude, longitude, classification)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
            [alert.id, alert.organizationId, alert.title, alert.description, alert.severity,
             alert.domain, alert.status, alert.sourceDetectionId, alert.latitude, alert.longitude,
             alert.classification],
          );
        } catch { /* table may not exist yet */ }
      }

      // Every 2nd tick: cyber event
      if (tick % 2 === 0) {
        const cyberEvt = generateCyberEvent();
        messages.push({
          topic: 'sentinel.cyber.raw-events',
          messages: [{ key: cyberEvt.id, value: JSON.stringify(cyberEvt) }],
        });

        try {
          await pgPool.query(
            `INSERT INTO cyber_events (id, organization_id, event_type, severity, source_ip, destination_ip, destination_port, protocol, signature, raw_data, classification)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
            [cyberEvt.id, cyberEvt.organizationId, cyberEvt.eventType, cyberEvt.severity,
             cyberEvt.sourceIp, cyberEvt.destinationIp, cyberEvt.destinationPort,
             cyberEvt.protocol, cyberEvt.signature, JSON.stringify(cyberEvt), cyberEvt.classification],
          );
        } catch { /* table may not exist yet */ }

        const cyberAlert = generateCyberAlert(cyberEvt);
        if (cyberAlert) {
          messages.push({
            topic: 'sentinel.alerts.new',
            messages: [{ key: cyberAlert.id, value: JSON.stringify(cyberAlert) }],
          });
          try {
            await pgPool.query(
              `INSERT INTO alerts (id, organization_id, title, description, severity, domain, status, classification)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
              [cyberAlert.id, cyberAlert.organizationId, cyberAlert.title, cyberAlert.description,
               cyberAlert.severity, cyberAlert.domain, cyberAlert.status, cyberAlert.classification],
            );
          } catch { /* table may not exist yet */ }
        }
      }

      // Send all to Kafka
      for (const batch of messages) {
        try {
          await producer.send(batch);
        } catch { /* kafka may not be running */ }
      }

      // Log summary
      const alertCount = alert ? 1 : 0;
      const cyberCount = tick % 2 === 0 ? 1 : 0;
      console.log(
        `[tick ${tick}] det:${detection.detectionType}/${detection.domain} conf:${detection.confidence} ` +
        `alerts:${alertCount} cyber:${cyberCount} sensor:${heartbeat.sensorId}:${heartbeat.status}`,
      );
    } catch (err: any) {
      console.error(`[tick ${tick}] Error: ${err.message}`);
    }
  }, TICK_MS);

  process.on('SIGINT', async () => {
    clearInterval(interval);
    await producer.disconnect();
    await pgPool.end();
    console.log('\nData generator stopped');
    process.exit(0);
  });

  console.log(`Generating synthetic data every ${TICK_MS}ms — press Ctrl+C to stop`);
}

main().catch(console.error);

// ──────────────────────────────────────────────────────────────
// sentinel-os/services/cyber-service/src/ids/suricata.ts
// Suricata IDS integration — rule management and alert ingestion
// ──────────────────────────────────────────────────────────────

import { EventEmitter } from 'events';
import { createReadStream, watchFile } from 'fs';
import { createInterface } from 'readline';
import path from 'path';
import { Kafka } from 'kafkajs';
import { pino } from 'pino';

const logger = pino({ name: 'suricata-ids' });

const KAFKA_BROKER = process.env.KAFKA_BROKERS || 'localhost:9092';
const EVE_JSON_PATH = process.env.SURICATA_EVE_JSON || '/var/log/suricata/eve.json';
const TOPIC_RAW = 'sentinel.cyber.raw-events';
const TOPIC_IOC = 'sentinel.cyber.threat-indicators';

export interface SuricataAlert {
  timestamp: string;
  event_type: string;
  src_ip: string;
  src_port: number;
  dest_ip: string;
  dest_port: number;
  proto: string;
  alert: {
    action: string;
    gid: number;
    signature_id: number;
    rev: number;
    signature: string;
    category: string;
    severity: number;
  };
  flow_id: number;
  pcap_filename?: string;
}

export interface SuricataDns {
  timestamp: string;
  event_type: 'dns';
  src_ip: string;
  dest_ip: string;
  dns: {
    type: string;
    id: number;
    rrname: string;
    rrtype: string;
    rdata?: string;
    ttl?: number;
  };
}

export interface SuricataHttp {
  timestamp: string;
  event_type: 'http';
  src_ip: string;
  src_port: number;
  dest_ip: string;
  dest_port: number;
  http: {
    hostname: string;
    url: string;
    http_user_agent?: string;
    http_method: string;
    protocol: string;
    status?: number;
    length?: number;
  };
}

export class SuricataIDS extends EventEmitter {
  private kafka: Kafka;
  private watching: boolean = false;
  private lastLine: number = 0;

  constructor() {
    super();
    this.kafka = new Kafka({ brokers: [KAFKA_BROKER] });
  }

  async start(): Promise<void> {
    logger.info('Starting Suricata IDS monitor on %s', EVE_JSON_PATH);
    this.watching = true;
    this.tailEveJson();
  }

  stop(): void {
    this.watching = false;
    logger.info('Suricata IDS monitor stopped');
  }

  private async tailEveJson(): Promise<void> {
    const producer = this.kafka.producer();
    await producer.connect();

    try {
      const stream = createReadStream(EVE_JSON_PATH, { encoding: 'utf-8' });
      const rl = createInterface({ input: stream, crlfDelay: Infinity });

      rl.on('line', async (line: string) => {
        if (!this.watching) { rl.close(); return; }
        try {
          const event = JSON.parse(line);
          await this.processEvent(event, producer);
        } catch {
          // Skip malformed lines
        }
      });

      rl.on('close', () => {
        if (this.watching) {
          setTimeout(() => this.tailEveJson(), 5000); // Reopen after rotation
        }
      });
    } catch (err) {
      logger.warn('Cannot read eve.json: %s — retrying in 10s', (err as Error).message);
      if (this.watching) setTimeout(() => this.tailEveJson(), 10000);
    }
  }

  private async processEvent(event: any, producer: any): Promise<void> {
    const eventType = event.event_type;

    // Publish all events to raw topic
    await producer.send({
      topic: TOPIC_RAW,
      messages: [{
        key: `${event.src_ip || 'unknown'}-${Date.now()}`,
        value: JSON.stringify(event),
      }],
    });

    this.emit('event', event);

    // Extract IOCs from specific event types
    if (eventType === 'alert') {
      const alert = event as SuricataAlert;
      await producer.send({
        topic: TOPIC_IOC,
        messages: [{
          key: `sig-${alert.alert.signature_id}`,
          value: JSON.stringify({
            indicator_type: 'suricata_signature',
            value: `SID:${alert.alert.signature_id}`,
            severity: this.mapSeverity(alert.alert.severity),
            source_ip: alert.src_ip,
            dest_ip: alert.dest_ip,
            signature: alert.alert.signature,
            category: alert.alert.category,
            timestamp: alert.timestamp,
          }),
        }],
      });
      this.emit('alert', alert);
    }

    if (eventType === 'dns') {
      this.emit('dns', event as SuricataDns);
    }

    if (eventType === 'http') {
      this.emit('http', event as SuricataHttp);
    }
  }

  private mapSeverity(suricataSev: number): string {
    if (suricataSev <= 1) return 'CRITICAL';
    if (suricataSev === 2) return 'HIGH';
    if (suricataSev === 3) return 'MEDIUM';
    return 'LOW';
  }

  async reloadRules(): Promise<void> {
    const { exec } = require('child_process');
    return new Promise((resolve, reject) => {
      exec('suricatasc -c reload-rules', (err: any) => {
        if (err) reject(err);
        else { logger.info('Suricata rules reloaded'); resolve(); }
      });
    });
  }

  async getRuleStats(): Promise<{ total: number; active: number }> {
    const { exec } = require('child_process');
    return new Promise((resolve, reject) => {
      exec('suricatasc -c rule-info', (err: any, stdout: string) => {
        if (err) { reject(err); return; }
        try {
          const info = JSON.parse(stdout);
          resolve({ total: info.total_rules || 0, active: info.active_rules || 0 });
        } catch { resolve({ total: 0, active: 0 }); }
      });
    });
  }
}

// ──────────────────────────────────────────────────────────────
// sentinel-os/services/sigint-service/src/connectors/sdr/acars.ts
// ACARS — Aircraft Communications Addressing and Reporting System
// Decoded via RTL-SDR + acarsdec, published to Kafka
// ──────────────────────────────────────────────────────────────

import axios from 'axios';
import { pino } from 'pino';
import { Kafka } from 'kafkajs';

const logger = pino({ name: 'acars-connector' });
const KAFKA_BROKER = process.env.KAFKA_BROKERS || 'localhost:9092';

export interface AcarsMessage {
  icao: string;
  flight: string;
  timestamp: string;
  text: string;
  label: string;
  blockId: string;
  msgNo: string;
  frequency: number;
  level: number;
  error: number;
}

export class AcarsConnector {
  private readonly acarsDecUrl: string;
  private kafka: Kafka | null = null;

  constructor() {
    this.acarsDecUrl = process.env.ACARSDEC_URL || 'http://localhost:5555';
    if (process.env.KAFKA_BROKERS) {
      this.kafka = new Kafka({ brokers: [KAFKA_BROKER] });
    }
  }

  async pollAcarsMessages(): Promise<AcarsMessage[]> {
    try {
      const { data } = await axios.get(`${this.acarsDecUrl}/acars`, {
        timeout: 5000,
      });

      const messages: AcarsMessage[] = (Array.isArray(data) ? data : data.messages || []).map((m: any) => ({
        icao: m.icao || '',
        flight: m.flight || '',
        timestamp: m.timestamp || new Date().toISOString(),
        text: m.text || '',
        label: m.label || '',
        blockId: m.block_id || '',
        msgNo: m.msgno || '',
        frequency: m.freq || 131.525,
        level: m.level || 0,
        error: m.error || 0,
      }));

      return messages;
    } catch (err: any) {
      logger.warn({ err: err.message }, 'ACARS poll failed — acarsdec may not be running');
      return [];
    }
  }

  async publishToKafka(messages: AcarsMessage[]): Promise<void> {
    if (!this.kafka || messages.length === 0) return;
    try {
      const producer = this.kafka.producer();
      await producer.connect();
      await producer.send({
        topic: 'sentinel.sigint.acars',
        messages: messages.map(m => ({
          key: `${m.icao}:${m.msgNo}`,
          value: JSON.stringify(m),
        })),
      });
      await producer.disconnect();
      logger.info({ count: messages.length }, 'ACARS messages published to Kafka');
    } catch (err: any) {
      logger.warn({ err: err.message }, 'ACARS Kafka publish failed');
    }
  }
}

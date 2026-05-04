// ──────────────────────────────────────────────────────────────
// sentinel-os/services/sigint-service/src/connectors/sdr/kraken-sdr.ts
// KrakenSDR — coherent 5-channel RTL-SDR for DF (direction finding)
// REST API for bearing/heading of RF emitters
// ──────────────────────────────────────────────────────────────

import axios from 'axios';
import { pino } from 'pino';
import { Kafka } from 'kafkajs';

const logger = pino({ name: 'kraken-sdr' });
const KAFKA_BROKER = process.env.KAFKA_BROKERS || 'localhost:9092';

export interface KrakenDfResult {
  timestamp: string;
  frequency: number;
  bandwidth: number;
  bearing: number;
  confidence: number;
  sourceLat: number;
  sourceLon: number;
  signalStrength: number;
}

export class KrakenSdrConnector {
  private readonly krakenUrl: string;
  private kafka: Kafka | null = null;

  constructor() {
    this.krakenUrl = process.env.KRAKENSDR_URL || 'http://localhost:8080';
    if (process.env.KAFKA_BROKERS) {
      this.kafka = new Kafka({ brokers: [KAFKA_BROKER] });
    }
  }

  async getDfResults(): Promise<KrakenDfResult[]> {
    try {
      const { data } = await axios.get(`${this.krakenUrl}/api/df`, {
        timeout: 5000,
      });

      const results: KrakenDfResult[] = (data.results || []).map((r: any) => ({
        timestamp: r.timestamp || new Date().toISOString(),
        frequency: r.freq || 0,
        bandwidth: r.bw || 0,
        bearing: r.bearing || 0,
        confidence: r.confidence || 0,
        sourceLat: r.src_lat || 0,
        sourceLon: r.src_lon || 0,
        signalStrength: r.power || 0,
      }));

      return results;
    } catch (err: any) {
      logger.warn({ err: err.message }, 'KrakenSDR DF query failed');
      return [];
    }
  }

  async getSettings(): Promise<any> {
    try {
      const { data } = await axios.get(`${this.krakenUrl}/api/settings`, {
        timeout: 5000,
      });
      return data;
    } catch (err: any) {
      logger.warn({ err: err.message }, 'KrakenSDR settings fetch failed');
      return null;
    }
  }

  async setFrequency(freqHz: number): Promise<boolean> {
    try {
      await axios.post(`${this.krakenUrl}/api/settings`, {
        center_freq: freqHz,
      }, { timeout: 5000 });
      return true;
    } catch (err: any) {
      logger.warn({ err: err.message, freqHz }, 'KrakenSDR frequency set failed');
      return false;
    }
  }

  async publishToKafka(results: KrakenDfResult[]): Promise<void> {
    if (!this.kafka || results.length === 0) return;
    try {
      const producer = this.kafka.producer();
      await producer.connect();
      await producer.send({
        topic: 'sentinel.sigint.kraken-df',
        messages: results.map(r => ({
          key: `${r.frequency}:${r.bearing}`,
          value: JSON.stringify(r),
        })),
      });
      await producer.disconnect();
      logger.info({ count: results.length }, 'KrakenSDR DF results published to Kafka');
    } catch (err: any) {
      logger.warn({ err: err.message }, 'KrakenSDR Kafka publish failed');
    }
  }
}

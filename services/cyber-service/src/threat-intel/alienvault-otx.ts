// ──────────────────────────────────────────────────────────────
// sentinel-os/services/cyber-service/src/threat-intel/alienvault-otx.ts
// AlienVault OTX — Open Threat Exchange direct API connector
// Pulses, IOCs, adversary tracking
// ──────────────────────────────────────────────────────────────

import axios from 'axios';
import { pino } from 'pino';
import { Kafka } from 'kafkajs';

const logger = pino({ name: 'otx-connector' });
const KAFKA_BROKER = process.env.KAFKA_BROKERS || 'localhost:9092';

export interface OtxPulse {
  id: string;
  name: string;
  description: string;
  author: string;
  adversary: string | null;
  targetedCountries: string[];
  industries: string[];
  tlp: string;
  created: string;
  modified: string;
  revision: number;
  iocCount: number;
}

export interface OtxIOC {
  type: string;
  value: string;
  pulseId: string;
  pulseName: string;
  description: string;
}

export class AlienVaultOtxConnector {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://otx.alienvault.com/api/v1';
  private kafka: Kafka;

  constructor() {
    this.apiKey = process.env.OTX_KEY || '';
    this.kafka = new Kafka({ brokers: [KAFKA_BROKER] });
    if (!this.apiKey) {
      logger.warn('OTX_KEY not set — OTX queries will use public rate limits');
    }
  }

  async getSubscribedPulses(limit = 25): Promise<OtxPulse[]> {
    try {
      const { data } = await axios.get(`${this.baseUrl}/pulses/subscribed`, {
        params: { limit },
        headers: this.apiKey ? { 'X-OTX-API-KEY': this.apiKey } : {},
        timeout: 15000,
      });

      return (data.results || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        description: p.description || '',
        author: p.author_name,
        adversary: p.adversary || null,
        targetedCountries: p.targeted_countries || [],
        industries: p.industries || [],
        tlp: p.TLP || 'WHITE',
        created: p.created,
        modified: p.modified,
        revision: p.revision || 0,
        iocCount: p.indicator_count || 0,
      }));
    } catch (err: any) {
      logger.warn({ err: err.message }, 'OTX pulse fetch failed');
      return [];
    }
  }

  async getPulseDetails(pulseId: string): Promise<OtxIOC[]> {
    try {
      const { data } = await axios.get(`${this.baseUrl}/pulses/${pulseId}`, {
        headers: this.apiKey ? { 'X-OTX-API-KEY': this.apiKey } : {},
        timeout: 15000,
      });

      const iocs: OtxIOC[] = [];
      for (const section of ['ipv4', 'ipv6', 'domain', 'hostname', 'url', 'file_hashes', 'email']) {
        const indicators = data.indicators?.[section] || [];
        for (const ind of indicators) {
          iocs.push({
            type: section === 'file_hashes' ? 'hash' : section,
            value: ind.indicator || ind,
            pulseId,
            pulseName: data.name,
            description: ind.description || '',
          });
        }
      }

      return iocs;
    } catch (err: any) {
      logger.warn({ err: err.message, pulseId }, 'OTX pulse detail fetch failed');
      return [];
    }
  }

  async getIndicatorDetails(indicatorType: string, indicatorValue: string): Promise<any> {
    try {
      const { data } = await axios.get(
        `${this.baseUrl}/indicators/${indicatorType}/${indicatorValue}/general`,
        {
          headers: this.apiKey ? { 'X-OTX-API-KEY': this.apiKey } : {},
          timeout: 10000,
        }
      );
      return data;
    } catch (err: any) {
      logger.warn({ err: err.message, type: indicatorType, value: indicatorValue }, 'OTX indicator lookup failed');
      return null;
    }
  }

  async pollAndPublish(): Promise<void> {
    const pulses = await this.getSubscribedPulses();

    for (const pulse of pulses) {
      if (pulse.iocCount > 0) {
        const iocs = await this.getPulseDetails(pulse.id);
        if (iocs.length > 0) {
          await this.publishIocs(pulse, iocs);
        }
      }
    }

    logger.info({ pulseCount: pulses.length }, 'OTX poll complete');
  }

  private async publishIocs(pulse: OtxPulse, iocs: OtxIOC[]): Promise<void> {
    try {
      const producer = this.kafka.producer();
      await producer.connect();
      const messages = iocs.map(ioc => {
        const payload = {
          type: ioc.type,
          value: ioc.value,
          source: 'alienvault-otx',
          severity: 'HIGH',
          confidence: 0.75,
          tags: ['otx', pulse.adversary || 'unknown-adversary'].filter((t: string) => Boolean(t)),
          description: ioc.description,
          pulseName: ioc.pulseName,
          pulseId: ioc.pulseId,
          tlp: pulse.tlp,
        };
        return {
          key: `${ioc.type}:${ioc.value}`,
          value: JSON.stringify(payload),
        };
      });
      await producer.send({
        topic: 'sentinel.cyber.threat-indicators',
        messages,
      });
      await producer.disconnect();
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Failed to publish OTX IOCs to Kafka');
    }
  }
}

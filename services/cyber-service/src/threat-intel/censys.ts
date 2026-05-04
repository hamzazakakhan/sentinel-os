// ──────────────────────────────────────────────────────────────
// sentinel-os/services/cyber-service/src/threat-intel/censys.ts
// Censys v2 API — TLS certificate transparency, host scans, ASN data
// ──────────────────────────────────────────────────────────────

import axios from 'axios';
import { pino } from 'pino';

const logger = pino({ name: 'censys-connector' });

export class CensysConnector {
  private readonly apiId: string;
  private readonly apiSecret: string;
  private readonly baseUrl = 'https://search.censys.io/api/v2';

  constructor() {
    this.apiId = process.env.CENSYS_API_ID || '';
    this.apiSecret = process.env.CENSYS_API_SECRET || '';
    if (!this.apiId || !this.apiSecret) {
      logger.warn('CENSYS_API_ID/SECRET not set — Censys queries disabled');
    }
  }

  isAvailable(): boolean {
    return !!(this.apiId && this.apiSecret);
  }

  private get auth(): { username: string; password: string } {
    return { username: this.apiId, password: this.apiSecret };
  }

  async searchHosts(query: string, perPage = 10): Promise<any[]> {
    if (!this.isAvailable()) return [];
    try {
      const { data } = await axios.get(`${this.baseUrl}/hosts/search`, {
        params: { q: query, per_page: perPage },
        auth: this.auth,
        timeout: 15000,
      });
      return data.result?.hits || [];
    } catch (err: any) {
      logger.warn({ err: err.message, query }, 'Censys host search failed');
      return [];
    }
  }

  async getHost(ip: string): Promise<any> {
    if (!this.isAvailable()) return null;
    try {
      const { data } = await axios.get(`${this.baseUrl}/hosts/${ip}`, {
        auth: this.auth,
        timeout: 15000,
      });
      return data.result || null;
    } catch (err: any) {
      logger.warn({ err: err.message, ip }, 'Censys host lookup failed');
      return null;
    }
  }

  async searchCertificates(query: string, perPage = 10): Promise<any[]> {
    if (!this.isAvailable()) return [];
    try {
      const { data } = await axios.get(`${this.baseUrl}/certificates/search`, {
        params: { q: query, per_page: perPage },
        auth: this.auth,
        timeout: 15000,
      });
      return data.result?.hits || [];
    } catch (err: any) {
      logger.warn({ err: err.message, query }, 'Censys cert search failed');
      return [];
    }
  }
}

// ──────────────────────────────────────────────────────────────
// sentinel-os/services/cyber-service/src/threat-intel/abuse-ipdb.ts
// AbuseIPDB v2 API — IP abuse reports, category classification
// ──────────────────────────────────────────────────────────────

import axios from 'axios';
import { pino } from 'pino';

const logger = pino({ name: 'abuseipdb-connector' });

const ABUSE_CATEGORIES: Record<number, string> = {
  1: 'DNS Compromise',
  2: 'DNS Poisoning',
  3: 'Fraud Orders',
  4: 'DDoS Attack',
  5: 'FTP Brute-Force',
  6: 'Ping of Death',
  7: 'Phishing',
  8: 'Proxy VPN',
  9: 'SSH Brute-Force',
  10: 'Tor Node',
  11: 'Spam',
  12: 'SQL Injection',
  13: 'XSS',
  14: 'CWE',
  15: 'Bad Web Bot',
  16: 'Exploit',
  17: 'Brute-Force',
  18: 'Bad Web Bot (Crawler)',
  19: 'App Attack',
  20: 'Mirai',
  21: 'Honeypot',
};

export interface AbuseReport {
  ip: string;
  abuseConfidenceScore: number;
  country: string;
  totalReports: number;
  lastReportedAt: string;
  categories: string[];
  isPublic: boolean;
}

export class AbuseIpDbConnector {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.abuseipdb.com/api/v2';

  constructor() {
    this.apiKey = process.env.ABUSEIPDB_KEY || '';
    if (!this.apiKey) {
      logger.warn('ABUSEIPDB_KEY not set — AbuseIPDB queries disabled');
    }
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async checkIp(ip: string, maxAge = 90): Promise<AbuseReport | null> {
    if (!this.apiKey) return null;
    try {
      const { data } = await axios.get(`${this.baseUrl}/check`, {
        params: { ipAddress: ip, maxAgeInDays: maxAge, verbose: true },
        headers: { Key: this.apiKey, Accept: 'application/json' },
        timeout: 10000,
      });

      const d = data.data;
      return {
        ip: d.ipAddress,
        abuseConfidenceScore: d.abuseConfidenceScore || 0,
        country: d.countryCode || 'unknown',
        totalReports: d.totalReports || 0,
        lastReportedAt: d.lastReportedAt || '',
        categories: (d.categories || []).map((c: number) => ABUSE_CATEGORIES[c] || `unknown-${c}`),
        isPublic: d.isPublic || false,
      };
    } catch (err: any) {
      logger.warn({ err: err.message, ip }, 'AbuseIPDB check failed');
      return null;
    }
  }

  async reportIp(ip: string, categories: number[], comment: string): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      await axios.post(`${this.baseUrl}/report`, {
        ip: ip,
        categories: categories.join(','),
        comment,
      }, {
        headers: { Key: this.apiKey, Accept: 'application/json' },
        timeout: 10000,
      });
      return true;
    } catch (err: any) {
      logger.warn({ err: err.message, ip }, 'AbuseIPDB report failed');
      return false;
    }
  }
}

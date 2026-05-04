// ──────────────────────────────────────────────────────────────
// sentinel-os/services/cyber-service/src/threat-intel/virustotal.ts
// VirusTotal v3 API — file hash, URL, IP, domain reputation
// ──────────────────────────────────────────────────────────────

import axios from 'axios';
import { pino } from 'pino';

const logger = pino({ name: 'virustotal-connector' });

export interface VtFileReport {
  sha256: string;
  detectionRatio: string;
  totalEngines: number;
  positiveEngines: number;
  fileType: string;
  size: number;
  names: string[];
  tags: string[];
}

export interface VtIpReport {
  ip: string;
  reputation: number;
  totalVotes: { harmless: number; malicious: number };
  country: string;
  asn: number;
  asOwner: string;
  lastAnalysisStats: { harmless: number; malicious: number; undetected: number };
}

export class VirusTotalConnector {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://www.virustotal.com/api/v3';

  constructor() {
    this.apiKey = process.env.VIRUSTOTAL_KEY || '';
    if (!this.apiKey) {
      logger.warn('VIRUSTOTAL_KEY not set — VirusTotal queries disabled');
    }
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  private get headers(): Record<string, string> {
    return { 'x-apikey': this.apiKey };
  }

  async getFileReport(hash: string): Promise<VtFileReport | null> {
    if (!this.apiKey) return null;
    try {
      const { data } = await axios.get(`${this.baseUrl}/files/${hash}`, {
        headers: this.headers,
        timeout: 15000,
      });

      const stats = data.data?.attributes?.last_analysis_stats || {};
      const total = (stats.harmless || 0) + (stats.malicious || 0) + (stats.undetected || 0) + (stats.suspicious || 0);

      return {
        sha256: data.data?.id || hash,
        detectionRatio: `${stats.malicious || 0}/${total}`,
        totalEngines: total,
        positiveEngines: stats.malicious || 0,
        fileType: data.data?.attributes?.type_description || 'unknown',
        size: data.data?.attributes?.size || 0,
        names: data.data?.attributes?.names || [],
        tags: data.data?.attributes?.tags || [],
      };
    } catch (err: any) {
      logger.warn({ err: err.message, hash }, 'VirusTotal file report failed');
      return null;
    }
  }

  async getIpReport(ip: string): Promise<VtIpReport | null> {
    if (!this.apiKey) return null;
    try {
      const { data } = await axios.get(`${this.baseUrl}/ip_addresses/${ip}`, {
        headers: this.headers,
        timeout: 15000,
      });

      const attrs = data.data?.attributes || {};
      return {
        ip,
        reputation: attrs.reputation || 0,
        totalVotes: attrs.total_votes || { harmless: 0, malicious: 0 },
        country: attrs.country || 'unknown',
        asn: attrs.asn || 0,
        asOwner: attrs.as_owner || '',
        lastAnalysisStats: attrs.last_analysis_stats || { harmless: 0, malicious: 0, undetected: 0 },
      };
    } catch (err: any) {
      logger.warn({ err: err.message, ip }, 'VirusTotal IP report failed');
      return null;
    }
  }

  async getDomainReport(domain: string): Promise<any> {
    if (!this.apiKey) return null;
    try {
      const { data } = await axios.get(`${this.baseUrl}/domains/${domain}`, {
        headers: this.headers,
        timeout: 15000,
      });
      return data.data?.attributes || null;
    } catch (err: any) {
      logger.warn({ err: err.message, domain }, 'VirusTotal domain report failed');
      return null;
    }
  }
}

// ──────────────────────────────────────────────────────────────
// sentinel-os/services/cyber-service/src/threat-intel/shodan.ts
// Shodan Internet Intelligence — port scanning, service detection,
// vulnerability exposure, IoT device discovery
// ──────────────────────────────────────────────────────────────

import axios from 'axios';
import { pino } from 'pino';

const logger = pino({ name: 'shodan-connector' });

export interface ShodanHost {
  ip: string;
  hostname?: string[];
  os?: string;
  org?: string;
  ports: number[];
  vulns: Record<string, { cvss: number; summary: string }>;
  data: ShodanService[];
  country_name?: string;
  city?: string;
  last_update?: string;
}

export interface ShodanService {
  port: number;
  protocol: string;
  product?: string;
  version?: string;
  banner?: string;
  vulns?: Record<string, { cvss: number; summary: string }>;
}

export interface ShodanSearchResult {
  total: number;
  matches: ShodanHost[];
}

export class ShodanConnector {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.shodan.io';

  constructor() {
    this.apiKey = process.env.SHODAN_KEY || '';
    if (!this.apiKey) {
      logger.warn('SHODAN_KEY not set — Shodan queries will be disabled');
    }
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async hostLookup(ip: string): Promise<ShodanHost | null> {
    if (!this.apiKey) return null;

    try {
      const { data } = await axios.get(`${this.baseUrl}/shodan/host/${ip}`, {
        params: { key: this.apiKey },
        timeout: 10000,
      });

      return {
        ip: data.ip_str || ip,
        hostname: data.hostnames,
        os: data.os,
        org: data.org,
        ports: data.ports || [],
        vulns: data.vulns || {},
        data: (data.data || []).map((d: any) => ({
          port: d.port,
          protocol: d.transport || 'tcp',
          product: d.product,
          version: d.version,
          banner: d.data?.slice(0, 500),
          vulns: d.vulns,
        })),
        country_name: data.country_name,
        city: data.city,
        last_update: data.last_update,
      };
    } catch (err: any) {
      logger.warn({ err: err.message, ip }, 'Shodan host lookup failed');
      return null;
    }
  }

  async search(query: string, limit = 100): Promise<ShodanSearchResult> {
    if (!this.apiKey) return { total: 0, matches: [] };

    try {
      const { data } = await axios.get(`${this.baseUrl}/shodan/host/search`, {
        params: { key: this.apiKey, query, limit },
        timeout: 15000,
      });

      return {
        total: data.total || 0,
        matches: (data.matches || []).map((m: any) => ({
          ip: m.ip_str,
          hostname: m.hostnames,
          ports: m.ports || [],
          vulns: m.vulns || {},
          data: [],
          org: m.org,
          os: m.os,
        })),
      };
    } catch (err: any) {
      logger.warn({ err: err.message, query }, 'Shodan search failed');
      return { total: 0, matches: [] };
    }
  }

  async orgSearch(org: string): Promise<ShodanSearchResult> {
    return this.search(`org:"${org}"`);
  }

  async netSearch(cidr: string): Promise<ShodanSearchResult> {
    return this.search(`net:${cidr}`);
  }

  async exposedServices(query: string): Promise<ShodanSearchResult> {
    return this.search(query);
  }
}

// ──────────────────────────────────────────────────────────────
// sentinel-os/services/cyber-service/src/threat-intel/feodo-tracker.ts
// Feodo Tracker — C2 botnet IPs, malware family, first/last seen
// ──────────────────────────────────────────────────────────────

import axios from 'axios';
import { pino } from 'pino';

const logger = pino({ name: 'feodo-connector' });

export interface FeodoC2Entry {
  ip: string;
  port: number;
  malwareFamily: string;
  firstSeen: string;
  lastSeen: string;
  status: string;
  hostname: string | null;
  asn: number;
  country: string;
}

export class FeodoTrackerConnector {
  private readonly downloadUrl = 'https://feodotracker.abuse.ch/downloads/ipblocklist.json';

  async getBlocklist(): Promise<FeodoC2Entry[]> {
    try {
      const { data } = await axios.get(this.downloadUrl, {
        timeout: 15000,
        responseType: 'json',
      });

      return (Array.isArray(data) ? data : []).map((e: any) => ({
        ip: e.ip_address || e.ip || '',
        port: e.port || 0,
        malwareFamily: e.malware || e.malware_family || 'unknown',
        firstSeen: e.first_seen_utc || e.first_seen || '',
        lastSeen: e.last_seen_utc || e.last_seen || '',
        status: e.status || 'online',
        hostname: e.hostname || null,
        asn: e.asn || 0,
        country: e.country || 'unknown',
      }));
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Feodo Tracker blocklist fetch failed');
      return [];
    }
  }

  async getOnlineC2s(): Promise<FeodoC2Entry[]> {
    const all = await this.getBlocklist();
    return all.filter((e: FeodoC2Entry) => e.status === 'online');
  }
}

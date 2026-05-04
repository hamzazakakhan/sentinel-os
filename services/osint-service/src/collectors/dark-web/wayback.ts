// ──────────────────────────────────────────────────────────────
// sentinel-os/services/osint-service/src/collectors/dark-web/wayback.ts
// Wayback Machine API — historical URL snapshots, archived content
// ──────────────────────────────────────────────────────────────

import axios from 'axios';
import { pino } from 'pino';

const logger = pino({ name: 'wayback-collector' });

export interface WaybackSnapshot {
  url: string;
  timestamp: string;
  status: number;
  mimeType: string | null;
  digest: string | null;
  length: number | null;
}

export class WaybackMachineCollector {
  private readonly baseUrl = 'https://web.archive.org/web';

  async getAvailability(url: string): Promise<{ available: boolean; archiveUrl: string | null; timestamp: string | null }> {
    try {
      const { data } = await axios.get('https://archive.org/wayback/available', {
        params: { url },
        timeout: 10000,
      });

      const snap = data.archived_snapshots?.closest;
      return {
        available: !!snap,
        archiveUrl: snap?.url || null,
        timestamp: snap?.timestamp || null,
      };
    } catch (err: any) {
      logger.warn({ err: err.message, url }, 'Wayback availability check failed');
      return { available: false, archiveUrl: null, timestamp: null };
    }
  }

  async getCdxSnapshots(url: string, limit = 50): Promise<WaybackSnapshot[]> {
    try {
      const { data } = await axios.get('https://web.archive.org/cdx/search/cdx', {
        params: {
          url,
          output: 'json',
          limit,
          fl: 'urlkey,timestamp,original,mimetype,statuscode,digest,length',
        },
        timeout: 15000,
      });

      if (!Array.isArray(data) || data.length < 2) return [];

      const headers = data[0];
      return data.slice(1).map((row: string[]) => {
        const obj: Record<string, string> = {};
        headers.forEach((h: string, i: number) => { obj[h] = row[i] || ''; });
        return {
          url: obj.original || '',
          timestamp: obj.timestamp || '',
          status: parseInt(obj.statuscode) || 0,
          mimeType: obj.mimetype || null,
          digest: obj.digest || null,
          length: obj.length ? parseInt(obj.length) : null,
        };
      });
    } catch (err: any) {
      logger.warn({ err: err.message, url }, 'Wayback CDX query failed');
      return [];
    }
  }

  async saveToArchive(url: string): Promise<string | null> {
    try {
      const { data } = await axios.post(`https://web.archive.org/save/${url}`, null, {
        timeout: 30000,
        headers: { 'User-Agent': 'sentinel-os/2.0' },
      });
      return data?.job_id || null;
    } catch (err: any) {
      logger.warn({ err: err.message, url }, 'Wayback save failed');
      return null;
    }
  }
}

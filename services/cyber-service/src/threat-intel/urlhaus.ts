// ──────────────────────────────────────────────────────────────
// sentinel-os/services/cyber-service/src/threat-intel/urlhaus.ts
// URLhaus API — malware distribution URLs, payload hashes
// ──────────────────────────────────────────────────────────────

import axios from 'axios';
import { pino } from 'pino';

const logger = pino({ name: 'urlhaus-connector' });

export interface UrlHausEntry {
  url: string;
  threat: string;
  tags: string[];
  urlStatus: string;
  dateAdded: string;
  host: string;
  malwareHash: string | null;
  malwareType: string | null;
}

export class UrlHausConnector {
  private readonly baseUrl = 'https://urlhaus-api.abuse.ch/v1';

  async getRecentUrls(limit = 50): Promise<UrlHausEntry[]> {
    try {
      const { data } = await axios.post(`${this.baseUrl}/urls/recent/`, {
        limit,
      }, { timeout: 10000 });

      return (data.urls || []).map((u: any) => ({
        url: u.url,
        threat: u.threat || 'unknown',
        tags: u.tags || [],
        urlStatus: u.url_status || '',
        dateAdded: u.dateadded || '',
        host: u.host || '',
        malwareHash: u.urlhaus_reference || null,
        malwareType: u.threat_type || null,
      }));
    } catch (err: any) {
      logger.warn({ err: err.message }, 'URLhaus recent URLs failed');
      return [];
    }
  }

  async searchUrl(url: string): Promise<UrlHausEntry | null> {
    try {
      const { data } = await axios.post(`${this.baseUrl}/url/`, { url }, { timeout: 10000 });
      if (data.query_status === 'ok' && data.url) {
        return {
          url: data.url.url,
          threat: data.url.threat || 'unknown',
          tags: data.url.tags || [],
          urlStatus: data.url.url_status || '',
          dateAdded: data.url.dateadded || '',
          host: data.url.host || '',
          malwareHash: null,
          malwareType: null,
        };
      }
      return null;
    } catch (err: any) {
      logger.warn({ err: err.message, url }, 'URLhaus search failed');
      return null;
    }
  }

  async searchHost(host: string): Promise<UrlHausEntry[]> {
    try {
      const { data } = await axios.post(`${this.baseUrl}/host/`, { host }, { timeout: 10000 });
      return (data.urls || []).map((u: any) => ({
        url: u.url,
        threat: u.threat || 'unknown',
        tags: u.tags || [],
        urlStatus: u.url_status || '',
        dateAdded: u.dateadded || '',
        host: u.host || '',
        malwareHash: null,
        malwareType: null,
      }));
    } catch (err: any) {
      logger.warn({ err: err.message, host }, 'URLhaus host search failed');
      return [];
    }
  }
}

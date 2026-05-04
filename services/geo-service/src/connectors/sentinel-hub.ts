// ──────────────────────────────────────────────────────────────
// sentinel-os/services/geo-service/src/connectors/sentinel-hub.ts
// Sentinel Hub (Copernicus) — satellite imagery, NDVI, SAR
// ──────────────────────────────────────────────────────────────

import axios from 'axios';
import { pino } from 'pino';

const logger = pino({ name: 'sentinel-hub' });

export interface SentinelTile {
  id: string;
  timestamp: string;
  cloudCover: number;
  bandCombo: string;
  bbox: [number, number, number, number];
  tileUrl: string;
}

export class SentinelHubConnector {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly baseUrl = 'https://services.sentinel-hub.com';
  private token: string | null = null;
  private tokenExpiry = 0;

  constructor() {
    this.clientId = process.env.SENTINEL_HUB_CLIENT_ID || '';
    this.clientSecret = process.env.SENTINEL_HUB_CLIENT_SECRET || '';
    if (!this.clientId || !this.clientSecret) {
      logger.warn('SENTINEL_HUB_CLIENT_ID/SECRET not set — Sentinel Hub disabled');
    }
  }

  isAvailable(): boolean {
    return !!(this.clientId && this.clientSecret);
  }

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiry) return this.token;
    try {
      const { data } = await axios.post(`${this.baseUrl}/oauth/token`, new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }), { timeout: 10000 });
      this.token = data.access_token;
      this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
      return this.token!;
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Sentinel Hub token fetch failed');
      throw err;
    }
  }

  async searchTiles(bbox: [number, number, number, number], from: string, to: string, maxCloud = 30): Promise<SentinelTile[]> {
    if (!this.isAvailable()) return [];
    try {
      const token = await this.getToken();
      const { data } = await axios.post(`${this.baseUrl}/api/v1/catalog/search`, {
        bbox,
        datetime: `${from}/${to}`,
        collections: ['sentinel-2-l2a'],
        filter: { op: 'lte', args: [{ property: 'eo:cloud_cover' }, maxCloud] },
        limit: 20,
      }, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000,
      });

      return (data.features || []).map((f: any) => ({
        id: f.id,
        timestamp: f.properties?.datetime || '',
        cloudCover: f.properties?.['eo:cloud_cover'] || 0,
        bandCombo: 'RGB',
        bbox: f.bbox || bbox,
        tileUrl: f.assets?.data?.href || '',
      }));
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Sentinel Hub tile search failed');
      return [];
    }
  }

  async getNdvi(bbox: [number, number, number, number], date: string): Promise<any> {
    if (!this.isAvailable()) return null;
    try {
      const token = await this.getToken();
      const { data } = await axios.post(`${this.baseUrl}/api/v1/process`, {
        input: {
          bounds: { bbox },
          data: [{ type: 'sentinel-2-l2a', dataFilter: { maxCloudCover: 30 } }],
        },
        output: { responses: [{ identifier: 'default', format: { type: 'image/tiff' } }] },
        evalscript: `
          var nir = B08;
          var red = B04;
          var ndvi = (nir - red) / (nir + red);
          return [ndvi * 10000];
        `,
      }, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 30000,
      });
      return data;
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Sentinel Hub NDVI fetch failed');
      return null;
    }
  }
}

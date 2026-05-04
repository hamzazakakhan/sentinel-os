// ──────────────────────────────────────────────────────────────
// sentinel-os/services/sigint-service/src/connectors/ais/aishub.ts
// AISHub — free AIS maritime data from global receiver network
// ──────────────────────────────────────────────────────────────

import axios from 'axios';
import { pino } from 'pino';

const logger = pino({ name: 'aishub-connector' });

export interface AishubVessel {
  mmsi: number;
  imo: number | null;
  name: string;
  lat: number;
  lon: number;
  speed: number;
  course: number;
  heading: number;
  shipType: string;
  destination: string;
  eta: string;
  flag: string;
}

export class AishubConnector {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://www.aishub.net/api';

  constructor() {
    this.apiKey = process.env.AISHUB_KEY || '';
    if (!this.apiKey) {
      logger.warn('AISHUB_KEY not set — AISHub queries disabled');
    }
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async getVesselsInArea(minLat: number, maxLat: number, minLon: number, maxLon: number): Promise<AishubVessel[]> {
    if (!this.apiKey) return [];
    try {
      const { data } = await axios.get(`${this.baseUrl}/v1`, {
        params: {
          apikey: this.apiKey,
          minlat: minLat,
          maxlat: maxLat,
          minlon: minLon,
          maxlon: maxLon,
        },
        timeout: 15000,
      });

      return (data[1] || []).map((v: any) => ({
        mmsi: v.MMSI || 0,
        imo: v.IMO || null,
        name: v.SHIPNAME || '',
        lat: v.LAT || 0,
        lon: v.LON || 0,
        speed: v.SPEED || 0,
        course: v.COURSE || 0,
        heading: v.HEADING || 0,
        shipType: v.TYPE_NAME || 'unknown',
        destination: v.DESTINATION || '',
        eta: v.ETA || '',
        flag: v.FLAG || '',
      }));
    } catch (err: any) {
      logger.warn({ err: err.message }, 'AISHub query failed');
      return [];
    }
  }
}

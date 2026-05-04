// ──────────────────────────────────────────────────────────────
// sentinel-os/services/geo-service/src/connectors/usgs-earthquakes.ts
// USGS Earthquake Hazards Program — real-time seismic events
// ──────────────────────────────────────────────────────────────

import axios from 'axios';
import { pino } from 'pino';

const logger = pino({ name: 'usgs-earthquakes' });

export interface EarthquakeEvent {
  id: string;
  magnitude: number;
  place: string;
  time: string;
  updated: string;
  url: string;
  lat: number;
  lon: number;
  depth: number;
  magType: string;
  tsunami: number;
  significance: number;
  type: string;
}

export class UsgsEarthquakesConnector {
  private readonly baseUrl = 'https://earthquake.usgs.gov/fdsnws/event/1';

  async getSignificant(period: 'hour' | 'day' | 'week' | 'month' = 'day'): Promise<EarthquakeEvent[]> {
    try {
      const periodMap: Record<string, string> = {
        hour: 'query?format=geojson&orderby=time&limit=50',
        day: 'query?format=geojson&starttime=',
        week: 'all_week.geojson',
        month: 'all_month.geojson',
      };

      let url: string;
      if (period === 'hour') {
        url = `${this.baseUrl}/${periodMap.hour}`;
      } else if (period === 'day') {
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        url = `${this.baseUrl}/query?format=geojson&starttime=${yesterday}&orderby=time&limit=100`;
      } else {
        url = `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${periodMap[period]}`;
      }

      const { data } = await axios.get(url, { timeout: 15000 });
      return this.parseFeatures(data.features || []);
    } catch (err: any) {
      logger.warn({ err: err.message, period }, 'USGS earthquake fetch failed');
      return [];
    }
  }

  async getByRegion(minLat: number, maxLat: number, minLon: number, maxLon: number, minMag = 2.5): Promise<EarthquakeEvent[]> {
    try {
      const { data } = await axios.get(`${this.baseUrl}/query`, {
        params: {
          format: 'geojson',
          minlatitude: minLat,
          maxlatitude: maxLat,
          minlongitude: minLon,
          maxlongitude: maxLon,
          minmagnitude: minMag,
          orderby: 'time',
          limit: 100,
        },
        timeout: 15000,
      });
      return this.parseFeatures(data.features || []);
    } catch (err: any) {
      logger.warn({ err: err.message }, 'USGS regional earthquake fetch failed');
      return [];
    }
  }

  async getEventDetail(eventId: string): Promise<any> {
    try {
      const { data } = await axios.get(`${this.baseUrl}/${eventId}`, {
        timeout: 10000,
      });
      return data;
    } catch (err: any) {
      logger.warn({ err: err.message, eventId }, 'USGS event detail failed');
      return null;
    }
  }

  private parseFeatures(features: any[]): EarthquakeEvent[] {
    return features.map((f: any) => ({
      id: f.id,
      magnitude: f.properties?.mag || 0,
      place: f.properties?.place || '',
      time: new Date(f.properties?.time || 0).toISOString(),
      updated: new Date(f.properties?.updated || 0).toISOString(),
      url: f.properties?.url || '',
      lat: f.geometry?.coordinates?.[1] || 0,
      lon: f.geometry?.coordinates?.[0] || 0,
      depth: f.geometry?.coordinates?.[2] || 0,
      magType: f.properties?.magType || '',
      tsunami: f.properties?.tsunami || 0,
      significance: f.properties?.sig || 0,
      type: f.properties?.type || '',
    }));
  }
}

// ──────────────────────────────────────────────────────────────
// sentinel-os/services/geo-service/src/connectors/geonames.ts
// GeoNames — geographic database, place names, elevation, timezone
// ──────────────────────────────────────────────────────────────

import axios from 'axios';
import { pino } from 'pino';

const logger = pino({ name: 'geonames' });

export interface GeoNameResult {
  name: string;
  country: string;
  countryCode: string;
  lat: number;
  lon: number;
  population: number;
  elevation: number | null;
  timezone: string;
  featureClass: string;
  featureCode: string;
  adminCode1: string;
}

export class GeoNamesConnector {
  private readonly username: string;
  private readonly baseUrl = 'http://api.geonames.org';

  constructor() {
    this.username = process.env.GEONAMES_USER || '';
    if (!this.username) {
      logger.warn('GEONAMES_USER not set — GeoNames queries disabled');
    }
  }

  isAvailable(): boolean {
    return !!this.username;
  }

  async search(query: string, maxRows = 10, country?: string): Promise<GeoNameResult[]> {
    if (!this.username) return [];
    try {
      const params: Record<string, string | number> = {
        q: query,
        maxRows,
        username: this.username,
        type: 'json',
      };
      if (country) params.country = country;

      const { data } = await axios.get(`${this.baseUrl}/searchJSON`, {
        params,
        timeout: 10000,
      });

      return (data.geonames || []).map((g: any) => ({
        name: g.name || '',
        country: g.countryName || '',
        countryCode: g.countryCode || '',
        lat: g.lat || 0,
        lon: g.lng || 0,
        population: g.population || 0,
        elevation: g.elevation || null,
        timezone: g.timezone?.timeZoneId || '',
        featureClass: g.fcl || '',
        featureCode: g.fcode || '',
        adminCode1: g.adminCode1 || '',
      }));
    } catch (err: any) {
      logger.warn({ err: err.message, query }, 'GeoNames search failed');
      return [];
    }
  }

  async getNearby(lat: number, lon: number, radius = 50, maxRows = 10): Promise<GeoNameResult[]> {
    if (!this.username) return [];
    try {
      const { data } = await axios.get(`${this.baseUrl}/findNearbyPlaceNameJSON`, {
        params: { lat, lng: lon, radius, maxRows, username: this.username },
        timeout: 10000,
      });

      return (data.geonames || []).map((g: any) => ({
        name: g.name || '',
        country: g.countryName || '',
        countryCode: g.countryCode || '',
        lat: g.lat || 0,
        lon: g.lng || 0,
        population: g.population || 0,
        elevation: g.elevation || null,
        timezone: g.timezone?.timeZoneId || '',
        featureClass: g.fcl || '',
        featureCode: g.fcode || '',
        adminCode1: g.adminCode1 || '',
      }));
    } catch (err: any) {
      logger.warn({ err: err.message, lat, lon }, 'GeoNames nearby search failed');
      return [];
    }
  }

  async getCountryInfo(countryCode: string): Promise<any> {
    if (!this.username) return null;
    try {
      const { data } = await axios.get(`${this.baseUrl}/countryInfoJSON`, {
        params: { country: countryCode, username: this.username },
        timeout: 10000,
      });
      return data.geonames?.[0] || null;
    } catch (err: any) {
      logger.warn({ err: err.message, countryCode }, 'GeoNames country info failed');
      return null;
    }
  }
}

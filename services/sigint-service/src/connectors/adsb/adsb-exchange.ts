// ──────────────────────────────────────────────────────────────
// sentinel-os/services/sigint-service/src/connectors/adsb/adsb-exchange.ts
// ADS-B Exchange — unfiltered ADS-B (military, blocked aircraft)
// ──────────────────────────────────────────────────────────────

import axios from 'axios';
import { pino } from 'pino';

const logger = pino({ name: 'adsb-exchange' });

export interface AdsbExchangeAircraft {
  icao: string;
  callsign: string | null;
  lat: number | null;
  lon: number | null;
  alt: number | null;
  speed: number | null;
  heading: number | null;
  vertRate: number | null;
  squawk: string | null;
  type: string | null;
  military: boolean;
}

export class AdsbExchangeConnector {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor() {
    this.apiKey = process.env.ADSB_EXCHANGE_KEY || '';
    this.baseUrl = process.env.ADSB_EXCHANGE_URL || 'https://adsbexchange.com/api';
    if (!this.apiKey) {
      logger.warn('ADSB_EXCHANGE_KEY not set — ADS-B Exchange queries disabled');
    }
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async getAircraftInBounds(lamin: number, lamax: number, lomin: number, lomax: number): Promise<AdsbExchangeAircraft[]> {
    if (!this.apiKey) return [];
    try {
      const { data } = await axios.get(`${this.baseUrl}/v2/lat/${lamin}/${lamax}/lon/${lomin}/${lomax}/`, {
        headers: { 'api-key': this.apiKey },
        timeout: 10000,
      });

      return (data.ac || []).map((a: any) => ({
        icao: a.hex || '',
        callsign: a.flight?.trim() || null,
        lat: a.lat || null,
        lon: a.lon || null,
        alt: a.alt_baro || null,
        speed: a.gs || null,
        heading: a.track || null,
        vertRate: a.baro_rate || null,
        squawk: a.squawk || null,
        type: a.t || null,
        military: a.military || false,
      }));
    } catch (err: any) {
      logger.warn({ err: err.message }, 'ADS-B Exchange query failed');
      return [];
    }
  }

  async getMilitaryAircraft(): Promise<AdsbExchangeAircraft[]> {
    if (!this.apiKey) return [];
    try {
      const { data } = await axios.get(`${this.baseUrl}/v2/mil/`, {
        headers: { 'api-key': this.apiKey },
        timeout: 10000,
      });

      return (data.ac || []).map((a: any) => ({
        icao: a.hex || '',
        callsign: a.flight?.trim() || null,
        lat: a.lat || null,
        lon: a.lon || null,
        alt: a.alt_baro || null,
        speed: a.gs || null,
        heading: a.track || null,
        vertRate: a.baro_rate || null,
        squawk: a.squawk || null,
        type: a.t || null,
        military: true,
      }));
    } catch (err: any) {
      logger.warn({ err: err.message }, 'ADS-B Exchange military query failed');
      return [];
    }
  }
}

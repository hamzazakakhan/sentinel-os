// ──────────────────────────────────────────────────────────────
// sentinel-os/services/geo-service/src/connectors/openweathermap.ts
// OpenWeatherMap — current weather, forecasts, alerts, historical
// ──────────────────────────────────────────────────────────────

import axios from 'axios';
import { pino } from 'pino';

const logger = pino({ name: 'openweathermap' });

export interface WeatherReport {
  lat: number;
  lon: number;
  temp: number;
  feelsLike: number;
  humidity: number;
  pressure: number;
  windSpeed: number;
  windDeg: number;
  clouds: number;
  visibility: number;
  description: string;
  icon: string;
}

export interface WeatherAlert {
  sender: string;
  event: string;
  severity: string;
  urgency: string;
  headline: string;
  description: string;
  start: string;
  end: string;
}

export class OpenWeatherMapConnector {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.openweathermap.org/data/2.5';

  constructor() {
    this.apiKey = process.env.OPENWEATHERMAP_KEY || '';
    if (!this.apiKey) {
      logger.warn('OPENWEATHERMAP_KEY not set — weather queries disabled');
    }
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async getCurrentWeather(lat: number, lon: number): Promise<WeatherReport | null> {
    if (!this.apiKey) return null;
    try {
      const { data } = await axios.get(`${this.baseUrl}/weather`, {
        params: { lat, lon, appid: this.apiKey, units: 'metric' },
        timeout: 10000,
      });

      return {
        lat: data.coord?.lat || lat,
        lon: data.coord?.lon || lon,
        temp: data.main?.temp || 0,
        feelsLike: data.main?.feels_like || 0,
        humidity: data.main?.humidity || 0,
        pressure: data.main?.pressure || 0,
        windSpeed: data.wind?.speed || 0,
        windDeg: data.wind?.deg || 0,
        clouds: data.clouds?.all || 0,
        visibility: data.visibility || 0,
        description: data.weather?.[0]?.description || '',
        icon: data.weather?.[0]?.icon || '',
      };
    } catch (err: any) {
      logger.warn({ err: err.message, lat, lon }, 'OpenWeatherMap current weather failed');
      return null;
    }
  }

  async getForecast(lat: number, lon: number, cnt = 8): Promise<WeatherReport[]> {
    if (!this.apiKey) return [];
    try {
      const { data } = await axios.get(`${this.baseUrl}/forecast`, {
        params: { lat, lon, cnt, appid: this.apiKey, units: 'metric' },
        timeout: 10000,
      });

      return (data.list || []).map((f: any) => ({
        lat,
        lon,
        temp: f.main?.temp || 0,
        feelsLike: f.main?.feels_like || 0,
        humidity: f.main?.humidity || 0,
        pressure: f.main?.pressure || 0,
        windSpeed: f.wind?.speed || 0,
        windDeg: f.wind?.deg || 0,
        clouds: f.clouds?.all || 0,
        visibility: f.visibility || 0,
        description: f.weather?.[0]?.description || '',
        icon: f.weather?.[0]?.icon || '',
      }));
    } catch (err: any) {
      logger.warn({ err: err.message, lat, lon }, 'OpenWeatherMap forecast failed');
      return [];
    }
  }

  async getAlerts(lat: number, lon: number): Promise<WeatherAlert[]> {
    if (!this.apiKey) return [];
    try {
      const { data } = await axios.get(`${this.baseUrl}/onecall`, {
        params: { lat, lon, appid: this.apiKey, exclude: 'minutely,hourly,daily' },
        timeout: 10000,
      });

      return (data.alerts || []).map((a: any) => ({
        sender: a.sender_name || '',
        event: a.event || '',
        severity: a.severity || 'unknown',
        urgency: a.urgency || '',
        headline: a.headline || a.event || '',
        description: a.description || '',
        start: new Date(a.start * 1000).toISOString(),
        end: new Date(a.end * 1000).toISOString(),
      }));
    } catch (err: any) {
      logger.warn({ err: err.message, lat, lon }, 'OpenWeatherMap alerts failed');
      return [];
    }
  }
}

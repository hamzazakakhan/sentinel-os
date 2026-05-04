// ──────────────────────────────────────────────────────────────
// sentinel-os/services/sigint-service/src/connectors/sdr/websdr.ts
// WebSDR / KiwiSDR — access remote SDR receivers worldwide
// Monitor HF/VHF bands without local hardware
// ──────────────────────────────────────────────────────────────

import axios from 'axios';
import { pino } from 'pino';

const logger = pino({ name: 'websdr-connector' });

export interface WebSdrStation {
  name: string;
  url: string;
  location: string;
  bands: string[];
  status: 'online' | 'offline';
}

export interface KiwiSdrStation {
  name: string;
  url: string;
  lat: number;
  lon: number;
  users: number;
  maxUsers: number;
  status: 'online' | 'offline';
}

export class WebSdrConnector {
  private readonly kiwiDirUrl = 'http://kiwisdr.com/public';

  async getKiwiStations(): Promise<KiwiSdrStation[]> {
    try {
      const { data } = await axios.get(this.kiwiDirUrl, {
        timeout: 15000,
      });

      // KiwiSDR directory returns HTML/JSON with station list
      const stations: KiwiSdrStation[] = [];
      if (Array.isArray(data)) {
        for (const s of data) {
          stations.push({
            name: s.s_name || s.name || '',
            url: s.s_url || s.url || '',
            lat: s.s_lat || s.lat || 0,
            lon: s.s_lon || s.lon || 0,
            users: s.s_users || 0,
            maxUsers: s.s_max_users || 0,
            status: 'online',
          });
        }
      }
      return stations;
    } catch (err: any) {
      logger.warn({ err: err.message }, 'KiwiSDR directory fetch failed');
      return [];
    }
  }

  async connectToKiwi(stationUrl: string, frequency: number, mode: string): Promise<WebSocket | null> {
    try {
      const wsUrl = stationUrl.replace(/^http/, 'ws') + `/fd?freq=${frequency}&mode=${mode}`;
      const ws = new WebSocket(wsUrl);
      return ws;
    } catch (err: any) {
      logger.warn({ err: err.message, stationUrl }, 'KiwiSDR WebSocket connect failed');
      return null;
    }
  }
}

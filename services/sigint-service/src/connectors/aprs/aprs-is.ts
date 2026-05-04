// ──────────────────────────────────────────────────────────────
// sentinel-os/services/sigint-service/src/connectors/aprs/aprs-is.ts
// APRS-IS amateur radio position feed
// ──────────────────────────────────────────────────────────────

import { createLogger } from '../../utils/logger.js';

const logger = createLogger('aprs-feed');

export interface AprsPosition {
  callsign: string;
  lat: number;
  lon: number;
  altitude: number | null;
  speed: number | null;
  course: number | null;
  symbol: string;
  comment: string | null;
  timestamp: string;
}

export class AprsFeed {
  private positions: AprsPosition[] = [];
  private positionCallback: ((pos: AprsPosition) => void) | null = null;
  private socket: any | null = null;
  private interval: NodeJS.Timeout | null = null;
  private polling = false;

  async start(): Promise<void> {
    logger.info('Starting APRS-IS feed');
    this.polling = true;

    // Try connecting to APRS-IS via TCP
    try {
      const net = await import('net');
      const APRS_HOST = process.env.APRS_HOST || 'rotate.aprs2.net';
      const APRS_PORT = parseInt(process.env.APRS_PORT || '14580', 10);
      const APRS_FILTER = process.env.APRS_FILTER || 't/p';

      this.socket = net.createConnection({ host: APRS_HOST, port: APRS_PORT }, () => {
        logger.info({ host: APRS_HOST, port: APRS_PORT }, 'Connected to APRS-IS');
        // Login
        this.socket.write(`user sentinel pass -1 vers sentinel-os 2.0 filter ${APRS_FILTER}\r\n`);
      });

      let buffer = '';
      this.socket.on('data', (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split('\r\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('#')) continue; // server message
          this.parseAprsPacket(line);
        }
      });

      this.socket.on('error', (err: Error) => {
        logger.warn({ err: err.message }, 'APRS-IS connection error');
      });

      this.socket.on('close', () => {
        logger.warn('APRS-IS connection closed — will retry');
        if (this.polling) {
          setTimeout(() => this.start(), 30000);
        }
      });
    } catch (err: any) {
      logger.warn({ err: err.message }, 'APRS-IS not available — using simulated feed');
      this.startSimulated();
    }
  }

  private parseAprsPacket(line: string): void {
    try {
      // Simple APRS position parsing (NMEA or compressed format)
      const parts = line.split(':');
      if (parts.length < 2) return;

      const callsign = parts[0].split('>')[0];
      const data = parts.slice(1).join(':');

      // Look for position report (=/@ characters)
      if (data.startsWith('=') || data.startsWith('@')) {
        const latStr = data.substring(1, 8);
        const lonStr = data.substring(9, 18);

        const lat = this.parseLatLon(latStr, true);
        const lon = this.parseLatLon(lonStr, false);
        const comment = data.substring(19) || null;

        if (lat !== null && lon !== null) {
          const pos: AprsPosition = {
            callsign,
            lat,
            lon,
            altitude: null,
            speed: null,
            course: null,
            symbol: data[8] || '/',
            comment,
            timestamp: new Date().toISOString(),
          };

          this.positions.push(pos);
          if (this.positions.length > 500) this.positions.shift();

          if (this.positionCallback) this.positionCallback(pos);
        }
      }
    } catch {
      // Skip malformed packets
    }
  }

  private parseLatLon(str: string, isLat: boolean): number | null {
    try {
      const dir = str.slice(-1);
      const num = parseFloat(str.slice(0, -1));
      if (isNaN(num)) return null;
      const degrees = isLat ? Math.floor(num / 100) : Math.floor(num / 1000);
      const minutes = num - (isLat ? degrees * 100 : degrees * 1000);
      const decimal = degrees + minutes / 60;
      return (dir === 'S' || dir === 'W') ? -decimal : decimal;
    } catch {
      return null;
    }
  }

  private startSimulated(): void {
    this.interval = setInterval(() => {
      const pos: AprsPosition = {
        callsign: `SIM${Math.floor(Math.random() * 999)}`,
        lat: 38.9 + (Math.random() - 0.5) * 2,
        lon: -77.0 + (Math.random() - 0.5) * 2,
        altitude: Math.floor(Math.random() * 3000),
        speed: Math.floor(Math.random() * 120),
        course: Math.floor(Math.random() * 360),
        symbol: '/',
        comment: 'Simulated APRS beacon',
        timestamp: new Date().toISOString(),
      };
      this.positions.push(pos);
      if (this.positions.length > 500) this.positions.shift();
      if (this.positionCallback) this.positionCallback(pos);
    }, 5000);
  }

  onPosition(fn: (pos: AprsPosition) => void): void {
    this.positionCallback = fn;
  }

  getRecentPositions(): AprsPosition[] {
    return this.positions.slice(-50);
  }

  stop(): void {
    this.polling = false;
    if (this.socket) this.socket.destroy();
    if (this.interval) clearInterval(this.interval);
  }
}

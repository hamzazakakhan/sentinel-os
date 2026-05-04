// ──────────────────────────────────────────────────────────────
// sentinel-os/services/sigint-service/src/connectors/adsb/opensky.ts
// ADS-B aircraft tracker via OpenSky Network API
// ──────────────────────────────────────────────────────────────

import axios from 'axios';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('adsb-opensky');

export interface AdsbTrack {
  icao24: string;
  callsign: string | null;
  originCountry: string;
  lat: number | null;
  lon: number | null;
  altitude: number | null;       // meters
  velocity: number | null;       // m/s
  heading: number | null;        // degrees
  verticalRate: number | null;   // m/s
  onGround: boolean;
  squawk: string | null;
  timestamp: number;
}

type TrackSubscriber = (tracks: AdsbTrack[]) => void;

export class AdsbTracker {
  private tracks = new Map<string, AdsbTrack>();
  private subscribers = new Map<string, TrackSubscriber>();
  private trackCallback: ((tracks: AdsbTrack[]) => void) | null = null;
  private interval: NodeJS.Timeout | null = null;
  private polling = false;

  private readonly BASE_URL = 'https://opensky-network.org/api/states/all';
  private readonly POLL_INTERVAL = 10000; // 10 seconds

  async start(): Promise<void> {
    logger.info('Starting ADS-B tracker (OpenSky Network)');
    this.polling = true;
    this.poll();
    this.interval = setInterval(() => this.poll(), this.POLL_INTERVAL);
  }

  private async poll(): Promise<void> {
    if (!this.polling) return;

    try {
      const { data } = await axios.get(this.BASE_URL, {
        params: {
          ...(process.env.OPENSKY_USER ? { login: process.env.OPENSKY_USER } : {}),
          ...(process.env.OPENSKY_PASSWORD ? { password: process.env.OPENSKY_PASSWORD } : {}),
        },
        timeout: 8000,
      });

      if (data?.states) {
        const newTracks: AdsbTrack[] = [];

        for (const state of data.states) {
          const track: AdsbTrack = {
            icao24: state[0],
            callsign: state[1]?.trim() || null,
            originCountry: state[2],
            lat: state[5] as number | null,
            lon: state[6] as number | null,
            altitude: state[7] as number | null,
            velocity: state[9] as number | null,
            heading: state[10] as number | null,
            verticalRate: state[11] as number | null,
            onGround: state[8] as boolean,
            squawk: state[14]?.toString() || null,
            timestamp: state[4] as number,
          };

          this.tracks.set(track.icao24, track);
          newTracks.push(track);
        }

        logger.debug({ count: newTracks.length }, 'ADS-B tracks updated');

        // Notify subscribers
        for (const [, fn] of this.subscribers) {
          try { fn(newTracks); } catch { /* */ }
        }
        if (this.trackCallback) this.trackCallback(newTracks);
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, 'OpenSky Network poll failed');
    }
  }

  subscribe(fn: TrackSubscriber): string {
    const id = Math.random().toString(36).slice(2);
    this.subscribers.set(id, fn);
    return id;
  }

  unsubscribe(id: string): void {
    this.subscribers.delete(id);
  }

  onTrackUpdate(fn: (tracks: AdsbTrack[]) => void): void {
    this.trackCallback = fn;
  }

  getTracks(): AdsbTrack[] {
    return Array.from(this.tracks.values());
  }

  getTrackCount(): number {
    return this.tracks.size;
  }

  stop(): void {
    this.polling = false;
    if (this.interval) clearInterval(this.interval);
  }
}

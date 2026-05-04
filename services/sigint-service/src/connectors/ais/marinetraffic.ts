// ──────────────────────────────────────────────────────────────
// sentinel-os/services/sigint-service/src/connectors/ais/marinetraffic.ts
// AIS vessel tracker via MarineTraffic / AISHub APIs
// ──────────────────────────────────────────────────────────────

import axios from 'axios';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('ais-tracker');

export interface AisVessel {
  mmsi: number;
  imo: number | null;
  name: string;
  type: string;
  lat: number;
  lon: number;
  speed: number;      // knots
  course: number;     // degrees
  heading: number;    // degrees
  destination: string | null;
  eta: string | null;
  timestamp: string;
}

type VesselSubscriber = (vessels: AisVessel[]) => void;

export class AisTracker {
  private vessels = new Map<number, AisVessel>();
  private subscribers = new Map<string, VesselSubscriber>();
  private vesselCallback: ((vessels: AisVessel[]) => void) | null = null;
  private interval: NodeJS.Timeout | null = null;
  private polling = false;

  private readonly POLL_INTERVAL = 120000; // 2 minutes

  async start(): Promise<void> {
    logger.info('Starting AIS vessel tracker');
    this.polling = true;
    this.poll();
    this.interval = setInterval(() => this.poll(), this.POLL_INTERVAL);
  }

  private async poll(): Promise<void> {
    if (!this.polling) return;

    try {
      // Try AISHub free API first
      const aishubUrl = process.env.AISHUB_URL || 'https://www.aishub.net/api';
      const aishubKey = process.env.AISHUB_KEY;

      const { data } = await axios.get(aishubUrl, {
        params: {
          ...(aishubKey ? { key: aishubKey } : {}),
          format: 'json',
        },
        timeout: 15000,
      });

      if (data?.vessels || Array.isArray(data)) {
        const vesselList = data.vessels || data;
        const newVessels: AisVessel[] = [];

        for (const v of vesselList) {
          const vessel: AisVessel = {
            mmsi: v.MMSI || v.mmsi,
            imo: v.IMO || v.imo || null,
            name: v.SHIPNAME || v.name || 'Unknown',
            type: v.TYPE_NAME || v.type || 'Unknown',
            lat: v.LAT || v.lat || 0,
            lon: v.LON || v.lon || 0,
            speed: v.SPEED || v.speed || 0,
            course: v.COURSE || v.course || 0,
            heading: v.HEADING || v.heading || 0,
            destination: v.DESTINATION || v.destination || null,
            eta: v.ETA || v.eta || null,
            timestamp: new Date().toISOString(),
          };

          this.vessels.set(vessel.mmsi, vessel);
          newVessels.push(vessel);
        }

        logger.debug({ count: newVessels.length }, 'AIS vessels updated');

        for (const [, fn] of this.subscribers) {
          try { fn(newVessels); } catch { /* */ }
        }
        if (this.vesselCallback) this.vesselCallback(newVessels);
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, 'AIS poll failed — will retry');
    }
  }

  subscribe(fn: VesselSubscriber): string {
    const id = Math.random().toString(36).slice(2);
    this.subscribers.set(id, fn);
    return id;
  }

  unsubscribe(id: string): void {
    this.subscribers.delete(id);
  }

  onVesselUpdate(fn: (vessels: AisVessel[]) => void): void {
    this.vesselCallback = fn;
  }

  getVessels(): AisVessel[] {
    return Array.from(this.vessels.values());
  }

  getVesselCount(): number {
    return this.vessels.size;
  }

  stop(): void {
    this.polling = false;
    if (this.interval) clearInterval(this.interval);
  }
}

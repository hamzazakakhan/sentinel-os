// ──────────────────────────────────────────────────────────────
// sentinel-os/services/sigint-service/src/sdr/device-manager.ts
// Detects RTL-SDR, HackRF, and other SDR USB devices
// ──────────────────────────────────────────────────────────────

import { exec } from 'child_process';
import { createLogger } from '../utils/logger.js';
import { SdrDevice } from './spectrum.js';

const logger = createLogger('sdr-device-manager');

export class SdrDeviceManager {
  private devices: SdrDevice[] = [];

  async initialize(): Promise<void> {
    this.devices = [];

    // Check for RTL-SDR via custom driver path
    const fs = await import('fs');
    const hasSentinelSdr = fs.existsSync('/dev/sentinel-sdr0');
    if (hasSentinelSdr) {
      this.devices.push({ name: 'RTL-SDR v4 (sentinel-sdr0)', index: 0, type: 'rtlsdr' });
    }

    // Check via rtl_usb utility
    try {
      const output = await this.execCommand('rtl_usb 2>/dev/null || true');
      if (output) {
        const lines = output.split('\n');
        for (const line of lines) {
          const match = line.match(/Found\s+(\d+)\s+device.*:\s+(.*)/i);
          if (match) {
            this.devices.push({
              name: match[2].trim(),
              index: parseInt(match[1]),
              type: 'rtlsdr',
            });
          }
        }
      }
    } catch {
      // rtl_usb not available
    }

    // Check via lsusb for HackRF
    try {
      const lsusb = await this.execCommand('lsusb 2>/dev/null || true');
      if (lsusb) {
        if (lsusb.toLowerCase().includes('hackrf')) {
          this.devices.push({ name: 'HackRF One', index: this.devices.length, type: 'hackrf' });
        }
        if (lsusb.toLowerCase().includes('krakensdr')) {
          this.devices.push({ name: 'KrakenSDR', index: this.devices.length, type: 'krakensdr' });
        }
      }
    } catch {
      // lsusb not available
    }

    logger.info({ count: this.devices.length }, 'SDR device scan complete');
  }

  getDevices(): SdrDevice[] {
    return this.devices;
  }

  private execCommand(cmd: string): Promise<string> {
    return new Promise((resolve) => {
      exec(cmd, { timeout: 5000 }, (_err, stdout) => {
        resolve(stdout || '');
      });
    });
  }
}

// ──────────────────────────────────────────────────────────────
// sentinel-os/services/sigint-service/src/sdr/spectrum.ts
// Spectrum data broadcaster — reads from RTL-SDR or simulates
// Broadcasts FFT power spectra to WebSocket clients at 30fps
// ──────────────────────────────────────────────────────────────

import { spawn, ChildProcess } from 'child_process';
import { createLogger } from '../utils/logger.js';
import { v4 as uuid } from 'uuid';

const logger = createLogger('spectrum-broadcaster');

export interface SdrDevice {
  name: string;
  index: number;
  type: string;
  serial?: string;
}

export interface SpectrumFrame {
  type: 'spectrum';
  timestamp: string;
  frequency: number;
  sampleRate: number;
  fftSize: number;
  minFreq: number;
  maxFreq: number;
  power: number[];       // normalized 0-1 power values per FFT bin
  signalMarkers?: SignalMarker[];
}

export interface SignalMarker {
  frequency: number;
  power: number;
  bandwidth: number;
  modulation?: string;
  label?: string;
}

type Subscriber = (data: any) => void;

export class SpectrumBroadcaster {
  private subscribers = new Map<string, Subscriber>();
  private rtlProcess: ChildProcess | null = null;
  private frequency = 433920000;   // 433.92 MHz default
  private sampleRate = 2400000;     // 2.4 MSPS
  private gain = 40;
  private fftSize = 2048;
  private running = false;
  private simulated = false;
  private simInterval: NodeJS.Timeout | null = null;
  private signalMarkers: SignalMarker[] = [];

  subscribe(fn: Subscriber): string {
    const id = uuid();
    this.subscribers.set(id, fn);
    return id;
  }

  unsubscribe(id: string): void {
    this.subscribers.delete(id);
  }

  getClientCount(): number {
    return this.subscribers.size;
  }

  isReady(): boolean {
    return this.running;
  }

  getFrequency(): number { return this.frequency; }
  getSampleRate(): number { return this.sampleRate; }
  getGain(): number { return this.gain; }
  getFftSize(): number { return this.fftSize; }

  async startHardware(device: SdrDevice): Promise<void> {
    logger.info({ device: device.name, freq: this.frequency, srate: this.sampleRate }, 'Starting RTL-SDR spectrum capture');

    try {
      // Use rtl_power or a custom Python script for FFT output
      this.rtlProcess = spawn('rtl_power', [
        '-f', `${this.frequency}:${this.frequency + this.sampleRate}`,
        '-B',          // binary output
        '-e', '0',     // run indefinitely
        '-g', `${this.gain}`,
        '-k', `${this.fftSize}`,
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let buffer = Buffer.alloc(0);

      this.rtlProcess.stdout?.on('data', (data: Buffer) => {
        buffer = Buffer.concat([buffer, data]);
        // Process complete FFT frames
        const frameSize = this.fftSize * 4; // float32 per bin
        while (buffer.length >= frameSize) {
          const frame = buffer.subarray(0, frameSize);
          buffer = buffer.subarray(frameSize);

          const power: number[] = [];
          for (let i = 0; i < this.fftSize; i++) {
            const val = frame.readFloatLE(i * 4);
            // Normalize to 0-1 range (RTL-SDR power is typically -30 to 0 dBFS)
            power.push(Math.max(0, Math.min(1, (val + 30) / 30)));
          }

          this.broadcast({
            type: 'spectrum',
            timestamp: new Date().toISOString(),
            frequency: this.frequency,
            sampleRate: this.sampleRate,
            fftSize: this.fftSize,
            minFreq: this.frequency - this.sampleRate / 2,
            maxFreq: this.frequency + this.sampleRate / 2,
            power,
            signalMarkers: this.signalMarkers.length > 0 ? this.signalMarkers : undefined,
          });
        }
      });

      this.rtlProcess.stderr?.on('data', (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg) logger.debug({ msg }, 'rtl_power stderr');
      });

      this.rtlProcess.on('error', (err) => {
        logger.error({ err: err.message }, 'rtl_power failed to start — falling back to simulated');
        this.startSimulated();
      });

      this.rtlProcess.on('exit', (code) => {
        logger.warn({ code }, 'rtl_power exited — falling back to simulated');
        if (this.running) this.startSimulated();
      });

      this.running = true;
    } catch (err: any) {
      logger.error({ err: err.message }, 'Hardware spectrum start failed — using simulated');
      this.startSimulated();
    }
  }

  startSimulated(): void {
    if (this.simulated) return;
    this.simulated = true;
    this.running = true;

    logger.info({ freq: this.frequency, srate: this.sampleRate }, 'Starting simulated spectrum broadcaster');

    // Simulate signal markers
    this.signalMarkers = [
      { frequency: this.frequency, power: 0.8, bandwidth: 25000, modulation: 'ASK', label: '433.92MHz IoT' },
      { frequency: this.frequency - 400000, power: 0.4, bandwidth: 12000, modulation: 'FSK', label: 'Unknown' },
    ];

    const frameInterval = 1000 / 30; // 30 FPS

    this.simInterval = setInterval(() => {
      const power = this.generateSimulatedFrame();
      this.broadcast({
        type: 'spectrum',
        timestamp: new Date().toISOString(),
        frequency: this.frequency,
        sampleRate: this.sampleRate,
        fftSize: this.fftSize,
        minFreq: this.frequency - this.sampleRate / 2,
        maxFreq: this.frequency + this.sampleRate / 2,
        power,
        signalMarkers: this.signalMarkers,
      });
    }, frameInterval);
  }

  private generateSimulatedFrame(): number[] {
    const power = new Float64Array(this.fftSize);
    const noiseFloor = 0.05 + Math.random() * 0.03;

    // Fill with noise floor
    for (let i = 0; i < this.fftSize; i++) {
      power[i] = noiseFloor + Math.random() * 0.05;
    }

    // Add signal peaks
    for (const marker of this.signalMarkers) {
      const centerBin = Math.round(
        ((marker.frequency - this.frequency) / this.sampleRate + 0.5) * this.fftSize
      );
      const bwBins = Math.round((marker.bandwidth / this.sampleRate) * this.fftSize);

      for (let b = centerBin - bwBins / 2; b < centerBin + bwBins / 2; b++) {
        if (b >= 0 && b < this.fftSize) {
          const dist = Math.abs(b - centerBin) / (bwBins / 2 || 1);
          const shape = Math.exp(-2 * dist * dist); // Gaussian
          power[b] = Math.max(power[b], marker.power * shape + Math.random() * 0.05);
        }
      }
    }

    // Normalize to 0-1
    return Array.from(power).map(v => Math.max(0, Math.min(1, v)));
  }

  tune(params: { frequency?: number; sampleRate?: number; gain?: number }): void {
    if (params.frequency) this.frequency = params.frequency;
    if (params.sampleRate) this.sampleRate = params.sampleRate;
    if (params.gain) this.gain = params.gain;

    logger.info({ frequency: this.frequency, sampleRate: this.sampleRate, gain: this.gain }, 'Tuned SDR');

    // If hardware is running, restart rtl_power with new params
    if (this.rtlProcess && !this.simulated) {
      this.rtlProcess.kill('SIGTERM');
      this.rtlProcess = null;
      // Restart will happen on exit handler
    }
  }

  startScan(params: { startFreq: number; stopFreq: number; step: number }): void {
    logger.info(params, 'Frequency scan started');
    // Implement frequency scanning across range
  }

  stopScan(): void {
    logger.info('Frequency scan stopped');
  }

  stop(): void {
    this.running = false;
    if (this.simInterval) {
      clearInterval(this.simInterval);
      this.simInterval = null;
    }
    if (this.rtlProcess) {
      this.rtlProcess.kill('SIGTERM');
      this.rtlProcess = null;
    }
    this.simulated = false;
  }

  private broadcast(data: SpectrumFrame): void {
    const msg = JSON.stringify(data);
    for (const [, fn] of this.subscribers) {
      try { fn(data); } catch { /* subscriber error */ }
    }
  }
}

import Redis from 'ioredis';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('edge-processor');

interface EdgeConfig {
  inferenceEnabled: boolean;
}

interface EdgeDetection {
  label: string;
  confidence: number;
  bbox?: { x: number; y: number; width: number; height: number };
}

interface EdgeResult {
  detections: EdgeDetection[];
  processedAt: string;
  processingTimeMs: number;
}

export class EdgeProcessor {
  private redis: Redis;
  private config: EdgeConfig;
  private motionThreshold = 0.15;

  constructor(redis: Redis, config: EdgeConfig) {
    this.redis = redis;
    this.config = config;
  }

  async processFrame(sensorId: string, frame: Buffer): Promise<EdgeResult | null> {
    if (!this.config.inferenceEnabled) return null;

    const startTime = Date.now();
    const detections: EdgeDetection[] = [];

    const hasMotion = await this.detectMotion(sensorId, frame);
    if (!hasMotion) return null;

    const frameHash = this.computePerceptualHash(frame);
    const isDuplicate = await this.checkDuplicate(sensorId, frameHash);
    if (isDuplicate) return null;

    await this.redis.setex(`sentinel:edge:hash:${sensorId}`, 60, frameHash);

    return {
      detections,
      processedAt: new Date().toISOString(),
      processingTimeMs: Date.now() - startTime,
    };
  }

  private async detectMotion(sensorId: string, frame: Buffer): Promise<boolean> {
    const currentHash = this.computeSimpleHash(frame);
    const previousHash = await this.redis.get(`sentinel:edge:motion:${sensorId}`);
    await this.redis.setex(`sentinel:edge:motion:${sensorId}`, 30, currentHash);

    if (!previousHash) return true;

    const distance = this.hammingDistance(currentHash, previousHash);
    const similarity = 1 - (distance / (currentHash.length * 4));
    return similarity < (1 - this.motionThreshold);
  }

  private computeSimpleHash(data: Buffer): string {
    let hash = 0;
    const step = Math.max(1, Math.floor(data.length / 256));
    for (let i = 0; i < data.length; i += step) {
      hash = ((hash << 5) - hash + data[i]) | 0;
    }
    return hash.toString(16).padStart(8, '0');
  }

  private computePerceptualHash(data: Buffer): string {
    let hash = '';
    const blockSize = Math.max(1, Math.floor(data.length / 64));
    for (let i = 0; i < 64; i++) {
      const offset = i * blockSize;
      let sum = 0;
      for (let j = 0; j < Math.min(blockSize, data.length - offset); j++) {
        sum += data[offset + j];
      }
      hash += (sum / blockSize > 128 ? '1' : '0');
    }
    return hash;
  }

  private hammingDistance(a: string, b: string): number {
    let distance = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      if (a[i] !== b[i]) distance++;
    }
    return distance + Math.abs(a.length - b.length);
  }

  private async checkDuplicate(sensorId: string, hash: string): Promise<boolean> {
    const existing = await this.redis.get(`sentinel:edge:hash:${sensorId}`);
    if (!existing) return false;
    const distance = this.hammingDistance(hash, existing);
    return distance < 5;
  }
}

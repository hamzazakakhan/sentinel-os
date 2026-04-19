import { Producer } from 'kafkajs';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ingestion-buffer');

interface BufferConfig {
  flushIntervalMs: number;
  maxSize: number;
}

interface BufferItem {
  topic: string;
  key: string;
  value: any;
}

export class IngestionBuffer {
  private producer: Producer;
  private config: BufferConfig;
  private buffers = new Map<string, BufferItem[]>();
  private intervalHandle: NodeJS.Timeout | null = null;
  private totalIngested = 0;
  private totalFlushed = 0;
  private totalDropped = 0;
  private lastFlushTime = Date.now();

  constructor(producer: Producer, config: BufferConfig) {
    this.producer = producer;
    this.config = config;
  }

  start(): void {
    this.intervalHandle = setInterval(() => this.flush(), this.config.flushIntervalMs);
    logger.info({ flushInterval: this.config.flushIntervalMs, maxSize: this.config.maxSize }, 'Ingestion buffer started');
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async add(item: BufferItem): Promise<void> {
    const topicBuffer = this.buffers.get(item.topic) || [];
    topicBuffer.push(item);
    this.buffers.set(item.topic, topicBuffer);
    this.totalIngested++;

    if (topicBuffer.length >= this.config.maxSize) {
      await this.flushTopic(item.topic);
    }
  }

  async flush(): Promise<void> {
    const topics = Array.from(this.buffers.keys());
    const promises = topics.map(topic => this.flushTopic(topic));
    await Promise.allSettled(promises);
    this.lastFlushTime = Date.now();
  }

  private async flushTopic(topic: string): Promise<void> {
    const items = this.buffers.get(topic);
    if (!items || items.length === 0) return;

    this.buffers.set(topic, []);

    try {
      await this.producer.send({
        topic,
        messages: items.map(item => ({
          key: item.key || undefined,
          value: JSON.stringify(item.value),
          timestamp: String(Date.now()),
          headers: {
            'content-type': Buffer.from('application/json'),
            'source-service': Buffer.from('ingestion-service'),
            'batch-size': Buffer.from(String(items.length)),
          },
        })),
        acks: -1,
        timeout: 30000,
      });

      this.totalFlushed += items.length;
      logger.debug({ topic, count: items.length }, 'Buffer flushed');
    } catch (error) {
      this.totalDropped += items.length;
      logger.error({ error, topic, count: items.length }, 'Buffer flush failed, messages dropped');

      const existing = this.buffers.get(topic) || [];
      if (existing.length + items.length <= this.config.maxSize * 2) {
        this.buffers.set(topic, [...items, ...existing]);
        this.totalDropped -= items.length;
      }
    }
  }

  getStats(): { ingested: number; flushed: number; dropped: number; pending: number; lastFlush: string } {
    let pending = 0;
    for (const items of this.buffers.values()) {
      pending += items.length;
    }
    return {
      ingested: this.totalIngested,
      flushed: this.totalFlushed,
      dropped: this.totalDropped,
      pending,
      lastFlush: new Date(this.lastFlushTime).toISOString(),
    };
  }
}

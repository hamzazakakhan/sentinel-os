// ──────────────────────────────────────────────────────────────
// sentinel-os/services/ingestion-service/src/kafka/dlq.ts
// Dead Letter Queue — retries failed messages 3x, then routes to DLQ topic
// ──────────────────────────────────────────────────────────────

import { Kafka, Producer } from 'kafkajs';
import { pino } from 'pino';

const logger = pino({ name: 'dlq' });
const KAFKA_BROKER = process.env.KAFKA_BROKERS || 'localhost:9092';

export const DLQ_TOPICS: Record<string, string> = {
  'sentinel.ingestion.video-frames': 'sentinel.dlq.video-frames',
  'sentinel.ingestion.radar-sweeps': 'sentinel.dlq.radar-sweeps',
  'sentinel.ingestion.drone-telemetry': 'sentinel.dlq.drone-telemetry',
  'sentinel.ingestion.mqtt-sensor': 'sentinel.dlq.mqtt-sensor',
  'sentinel.ai.inference-requests': 'sentinel.dlq.inference-requests',
  'sentinel.osint.items': 'sentinel.dlq.osint-items',
  'sentinel.cyber.threat-indicators': 'sentinel.dlq.threat-indicators',
  'sentinel.sigint.events': 'sentinel.dlq.sigint-events',
};

export interface DLQEntry {
  originalTopic: string;
  originalMessage: any;
  error: string;
  attempts: number;
  timestamp: string;
}

export class DeadLetterQueue {
  private kafka: Kafka;
  private producer: Producer | null = null;
  private dlqStats = new Map<string, { count: number; lastError: string; lastTs: string }>();

  constructor() {
    this.kafka = new Kafka({ brokers: [KAFKA_BROKER] });
  }

  async start(): Promise<void> {
    this.producer = this.kafka.producer();
    await this.producer.connect();
    logger.info('DLQ producer connected');
  }

  async stop(): Promise<void> {
    if (this.producer) {
      await this.producer.disconnect();
      this.producer = null;
    }
  }

  async withDLQ<T>(
    topic: string,
    fn: (msg: any) => Promise<T>,
    msg: any
  ): Promise<T | null> {
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn(msg);
      } catch (err: any) {
        logger.warn({
          topic,
          attempt,
          error: err.message,
        }, 'Message processing failed');

        if (attempt === maxAttempts) {
          await this.sendToDLQ(topic, msg, err.message, maxAttempts);
          return null;
        }

        // Exponential backoff between retries
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    return null;
  }

  private async sendToDLQ(
    originalTopic: string,
    originalMessage: any,
    error: string,
    attempts: number
  ): Promise<void> {
    const dlqTopic = DLQ_TOPICS[originalTopic] || `sentinel.dlq.${originalTopic.split('.').slice(-1)[0]}`;

    const entry: DLQEntry = {
      originalTopic,
      originalMessage,
      error,
      attempts,
      timestamp: new Date().toISOString(),
    };

    try {
      if (this.producer) {
        await this.producer.send({
          topic: dlqTopic,
          messages: [{
            key: `${originalTopic}-${Date.now()}`,
            value: JSON.stringify(entry),
          }],
        });
      }

      // Update stats
      const stats = this.dlqStats.get(dlqTopic) || { count: 0, lastError: '', lastTs: '' };
      stats.count++;
      stats.lastError = error;
      stats.lastTs = entry.timestamp;
      this.dlqStats.set(dlqTopic, stats);

      logger.info({ originalTopic, dlqTopic, error }, 'Message sent to DLQ');
    } catch (err: any) {
      logger.error({ err: err.message, originalTopic }, 'Failed to send to DLQ — message lost');
    }
  }

  async replayDLQ(dlqTopic: string, targetTopic: string, limit = 50): Promise<number> {
    const consumer = this.kafka.consumer({ groupId: `dlq-replay-${Date.now()}` });
    let replayed = 0;

    try {
      await consumer.connect();
      await consumer.subscribe({ topic: dlqTopic, fromBeginning: true });

      await consumer.run({
        eachMessage: async ({ message }) => {
          if (replayed >= limit) return;

          try {
            const entry: DLQEntry = JSON.parse(message.value?.toString() || '{}');

            if (this.producer) {
              await this.producer.send({
                topic: targetTopic,
                messages: [{
                  key: message.key?.toString() || '',
                  value: JSON.stringify(entry.originalMessage),
                }],
              });
            }

            replayed++;
          } catch (err: any) {
            logger.warn({ err: err.message }, 'DLQ replay message failed');
          }
        },
      });

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (err: any) {
      logger.error({ err: err.message, dlqTopic }, 'DLQ replay failed');
    } finally {
      await consumer.disconnect();
    }

    logger.info({ dlqTopic, targetTopic, replayed }, 'DLQ replay complete');
    return replayed;
  }

  getStats(): Record<string, { count: number; lastError: string; lastTs: string }> {
    return Object.fromEntries(this.dlqStats);
  }
}

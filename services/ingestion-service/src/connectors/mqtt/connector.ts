import mqtt, { MqttClient, IClientOptions } from 'mqtt';
import { createLogger } from '../../utils/logger.js';
import { IngestionBuffer } from '../../processors/buffer.js';
import { v4 as uuid } from 'uuid';

const logger = createLogger('mqtt-connector');

interface MqttConfig {
  brokerUrl: string;
}

interface SubscriptionInfo {
  sensorId: string;
  topic: string;
  metadata: Record<string, any>;
  messagesReceived: number;
}

export class MqttConnector {
  private client: MqttClient | null = null;
  private buffer: IngestionBuffer;
  private config: MqttConfig;
  private subscriptions = new Map<string, SubscriptionInfo>();
  private connected = false;

  constructor(buffer: IngestionBuffer, config: MqttConfig) {
    this.buffer = buffer;
    this.config = config;
  }

  async connect(): Promise<void> {
    const options: IClientOptions = {
      clientId: `sentinel-ingestion-${uuid().substring(0, 8)}`,
      clean: true,
      connectTimeout: 10000,
      reconnectPeriod: 5000,
      keepalive: 60,
      protocolVersion: 5,
      username: process.env.MQTT_USERNAME,
      password: process.env.MQTT_PASSWORD,
    };

    if (this.config.brokerUrl.startsWith('mqtts://')) {
      options.rejectUnauthorized = true;
    }

    return new Promise((resolve, reject) => {
      this.client = mqtt.connect(this.config.brokerUrl, options);

      this.client.on('connect', () => {
        this.connected = true;
        logger.info({ broker: this.config.brokerUrl }, 'MQTT connected');
        resolve();
      });

      this.client.on('error', (error) => {
        logger.error({ error }, 'MQTT connection error');
        if (!this.connected) reject(error);
      });

      this.client.on('reconnect', () => {
        logger.info('MQTT reconnecting');
      });

      this.client.on('close', () => {
        this.connected = false;
        logger.warn('MQTT connection closed');
      });

      this.client.on('message', (topic, payload, packet) => {
        this.handleMessage(topic, payload, packet);
      });
    });
  }

  async subscribe(topic: string, sensorId: string, metadata: Record<string, any> = {}): Promise<void> {
    if (!this.client || !this.connected) {
      throw new Error('MQTT client not connected');
    }

    await new Promise<void>((resolve, reject) => {
      this.client!.subscribe(topic, { qos: 1 }, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    this.subscriptions.set(sensorId, {
      sensorId,
      topic,
      metadata,
      messagesReceived: 0,
    });

    logger.info({ sensorId, topic }, 'MQTT subscription added');
  }

  private async handleMessage(topic: string, payload: Buffer, _packet: any): Promise<void> {
    const sensorId = this.findSensorForTopic(topic);
    if (!sensorId) return;

    const sub = this.subscriptions.get(sensorId);
    if (sub) sub.messagesReceived++;

    let parsedPayload: any;
    try {
      parsedPayload = JSON.parse(payload.toString());
    } catch {
      parsedPayload = {
        raw: payload.toString('hex'),
        size: payload.length,
      };
    }

    await this.buffer.add({
      topic: 'sentinel.ingestion.sensor-telemetry',
      key: sensorId,
      value: {
        id: uuid(),
        sensorId,
        sensorType: 'IOT',
        domain: sub?.metadata.domain || 'LAND',
        mqttTopic: topic,
        payload: parsedPayload,
        location: sub?.metadata.location,
        timestamp: new Date().toISOString(),
      },
    });
  }

  private findSensorForTopic(topic: string): string | null {
    for (const [sensorId, sub] of this.subscriptions) {
      const pattern = sub.topic.replace(/#/g, '.*').replace(/\+/g, '[^/]+');
      if (new RegExp(`^${pattern}$`).test(topic)) {
        return sensorId;
      }
    }
    return null;
  }

  unsubscribe(sensorId: string): void {
    const sub = this.subscriptions.get(sensorId);
    if (sub && this.client) {
      this.client.unsubscribe(sub.topic);
      this.subscriptions.delete(sensorId);
      logger.info({ sensorId, topic: sub.topic }, 'MQTT subscription removed');
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await new Promise<void>((resolve) => {
        this.client!.end(false, {}, () => resolve());
      });
      this.connected = false;
    }
  }

  isConnected(): boolean { return this.connected; }
  getSubscriptionCount(): number { return this.subscriptions.size; }
}

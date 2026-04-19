import { Kafka, Consumer, EachMessagePayload, logLevel } from 'kafkajs';
import type { PubSub } from 'graphql-subscriptions';
import { SUBSCRIPTION_EVENTS } from './pubsub.js';
import { createLogger } from '../middleware/logger.js';

const logger = createLogger('kafka-event-bus');

const KAFKA_TOPIC_MAP: Record<string, string> = {
  'sentinel.alerts.created': SUBSCRIPTION_EVENTS.ALERT_CREATED,
  'sentinel.alerts.updated': SUBSCRIPTION_EVENTS.ALERT_UPDATED,
  'sentinel.detections.created': SUBSCRIPTION_EVENTS.DETECTION_CREATED,
  'sentinel.tracks.updated': SUBSCRIPTION_EVENTS.TRACK_UPDATED,
  'sentinel.tracks.created': SUBSCRIPTION_EVENTS.TRACK_CREATED,
  'sentinel.sensors.status': SUBSCRIPTION_EVENTS.SENSOR_STATUS_CHANGED,
  'sentinel.cyber.events': SUBSCRIPTION_EVENTS.CYBER_EVENT_CREATED,
  'sentinel.osint.items': SUBSCRIPTION_EVENTS.OSINT_ITEM_CREATED,
  'sentinel.response.approvals': SUBSCRIPTION_EVENTS.APPROVAL_REQUIRED,
  'sentinel.response.executed': SUBSCRIPTION_EVENTS.RESPONSE_EXECUTED,
  'sentinel.missions.updated': SUBSCRIPTION_EVENTS.MISSION_UPDATED,
  'sentinel.system.health': SUBSCRIPTION_EVENTS.SYSTEM_HEALTH_CHANGED,
  'sentinel.simulation.ticks': SUBSCRIPTION_EVENTS.SIMULATION_TICK,
};

export class KafkaEventBus {
  private kafka: Kafka;
  private consumer: Consumer;
  private pubsub: PubSub;
  private connected = false;

  constructor(pubsub: PubSub) {
    this.pubsub = pubsub;
    this.kafka = new Kafka({
      clientId: 'api-gateway-subscriber',
      brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
      logLevel: logLevel.WARN,
      retry: {
        initialRetryTime: 1000,
        retries: 10,
        maxRetryTime: 30000,
        factor: 2,
      },
      connectionTimeout: 10000,
      requestTimeout: 30000,
    });

    this.consumer = this.kafka.consumer({
      groupId: 'api-gateway-subscriptions',
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
      maxBytesPerPartition: 1048576,
      retry: { retries: 5 },
    });
  }

  async connect(): Promise<void> {
    try {
      await this.consumer.connect();
      this.connected = true;

      const topics = Object.keys(KAFKA_TOPIC_MAP);
      await this.consumer.subscribe({
        topics,
        fromBeginning: false,
      });

      await this.consumer.run({
        autoCommit: true,
        autoCommitInterval: 5000,
        eachMessage: async (payload: EachMessagePayload) => {
          await this.handleMessage(payload);
        },
      });

      logger.info({ topics: topics.length }, 'Kafka event bus connected and subscribed');
    } catch (error) {
      logger.error({ error }, 'Failed to connect Kafka event bus');
      setTimeout(() => this.connect(), 5000);
    }
  }

  private async handleMessage(payload: EachMessagePayload): Promise<void> {
    const { topic, partition, message } = payload;
    const eventName = KAFKA_TOPIC_MAP[topic];

    if (!eventName || !message.value) return;

    try {
      const data = JSON.parse(message.value.toString());
      await this.pubsub.publish(eventName, { [this.eventToFieldName(eventName)]: data });

      logger.debug({
        topic,
        partition,
        offset: message.offset,
        eventName,
      }, 'Event published to subscriptions');
    } catch (error) {
      logger.error({ error, topic, offset: message.offset }, 'Failed to process Kafka message');
    }
  }

  private eventToFieldName(event: string): string {
    const mapping: Record<string, string> = {
      [SUBSCRIPTION_EVENTS.ALERT_CREATED]: 'alertCreated',
      [SUBSCRIPTION_EVENTS.ALERT_UPDATED]: 'alertUpdated',
      [SUBSCRIPTION_EVENTS.DETECTION_CREATED]: 'detectionCreated',
      [SUBSCRIPTION_EVENTS.TRACK_UPDATED]: 'trackUpdated',
      [SUBSCRIPTION_EVENTS.TRACK_CREATED]: 'trackCreated',
      [SUBSCRIPTION_EVENTS.SENSOR_STATUS_CHANGED]: 'sensorStatusChanged',
      [SUBSCRIPTION_EVENTS.CYBER_EVENT_CREATED]: 'cyberEventCreated',
      [SUBSCRIPTION_EVENTS.OSINT_ITEM_CREATED]: 'osintItemCreated',
      [SUBSCRIPTION_EVENTS.APPROVAL_REQUIRED]: 'approvalRequired',
      [SUBSCRIPTION_EVENTS.RESPONSE_EXECUTED]: 'responseExecuted',
      [SUBSCRIPTION_EVENTS.MISSION_UPDATED]: 'missionUpdated',
      [SUBSCRIPTION_EVENTS.SYSTEM_HEALTH_CHANGED]: 'systemHealthChanged',
      [SUBSCRIPTION_EVENTS.SIMULATION_TICK]: 'simulationTick',
    };
    return mapping[event] || event;
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.consumer.disconnect();
      this.connected = false;
      logger.info('Kafka event bus disconnected');
    }
  }
}

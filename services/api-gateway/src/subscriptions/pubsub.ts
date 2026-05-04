import { PubSub } from 'graphql-subscriptions';
import { RedisPubSub } from 'graphql-redis-subscriptions';
import { Redis } from 'ioredis';

export const SUBSCRIPTION_EVENTS = {
  ALERT_CREATED: 'ALERT_CREATED',
  ALERT_UPDATED: 'ALERT_UPDATED',
  DETECTION_CREATED: 'DETECTION_CREATED',
  TRACK_UPDATED: 'TRACK_UPDATED',
  TRACK_CREATED: 'TRACK_CREATED',
  SENSOR_STATUS_CHANGED: 'SENSOR_STATUS_CHANGED',
  CYBER_EVENT_CREATED: 'CYBER_EVENT_CREATED',
  OSINT_ITEM_CREATED: 'OSINT_ITEM_CREATED',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  RESPONSE_EXECUTED: 'RESPONSE_EXECUTED',
  MISSION_UPDATED: 'MISSION_UPDATED',
  SYSTEM_HEALTH_CHANGED: 'SYSTEM_HEALTH_CHANGED',
  SIMULATION_TICK: 'SIMULATION_TICK',
} as const;

export function createPubSub(): PubSub {
  const redisUrl = process.env.REDIS_URL;

  if (redisUrl) {
    const options = {
      retryStrategy: (times: number) => Math.min(times * 100, 3000),
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      connectTimeout: 10000,
    };

    return new RedisPubSub({
      publisher: new Redis(redisUrl, options),
      subscriber: new Redis(redisUrl, options),
      reviver: (_key: string, value: any) => {
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
          return new Date(value);
        }
        return value;
      },
    }) as unknown as PubSub;
  }

  return new PubSub();
}

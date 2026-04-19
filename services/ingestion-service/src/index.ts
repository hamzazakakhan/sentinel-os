import express from 'express';
import { Kafka, Producer } from 'kafkajs';
import Redis from 'ioredis';
import { createLogger } from './utils/logger.js';
import { RtspConnector } from './connectors/rtsp/connector.js';
import { MqttConnector } from './connectors/mqtt/connector.js';
import { RadarConnector } from './connectors/radar/connector.js';
import { DroneConnector } from './connectors/drone/connector.js';
import { WebhookRouter } from './connectors/webhook/router.js';
import { EdgeProcessor } from './edge/processor.js';
import { IngestionBuffer } from './processors/buffer.js';

const logger = createLogger('ingestion-service');
const PORT = parseInt(process.env.PORT || '4002', 10);

async function bootstrap(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: `${process.env.MAX_PAYLOAD_SIZE_MB || '50'}mb` }));
  app.use(express.raw({ type: 'application/octet-stream', limit: '100mb' }));

  const kafka = new Kafka({
    clientId: 'ingestion-service',
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    retry: { initialRetryTime: 1000, retries: 10 },
  });

  const producer: Producer = kafka.producer({
    allowAutoTopicCreation: false,
    transactionTimeout: 30000,
    maxInFlightRequests: 5,
    idempotent: true,
  });
  await producer.connect();

  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });
  await redis.connect();

  const buffer = new IngestionBuffer(producer, {
    flushIntervalMs: parseInt(process.env.BUFFER_FLUSH_INTERVAL_MS || '5000', 10),
    maxSize: parseInt(process.env.BUFFER_MAX_SIZE || '1000', 10),
  });
  buffer.start();

  const edgeProcessor = new EdgeProcessor(redis, {
    inferenceEnabled: process.env.EDGE_INFERENCE_ENABLED === 'true',
  });

  const rtsp = new RtspConnector(buffer, edgeProcessor, {
    frameRate: parseInt(process.env.RTSP_FRAME_RATE || '15', 10),
  });

  const mqtt = new MqttConnector(buffer, {
    brokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
  });
  await mqtt.connect();

  const radar = new RadarConnector(buffer, edgeProcessor);
  const drone = new DroneConnector(buffer, edgeProcessor);

  const webhookRouter = new WebhookRouter(buffer, {
    hmacSecret: process.env.WEBHOOK_HMAC_SECRET || '',
  });

  app.use('/api/v1/webhooks', webhookRouter.getRouter());

  app.post('/api/v1/ingest/sensor-data', async (req, res) => {
    try {
      const { sensorId, sensorType, domain, data: sensorData, location } = req.body;
      await buffer.add({
        topic: `sentinel.ingestion.sensor-telemetry`,
        key: sensorId,
        value: {
          sensorId,
          sensorType,
          domain,
          payload: sensorData,
          location,
          ingestedAt: new Date().toISOString(),
        },
      });
      res.status(202).json({ status: 'accepted', sensorId });
    } catch (error: any) {
      logger.error({ error }, 'Sensor data ingestion failed');
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/v1/ingest/intel-feed', async (req, res) => {
    try {
      const { feedId, feedType, data: feedData, classification } = req.body;
      await buffer.add({
        topic: 'sentinel.ingestion.intel-feeds',
        key: feedId,
        value: {
          feedId,
          feedType,
          payload: feedData,
          classification: classification || 'UNCLASSIFIED',
          ingestedAt: new Date().toISOString(),
        },
      });
      res.status(202).json({ status: 'accepted', feedId });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/v1/ingest/bulk', async (req, res) => {
    try {
      const { items } = req.body;
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'items array required' });
      }
      if (items.length > 10000) {
        return res.status(400).json({ error: 'Maximum 10000 items per bulk request' });
      }
      let accepted = 0;
      for (const item of items) {
        await buffer.add({
          topic: item.topic || 'sentinel.ingestion.sensor-telemetry',
          key: item.sensorId || item.id,
          value: { ...item, ingestedAt: new Date().toISOString() },
        });
        accepted++;
      }
      res.status(202).json({ status: 'accepted', count: accepted });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/v1/sensors/:sensorId/connect', async (req, res) => {
    try {
      const { sensorId } = req.params;
      const { sensorType, connectionUri, protocol, domain } = req.body;

      switch (sensorType?.toUpperCase()) {
        case 'CCTV':
          await rtsp.addStream(sensorId, connectionUri, { domain });
          break;
        case 'DRONE':
          await drone.addDrone(sensorId, connectionUri, { domain });
          break;
        case 'RADAR':
          await radar.addRadar(sensorId, connectionUri, { domain });
          break;
        case 'IOT':
          await mqtt.subscribe(`sensors/${sensorId}/#`, sensorId, { domain });
          break;
        default:
          return res.status(400).json({ error: `Unsupported sensor type: ${sensorType}` });
      }

      res.json({ status: 'connected', sensorId, sensorType });
    } catch (error: any) {
      logger.error({ error, sensorId: req.params.sensorId }, 'Sensor connection failed');
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/v1/sensors/:sensorId/disconnect', async (req, res) => {
    const { sensorId } = req.params;
    rtsp.removeStream(sensorId);
    drone.removeDrone(sensorId);
    radar.removeRadar(sensorId);
    mqtt.unsubscribe(sensorId);
    res.json({ status: 'disconnected', sensorId });
  });

  app.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      connectors: {
        rtsp: { activeStreams: rtsp.getActiveCount() },
        mqtt: { connected: mqtt.isConnected(), subscriptions: mqtt.getSubscriptionCount() },
        radar: { activeConnections: radar.getActiveCount() },
        drone: { activeDrones: drone.getActiveCount() },
      },
      buffer: buffer.getStats(),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/v1/stats', (_req, res) => {
    res.json({
      buffer: buffer.getStats(),
      connectors: {
        rtsp: { active: rtsp.getActiveCount() },
        mqtt: { connected: mqtt.isConnected(), subscriptions: mqtt.getSubscriptionCount() },
        radar: { active: radar.getActiveCount() },
        drone: { active: drone.getActiveCount() },
      },
    });
  });

  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Ingestion Service ready at http://0.0.0.0:${PORT}`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down ingestion service`);
    await buffer.flush();
    buffer.stop();
    rtsp.stopAll();
    await mqtt.disconnect();
    radar.stopAll();
    drone.stopAll();
    await producer.disconnect();
    redis.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((error) => {
  logger.fatal({ error }, 'Failed to start Ingestion Service');
  process.exit(1);
});

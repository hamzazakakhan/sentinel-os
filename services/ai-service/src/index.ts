import express from 'express';
import { Kafka, Consumer, Producer, EachMessagePayload } from 'kafkajs';
import { Redis } from 'ioredis';
import { Pool } from 'pg';
import { createLogger } from './utils/logger.js';
import { YoloV8Detector } from './models/yolov8/detector.js';
import { IsolationForestDetector } from './models/isolation-forest/detector.js';
import { LSTMPredictor } from './models/lstm/predictor.js';
import { OllamaClient } from './models/ollama/client.js';
import { InferencePipelineManager } from './pipelines/manager.js';
import { ModelRegistry } from './pipelines/registry.js';
import { DriftMonitor } from './pipelines/drift.js';

const logger = createLogger('ai-service');
const PORT = parseInt(process.env.PORT || '4003', 10);

const pgPool = new Pool({
  host: process.env.PG_HOST,
  port: parseInt(process.env.PG_PORT || '5432', 10),
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER || 'sentinel_admin',
  password: process.env.PG_PASSWORD,
  max: 10,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined,
});

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

const kafka = new Kafka({
  clientId: 'ai-service',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  retry: { initialRetryTime: 1000, retries: 10 },
});

async function bootstrap(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  const producer: Producer = kafka.producer({
    allowAutoTopicCreation: false,
    transactionTimeout: 30000,
  });
  await producer.connect();

  const consumer: Consumer = kafka.consumer({
    groupId: 'ai-service-inference',
    sessionTimeout: 30000,
    heartbeatInterval: 3000,
    maxBytesPerPartition: 10485760,
  });
  await consumer.connect();

  const modelRegistry = new ModelRegistry(pgPool, redis);
  await modelRegistry.initialize();

  const yolo = new YoloV8Detector({
    modelPath: process.env.YOLOV8_MODEL_PATH || '/models/yolov8x.pt',
    confidenceThreshold: parseFloat(process.env.YOLOV8_CONFIDENCE_THRESHOLD || '0.45'),
    iouThreshold: parseFloat(process.env.YOLOV8_IOU_THRESHOLD || '0.5'),
    batchSize: parseInt(process.env.INFERENCE_BATCH_SIZE || '32', 10),
    gpuMemoryFraction: parseFloat(process.env.GPU_MEMORY_FRACTION || '0.8'),
  });
  await yolo.initialize();

  const isolationForest = new IsolationForestDetector({
    contamination: parseFloat(process.env.ISOLATION_FOREST_CONTAMINATION || '0.05'),
    nEstimators: 200,
    maxSamples: 'auto',
    maxFeatures: 1.0,
    bootstrap: false,
  });
  await isolationForest.initialize();

  const lstm = new LSTMPredictor({
    sequenceLength: parseInt(process.env.LSTM_SEQUENCE_LENGTH || '60', 10),
    predictionHorizon: parseInt(process.env.LSTM_PREDICTION_HORIZON || '24', 10),
    hiddenSize: 256,
    numLayers: 3,
    dropout: 0.2,
    bidirectional: true,
  });
  await lstm.initialize();

  const ollama = new OllamaClient({
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://ollama:11434',
    model: process.env.OLLAMA_MODEL || 'llama3:70b',
    contextLength: parseInt(process.env.OLLAMA_CONTEXT_LENGTH || '8192', 10),
    timeout: 120000,
  });
  await ollama.initialize();

  const driftMonitor = new DriftMonitor(pgPool, redis, {
    enabled: process.env.DRIFT_DETECTION_ENABLED === 'true',
    threshold: parseFloat(process.env.DRIFT_THRESHOLD || '0.15'),
    evaluationInterval: 3600000,
  });
  await driftMonitor.start();

  const pipelineManager = new InferencePipelineManager({
    yolo,
    isolationForest,
    lstm,
    ollama,
    producer,
    pgPool,
    redis,
    modelRegistry,
    driftMonitor,
  });

  await consumer.subscribe({
    topics: [
      'sentinel.ingestion.video-frames',
      'sentinel.ingestion.sensor-telemetry',
      'sentinel.ingestion.radar-sweeps',
      'sentinel.cyber.raw-events',
      'sentinel.osint.for-analysis',
      'sentinel.ai.inference-requests',
    ],
    fromBeginning: false,
  });

  await consumer.run({
    autoCommit: true,
    autoCommitInterval: 5000,
    partitionsConsumedConcurrently: 4,
    eachMessage: async (payload: EachMessagePayload) => {
      const { topic, message } = payload;
      if (!message.value) return;

      try {
        const data = JSON.parse(message.value.toString());
        await pipelineManager.routeMessage(topic, data);
      } catch (error) {
        logger.error({ error, topic, offset: message.offset }, 'Failed to process inference message');
      }
    },
  });

  app.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      models: {
        yolov8: yolo.isReady(),
        isolationForest: isolationForest.isReady(),
        lstm: lstm.isReady(),
        ollama: ollama.isReady(),
      },
      timestamp: new Date().toISOString(),
    });
  });

  app.post('/api/v1/inference/detect', async (req, res) => {
    try {
      const { imageBase64, sensorId, metadata } = req.body;
      const result = await yolo.detect(Buffer.from(imageBase64, 'base64'), { sensorId, ...metadata });
      res.json(result);
    } catch (error: any) {
      logger.error({ error }, 'Detection endpoint failed');
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/v1/inference/anomaly', async (req, res) => {
    try {
      const { features, sensorId } = req.body;
      const result = await isolationForest.detect(features, sensorId);
      res.json(result);
    } catch (error: any) {
      logger.error({ error }, 'Anomaly detection endpoint failed');
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/v1/inference/predict', async (req, res) => {
    try {
      const { timeSeries, horizon, sensorId } = req.body;
      const result = await lstm.predict(timeSeries, horizon, sensorId);
      res.json(result);
    } catch (error: any) {
      logger.error({ error }, 'Prediction endpoint failed');
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/v1/ollama/query', async (req, res) => {
    try {
      const result = await ollama.query(req.body);
      res.json(result);
    } catch (error: any) {
      logger.error({ error }, 'Ollama query endpoint failed');
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/v1/ollama/investigate', async (req, res) => {
    try {
      const result = await ollama.investigateThreat(req.body);
      res.json(result);
    } catch (error: any) {
      logger.error({ error }, 'Ollama investigate endpoint failed');
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/v1/ollama/summarize', async (req, res) => {
    try {
      const result = await ollama.summarizeIntelligence(req.body);
      res.json(result);
    } catch (error: any) {
      logger.error({ error }, 'Ollama summarize endpoint failed');
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/v1/models', async (_req, res) => {
    const models = await modelRegistry.listModels();
    res.json(models);
  });

  app.get('/api/v1/models/:id/drift', async (req, res) => {
    const metrics = await driftMonitor.getMetrics(req.params.id);
    res.json(metrics);
  });

  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`AI Service ready at http://0.0.0.0:${PORT}`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down AI service`);
    await consumer.disconnect();
    await producer.disconnect();
    await driftMonitor.stop();
    await pgPool.end();
    redis.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((error) => {
  logger.fatal({ error }, 'Failed to start AI Service');
  process.exit(1);
});

import { Router } from 'express';
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { Kafka } from 'kafkajs';

const router = Router();

const pgPool = new Pool({
  host: process.env.PG_HOST,
  port: parseInt(process.env.PG_PORT || '5432', 10),
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER || 'sentinel_admin',
  password: process.env.PG_PASSWORD,
  max: 5,
  idleTimeoutMillis: 30000,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined,
});

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 1,
  connectTimeout: 5000,
  lazyConnect: true,
});

const kafka = new Kafka({
  clientId: 'api-gateway-health',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
});

const startTime = Date.now();

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  timestamp: string;
  checks: Record<string, { status: string; responseTimeMs: number; error?: string }>;
}

async function checkPostgres(): Promise<{ status: string; responseTimeMs: number; error?: string }> {
  const start = Date.now();
  try {
    await pgPool.query('SELECT 1');
    return { status: 'healthy', responseTimeMs: Date.now() - start };
  } catch (error: any) {
    return { status: 'unhealthy', responseTimeMs: Date.now() - start, error: error.message };
  }
}

async function checkRedis(): Promise<{ status: string; responseTimeMs: number; error?: string }> {
  const start = Date.now();
  try {
    await redis.ping();
    return { status: 'healthy', responseTimeMs: Date.now() - start };
  } catch (error: any) {
    return { status: 'unhealthy', responseTimeMs: Date.now() - start, error: error.message };
  }
}

async function checkKafka(): Promise<{ status: string; responseTimeMs: number; error?: string }> {
  const start = Date.now();
  try {
    const admin = kafka.admin();
    await admin.connect();
    await admin.listTopics();
    await admin.disconnect();
    return { status: 'healthy', responseTimeMs: Date.now() - start };
  } catch (error: any) {
    return { status: 'unhealthy', responseTimeMs: Date.now() - start, error: error.message };
  }
}

router.get('/live', (_req, res) => {
  res.status(200).json({ status: 'alive', timestamp: new Date().toISOString() });
});

router.get('/ready', async (_req, res) => {
  const [pg, rd, kf] = await Promise.all([checkPostgres(), checkRedis(), checkKafka()]);

  const checks = { postgres: pg, redis: rd, kafka: kf };
  const allHealthy = Object.values(checks).every((c) => c.status === 'healthy');
  const anyUnhealthy = Object.values(checks).some((c) => c.status === 'unhealthy');

  const health: HealthStatus = {
    status: allHealthy ? 'healthy' : anyUnhealthy ? 'unhealthy' : 'degraded',
    uptime: Date.now() - startTime,
    timestamp: new Date().toISOString(),
    checks,
  };

  res.status(allHealthy ? 200 : 503).json(health);
});

router.get('/', async (_req, res) => {
  const [pg, rd, kf] = await Promise.all([checkPostgres(), checkRedis(), checkKafka()]);

  const checks = { postgres: pg, redis: rd, kafka: kf };
  const allHealthy = Object.values(checks).every((c) => c.status === 'healthy');

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'degraded',
    uptime: Date.now() - startTime,
    timestamp: new Date().toISOString(),
    checks,
  });
});

export { router as healthRouter };

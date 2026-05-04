import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('drift-monitor');

interface DriftConfig {
  enabled: boolean;
  threshold: number;
  evaluationInterval: number;
}

interface PredictionSample {
  timestamp: number;
  metrics: Record<string, number>;
}

export class DriftMonitor {
  private pgPool: Pool;
  private redis: Redis;
  private config: DriftConfig;
  private baselines = new Map<string, Record<string, { mean: number; std: number }>>();
  private recentPredictions = new Map<string, PredictionSample[]>();
  private intervalHandle: NodeJS.Timeout | null = null;
  private windowSize = 1000;

  constructor(pgPool: Pool, redis: Redis, config: DriftConfig) {
    this.pgPool = pgPool;
    this.redis = redis;
    this.config = config;
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      logger.info('Drift monitoring disabled');
      return;
    }

    await this.loadBaselines();

    this.intervalHandle = setInterval(async () => {
      try {
        await this.evaluateAllModels();
      } catch (error) {
        logger.error({ error }, 'Drift evaluation failed');
      }
    }, this.config.evaluationInterval);

    logger.info({ threshold: this.config.threshold, interval: this.config.evaluationInterval },
      'Drift monitor started');
  }

  async stop(): Promise<void> {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async loadBaselines(): Promise<void> {
    try {
      const result = await this.pgPool.query(
        `SELECT DISTINCT ON (model_id, metric_name) model_id, metric_name, baseline_value, threshold
         FROM model_drift_metrics ORDER BY model_id, metric_name, measured_at DESC`
      );
      for (const row of result.rows) {
        const key = row.model_id;
        if (!this.baselines.has(key)) this.baselines.set(key, {});
        this.baselines.get(key)![row.metric_name] = {
          mean: row.baseline_value,
          std: row.threshold * 0.5,
        };
      }
      logger.info({ models: this.baselines.size }, 'Baselines loaded');
    } catch (error) {
      logger.error({ error }, 'Failed to load baselines');
    }
  }

  async recordPrediction(modelName: string, metrics: Record<string, number>): Promise<void> {
    if (!this.config.enabled) return;

    if (!this.recentPredictions.has(modelName)) {
      this.recentPredictions.set(modelName, []);
    }

    const samples = this.recentPredictions.get(modelName)!;
    samples.push({ timestamp: Date.now(), metrics });

    if (samples.length > this.windowSize) {
      samples.splice(0, samples.length - this.windowSize);
    }

    await this.redis.lpush(
      `sentinel:drift:${modelName}:samples`,
      JSON.stringify({ timestamp: Date.now(), metrics })
    );
    await this.redis.ltrim(`sentinel:drift:${modelName}:samples`, 0, this.windowSize - 1);
  }

  private async evaluateAllModels(): Promise<void> {
    for (const [modelName, samples] of this.recentPredictions) {
      if (samples.length < 100) continue;

      const baseline = this.baselines.get(modelName);
      if (!baseline) {
        await this.establishBaseline(modelName, samples);
        continue;
      }

      await this.evaluateModel(modelName, samples, baseline);
    }
  }

  private async establishBaseline(modelName: string, samples: PredictionSample[]): Promise<void> {
    const metricNames = Object.keys(samples[0].metrics);
    const baseline: Record<string, { mean: number; std: number }> = {};

    for (const metric of metricNames) {
      const values = samples.map(s => s.metrics[metric]).filter(v => v !== undefined);
      const mean = values.reduce((s, v) => s + v, 0) / values.length;
      const std = Math.sqrt(values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length);
      baseline[metric] = { mean, std: std || 0.001 };
    }

    this.baselines.set(modelName, baseline);
    logger.info({ modelName, metrics: metricNames.length }, 'Baseline established');
  }

  private async evaluateModel(
    modelName: string,
    samples: PredictionSample[],
    baseline: Record<string, { mean: number; std: number }>
  ): Promise<void> {
    const recentSamples = samples.slice(-100);

    for (const [metricName, baselineStats] of Object.entries(baseline)) {
      const values = recentSamples.map(s => s.metrics[metricName]).filter(v => v !== undefined);
      if (values.length === 0) continue;

      const currentMean = values.reduce((s, v) => s + v, 0) / values.length;
      const driftScore = Math.abs(currentMean - baselineStats.mean) / (baselineStats.std || 0.001);
      const isDrifted = driftScore > this.config.threshold / baselineStats.std;

      try {
        await this.pgPool.query(
          `INSERT INTO model_drift_metrics (model_id, metric_name, baseline_value, current_value, drift_score, threshold, is_drifted, sample_size)
           VALUES ((SELECT id FROM ai_models WHERE name = $1 AND status = 'ACTIVE' LIMIT 1), $2, $3, $4, $5, $6, $7, $8)`,
          [modelName, metricName, baselineStats.mean, currentMean, driftScore,
           this.config.threshold, isDrifted, values.length]
        );
      } catch (error) {
        logger.debug({ error, modelName, metricName }, 'Failed to insert drift metric');
      }

      if (isDrifted) {
        logger.warn({
          modelName, metricName, driftScore,
          baseline: baselineStats.mean, current: currentMean,
        }, 'Model drift detected');

        await this.redis.publish('sentinel:drift:alerts', JSON.stringify({
          modelName, metricName, driftScore,
          baselineValue: baselineStats.mean,
          currentValue: currentMean,
          threshold: this.config.threshold,
          timestamp: new Date().toISOString(),
        }));
      }
    }
  }

  async getMetrics(modelId: string): Promise<any[]> {
    const result = await this.pgPool.query(
      `SELECT * FROM model_drift_metrics WHERE model_id = $1 ORDER BY measured_at DESC LIMIT 100`,
      [modelId]
    );
    return result.rows;
  }
}

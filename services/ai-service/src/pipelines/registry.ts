import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('model-registry');

interface ModelRecord {
  id: string;
  name: string;
  version: string;
  modelType: string;
  framework: string;
  status: string;
  artifactPath: string;
  inputSchema: Record<string, any>;
  outputSchema: Record<string, any>;
  hyperparameters: Record<string, any>;
  trainingMetrics: Record<string, any>;
  validationMetrics: Record<string, any>;
  deployedAt: string | null;
}

export class ModelRegistry {
  private pgPool: Pool;
  private redis: Redis;
  private models = new Map<string, ModelRecord>();
  private cachePrefix = 'sentinel:models:';

  constructor(pgPool: Pool, redis: Redis) {
    this.pgPool = pgPool;
    this.redis = redis;
  }

  async initialize(): Promise<void> {
    try {
      const result = await this.pgPool.query(
        `SELECT * FROM ai_models WHERE status IN ('ACTIVE', 'VALIDATING') ORDER BY created_at DESC`
      );
      for (const row of result.rows) {
        this.models.set(`${row.name}:${row.version}`, this.rowToRecord(row));
        await this.redis.setex(
          `${this.cachePrefix}${row.name}:${row.version}`,
          3600,
          JSON.stringify(this.rowToRecord(row))
        );
      }
      logger.info({ count: this.models.size }, 'Model registry initialized');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize model registry');
    }
  }

  private rowToRecord(row: any): ModelRecord {
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      modelType: row.model_type,
      framework: row.framework,
      status: row.status,
      artifactPath: row.artifact_path,
      inputSchema: row.input_schema,
      outputSchema: row.output_schema,
      hyperparameters: row.hyperparameters,
      trainingMetrics: row.training_metrics,
      validationMetrics: row.validation_metrics,
      deployedAt: row.deployed_at,
    };
  }

  async getActiveModel(name: string): Promise<ModelRecord | null> {
    const cached = await this.redis.get(`${this.cachePrefix}${name}:active`);
    if (cached) return JSON.parse(cached);

    const result = await this.pgPool.query(
      `SELECT * FROM ai_models WHERE name = $1 AND status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1`,
      [name]
    );
    if (result.rows.length === 0) return null;

    const record = this.rowToRecord(result.rows[0]);
    await this.redis.setex(`${this.cachePrefix}${name}:active`, 3600, JSON.stringify(record));
    return record;
  }

  async registerModel(model: Omit<ModelRecord, 'id' | 'deployedAt'>): Promise<ModelRecord> {
    const result = await this.pgPool.query(
      `INSERT INTO ai_models (name, version, model_type, framework, status, artifact_path, input_schema, output_schema, hyperparameters, training_metrics, validation_metrics)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [model.name, model.version, model.modelType, model.framework, model.status,
       model.artifactPath, JSON.stringify(model.inputSchema), JSON.stringify(model.outputSchema),
       JSON.stringify(model.hyperparameters), JSON.stringify(model.trainingMetrics),
       JSON.stringify(model.validationMetrics)]
    );
    const record = this.rowToRecord(result.rows[0]);
    this.models.set(`${record.name}:${record.version}`, record);
    logger.info({ name: record.name, version: record.version }, 'Model registered');
    return record;
  }

  async deployModel(modelId: string): Promise<ModelRecord> {
    await this.pgPool.query(
      `UPDATE ai_models SET status = 'RETIRED', retired_at = NOW() WHERE name = (SELECT name FROM ai_models WHERE id = $1) AND status = 'ACTIVE'`,
      [modelId]
    );
    const result = await this.pgPool.query(
      `UPDATE ai_models SET status = 'ACTIVE', deployed_at = NOW() WHERE id = $1 RETURNING *`,
      [modelId]
    );
    const record = this.rowToRecord(result.rows[0]);
    await this.redis.del(`${this.cachePrefix}${record.name}:active`);
    this.models.set(`${record.name}:${record.version}`, record);
    logger.info({ name: record.name, version: record.version }, 'Model deployed');
    return record;
  }

  async retireModel(modelId: string): Promise<ModelRecord> {
    const result = await this.pgPool.query(
      `UPDATE ai_models SET status = 'RETIRED', retired_at = NOW() WHERE id = $1 RETURNING *`,
      [modelId]
    );
    const record = this.rowToRecord(result.rows[0]);
    await this.redis.del(`${this.cachePrefix}${record.name}:active`);
    this.models.delete(`${record.name}:${record.version}`);
    logger.info({ name: record.name, version: record.version }, 'Model retired');
    return record;
  }

  async rollbackModel(modelId: string, targetVersion: string): Promise<ModelRecord> {
    const nameResult = await this.pgPool.query('SELECT name FROM ai_models WHERE id = $1', [modelId]);
    if (nameResult.rows.length === 0) throw new Error('Model not found');
    const name = nameResult.rows[0].name;

    await this.pgPool.query(
      `UPDATE ai_models SET status = 'ROLLED_BACK' WHERE name = $1 AND status = 'ACTIVE'`, [name]
    );
    const result = await this.pgPool.query(
      `UPDATE ai_models SET status = 'ACTIVE', deployed_at = NOW() WHERE name = $1 AND version = $2 RETURNING *`,
      [name, targetVersion]
    );
    if (result.rows.length === 0) throw new Error(`Version ${targetVersion} not found for ${name}`);
    const record = this.rowToRecord(result.rows[0]);
    await this.redis.del(`${this.cachePrefix}${name}:active`);
    logger.info({ name, version: targetVersion }, 'Model rolled back');
    return record;
  }

  async listModels(): Promise<ModelRecord[]> {
    const result = await this.pgPool.query('SELECT * FROM ai_models ORDER BY name, created_at DESC');
    return result.rows.map(this.rowToRecord);
  }
}

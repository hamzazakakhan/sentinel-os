import DataLoader from 'dataloader';
import { Pool } from 'pg';
import type { AuthenticatedUser } from './context.js';
import type { DataLoaderMap } from './context.js';

const pgPool = new Pool({
  host: process.env.PG_HOST,
  port: parseInt(process.env.PG_PORT || '5432', 10),
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER || 'sentinel_admin',
  password: process.env.PG_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined,
});

async function batchLoadByIds(tableName: string, ids: readonly string[], user: AuthenticatedUser | null): Promise<any[]> {
  const client = await pgPool.connect();
  try {
    if (user) {
      await client.query(`SET LOCAL app.current_user_id = '${user.id}'`);
    }
    const result = await client.query(
      `SELECT * FROM ${tableName} WHERE id = ANY($1::uuid[])`,
      [ids as string[]],
    );
    const map = new Map(result.rows.map((row: any) => [row.id, row]));
    return ids.map((id) => map.get(id) || null);
  } finally {
    client.release();
  }
}

export function createDataLoaders(user: AuthenticatedUser | null): DataLoaderMap {
  return {
    userLoader: new DataLoader<string, any>(
      (ids) => batchLoadByIds('users', ids, user),
      { maxBatchSize: 100, cache: true },
    ),
    organizationLoader: new DataLoader<string, any>(
      (ids) => batchLoadByIds('organizations', ids, user),
      { maxBatchSize: 100, cache: true },
    ),
    sensorLoader: new DataLoader<string, any>(
      (ids) => batchLoadByIds('sensors', ids, user),
      { maxBatchSize: 100, cache: true },
    ),
    alertLoader: new DataLoader<string, any>(
      (ids) => batchLoadByIds('alerts', ids, user),
      { maxBatchSize: 100, cache: true },
    ),
    missionLoader: new DataLoader<string, any>(
      (ids) => batchLoadByIds('missions', ids, user),
      { maxBatchSize: 100, cache: true },
    ),
    trackLoader: new DataLoader<string, any>(
      (ids) => batchLoadByIds('tracks', ids, user),
      { maxBatchSize: 100, cache: true },
    ),
    modelLoader: new DataLoader<string, any>(
      (ids) => batchLoadByIds('ai_models', ids, user),
      { maxBatchSize: 100, cache: true },
    ),
  };
}

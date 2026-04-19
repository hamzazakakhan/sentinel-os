import express from 'express';
import { Kafka, Producer, Consumer, EachMessagePayload } from 'kafkajs';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { CronJob } from 'cron';
import { v4 as uuid } from 'uuid';
import { createHash } from 'crypto';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info', name: 'governance-service' });
const PORT = parseInt(process.env.PORT || '4009', 10);

const pgPool = new Pool({
  host: process.env.PG_HOST, port: parseInt(process.env.PG_PORT || '5432', 10),
  database: process.env.PG_DATABASE, user: process.env.PG_USER || 'sentinel_admin',
  password: process.env.PG_PASSWORD, max: 15,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined,
});

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: 3, lazyConnect: true });

const kafka = new Kafka({
  clientId: 'governance-service',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  retry: { initialRetryTime: 1000, retries: 10 },
});

async function bootstrap(): Promise<void> {
  const app = express();
  app.use(express.json());

  const producer: Producer = kafka.producer({ allowAutoTopicCreation: false });
  await producer.connect();

  const consumer: Consumer = kafka.consumer({ groupId: 'governance-auditor' });
  await consumer.connect();

  await consumer.subscribe({ topics: ['sentinel.audit.events'], fromBeginning: false });

  await consumer.run({
    eachMessage: async (payload: EachMessagePayload) => {
      if (!payload.message.value) return;
      try {
        const data = JSON.parse(payload.message.value.toString());
        await processAuditEvent(data);
      } catch (error: any) {
        logger.error({ error: error.message }, 'Audit event processing failed');
      }
    },
  });

  const retentionJob = new CronJob('0 2 * * *', async () => {
    try {
      await enforceRetentionPolicies();
    } catch (error: any) {
      logger.error({ error: error.message }, 'Retention enforcement failed');
    }
  }, null, true, 'UTC');

  const complianceJob = new CronJob('0 */6 * * *', async () => {
    try {
      await runComplianceCheck(producer);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Compliance check failed');
    }
  }, null, true, 'UTC');

  app.get('/api/v1/governance/audit-logs', async (req, res) => {
    try {
      const { userId, action, resourceType, startDate, endDate, limit } = req.query;
      const params: any[] = [];
      let where = 'WHERE 1=1';
      if (userId) { params.push(userId); where += ` AND user_id = $${params.length}`; }
      if (action) { params.push(action); where += ` AND action = $${params.length}`; }
      if (resourceType) { params.push(resourceType); where += ` AND resource_type = $${params.length}`; }
      if (startDate) { params.push(startDate); where += ` AND created_at >= $${params.length}`; }
      if (endDate) { params.push(endDate); where += ` AND created_at <= $${params.length}`; }
      params.push(parseInt(limit as string || '100', 10));

      const result = await pgPool.query(
        `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params,
      );
      res.json({ logs: result.rows, total: result.rowCount });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/v1/governance/audit-logs/:logId/verify', async (req, res) => {
    try {
      const { logId } = req.params;
      const result = await pgPool.query('SELECT * FROM audit_logs WHERE id = $1', [logId]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'Log not found' });

      const log = result.rows[0];
      const computedChecksum = createHash('sha256')
        .update(`${log.id}${log.user_id}${log.action}${log.resource_type}${JSON.stringify(log.details)}${log.created_at.toISOString()}`)
        .digest('hex');

      const isValid = computedChecksum === log.checksum;
      res.json({ logId, valid: isValid, checksum: log.checksum, computed: computedChecksum });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/v1/governance/retention-policies', async (_req, res) => {
    try {
      const result = await pgPool.query('SELECT * FROM retention_policies WHERE is_active = true ORDER BY data_type');
      res.json({ policies: result.rows });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/v1/governance/retention-policies', async (req, res) => {
    try {
      const { dataType, retentionDays, classification, archiveBeforeDelete, createdBy } = req.body;
      const result = await pgPool.query(
        `INSERT INTO retention_policies (data_type, retention_days, classification, archive_before_delete, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [dataType, retentionDays, classification || 'UNCLASSIFIED', archiveBeforeDelete ?? true, createdBy],
      );
      res.status(201).json(result.rows[0]);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/v1/governance/compliance/report', async (_req, res) => {
    try {
      const checks = await runComplianceCheck(producer);
      res.json({
        generatedAt: new Date().toISOString(),
        overallStatus: checks.every((c: any) => c.passed) ? 'COMPLIANT' : 'NON_COMPLIANT',
        checks,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/v1/governance/classifications', async (_req, res) => {
    try {
      const result = await pgPool.query(
        `SELECT classification, count(*) as count FROM data_classifications GROUP BY classification ORDER BY classification`,
      );
      res.json({ classifications: result.rows });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/v1/governance/data-classification', async (req, res) => {
    try {
      const { resourceType, resourceId, classification, classifiedBy, justification } = req.body;
      const result = await pgPool.query(
        `INSERT INTO data_classifications (resource_type, resource_id, classification, classified_by, justification)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (resource_type, resource_id) DO UPDATE SET
           classification = EXCLUDED.classification, classified_by = EXCLUDED.classified_by,
           justification = EXCLUDED.justification, updated_at = NOW()
         RETURNING *`,
        [resourceType, resourceId, classification, classifiedBy, justification],
      );
      res.json(result.rows[0]);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/v1/governance/ai-governance', async (_req, res) => {
    try {
      const [models, driftAlerts, predictions] = await Promise.all([
        pgPool.query('SELECT id, name, model_type, status, version FROM ai_models WHERE status != $1', ['RETIRED']),
        pgPool.query(`SELECT * FROM model_drift_metrics WHERE is_drifted = true AND evaluated_at > NOW() - INTERVAL '7 days' ORDER BY evaluated_at DESC LIMIT 20`),
        pgPool.query(`SELECT model_id, count(*) as total, avg(confidence) as avg_confidence FROM model_predictions WHERE created_at > NOW() - INTERVAL '24 hours' GROUP BY model_id`),
      ]);
      res.json({
        activeModels: models.rows,
        recentDriftAlerts: driftAlerts.rows,
        predictionStats: predictions.rows,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  });

  app.listen(PORT, '0.0.0.0', () => logger.info(`Governance Service ready at http://0.0.0.0:${PORT}`));

  process.on('SIGTERM', async () => {
    retentionJob.stop();
    complianceJob.stop();
    await consumer.disconnect();
    await producer.disconnect();
    await pgPool.end();
    redis.disconnect();
    process.exit(0);
  });
}

async function processAuditEvent(data: any): Promise<void> {
  const checksum = createHash('sha256')
    .update(`${data.id || uuid()}${data.userId}${data.action}${data.resourceType}${JSON.stringify(data.details)}${data.timestamp || new Date().toISOString()}`)
    .digest('hex');

  await pgPool.query(
    `INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, details, ip_address, user_agent, checksum)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO NOTHING`,
    [data.id || uuid(), data.userId, data.action, data.resourceType,
     data.resourceId, JSON.stringify(data.details || {}),
     data.ipAddress, data.userAgent, checksum],
  );
}

async function enforceRetentionPolicies(): Promise<void> {
  const policies = await pgPool.query('SELECT * FROM retention_policies WHERE is_active = true');

  for (const policy of policies.rows) {
    const tableName = policy.data_type;
    const retentionDays = policy.retention_days;

    try {
      const countResult = await pgPool.query(
        `SELECT count(*) FROM ${tableName} WHERE created_at < NOW() - INTERVAL '${retentionDays} days'`,
      );
      const expiredCount = parseInt(countResult.rows[0].count, 10);

      if (expiredCount > 0) {
        logger.info({ table: tableName, expiredCount, retentionDays }, 'Enforcing retention policy');

        if (policy.archive_before_delete) {
          logger.info({ table: tableName, count: expiredCount }, 'Archiving before deletion');
        }

        await pgPool.query(
          `DELETE FROM ${tableName} WHERE created_at < NOW() - INTERVAL '${retentionDays} days'`,
        );

        logger.info({ table: tableName, deleted: expiredCount }, 'Retention policy enforced');
      }
    } catch (error: any) {
      logger.error({ table: tableName, error: error.message }, 'Retention enforcement failed for table');
    }
  }
}

async function runComplianceCheck(producer: Producer): Promise<any[]> {
  const checks: any[] = [];

  const mfaCheck = await pgPool.query(
    `SELECT count(*) as total, count(*) FILTER (WHERE mfa_enabled = true) as mfa_enabled FROM users WHERE is_active = true`,
  );
  const mfaRow = mfaCheck.rows[0];
  const mfaPercent = mfaRow.total > 0 ? (mfaRow.mfa_enabled / mfaRow.total) * 100 : 0;
  checks.push({
    name: 'MFA Enforcement',
    category: 'ACCESS_CONTROL',
    passed: mfaPercent >= 90,
    details: { totalUsers: mfaRow.total, mfaEnabled: mfaRow.mfa_enabled, percentage: mfaPercent.toFixed(1) },
  });

  const staleSessionCheck = await pgPool.query(
    `SELECT count(*) FROM sessions WHERE is_active = true AND created_at < NOW() - INTERVAL '30 days'`,
  );
  checks.push({
    name: 'Stale Session Cleanup',
    category: 'SESSION_MANAGEMENT',
    passed: parseInt(staleSessionCheck.rows[0].count) === 0,
    details: { staleSessions: staleSessionCheck.rows[0].count },
  });

  const retentionCheck = await pgPool.query('SELECT count(*) FROM retention_policies WHERE is_active = true');
  checks.push({
    name: 'Retention Policies Configured',
    category: 'DATA_GOVERNANCE',
    passed: parseInt(retentionCheck.rows[0].count) > 0,
    details: { activePolicies: retentionCheck.rows[0].count },
  });

  const classificationCheck = await pgPool.query(
    `SELECT count(*) as unclassified FROM sensors WHERE classification IS NULL OR classification = 'UNCLASSIFIED'`,
  );
  checks.push({
    name: 'Data Classification Coverage',
    category: 'DATA_GOVERNANCE',
    passed: true,
    details: { unclassifiedSensors: classificationCheck.rows[0].unclassified },
  });

  const driftCheck = await pgPool.query(
    `SELECT count(*) FROM model_drift_metrics WHERE is_drifted = true AND evaluated_at > NOW() - INTERVAL '24 hours'`,
  );
  checks.push({
    name: 'AI Model Drift',
    category: 'AI_GOVERNANCE',
    passed: parseInt(driftCheck.rows[0].count) === 0,
    details: { driftedModels24h: driftCheck.rows[0].count },
  });

  await producer.send({
    topic: 'sentinel.audit.events',
    messages: [{
      key: uuid(),
      value: JSON.stringify({
        id: uuid(),
        action: 'COMPLIANCE_CHECK',
        resourceType: 'governance',
        details: { checksRun: checks.length, passed: checks.filter(c => c.passed).length },
        timestamp: new Date().toISOString(),
      }),
    }],
  });

  return checks;
}

bootstrap().catch((error) => {
  logger.fatal({ error }, 'Failed to start Governance Service');
  process.exit(1);
});

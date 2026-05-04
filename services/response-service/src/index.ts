import express from 'express';
import { Kafka, Producer, Consumer, EachMessagePayload } from 'kafkajs';
import { Redis } from 'ioredis';
import { Pool } from 'pg';
import axios from 'axios';
import { v4 as uuid } from 'uuid';
import { pino } from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info', name: 'response-service' });
const PORT = parseInt(process.env.PORT || '4007', 10);

const pgPool = new Pool({
  host: process.env.PG_HOST, port: parseInt(process.env.PG_PORT || '5432', 10),
  database: process.env.PG_DATABASE, user: process.env.PG_USER || 'sentinel_admin',
  password: process.env.PG_PASSWORD, max: 15,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined,
});

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: 3, lazyConnect: true });

const kafka = new Kafka({
  clientId: 'response-service',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  retry: { initialRetryTime: 1000, retries: 10 },
});

interface ResponseRule {
  id: string;
  name: string;
  conditions: RuleCondition[];
  actions: RuleAction[];
  actionType: string;
  severityThreshold: string;
  requiresApproval: boolean;
  approvalTimeoutMin: number;
  cooldownMinutes: number;
  maxExecutionsPerHour: number;
  priority: number;
  isActive: boolean;
}

interface RuleCondition {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'in' | 'regex';
  value: any;
}

interface RuleAction {
  type: string;
  params: Record<string, any>;
}

const SEVERITY_ORDER: Record<string, number> = {
  'LOW': 1, 'MEDIUM': 2, 'HIGH': 3, 'CRITICAL': 4,
};

async function bootstrap(): Promise<void> {
  const app = express();
  app.use(express.json());

  const producer: Producer = kafka.producer({ allowAutoTopicCreation: false });
  await producer.connect();

  const consumer: Consumer = kafka.consumer({ groupId: 'response-service-engine' });
  await consumer.connect();

  let rules: ResponseRule[] = [];
  await loadRules();

  async function loadRules(): Promise<void> {
    const result = await pgPool.query(
      `SELECT * FROM response_rules WHERE is_active = true ORDER BY priority ASC`,
    );
    rules = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      conditions: row.conditions,
      actions: row.actions,
      actionType: row.action_type,
      severityThreshold: row.severity_threshold,
      requiresApproval: row.requires_approval,
      approvalTimeoutMin: row.approval_timeout_min,
      cooldownMinutes: row.cooldown_minutes,
      maxExecutionsPerHour: row.max_executions_per_hour,
      priority: row.priority,
      isActive: row.is_active,
    }));
    logger.info({ ruleCount: rules.length }, 'Response rules loaded');
  }

  setInterval(loadRules, 60000);

  await consumer.subscribe({
    topics: ['sentinel.alerts.created', 'sentinel.alerts.updated', 'sentinel.cyber.raw-events'],
    fromBeginning: false,
  });

  await consumer.run({
    autoCommit: true,
    autoCommitInterval: 5000,
    partitionsConsumedConcurrently: 2,
    eachMessage: async (payload: EachMessagePayload) => {
      if (!payload.message.value) return;
      try {
        const data = JSON.parse(payload.message.value.toString());
        await evaluateRules(data, payload.topic, producer);
      } catch (error: any) {
        logger.error({ error: error.message, topic: payload.topic }, 'Rule evaluation failed');
      }
    },
  });

  app.get('/api/v1/response/rules', async (_req, res) => {
    res.json({ rules, count: rules.length });
  });

  app.post('/api/v1/response/rules', async (req, res) => {
    try {
      const input = req.body;
      const result = await pgPool.query(
        `INSERT INTO response_rules (organization_id, name, description, conditions, actions, action_type, severity_threshold, requires_approval, approval_timeout_min, cooldown_minutes, max_executions_per_hour, priority, created_by, classification)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
        [input.organizationId, input.name, input.description, JSON.stringify(input.conditions),
         JSON.stringify(input.actions), input.actionType, input.severityThreshold,
         input.requiresApproval ?? true, input.approvalTimeoutMin || 15,
         input.cooldownMinutes || 5, input.maxExecutionsPerHour || 10,
         input.priority || 100, input.createdBy, input.classification || 'CONFIDENTIAL'],
      );
      await loadRules();
      res.status(201).json(result.rows[0]);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/v1/response/rules/:ruleId', async (req, res) => {
    try {
      const { ruleId } = req.params;
      const input = req.body;
      const setClauses: string[] = [];
      const params: any[] = [ruleId];

      if (input.name) { params.push(input.name); setClauses.push(`name = $${params.length}`); }
      if (input.conditions) { params.push(JSON.stringify(input.conditions)); setClauses.push(`conditions = $${params.length}`); }
      if (input.actions) { params.push(JSON.stringify(input.actions)); setClauses.push(`actions = $${params.length}`); }
      if (input.isActive !== undefined) { params.push(input.isActive); setClauses.push(`is_active = $${params.length}`); }
      if (input.priority !== undefined) { params.push(input.priority); setClauses.push(`priority = $${params.length}`); }
      if (input.requiresApproval !== undefined) { params.push(input.requiresApproval); setClauses.push(`requires_approval = $${params.length}`); }

      if (setClauses.length === 0) return res.status(400).json({ error: 'No fields to update' });

      const result = await pgPool.query(
        `UPDATE response_rules SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`, params,
      );
      await loadRules();
      res.json(result.rows[0]);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/v1/response/executions', async (req, res) => {
    try {
      const { ruleId, status, limit } = req.query;
      const params: any[] = [];
      let where = 'WHERE 1=1';
      if (ruleId) { params.push(ruleId); where += ` AND rule_id = $${params.length}`; }
      if (status) { params.push(status); where += ` AND approval_status = $${params.length}`; }
      params.push(parseInt(limit as string || '50', 10));
      const result = await pgPool.query(
        `SELECT * FROM response_executions ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params,
      );
      res.json({ executions: result.rows, count: result.rowCount });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/v1/response/executions/:executionId/approve', async (req, res) => {
    try {
      const { executionId } = req.params;
      const { approverId, notes } = req.body;

      await pgPool.query(
        `UPDATE approval_requests SET status = 'APPROVED', approver_id = $2, decided_at = NOW(), decision_notes = $3
         WHERE execution_id = $1 AND status = 'PENDING'`,
        [executionId, approverId, notes],
      );

      const execResult = await pgPool.query(
        `UPDATE response_executions SET approval_status = 'APPROVED', approved_by = $2, approved_at = NOW()
         WHERE id = $1 RETURNING *`,
        [executionId, approverId],
      );

      if (execResult.rows.length > 0) {
        const execution = execResult.rows[0];
        await executeActions(execution, producer);
        await producer.send({
          topic: 'sentinel.response.executed',
          messages: [{ key: executionId, value: JSON.stringify(execution) }],
        });
      }

      res.json({ status: 'approved', executionId });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/v1/response/executions/:executionId/reject', async (req, res) => {
    try {
      const { executionId } = req.params;
      const { approverId, notes } = req.body;

      await pgPool.query(
        `UPDATE approval_requests SET status = 'REJECTED', approver_id = $2, decided_at = NOW(), decision_notes = $3
         WHERE execution_id = $1 AND status = 'PENDING'`,
        [executionId, approverId, notes],
      );

      await pgPool.query(
        `UPDATE response_executions SET approval_status = 'REJECTED' WHERE id = $1`,
        [executionId],
      );

      res.json({ status: 'rejected', executionId });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/v1/response/pending-approvals', async (req, res) => {
    try {
      const result = await pgPool.query(
        `SELECT ar.*, re.rule_id, re.trigger_data, rr.name as rule_name
         FROM approval_requests ar
         JOIN response_executions re ON ar.execution_id = re.id
         JOIN response_rules rr ON re.rule_id = rr.id
         WHERE ar.status = 'PENDING' AND ar.expires_at > NOW()
         ORDER BY ar.created_at ASC`,
      );
      res.json({ approvals: result.rows, count: result.rowCount });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/v1/response/test-rule', async (req, res) => {
    try {
      const { rule, testData } = req.body;
      const matches = evaluateConditions(rule.conditions, testData);
      res.json({ matches, conditions: rule.conditions.length, testData });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      activeRules: rules.length,
      timestamp: new Date().toISOString(),
    });
  });

  app.listen(PORT, '0.0.0.0', () => logger.info(`Response Service ready at http://0.0.0.0:${PORT}`));

  process.on('SIGTERM', async () => {
    await consumer.disconnect();
    await producer.disconnect();
    await pgPool.end();
    redis.disconnect();
    process.exit(0);
  });
}

async function evaluateRules(data: any, topic: string, producer: Producer): Promise<void> {
  for (const rule of (await getRules())) {
    if (!rule.isActive) continue;

    if (rule.severityThreshold && data.severity) {
      const dataSev = SEVERITY_ORDER[data.severity] || 0;
      const threshSev = SEVERITY_ORDER[rule.severityThreshold] || 0;
      if (dataSev < threshSev) continue;
    }

    const matches = evaluateConditions(rule.conditions, data);
    if (!matches) continue;

    const cooldownKey = `sentinel:response:cooldown:${rule.id}`;
    const inCooldown = await redis.get(cooldownKey);
    if (inCooldown) {
      logger.debug({ ruleId: rule.id }, 'Rule in cooldown, skipping');
      continue;
    }

    const hourKey = `sentinel:response:hourly:${rule.id}`;
    const hourCount = parseInt(await redis.get(hourKey) || '0', 10);
    if (hourCount >= rule.maxExecutionsPerHour) {
      logger.warn({ ruleId: rule.id, count: hourCount }, 'Rule hourly limit reached');
      continue;
    }

    const executionId = uuid();
    logger.info({ ruleId: rule.id, ruleName: rule.name, executionId, alertId: data.id }, 'Rule triggered');

    await pgPool.query(
      `INSERT INTO response_executions (id, rule_id, trigger_data, trigger_topic, approval_status, organization_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [executionId, rule.id, JSON.stringify(data), topic,
       rule.requiresApproval ? 'PENDING' : 'AUTO_APPROVED',
       data.organizationId || null],
    );

    await redis.setex(cooldownKey, rule.cooldownMinutes * 60, '1');
    await redis.incr(hourKey);
    await redis.expire(hourKey, 3600);

    if (rule.requiresApproval) {
      await pgPool.query(
        `INSERT INTO approval_requests (id, execution_id, approver_role, expires_at)
         VALUES ($1, $2, $3, NOW() + INTERVAL '${rule.approvalTimeoutMin} minutes')`,
        [uuid(), executionId, 'COMMANDER'],
      );

      await producer.send({
        topic: 'sentinel.response.approvals',
        messages: [{
          key: executionId,
          value: JSON.stringify({
            executionId,
            ruleId: rule.id,
            ruleName: rule.name,
            actions: rule.actions,
            triggerSummary: {
              alertId: data.id, title: data.title, severity: data.severity, domain: data.domain,
            },
            requiresApprovalBy: new Date(Date.now() + rule.approvalTimeoutMin * 60000).toISOString(),
            createdAt: new Date().toISOString(),
          }),
        }],
      });

      logger.info({ executionId, ruleId: rule.id }, 'Approval requested');
    } else {
      const execution = { id: executionId, rule_id: rule.id, trigger_data: data, actions: rule.actions };
      await executeActions(execution, producer);

      await pgPool.query(
        `UPDATE response_executions SET approval_status = 'AUTO_APPROVED', executed_at = NOW(), execution_result = $2
         WHERE id = $1`,
        [executionId, JSON.stringify({ status: 'executed', timestamp: new Date().toISOString() })],
      );

      await producer.send({
        topic: 'sentinel.response.executed',
        messages: [{ key: executionId, value: JSON.stringify(execution) }],
      });

      logger.info({ executionId, ruleId: rule.id }, 'Auto-approved and executed');
    }
  }
}

async function getRules(): Promise<ResponseRule[]> {
  const cached = await redis.get('sentinel:response:rules');
  if (cached) return JSON.parse(cached);

  const result = await pgPool.query('SELECT * FROM response_rules WHERE is_active = true ORDER BY priority');
  const rules = result.rows.map((row: any) => ({
    id: row.id, name: row.name, conditions: row.conditions, actions: row.actions,
    actionType: row.action_type, severityThreshold: row.severity_threshold,
    requiresApproval: row.requires_approval, approvalTimeoutMin: row.approval_timeout_min,
    cooldownMinutes: row.cooldown_minutes, maxExecutionsPerHour: row.max_executions_per_hour,
    priority: row.priority, isActive: row.is_active,
  }));

  await redis.setex('sentinel:response:rules', 60, JSON.stringify(rules));
  return rules;
}

function evaluateConditions(conditions: RuleCondition[], data: any): boolean {
  return conditions.every(cond => {
    const value = getNestedValue(data, cond.field);
    if (value === undefined) return false;

    switch (cond.operator) {
      case 'eq': return value === cond.value;
      case 'ne': return value !== cond.value;
      case 'gt': return value > cond.value;
      case 'lt': return value < cond.value;
      case 'gte': return value >= cond.value;
      case 'lte': return value <= cond.value;
      case 'contains': return String(value).includes(String(cond.value));
      case 'in': return Array.isArray(cond.value) && cond.value.includes(value);
      case 'regex': return new RegExp(String(cond.value)).test(String(value));
      default: return false;
    }
  });
}

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

async function executeActions(execution: any, producer: Producer): Promise<void> {
  const actions = execution.actions || [];
  const triggerData = typeof execution.trigger_data === 'string'
    ? JSON.parse(execution.trigger_data) : execution.trigger_data;

  for (const action of actions) {
    try {
      switch (action.type) {
        case 'BLOCK_IP':
          logger.info({ ip: action.params.ip || triggerData?.metadata?.srcIp }, 'Executing BLOCK_IP');
          if (action.params.firewallApi) {
            await axios.post(action.params.firewallApi, {
              action: 'block', ip: action.params.ip || triggerData?.metadata?.srcIp,
              duration: action.params.duration || '24h',
            }, { timeout: 10000 });
          }
          break;

        case 'ISOLATE_HOST':
          logger.info({ host: action.params.host }, 'Executing ISOLATE_HOST');
          break;

        case 'ESCALATE_ALERT':
          await producer.send({
            topic: 'sentinel.alerts.updated',
            messages: [{
              key: triggerData?.id || uuid(),
              value: JSON.stringify({
                ...triggerData,
                severity: action.params.newSeverity || 'CRITICAL',
                escalatedBy: 'response-engine',
                escalatedAt: new Date().toISOString(),
              }),
            }],
          });
          break;

        case 'NOTIFY':
          logger.info({ channel: action.params.channel, recipients: action.params.recipients }, 'Sending notification');
          if (action.params.webhookUrl) {
            await axios.post(action.params.webhookUrl, {
              type: 'sentinel-alert',
              execution: execution.id,
              message: action.params.message || `Alert triggered: ${triggerData?.title}`,
              severity: triggerData?.severity,
              timestamp: new Date().toISOString(),
            }, { timeout: 10000 });
          }
          break;

        case 'CREATE_TASK':
          await pgPool.query(
            `INSERT INTO tasks (organization_id, title, description, priority, classification)
             VALUES ($1, $2, $3, $4, $5)`,
            [triggerData?.organizationId, action.params.title || `Investigate: ${triggerData?.title}`,
             action.params.description || `Auto-generated from response rule. Alert: ${triggerData?.id}`,
             action.params.priority || 1, action.params.classification || 'CONFIDENTIAL'],
          );
          break;

        case 'UPDATE_SURICATA_RULES':
          logger.info('Updating Suricata rules');
          break;

        case 'QUARANTINE_FILE':
          logger.info({ fileHash: action.params.fileHash }, 'Quarantining file');
          break;

        case 'DEPLOY_HONEYPOT':
          logger.info({ type: action.params.honeypotType }, 'Deploying honeypot');
          break;

        default:
          logger.warn({ actionType: action.type }, 'Unknown action type');
      }
    } catch (error: any) {
      logger.error({ actionType: action.type, error: error.message }, 'Action execution failed');
    }
  }
}

bootstrap().catch((error) => {
  logger.fatal({ error }, 'Failed to start Response Service');
  process.exit(1);
});

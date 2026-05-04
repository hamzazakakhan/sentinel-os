// ──────────────────────────────────────────────────────────────
// sentinel-os/services/healing-agent/src/index.ts
// Healing Agent — 11th microservice (port 4011)
// Central self-healing brain: MAPE-K loop, runbook execution,
// Ollama RCA, eBPF event consumption, Prometheus alert handling
// ──────────────────────────────────────────────────────────────

import express from 'express';
import { Kafka } from 'kafkajs';
import { createLogger } from './utils/logger.js';
import { RunbookEngine } from './runbooks/engine.js';
import { RcaEngine } from './rca/engine.js';
import { HealthMonitor } from './monitoring/health.js';
import { TamperResponder } from './security/tamper-responder.js';

const logger = createLogger('healing-agent');

const PORT = parseInt(process.env.PORT || '4011', 10);
const KAFKA_BROKER = process.env.KAFKA_BROKERS || 'localhost:9092';
const OLLAMA_URL = process.env.OLLAMA_BASE_URL || 'http://ollama:11434';

const kafka = new Kafka({
  brokers: [KAFKA_BROKER],
  clientId: 'healing-agent',
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: 'healing-agent-group' });

const app = express();
app.use(express.json());

// ── Core components ───────────────────────────────────────────
const runbookEngine = new RunbookEngine();
const rcaEngine = new RcaEngine(OLLAMA_URL);
const healthMonitor = new HealthMonitor();
const tamperResponder = new TamperResponder();

// ── Health endpoints ──────────────────────────────────────────
app.get('/healthz', (_req, res) => {
  res.json({
    status: 'ok',
    runbooks: runbookEngine.getRunbookCount(),
    activeIncidents: healthMonitor.getActiveIncidentCount(),
    healsPerformed: healthMonitor.getTotalHealCount(),
  });
});

app.get('/health/live', (_req, res) => res.json({ alive: true }));
app.get('/health/ready', (_req, res) => res.json({ ready: true }));
app.get('/health/startup', (_req, res) => res.json({ started: true }));

// ── API endpoints ─────────────────────────────────────────────
app.get('/api/v1/incidents', (_req, res) => {
  res.json({ incidents: healthMonitor.getActiveIncidents() });
});

app.get('/api/v1/heals', (_req, res) => {
  res.json({ heals: healthMonitor.getRecentHeals() });
});

app.get('/api/v1/runbooks', (_req, res) => {
  res.json({ runbooks: runbookEngine.listRunbooks() });
});

app.post('/api/v1/incidents/:id/acknowledge', (req, res) => {
  const { id } = req.params;
  healthMonitor.acknowledgeIncident(id);
  res.json({ acknowledged: true });
});

app.post('/api/v1/incidents/:id/force-heal', async (req, res) => {
  const { id } = req.params;
  const incident = healthMonitor.getIncident(id);
  if (!incident) {
    res.status(404).json({ error: 'Incident not found' });
    return;
  }

  const result = await runbookEngine.execute(incident.type, incident);
  res.json({ healed: result.success, action: result.action });
});

// ── Prometheus Alertmanager webhook ───────────────────────────
app.post('/webhooks/alertmanager', async (req, res) => {
  const alerts = req.body?.alerts || [];
  logger.info({ alertCount: alerts.length }, 'Alertmanager webhook received');

  for (const alert of alerts) {
    const incident = healthMonitor.createIncident({
      serviceName: alert.labels?.service || 'unknown',
      alertName: alert.labels?.alertname || 'unknown',
      severity: alert.labels?.severity || 'warning',
      message: alert.annotations?.message || alert.status,
      status: alert.status,
      labels: alert.labels,
    });

    await handleIncident(incident);
  }

  res.json({ processed: alerts.length });
});

// ── Incident handling (MAPE-K loop) ──────────────────────────
async function handleIncident(incident: any): Promise<void> {
  logger.info({ id: incident.id, type: incident.type, service: incident.serviceName }, 'Processing incident');

  try {
    // 1. ANALYZE: Check if runbook exists for this incident type
    const hasRunbook = runbookEngine.hasRunbook(incident.type);

    if (hasRunbook) {
      // 2. PLAN: Select runbook
      logger.info({ type: incident.type }, 'Runbook found — executing');

      // 3. EXECUTE: Run the automated healing action
      const result = await runbookEngine.execute(incident.type, incident);

      if (result.success) {
        healthMonitor.markHealed(incident.id, result.action);
        await publishHealingEvent(incident, result, 'AUTO_HEALED');
        logger.info({ id: incident.id, action: result.action }, 'Incident auto-healed');
      } else {
        // Escalate to Ollama RCA
        logger.warn({ id: incident.id }, 'Runbook failed — escalating to RCA');
        const rcaResult = await rcaEngine.analyze(incident);
        healthMonitor.markEscalated(incident.id, rcaResult);
        await publishHealingEvent(incident, rcaResult, 'ESCALATED');
      }
    } else {
      // No runbook — use Ollama for root cause analysis
      logger.info({ type: incident.type }, 'No runbook — running RCA');
      const rcaResult = await rcaEngine.analyze(incident);
      healthMonitor.markEscalated(incident.id, rcaResult);
      await publishHealingEvent(incident, rcaResult, 'RCA_ONLY');
    }
  } catch (err: any) {
    logger.error({ err: err.message, incidentId: incident.id }, 'Incident handling failed');
    healthMonitor.markFailed(incident.id, err.message);
  }
}

async function publishHealingEvent(incident: any, result: any, outcome: string): Promise<void> {
  try {
    await producer.send({
      topic: 'sentinel.healing.events',
      messages: [{
        key: incident.id,
        value: JSON.stringify({
          incidentId: incident.id,
          serviceName: incident.serviceName,
          incidentType: incident.type,
          outcome,
          action: result.action || result.recommendation,
          timestamp: new Date().toISOString(),
          details: result,
        }),
      }],
    });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to publish healing event');
  }
}

// ── Kafka consumer for security tamper events ────────────────
async function startKafkaConsumer(): Promise<void> {
  await consumer.connect();
  await consumer.subscribe({ topic: 'sentinel.security.tamper', fromBeginning: false });
  await consumer.subscribe({ topic: 'sentinel.healing.commands', fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      const payload = JSON.parse(message.value?.toString() || '{}');

      if (topic === 'sentinel.security.tamper') {
        logger.warn({ payload }, 'Code tamper event received from Falco/IMA/RASP');
        const incident = healthMonitor.createIncident({
          serviceName: payload.service || 'unknown',
          alertName: 'TAMPER_DETECTED',
          severity: 'CRITICAL',
          message: payload.detail || 'Code integrity violation',
          type: 'TAMPER',
          ...payload,
        });

        // Execute tamper response sequence
        const result = await tamperResponder.respond(incident);
        await publishHealingEvent(incident, result, result.success ? 'TAMPER_RESTORED' : 'TAMPER_ESCALATED');
      }

      if (topic === 'sentinel.healing.commands') {
        const { action, target, params } = payload;
        logger.info({ action, target }, 'Healing command received');
        if (action === 'force-heal' && target) {
          const incident = healthMonitor.getIncident(target);
          if (incident) await handleIncident(incident);
        }
      }
    },
  });
}

// ── Start ─────────────────────────────────────────────────────
async function start() {
  await producer.connect();
  logger.info('Kafka producer connected');

  await startKafkaConsumer();
  logger.info('Kafka consumer started');

  // Periodic health check of all services
  setInterval(async () => {
    await healthMonitor.pollServiceHealth();
  }, 30000);

  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Healing Agent ready at http://0.0.0.0:${PORT}`);
  });
}

start().catch((err) => {
  logger.error({ err: err.message }, 'Healing agent failed to start');
  process.exit(1);
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down');
  await producer.disconnect();
  await consumer.disconnect();
  process.exit(0);
});

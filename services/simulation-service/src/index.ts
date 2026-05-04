import express from 'express';
import { Kafka, Producer, Consumer, EachMessagePayload } from 'kafkajs';
import { Redis } from 'ioredis';
import { Pool } from 'pg';
import { v4 as uuid } from 'uuid';
import { pino } from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info', name: 'simulation-service' });
const PORT = parseInt(process.env.PORT || '4008', 10);

const pgPool = new Pool({
  host: process.env.PG_HOST, port: parseInt(process.env.PG_PORT || '5432', 10),
  database: process.env.PG_DATABASE, user: process.env.PG_USER || 'sentinel_admin',
  password: process.env.PG_PASSWORD, max: 15,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined,
});

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: 3, lazyConnect: true });

const kafka = new Kafka({
  clientId: 'simulation-service',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  retry: { initialRetryTime: 1000, retries: 10 },
});

interface SimulationConfig {
  id: string;
  name: string;
  description: string;
  scenarioType: 'RED_TEAM' | 'BLUE_TEAM' | 'PURPLE_TEAM' | 'TABLETOP' | 'DIGITAL_TWIN';
  parameters: Record<string, any>;
  duration: number;
  status: 'CREATED' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED';
  createdBy: string;
}

interface SimulationEvent {
  simulationId: string;
  timestamp: string;
  eventType: string;
  data: Record<string, any>;
  sequenceNumber: number;
}

const activeSimulations = new Map<string, { config: SimulationConfig; timer: NodeJS.Timeout | null; seq: number }>();

async function bootstrap(): Promise<void> {
  const app = express();
  app.use(express.json());

  const producer: Producer = kafka.producer({ allowAutoTopicCreation: false });
  await producer.connect();

  const consumer: Consumer = kafka.consumer({ groupId: 'simulation-engine' });
  await consumer.connect();
  await consumer.subscribe({ topics: ['sentinel.simulation.commands'], fromBeginning: false });

  await consumer.run({
    eachMessage: async (payload: EachMessagePayload) => {
      if (!payload.message.value) return;
      try {
        const cmd = JSON.parse(payload.message.value.toString());
        if (cmd.action === 'inject_event') {
          await injectEvent(cmd.simulationId, cmd.event, producer);
        }
      } catch (error: any) {
        logger.error({ error: error.message }, 'Simulation command failed');
      }
    },
  });

  app.post('/api/v1/simulations', async (req, res) => {
    try {
      const input = req.body;
      const id = uuid();
      const config: SimulationConfig = {
        id,
        name: input.name,
        description: input.description || '',
        scenarioType: input.scenarioType || 'TABLETOP',
        parameters: input.parameters || {},
        duration: input.duration || 3600,
        status: 'CREATED',
        createdBy: input.createdBy || 'system',
      };

      await pgPool.query(
        `INSERT INTO simulations (id, organization_id, name, description, scenario_type, parameters, duration_seconds, status, created_by, classification)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [id, input.organizationId, config.name, config.description, config.scenarioType,
         JSON.stringify(config.parameters), config.duration, config.status,
         config.createdBy, input.classification || 'CONFIDENTIAL'],
      );

      res.status(201).json(config);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/v1/simulations/:simId/start', async (req, res) => {
    try {
      const { simId } = req.params;
      const simResult = await pgPool.query('SELECT * FROM simulations WHERE id = $1', [simId]);
      if (simResult.rows.length === 0) return res.status(404).json({ error: 'Simulation not found' });

      const sim = simResult.rows[0];
      const config: SimulationConfig = {
        id: sim.id, name: sim.name, description: sim.description,
        scenarioType: sim.scenario_type, parameters: sim.parameters,
        duration: sim.duration_seconds, status: 'RUNNING', createdBy: sim.created_by,
      };

      await pgPool.query('UPDATE simulations SET status = $1, started_at = NOW() WHERE id = $2', ['RUNNING', simId]);

      const scenarioEvents = generateScenarioEvents(config);
      let seq = 0;
      const timer = setInterval(async () => {
        if (seq >= scenarioEvents.length) {
          clearInterval(timer);
          await completeSimulation(simId, producer);
          activeSimulations.delete(simId);
          return;
        }

        const event = scenarioEvents[seq];
        event.sequenceNumber = seq;
        await injectEvent(simId, event, producer);
        seq++;
      }, (config.duration * 1000) / scenarioEvents.length);

      activeSimulations.set(simId, { config, timer, seq: 0 });

      await producer.send({
        topic: 'sentinel.simulation.events',
        messages: [{
          key: simId,
          value: JSON.stringify({ simulationId: simId, eventType: 'SIMULATION_STARTED', timestamp: new Date().toISOString(), data: { scenarioType: config.scenarioType, totalEvents: scenarioEvents.length } }),
        }],
      });

      res.json({ status: 'started', simulationId: simId, totalEvents: scenarioEvents.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/v1/simulations/:simId/stop', async (req, res) => {
    try {
      const { simId } = req.params;
      const active = activeSimulations.get(simId);
      if (active?.timer) clearInterval(active.timer);
      activeSimulations.delete(simId);

      await pgPool.query('UPDATE simulations SET status = $1, completed_at = NOW() WHERE id = $2', ['COMPLETED', simId]);

      await producer.send({
        topic: 'sentinel.simulation.events',
        messages: [{
          key: simId,
          value: JSON.stringify({ simulationId: simId, eventType: 'SIMULATION_STOPPED', timestamp: new Date().toISOString() }),
        }],
      });

      res.json({ status: 'stopped', simulationId: simId });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/v1/simulations', async (req, res) => {
    try {
      const { status, limit } = req.query;
      const params: any[] = [];
      let where = '';
      if (status) { params.push(status); where = `WHERE status = $${params.length}`; }
      params.push(parseInt(limit as string || '50', 10));
      const result = await pgPool.query(
        `SELECT * FROM simulations ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params,
      );
      res.json({ simulations: result.rows, active: activeSimulations.size });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/v1/simulations/:simId', async (req, res) => {
    try {
      const { simId } = req.params;
      const result = await pgPool.query('SELECT * FROM simulations WHERE id = $1', [simId]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
      const active = activeSimulations.get(simId);
      res.json({ ...result.rows[0], isLive: !!active, currentSequence: active?.seq || 0 });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/v1/simulations/:simId/inject', async (req, res) => {
    try {
      const { simId } = req.params;
      const event: SimulationEvent = {
        simulationId: simId,
        timestamp: new Date().toISOString(),
        eventType: req.body.eventType || 'CUSTOM',
        data: req.body.data || {},
        sequenceNumber: req.body.sequenceNumber || 0,
      };
      await injectEvent(simId, event, producer);
      res.json({ status: 'injected', event });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/v1/simulations/honeypots/active', async (_req, res) => {
    try {
      const result = await pgPool.query(
        `SELECT * FROM honeypots WHERE status = 'ACTIVE' ORDER BY deployed_at DESC`,
      );
      res.json({ honeypots: result.rows });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/v1/simulations/honeypots', async (req, res) => {
    try {
      const { organizationId, honeypotType, targetIp, targetPort, config, createdBy } = req.body;
      const result = await pgPool.query(
        `INSERT INTO honeypots (organization_id, honeypot_type, target_ip, target_port, config, deployed_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [organizationId, honeypotType, targetIp, targetPort, JSON.stringify(config || {}), createdBy],
      );
      res.status(201).json(result.rows[0]);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'healthy', activeSimulations: activeSimulations.size, timestamp: new Date().toISOString() });
  });

  app.listen(PORT, '0.0.0.0', () => logger.info(`Simulation Service ready at http://0.0.0.0:${PORT}`));

  process.on('SIGTERM', async () => {
    for (const [, sim] of activeSimulations) {
      if (sim.timer) clearInterval(sim.timer);
    }
    activeSimulations.clear();
    await consumer.disconnect();
    await producer.disconnect();
    await pgPool.end();
    redis.disconnect();
    process.exit(0);
  });
}

function generateScenarioEvents(config: SimulationConfig): SimulationEvent[] {
  const events: SimulationEvent[] = [];
  const now = Date.now();

  switch (config.scenarioType) {
    case 'RED_TEAM': {
      const phases = [
        { type: 'RECON', actions: ['port_scan', 'dns_enum', 'osint_gather'] },
        { type: 'WEAPONIZE', actions: ['payload_craft', 'c2_setup'] },
        { type: 'DELIVER', actions: ['phishing_email', 'watering_hole'] },
        { type: 'EXPLOIT', actions: ['rce_attempt', 'priv_escalation'] },
        { type: 'INSTALL', actions: ['backdoor_install', 'persistence'] },
        { type: 'C2', actions: ['beacon_callback', 'data_staging'] },
        { type: 'EXFIL', actions: ['data_exfiltration', 'cover_tracks'] },
      ];
      let seq = 0;
      for (const phase of phases) {
        for (const action of phase.actions) {
          events.push({
            simulationId: config.id,
            timestamp: new Date(now + seq * 60000).toISOString(),
            eventType: `RED_TEAM_${phase.type}`,
            data: {
              action,
              phase: phase.type,
              sourceIp: `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
              targetIp: config.parameters.targetNetwork || '192.168.1.0/24',
              severity: phase.type === 'EXFIL' || phase.type === 'C2' ? 'CRITICAL' : 'HIGH',
            },
            sequenceNumber: seq++,
          });
        }
      }
      break;
    }

    case 'DIGITAL_TWIN': {
      const sensorTypes = ['CCTV', 'RADAR', 'IOT', 'DRONE'];
      for (let i = 0; i < 20; i++) {
        events.push({
          simulationId: config.id,
          timestamp: new Date(now + i * 30000).toISOString(),
          eventType: 'SENSOR_TELEMETRY',
          data: {
            sensorType: sensorTypes[i % sensorTypes.length],
            sensorId: `sim-sensor-${i}`,
            latitude: (config.parameters.centerLat || 38.8977) + (Math.random() - 0.5) * 0.01,
            longitude: (config.parameters.centerLon || -77.0365) + (Math.random() - 0.5) * 0.01,
            readings: { temperature: 20 + Math.random() * 15, humidity: 40 + Math.random() * 40 },
          },
          sequenceNumber: i,
        });
      }
      break;
    }

    case 'PURPLE_TEAM': {
      const ttps = [
        { technique: 'T1566.001', name: 'Spearphishing Attachment', tactic: 'Initial Access' },
        { technique: 'T1059.001', name: 'PowerShell', tactic: 'Execution' },
        { technique: 'T1053.005', name: 'Scheduled Task', tactic: 'Persistence' },
        { technique: 'T1548.002', name: 'Bypass UAC', tactic: 'Privilege Escalation' },
        { technique: 'T1070.001', name: 'Clear Windows Event Logs', tactic: 'Defense Evasion' },
        { technique: 'T1003.001', name: 'LSASS Memory', tactic: 'Credential Access' },
        { technique: 'T1021.001', name: 'Remote Desktop Protocol', tactic: 'Lateral Movement' },
        { technique: 'T1041', name: 'Exfiltration Over C2 Channel', tactic: 'Exfiltration' },
      ];
      ttps.forEach((ttp, i) => {
        events.push({
          simulationId: config.id,
          timestamp: new Date(now + i * 120000).toISOString(),
          eventType: 'MITRE_ATT&CK',
          data: { ...ttp, detected: Math.random() > 0.3, responseTime: Math.floor(Math.random() * 300) + 10 },
          sequenceNumber: i,
        });
      });
      break;
    }

    default: {
      for (let i = 0; i < 10; i++) {
        events.push({
          simulationId: config.id,
          timestamp: new Date(now + i * 60000).toISOString(),
          eventType: 'TABLETOP_STEP',
          data: { step: i + 1, description: `Scenario step ${i + 1}` },
          sequenceNumber: i,
        });
      }
    }
  }

  return events;
}

async function injectEvent(simId: string, event: SimulationEvent, producer: Producer): Promise<void> {
  const topicMap: Record<string, string> = {
    'SENSOR_TELEMETRY': 'sentinel.ingestion.sensor-telemetry',
    'RED_TEAM_DELIVER': 'sentinel.cyber.raw-events',
    'RED_TEAM_EXPLOIT': 'sentinel.cyber.raw-events',
    'RED_TEAM_C2': 'sentinel.cyber.raw-events',
    'RED_TEAM_EXFIL': 'sentinel.cyber.raw-events',
    'MITRE_ATT&CK': 'sentinel.cyber.raw-events',
  };

  const targetTopic = topicMap[event.eventType] || 'sentinel.simulation.events';

  await producer.send({
    topic: targetTopic,
    messages: [{
      key: simId,
      value: JSON.stringify({ ...event, injected: true, source: 'simulation-service' }),
    }],
  });

  logger.debug({ simId, eventType: event.eventType, seq: event.sequenceNumber }, 'Event injected');
}

async function completeSimulation(simId: string, producer: Producer): Promise<void> {
  await pgPool.query('UPDATE simulations SET status = $1, completed_at = NOW() WHERE id = $2', ['COMPLETED', simId]);

  await producer.send({
    topic: 'sentinel.simulation.events',
    messages: [{
      key: simId,
      value: JSON.stringify({ simulationId: simId, eventType: 'SIMULATION_COMPLETED', timestamp: new Date().toISOString() }),
    }],
  });

  logger.info({ simId }, 'Simulation completed');
}

bootstrap().catch((error) => {
  logger.fatal({ error }, 'Failed to start Simulation Service');
  process.exit(1);
});

import express from 'express';
import { Kafka, Producer, Consumer, EachMessagePayload } from 'kafkajs';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { Client as ElasticsearchClient } from '@elastic/elasticsearch';
import axios from 'axios';
import { CronJob } from 'cron';
import { v4 as uuid } from 'uuid';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info', name: 'cyber-service' });
const PORT = parseInt(process.env.PORT || '4006', 10);

const pgPool = new Pool({
  host: process.env.PG_HOST, port: parseInt(process.env.PG_PORT || '5432', 10),
  database: process.env.PG_DATABASE, user: process.env.PG_USER || 'sentinel_admin',
  password: process.env.PG_PASSWORD, max: 15,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined,
});

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: 3, lazyConnect: true });

const elasticsearch = new ElasticsearchClient({
  node: process.env.ELASTICSEARCH_URL || 'http://elasticsearch:9200',
  auth: process.env.ELASTICSEARCH_API_KEY ? { apiKey: process.env.ELASTICSEARCH_API_KEY } : undefined,
  requestTimeout: 30000,
  maxRetries: 3,
});

const kafka = new Kafka({
  clientId: 'cyber-service',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  retry: { initialRetryTime: 1000, retries: 10 },
});

interface ThreatIntelFeed {
  id: string;
  name: string;
  url: string;
  type: 'stix' | 'taxii' | 'csv' | 'json' | 'misp';
  schedule: string;
  enabled: boolean;
  apiKey?: string;
  headers?: Record<string, string>;
}

const SURICATA_RULES_PATH = process.env.SURICATA_RULES_PATH || '/etc/suricata/rules';
const IDS_LOG_PATH = process.env.IDS_LOG_PATH || '/var/log/suricata/eve.json';

async function bootstrap(): Promise<void> {
  const app = express();
  app.use(express.json());

  const producer: Producer = kafka.producer({ allowAutoTopicCreation: false });
  await producer.connect();

  const consumer: Consumer = kafka.consumer({ groupId: 'cyber-service-processor' });
  await consumer.connect();

  await consumer.subscribe({
    topics: ['sentinel.cyber.raw-events', 'sentinel.cyber.threat-indicators'],
    fromBeginning: false,
  });

  const threatIntelFeeds: ThreatIntelFeed[] = [
    { id: 'abuse-ssl', name: 'Abuse.ch SSL Blacklist', url: 'https://sslbl.abuse.ch/blacklist/sslblacklist.csv', type: 'csv', schedule: '0 */6 * * *', enabled: true },
    { id: 'abuse-urlhaus', name: 'URLhaus', url: 'https://urlhaus-api.abuse.ch/v1/urls/recent/', type: 'json', schedule: '*/30 * * * *', enabled: true },
    { id: 'emergingthreats', name: 'Emerging Threats', url: 'https://rules.emergingthreats.net/open/suricata/emerging.rules.tar.gz', type: 'csv', schedule: '0 2 * * *', enabled: true },
  ];

  const activeCrons: CronJob[] = [];
  for (const feed of threatIntelFeeds) {
    if (!feed.enabled) continue;
    const job = new CronJob(feed.schedule, async () => {
      try {
        await fetchThreatIntelFeed(feed, producer);
      } catch (error: any) {
        logger.error({ feedId: feed.id, error: error.message }, 'Threat intel feed fetch failed');
      }
    }, null, true, 'UTC');
    activeCrons.push(job);
  }

  await consumer.run({
    autoCommit: true,
    autoCommitInterval: 5000,
    partitionsConsumedConcurrently: 4,
    eachMessage: async (payload: EachMessagePayload) => {
      if (!payload.message.value) return;
      try {
        const data = JSON.parse(payload.message.value.toString());
        if (payload.topic === 'sentinel.cyber.raw-events') {
          await processCyberEvent(data, producer);
        } else if (payload.topic === 'sentinel.cyber.threat-indicators') {
          await processThreatIndicator(data);
        }
      } catch (error: any) {
        logger.error({ error: error.message, topic: payload.topic }, 'Cyber event processing failed');
      }
    },
  });

  app.get('/api/v1/cyber/events', async (req, res) => {
    try {
      const { severity, eventType, timeRange, limit, sourceIp, destIp } = req.query;
      const must: any[] = [];
      if (severity) must.push({ term: { severity } });
      if (eventType) must.push({ term: { event_type: eventType } });
      if (sourceIp) must.push({ term: { 'src_ip.keyword': sourceIp } });
      if (destIp) must.push({ term: { 'dest_ip.keyword': destIp } });
      if (timeRange) {
        const [start, end] = (timeRange as string).split(',');
        must.push({ range: { timestamp: { gte: start, lte: end } } });
      }

      const result = await elasticsearch.search({
        index: 'sentinel-cyber-events-*',
        body: {
          query: { bool: { must: must.length > 0 ? must : [{ match_all: {} }] } },
          sort: [{ timestamp: { order: 'desc' } }],
          size: parseInt(limit as string || '50', 10),
        },
      });

      res.json({
        events: result.hits.hits.map((h: any) => ({ id: h._id, ...h._source })),
        total: (result.hits.total as any)?.value || 0,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/v1/cyber/dashboard', async (_req, res) => {
    try {
      const [severityAgg, typeAgg, topSources, topDests, timeline] = await Promise.all([
        elasticsearch.search({
          index: 'sentinel-cyber-events-*',
          body: {
            size: 0,
            query: { range: { timestamp: { gte: 'now-24h' } } },
            aggs: { by_severity: { terms: { field: 'severity.keyword', size: 10 } } },
          },
        }),
        elasticsearch.search({
          index: 'sentinel-cyber-events-*',
          body: {
            size: 0,
            query: { range: { timestamp: { gte: 'now-24h' } } },
            aggs: { by_type: { terms: { field: 'event_type.keyword', size: 20 } } },
          },
        }),
        elasticsearch.search({
          index: 'sentinel-cyber-events-*',
          body: {
            size: 0,
            query: { range: { timestamp: { gte: 'now-24h' } } },
            aggs: { top_sources: { terms: { field: 'src_ip.keyword', size: 10 } } },
          },
        }),
        elasticsearch.search({
          index: 'sentinel-cyber-events-*',
          body: {
            size: 0,
            query: { range: { timestamp: { gte: 'now-24h' } } },
            aggs: { top_dests: { terms: { field: 'dest_ip.keyword', size: 10 } } },
          },
        }),
        elasticsearch.search({
          index: 'sentinel-cyber-events-*',
          body: {
            size: 0,
            query: { range: { timestamp: { gte: 'now-24h' } } },
            aggs: { timeline: { date_histogram: { field: 'timestamp', fixed_interval: '1h' } } },
          },
        }),
      ]);

      res.json({
        bySeverity: (severityAgg.aggregations as any)?.by_severity?.buckets || [],
        byType: (typeAgg.aggregations as any)?.by_type?.buckets || [],
        topSources: (topSources.aggregations as any)?.top_sources?.buckets || [],
        topDestinations: (topDests.aggregations as any)?.top_dests?.buckets || [],
        timeline: (timeline.aggregations as any)?.timeline?.buckets || [],
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/v1/cyber/indicators', async (req, res) => {
    try {
      const { type, value, limit } = req.query;
      const params: any[] = [];
      let where = 'WHERE 1=1';
      if (type) { params.push(type); where += ` AND indicator_type = $${params.length}`; }
      if (value) { params.push(`%${value}%`); where += ` AND value ILIKE $${params.length}`; }
      params.push(parseInt(limit as string || '50', 10));
      const result = await pgPool.query(
        `SELECT * FROM threat_indicators ${where} ORDER BY last_seen_at DESC NULLS LAST LIMIT $${params.length}`, params,
      );
      res.json({ indicators: result.rows, total: result.rowCount });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/v1/cyber/indicators/check', async (req, res) => {
    try {
      const { indicators } = req.body;
      const results: any[] = [];
      for (const ioc of indicators) {
        const cached = await redis.get(`sentinel:ioc:${ioc.type}:${ioc.value}`);
        if (cached) {
          results.push({ ...ioc, match: true, data: JSON.parse(cached) });
        } else {
          const dbResult = await pgPool.query(
            'SELECT * FROM threat_indicators WHERE indicator_type = $1 AND value = $2 AND is_active = true',
            [ioc.type, ioc.value],
          );
          if (dbResult.rows.length > 0) {
            results.push({ ...ioc, match: true, data: dbResult.rows[0] });
            await redis.setex(`sentinel:ioc:${ioc.type}:${ioc.value}`, 3600, JSON.stringify(dbResult.rows[0]));
          } else {
            results.push({ ...ioc, match: false });
          }
        }
      }
      res.json({ results, matchCount: results.filter(r => r.match).length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/v1/cyber/feeds', (_req, res) => {
    res.json(threatIntelFeeds.map(f => ({ ...f, apiKey: undefined })));
  });

  app.get('/health', async (_req, res) => {
    try {
      await elasticsearch.ping();
      res.json({ status: 'healthy', elasticsearch: 'connected', timestamp: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'degraded', elasticsearch: 'disconnected' });
    }
  });

  app.listen(PORT, '0.0.0.0', () => logger.info(`Cyber Service ready at http://0.0.0.0:${PORT}`));

  process.on('SIGTERM', async () => {
    activeCrons.forEach(c => c.stop());
    await consumer.disconnect();
    await producer.disconnect();
    await pgPool.end();
    redis.disconnect();
    process.exit(0);
  });
}

async function processCyberEvent(data: any, producer: Producer): Promise<void> {
  const eventId = data.id || uuid();
  const enrichedEvent = {
    ...data,
    id: eventId,
    processedAt: new Date().toISOString(),
    iocMatches: [] as any[],
  };

  if (data.src_ip) {
    const srcMatch = await redis.get(`sentinel:ioc:ipv4:${data.src_ip}`);
    if (srcMatch) enrichedEvent.iocMatches.push({ type: 'src_ip', indicator: JSON.parse(srcMatch) });
  }
  if (data.dest_ip) {
    const destMatch = await redis.get(`sentinel:ioc:ipv4:${data.dest_ip}`);
    if (destMatch) enrichedEvent.iocMatches.push({ type: 'dest_ip', indicator: JSON.parse(destMatch) });
  }
  if (data.dns?.query) {
    const dnsMatch = await redis.get(`sentinel:ioc:domain:${data.dns.query}`);
    if (dnsMatch) enrichedEvent.iocMatches.push({ type: 'dns', indicator: JSON.parse(dnsMatch) });
  }
  if (data.tls?.sni) {
    const tlsMatch = await redis.get(`sentinel:ioc:domain:${data.tls.sni}`);
    if (tlsMatch) enrichedEvent.iocMatches.push({ type: 'tls_sni', indicator: JSON.parse(tlsMatch) });
  }

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
  await elasticsearch.index({
    index: `sentinel-cyber-events-${dateStr}`,
    id: eventId,
    body: enrichedEvent,
  });

  const severity = data.alert?.severity || data.severity;
  if (severity === 1 || severity === 'CRITICAL' || enrichedEvent.iocMatches.length > 0) {
    const alertSeverity = enrichedEvent.iocMatches.length > 0 ? 'CRITICAL' : severity === 1 ? 'HIGH' : 'MEDIUM';
    await producer.send({
      topic: 'sentinel.alerts.created',
      messages: [{
        key: eventId,
        value: JSON.stringify({
          id: uuid(),
          title: data.alert?.signature || `Cyber event: ${data.event_type || 'unknown'}`,
          description: `Source: ${data.src_ip}:${data.src_port} -> ${data.dest_ip}:${data.dest_port}. ${enrichedEvent.iocMatches.length > 0 ? `IOC matches: ${enrichedEvent.iocMatches.length}` : ''}`,
          severity: alertSeverity,
          domain: 'CYBER',
          sourceType: data.alert ? 'IDS_ALERT' : 'NETWORK_EVENT',
          sourceId: eventId,
          confidence: data.alert ? 0.85 : 0.6,
          tags: ['cyber', data.event_type, ...(data.alert?.category ? [data.alert.category] : [])],
          classification: 'CONFIDENTIAL',
          metadata: {
            srcIp: data.src_ip, destIp: data.dest_ip,
            srcPort: data.src_port, destPort: data.dest_port,
            protocol: data.proto, signature: data.alert?.signature,
            iocMatches: enrichedEvent.iocMatches,
          },
        }),
      }],
    });
  }

  await pgPool.query(
    `INSERT INTO cyber_events (id, event_type, severity, source_ip, source_port, dest_ip, dest_port, protocol, signature, raw_data, detected_at, organization_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (id) DO NOTHING`,
    [eventId, data.event_type || 'unknown', severity || 'LOW',
     data.src_ip, data.src_port, data.dest_ip, data.dest_port,
     data.proto, data.alert?.signature, JSON.stringify(data),
     data.timestamp || new Date().toISOString(),
     data.organizationId || null],
  );
}

async function processThreatIndicator(data: any): Promise<void> {
  await pgPool.query(
    `INSERT INTO threat_indicators (id, indicator_type, value, source, reliability, classification, first_seen_at, last_seen_at, organization_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8)
     ON CONFLICT (indicator_type, value) DO UPDATE SET
       last_seen_at = EXCLUDED.last_seen_at,
       sightings = threat_indicators.sightings + 1,
       source = EXCLUDED.source`,
    [data.id || uuid(), data.type, data.value, data.source || 'unknown',
     data.reliability || 'C', data.classification || 'UNCLASSIFIED',
     data.firstSeen || new Date().toISOString(), data.organizationId || null],
  );

  await redis.setex(
    `sentinel:ioc:${data.type}:${data.value}`, 86400,
    JSON.stringify({ type: data.type, value: data.value, source: data.source, reliability: data.reliability }),
  );
}

async function fetchThreatIntelFeed(feed: ThreatIntelFeed, producer: Producer): Promise<void> {
  logger.info({ feedId: feed.id, feedName: feed.name }, 'Fetching threat intel feed');

  const response = await axios.get(feed.url, {
    headers: feed.headers || {},
    timeout: 60000,
    responseType: feed.type === 'csv' ? 'text' : 'json',
  });

  let indicators: Array<{ type: string; value: string }> = [];

  if (feed.type === 'csv') {
    const lines = (response.data as string).split('\n').filter((l: string) => l.trim() && !l.startsWith('#'));
    for (const line of lines.slice(0, 5000)) {
      const parts = line.split(',');
      const value = parts[0]?.trim();
      if (!value) continue;
      const type = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value) ? 'ipv4' :
                   /^[a-fA-F0-9]{64}$/.test(value) ? 'sha256' :
                   /^[a-fA-F0-9]{32}$/.test(value) ? 'md5' : 'domain';
      indicators.push({ type, value });
    }
  } else if (feed.type === 'json') {
    const data = response.data;
    const items = Array.isArray(data) ? data : data.urls || data.data || data.results || data.iocs || [];
    for (const item of items.slice(0, 5000)) {
      if (item.url) indicators.push({ type: 'url', value: item.url });
      if (item.host) indicators.push({ type: 'domain', value: item.host });
      if (item.ip) indicators.push({ type: 'ipv4', value: item.ip });
      if (item.ioc) {
        const iocType = item.ioc_type?.includes('ip') ? 'ipv4' :
                        item.ioc_type?.includes('domain') ? 'domain' :
                        item.ioc_type?.includes('url') ? 'url' :
                        item.ioc_type?.includes('sha256') ? 'sha256' : 'unknown';
        indicators.push({ type: iocType, value: item.ioc });
      }
    }
  }

  if (indicators.length > 0) {
    const batches = [];
    for (let i = 0; i < indicators.length; i += 500) {
      batches.push(indicators.slice(i, i + 500));
    }

    for (const batch of batches) {
      await producer.send({
        topic: 'sentinel.cyber.threat-indicators',
        messages: batch.map(ioc => ({
          key: `${ioc.type}:${ioc.value}`,
          value: JSON.stringify({
            id: uuid(),
            type: ioc.type,
            value: ioc.value,
            source: feed.name,
            reliability: 'B',
            classification: 'UNCLASSIFIED',
            firstSeen: new Date().toISOString(),
          }),
        })),
      });
    }

    logger.info({ feedId: feed.id, indicators: indicators.length }, 'Threat intel feed ingested');
  }
}

bootstrap().catch((error) => {
  logger.fatal({ error }, 'Failed to start Cyber Service');
  process.exit(1);
});

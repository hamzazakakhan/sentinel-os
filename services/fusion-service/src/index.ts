import express from 'express';
import { Kafka, Producer, Consumer, EachMessagePayload } from 'kafkajs';
import { Redis } from 'ioredis';
import { Pool } from 'pg';
import neo4j, { Driver, Session } from 'neo4j-driver';
import { v4 as uuid } from 'uuid';
import { pino } from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info', name: 'fusion-service' });
const PORT = parseInt(process.env.PORT || '4005', 10);

const pgPool = new Pool({
  host: process.env.PG_HOST, port: parseInt(process.env.PG_PORT || '5432', 10),
  database: process.env.PG_DATABASE, user: process.env.PG_USER || 'sentinel_admin',
  password: process.env.PG_PASSWORD, max: 15,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined,
});

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: 3, lazyConnect: true });

const neo4jDriver: Driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://neo4j:7687',
  neo4j.auth.basic(process.env.NEO4J_USER || 'neo4j', process.env.NEO4J_PASSWORD || 'sentinel_neo4j'),
  { maxConnectionPoolSize: 50, connectionAcquisitionTimeout: 30000, encrypted: 'ENCRYPTION_OFF' },
);

const kafka = new Kafka({
  clientId: 'fusion-service',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  retry: { initialRetryTime: 1000, retries: 10 },
});

async function neo4jQuery(cypher: string, params: Record<string, any> = {}): Promise<any[]> {
  const session: Session = neo4jDriver.session();
  try {
    const result = await session.run(cypher, params);
    return result.records.map(r => r.toObject());
  } finally {
    await session.close();
  }
}

async function bootstrap(): Promise<void> {
  const app = express();
  app.use(express.json());

  const producer: Producer = kafka.producer({ allowAutoTopicCreation: false });
  await producer.connect();

  const consumer: Consumer = kafka.consumer({ groupId: 'fusion-service-correlator' });
  await consumer.connect();

  await consumer.subscribe({
    topics: [
      'sentinel.detections.created',
      'sentinel.alerts.created',
      'sentinel.cyber.threat-indicators',
      'sentinel.osint.items',
      'sentinel.ai.analysis-results',
      'sentinel.tracks.updated',
    ],
    fromBeginning: false,
  });

  await consumer.run({
    autoCommit: true,
    autoCommitInterval: 5000,
    partitionsConsumedConcurrently: 4,
    eachMessage: async (payload: EachMessagePayload) => {
      if (!payload.message.value) return;
      try {
        const data = JSON.parse(payload.message.value.toString());
        await routeFusionMessage(payload.topic, data, producer);
      } catch (error: any) {
        logger.error({ error: error.message, topic: payload.topic }, 'Fusion processing failed');
      }
    },
  });

  app.post('/api/v1/fusion/query', async (req, res) => {
    try {
      const { cypher, params } = req.body;
      const results = await neo4jQuery(cypher, params || {});
      res.json({ results, count: results.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/v1/fusion/entity/:entityId/graph', async (req, res) => {
    try {
      const { entityId } = req.params;
      const depth = parseInt(req.query.depth as string || '2', 10);
      const results = await neo4jQuery(
        `MATCH path = (n {entityId: $entityId})-[*1..${Math.min(depth, 5)}]-(m)
         RETURN nodes(path) as nodes, relationships(path) as rels
         LIMIT 200`,
        { entityId },
      );

      const nodesMap = new Map<string, any>();
      const edges: any[] = [];

      for (const record of results) {
        for (const node of (record.nodes || [])) {
          const id = node.identity?.toString() || node.properties?.entityId;
          if (!nodesMap.has(id)) {
            nodesMap.set(id, {
              id,
              labels: node.labels,
              properties: node.properties,
            });
          }
        }
        for (const rel of (record.rels || [])) {
          edges.push({
            id: rel.identity?.toString(),
            type: rel.type,
            source: rel.start?.toString(),
            target: rel.end?.toString(),
            properties: rel.properties,
          });
        }
      }

      res.json({
        nodes: Array.from(nodesMap.values()),
        edges,
        entityId,
        depth,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/v1/fusion/entity/:entityId/connections', async (req, res) => {
    try {
      const { entityId } = req.params;
      const results = await neo4jQuery(
        `MATCH (n {entityId: $entityId})-[r]-(m)
         RETURN type(r) as relType, labels(m) as targetLabels, m.entityId as targetId,
                m.name as targetName, r as relationship, count(*) as strength
         ORDER BY strength DESC LIMIT 50`,
        { entityId },
      );
      res.json({ entityId, connections: results });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/v1/fusion/correlate', async (req, res) => {
    try {
      const { entityIds, correlationType } = req.body;
      const correlationId = uuid();

      for (let i = 0; i < entityIds.length; i++) {
        for (let j = i + 1; j < entityIds.length; j++) {
          await neo4jQuery(
            `MATCH (a {entityId: $id1}), (b {entityId: $id2})
             MERGE (a)-[r:CORRELATED_WITH {correlationId: $corrId}]->(b)
             SET r.type = $type, r.createdAt = datetime(), r.confidence = 0.7
             RETURN r`,
            { id1: entityIds[i], id2: entityIds[j], corrId: correlationId, type: correlationType || 'manual' },
          );
        }
      }

      await producer.send({
        topic: 'sentinel.fusion.correlations',
        messages: [{
          key: correlationId,
          value: JSON.stringify({
            correlationId, entityIds, correlationType,
            createdAt: new Date().toISOString(),
          }),
        }],
      });

      res.json({ correlationId, entitiesLinked: entityIds.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/v1/fusion/shortest-path', async (req, res) => {
    try {
      const { from, to } = req.query;
      const results = await neo4jQuery(
        `MATCH path = shortestPath((a {entityId: $from})-[*..10]-(b {entityId: $to}))
         RETURN nodes(path) as nodes, relationships(path) as rels, length(path) as distance`,
        { from, to },
      );
      res.json({ from, to, paths: results });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/v1/fusion/clusters', async (req, res) => {
    try {
      const minSize = parseInt(req.query.minSize as string || '3', 10);
      const results = await neo4jQuery(
        `MATCH (n)-[r]-(m)
         WITH n, collect(DISTINCT m) as neighbors
         WHERE size(neighbors) >= $minSize
         RETURN n.entityId as centerId, labels(n) as centerLabels, n.name as centerName,
                size(neighbors) as clusterSize, [x IN neighbors | x.entityId][..10] as memberIds
         ORDER BY clusterSize DESC LIMIT 20`,
        { minSize },
      );
      res.json({ clusters: results });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/v1/fusion/timeline/:entityId', async (req, res) => {
    try {
      const { entityId } = req.params;
      const results = await neo4jQuery(
        `MATCH (n {entityId: $entityId})-[r]-(m)
         WHERE r.timestamp IS NOT NULL OR r.createdAt IS NOT NULL
         RETURN type(r) as eventType, r.timestamp as timestamp, r.createdAt as createdAt,
                labels(m) as relatedLabels, m.entityId as relatedId, m.name as relatedName, r as details
         ORDER BY coalesce(r.timestamp, r.createdAt) DESC LIMIT 100`,
        { entityId },
      );
      res.json({ entityId, timeline: results });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/health', async (_req, res) => {
    try {
      await neo4jQuery('RETURN 1 as alive');
      res.json({ status: 'healthy', neo4j: 'connected', timestamp: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'unhealthy', neo4j: 'disconnected' });
    }
  });

  app.listen(PORT, '0.0.0.0', () => logger.info(`Fusion Service ready at http://0.0.0.0:${PORT}`));

  process.on('SIGTERM', async () => {
    await consumer.disconnect();
    await producer.disconnect();
    await neo4jDriver.close();
    await pgPool.end();
    redis.disconnect();
    process.exit(0);
  });
}

async function routeFusionMessage(topic: string, data: any, producer: Producer): Promise<void> {
  switch (topic) {
    case 'sentinel.detections.created':
      await ingestDetection(data);
      break;
    case 'sentinel.alerts.created':
      await ingestAlert(data);
      break;
    case 'sentinel.cyber.threat-indicators':
      await ingestThreatIndicator(data);
      break;
    case 'sentinel.osint.items':
      await ingestOsintItem(data);
      break;
    case 'sentinel.ai.analysis-results':
      await ingestAnalysisResult(data);
      break;
    case 'sentinel.tracks.updated':
      await ingestTrackUpdate(data);
      break;
  }

  await runCorrelationEngine(data, producer);
}

async function ingestDetection(data: any): Promise<void> {
  await neo4jQuery(
    `MERGE (d:Detection {entityId: $id})
     SET d.type = $type, d.confidence = $confidence, d.sensorId = $sensorId,
         d.domain = $domain, d.detectedAt = datetime($detectedAt),
         d.latitude = $lat, d.longitude = $lon, d.updatedAt = datetime()
     WITH d
     MERGE (s:Sensor {entityId: $sensorId})
     MERGE (s)-[:DETECTED]->(d)`,
    {
      id: data.id, type: data.detectionType, confidence: data.confidence,
      sensorId: data.sensorId, domain: data.domain || 'LAND',
      detectedAt: data.detectedAt || new Date().toISOString(),
      lat: data.location?.coordinates?.[1] || null,
      lon: data.location?.coordinates?.[0] || null,
    },
  );
}

async function ingestAlert(data: any): Promise<void> {
  await neo4jQuery(
    `MERGE (a:Alert {entityId: $id})
     SET a.title = $title, a.severity = $severity, a.domain = $domain,
         a.confidence = $confidence, a.classification = $classification,
         a.createdAt = datetime($createdAt), a.updatedAt = datetime()
     WITH a
     FOREACH (tag IN $tags |
       MERGE (t:Tag {name: tag})
       MERGE (a)-[:TAGGED_WITH]->(t)
     )`,
    {
      id: data.id, title: data.title, severity: data.severity,
      domain: data.domain, confidence: data.confidence || 0.5,
      classification: data.classification || 'UNCLASSIFIED',
      createdAt: data.createdAt || new Date().toISOString(),
      tags: data.tags || [],
    },
  );

  if (data.sourceId) {
    await neo4jQuery(
      `MATCH (a:Alert {entityId: $alertId})
       MERGE (src {entityId: $sourceId})
       MERGE (src)-[:TRIGGERED]->(a)`,
      { alertId: data.id, sourceId: data.sourceId },
    );
  }
}

async function ingestThreatIndicator(data: any): Promise<void> {
  await neo4jQuery(
    `MERGE (ioc:ThreatIndicator {value: $value, type: $type})
     SET ioc.entityId = coalesce(ioc.entityId, $entityId),
         ioc.source = $source, ioc.reliability = $reliability,
         ioc.classification = $classification,
         ioc.firstSeen = coalesce(ioc.firstSeen, datetime()),
         ioc.lastSeen = datetime(), ioc.sightings = coalesce(ioc.sightings, 0) + 1
     WITH ioc
     MERGE (src:IntelSource {name: $source})
     MERGE (src)-[:PROVIDED]->(ioc)`,
    {
      value: data.value, type: data.type, entityId: data.id || uuid(),
      source: data.source || 'unknown', reliability: data.reliability || 'C',
      classification: data.classification || 'UNCLASSIFIED',
    },
  );
}

async function ingestOsintItem(data: any): Promise<void> {
  await neo4jQuery(
    `MERGE (o:OsintItem {entityId: $id})
     SET o.title = $title, o.feedId = $feedId, o.feedName = $feedName,
         o.classification = $classification, o.reliability = $reliability,
         o.ingestedAt = datetime($ingestedAt), o.updatedAt = datetime()
     WITH o
     MERGE (feed:IntelSource {sourceId: $feedId})
     SET feed.name = $feedName
     MERGE (feed)-[:PRODUCED]->(o)`,
    {
      id: data.id, title: data.title || '', feedId: data.feedId,
      feedName: data.feedName || '', classification: data.classification || 'UNCLASSIFIED',
      reliability: data.reliability || 'C', ingestedAt: data.ingestedAt || new Date().toISOString(),
    },
  );

  for (const ioc of (data.indicators || [])) {
    await neo4jQuery(
      `MATCH (o:OsintItem {entityId: $osintId})
       MERGE (ioc:ThreatIndicator {value: $value, type: $type})
       SET ioc.entityId = coalesce(ioc.entityId, $iocId)
       MERGE (o)-[:CONTAINS_INDICATOR]->(ioc)`,
      { osintId: data.id, value: ioc.value, type: ioc.type, iocId: uuid() },
    );
  }
}

async function ingestAnalysisResult(data: any): Promise<void> {
  if (data.entities && Array.isArray(data.entities)) {
    for (const entity of data.entities) {
      const label = entity.type === 'PERSON' ? 'Person' :
                    entity.type === 'ORGANIZATION' ? 'Organization' :
                    entity.type === 'LOCATION' ? 'Location' : 'Entity';

      await neo4jQuery(
        `MERGE (e:${label} {name: $name})
         SET e.entityId = coalesce(e.entityId, $entityId),
             e.type = $type, e.confidence = $confidence,
             e.updatedAt = datetime()
         WITH e
         MATCH (src {entityId: $sourceId})
         MERGE (src)-[:MENTIONS]->(e)`,
        {
          name: entity.text, entityId: uuid(), type: entity.type,
          confidence: entity.confidence || 0.5, sourceId: data.sourceId,
        },
      );
    }
  }
}

async function ingestTrackUpdate(data: any): Promise<void> {
  await neo4jQuery(
    `MERGE (t:Track {entityId: $id})
     SET t.domain = $domain, t.classification = $classification,
         t.latitude = $lat, t.longitude = $lon,
         t.heading = $heading, t.speed = $speed,
         t.isActive = $isActive, t.updatedAt = datetime()`,
    {
      id: data.id, domain: data.domain || 'LAND',
      classification: data.classification || 'UNCLASSIFIED',
      lat: data.currentLocation?.coordinates?.[1] || null,
      lon: data.currentLocation?.coordinates?.[0] || null,
      heading: data.heading || null, speed: data.speed || null,
      isActive: data.isActive ?? true,
    },
  );
}

async function runCorrelationEngine(data: any, producer: Producer): Promise<void> {
  const correlations: any[] = [];

  if (data.location?.coordinates) {
    const [lon, lat] = data.location.coordinates;
    const nearbyResults = await neo4jQuery(
      `MATCH (n)
       WHERE n.latitude IS NOT NULL AND n.longitude IS NOT NULL
         AND n.entityId <> $entityId
         AND point.distance(
           point({latitude: n.latitude, longitude: n.longitude}),
           point({latitude: $lat, longitude: $lon})
         ) < $radiusMeters
       RETURN n.entityId as entityId, labels(n) as labels, n.name as name,
              point.distance(
                point({latitude: n.latitude, longitude: n.longitude}),
                point({latitude: $lat, longitude: $lon})
              ) as distanceMeters
       ORDER BY distanceMeters LIMIT 10`,
      { entityId: data.id, lat, lon, radiusMeters: 1000 },
    );

    for (const nearby of nearbyResults) {
      correlations.push({
        type: 'GEOSPATIAL_PROXIMITY',
        sourceId: data.id,
        targetId: nearby.entityId,
        confidence: Math.max(0.3, 1 - (nearby.distanceMeters / 1000)),
        metadata: { distanceMeters: nearby.distanceMeters },
      });

      await neo4jQuery(
        `MATCH (a {entityId: $sourceId}), (b {entityId: $targetId})
         MERGE (a)-[r:NEAR]->(b)
         SET r.distance = $distance, r.updatedAt = datetime(), r.confidence = $confidence`,
        {
          sourceId: data.id, targetId: nearby.entityId,
          distance: nearby.distanceMeters,
          confidence: Math.max(0.3, 1 - (nearby.distanceMeters / 1000)),
        },
      );
    }
  }

  if (data.tags?.length) {
    const tagResults = await neo4jQuery(
      `MATCH (n)-[:TAGGED_WITH]->(t:Tag)
       WHERE t.name IN $tags AND n.entityId <> $entityId
       RETURN n.entityId as entityId, collect(t.name) as sharedTags, count(t) as tagOverlap
       ORDER BY tagOverlap DESC LIMIT 10`,
      { tags: data.tags, entityId: data.id },
    );

    for (const match of tagResults) {
      correlations.push({
        type: 'TAG_OVERLAP',
        sourceId: data.id,
        targetId: match.entityId,
        confidence: Math.min(1, match.tagOverlap / data.tags.length),
        metadata: { sharedTags: match.sharedTags },
      });
    }
  }

  if (correlations.length > 0) {
    await producer.send({
      topic: 'sentinel.fusion.correlations',
      messages: [{
        key: data.id || uuid(),
        value: JSON.stringify({
          sourceId: data.id,
          correlations,
          correlatedAt: new Date().toISOString(),
        }),
      }],
    });

    logger.debug({ sourceId: data.id, count: correlations.length }, 'Correlations found');
  }
}

bootstrap().catch((error) => {
  logger.fatal({ error }, 'Failed to start Fusion Service');
  process.exit(1);
});

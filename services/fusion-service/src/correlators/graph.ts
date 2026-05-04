// ──────────────────────────────────────────────────────────────
// sentinel-os/services/fusion-service/src/correlators/graph.ts
// Neo4j graph correlation engine — entity linking and path analysis
// ──────────────────────────────────────────────────────────────

import neo4j, { Driver, Session } from 'neo4j-driver';
import { pino } from 'pino';

const logger = pino({ name: 'fusion-correlator' });

const NEO4J_URI = process.env.NEO4J_URI || 'bolt://localhost:7687';
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'sentinel';

export interface GraphEntity {
  id: string;
  type: 'threat_actor' | 'malware' | 'ip' | 'domain' | 'hash' | 'email' | 'location' | 'organization' | 'vulnerability' | 'alert' | 'sensor';
  label: string;
  properties: Record<string, any>;
  risk_score: number;
  first_seen: string;
  last_seen: string;
}

export interface GraphRelation {
  id: string;
  source_id: string;
  target_id: string;
  type: string;
  properties: Record<string, any>;
  confidence: number;
  first_seen: string;
  last_seen: string;
}

export interface CorrelationResult {
  entities: GraphEntity[];
  relations: GraphRelation[];
  paths: string[][];
  risk_score: number;
  explanation: string;
}

export class GraphCorrelator {
  private driver: Driver;

  constructor() {
    this.driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
  }

  async addEntity(entity: GraphEntity): Promise<string> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `MERGE (e:${entity.type} {id: $id})
         SET e.label = $label, e.risk_score = $risk_score,
             e.first_seen = COALESCE(e.first_seen, $first_seen), e.last_seen = $last_seen,
             e += $properties
         RETURN e.id as id`,
        { id: entity.id, label: entity.label, risk_score: entity.risk_score,
          first_seen: entity.first_seen, last_seen: entity.last_seen,
          properties: entity.properties },
      );
      return result.records[0]?.get('id') || entity.id;
    } finally {
      await session.close();
    }
  }

  async addRelation(relation: GraphRelation): Promise<string> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `MATCH (a {id: $source_id}), (b {id: $target_id})
         MERGE (a)-[r:${relation.type}]->(b)
         SET r.confidence = $confidence, r.first_seen = COALESCE(r.first_seen, $first_seen),
             r.last_seen = $last_seen, r += $properties
         RETURN type(r) as type`,
        { source_id: relation.source_id, target_id: relation.target_id,
          confidence: relation.confidence, first_seen: relation.first_seen,
          last_seen: relation.last_seen, properties: relation.properties },
      );
      return result.records[0]?.get('type') || relation.type;
    } finally {
      await session.close();
    }
  }

  async findPaths(fromId: string, toId: string, maxDepth: number = 5): Promise<string[][]> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `MATCH path = shortestPath((a {id: $from})-[*..${maxDepth}]-(b {id: $to}))
         RETURN [n in nodes(path) | n.id] as ids`,
        { from: fromId, to: toId },
      );
      return result.records.map(r => r.get('ids') as string[]);
    } finally {
      await session.close();
    }
  }

  async findRelated(entityId: string, maxDepth: number = 2, limit: number = 50): Promise<CorrelationResult> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `MATCH (center {id: $id})-[r*1..${maxDepth}]-(related)
         RETURN center, related, relationships(path) as rels
         LIMIT $limit`,
        { id: entityId, limit },
      );

      const entities: GraphEntity[] = [];
      const relations: GraphRelation[] = [];
      const seen = new Set<string>();

      for (const record of result.records) {
        const center = record.get('center');
        const related = record.get('related');
        for (const node of [center, related]) {
          if (!seen.has(node.properties.id)) {
            seen.add(node.properties.id);
            entities.push({
              id: node.properties.id,
              type: node.labels[0] as any,
              label: node.properties.label || node.labels[0],
              properties: node.properties,
              risk_score: node.properties.risk_score || 0,
              first_seen: node.properties.first_seen || '',
              last_seen: node.properties.last_seen || '',
            });
          }
        }
      }

      return {
        entities, relations,
        paths: [], risk_score: entities.reduce((s, e) => s + e.risk_score, 0) / Math.max(entities.length, 1),
        explanation: `Found ${entities.length} related entities within ${maxDepth} hops`,
      };
    } finally {
      await session.close();
    }
  }

  async correlateAlerts(alertIds: string[]): Promise<CorrelationResult> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `MATCH (a:alert) WHERE a.id IN $ids
         MATCH (a)-[r]-(b)
         RETURN a, b, type(r) as rel_type, properties(r) as rel_props
         LIMIT 100`,
        { ids: alertIds },
      );
      const entities: GraphEntity[] = [];
      const relations: GraphRelation[] = [];
      for (const record of result.records) {
        const a = record.get('a');
        const b = record.get('b');
        entities.push({ id: a.properties.id, type: 'alert', label: a.properties.title || a.properties.id, properties: a.properties, risk_score: a.properties.severity_score || 0.5, first_seen: a.properties.created_at || '', last_seen: a.properties.updated_at || '' });
        entities.push({ id: b.properties.id, type: b.labels[0] as any, label: b.properties.label || b.labels[0], properties: b.properties, risk_score: b.properties.risk_score || 0, first_seen: b.properties.first_seen || '', last_seen: b.properties.last_seen || '' });
        relations.push({ id: `${a.properties.id}-${record.get('rel_type')}-${b.properties.id}`, source_id: a.properties.id, target_id: b.properties.id, type: record.get('rel_type'), properties: record.get('rel_props'), confidence: record.get('rel_props')?.confidence || 0.5, first_seen: record.get('rel_props')?.first_seen || '', last_seen: record.get('rel_props')?.last_seen || '' });
      }
      return { entities, relations, paths: [], risk_score: entities.reduce((s, e) => s + e.risk_score, 0) / Math.max(entities.length, 1), explanation: `Correlated ${alertIds.length} alerts → ${entities.length} entities, ${relations.length} relations` };
    } finally {
      await session.close();
    }
  }

  async getStats(): Promise<{ nodes: number; relationships: number; labels: Record<string, number> }> {
    const session = this.driver.session();
    try {
      const nodeCount = await session.run('MATCH (n) RETURN count(n) as cnt');
      const relCount = await session.run('MATCH ()-[r]->() RETURN count(r) as cnt');
      const labels = await session.run('CALL db.labels() YIELD label MATCH (n:`${label}`) RETURN label, count(n) as cnt');
      const labelMap: Record<string, number> = {};
      for (const r of labels.records) { labelMap[r.get('label')] = r.get('cnt').toNumber(); }
      return {
        nodes: nodeCount.records[0]?.get('cnt').toNumber() || 0,
        relationships: relCount.records[0]?.get('cnt').toNumber() || 0,
        labels: labelMap,
      };
    } finally {
      await session.close();
    }
  }

  async close(): Promise<void> {
    await this.driver.close();
  }
}

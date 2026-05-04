// ──────────────────────────────────────────────────────────────
// sentinel-os/services/fusion-service/src/graph-ops/merger.ts
// Entity resolution and graph merging — deduplication & linking
// ──────────────────────────────────────────────────────────────

import { Pool } from 'pg';
import { pino } from 'pino';

const logger = pino({ name: 'graph-merger' });

export interface EntityCandidate {
  type: string;
  value: string;
  source: string;
  confidence: number;
  properties: Record<string, any>;
  timestamp: string;
}

export interface MergeDecision {
  keep_id: string;
  merge_ids: string[];
  merged_properties: Record<string, any>;
  confidence: number;
  reason: string;
}

export class EntityMerger {
  private pg: Pool;

  constructor(pg: Pool) { this.pg = pg; }

  async findDuplicates(type: string, threshold: number = 0.85): Promise<MergeDecision[]> {
    const result = await this.pg.query(
      `SELECT a.id as a_id, b.id as b_id, a.properties as a_props, b.properties as b_props
       FROM fusion_entities a, fusion_entities b
       WHERE a.entity_type = $1 AND b.entity_type = $1 AND a.id < b.id
         AND (a.value = b.value OR similarity(a.label, b.label) > $2)`,
      [type, threshold],
    );

    const groups: Map<string, string[]> = new Map();
    for (const r of result.rows) {
      const key = r.a_id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r.b_id);
    }

    return Array.from(groups.entries()).map(([keepId, mergeIds]) => ({
      keep_id: keepId,
      merge_ids: mergeIds,
      merged_properties: {},
      confidence: threshold,
      reason: `Similarity > ${threshold} for type ${type}`,
    }));
  }

  async executeMerge(decision: MergeDecision): Promise<void> {
    const client = await this.pg.connect();
    try {
      await client.query('BEGIN');

      // Re-point all relations from merged IDs to the kept ID
      for (const mergeId of decision.merge_ids) {
        await client.query(
          `UPDATE fusion_relations SET source_id = $1 WHERE source_id = $2`,
          [decision.keep_id, mergeId],
        );
        await client.query(
          `UPDATE fusion_relations SET target_id = $1 WHERE target_id = $2`,
          [decision.keep_id, mergeId],
        );
        await client.query(`DELETE FROM fusion_entities WHERE id = $1`, [mergeId]);
      }

      // Merge properties
      if (Object.keys(decision.merged_properties).length > 0) {
        await client.query(
          `UPDATE fusion_entities SET properties = properties || $1 WHERE id = $2`,
          [JSON.stringify(decision.merged_properties), decision.keep_id],
        );
      }

      await client.query('COMMIT');
      logger.info({ keep: decision.keep_id, merged: decision.merge_ids.length }, 'Entities merged');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async resolveCandidate(candidate: EntityCandidate): Promise<{ id: string; is_new: boolean }> {
    const result = await this.pg.query(
      `SELECT id, confidence FROM fusion_entities
       WHERE entity_type = $1 AND (value = $2 OR label ILIKE $3)
       ORDER BY confidence DESC LIMIT 1`,
      [candidate.type, candidate.value, `%${candidate.value}%`],
    );

    if (result.rows.length > 0) {
      const existing = result.rows[0];
      if (candidate.confidence > existing.confidence) {
        await this.pg.query(
          `UPDATE fusion_entities SET confidence = $1, properties = properties || $2, last_seen = $3 WHERE id = $4`,
          [candidate.confidence, JSON.stringify(candidate.properties), candidate.timestamp, existing.id],
        );
      }
      return { id: existing.id, is_new: false };
    }

    const id = `ent-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    await this.pg.query(
      `INSERT INTO fusion_entities (id, entity_type, value, label, confidence, properties, first_seen, last_seen)
       VALUES ($1, $2, $3, $3, $4, $5, $6, $6)`,
      [id, candidate.type, candidate.value, candidate.confidence, JSON.stringify(candidate.properties), candidate.timestamp],
    );
    return { id, is_new: true };
  }
}

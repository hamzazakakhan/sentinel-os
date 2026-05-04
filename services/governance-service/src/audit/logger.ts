// ──────────────────────────────────────────────────────────────
// sentinel-os/services/governance-service/src/audit/logger.ts
// Immutable audit log with SHA-256 chain verification
// ──────────────────────────────────────────────────────────────

import { Pool } from 'pg';
import { createHash } from 'crypto';
import { pino } from 'pino';

const logger = pino({ name: 'audit-logger' });

export interface AuditEntry {
  id?: string;
  action: string;
  actor_id: string;
  actor_role: string;
  resource_type: string;
  resource_id: string;
  details: Record<string, any>;
  ip_address: string;
  user_agent?: string;
  classification: string;
  previous_hash?: string;
  entry_hash?: string;
  created_at?: string;
}

export class AuditLogger {
  private pg: Pool;

  constructor(pg: Pool) { this.pg = pg; }

  async log(entry: AuditEntry): Promise<string> {
    // Get previous hash for chain integrity
    const prev = await this.pg.query(
      'SELECT entry_hash FROM governance_audit ORDER BY created_at DESC LIMIT 1'
    );
    const previousHash = prev.rows[0]?.entry_hash || 'GENESIS';

    // Compute this entry's hash
    const payload = JSON.stringify({
      action: entry.action, actor_id: entry.actor_id,
      resource_type: entry.resource_type, resource_id: entry.resource_id,
      details: entry.details, previous_hash: previousHash,
      timestamp: new Date().toISOString(),
    });
    const entryHash = createHash('sha256').update(payload).digest('hex');

    const result = await this.pg.query(
      `INSERT INTO governance_audit
        (action, actor_id, actor_role, resource_type, resource_id, details, ip_address, user_agent, classification, previous_hash, entry_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, created_at`,
      [entry.action, entry.actor_id, entry.actor_role, entry.resource_type,
       entry.resource_id, JSON.stringify(entry.details), entry.ip_address,
       entry.user_agent, entry.classification, previousHash, entryHash],
    );

    logger.info({ action: entry.action, actor: entry.actor_id, resource: `${entry.resource_type}/${entry.resource_id}` }, 'AUDIT');
    return result.rows[0]?.id;
  }

  async verifyChain(): Promise<{ valid: boolean; broken_at?: string; total: number }> {
    const result = await this.pg.query(
      'SELECT id, entry_hash, previous_hash, action, actor_id, resource_type, resource_id, details, created_at FROM governance_audit ORDER BY created_at ASC'
    );

    let prevHash = 'GENESIS';
    for (const row of result.rows) {
      if (row.previous_hash !== prevHash) {
        logger.error({ id: row.id }, 'Audit chain broken');
        return { valid: false, broken_at: row.id, total: result.rows.length };
      }
      const payload = JSON.stringify({
        action: row.action, actor_id: row.actor_id,
        resource_type: row.resource_type, resource_id: row.resource_id,
        details: row.details, previous_hash: row.previous_hash,
        timestamp: row.created_at,
      });
      const expected = createHash('sha256').update(payload).digest('hex');
      if (row.entry_hash !== expected) {
        logger.error({ id: row.id }, 'Audit hash mismatch');
        return { valid: false, broken_at: row.id, total: result.rows.length };
      }
      prevHash = row.entry_hash;
    }
    return { valid: true, total: result.rows.length };
  }

  async query(filters: { action?: string; actor_id?: string; resource_type?: string; from?: string; to?: string }, limit: number = 100): Promise<AuditEntry[]> {
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (filters.action) { conditions.push(`action = $${idx++}`); params.push(filters.action); }
    if (filters.actor_id) { conditions.push(`actor_id = $${idx++}`); params.push(filters.actor_id); }
    if (filters.resource_type) { conditions.push(`resource_type = $${idx++}`); params.push(filters.resource_type); }
    if (filters.from) { conditions.push(`created_at >= $${idx++}`); params.push(filters.from); }
    if (filters.to) { conditions.push(`created_at <= $${idx++}`); params.push(filters.to); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit);
    const result = await this.pg.query(
      `SELECT * FROM governance_audit ${where} ORDER BY created_at DESC LIMIT $${idx}`,
      params,
    );
    return result.rows;
  }
}

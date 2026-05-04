// ──────────────────────────────────────────────────────────────
// sentinel-os/services/governance-service/src/retention/policy.ts
// Data retention policies with automatic enforcement
// ──────────────────────────────────────────────────────────────

import { Pool } from 'pg';
import { pino } from 'pino';

const logger = pino({ name: 'retention-policy' });

export interface RetentionPolicy {
  id: string;
  resource_type: string;
  retention_days: number;
  action: 'DELETE' | 'ARCHIVE' | 'ANONYMIZE';
  classification_override?: string;
  enabled: boolean;
  description: string;
}

const DEFAULT_POLICIES: RetentionPolicy[] = [
  { id: 'ret-audit-365', resource_type: 'governance_audit', retention_days: 365, action: 'ARCHIVE', enabled: true, description: 'Audit logs archived after 1 year' },
  { id: 'ret-alerts-90', resource_type: 'alerts', retention_days: 90, action: 'ARCHIVE', enabled: true, description: 'Alerts archived after 90 days' },
  { id: 'ret-sensor-30', resource_type: 'sensor_telemetry', retention_days: 30, action: 'DELETE', enabled: true, description: 'Raw sensor data deleted after 30 days' },
  { id: 'ret-cyber-raw-7', resource_type: 'cyber_raw_events', retention_days: 7, action: 'DELETE', enabled: true, description: 'Raw IDS events deleted after 7 days' },
  { id: 'ret-cyber-ioc-365', resource_type: 'cyber_threat_indicators', retention_days: 365, action: 'ARCHIVE', enabled: true, description: 'IOCs archived after 1 year' },
  { id: 'ret-osint-60', resource_type: 'osint_items', retention_days: 60, action: 'ARCHIVE', enabled: true, description: 'OSINT items archived after 60 days' },
  { id: 'ret-session-7', resource_type: 'auth_sessions', retention_days: 7, action: 'DELETE', enabled: true, description: 'Expired sessions deleted after 7 days' },
  { id: 'ret-apikey-30', resource_type: 'auth_api_keys', retention_days: 30, action: 'DELETE', enabled: true, description: 'Revoked API keys purged after 30 days' },
];

export class RetentionManager {
  private pg: Pool;
  private policies: RetentionPolicy[];

  constructor(pg: Pool, policies?: RetentionPolicy[]) {
    this.pg = pg;
    this.policies = policies || DEFAULT_POLICIES;
  }

  async enforceAll(): Promise<{ policy_id: string; affected_rows: number; action: string }[]> {
    const results = [];
    for (const policy of this.policies) {
      if (!policy.enabled) continue;
      const affected = await this.enforcePolicy(policy);
      results.push({ policy_id: policy.id, affected_rows: affected, action: policy.action });
    }
    logger.info({ policies_enforced: results.length, total_affected: results.reduce((s, r) => s + r.affected_rows, 0) }, 'Retention enforcement complete');
    return results;
  }

  private async enforcePolicy(policy: RetentionPolicy): Promise<number> {
    const cutoff = `NOW() - INTERVAL '${policy.retention_days} days'`;

    if (policy.action === 'DELETE') {
      const result = await this.pg.query(
        `DELETE FROM ${policy.resource_type} WHERE created_at < ${cutoff}`
      );
      return result.rowCount || 0;
    }

    if (policy.action === 'ARCHIVE') {
      // Move to archive table
      const archiveTable = `${policy.resource_type}_archive`;
      await this.pg.query(`CREATE TABLE IF NOT EXISTS ${archiveTable} AS SELECT * FROM ${policy.resource_type} WITH NO DATA`);
      const insertResult = await this.pg.query(
        `INSERT INTO ${archiveTable} SELECT * FROM ${policy.resource_type} WHERE created_at < ${cutoff}`
      );
      await this.pg.query(`DELETE FROM ${policy.resource_type} WHERE created_at < ${cutoff}`);
      return insertResult.rowCount || 0;
    }

    if (policy.action === 'ANONYMIZE') {
      const result = await this.pg.query(
        `UPDATE ${policy.resource_type} SET details = '{}'::jsonb, ip_address = '0.0.0.0' WHERE created_at < ${cutoff}`
      );
      return result.rowCount || 0;
    }

    return 0;
  }

  async getPolicy(id: string): Promise<RetentionPolicy | undefined> {
    return this.policies.find(p => p.id === id);
  }

  async listPolicies(): Promise<RetentionPolicy[]> {
    return this.policies;
  }

  async updatePolicy(id: string, updates: Partial<RetentionPolicy>): Promise<void> {
    const idx = this.policies.findIndex(p => p.id === id);
    if (idx === -1) return;
    this.policies[idx] = { ...this.policies[idx], ...updates };
  }
}

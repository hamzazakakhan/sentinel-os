// ──────────────────────────────────────────────────────────────
// sentinel-os/services/governance-service/src/compliance/checker.ts
// Compliance checks: STANAG, NATO, GDPR, NIST 800-53
// ──────────────────────────────────────────────────────────────

import { Pool } from 'pg';
import { pino } from 'pino';

const logger = pino({ name: 'compliance-checker' });

export interface ComplianceRule {
  id: string;
  framework: string;
  control: string;
  description: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  check_query: string;
  remediation: string;
}

export interface ComplianceResult {
  rule_id: string;
  framework: string;
  control: string;
  status: 'PASS' | 'FAIL' | 'WARN' | 'ERROR';
  details: string;
  remediation?: string;
  checked_at: string;
}

const DEFAULT_RULES: ComplianceRule[] = [
  { id: 'nist-ac-2', framework: 'NIST-800-53', control: 'AC-2', description: 'Account management — inactive accounts disabled', severity: 'HIGH', check_query: "SELECT count(*) FROM auth_users WHERE is_active = true AND last_login_at < NOW() - INTERVAL '90 days'", remediation: 'Disable accounts inactive for 90+ days' },
  { id: 'nist-ac-7', framework: 'NIST-800-53', control: 'AC-7', description: 'Unsuccessful logins — lockout after 5 attempts', severity: 'HIGH', check_query: "SELECT count(*) FROM auth_users WHERE is_locked = true AND login_attempts >= 5", remediation: 'Verify lockout policy is enforced' },
  { id: 'nist-ia-2', framework: 'NIST-800-53', control: 'IA-2', description: 'MFA required for all admin accounts', severity: 'CRITICAL', check_query: "SELECT count(*) FROM auth_users WHERE role IN ('ADMIN','SUPER_ADMIN') AND mfa_enabled = false", remediation: 'Enable MFA on all admin accounts' },
  { id: 'nist-sc-8', framework: 'NIST-800-53', control: 'SC-8', description: 'Transmission confidentiality — TLS enforced', severity: 'HIGH', check_query: "SELECT count(*) FROM governance_audit WHERE action = 'api_call' AND details->>'protocol' = 'http'", remediation: 'Enforce HTTPS on all API endpoints' },
  { id: 'nist-au-2', framework: 'NIST-800-53', control: 'AU-2', description: 'Audit events — all privileged actions logged', severity: 'HIGH', check_query: "SELECT count(*) FROM governance_audit WHERE actor_role IN ('ADMIN','SUPER_ADMIN') AND created_at > NOW() - INTERVAL '24 hours'", remediation: 'Ensure all privileged actions generate audit events' },
  { id: 'stanag-4778', framework: 'STANAG-4778', control: 'DATA-CLASS', description: 'All data classified per NATO levels', severity: 'CRITICAL', check_query: "SELECT count(*) FROM alerts WHERE severity IS NULL OR domain IS NULL", remediation: 'Classify all unclassified data records' },
  { id: 'gdpr-art5', framework: 'GDPR', control: 'Art.5', description: 'Data minimization — no unnecessary PII stored', severity: 'HIGH', check_query: "SELECT count(*) FROM auth_users WHERE email LIKE '%@%' AND mfa_enabled = false", remediation: 'Review PII storage and minimize data collection' },
];

export class ComplianceChecker {
  private pg: Pool;
  private rules: ComplianceRule[];

  constructor(pg: Pool, rules?: ComplianceRule[]) {
    this.pg = pg;
    this.rules = rules || DEFAULT_RULES;
  }

  async runAllChecks(): Promise<ComplianceResult[]> {
    const results: ComplianceResult[] = [];
    for (const rule of this.rules) {
      results.push(await this.runCheck(rule));
    }
    logger.info({ total: results.length, passed: results.filter(r => r.status === 'PASS').length, failed: results.filter(r => r.status === 'FAIL').length }, 'Compliance check complete');
    return results;
  }

  async runCheck(rule: ComplianceRule): Promise<ComplianceResult> {
    try {
      const result = await this.pg.query(rule.check_query);
      const count = result.rows[0]?.count ?? 0;

      // Rules check for violations — count > 0 means FAIL
      const status: ComplianceResult['status'] = count === 0 ? 'PASS' : 'FAIL';

      return {
        rule_id: rule.id,
        framework: rule.framework,
        control: rule.control,
        status,
        details: status === 'PASS' ? 'No violations found' : `${count} violations found`,
        remediation: status === 'FAIL' ? rule.remediation : undefined,
        checked_at: new Date().toISOString(),
      };
    } catch (err: any) {
      return {
        rule_id: rule.id, framework: rule.framework, control: rule.control,
        status: 'ERROR', details: err.message, checked_at: new Date().toISOString(),
      };
    }
  }

  async runFramework(framework: string): Promise<ComplianceResult[]> {
    const rules = this.rules.filter(r => r.framework === framework);
    const results: ComplianceResult[] = [];
    for (const rule of rules) { results.push(await this.runCheck(rule)); }
    return results;
  }

  getAvailableFrameworks(): string[] {
    return [...new Set(this.rules.map(r => r.framework))];
  }
}

// ──────────────────────────────────────────────────────────────
// sentinel-os/services/response-service/src/rules/engine.ts
// Rule engine — condition evaluation, action triggering, approval gates
// ──────────────────────────────────────────────────────────────

import { Kafka } from 'kafkajs';
import { Pool } from 'pg';
import { pino } from 'pino';

const logger = pino({ name: 'rule-engine' });

export type Operator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'regex' | 'in';

export interface RuleCondition {
  field: string;
  operator: Operator;
  value: any;
}

export interface RuleAction {
  type: 'block_ip' | 'isolate_host' | 'send_alert' | 'run_playbook' | 'notify_channel' | 'quarantine_file' | 'disable_user' | 'custom';
  parameters: Record<string, any>;
  requires_approval: boolean;
  approval_timeout_min: number;
}

export interface ResponseRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  conditions: RuleCondition[];
  condition_logic: 'AND' | 'OR';
  actions: RuleAction[];
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  cooldown_min: number;
  max_executions_per_hour: number;
  created_by: string;
  created_at: string;
  last_triggered_at?: string;
  trigger_count: number;
}

export class RuleEngine {
  private pg: Pool;
  private kafka: Kafka;
  private executionCounts: Map<string, { count: number; resetAt: number }> = new Map();

  constructor(pg: Pool) {
    this.pg = pg;
    this.kafka = new Kafka({ brokers: [process.env.KAFKA_BROKERS || 'localhost:9092'] });
  }

  async evaluateEvent(event: Record<string, any>): Promise<ResponseRule[]> {
    const rules = await this.getActiveRules();
    const matched: ResponseRule[] = [];

    for (const rule of rules) {
      if (this.isInCooldown(rule)) continue;
      if (this.isRateLimited(rule)) continue;

      const conditionMet = rule.condition_logic === 'AND'
        ? rule.conditions.every(c => this.evaluateCondition(event, c))
        : rule.conditions.some(c => this.evaluateCondition(event, c));

      if (conditionMet) {
        matched.push(rule);
        await this.recordTrigger(rule, event);
      }
    }

    if (matched.length > 0) {
      logger.info({ event_type: event.event_type, matched_rules: matched.map(r => r.id) }, 'Rules matched');
    }
    return matched;
  }

  private evaluateCondition(event: Record<string, any>, condition: RuleCondition): boolean {
    const fieldValue = this.getNestedValue(event, condition.field);
    const target = condition.value;

    switch (condition.operator) {
      case 'eq': return fieldValue === target;
      case 'neq': return fieldValue !== target;
      case 'gt': return Number(fieldValue) > Number(target);
      case 'gte': return Number(fieldValue) >= Number(target);
      case 'lt': return Number(fieldValue) < Number(target);
      case 'lte': return Number(fieldValue) <= Number(target);
      case 'contains': return String(fieldValue).includes(String(target));
      case 'regex': return new RegExp(target).test(String(fieldValue));
      case 'in': return Array.isArray(target) && target.includes(fieldValue);
      default: return false;
    }
  }

  private getNestedValue(obj: Record<string, any>, path: string): any {
    return path.split('.').reduce((o, k) => o?.[k], obj);
  }

  private isInCooldown(rule: ResponseRule): boolean {
    if (!rule.last_triggered_at) return false;
    const cooldownMs = rule.cooldown_min * 60 * 1000;
    return Date.now() - new Date(rule.last_triggered_at).getTime() < cooldownMs;
  }

  private isRateLimited(rule: ResponseRule): boolean {
    const counter = this.executionCounts.get(rule.id);
    if (!counter) return false;
    if (Date.now() > counter.resetAt) { this.executionCounts.delete(rule.id); return false; }
    return counter.count >= rule.max_executions_per_hour;
  }

  private async recordTrigger(rule: ResponseRule, event: Record<string, any>): Promise<void> {
    const counter = this.executionCounts.get(rule.id);
    if (!counter || Date.now() > counter.resetAt) {
      this.executionCounts.set(rule.id, { count: 1, resetAt: Date.now() + 3600000 });
    } else {
      counter.count++;
    }

    await this.pg.query(
      'UPDATE response_rules SET last_triggered_at = NOW(), trigger_count = trigger_count + 1 WHERE id = $1',
      [rule.id],
    );
  }

  async executeAction(rule: ResponseRule, action: RuleAction, event: Record<string, any>): Promise<{ approved: boolean; execution_id: string }> {
    const executionId = `exec-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    if (action.requires_approval) {
      await this.pg.query(
        `INSERT INTO response_approvals (id, rule_id, action_type, parameters, event_data, status, created_at)
         VALUES ($1, $2, $3, $4, $5, 'PENDING', NOW())`,
        [executionId, rule.id, action.type, JSON.stringify(action.parameters), JSON.stringify(event)],
      );

      const producer = this.kafka.producer();
      await producer.connect();
      await producer.send({
        topic: 'sentinel.response.approvals',
        messages: [{ key: executionId, value: JSON.stringify({ execution_id: executionId, rule_id: rule.id, action: action, event }) }],
      });
      await producer.disconnect();

      logger.info({ execution_id: executionId, action: action.type }, 'Action pending approval');
      return { approved: false, execution_id: executionId };
    }

    // Auto-execute
    await this.pg.query(
      `INSERT INTO response_executed (id, rule_id, action_type, parameters, event_data, status, executed_at)
       VALUES ($1, $2, $3, $4, $5, 'EXECUTED', NOW())`,
      [executionId, rule.id, action.type, JSON.stringify(action.parameters), JSON.stringify(event)],
    );

    const producer = this.kafka.producer();
    await producer.connect();
    await producer.send({
      topic: 'sentinel.response.executed',
      messages: [{ key: executionId, value: JSON.stringify({ execution_id: executionId, rule_id: rule.id, action, event }) }],
    });
    await producer.disconnect();

    logger.info({ execution_id: executionId, action: action.type }, 'Action executed');
    return { approved: true, execution_id: executionId };
  }

  async getActiveRules(): Promise<ResponseRule[]> {
    const result = await this.pg.query('SELECT * FROM response_rules WHERE enabled = true ORDER BY severity DESC');
    return result.rows;
  }

  async createRule(rule: Omit<ResponseRule, 'trigger_count' | 'last_triggered_at'>): Promise<string> {
    const result = await this.pg.query(
      `INSERT INTO response_rules (id, name, description, enabled, conditions, condition_logic, actions, severity, cooldown_min, max_executions_per_hour, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [rule.id, rule.name, rule.description, rule.enabled,
       JSON.stringify(rule.conditions), rule.condition_logic,
       JSON.stringify(rule.actions), rule.severity,
       rule.cooldown_min, rule.max_executions_per_hour, rule.created_by],
    );
    return result.rows[0]?.id;
  }
}

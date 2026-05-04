// ──────────────────────────────────────────────────────────────
// sentinel-os/services/response-service/src/workflows/approval.ts
// Approval workflows — pending, approve, reject, timeout
// ──────────────────────────────────────────────────────────────

import { Pool } from 'pg';
import { Kafka } from 'kafkajs';
import { pino } from 'pino';

const logger = pino({ name: 'approval-workflow' });

export interface ApprovalRequest {
  id: string;
  rule_id: string;
  action_type: string;
  parameters: Record<string, any>;
  event_data: Record<string, any>;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'TIMED_OUT' | 'EXECUTED';
  requested_at: string;
  requested_by?: string;
  approved_by?: string;
  approved_at?: string;
  rejection_reason?: string;
  timeout_at: string;
}

export class ApprovalWorkflow {
  private pg: Pool;
  private kafka: Kafka;

  constructor(pg: Pool) {
    this.pg = pg;
    this.kafka = new Kafka({ brokers: [process.env.KAFKA_BROKERS || 'localhost:9092'] });
  }

  async getPending(): Promise<ApprovalRequest[]> {
    const result = await this.pg.query(
      `SELECT * FROM response_approvals WHERE status = 'PENDING' ORDER BY created_at ASC`
    );
    return result.rows;
  }

  async approve(approvalId: string, approverId: string): Promise<{ executed: boolean; execution_id: string }> {
    const result = await this.pg.query(
      `UPDATE response_approvals SET status = 'APPROVED', approved_by = $1, approved_at = NOW() WHERE id = $2 AND status = 'PENDING' RETURNING *`,
      [approverId, approvalId],
    );

    if (!result.rows[0]) throw new Error('Approval not found or already processed');

    const approval = result.rows[0];
    const executionId = `exec-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    await this.pg.query(
      `INSERT INTO response_executed (id, rule_id, action_type, parameters, event_data, status, executed_at)
       VALUES ($1, $2, $3, $4, $5, 'EXECUTED', NOW())`,
      [executionId, approval.rule_id, approval.action_type, approval.parameters, approval.event_data],
    );

    await this.pg.query(
      `UPDATE response_approvals SET status = 'EXECUTED' WHERE id = $1`, [approvalId],
    );

    const producer = this.kafka.producer();
    await producer.connect();
    await producer.send({
      topic: 'sentinel.response.executed',
      messages: [{ key: executionId, value: JSON.stringify({ execution_id: executionId, approval_id: approvalId, action: approval.action_type, parameters: approval.parameters }) }],
    });
    await producer.disconnect();

    logger.info({ approval_id: approvalId, execution_id: executionId, approver: approverId }, 'Approval granted and executed');
    return { executed: true, execution_id: executionId };
  }

  async reject(approvalId: string, rejectorId: string, reason: string): Promise<void> {
    await this.pg.query(
      `UPDATE response_approvals SET status = 'REJECTED', approved_by = $1, approved_at = NOW(), rejection_reason = $2 WHERE id = $3 AND status = 'PENDING'`,
      [rejectorId, reason, approvalId],
    );
    logger.info({ approval_id: approvalId, rejector: rejectorId, reason }, 'Approval rejected');
  }

  async processTimeouts(): Promise<number> {
    const result = await this.pg.query(
      `UPDATE response_approvals SET status = 'TIMED_OUT' WHERE status = 'PENDING' AND created_at < NOW() - INTERVAL '30 minutes'`
    );
    const count = result.rowCount || 0;
    if (count > 0) logger.warn({ timed_out: count }, 'Approvals timed out');
    return count;
  }
}

// ──────────────────────────────────────────────────────────────
// sentinel-os/services/governance-service/src/governance/ai-governance.ts
// AI model governance — bias monitoring, drift detection, explainability
// ──────────────────────────────────────────────────────────────

import { Pool } from 'pg';
import { pino } from 'pino';

const logger = pino({ name: 'ai-governance' });

export interface AIModelRecord {
  id: string;
  name: string;
  version: string;
  framework: string;
  purpose: string;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  approved_by?: string;
  approved_at?: string;
  is_active: boolean;
  bias_score?: number;
  drift_score?: number;
  last_evaluated_at?: string;
}

export interface AIEvaluation {
  id: string;
  model_id: string;
  evaluator: string;
  bias_score: number;
  drift_score: number;
  accuracy: number;
  false_positive_rate: number;
  false_negative_rate: number;
  recommendations: string[];
  approved: boolean;
  evaluated_at: string;
}

export class AIGovernance {
  private pg: Pool;

  constructor(pg: Pool) { this.pg = pg; }

  async registerModel(model: AIModelRecord): Promise<string> {
    const result = await this.pg.query(
      `INSERT INTO governance_ai_models (id, name, version, framework, purpose, risk_level, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET name = $2, version = $3, framework = $4, purpose = $5, risk_level = $6
       RETURNING id`,
      [model.id, model.name, model.version, model.framework, model.purpose, model.risk_level, model.is_active],
    );
    logger.info({ model: model.name, version: model.version, risk: model.risk_level }, 'AI model registered');
    return result.rows[0]?.id;
  }

  async evaluateModel(evalData: AIEvaluation): Promise<string> {
    const result = await this.pg.query(
      `INSERT INTO governance_ai_evaluations (id, model_id, evaluator, bias_score, drift_score, accuracy, false_positive_rate, false_negative_rate, recommendations, approved, evaluated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [evalData.id, evalData.model_id, evalData.evaluator, evalData.bias_score, evalData.drift_score,
       evalData.accuracy, evalData.false_positive_rate, evalData.false_negative_rate,
       JSON.stringify(evalData.recommendations), evalData.approved, evalData.evaluated_at],
    );

    // Update model record
    await this.pg.query(
      `UPDATE governance_ai_models SET bias_score = $1, drift_score = $2, last_evaluated_at = $3 WHERE id = $4`,
      [evalData.bias_score, evalData.drift_score, evalData.evaluated_at, evalData.model_id],
    );

    logger.info({ model: evalData.model_id, bias: evalData.bias_score, drift: evalData.drift_score, approved: evalData.approved }, 'AI model evaluated');
    return result.rows[0]?.id;
  }

  async approveModel(modelId: string, approverId: string): Promise<void> {
    await this.pg.query(
      `UPDATE governance_ai_models SET approved_by = $1, approved_at = NOW(), is_active = true WHERE id = $2`,
      [approverId, modelId],
    );
    logger.info({ model: modelId, approver: approverId }, 'AI model approved');
  }

  async revokeApproval(modelId: string): Promise<void> {
    await this.pg.query(
      `UPDATE governance_ai_models SET approved_by = NULL, approved_at = NULL, is_active = false WHERE id = $1`,
      [modelId],
    );
    logger.warn({ model: modelId }, 'AI model approval revoked');
  }

  async getModelsNeedingReview(): Promise<AIModelRecord[]> {
    const result = await this.pg.query(
      `SELECT * FROM governance_ai_models
       WHERE is_active = true AND (
         last_evaluated_at IS NULL OR
         last_evaluated_at < NOW() - INTERVAL '30 days' OR
         bias_score > 0.3 OR drift_score > 0.2
       ) ORDER BY risk_level DESC`
    );
    return result.rows;
  }

  async getEvaluationHistory(modelId: string): Promise<AIEvaluation[]> {
    const result = await this.pg.query(
      `SELECT * FROM governance_ai_evaluations WHERE model_id = $1 ORDER BY evaluated_at DESC LIMIT 20`,
      [modelId],
    );
    return result.rows;
  }

  async checkDriftThreshold(modelId: string): Promise<{ exceeded: boolean; drift_score: number; threshold: number }> {
    const DRIFT_THRESHOLD = 0.2;
    const result = await this.pg.query(
      'SELECT drift_score FROM governance_ai_models WHERE id = $1', [modelId],
    );
    const drift = result.rows[0]?.drift_score ?? 0;
    return { exceeded: drift > DRIFT_THRESHOLD, drift_score: drift, threshold: DRIFT_THRESHOLD };
  }
}

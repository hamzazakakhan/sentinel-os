// ──────────────────────────────────────────────────────────────
// sentinel-os/services/simulation-service/src/threat-engine/mitre.ts
// MITRE ATT&CK engine — technique execution, tactic simulation
// ──────────────────────────────────────────────────────────────

import { Pool } from 'pg';
import { Kafka } from 'kafkajs';
import { pino } from 'pino';

const logger = pino({ name: 'mitre-engine' });

export interface MITRETechnique {
  id: string;         // e.g. T1566.001
  tactic: string;     // e.g. Initial Access
  name: string;
  description: string;
  platforms: string[];
  detection: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface SimulatedAttack {
  id: string;
  scenario_id: string;
  team: 'RED' | 'BLUE' | 'PURPLE';
  technique_id: string;
  technique_name: string;
  tactic: string;
  status: 'PLANNED' | 'EXECUTING' | 'DETECTED' | 'MISSED' | 'BLOCKED' | 'COMPLETED';
  started_at?: string;
  completed_at?: string;
  result?: 'SUCCESS' | 'PARTIAL' | 'FAILURE';
  detection_time_sec?: number;
  notes: string;
}

const MITRE_TACTICS = [
  'Reconnaissance', 'Resource Development', 'Initial Access', 'Execution',
  'Persistence', 'Privilege Escalation', 'Defense Evasion', 'Credential Access',
  'Discovery', 'Lateral Movement', 'Collection', 'Command and Control',
  'Exfiltration', 'Impact',
];

const COMMON_TECHNIQUES: MITRETechnique[] = [
  { id: 'T1566.001', tactic: 'Initial Access', name: 'Spearphishing Attachment', description: 'Send spearphishing email with malicious attachment', platforms: ['Windows', 'Linux', 'macOS'], detection: 'Email gateway, endpoint detection', severity: 'HIGH' },
  { id: 'T1190', tactic: 'Initial Access', name: 'Exploit Public-Facing App', description: 'Exploit vulnerability in internet-facing application', platforms: ['Windows', 'Linux'], detection: 'WAF, IDS, log analysis', severity: 'CRITICAL' },
  { id: 'T1059.001', tactic: 'Execution', name: 'PowerShell', description: 'Execute commands via PowerShell', platforms: ['Windows'], detection: 'Script block logging, AMSI', severity: 'HIGH' },
  { id: 'T1059.004', tactic: 'Execution', name: 'Unix Shell', description: 'Execute commands via bash/sh', platforms: ['Linux', 'macOS'], detection: 'Auditd, process monitoring', severity: 'MEDIUM' },
  { id: 'T1078', tactic: 'Defense Evasion', name: 'Valid Accounts', description: 'Use compromised credentials', platforms: ['Windows', 'Linux', 'macOS'], detection: 'Anomalous login detection, UEBA', severity: 'HIGH' },
  { id: 'T1055', tactic: 'Defense Evasion', name: 'Process Injection', description: 'Inject code into running process', platforms: ['Windows', 'Linux'], detection: 'Memory scanning, behavioral analysis', severity: 'CRITICAL' },
  { id: 'T1071.001', tactic: 'Command and Control', name: 'Web Protocols', description: 'C2 over HTTP/HTTPS', platforms: ['Windows', 'Linux', 'macOS'], detection: 'Network traffic analysis, beaconing detection', severity: 'HIGH' },
  { id: 'T1041', tactic: 'Exfiltration', name: 'Exfiltration Over C2 Channel', description: 'Exfil data through existing C2 connection', platforms: ['Windows', 'Linux', 'macOS'], detection: 'DLP, network anomaly detection', severity: 'CRITICAL' },
];

export class MITREEngine {
  private pg: Pool;
  private kafka: Kafka;
  private techniques: MITRETechnique[];

  constructor(pg: Pool) {
    this.pg = pg;
    this.kafka = new Kafka({ brokers: [process.env.KAFKA_BROKERS || 'localhost:9092'] });
    this.techniques = COMMON_TECHNIQUES;
  }

  getTactics(): string[] { return MITRE_TACTICS; }

  getTechniques(tactic?: string): MITRETechnique[] {
    return tactic ? this.techniques.filter(t => t.tactic === tactic) : this.techniques;
  }

  async startAttackSimulation(scenarioId: string, team: 'RED' | 'BLUE' | 'PURPLE', techniqueId: string): Promise<SimulatedAttack> {
    const technique = this.techniques.find(t => t.id === techniqueId);
    if (!technique) throw new Error(`Technique ${techniqueId} not found`);

    const attack: SimulatedAttack = {
      id: `atk-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      scenario_id: scenarioId,
      team,
      technique_id: technique.id,
      technique_name: technique.name,
      tactic: technique.tactic,
      status: 'EXECUTING',
      started_at: new Date().toISOString(),
      notes: `${team} team simulating ${technique.name} (${technique.id})`,
    };

    await this.pg.query(
      `INSERT INTO simulation_attacks (id, scenario_id, team, technique_id, technique_name, tactic, status, started_at, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [attack.id, scenarioId, team, technique.id, technique.name, technique.tactic, attack.status, attack.started_at, attack.notes],
    );

    logger.info({ attack_id: attack.id, technique: technique.id, team }, 'Attack simulation started');
    return attack;
  }

  async recordDetection(attackId: string, detectionTimeSec: number): Promise<void> {
    await this.pg.query(
      `UPDATE simulation_attacks SET status = 'DETECTED', detection_time_sec = $1, completed_at = NOW() WHERE id = $2`,
      [detectionTimeSec, attackId],
    );
    logger.info({ attack_id: attackId, detection_time: detectionTimeSec }, 'Attack detected by blue team');
  }

  async recordMissed(attackId: string): Promise<void> {
    await this.pg.query(
      `UPDATE simulation_attacks SET status = 'MISSED', completed_at = NOW() WHERE id = $1`,
      [attackId],
    );
    logger.warn({ attack_id: attackId }, 'Attack was NOT detected — gap identified');
  }

  async recordBlocked(attackId: string): Promise<void> {
    await this.pg.query(
      `UPDATE simulation_attacks SET status = 'BLOCKED', result = 'FAILURE', completed_at = NOW() WHERE id = $1`,
      [attackId],
    );
    logger.info({ attack_id: attackId }, 'Attack was blocked by defenses');
  }

  async getScenarioResults(scenarioId: string): Promise<{ total: number; detected: number; missed: number; blocked: number; avg_detection_sec: number }> {
    const result = await this.pg.query(
      `SELECT status, COUNT(*) as cnt, AVG(detection_time_sec) as avg_det FROM simulation_attacks WHERE scenario_id = $1 GROUP BY status`,
      [scenarioId],
    );
    const stats: Record<string, number> = {};
    let avgDet = 0;
    for (const r of result.rows) { stats[r.status] = Number(r.cnt); if (r.avg_det) avgDet = Number(r.avg_det); }
    return {
      total: Object.values(stats).reduce((s, v) => s + v, 0),
      detected: stats['DETECTED'] || 0,
      missed: stats['MISSED'] || 0,
      blocked: stats['BLOCKED'] || 0,
      avg_detection_sec: avgDet,
    };
  }

  async generateKillChainCoverage(scenarioId: string): Promise<Record<string, { attempted: number; detected: number }>> {
    const result = await this.pg.query(
      `SELECT tactic, COUNT(*) as total, COUNT(CASE WHEN status = 'DETECTED' THEN 1 END) as detected FROM simulation_attacks WHERE scenario_id = $1 GROUP BY tactic`,
      [scenarioId],
    );
    const coverage: Record<string, { attempted: number; detected: number }> = {};
    for (const r of result.rows) {
      coverage[r.tactic] = { attempted: Number(r.total), detected: Number(r.detected) };
    }
    return coverage;
  }
}

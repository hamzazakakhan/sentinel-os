// ──────────────────────────────────────────────────────────────
// sentinel-os/services/healing-agent/src/runbooks/engine.ts
// Runbook engine — automated healing actions
// ──────────────────────────────────────────────────────────────

import { exec } from 'child_process';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('runbook-engine');

export interface RunbookStep {
  command: string;
  description: string;
  timeout: number;
}

export interface Runbook {
  name: string;
  type: string;
  steps: RunbookStep[];
  maxRetries: number;
}

export interface RunbookResult {
  success: boolean;
  action: string;
  output?: string;
  error?: string;
}

const BUILT_IN_RUNBOOKS: Runbook[] = [
  {
    name: 'Pod Crash Loop Recovery',
    type: 'POD_CRASH_LOOP',
    maxRetries: 2,
    steps: [
      { command: 'kubectl rollout restart deployment/{service}', description: 'Restart deployment', timeout: 30000 },
      { command: 'kubectl scale deployment/{service} --replicas=0', description: 'Scale to zero', timeout: 15000 },
      { command: 'sleep 5 && kubectl scale deployment/{service} --replicas=2', description: 'Scale back up', timeout: 30000 },
    ],
  },
  {
    name: 'Kafka Lag Recovery',
    type: 'KAFKA_LAG_HIGH',
    maxRetries: 1,
    steps: [
      { command: 'kubectl scale deployment/{service} --replicas=4', description: 'Scale consumers up', timeout: 30000 },
    ],
  },
  {
    name: 'Database Failover',
    type: 'DB_FAILOVER',
    maxRetries: 1,
    steps: [
      { command: 'kubectl annotate cluster sentinel-postgres cnpg.io/reload=""', description: 'Trigger CNPG failover', timeout: 30000 },
    ],
  },
  {
    name: 'Memory Leak Recovery',
    type: 'MEMORY_LEAK',
    maxRetries: 2,
    steps: [
      { command: 'kubectl delete pod -l app={service} --force', description: 'Force delete leaking pod', timeout: 15000 },
    ],
  },
  {
    name: 'Circuit Breaker Open',
    type: 'CIRCUIT_OPEN',
    maxRetries: 1,
    steps: [
      { command: 'istioctl experimental wait --timeout 60s', description: 'Wait for upstream recovery', timeout: 65000 },
      { command: 'kubectl rollout restart deployment/{upstream}', description: 'Restart upstream service', timeout: 30000 },
    ],
  },
  {
    name: 'High Error Rate',
    type: 'HIGH_ERROR_RATE',
    maxRetries: 1,
    steps: [
      { command: 'kubectl rollout restart deployment/{service}', description: 'Restart erroring service', timeout: 30000 },
    ],
  },
];

export class RunbookEngine {
  private runbooks = new Map<string, Runbook>();

  constructor() {
    for (const rb of BUILT_IN_RUNBOOKS) {
      this.runbooks.set(rb.type, rb);
    }
  }

  hasRunbook(type: string): boolean {
    return this.runbooks.has(type);
  }

  listRunbooks(): Runbook[] {
    return Array.from(this.runbooks.values());
  }

  getRunbookCount(): number {
    return this.runbooks.size;
  }

  async execute(type: string, incident: any): Promise<RunbookResult> {
    const runbook = this.runbooks.get(type);
    if (!runbook) {
      return { success: false, action: 'NO_RUNBOOK', error: `No runbook for type: ${type}` };
    }

    logger.info({ type, steps: runbook.steps.length }, 'Executing runbook');

    for (let attempt = 0; attempt <= runbook.maxRetries; attempt++) {
      let allStepsSucceeded = true;

      for (const step of runbook.steps) {
        const command = step.command
          .replace('{service}', incident.serviceName || 'unknown')
          .replace('{upstream}', incident.upstreamService || incident.serviceName || 'unknown');

        logger.info({ command, description: step.description, attempt }, 'Running runbook step');

        try {
          const output = await this.execCommand(command, step.timeout);
          logger.info({ command, output: output.slice(0, 200) }, 'Step succeeded');
        } catch (err: any) {
          logger.warn({ command, err: err.message, attempt }, 'Step failed');
          allStepsSucceeded = false;
          break;
        }
      }

      if (allStepsSucceeded) {
        return { success: true, action: `Runbook "${runbook.name}" completed successfully` };
      }
    }

    return { success: false, action: `Runbook "${runbook.name}" failed after ${runbook.maxRetries + 1} attempts` };
  }

  private execCommand(command: string, timeout: number): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(command, { timeout }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr || err.message));
        } else {
          resolve(stdout);
        }
      });
    });
  }
}

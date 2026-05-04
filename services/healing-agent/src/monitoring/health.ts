// ──────────────────────────────────────────────────────────────
// sentinel-os/services/healing-agent/src/monitoring/health.ts
// Health monitor — tracks incidents, polls service health
// ──────────────────────────────────────────────────────────────

import axios from 'axios';
import { createLogger } from '../utils/logger.js';
import { v4 as uuid } from 'uuid';

const logger = createLogger('health-monitor');

export interface Incident {
  id: string;
  serviceName: string;
  alertName: string;
  severity: string;
  message: string;
  type: string;
  status: 'NEW' | 'HEALING' | 'HEALED' | 'ESCALATED' | 'FAILED';
  timestamp: string;
  labels?: Record<string, string>;
  healedAt?: string;
  healAction?: string;
  escalationReason?: string;
  failReason?: string;
}

export interface HealRecord {
  incidentId: string;
  serviceName: string;
  action: string;
  outcome: string;
  timestamp: string;
}

const SERVICE_ENDPOINTS: Record<string, string> = {
  'auth-service': 'http://auth-service:4001/healthz',
  'cyber-service': 'http://cyber-service:4002/healthz',
  'ingestion-service': 'http://ingestion-service:4002/healthz',
  'ai-service': 'http://ai-service:4003/healthz',
  'fusion-service': 'http://fusion-service:4004/healthz',
  'osint-service': 'http://osint-service:4005/healthz',
  'governance-service': 'http://governance-service:4006/healthz',
  'response-service': 'http://response-service:4007/healthz',
  'simulation-service': 'http://simulation-service:4008/healthz',
  'api-gateway': 'http://api-gateway:4000/healthz',
  'sigint-service': 'http://sigint-service:8080/healthz',
};

export class HealthMonitor {
  private incidents = new Map<string, Incident>();
  private heals: HealRecord[] = [];
  private serviceHealth = new Map<string, boolean>();

  createIncident(params: {
    serviceName: string;
    alertName: string;
    severity: string;
    message: string;
    type?: string;
    status?: string;
    labels?: Record<string, string>;
  }): Incident {
    const type = params.type || this.inferType(params.alertName);
    const incident: Incident = {
      id: uuid(),
      serviceName: params.serviceName,
      alertName: params.alertName,
      severity: params.severity,
      message: params.message,
      type,
      status: 'NEW',
      timestamp: new Date().toISOString(),
      labels: params.labels,
    };

    this.incidents.set(incident.id, incident);
    logger.info({ id: incident.id, type, service: params.serviceName }, 'Incident created');
    return incident;
  }

  private inferType(alertName: string): string {
    const map: Record<string, string> = {
      'CrashLoopBackOff': 'POD_CRASH_LOOP',
      'HighKafkaLag': 'KAFKA_LAG_HIGH',
      'HighErrorRate': 'HIGH_ERROR_RATE',
      'HighMemoryUsage': 'MEMORY_LEAK',
      'CircuitBreakerOpen': 'CIRCUIT_OPEN',
      'DatabaseFailover': 'DB_FAILOVER',
      'TAMPER_DETECTED': 'TAMPER',
    };
    return map[alertName] || 'UNKNOWN';
  }

  getIncident(id: string): Incident | undefined {
    return this.incidents.get(id);
  }

  getActiveIncidents(): Incident[] {
    return Array.from(this.incidents.values())
      .filter(i => i.status === 'NEW' || i.status === 'HEALING');
  }

  getActiveIncidentCount(): number {
    return this.getActiveIncidents().length;
  }

  getTotalHealCount(): number {
    return this.heals.length;
  }

  getRecentHeals(limit = 50): HealRecord[] {
    return this.heals.slice(-limit);
  }

  markHealed(id: string, action: string): void {
    const incident = this.incidents.get(id);
    if (incident) {
      incident.status = 'HEALED';
      incident.healedAt = new Date().toISOString();
      incident.healAction = action;
      this.heals.push({
        incidentId: id,
        serviceName: incident.serviceName,
        action,
        outcome: 'HEALED',
        timestamp: new Date().toISOString(),
      });
    }
  }

  markEscalated(id: string, rcaResult: any): void {
    const incident = this.incidents.get(id);
    if (incident) {
      incident.status = 'ESCALATED';
      incident.escalationReason = rcaResult.rootCause || 'Runbook failed';
    }
  }

  markFailed(id: string, reason: string): void {
    const incident = this.incidents.get(id);
    if (incident) {
      incident.status = 'FAILED';
      incident.failReason = reason;
    }
  }

  acknowledgeIncident(id: string): void {
    const incident = this.incidents.get(id);
    if (incident && incident.status === 'NEW') {
      incident.status = 'HEALING';
    }
  }

  async pollServiceHealth(): Promise<void> {
    for (const [name, url] of Object.entries(SERVICE_ENDPOINTS)) {
      try {
        const res = await axios.get(url, { timeout: 5000 });
        const wasHealthy = this.serviceHealth.get(name);
        this.serviceHealth.set(name, true);

        if (!wasHealthy) {
          logger.info({ service: name }, 'Service recovered');
        }
      } catch {
        const wasHealthy = this.serviceHealth.get(name);
        this.serviceHealth.set(name, false);

        if (wasHealthy !== false) {
          logger.warn({ service: name }, 'Service unhealthy detected');
        }
      }
    }
  }
}

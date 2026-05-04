// ──────────────────────────────────────────────────────────────
// sentinel-os/services/healing-agent/src/rca/engine.ts
// Root Cause Analysis via Ollama LLM
// ──────────────────────────────────────────────────────────────

import axios from 'axios';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('rca-engine');

export interface RcaResult {
  rootCause: string;
  confidence: 'HIGH' | 'MED' | 'LOW';
  immediateAction: string;
  prevention: string;
  rawAnalysis: string;
}

export class RcaEngine {
  private ollamaUrl: string;

  constructor(ollamaUrl: string) {
    this.ollamaUrl = ollamaUrl;
  }

  async analyze(incident: any): Promise<RcaResult> {
    const ctx = {
      service: incident.serviceName,
      error: incident.message,
      alertName: incident.alertName,
      severity: incident.severity,
      timestamp: incident.timestamp,
      labels: incident.labels,
    };

    const prompt = `Incident in Sentinel OS C4ISR platform:
${JSON.stringify(ctx, null, 2)}

Provide:
1. ROOT CAUSE (most likely)
2. CONFIDENCE (HIGH/MED/LOW)
3. IMMEDIATE ACTION (one kubectl/bash command)
4. PREVENTION (config change to prevent recurrence)`;

    try {
      const res = await axios.post(`${this.ollamaUrl}/api/generate`, {
        model: 'llama3.2',
        system: 'You are SENTINEL system health AI. Analyze incidents. Respond in the exact format specified.',
        prompt,
        options: { temperature: 0.1 },
        stream: false,
      }, { timeout: 30000 });

      const analysis = res.data?.response || '';

      // Parse the LLM response
      const rootCause = this.extractSection(analysis, 'ROOT CAUSE') || 'Unknown — LLM analysis unavailable';
      const confidence = this.extractConfidence(analysis);
      const immediateAction = this.extractSection(analysis, 'IMMEDIATE ACTION') || 'kubectl rollout restart deployment/' + (incident.serviceName || 'unknown');
      const prevention = this.extractSection(analysis, 'PREVENTION') || 'Review service configuration and resource limits';

      return {
        rootCause,
        confidence,
        immediateAction,
        prevention,
        rawAnalysis: analysis,
      };
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Ollama RCA failed — returning fallback analysis');
      return {
        rootCause: `Service ${incident.serviceName} reported: ${incident.message}`,
        confidence: 'LOW',
        immediateAction: `kubectl rollout restart deployment/${incident.serviceName || 'unknown'}`,
        prevention: 'Review service logs and resource limits',
        rawAnalysis: 'Ollama unavailable — fallback analysis',
      };
    }
  }

  private extractSection(text: string, section: string): string | null {
    const regex = new RegExp(`${section}[^:]*:\\s*(.+?)(?:\\n\\d|\\n[A-Z]|$)`, 'is');
    const match = text.match(regex);
    return match ? match[1].trim() : null;
  }

  private extractConfidence(text: string): 'HIGH' | 'MED' | 'LOW' {
    const match = text.match(/CONFIDENCE[^:]*:\s*(HIGH|MED|LOW)/i);
    return match ? match[1].toUpperCase() as 'HIGH' | 'MED' | 'LOW' : 'LOW';
  }
}

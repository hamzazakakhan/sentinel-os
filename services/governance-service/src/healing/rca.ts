// ──────────────────────────────────────────────────────────────
// sentinel-os/services/governance-service/src/healing/rca.ts
// Root Cause Analysis via Ollama LLM for unexplained failures
// Publishes analysis to sentinel.healing.rca Kafka topic
// ──────────────────────────────────────────────────────────────

import axios from 'axios';
import { pino } from 'pino';
import { Kafka } from 'kafkajs';

const logger = pino({ name: 'rca' });
const KAFKA_BROKER = process.env.KAFKA_BROKERS || 'localhost:9092';
const OLLAMA_URL = process.env.OLLAMA_BASE_URL || 'http://ollama:11434';

const kafka = new Kafka({ brokers: [KAFKA_BROKER] });

export interface Incident {
  serviceName: string;
  errorMessage: string;
  prometheusSnapshot?: Record<string, number>;
  recentLogs?: string[];
  dependencyGraph?: string[];
}

export interface RcaAnalysis {
  rootCause: string;
  confidence: 'HIGH' | 'MED' | 'LOW';
  immediateAction: string;
  prevention: string;
  rawAnalysis: string;
}

export async function runRootCauseAnalysis(incident: Incident): Promise<RcaAnalysis> {
  const ctx = {
    service: incident.serviceName,
    error: incident.errorMessage,
    metrics: incident.prometheusSnapshot,
    logs: incident.recentLogs?.slice(-50),
    topology: incident.dependencyGraph,
  };

  try {
    const res = await axios.post(`${OLLAMA_URL}/api/generate`, {
      model: 'llama3.2',
      system: 'You are SENTINEL system health AI. Analyze incidents.',
      prompt: `Incident in Sentinel OS C4ISR platform:
${JSON.stringify(ctx, null, 2)}

Provide:
1. ROOT CAUSE (most likely)
2. CONFIDENCE (HIGH/MED/LOW)
3. IMMEDIATE ACTION (one kubectl/bash command)
4. PREVENTION (config change to prevent recurrence)`,
      options: { temperature: 0.1 },
      stream: false,
    }, { timeout: 30000 });

    const analysis = res.data?.response || '';

    const result: RcaAnalysis = {
      rootCause: extractSection(analysis, 'ROOT CAUSE') || 'Unknown',
      confidence: extractConfidence(analysis),
      immediateAction: extractSection(analysis, 'IMMEDIATE ACTION') || `kubectl rollout restart deployment/${incident.serviceName}`,
      prevention: extractSection(analysis, 'PREVENTION') || 'Review service configuration',
      rawAnalysis: analysis,
    };

    // Publish to sentinel.healing.rca Kafka topic
    const producer = kafka.producer();
    await producer.connect();
    await producer.send({
      topic: 'sentinel.healing.rca',
      messages: [{
        key: `${incident.serviceName}-${Date.now()}`,
        value: JSON.stringify({ incident, analysis: result }),
      }],
    });
    await producer.disconnect();

    return result;
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Ollama RCA failed — returning fallback');
    return {
      rootCause: `Service ${incident.serviceName} reported: ${incident.errorMessage}`,
      confidence: 'LOW',
      immediateAction: `kubectl rollout restart deployment/${incident.serviceName}`,
      prevention: 'Review service logs and resource limits',
      rawAnalysis: 'Ollama unavailable — fallback analysis',
    };
  }
}

function extractSection(text: string, section: string): string | null {
  const regex = new RegExp(`${section}[^:]*:\\s*(.+?)(?:\\n\\d|\\n[A-Z]|$)`, 'is');
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

function extractConfidence(text: string): 'HIGH' | 'MED' | 'LOW' {
  const match = text.match(/CONFIDENCE[^:]*:\s*(HIGH|MED|LOW)/i);
  return match ? match[1].toUpperCase() as 'HIGH' | 'MED' | 'LOW' : 'LOW';
}

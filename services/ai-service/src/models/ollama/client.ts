import axios, { AxiosInstance } from 'axios';
import { createLogger } from '../../utils/logger.js';
import { v4 as uuid } from 'uuid';

const logger = createLogger('ollama-client');

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  contextLength: number;
  timeout: number;
}

export interface OllamaQueryInput {
  promptType: string;
  prompt: string;
  systemPrompt?: string;
  contextDocuments?: string[];
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

export interface OllamaResponse {
  id: string;
  promptType: string;
  response: string;
  structuredOutput: Record<string, any> | null;
  tokensPrompt: number;
  tokensResponse: number;
  durationMs: number;
  modelUsed: string;
  confidence: number | null;
  timestamp: string;
}

const SYSTEM_PROMPTS: Record<string, string> = {
  THREAT_INVESTIGATION: `You are a senior intelligence analyst in a military-grade C4ISR system called Sentinel OS.
Your role is to analyze threat data, correlate indicators, and provide actionable threat assessments.
Always structure your response with: SUMMARY, KEY FINDINGS, INDICATORS OF COMPROMISE, RISK ASSESSMENT (1-10), RECOMMENDED ACTIONS.
Be precise, factual, and avoid speculation. Reference specific data points from the provided context.
Use NATO standard threat assessment terminology where applicable.`,

  INTELLIGENCE_SUMMARY: `You are an intelligence summarization engine in a defense operating system.
Synthesize multiple intelligence sources into a coherent briefing.
Structure as: EXECUTIVE SUMMARY, SOURCE ANALYSIS, KEY INTELLIGENCE POINTS, ASSESSMENT, INFORMATION GAPS.
Apply source reliability ratings (A-F) and information credibility ratings (1-6) per NATO STANAG 2022.
Maintain objectivity and clearly distinguish between facts, assessments, and assumptions.`,

  NATURAL_LANGUAGE_QUERY: `You are the natural language query interface for Sentinel OS, a C4ISR defense platform.
Translate the user's natural language question into structured data queries.
Respond with a JSON object containing: {"intent": "...", "entities": [...], "filters": {...}, "timeRange": {...}, "suggestedQuery": "...", "explanation": "..."}.
Support queries about alerts, detections, sensors, tracks, cyber events, OSINT items, and intelligence entities.`,

  ENTITY_EXTRACTION: `You are a named entity recognition engine for intelligence analysis.
Extract all entities from the provided text and classify them.
Return a JSON array of entities: [{"text": "...", "type": "PERSON|ORGANIZATION|LOCATION|WEAPON|VEHICLE|DEVICE|EVENT|DATE|IP_ADDRESS|DOMAIN|HASH|EMAIL|PHONE|MONEY|QUANTITY", "confidence": 0.0-1.0, "context": "...", "aliases": [...]}].
Be thorough and extract every identifiable entity. Include geographic coordinates where locations are mentioned.`,

  MISINFORMATION_DETECTION: `You are a misinformation detection engine for defense intelligence.
Analyze the provided content for indicators of misinformation, disinformation, or propaganda.
Evaluate: source credibility, narrative consistency, emotional manipulation, factual accuracy, bot/coordinated behavior indicators.
Return structured assessment: {"misinformationScore": 0.0-1.0, "indicators": [...], "narrativeAnalysis": "...", "factCheckPoints": [...], "confidence": 0.0-1.0, "recommendation": "..."}.`,

  DECISION_SUPPORT: `You are an AI decision support system for military/defense command operations.
Analyze the tactical situation and provide decision options with risk assessments.
Structure as: SITUATION ASSESSMENT, COURSES OF ACTION (with pros/cons/risks for each), RECOMMENDATION, CRITICAL FACTORS, TIME SENSITIVITY.
Apply military decision-making process (MDMP) principles. Flag any human-in-the-loop requirements.
Never recommend lethal actions. Always include "HUMAN APPROVAL REQUIRED" for kinetic or irreversible actions.`,

  REPORT_GENERATION: `You are a military/intelligence report generation engine.
Generate standardized intelligence reports following established formats.
Include: classification markings, DTG (date-time group), references, body, assessment, and distribution list template.
Use clear, concise military writing style. Avoid ambiguity.`,
};

export class OllamaClient {
  private config: OllamaConfig;
  private http: AxiosInstance;
  private ready = false;
  private availableModels: string[] = [];

  constructor(config: OllamaConfig) {
    this.config = config;
    this.http = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async initialize(): Promise<void> {
    try {
      const response = await this.http.get('/api/tags');
      this.availableModels = response.data.models?.map((m: any) => m.name) || [];
      logger.info({ models: this.availableModels }, 'Connected to Ollama');

      if (!this.availableModels.includes(this.config.model)) {
        logger.warn({ requested: this.config.model, available: this.availableModels },
          'Requested model not found, attempting to pull');
        await this.pullModel(this.config.model);
      }

      this.ready = true;
    } catch (error: any) {
      logger.error({ error: error.message, url: this.config.baseUrl }, 'Failed to connect to Ollama');
      this.ready = false;
      setTimeout(() => this.initialize(), 10000);
    }
  }

  private async pullModel(model: string): Promise<void> {
    try {
      logger.info({ model }, 'Pulling Ollama model...');
      await this.http.post('/api/pull', { name: model }, { timeout: 3600000 });
      this.availableModels.push(model);
      logger.info({ model }, 'Model pulled successfully');
    } catch (error: any) {
      logger.error({ error: error.message, model }, 'Failed to pull model');
    }
  }

  async query(input: OllamaQueryInput): Promise<OllamaResponse> {
    if (!this.ready) throw new Error('Ollama client not ready');

    const id = uuid();
    const startTime = Date.now();
    const model = input.model || this.config.model;
    const systemPrompt = input.systemPrompt || SYSTEM_PROMPTS[input.promptType] || '';

    let fullPrompt = input.prompt;
    if (input.contextDocuments?.length) {
      fullPrompt = `CONTEXT DOCUMENTS:\n${input.contextDocuments.map((doc, i) => `[Document ${i + 1}]: ${doc}`).join('\n\n')}\n\nQUERY: ${input.prompt}`;
    }

    try {
      const response = await this.http.post('/api/generate', {
        model,
        prompt: fullPrompt,
        system: systemPrompt,
        stream: false,
        options: {
          temperature: input.temperature ?? 0.3,
          num_predict: input.maxTokens || 4096,
          num_ctx: this.config.contextLength,
          top_p: 0.9,
          top_k: 40,
          repeat_penalty: 1.1,
        },
      });

      const data = response.data;
      let structuredOutput: Record<string, any> | null = null;

      try {
        const jsonMatch = data.response.match(/```json\n([\s\S]*?)\n```/) ||
                          data.response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          structuredOutput = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        }
      } catch { /* response is not JSON */ }

      return {
        id,
        promptType: input.promptType,
        response: data.response,
        structuredOutput,
        tokensPrompt: data.prompt_eval_count || 0,
        tokensResponse: data.eval_count || 0,
        durationMs: Date.now() - startTime,
        modelUsed: model,
        confidence: structuredOutput?.confidence || null,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      logger.error({ error: error.message, model, promptType: input.promptType }, 'Ollama query failed');
      throw new Error(`Ollama query failed: ${error.message}`);
    }
  }

  async investigateThreat(input: {
    alertId?: string;
    threatData: Record<string, any>;
    contextAlerts?: Record<string, any>[];
    relatedIndicators?: Record<string, any>[];
  }): Promise<OllamaResponse> {
    const contextDocs: string[] = [];
    if (input.threatData) {
      contextDocs.push(`PRIMARY THREAT DATA:\n${JSON.stringify(input.threatData, null, 2)}`);
    }
    if (input.contextAlerts?.length) {
      contextDocs.push(`RELATED ALERTS:\n${JSON.stringify(input.contextAlerts, null, 2)}`);
    }
    if (input.relatedIndicators?.length) {
      contextDocs.push(`THREAT INDICATORS:\n${JSON.stringify(input.relatedIndicators, null, 2)}`);
    }

    return this.query({
      promptType: 'THREAT_INVESTIGATION',
      prompt: `Conduct a thorough threat investigation for ${input.alertId ? `Alert ID: ${input.alertId}` : 'the following threat data'}. Analyze all provided context, identify patterns, assess risk level, and recommend immediate actions.`,
      contextDocuments: contextDocs,
      temperature: 0.2,
    });
  }

  async summarizeIntelligence(input: {
    documents: string[];
    focusArea?: string;
    timeframe?: string;
    audience?: string;
  }): Promise<OllamaResponse> {
    const prompt = [
      'Generate a comprehensive intelligence summary.',
      input.focusArea ? `Focus area: ${input.focusArea}` : '',
      input.timeframe ? `Timeframe: ${input.timeframe}` : '',
      input.audience ? `Audience: ${input.audience}` : '',
      'Synthesize all provided source documents into a coherent intelligence briefing.',
    ].filter(Boolean).join('\n');

    return this.query({
      promptType: 'INTELLIGENCE_SUMMARY',
      prompt,
      contextDocuments: input.documents,
      temperature: 0.3,
    });
  }

  async extractEntities(text: string): Promise<OllamaResponse> {
    return this.query({
      promptType: 'ENTITY_EXTRACTION',
      prompt: `Extract all named entities from the following text:\n\n${text}`,
      temperature: 0.1,
    });
  }

  async detectMisinformation(content: string, source?: string): Promise<OllamaResponse> {
    const prompt = source
      ? `Analyze the following content from source "${source}" for misinformation indicators:\n\n${content}`
      : `Analyze the following content for misinformation indicators:\n\n${content}`;

    return this.query({
      promptType: 'MISINFORMATION_DETECTION',
      prompt,
      temperature: 0.2,
    });
  }

  async naturalLanguageQuery(question: string): Promise<OllamaResponse> {
    return this.query({
      promptType: 'NATURAL_LANGUAGE_QUERY',
      prompt: question,
      temperature: 0.1,
    });
  }

  async decisionSupport(situation: Record<string, any>): Promise<OllamaResponse> {
    return this.query({
      promptType: 'DECISION_SUPPORT',
      prompt: `Analyze the following tactical situation and provide decision support:\n\n${JSON.stringify(situation, null, 2)}`,
      contextDocuments: situation.contextDocuments,
      temperature: 0.3,
    });
  }

  async listModels(): Promise<any[]> {
    const response = await this.http.get('/api/tags');
    return response.data.models || [];
  }

  isReady(): boolean { return this.ready; }
}

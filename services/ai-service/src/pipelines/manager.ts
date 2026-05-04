import { Producer } from 'kafkajs';
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { v4 as uuid } from 'uuid';
import { YoloV8Detector } from '../models/yolov8/detector.js';
import { IsolationForestDetector } from '../models/isolation-forest/detector.js';
import { LSTMPredictor } from '../models/lstm/predictor.js';
import { OllamaClient } from '../models/ollama/client.js';
import { ModelRegistry } from './registry.js';
import { DriftMonitor } from './drift.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('inference-pipeline');

interface PipelineDeps {
  yolo: YoloV8Detector;
  isolationForest: IsolationForestDetector;
  lstm: LSTMPredictor;
  ollama: OllamaClient;
  producer: Producer;
  pgPool: Pool;
  redis: Redis;
  modelRegistry: ModelRegistry;
  driftMonitor: DriftMonitor;
}

export class InferencePipelineManager {
  private deps: PipelineDeps;
  private processingCount = 0;
  private totalProcessed = 0;
  private errorCount = 0;

  constructor(deps: PipelineDeps) {
    this.deps = deps;
  }

  async routeMessage(topic: string, data: any): Promise<void> {
    this.processingCount++;
    const startTime = Date.now();

    try {
      switch (topic) {
        case 'sentinel.ingestion.video-frames':
          await this.processVideoFrame(data);
          break;
        case 'sentinel.ingestion.sensor-telemetry':
          await this.processSensorTelemetry(data);
          break;
        case 'sentinel.ingestion.radar-sweeps':
          await this.processRadarSweep(data);
          break;
        case 'sentinel.cyber.raw-events':
          await this.processCyberEvent(data);
          break;
        case 'sentinel.osint.for-analysis':
          await this.processOsintItem(data);
          break;
        case 'sentinel.ai.inference-requests':
          await this.processInferenceRequest(data);
          break;
        default:
          logger.warn({ topic }, 'Unknown topic received');
      }
      this.totalProcessed++;
    } catch (error) {
      this.errorCount++;
      logger.error({ error, topic, dataId: data?.id }, 'Pipeline processing error');
      await this.publishError(topic, data, error);
    } finally {
      this.processingCount--;
      const duration = Date.now() - startTime;
      if (duration > 5000) {
        logger.warn({ topic, duration }, 'Slow pipeline processing');
      }
    }
  }

  private async processVideoFrame(data: any): Promise<void> {
    if (!this.deps.yolo.isReady()) {
      logger.warn('YOLOv8 not ready, skipping frame');
      return;
    }

    const imageBuffer = Buffer.from(data.frameData, 'base64');
    const result = await this.deps.yolo.detect(imageBuffer, {
      sensorId: data.sensorId,
      frameNumber: data.frameNumber,
      timestamp: data.timestamp,
    });

    if (result.detections.length > 0) {
      await this.deps.producer.send({
        topic: 'sentinel.detections.created',
        messages: result.detections.map(det => ({
          key: data.sensorId,
          value: JSON.stringify({
            id: det.id,
            sensorId: data.sensorId,
            domain: data.domain || 'LAND',
            detectionType: det.label,
            confidence: det.confidence,
            boundingBox: det.bbox,
            modelVersion: result.modelVersion,
            attributes: det.attributes,
            location: data.location,
            detectedAt: result.timestamp,
            rawDataRef: data.rawDataRef,
          }),
          headers: {
            'content-type': Buffer.from('application/json'),
            'source-service': Buffer.from('ai-service'),
            'inference-time-ms': Buffer.from(String(result.inferenceTimeMs)),
          },
        })),
      });

      await this.deps.driftMonitor.recordPrediction('yolov8', {
        detectionCount: result.detections.length,
        avgConfidence: result.detections.reduce((s, d) => s + d.confidence, 0) / result.detections.length,
        inferenceTimeMs: result.inferenceTimeMs,
      });

      const threatDetections = result.detections.filter(
        d => ['weapon', 'knife', 'gun', 'explosive', 'suspicious_package', 'military_vehicle'].includes(d.label.toLowerCase())
      );

      if (threatDetections.length > 0) {
        for (const det of threatDetections) {
          await this.deps.producer.send({
            topic: 'sentinel.alerts.created',
            messages: [{
              key: data.sensorId,
              value: JSON.stringify({
                id: uuid(),
                title: `Threat object detected: ${det.label}`,
                description: `YOLOv8 detected ${det.label} with ${(det.confidence * 100).toFixed(1)}% confidence on sensor ${data.sensorId}`,
                severity: det.confidence > 0.8 ? 'HIGH' : 'MEDIUM',
                domain: data.domain || 'LAND',
                sourceType: 'AI_DETECTION',
                sourceId: det.id,
                location: data.location,
                confidence: det.confidence,
                tags: ['ai-detection', 'yolov8', det.label],
                classification: 'CONFIDENTIAL',
              }),
            }],
          });
        }
      }
    }
  }

  private async processSensorTelemetry(data: any): Promise<void> {
    if (!this.deps.isolationForest.isReady()) return;

    const features = this.extractTelemetryFeatures(data);
    const result = await this.deps.isolationForest.detect(features, data.sensorId);

    if (result.isAnomaly) {
      await this.deps.producer.send({
        topic: 'sentinel.alerts.created',
        messages: [{
          key: data.sensorId,
          value: JSON.stringify({
            id: uuid(),
            title: `Anomalous sensor telemetry detected`,
            description: `Isolation Forest detected anomaly on sensor ${data.sensorId}. Score: ${result.anomalyScore.toFixed(4)}. Top contributing features: ${Object.entries(result.featureContributions).sort(([,a], [,b]) => (b as number) - (a as number)).slice(0, 3).map(([k, v]) => `${k}=${(v as number).toFixed(3)}`).join(', ')}`,
            severity: result.anomalyScore > 0.8 ? 'HIGH' : 'MEDIUM',
            domain: data.domain || 'LAND',
            sourceType: 'ANOMALY_DETECTION',
            sourceId: data.sensorId,
            location: data.location,
            confidence: Math.min(result.anomalyScore, 1.0),
            tags: ['anomaly-detection', 'isolation-forest', data.sensorType],
            classification: 'CONFIDENTIAL',
            metadata: { featureContributions: result.featureContributions },
          }),
        }],
      });
    }

    await this.deps.driftMonitor.recordPrediction('isolation-forest', {
      isAnomaly: result.isAnomaly ? 1 : 0,
      anomalyScore: result.anomalyScore,
      inferenceTimeMs: result.inferenceTimeMs,
    });
  }

  private async processRadarSweep(data: any): Promise<void> {
    const features = this.extractRadarFeatures(data);
    if (this.deps.isolationForest.isReady()) {
      const anomaly = await this.deps.isolationForest.detect(features, data.sensorId);
      if (anomaly.isAnomaly) {
        await this.deps.producer.send({
          topic: 'sentinel.alerts.created',
          messages: [{
            key: data.sensorId,
            value: JSON.stringify({
              id: uuid(),
              title: 'Anomalous radar signature detected',
              description: `Unusual radar return pattern on ${data.sensorId}`,
              severity: 'MEDIUM',
              domain: 'AIR',
              sourceType: 'RADAR_ANOMALY',
              sourceId: data.sensorId,
              location: data.location,
              confidence: anomaly.anomalyScore,
              tags: ['radar', 'anomaly'],
              classification: 'SECRET',
            }),
          }],
        });
      }
    }
  }

  private async processCyberEvent(data: any): Promise<void> {
    if (!this.deps.ollama.isReady()) return;

    if (data.severity === 'CRITICAL' || data.severity === 'HIGH') {
      const investigation = await this.deps.ollama.investigateThreat({
        threatData: data,
        contextAlerts: data.relatedAlerts || [],
        relatedIndicators: data.iocMatches || [],
      });

      await this.deps.producer.send({
        topic: 'sentinel.ai.analysis-results',
        messages: [{
          key: data.id || uuid(),
          value: JSON.stringify({
            sourceType: 'cyber_event',
            sourceId: data.id,
            analysisType: 'threat_investigation',
            result: investigation.response,
            structuredOutput: investigation.structuredOutput,
            modelUsed: investigation.modelUsed,
            confidence: investigation.confidence,
            analyzedAt: investigation.timestamp,
          }),
        }],
      });
    }
  }

  private async processOsintItem(data: any): Promise<void> {
    if (!this.deps.ollama.isReady()) return;

    const [entities, misinfo] = await Promise.allSettled([
      this.deps.ollama.extractEntities(data.content?.text || ''),
      data.requiresMisinfoCheck
        ? this.deps.ollama.detectMisinformation(data.content?.text || '', data.sourceName)
        : Promise.resolve(null),
    ]);

    const result: any = { sourceId: data.id, sourceType: 'osint' };

    if (entities.status === 'fulfilled' && entities.value) {
      result.entities = entities.value.structuredOutput;
    }
    if (misinfo.status === 'fulfilled' && misinfo.value) {
      result.misinformationAnalysis = misinfo.value.structuredOutput;
    }

    await this.deps.producer.send({
      topic: 'sentinel.ai.analysis-results',
      messages: [{
        key: data.id || uuid(),
        value: JSON.stringify(result),
      }],
    });
  }

  private async processInferenceRequest(data: any): Promise<void> {
    switch (data.requestType) {
      case 'ollama_query':
        const response = await this.deps.ollama.query(data.input);
        await this.deps.producer.send({
          topic: 'sentinel.ai.inference-results',
          messages: [{ key: data.requestId, value: JSON.stringify(response) }],
        });
        break;
      case 'lstm_predict':
        if (this.deps.lstm.isReady()) {
          const prediction = await this.deps.lstm.predict(data.timeSeries, data.horizon, data.sensorId);
          await this.deps.producer.send({
            topic: 'sentinel.ai.inference-results',
            messages: [{ key: data.requestId, value: JSON.stringify(prediction) }],
          });
        }
        break;
      case 'anomaly_detect':
        if (this.deps.isolationForest.isReady()) {
          const anomaly = await this.deps.isolationForest.detect(data.features, data.sensorId);
          await this.deps.producer.send({
            topic: 'sentinel.ai.inference-results',
            messages: [{ key: data.requestId, value: JSON.stringify(anomaly) }],
          });
        }
        break;
      default:
        logger.warn({ requestType: data.requestType }, 'Unknown inference request type');
    }
  }

  private extractTelemetryFeatures(data: any): number[] {
    return [
      data.temperature ?? 0,
      data.humidity ?? 0,
      data.pressure ?? 0,
      data.vibration ?? 0,
      data.voltage ?? 0,
      data.current ?? 0,
      data.signalStrength ?? 0,
      data.errorRate ?? 0,
      data.latency ?? 0,
      data.packetLoss ?? 0,
    ];
  }

  private extractRadarFeatures(data: any): number[] {
    return [
      data.rcs ?? 0,
      data.doppler ?? 0,
      data.azimuth ?? 0,
      data.elevation ?? 0,
      data.range ?? 0,
      data.snr ?? 0,
      data.pulseWidth ?? 0,
      data.sweepRate ?? 0,
    ];
  }

  private async publishError(topic: string, data: any, error: any): Promise<void> {
    try {
      await this.deps.producer.send({
        topic: 'sentinel.ai.errors',
        messages: [{
          key: data?.id || uuid(),
          value: JSON.stringify({
            sourceTopic: topic,
            sourceId: data?.id,
            error: error.message || String(error),
            timestamp: new Date().toISOString(),
          }),
        }],
      });
    } catch (e) {
      logger.error({ e }, 'Failed to publish error event');
    }
  }

  getStats(): { processing: number; totalProcessed: number; errorCount: number } {
    return {
      processing: this.processingCount,
      totalProcessed: this.totalProcessed,
      errorCount: this.errorCount,
    };
  }
}

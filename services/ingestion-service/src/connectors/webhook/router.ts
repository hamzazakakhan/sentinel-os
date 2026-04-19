import { Router, Request, Response, NextFunction } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { createLogger } from '../../utils/logger.js';
import { IngestionBuffer } from '../../processors/buffer.js';
import { v4 as uuid } from 'uuid';

const logger = createLogger('webhook-router');

interface WebhookConfig {
  hmacSecret: string;
}

export class WebhookRouter {
  private buffer: IngestionBuffer;
  private config: WebhookConfig;
  private deliveryCount = 0;
  private failureCount = 0;

  constructor(buffer: IngestionBuffer, config: WebhookConfig) {
    this.buffer = buffer;
    this.config = config;
  }

  getRouter(): Router {
    const router = Router();

    router.use(express.json({ limit: '50mb' }));
    router.use(this.validateHmac.bind(this));

    router.post('/sensor-data', this.handleSensorData.bind(this));
    router.post('/intel-feed', this.handleIntelFeed.bind(this));
    router.post('/threat-indicator', this.handleThreatIndicator.bind(this));
    router.post('/cyber-event', this.handleCyberEvent.bind(this));
    router.post('/generic', this.handleGeneric.bind(this));

    router.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ready', deliveries: this.deliveryCount, failures: this.failureCount });
    });

    return router;
  }

  private validateHmac(req: Request, res: Response, next: NextFunction): void {
    if (!this.config.hmacSecret) {
      return next();
    }

    const signature = req.headers['x-sentinel-signature'] as string;
    if (!signature) {
      this.failureCount++;
      logger.warn({ ip: req.ip }, 'Webhook missing HMAC signature');
      res.status(401).json({ error: 'Missing signature header' });
      return;
    }

    const [algorithm, hash] = signature.split('=');
    if (algorithm !== 'sha256' || !hash) {
      this.failureCount++;
      res.status(401).json({ error: 'Invalid signature format' });
      return;
    }

    const body = JSON.stringify(req.body);
    const expectedHash = createHmac('sha256', this.config.hmacSecret)
      .update(body)
      .digest('hex');

    const hashBuffer = Buffer.from(hash, 'hex');
    const expectedBuffer = Buffer.from(expectedHash, 'hex');

    if (hashBuffer.length !== expectedBuffer.length || !timingSafeEqual(hashBuffer, expectedBuffer)) {
      this.failureCount++;
      logger.warn({ ip: req.ip }, 'Webhook HMAC validation failed');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    next();
  }

  private async handleSensorData(req: Request, res: Response): Promise<void> {
    try {
      const { sensorId, sensorType, domain, data, location } = req.body;
      await this.buffer.add({
        topic: 'sentinel.ingestion.sensor-telemetry',
        key: sensorId,
        value: {
          id: uuid(),
          sensorId,
          sensorType,
          domain: domain || 'LAND',
          payload: data,
          location,
          source: 'webhook',
          sourceIp: req.ip,
          ingestedAt: new Date().toISOString(),
        },
      });
      this.deliveryCount++;
      res.status(202).json({ status: 'accepted', id: sensorId });
    } catch (error: any) {
      this.failureCount++;
      logger.error({ error }, 'Webhook sensor-data handling failed');
      res.status(500).json({ error: error.message });
    }
  }

  private async handleIntelFeed(req: Request, res: Response): Promise<void> {
    try {
      const { feedId, feedType, data, classification } = req.body;
      await this.buffer.add({
        topic: 'sentinel.ingestion.intel-feeds',
        key: feedId || uuid(),
        value: {
          id: uuid(),
          feedId,
          feedType,
          payload: data,
          classification: classification || 'UNCLASSIFIED',
          source: 'webhook',
          sourceIp: req.ip,
          ingestedAt: new Date().toISOString(),
        },
      });
      this.deliveryCount++;
      res.status(202).json({ status: 'accepted' });
    } catch (error: any) {
      this.failureCount++;
      res.status(500).json({ error: error.message });
    }
  }

  private async handleThreatIndicator(req: Request, res: Response): Promise<void> {
    try {
      const indicators = Array.isArray(req.body) ? req.body : [req.body];
      for (const indicator of indicators) {
        await this.buffer.add({
          topic: 'sentinel.cyber.threat-indicators',
          key: indicator.value || uuid(),
          value: {
            id: uuid(),
            ...indicator,
            source: 'webhook',
            sourceIp: req.ip,
            ingestedAt: new Date().toISOString(),
          },
        });
      }
      this.deliveryCount++;
      res.status(202).json({ status: 'accepted', count: indicators.length });
    } catch (error: any) {
      this.failureCount++;
      res.status(500).json({ error: error.message });
    }
  }

  private async handleCyberEvent(req: Request, res: Response): Promise<void> {
    try {
      await this.buffer.add({
        topic: 'sentinel.cyber.raw-events',
        key: req.body.sourceIp || uuid(),
        value: {
          id: uuid(),
          ...req.body,
          source: 'webhook',
          sourceIp: req.ip,
          ingestedAt: new Date().toISOString(),
        },
      });
      this.deliveryCount++;
      res.status(202).json({ status: 'accepted' });
    } catch (error: any) {
      this.failureCount++;
      res.status(500).json({ error: error.message });
    }
  }

  private async handleGeneric(req: Request, res: Response): Promise<void> {
    try {
      const topic = req.headers['x-sentinel-topic'] as string || 'sentinel.ingestion.generic';
      await this.buffer.add({
        topic,
        key: req.body.id || uuid(),
        value: {
          id: uuid(),
          payload: req.body,
          source: 'webhook',
          sourceIp: req.ip,
          ingestedAt: new Date().toISOString(),
        },
      });
      this.deliveryCount++;
      res.status(202).json({ status: 'accepted' });
    } catch (error: any) {
      this.failureCount++;
      res.status(500).json({ error: error.message });
    }
  }
}

import express from 'express';

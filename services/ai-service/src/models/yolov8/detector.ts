import { spawn, ChildProcess } from 'child_process';
import { createLogger } from '../../utils/logger.js';
import { v4 as uuid } from 'uuid';
import path from 'path';

const logger = createLogger('yolov8-detector');

export interface YoloConfig {
  modelPath: string;
  confidenceThreshold: number;
  iouThreshold: number;
  batchSize: number;
  gpuMemoryFraction: number;
}

export interface Detection {
  id: string;
  label: string;
  confidence: number;
  bbox: { x: number; y: number; width: number; height: number };
  trackId?: string;
  attributes: Record<string, any>;
}

export interface DetectionResult {
  detections: Detection[];
  inferenceTimeMs: number;
  modelVersion: string;
  frameId: string;
  timestamp: string;
}

export class YoloV8Detector {
  private config: YoloConfig;
  private pythonProcess: ChildProcess | null = null;
  private ready = false;
  private pendingRequests = new Map<string, { resolve: Function; reject: Function; timer: NodeJS.Timeout }>();
  private modelVersion = 'yolov8x-v1.0';

  constructor(config: YoloConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    const scriptPath = path.join(import.meta.dirname || __dirname, 'python', 'yolo_server.py');

    this.pythonProcess = spawn('python3', [
      scriptPath,
      '--model', this.config.modelPath,
      '--conf', String(this.config.confidenceThreshold),
      '--iou', String(this.config.iouThreshold),
      '--batch-size', String(this.config.batchSize),
      '--gpu-fraction', String(this.config.gpuMemoryFraction),
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    this.pythonProcess.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg.includes('ERROR')) {
        logger.error({ msg }, 'YOLOv8 Python process error');
      } else {
        logger.debug({ msg }, 'YOLOv8 Python stderr');
      }
    });

    let buffer = '';
    this.pythonProcess.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response = JSON.parse(line);
          if (response.type === 'ready') {
            this.ready = true;
            this.modelVersion = response.modelVersion || this.modelVersion;
            logger.info({ modelVersion: this.modelVersion }, 'YOLOv8 model loaded and ready');
          } else if (response.type === 'result') {
            const pending = this.pendingRequests.get(response.requestId);
            if (pending) {
              clearTimeout(pending.timer);
              this.pendingRequests.delete(response.requestId);
              pending.resolve(response.data);
            }
          } else if (response.type === 'error') {
            const pending = this.pendingRequests.get(response.requestId);
            if (pending) {
              clearTimeout(pending.timer);
              this.pendingRequests.delete(response.requestId);
              pending.reject(new Error(response.error));
            }
          }
        } catch (e) {
          logger.warn({ line }, 'Failed to parse YOLOv8 output line');
        }
      }
    });

    this.pythonProcess.on('exit', (code) => {
      this.ready = false;
      logger.error({ code }, 'YOLOv8 Python process exited');
      for (const [id, pending] of this.pendingRequests) {
        clearTimeout(pending.timer);
        pending.reject(new Error('YOLOv8 process terminated'));
        this.pendingRequests.delete(id);
      }
      setTimeout(() => this.initialize(), 5000);
    });

    await this.waitForReady(30000);
  }

  private waitForReady(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ready) return resolve();
      const interval = setInterval(() => {
        if (this.ready) { clearInterval(interval); resolve(); }
      }, 100);
      setTimeout(() => { clearInterval(interval); reject(new Error('YOLOv8 initialization timeout')); }, timeoutMs);
    });
  }

  async detect(imageBuffer: Buffer, metadata: Record<string, any> = {}): Promise<DetectionResult> {
    if (!this.ready || !this.pythonProcess) {
      throw new Error('YOLOv8 detector not ready');
    }

    const requestId = uuid();
    const frameId = uuid();
    const startTime = Date.now();

    const request = JSON.stringify({
      requestId,
      frameId,
      image: imageBuffer.toString('base64'),
      metadata,
    }) + '\n';

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('YOLOv8 inference timeout (30s)'));
      }, 30000);

      this.pendingRequests.set(requestId, {
        resolve: (data: any) => {
          const inferenceTimeMs = Date.now() - startTime;
          resolve({
            detections: data.detections.map((d: any) => ({
              id: uuid(),
              label: d.label,
              confidence: d.confidence,
              bbox: { x: d.x, y: d.y, width: d.width, height: d.height },
              trackId: d.trackId,
              attributes: d.attributes || {},
            })),
            inferenceTimeMs,
            modelVersion: this.modelVersion,
            frameId,
            timestamp: new Date().toISOString(),
          });
        },
        reject,
        timer,
      });

      this.pythonProcess!.stdin?.write(request);
    });
  }

  isReady(): boolean {
    return this.ready;
  }

  async shutdown(): Promise<void> {
    if (this.pythonProcess) {
      this.pythonProcess.kill('SIGTERM');
      this.pythonProcess = null;
      this.ready = false;
    }
  }
}

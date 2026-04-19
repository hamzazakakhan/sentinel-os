import { spawn, ChildProcess } from 'child_process';
import { createLogger } from '../../utils/logger.js';
import { IngestionBuffer } from '../../processors/buffer.js';
import { EdgeProcessor } from '../../edge/processor.js';
import { v4 as uuid } from 'uuid';

const logger = createLogger('rtsp-connector');

interface RtspConfig {
  frameRate: number;
}

interface StreamInfo {
  sensorId: string;
  uri: string;
  process: ChildProcess;
  metadata: Record<string, any>;
  framesProcessed: number;
  startedAt: Date;
  lastFrameAt: Date | null;
}

export class RtspConnector {
  private buffer: IngestionBuffer;
  private edgeProcessor: EdgeProcessor;
  private config: RtspConfig;
  private streams = new Map<string, StreamInfo>();

  constructor(buffer: IngestionBuffer, edgeProcessor: EdgeProcessor, config: RtspConfig) {
    this.buffer = buffer;
    this.edgeProcessor = edgeProcessor;
    this.config = config;
  }

  async addStream(sensorId: string, uri: string, metadata: Record<string, any> = {}): Promise<void> {
    if (this.streams.has(sensorId)) {
      this.removeStream(sensorId);
    }

    const ffmpegArgs = [
      '-rtsp_transport', 'tcp',
      '-i', uri,
      '-vf', `fps=${this.config.frameRate}`,
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      '-q:v', '5',
      '-an',
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-stimeout', '5000000',
      '-loglevel', 'warning',
      'pipe:1',
    ];

    const proc = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const streamInfo: StreamInfo = {
      sensorId,
      uri,
      process: proc,
      metadata,
      framesProcessed: 0,
      startedAt: new Date(),
      lastFrameAt: null,
    };

    this.streams.set(sensorId, streamInfo);

    let jpegBuffer = Buffer.alloc(0);
    const SOI = Buffer.from([0xFF, 0xD8]);
    const EOI = Buffer.from([0xFF, 0xD9]);

    proc.stdout?.on('data', (chunk: Buffer) => {
      jpegBuffer = Buffer.concat([jpegBuffer, chunk]);

      let soiIdx = jpegBuffer.indexOf(SOI);
      while (soiIdx !== -1) {
        const eoiIdx = jpegBuffer.indexOf(EOI, soiIdx + 2);
        if (eoiIdx === -1) break;

        const frame = jpegBuffer.subarray(soiIdx, eoiIdx + 2);
        jpegBuffer = jpegBuffer.subarray(eoiIdx + 2);

        this.processFrame(sensorId, frame, streamInfo);
        soiIdx = jpegBuffer.indexOf(SOI);
      }

      if (jpegBuffer.length > 10 * 1024 * 1024) {
        jpegBuffer = Buffer.alloc(0);
        logger.warn({ sensorId }, 'RTSP buffer overflow, cleared');
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg.includes('error') || msg.includes('Error')) {
        logger.error({ sensorId, msg }, 'FFmpeg error');
      }
    });

    proc.on('exit', (code, signal) => {
      logger.warn({ sensorId, code, signal }, 'RTSP stream process exited');
      this.streams.delete(sensorId);

      if (code !== 0 && !signal) {
        logger.info({ sensorId }, 'Attempting RTSP reconnection in 5s');
        setTimeout(() => this.addStream(sensorId, uri, metadata), 5000);
      }
    });

    logger.info({ sensorId, uri: uri.replace(/\/\/.*@/, '//***@'), fps: this.config.frameRate }, 'RTSP stream started');
  }

  private async processFrame(sensorId: string, frame: Buffer, info: StreamInfo): Promise<void> {
    info.framesProcessed++;
    info.lastFrameAt = new Date();

    const frameData = frame.toString('base64');
    const edgeResult = await this.edgeProcessor.processFrame(sensorId, frame);

    await this.buffer.add({
      topic: 'sentinel.ingestion.video-frames',
      key: sensorId,
      value: {
        id: uuid(),
        sensorId,
        domain: info.metadata.domain || 'LAND',
        frameNumber: info.framesProcessed,
        frameData,
        frameSize: frame.length,
        location: info.metadata.location,
        edgeDetections: edgeResult?.detections || [],
        edgeProcessed: !!edgeResult,
        rawDataRef: `rtsp://${sensorId}/frame-${info.framesProcessed}`,
        timestamp: new Date().toISOString(),
      },
    });
  }

  removeStream(sensorId: string): void {
    const stream = this.streams.get(sensorId);
    if (stream) {
      stream.process.kill('SIGTERM');
      this.streams.delete(sensorId);
      logger.info({ sensorId, framesProcessed: stream.framesProcessed }, 'RTSP stream removed');
    }
  }

  stopAll(): void {
    for (const [sensorId] of this.streams) {
      this.removeStream(sensorId);
    }
  }

  getActiveCount(): number {
    return this.streams.size;
  }
}

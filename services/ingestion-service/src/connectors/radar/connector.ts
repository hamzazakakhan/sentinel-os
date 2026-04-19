import { createSocket, Socket } from 'dgram';
import { createLogger } from '../../utils/logger.js';
import { IngestionBuffer } from '../../processors/buffer.js';
import { EdgeProcessor } from '../../edge/processor.js';
import { v4 as uuid } from 'uuid';

const logger = createLogger('radar-connector');

interface RadarConnection {
  sensorId: string;
  uri: string;
  socket: Socket;
  metadata: Record<string, any>;
  sweepsReceived: number;
  startedAt: Date;
}

export class RadarConnector {
  private buffer: IngestionBuffer;
  private edgeProcessor: EdgeProcessor;
  private radars = new Map<string, RadarConnection>();

  constructor(buffer: IngestionBuffer, edgeProcessor: EdgeProcessor) {
    this.buffer = buffer;
    this.edgeProcessor = edgeProcessor;
  }

  async addRadar(sensorId: string, uri: string, metadata: Record<string, any> = {}): Promise<void> {
    if (this.radars.has(sensorId)) {
      this.removeRadar(sensorId);
    }

    const [host, portStr] = uri.replace('udp://', '').split(':');
    const port = parseInt(portStr || '5000', 10);

    const socket = createSocket('udp4');

    socket.on('message', (msg: Buffer, rinfo) => {
      this.handleRadarData(sensorId, msg, rinfo);
    });

    socket.on('error', (error) => {
      logger.error({ sensorId, error: error.message }, 'Radar socket error');
    });

    socket.bind(port, () => {
      logger.info({ sensorId, port, host }, 'Radar connector listening');
    });

    this.radars.set(sensorId, {
      sensorId,
      uri,
      socket,
      metadata,
      sweepsReceived: 0,
      startedAt: new Date(),
    });
  }

  private async handleRadarData(sensorId: string, data: Buffer, rinfo: any): Promise<void> {
    const radar = this.radars.get(sensorId);
    if (!radar) return;
    radar.sweepsReceived++;

    const sweep = this.parseRadarSweep(data);

    await this.buffer.add({
      topic: 'sentinel.ingestion.radar-sweeps',
      key: sensorId,
      value: {
        id: uuid(),
        sensorId,
        sensorType: 'RADAR',
        domain: radar.metadata.domain || 'AIR',
        sweep,
        sourceAddress: rinfo.address,
        sourcePort: rinfo.port,
        location: radar.metadata.location,
        rawSize: data.length,
        sweepNumber: radar.sweepsReceived,
        timestamp: new Date().toISOString(),
      },
    });
  }

  private parseRadarSweep(data: Buffer): Record<string, any> {
    if (data.length < 16) {
      return { raw: data.toString('hex'), format: 'unknown' };
    }

    const header = data.readUInt32BE(0);
    const azimuth = data.readFloatBE(4);
    const elevation = data.readFloatBE(8);
    const rangeGates = data.readUInt16BE(12);
    const sweepMode = data.readUInt16BE(14);

    const returns: Array<{ range: number; amplitude: number; doppler: number }> = [];
    let offset = 16;
    while (offset + 12 <= data.length) {
      returns.push({
        range: data.readFloatBE(offset),
        amplitude: data.readFloatBE(offset + 4),
        doppler: data.readFloatBE(offset + 8),
      });
      offset += 12;
    }

    return {
      header,
      azimuth,
      elevation,
      rangeGates,
      sweepMode,
      returns,
      returnCount: returns.length,
    };
  }

  removeRadar(sensorId: string): void {
    const radar = this.radars.get(sensorId);
    if (radar) {
      radar.socket.close();
      this.radars.delete(sensorId);
      logger.info({ sensorId, sweeps: radar.sweepsReceived }, 'Radar connector removed');
    }
  }

  stopAll(): void {
    for (const [sensorId] of this.radars) {
      this.removeRadar(sensorId);
    }
  }

  getActiveCount(): number { return this.radars.size; }
}

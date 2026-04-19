import WebSocket from 'ws';
import { createLogger } from '../../utils/logger.js';
import { IngestionBuffer } from '../../processors/buffer.js';
import { EdgeProcessor } from '../../edge/processor.js';
import { v4 as uuid } from 'uuid';

const logger = createLogger('drone-connector');

interface DroneConnection {
  sensorId: string;
  uri: string;
  ws: WebSocket | null;
  metadata: Record<string, any>;
  messagesReceived: number;
  startedAt: Date;
  reconnectTimer: NodeJS.Timeout | null;
}

export class DroneConnector {
  private buffer: IngestionBuffer;
  private edgeProcessor: EdgeProcessor;
  private drones = new Map<string, DroneConnection>();

  constructor(buffer: IngestionBuffer, edgeProcessor: EdgeProcessor) {
    this.buffer = buffer;
    this.edgeProcessor = edgeProcessor;
  }

  async addDrone(sensorId: string, uri: string, metadata: Record<string, any> = {}): Promise<void> {
    if (this.drones.has(sensorId)) {
      this.removeDrone(sensorId);
    }

    const droneConn: DroneConnection = {
      sensorId,
      uri,
      ws: null,
      metadata,
      messagesReceived: 0,
      startedAt: new Date(),
      reconnectTimer: null,
    };

    this.drones.set(sensorId, droneConn);
    await this.connectDrone(droneConn);
  }

  private async connectDrone(drone: DroneConnection): Promise<void> {
    try {
      const ws = new WebSocket(drone.uri, {
        handshakeTimeout: 10000,
        maxPayload: 50 * 1024 * 1024,
      });

      ws.on('open', () => {
        logger.info({ sensorId: drone.sensorId, uri: drone.uri }, 'Drone WebSocket connected');
        drone.ws = ws;
      });

      ws.on('message', async (data: WebSocket.Data) => {
        drone.messagesReceived++;
        await this.handleDroneMessage(drone, data);
      });

      ws.on('close', (code, reason) => {
        logger.warn({ sensorId: drone.sensorId, code, reason: reason.toString() }, 'Drone WebSocket closed');
        drone.ws = null;
        if (this.drones.has(drone.sensorId)) {
          drone.reconnectTimer = setTimeout(() => this.connectDrone(drone), 5000);
        }
      });

      ws.on('error', (error) => {
        logger.error({ sensorId: drone.sensorId, error: error.message }, 'Drone WebSocket error');
      });
    } catch (error: any) {
      logger.error({ sensorId: drone.sensorId, error: error.message }, 'Drone connection failed');
      drone.reconnectTimer = setTimeout(() => this.connectDrone(drone), 5000);
    }
  }

  private async handleDroneMessage(drone: DroneConnection, data: WebSocket.Data): Promise<void> {
    try {
      let payload: any;
      if (typeof data === 'string') {
        payload = JSON.parse(data);
      } else if (Buffer.isBuffer(data)) {
        if (data[0] === 0x7B) {
          payload = JSON.parse(data.toString());
        } else {
          payload = { type: 'binary', data: data.toString('base64'), size: data.length };
        }
      } else {
        return;
      }

      const messageType = payload.type || 'telemetry';

      switch (messageType) {
        case 'telemetry':
          await this.buffer.add({
            topic: 'sentinel.ingestion.sensor-telemetry',
            key: drone.sensorId,
            value: {
              id: uuid(),
              sensorId: drone.sensorId,
              sensorType: 'DRONE',
              domain: drone.metadata.domain || 'AIR',
              payload: {
                latitude: payload.lat,
                longitude: payload.lon,
                altitude: payload.alt,
                heading: payload.heading,
                speed: payload.speed,
                battery: payload.battery,
                gpsFixType: payload.gpsFix,
                satellites: payload.sats,
                rollDeg: payload.roll,
                pitchDeg: payload.pitch,
                yawDeg: payload.yaw,
              },
              location: payload.lat && payload.lon ? {
                type: 'Point',
                coordinates: [payload.lon, payload.lat, payload.alt || 0],
              } : undefined,
              timestamp: payload.timestamp || new Date().toISOString(),
            },
          });
          break;

        case 'video_frame':
          await this.buffer.add({
            topic: 'sentinel.ingestion.video-frames',
            key: drone.sensorId,
            value: {
              id: uuid(),
              sensorId: drone.sensorId,
              domain: drone.metadata.domain || 'AIR',
              frameData: payload.data,
              frameNumber: payload.frameNumber,
              location: payload.location,
              rawDataRef: `drone://${drone.sensorId}/frame-${payload.frameNumber}`,
              timestamp: payload.timestamp || new Date().toISOString(),
            },
          });
          break;

        case 'detection':
          await this.buffer.add({
            topic: 'sentinel.detections.created',
            key: drone.sensorId,
            value: {
              id: uuid(),
              sensorId: drone.sensorId,
              domain: 'AIR',
              detectionType: payload.detectionType || 'drone_onboard',
              confidence: payload.confidence || 0.5,
              location: payload.location,
              attributes: payload.attributes || {},
              detectedAt: payload.timestamp || new Date().toISOString(),
            },
          });
          break;

        default:
          await this.buffer.add({
            topic: 'sentinel.ingestion.sensor-telemetry',
            key: drone.sensorId,
            value: {
              id: uuid(),
              sensorId: drone.sensorId,
              sensorType: 'DRONE',
              domain: drone.metadata.domain || 'AIR',
              payload,
              timestamp: new Date().toISOString(),
            },
          });
      }
    } catch (error: any) {
      logger.error({ sensorId: drone.sensorId, error: error.message }, 'Drone message handling failed');
    }
  }

  removeDrone(sensorId: string): void {
    const drone = this.drones.get(sensorId);
    if (drone) {
      if (drone.reconnectTimer) clearTimeout(drone.reconnectTimer);
      if (drone.ws) drone.ws.close(1000, 'Disconnecting');
      this.drones.delete(sensorId);
      logger.info({ sensorId, messages: drone.messagesReceived }, 'Drone connector removed');
    }
  }

  stopAll(): void {
    for (const [sensorId] of this.drones) {
      this.removeDrone(sensorId);
    }
  }

  getActiveCount(): number { return this.drones.size; }
}

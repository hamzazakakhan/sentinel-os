// ──────────────────────────────────────────────────────────────
// sentinel-os/services/sigint-service/src/index.ts
// SIGINT Service — SDR spectrum WebSocket, ADS-B, AIS, APRS
// Provides real-time RF intelligence to the Sentinel OS HUD
// ──────────────────────────────────────────────────────────────

import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { Kafka } from 'kafkajs';
import { createLogger } from './utils/logger.js';
import { SpectrumBroadcaster } from './sdr/spectrum.js';
import { AdsbTracker } from './connectors/adsb/opensky.js';
import { AisTracker } from './connectors/ais/marinetraffic.js';
import { AprsFeed } from './connectors/aprs/aprs-is.js';
import { SdrDeviceManager } from './sdr/device-manager.js';

const logger = createLogger('sigint-service');

const PORT = parseInt(process.env.PORT || '8080', 10);
const KAFKA_BROKER = process.env.KAFKA_BROKERS || 'localhost:9092';

const kafka = new Kafka({
  brokers: [KAFKA_BROKER],
  clientId: 'sigint-service',
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: 'sigint-service-group' });

// ── Express app ──────────────────────────────────────────────
const app = express();
app.use(express.json());

const server = http.createServer(app);

// ── WebSocket server for spectrum data ────────────────────────
const wss = new WebSocketServer({ server, path: '/sigint/spectrum' });

const spectrumBroadcaster = new SpectrumBroadcaster();
const adsbTracker = new AdsbTracker();
const aisTracker = new AisTracker();
const aprsFeed = new AprsFeed();
const sdrManager = new SdrDeviceManager();

wss.on('connection', (ws: WebSocket, req) => {
  const clientIp = req.socket.remoteAddress;
  logger.info({ clientIp }, 'Spectrum WebSocket client connected');

  const subId = spectrumBroadcaster.subscribe((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  });

  ws.on('close', () => {
    spectrumBroadcaster.unsubscribe(subId);
    logger.info({ clientIp }, 'Spectrum WebSocket client disconnected');
  });

  ws.on('error', (err) => {
    logger.error({ err: err.message, clientIp }, 'Spectrum WebSocket error');
    spectrumBroadcaster.unsubscribe(subId);
  });

  // Send initial status
  ws.send(JSON.stringify({
    type: 'status',
    sdrDevices: sdrManager.getDevices(),
    frequency: spectrumBroadcaster.getFrequency(),
    sampleRate: spectrumBroadcaster.getSampleRate(),
  }));
});

// ── ADS-B WebSocket ──────────────────────────────────────────
const wssAdsb = new WebSocketServer({ server, path: '/sigint/adsb' });

wssAdsb.on('connection', (ws: WebSocket) => {
  const subId = adsbTracker.subscribe((tracks) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'adsb-tracks', tracks }));
    }
  });

  ws.on('close', () => adsbTracker.unsubscribe(subId));
  ws.on('error', () => adsbTracker.unsubscribe(subId));
});

// ── AIS WebSocket ────────────────────────────────────────────
const wssAis = new WebSocketServer({ server, path: '/sigint/ais' });

wssAis.on('connection', (ws: WebSocket) => {
  const subId = aisTracker.subscribe((vessels) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ais-vessels', vessels }));
    }
  });

  ws.on('close', () => aisTracker.unsubscribe(subId));
  ws.on('error', () => aisTracker.unsubscribe(subId));
});

// ── REST endpoints ───────────────────────────────────────────
app.get('/healthz', (_req, res) => {
  res.json({
    status: 'ok',
    sdrDevices: sdrManager.getDevices().length,
    adsbTracks: adsbTracker.getTrackCount(),
    aisVessels: aisTracker.getVesselCount(),
    spectrumClients: spectrumBroadcaster.getClientCount(),
  });
});

app.get('/health/live', (_req, res) => res.json({ alive: true }));
app.get('/health/ready', (_req, res) => {
  const ready = spectrumBroadcaster.isReady();
  res.status(ready ? 200 : 503).json({ ready });
});
app.get('/health/startup', (_req, res) => res.json({ started: true }));

app.get('/api/v1/sdr/devices', (_req, res) => {
  res.json({ devices: sdrManager.getDevices() });
});

app.post('/api/v1/sdr/tune', (req, res) => {
  const { frequency, sampleRate, gain } = req.body;
  try {
    spectrumBroadcaster.tune({ frequency, sampleRate, gain });
    res.json({ tuned: true, frequency, sampleRate });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/v1/adsb/tracks', (_req, res) => {
  res.json({ tracks: adsbTracker.getTracks() });
});

app.get('/api/v1/ais/vessels', (_req, res) => {
  res.json({ vessels: aisTracker.getVessels() });
});

app.get('/api/v1/aprs/positions', (_req, res) => {
  res.json({ positions: aprsFeed.getRecentPositions() });
});

app.get('/api/v1/spectrum/config', (_req, res) => {
  res.json({
    frequency: spectrumBroadcaster.getFrequency(),
    sampleRate: spectrumBroadcaster.getSampleRate(),
    gain: spectrumBroadcaster.getGain(),
    fftSize: spectrumBroadcaster.getFftSize(),
  });
});

// ── Kafka producer for SIGINT events ────────────────────────
async function publishSigintEvent(event: Record<string, any>) {
  try {
    await producer.send({
      topic: 'sentinel.sigint.events',
      messages: [{
        key: event.id || event.type,
        value: JSON.stringify({
          ...event,
          timestamp: new Date().toISOString(),
          source: 'sigint-service',
        }),
      }],
    });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to publish SIGINT event to Kafka');
  }
}

// ── Initialize ────────────────────────────────────────────────
async function start() {
  await producer.connect();
  logger.info('Kafka producer connected');

  // Start SDR device detection
  await sdrManager.initialize();
  const devices = sdrManager.getDevices();
  logger.info({ deviceCount: devices.length }, 'SDR devices detected');

  // Start spectrum broadcaster (reads from RTL-SDR or simulates)
  if (devices.length > 0) {
    await spectrumBroadcaster.startHardware(devices[0]);
    logger.info({ device: devices[0].name }, 'Spectrum broadcaster started from hardware');
  } else {
    spectrumBroadcaster.startSimulated();
    logger.warn('No SDR devices found — spectrum broadcaster in simulated mode');
  }

  // Start ADS-B tracker (OpenSky Network)
  await adsbTracker.start();
  adsbTracker.onTrackUpdate((tracks) => {
    publishSigintEvent({ type: 'adsb-update', trackCount: tracks.length, tracks: tracks.slice(0, 10) });
  });

  // Start AIS tracker
  await aisTracker.start();
  aisTracker.onVesselUpdate((vessels) => {
    publishSigintEvent({ type: 'ais-update', vesselCount: vessels.length, vessels: vessels.slice(0, 10) });
  });

  // Start APRS feed
  await aprsFeed.start();
  aprsFeed.onPosition((pos) => {
    publishSigintEvent({ type: 'aprs-position', ...pos });
  });

  // Subscribe to Kafka commands
  await consumer.connect();
  await consumer.subscribe({ topic: 'sentinel.sigint.commands', fromBeginning: false });
  await consumer.run({
    eachMessage: async ({ message }) => {
      const cmd = JSON.parse(message.value?.toString() || '{}');
      logger.info({ cmd: cmd.action }, 'SIGINT command received');
      if (cmd.action === 'tune') {
        spectrumBroadcaster.tune(cmd.params);
      } else if (cmd.action === 'scan-start') {
        spectrumBroadcaster.startScan(cmd.params);
      } else if (cmd.action === 'scan-stop') {
        spectrumBroadcaster.stopScan();
      }
    },
  });

  server.listen(PORT, '0.0.0.0', () => {
    logger.info(`SIGINT Service ready at http://0.0.0.0:${PORT}`);
    logger.info(`Spectrum WebSocket: ws://0.0.0.0:${PORT}/sigint/spectrum`);
    logger.info(`ADS-B WebSocket: ws://0.0.0.0:${PORT}/sigint/adsb`);
    logger.info(`AIS WebSocket: ws://0.0.0.0:${PORT}/sigint/ais`);
  });
}

start().catch((err) => {
  logger.error({ err: err.message }, 'SIGINT service failed to start');
  process.exit(1);
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down');
  spectrumBroadcaster.stop();
  adsbTracker.stop();
  aisTracker.stop();
  aprsFeed.stop();
  await producer.disconnect();
  await consumer.disconnect();
  server.close();
  process.exit(0);
});

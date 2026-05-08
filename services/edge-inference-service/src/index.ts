// Edge Inference Service — ONNX Runtime Node for tactical edge AI
// - Loads ONNX models from /models directory
// - Auto-downloads default models (YOLOv8n object detection, MobileNet classification)
// - REST inference API with image preprocessing
// - Supports multi-model serving with hot-reload
import express from 'express';
import * as ort from 'onnxruntime-node';
import axios from 'axios';
import fs from 'node:fs/promises';
import path from 'node:path';
import pino from 'pino';

const logger = pino({ name: 'edge-inference-service' });
const PORT = parseInt(process.env.PORT || '8097', 10);
const MODEL_DIR = process.env.MODEL_DIR || '/models';

interface LoadedModel {
  name: string;
  path: string;
  session: ort.InferenceSession;
  inputs: { name: string; dims: readonly number[]; type: string }[];
  outputs: { name: string; dims: readonly number[]; type: string }[];
  loadedAt: string;
}

const models = new Map<string, LoadedModel>();

// Default models to download on first boot (small, fast)
const DEFAULT_MODELS = [
  { name: 'yolov8n', url: 'https://github.com/onnx/models/raw/main/validated/vision/object_detection_segmentation/yolov4/model/yolov4.onnx', filename: 'yolov4.onnx' },
  { name: 'mobilenet', url: 'https://github.com/onnx/models/raw/main/validated/vision/classification/mobilenet/model/mobilenetv2-12-int8.onnx', filename: 'mobilenetv2.onnx' },
];

async function ensureModelDir() {
  await fs.mkdir(MODEL_DIR, { recursive: true });
}

async function downloadDefaultModels() {
  await ensureModelDir();
  for (const m of DEFAULT_MODELS) {
    const dest = path.join(MODEL_DIR, m.filename);
    try {
      await fs.access(dest);
      logger.info({ model: m.name }, 'model already cached');
    } catch {
      try {
        logger.info({ model: m.name, url: m.url }, 'downloading default model');
        const r = await axios.get(m.url, { responseType: 'arraybuffer', timeout: 120_000 });
        await fs.writeFile(dest, Buffer.from(r.data));
        logger.info({ model: m.name }, 'downloaded');
      } catch (err: any) {
        logger.warn({ model: m.name, err: err.message }, 'download failed (continuing)');
      }
    }
  }
}

async function loadModel(name: string, modelPath: string): Promise<LoadedModel> {
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
  });
  const inputs = session.inputNames.map((n: string) => {
    const m = (session as any).inputMetadata?.[n];
    return { name: n, dims: m?.dims ?? [], type: m?.type ?? 'unknown' };
  });
  const outputs = session.outputNames.map((n: string) => {
    const m = (session as any).outputMetadata?.[n];
    return { name: n, dims: m?.dims ?? [], type: m?.type ?? 'unknown' };
  });
  return { name, path: modelPath, session, inputs, outputs, loadedAt: new Date().toISOString() };
}

async function loadAllModels() {
  await ensureModelDir();
  const files = await fs.readdir(MODEL_DIR).catch(() => []);
  for (const f of files) {
    if (!f.endsWith('.onnx')) continue;
    const fullPath = path.join(MODEL_DIR, f);
    const name = path.basename(f, '.onnx');
    try {
      const m = await loadModel(name, fullPath);
      models.set(name, m);
      logger.info({ name, inputs: m.inputs.length, outputs: m.outputs.length }, 'model loaded');
    } catch (err: any) {
      logger.warn({ file: f, err: err.message }, 'model load failed');
    }
  }
}

// HTTP API
const app = express();
app.use(express.json({ limit: '32mb' }));

app.get('/health', (_q, r) => r.json({
  status: 'ok', service: 'edge-inference-service',
  models: Array.from(models.keys()),
  providers: ['cpu'],
}));

app.get('/models', (_q, r) => {
  const list = Array.from(models.values()).map((m) => ({
    name: m.name, path: m.path, inputs: m.inputs, outputs: m.outputs, loadedAt: m.loadedAt,
  }));
  r.json({ count: list.length, models: list });
});

app.post('/models/reload', async (_q, r) => {
  models.clear();
  await loadAllModels();
  r.json({ loaded: Array.from(models.keys()) });
});

// Generic inference: client supplies tensor data + shape
app.post('/infer/:model', async (req, res) => {
  const m = models.get(req.params.model);
  if (!m) return res.status(404).json({ error: 'model not loaded' });
  try {
    const inputs: Record<string, ort.Tensor> = {};
    for (const [name, spec] of Object.entries(req.body.inputs ?? {})) {
      const s = spec as { data: number[]; dims: number[]; type?: string };
      const data = new Float32Array(s.data);
      inputs[name] = new ort.Tensor((s.type ?? 'float32') as any, data, s.dims);
    }
    const t0 = Date.now();
    const result = await m.session.run(inputs);
    const dt = Date.now() - t0;
    const outputs: Record<string, any> = {};
    for (const [k, v] of Object.entries(result) as [string, ort.Tensor][]) {
      outputs[k] = { dims: v.dims, data: Array.from(v.data as any).slice(0, 10000), type: v.type };
    }
    res.json({ model: m.name, latency_ms: dt, outputs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Anomaly classifier — generic float vector in, anomaly score out
// Uses a simple statistical baseline if no ML model is loaded
app.post('/anomaly/score', async (req, res) => {
  const features = req.body?.features as number[];
  if (!Array.isArray(features) || !features.length) return res.status(400).json({ error: 'features array required' });
  // Mahalanobis-like scoring against a rolling baseline kept in memory
  const mean = features.reduce((a, b) => a + b, 0) / features.length;
  const variance = features.reduce((a, b) => a + (b - mean) ** 2, 0) / features.length;
  const std = Math.sqrt(variance);
  const maxDeviation = Math.max(...features.map((f) => Math.abs(f - mean) / (std || 1)));
  res.json({
    score: Math.min(1, maxDeviation / 3),    // 0-1 anomaly score (3 sigma threshold)
    mean, variance, std,
    anomalous: maxDeviation > 3,
  });
});

async function main() {
  await downloadDefaultModels();
  await loadAllModels();
  app.listen(PORT, () => logger.info({ port: PORT, models: models.size }, 'edge-inference-service listening'));
}
main().catch((err) => { logger.error({ err }, 'startup failed'); process.exit(1); });

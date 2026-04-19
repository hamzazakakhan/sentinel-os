import { spawn, ChildProcess } from 'child_process';
import { createLogger } from '../../utils/logger.js';
import { v4 as uuid } from 'uuid';

const logger = createLogger('isolation-forest');

export interface IsolationForestConfig {
  contamination: number;
  nEstimators: number;
  maxSamples: string | number;
  maxFeatures: number;
  bootstrap: boolean;
}

export interface AnomalyResult {
  id: string;
  isAnomaly: boolean;
  anomalyScore: number;
  featureContributions: Record<string, number>;
  threshold: number;
  sensorId: string;
  timestamp: string;
  inferenceTimeMs: number;
}

export class IsolationForestDetector {
  private config: IsolationForestConfig;
  private pythonProcess: ChildProcess | null = null;
  private ready = false;
  private pendingRequests = new Map<string, { resolve: Function; reject: Function; timer: NodeJS.Timeout }>();
  private trainedFeatures: string[] = [];

  constructor(config: IsolationForestConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    this.pythonProcess = spawn('python3', ['-c', `
import sys, json, numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

model = IsolationForest(
    contamination=${this.config.contamination},
    n_estimators=${this.config.nEstimators},
    max_samples='${this.config.maxSamples}',
    max_features=${this.config.maxFeatures},
    bootstrap=${this.config.bootstrap ? 'True' : 'False'},
    random_state=42,
    n_jobs=-1,
    warm_start=True
)
scaler = StandardScaler()
is_fitted = False

print(json.dumps({"type": "ready"}), flush=True)

for line in sys.stdin:
    try:
        req = json.loads(line.strip())
        if req.get("action") == "train":
            X = np.array(req["features"])
            X_scaled = scaler.fit_transform(X)
            model.fit(X_scaled)
            is_fitted = True
            print(json.dumps({"type": "result", "requestId": req["requestId"], "data": {"trained": True, "samples": len(X)}}), flush=True)
        elif req.get("action") == "detect":
            if not is_fitted:
                print(json.dumps({"type": "error", "requestId": req["requestId"], "error": "Model not trained"}), flush=True)
                continue
            X = np.array([req["features"]])
            X_scaled = scaler.transform(X)
            score = model.decision_function(X_scaled)[0]
            prediction = model.predict(X_scaled)[0]
            is_anomaly = prediction == -1
            threshold = model.offset_
            feature_names = req.get("featureNames", [f"f{i}" for i in range(X.shape[1])])
            contributions = {}
            for i, name in enumerate(feature_names):
                perturbed = X_scaled.copy()
                perturbed[0, i] = 0
                perturbed_score = model.decision_function(perturbed)[0]
                contributions[name] = float(abs(score - perturbed_score))
            print(json.dumps({
                "type": "result",
                "requestId": req["requestId"],
                "data": {
                    "isAnomaly": bool(is_anomaly),
                    "anomalyScore": float(-score),
                    "threshold": float(-threshold),
                    "featureContributions": contributions
                }
            }), flush=True)
        elif req.get("action") == "batch_detect":
            if not is_fitted:
                print(json.dumps({"type": "error", "requestId": req["requestId"], "error": "Model not trained"}), flush=True)
                continue
            X = np.array(req["features"])
            X_scaled = scaler.transform(X)
            scores = model.decision_function(X_scaled)
            predictions = model.predict(X_scaled)
            results = []
            for i in range(len(X)):
                results.append({
                    "isAnomaly": bool(predictions[i] == -1),
                    "anomalyScore": float(-scores[i]),
                    "threshold": float(-model.offset_)
                })
            print(json.dumps({"type": "result", "requestId": req["requestId"], "data": {"results": results}}), flush=True)
    except Exception as e:
        print(json.dumps({"type": "error", "requestId": req.get("requestId", "unknown"), "error": str(e)}), flush=True)
`], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
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
            logger.info('Isolation Forest detector ready');
          } else if (response.type === 'result' || response.type === 'error') {
            const pending = this.pendingRequests.get(response.requestId);
            if (pending) {
              clearTimeout(pending.timer);
              this.pendingRequests.delete(response.requestId);
              if (response.type === 'error') pending.reject(new Error(response.error));
              else pending.resolve(response.data);
            }
          }
        } catch (e) { /* skip non-JSON lines */ }
      }
    });

    this.pythonProcess.stderr?.on('data', (data: Buffer) => {
      logger.debug({ msg: data.toString().trim() }, 'IsolationForest stderr');
    });

    this.pythonProcess.on('exit', (code) => {
      this.ready = false;
      logger.error({ code }, 'Isolation Forest process exited');
      setTimeout(() => this.initialize(), 5000);
    });

    await new Promise<void>((resolve, reject) => {
      const check = setInterval(() => { if (this.ready) { clearInterval(check); resolve(); } }, 100);
      setTimeout(() => { clearInterval(check); reject(new Error('IsolationForest init timeout')); }, 15000);
    });
  }

  private sendRequest(action: string, payload: Record<string, any>): Promise<any> {
    const requestId = uuid();
    const startTime = Date.now();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Isolation Forest inference timeout'));
      }, 30000);
      this.pendingRequests.set(requestId, { resolve, reject, timer });
      this.pythonProcess!.stdin?.write(JSON.stringify({ requestId, action, ...payload }) + '\n');
    });
  }

  async train(features: number[][], featureNames?: string[]): Promise<{ trained: boolean; samples: number }> {
    this.trainedFeatures = featureNames || [];
    return this.sendRequest('train', { features, featureNames });
  }

  async detect(features: number[], sensorId: string, featureNames?: string[]): Promise<AnomalyResult> {
    const startTime = Date.now();
    const result = await this.sendRequest('detect', { features, featureNames: featureNames || this.trainedFeatures });
    return {
      id: uuid(),
      isAnomaly: result.isAnomaly,
      anomalyScore: result.anomalyScore,
      featureContributions: result.featureContributions,
      threshold: result.threshold,
      sensorId,
      timestamp: new Date().toISOString(),
      inferenceTimeMs: Date.now() - startTime,
    };
  }

  async batchDetect(features: number[][]): Promise<any[]> {
    const result = await this.sendRequest('batch_detect', { features });
    return result.results;
  }

  isReady(): boolean { return this.ready; }

  async shutdown(): Promise<void> {
    this.pythonProcess?.kill('SIGTERM');
    this.pythonProcess = null;
    this.ready = false;
  }
}

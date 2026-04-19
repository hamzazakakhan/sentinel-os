import { spawn, ChildProcess } from 'child_process';
import { createLogger } from '../../utils/logger.js';
import { v4 as uuid } from 'uuid';

const logger = createLogger('lstm-predictor');

export interface LSTMConfig {
  sequenceLength: number;
  predictionHorizon: number;
  hiddenSize: number;
  numLayers: number;
  dropout: number;
  bidirectional: boolean;
}

export interface PredictionResult {
  id: string;
  predictions: { timestamp: string; value: number; lower: number; upper: number }[];
  confidenceInterval: number;
  modelVersion: string;
  sensorId: string;
  inferenceTimeMs: number;
  timestamp: string;
}

export class LSTMPredictor {
  private config: LSTMConfig;
  private pythonProcess: ChildProcess | null = null;
  private ready = false;
  private pendingRequests = new Map<string, { resolve: Function; reject: Function; timer: NodeJS.Timeout }>();

  constructor(config: LSTMConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    this.pythonProcess = spawn('python3', ['-c', `
import sys, json, numpy as np, warnings
warnings.filterwarnings('ignore')

try:
    import torch
    import torch.nn as nn
    HAS_TORCH = True
except ImportError:
    HAS_TORCH = False

class LSTMModel(nn.Module if HAS_TORCH else object):
    def __init__(self, input_size, hidden_size, num_layers, output_size, dropout, bidirectional):
        if not HAS_TORCH:
            return
        super().__init__()
        self.hidden_size = hidden_size
        self.num_layers = num_layers
        self.bidirectional = bidirectional
        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0,
            bidirectional=bidirectional
        )
        fc_input = hidden_size * 2 if bidirectional else hidden_size
        self.attention = nn.Sequential(
            nn.Linear(fc_input, fc_input),
            nn.Tanh(),
            nn.Linear(fc_input, 1)
        )
        self.fc = nn.Sequential(
            nn.Linear(fc_input, hidden_size),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_size, hidden_size // 2),
            nn.ReLU(),
            nn.Linear(hidden_size // 2, output_size)
        )
        self.confidence_fc = nn.Sequential(
            nn.Linear(fc_input, hidden_size // 2),
            nn.ReLU(),
            nn.Linear(hidden_size // 2, output_size),
            nn.Softplus()
        )

    def forward(self, x):
        lstm_out, _ = self.lstm(x)
        attn_weights = torch.softmax(self.attention(lstm_out), dim=1)
        context = torch.sum(attn_weights * lstm_out, dim=1)
        predictions = self.fc(context)
        uncertainty = self.confidence_fc(context)
        return predictions, uncertainty

model = None
scaler_params = None
sequence_length = ${this.config.sequenceLength}
prediction_horizon = ${this.config.predictionHorizon}

print(json.dumps({"type": "ready", "hasTorch": HAS_TORCH}), flush=True)

for line in sys.stdin:
    try:
        req = json.loads(line.strip())
        request_id = req.get("requestId", "unknown")

        if req.get("action") == "train":
            if not HAS_TORCH:
                print(json.dumps({"type": "error", "requestId": request_id, "error": "PyTorch not available"}), flush=True)
                continue
            data = np.array(req["data"], dtype=np.float32)
            mean, std = data.mean(axis=0), data.std(axis=0) + 1e-8
            scaler_params = {"mean": mean.tolist(), "std": std.tolist()}
            data_scaled = (data - mean) / std

            X, y = [], []
            for i in range(len(data_scaled) - sequence_length - prediction_horizon + 1):
                X.append(data_scaled[i:i+sequence_length])
                y.append(data_scaled[i+sequence_length:i+sequence_length+prediction_horizon, 0])

            X = torch.FloatTensor(np.array(X))
            y = torch.FloatTensor(np.array(y))

            input_size = X.shape[2]
            model = LSTMModel(input_size, ${this.config.hiddenSize}, ${this.config.numLayers},
                            prediction_horizon, ${this.config.dropout}, ${this.config.bidirectional ? 'True' : 'False'})

            optimizer = torch.optim.AdamW(model.parameters(), lr=0.001, weight_decay=1e-5)
            scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=100)
            criterion = nn.MSELoss()

            model.train()
            best_loss = float('inf')
            patience_counter = 0
            for epoch in range(200):
                optimizer.zero_grad()
                pred, _ = model(X)
                loss = criterion(pred, y)
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                optimizer.step()
                scheduler.step()
                if loss.item() < best_loss:
                    best_loss = loss.item()
                    patience_counter = 0
                else:
                    patience_counter += 1
                    if patience_counter > 20:
                        break

            print(json.dumps({"type": "result", "requestId": request_id,
                            "data": {"trained": True, "epochs": epoch+1, "finalLoss": best_loss}}), flush=True)

        elif req.get("action") == "predict":
            if model is None or scaler_params is None:
                print(json.dumps({"type": "error", "requestId": request_id, "error": "Model not trained"}), flush=True)
                continue
            data = np.array(req["timeSeries"], dtype=np.float32)
            mean = np.array(scaler_params["mean"])
            std = np.array(scaler_params["std"])
            data_scaled = (data - mean) / std
            seq = data_scaled[-sequence_length:]
            X = torch.FloatTensor(seq).unsqueeze(0)

            model.eval()
            with torch.no_grad():
                pred, uncertainty = model(X)
                pred_np = pred.numpy()[0] * std[0] + mean[0]
                unc_np = uncertainty.numpy()[0] * std[0]

            horizon = req.get("horizon", prediction_horizon)
            predictions = []
            for i in range(min(horizon, len(pred_np))):
                predictions.append({
                    "step": i + 1,
                    "value": float(pred_np[i]),
                    "lower": float(pred_np[i] - 1.96 * unc_np[i]),
                    "upper": float(pred_np[i] + 1.96 * unc_np[i]),
                    "uncertainty": float(unc_np[i])
                })
            print(json.dumps({"type": "result", "requestId": request_id,
                            "data": {"predictions": predictions, "confidenceInterval": 0.95}}), flush=True)

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
            logger.info({ hasTorch: response.hasTorch }, 'LSTM predictor ready');
          } else {
            const pending = this.pendingRequests.get(response.requestId);
            if (pending) {
              clearTimeout(pending.timer);
              this.pendingRequests.delete(response.requestId);
              if (response.type === 'error') pending.reject(new Error(response.error));
              else pending.resolve(response.data);
            }
          }
        } catch (e) { /* skip */ }
      }
    });

    this.pythonProcess.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg && !msg.includes('UserWarning')) {
        logger.debug({ msg }, 'LSTM stderr');
      }
    });

    this.pythonProcess.on('exit', (code: number) => {
      this.ready = false;
      logger.error({ code }, 'LSTM process exited');
      setTimeout(() => this.initialize(), 5000);
    });

    await new Promise<void>((resolve, reject) => {
      const check = setInterval(() => { if (this.ready) { clearInterval(check); resolve(); } }, 100);
      setTimeout(() => { clearInterval(check); reject(new Error('LSTM init timeout')); }, 30000);
    });
  }

  private sendRequest(action: string, payload: Record<string, any>): Promise<any> {
    const requestId = uuid();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('LSTM inference timeout'));
      }, 60000);
      this.pendingRequests.set(requestId, { resolve, reject, timer });
      this.pythonProcess!.stdin?.write(JSON.stringify({ requestId, action, ...payload }) + '\n');
    });
  }

  async train(data: number[][]): Promise<{ trained: boolean; epochs: number; finalLoss: number }> {
    return this.sendRequest('train', { data });
  }

  async predict(timeSeries: number[][], horizon?: number, sensorId?: string): Promise<PredictionResult> {
    const startTime = Date.now();
    const result = await this.sendRequest('predict', { timeSeries, horizon: horizon || this.config.predictionHorizon });

    const now = new Date();
    return {
      id: uuid(),
      predictions: result.predictions.map((p: any) => ({
        timestamp: new Date(now.getTime() + p.step * 3600000).toISOString(),
        value: p.value,
        lower: p.lower,
        upper: p.upper,
      })),
      confidenceInterval: result.confidenceInterval,
      modelVersion: 'lstm-attention-v1.0',
      sensorId: sensorId || 'unknown',
      inferenceTimeMs: Date.now() - startTime,
      timestamp: now.toISOString(),
    };
  }

  isReady(): boolean { return this.ready; }

  async shutdown(): Promise<void> {
    this.pythonProcess?.kill('SIGTERM');
    this.pythonProcess = null;
    this.ready = false;
  }
}

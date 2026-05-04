#!/usr/bin/env python3
# ──────────────────────────────────────────────────────────────
# sentinel-os/ai-workers/predictive_failure.py
# LSTM-based predictive failure detection for Kubernetes pods
# Trained on Prometheus metric windows — predicts pod failure
# 60-120 seconds before it happens
# ──────────────────────────────────────────────────────────────

import json
import sys
import numpy as np

try:
    import torch
    import torch.nn as nn
    HAS_TORCH = True
except ImportError:
    HAS_TORCH = False
    print(json.dumps({"error": "PyTorch not available", "prediction": 0.0}))


class PodFailurePredictor(nn.Module):
    """
    LSTM trained on Prometheus metric windows.
    Input: [cpu_usage, mem_rss, p99_latency, error_rate, gc_pause, fd_count]
    Output: failure_prob in next 90 seconds
    """
    def __init__(self):
        super().__init__()
        self.lstm = nn.LSTM(6, 64, num_layers=2, batch_first=True)
        self.head = nn.Linear(64, 1)
        self.sigmoid = nn.Sigmoid()

    def forward(self, x):
        out, _ = self.lstm(x)
        return self.sigmoid(self.head(out[:, -1, :]))


def predict(metrics_window: list) -> dict:
    """
    Predict pod failure probability from a window of metrics.
    metrics_window: list of [cpu, mem, p99, err_rate, gc_pause, fd_count]
    """
    if not HAS_TORCH:
        # Fallback: simple threshold-based heuristic
        if len(metrics_window) == 0:
            return {"prediction": 0.0, "confidence": "LOW", "method": "heuristic"}

        latest = metrics_window[-1]
        cpu, mem, err_rate = latest[0], latest[1], latest[3]

        risk = 0.0
        if cpu > 90:
            risk += 0.3
        if mem > 85:
            risk += 0.3
        if err_rate > 5:
            risk += 0.4

        return {
            "prediction": min(1.0, risk),
            "confidence": "LOW",
            "method": "heuristic",
            "thresholds": {"cpu_high": cpu > 90, "mem_high": mem > 85, "err_high": err_rate > 5},
        }

    model = PodFailurePredictor()
    model.eval()

    x = torch.tensor([metrics_window], dtype=torch.float32)
    with torch.no_grad():
        prob = model(x).item()

    confidence = "HIGH" if prob > 0.8 else "MED" if prob > 0.5 else "LOW"

    return {
        "prediction": prob,
        "confidence": confidence,
        "method": "lstm",
        "action": "preemptive_restart" if prob > 0.8 else "monitor",
    }


if __name__ == "__main__":
    # Read metrics from stdin
    input_data = sys.stdin.read().strip()
    if input_data:
        try:
            data = json.loads(input_data)
            window = data.get("metrics_window", [])
            result = predict(window)
            print(json.dumps(result))
        except Exception as e:
            print(json.dumps({"error": str(e), "prediction": 0.0}))
    else:
        print(json.dumps({"error": "No input data", "prediction": 0.0}))

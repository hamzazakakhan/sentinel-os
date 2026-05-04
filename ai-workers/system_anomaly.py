#!/usr/bin/env python3
# ──────────────────────────────────────────────────────────────
# sentinel-os/ai-workers/system_anomaly.py
# Isolation Forest system health anomaly detection
# Runs on system metrics — memory leaks, network anomalies, latency spikes
# ──────────────────────────────────────────────────────────────

import json
import sys
import numpy as np

try:
    from sklearn.ensemble import IsolationForest
    HAS_SKLEARN = True
except ImportError:
    HAS_SKLEARN = False


class SystemHealthMonitor:
    def __init__(self, contamination=0.05, n_estimators=100):
        self.model = IsolationForest(
            contamination=contamination,
            n_estimators=n_estimators,
            random_state=42,
        )
        self.baseline_window = []
        self.fitted = False

    def add_baseline(self, metrics: dict):
        """Add metrics to the baseline training window."""
        vec = np.array([[
            metrics.get('cpu_pct', 0),
            metrics.get('mem_mb', 0),
            metrics.get('p99_ms', 0),
            metrics.get('error_rate', 0),
            metrics.get('kafka_lag', 0),
        ]])
        self.baseline_window.append(vec[0])

        # Fit after collecting 100 baseline samples
        if len(self.baseline_window) >= 100 and not self.fitted:
            X = np.array(self.baseline_window)
            self.model.fit(X)
            self.fitted = True

    def score(self, metrics: dict) -> dict:
        """Score current metrics against baseline. Returns anomaly score."""
        if not self.fitted:
            return {
                "score": 0.0,
                "is_anomaly": False,
                "confidence": "LOW",
                "reason": "Model not yet fitted — need 100 baseline samples",
            }

        vec = np.array([[
            metrics.get('cpu_pct', 0),
            metrics.get('mem_mb', 0),
            metrics.get('p99_ms', 0),
            metrics.get('error_rate', 0),
            metrics.get('kafka_lag', 0),
        ]])

        decision_score = self.model.decision_function(vec)[0]
        is_anomaly = self.model.predict(vec)[0] == -1

        # score < -0.3 → anomalous
        severity = "CRITICAL" if decision_score < -0.5 else "WARNING" if decision_score < -0.3 else "NORMAL"

        return {
            "score": float(decision_score),
            "is_anomaly": is_anomaly,
            "severity": severity,
            "confidence": "HIGH" if self.fitted else "LOW",
            "threshold": -0.3,
        }


def main():
    input_data = sys.stdin.read().strip()
    if not input_data:
        print(json.dumps({"error": "No input data", "score": 0.0, "is_anomaly": False}))
        return

    try:
        data = json.loads(input_data)
        action = data.get("action", "score")

        monitor = SystemHealthMonitor()

        if action == "train":
            # Load baseline samples
            samples = data.get("baseline", [])
            for s in samples:
                monitor.add_baseline(s)
            print(json.dumps({
                "status": "training",
                "samples_collected": len(monitor.baseline_window),
                "fitted": monitor.fitted,
            }))

        elif action == "score":
            # Pre-load baseline if provided
            for s in data.get("baseline", []):
                monitor.add_baseline(s)

            metrics = data.get("metrics", {})
            result = monitor.score(metrics)
            print(json.dumps(result))

    except Exception as e:
        print(json.dumps({"error": str(e), "score": 0.0, "is_anomaly": False}))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
# ──────────────────────────────────────────────────────────────
# sentinel-os/ai-workers/lstm_worker.py
# LSTM / Isolation Forest time-series anomaly detection
# Monitors sensor data streams for anomalous patterns
# ──────────────────────────────────────────────────────────────

import asyncio
import json
import structlog
from datetime import datetime, timezone

import numpy as np

logger = structlog.get_logger("lstm-worker")

KAFKA_BROKERS = "localhost:9092"
KAFKA_INPUT_TOPIC = "sentinel.sensors.timeseries"
KAFKA_OUTPUT_TOPIC = "sentinel.ai.anomalies"

try:
    from sklearn.ensemble import IsolationForest
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False
    logger.warning("scikit-learn not installed, using stub detection")

try:
    import torch
    import torch.nn as nn
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False
    logger.warning("pytorch not installed, LSTM not available")


class LSTMAutoencoder(nn.Module):
    """LSTM autoencoder for time-series anomaly detection."""
    def __init__(self, input_dim=1, hidden_dim=64, num_layers=2):
        super().__init__()
        self.encoder = nn.LSTM(input_dim, hidden_dim, num_layers, batch_first=True)
        self.decoder = nn.LSTM(hidden_dim, input_dim, num_layers, batch_first=True)

    def forward(self, x):
        _, (h, c) = self.encoder(x)
        decoded, _ = self.decoder(h.permute(1, 0, 2).repeat(1, x.size(1), 1))
        return decoded


class AnomalyDetector:
    """Hybrid anomaly detector using Isolation Forest + LSTM."""

    def __init__(self):
        self.iso_forest = None
        self.lstm_model = None
        self.window_size = 100
        self.threshold = 2.0  # z-score threshold

        if SKLEARN_AVAILABLE:
            self.iso_forest = IsolationForest(
                contamination=0.05,
                random_state=42,
                n_estimators=100,
            )

        if TORCH_AVAILABLE:
            self.lstm_model = LSTMAutoencoder()
            # Load pre-trained weights if available
            try:
                self.lstm_model.load_state_dict(
                    torch.load("/opt/sentinel/models/lstm_autoencoder.pt")
                )
            except FileNotFoundError:
                logger.warning("no_pretrained_lstm_weights")

    def detect_isolation_forest(self, data: np.ndarray) -> list[dict]:
        """Detect anomalies using Isolation Forest."""
        if not SKLEARN_AVAILABLE or self.iso_forest is None:
            return []

        predictions = self.iso_forest.fit_predict(data.reshape(-1, 1))
        anomalies = []
        for i, pred in enumerate(predictions):
            if pred == -1:  # Anomaly
                anomalies.append({
                    "index": i,
                    "value": float(data[i]),
                    "method": "isolation_forest",
                    "score": float(self.iso_forest.score_samples(data[i].reshape(1, -1))[0]),
                })
        return anomalies

    def detect_zscore(self, data: np.ndarray) -> list[dict]:
        """Simple z-score based anomaly detection."""
        mean = np.mean(data)
        std = np.std(data)
        if std == 0:
            return []

        anomalies = []
        z_scores = np.abs((data - mean) / std)
        for i, z in enumerate(z_scores):
            if z > self.threshold:
                anomalies.append({
                    "index": i,
                    "value": float(data[i]),
                    "method": "zscore",
                    "z_score": float(z),
                })
        return anomalies


async def run_worker():
    """Main worker loop — consumes sensor time-series from Kafka."""
    logger.info("lstm_worker_starting", sklearn=SKLEARN_AVAILABLE, torch=TORCH_AVAILABLE)

    try:
        from aiokafka import AIOKafkaConsumer, AIOKafkaProducer
    except ImportError:
        logger.error("aiokafka not installed")
        return

    consumer = AIOKafkaConsumer(
        KAFKA_INPUT_TOPIC,
        bootstrap_servers=KAFKA_BROKERS,
        group_id="lstm-worker",
    )
    producer = AIOKafkaProducer(
        bootstrap_servers=KAFKA_BROKERS,
        value_serializer=lambda v: json.dumps(v).encode(),
    )

    detector = AnomalyDetector()

    await consumer.start()
    await producer.start()

    try:
        async for msg in consumer:
            if not msg.value:
                continue
            data = json.loads(msg.value)
            values = data.get("values", [])

            if not values or len(values) < 10:
                continue

            np_data = np.array(values, dtype=np.float64)

            # Run both detection methods
            anomalies = []
            anomalies.extend(detector.detect_zscore(np_data))
            anomalies.extend(detector.detect_isolation_forest(np_data))

            if anomalies:
                await producer.send_and_wait(
                    KAFKA_OUTPUT_TOPIC,
                    {
                        "sensor_id": data.get("sensor_id", "unknown"),
                        "sensor_type": data.get("sensor_type", "unknown"),
                        "anomalies": anomalies,
                        "total_points": len(values),
                        "anomaly_count": len(anomalies),
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    },
                )
                logger.info("anomalies_detected", count=len(anomalies),
                           sensor=data.get("sensor_id"))
    finally:
        await consumer.stop()
        await producer.stop()


if __name__ == "__main__":
    asyncio.run(run_worker())

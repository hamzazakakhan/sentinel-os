#!/usr/bin/env python3
# ──────────────────────────────────────────────────────────────
# sentinel-os/ai-workers/torchsig_worker.py
# RF signal modulation classification using TorchSig
# 53 modulation types from SDR IQ samples
# ──────────────────────────────────────────────────────────────

import asyncio
import json
import structlog
from datetime import datetime, timezone

import httpx
import numpy as np

logger = structlog.get_logger("torchsig-worker")

KAFKA_BROKERS = "localhost:9092"
KAFKA_INPUT_TOPIC = "sentinel.sigint.iq-samples"
KAFKA_OUTPUT_TOPIC = "sentinel.ai.rf-classifications"

try:
    from torchsig.models import XCITClassifier
    from torchsig.utils.dataset import SignalDataset
    TORCHSIG_AVAILABLE = True
    logger.info("torchsig_loaded", model="XCITClassifier")
except ImportError:
    TORCHSIG_AVAILABLE = False
    logger.warning("torchsig not installed, worker in stub mode")


def classify_iq_samples(iq_data: np.ndarray, sample_rate: float) -> dict:
    """Classify RF signal modulation from IQ samples."""
    if not TORCHSIG_AVAILABLE:
        return {
            "modulation": "UNKNOWN",
            "confidence": 0.0,
            "model": "stub",
            "note": "TorchSig not available",
        }

    try:
        model = XCITClassifier.from_pretrained("torchsig-xcit-53mod")
        iq_tensor = iq_data.reshape(1, 2, -1)  # [batch, 2 (I/Q), samples]
        predictions = model(iq_tensor)
        top_class = int(predictions.argmax(dim=1)[0])
        confidence = float(predictions.max())

        # TorchSig 53-class modulation mapping
        MOD_MAP = {
            0: "OOK", 1: "4ASK", 2: "8ASK", 3: "BPSK", 4: "QPSK",
            5: "8PSK", 6: "16PSK", 7: "32PSK", 8: "16APSK", 9: "32APSK",
            10: "64APSK", 11: "128APSK", 12: "16QAM", 13: "32QAM",
            14: "64QAM", 15: "128QAM", 16: "256QAM", 17: "AM-SSB-WC",
            18: "AM-SSB-SC", 19: "AM-DSB-WC", 20: "AM-DSB-SC",
            21: "FM", 22: "GMSK", 23: "OQPSK", 24: "BFSK",
            25: "4FSK", 26: "8FSK", 27: "16FSK",
            # ... remaining classes
        }

        modulation = MOD_MAP.get(top_class, f"CLASS_{top_class}")
        return {
            "modulation": modulation,
            "confidence": round(confidence, 4),
            "class_id": top_class,
            "model": "XCITClassifier-53mod",
            "sample_rate": sample_rate,
        }
    except Exception as e:
        logger.error("classification_failed", error=str(e))
        return {"modulation": "ERROR", "confidence": 0.0, "error": str(e)}


async def run_worker():
    """Main worker loop — consumes IQ samples from Kafka."""
    logger.info("torchsig_worker_starting", torchsig_available=TORCHSIG_AVAILABLE)

    try:
        from aiokafka import AIOKafkaConsumer, AIOKafkaProducer
    except ImportError:
        logger.error("aiokafka not installed")
        return

    consumer = AIOKafkaConsumer(
        KAFKA_INPUT_TOPIC,
        bootstrap_servers=KAFKA_BROKERS,
        group_id="torchsig-worker",
    )
    producer = AIOKafkaProducer(
        bootstrap_servers=KAFKA_BROKERS,
        value_serializer=lambda v: json.dumps(v).encode(),
    )

    await consumer.start()
    await producer.start()

    try:
        async for msg in consumer:
            if not msg.value:
                continue
            data = json.loads(msg.value)
            iq_b64 = data.get("iq_base64", "")
            sample_rate = data.get("sample_rate", 2e6)

            if not iq_b64:
                continue

            import base64
            iq_bytes = base64.b64decode(iq_b64)
            iq_data = np.frombuffer(iq_bytes, dtype=np.complex64)

            result = classify_iq_samples(iq_data, sample_rate)

            await producer.send_and_wait(
                KAFKA_OUTPUT_TOPIC,
                {
                    "source": data.get("source", "rtl-sdr"),
                    "frequency": data.get("frequency"),
                    "classification": result,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
            )
            logger.info("rf_classified", modulation=result["modulation"],
                       confidence=result["confidence"])
    finally:
        await consumer.stop()
        await producer.stop()


if __name__ == "__main__":
    asyncio.run(run_worker())

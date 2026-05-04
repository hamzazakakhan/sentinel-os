#!/usr/bin/env python3
# ──────────────────────────────────────────────────────────────
# sentinel-os/ai-workers/yolov8_worker.py
# YOLOv8 object detection worker for RTSP/drone video feeds
# Detects: persons, vehicles, aircraft, weapons
# ──────────────────────────────────────────────────────────────

import asyncio
import base64
import io
import json
import structlog
from datetime import datetime, timezone

import httpx
import numpy as np

logger = structlog.get_logger("yolov8-worker")

OLLAMA_HOST = "http://localhost:11434"
KAFKA_BROKERS = "localhost:9092"
KAFKA_TOPIC = "sentinel.ai.detections"

# YOLOv8 class IDs of interest
TARGET_CLASSES = {
    0: "person",
    1: "bicycle",
    2: "car",
    3: "motorcycle",
    5: "bus",
    7: "truck",
    16: "dog",
    # Custom: weapons detection would require fine-tuned model
}

try:
    from ultralytics import YOLO
    MODEL = YOLO("yolov8n.pt")  # nano model for CPU; use yolov8x for GPU
    YOLO_AVAILABLE = True
except ImportError:
    logger.warning("ultralytics not installed, YOLOv8 worker in stub mode")
    YOLO_AVAILABLE = False


async def process_frame(frame_data: bytes) -> list[dict]:
    """Run YOLOv8 inference on a single frame."""
    if not YOLO_AVAILABLE:
        return []

    try:
        # Decode image
        img_array = np.frombuffer(frame_data, dtype=np.uint8)
        results = MODEL(img_array, verbose=False)

        detections = []
        for r in results:
            for box in r.boxes:
                cls_id = int(box.cls[0])
                confidence = float(box.conf[0])
                if cls_id in TARGET_CLASSES and confidence > 0.5:
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    detections.append({
                        "class": TARGET_CLASSES[cls_id],
                        "confidence": round(confidence, 3),
                        "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    })
        return detections
    except Exception as e:
        logger.error("yolov8_inference_failed", error=str(e))
        return []


async def run_worker():
    """Main worker loop — consumes video frames from Kafka, runs inference."""
    logger.info("yolov8_worker_starting", yolo_available=YOLO_AVAILABLE)

    try:
        from aiokafka import AIOKafkaConsumer, AIOKafkaProducer
    except ImportError:
        logger.error("aiokafka not installed, cannot start worker")
        return

    consumer = AIOKafkaConsumer(
        "sentinel.video.frames",
        bootstrap_servers=KAFKA_BROKERS,
        group_id="yolov8-worker",
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
            frame_b64 = data.get("frame_base64", "")
            if not frame_b64:
                continue

            frame_data = base64.b64decode(frame_b64)
            detections = await process_frame(frame_data)

            if detections:
                await producer.send_and_wait(
                    KAFKA_TOPIC,
                    {
                        "source": data.get("source", "unknown"),
                        "detections": detections,
                        "frame_timestamp": data.get("timestamp"),
                        "processed_at": datetime.now(timezone.utc).isoformat(),
                    },
                )
                logger.info("detections_published", count=len(detections))
    finally:
        await consumer.stop()
        await producer.stop()


if __name__ == "__main__":
    asyncio.run(run_worker())

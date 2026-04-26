"""Kafka consumer worker that processes ingestion events through AI pipelines."""
from __future__ import annotations

import asyncio
import json
import time
from typing import Any

import httpx
import structlog
from aiokafka import AIOKafkaConsumer, AIOKafkaProducer

from app.config import get_settings

logger = structlog.get_logger(__name__)
settings = get_settings()

TOPICS = [
    "sentinel.detections",
    "sentinel.cyber_events",
    "sentinel.sensor_heartbeats",
    "sentinel.osint_items",
    "sentinel.ingestion.webhook",
]

ENRICHED_TOPIC = "sentinel.enriched"
ALERTS_TOPIC = "sentinel.alerts"


class AIKafkaWorker:
    def __init__(self):
        self.consumer: AIOKafkaConsumer | None = None
        self.producer: AIOKafkaProducer | None = None
        self._running = False
        self._http: httpx.AsyncClient | None = None

    async def start(self):
        self.consumer = AIOKafkaConsumer(
            *TOPICS,
            bootstrap_servers=settings.kafka_brokers,
            group_id=settings.kafka_group_id,
            auto_offset_reset="latest",
            value_deserializer=lambda v: json.loads(v.decode("utf-8")),
        )
        self.producer = AIOKafkaProducer(
            bootstrap_servers=settings.kafka_brokers,
            value_serializer=lambda v: json.dumps(v).encode("utf-8"),
        )
        self._http = httpx.AsyncClient(timeout=30)
        await self.consumer.start()
        await self.producer.start()
        self._running = True
        logger.info("kafka_worker_started", topics=TOPICS)

    async def stop(self):
        self._running = False
        if self.consumer:
            await self.consumer.stop()
        if self.producer:
            await self.producer.stop()
        if self._http:
            await self._http.aclose()
        logger.info("kafka_worker_stopped")

    async def run(self):
        await self.start()
        try:
            async for msg in self.consumer:
                if not self._running:
                    break
                try:
                    await self._dispatch(msg.topic, msg.value)
                except Exception as e:
                    logger.error("message_processing_failed", topic=msg.topic, error=str(e))
        finally:
            await self.stop()

    async def _dispatch(self, topic: str, payload: dict[str, Any]):
        handlers = {
            "sentinel.detections": self._handle_detection,
            "sentinel.cyber_events": self._handle_cyber_event,
            "sentinel.sensor_heartbeats": self._handle_heartbeat,
            "sentinel.osint_items": self._handle_osint,
            "sentinel.ingestion.webhook": self._handle_webhook,
        }
        handler = handlers.get(topic)
        if handler:
            await handler(payload)

    async def _handle_detection(self, payload: dict):
        """Run anomaly detection on sensor detections."""
        confidence = payload.get("confidence", 0)
        detection_type = payload.get("detection_type", "")

        # Score threat level using AI
        enriched = {
            **payload,
            "ai_processed": True,
            "processing_timestamp": time.time(),
        }

        # If confidence is high and detection is suspicious, classify threat
        if confidence > 0.7 and detection_type in ("PERSON", "VEHICLE", "AIRCRAFT"):
            try:
                resp = await self._http.post(
                    f"http://localhost:{settings.port}/api/v1/llm/classify-threat",
                    json={"text": f"{detection_type} detected with confidence {confidence} at {payload.get('latitude', 'unknown')},{payload.get('longitude', 'unknown')}"},
                )
                if resp.status_code == 200:
                    classification = resp.json()
                    enriched["threat_classification"] = classification
                    if classification.get("severity") in ("CRITICAL", "HIGH"):
                        await self._emit_alert(enriched, classification)
            except Exception as e:
                logger.warning("threat_classify_failed", error=str(e))

        await self.producer.send(ENRICHED_TOPIC, value=enriched)

    async def _handle_cyber_event(self, payload: dict):
        """Anomaly detection on network events."""
        features = [
            payload.get("source_port", 0),
            payload.get("destination_port", 0),
            1.0 if payload.get("blocked") else 0.0,
            1.0 if payload.get("ioc_match") else 0.0,
        ]
        enriched = {**payload, "ai_processed": True, "processing_timestamp": time.time()}

        try:
            resp = await self._http.post(
                f"http://localhost:{settings.port}/api/v1/anomaly/detect",
                json={"features": [features], "sensor_id": "cyber"},
            )
            if resp.status_code == 200:
                result = resp.json()
                if result["results"] and result["results"][0]["is_anomaly"]:
                    enriched["is_anomaly"] = True
                    enriched["anomaly_score"] = result["results"][0]["score"]
        except Exception as e:
            logger.warning("anomaly_detect_failed", error=str(e))

        await self.producer.send(ENRICHED_TOPIC, value=enriched)

    async def _handle_heartbeat(self, payload: dict):
        """Track sensor health patterns."""
        enriched = {**payload, "ai_processed": True, "processing_timestamp": time.time()}
        await self.producer.send(ENRICHED_TOPIC, value=enriched)

    async def _handle_osint(self, payload: dict):
        """Classify and score OSINT items."""
        content = payload.get("content", "")
        if isinstance(content, dict):
            content = json.dumps(content)

        enriched = {**payload, "ai_processed": True, "processing_timestamp": time.time()}

        try:
            resp = await self._http.post(
                f"http://localhost:{settings.port}/api/v1/llm/classify-threat",
                json={"text": content},
            )
            if resp.status_code == 200:
                enriched["threat_classification"] = resp.json()
        except Exception as e:
            logger.warning("osint_classify_failed", error=str(e))

        await self.producer.send(ENRICHED_TOPIC, value=enriched)

    async def _handle_webhook(self, payload: dict):
        """Process raw webhook payloads."""
        enriched = {**payload, "ai_processed": True, "processing_timestamp": time.time()}
        await self.producer.send(ENRICHED_TOPIC, value=enriched)

    async def _emit_alert(self, detection: dict, classification: dict):
        alert = {
            "title": f"AI Alert: {classification.get('category', 'Unknown')} - {classification.get('severity', 'MEDIUM')}",
            "description": classification.get("reasoning", "AI-generated alert"),
            "severity": classification.get("severity", "MEDIUM"),
            "domain": detection.get("domain", "PHYSICAL"),
            "confidence": classification.get("confidence", 0.5),
            "source": "ai-service",
            "indicators": classification.get("indicators", []),
            "timestamp": time.time(),
        }
        await self.producer.send(ALERTS_TOPIC, value=alert)
        logger.info("ai_alert_emitted", severity=alert["severity"], title=alert["title"])


async def main():
    worker = AIKafkaWorker()
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())

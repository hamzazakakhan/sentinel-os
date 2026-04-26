from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Coroutine

import structlog
from aiokafka import AIOKafkaConsumer, AIOKafkaProducer

from app.config import get_settings

logger = structlog.get_logger(__name__)

_producer: AIOKafkaProducer | None = None
_consumers: list[AIOKafkaConsumer] = []

TOPICS = {
    "alerts": "sentinel.alerts",
    "detections": "sentinel.detections",
    "sensor_heartbeats": "sentinel.sensor.heartbeats",
    "cyber_events": "sentinel.cyber.events",
    "osint_items": "sentinel.osint.items",
    "response_actions": "sentinel.response.actions",
    "audit": "sentinel.audit",
    "fusion_correlations": "sentinel.fusion.correlations",
    "commands": "sentinel.commands",
    "telemetry": "sentinel.telemetry",
}


async def get_producer() -> AIOKafkaProducer:
    global _producer
    if _producer is None:
        settings = get_settings()
        _producer = AIOKafkaProducer(
            bootstrap_servers=settings.kafka_brokers,
            value_serializer=lambda v: json.dumps(v, default=str).encode("utf-8"),
            key_serializer=lambda k: k.encode("utf-8") if k else None,
            acks="all",
            retry_backoff_ms=100,
            max_request_size=10_485_760,
            linger_ms=5,
            compression_type="lz4",
        )
        await _producer.start()
    return _producer


async def publish_event(
    topic_key: str,
    payload: dict[str, Any],
    key: str | None = None,
    headers: dict[str, str] | None = None,
) -> None:
    producer = await get_producer()
    topic = TOPICS.get(topic_key, topic_key)

    envelope = {
        "event_id": str(uuid.uuid4()),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "source": "api-gateway",
        "payload": payload,
    }

    kafka_headers = []
    if headers:
        kafka_headers = [(k, v.encode("utf-8")) for k, v in headers.items()]

    await producer.send(
        topic,
        value=envelope,
        key=key or envelope["event_id"],
        headers=kafka_headers,
    )
    logger.info("event_published", topic=topic, event_id=envelope["event_id"])


async def create_consumer(
    topic_key: str,
    handler: Callable[[dict[str, Any]], Coroutine[Any, Any, None]],
    group_id: str | None = None,
) -> AIOKafkaConsumer:
    settings = get_settings()
    topic = TOPICS.get(topic_key, topic_key)

    consumer = AIOKafkaConsumer(
        topic,
        bootstrap_servers=settings.kafka_brokers,
        group_id=group_id or f"{settings.kafka_group_id}-{topic_key}",
        value_deserializer=lambda v: json.loads(v.decode("utf-8")),
        auto_offset_reset="latest",
        enable_auto_commit=True,
        auto_commit_interval_ms=5000,
        max_poll_records=100,
    )
    await consumer.start()
    _consumers.append(consumer)

    import asyncio

    async def _consume() -> None:
        try:
            async for msg in consumer:
                try:
                    await handler(msg.value)
                except Exception:
                    logger.exception(
                        "consumer_handler_error",
                        topic=topic,
                        offset=msg.offset,
                    )
        except Exception:
            logger.exception("consumer_loop_error", topic=topic)

    asyncio.create_task(_consume())
    logger.info("consumer_started", topic=topic, group_id=group_id)
    return consumer


async def close_kafka() -> None:
    global _producer
    if _producer:
        await _producer.stop()
        _producer = None
    for consumer in _consumers:
        await consumer.stop()
    _consumers.clear()

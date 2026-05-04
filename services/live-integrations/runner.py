# ──────────────────────────────────────────────────────────────
# sentinel-os/services/live-integrations/runner.py
# Main runner: orchestrates all OSINT/SIGINT/CTI feeds
# Publishes to Kafka topic "sentinel.intelligence"
# Runs as part of sentinel.service
# ──────────────────────────────────────────────────────────────

from __future__ import annotations

import asyncio
import json
import os
import signal
import sys
from datetime import datetime, timezone

import aiohttp
import structlog

logger = structlog.get_logger()

KAFKA_BROKER = os.getenv("KAFKA_BROKER", "localhost:9092")
KAFKA_TOPIC = "sentinel.intelligence"
POLL_CYCLE = 60  # seconds between full poll cycles

# ── Kafka producer (lightweight, no confluent-kafka dependency) ──

class SimpleKafkaProducer:
    """Lightweight Kafka producer using aiokafka or HTTP bridge."""

    def __init__(self, broker: str):
        self.broker = broker
        self._producer = None

    async def start(self):
        try:
            from aiokafka import AIOKafkaProducer
            self._producer = AIOKafkaProducer(bootstrap_servers=self.broker)
            await self._producer.start()
            logger.info("kafka_producer_started", broker=self.broker)
        except ImportError:
            logger.warning("aiokafka_not_installed", fallback="stdout")
            self._producer = None

    async def publish(self, topic: str, key: str, value: dict):
        if self._producer:
            try:
                await self._producer.send_and_wait(
                    topic, value=json.dumps(value, default=str).encode(),
                    key=key.encode())
            except Exception as e:
                logger.warning("kafka_publish_error", error=str(e))
        else:
            # Fallback: write to stdout for systemd journal
            print(f"[KAFKA:{topic}] key={key} value={json.dumps(value, default=str)[:200]}")

    async def stop(self):
        if self._producer:
            await self._producer.stop()


# ── Feed poller ────────────────────────────────────────────────

async def poll_feed(producer: SimpleKafkaProducer, feed, session: aiohttp.ClientSession):
    """Poll a single feed and publish results to Kafka."""
    try:
        items = await feed.fetch(session)
        for item in items:
            key = f"{feed.name}:{hash(item.get('content', '')) % 1000000}"
            await producer.publish(KAFKA_TOPIC, key, item)
        logger.info("feed_polled", feed=feed.name, items=len(items))
        return len(items)
    except Exception as e:
        logger.warning("feed_poll_error", feed=feed.name, error=str(e))
        return 0


async def run_all_feeds(producer: SimpleKafkaProducer):
    """Import and run all feed integrations."""
    from osint_feeds import ALL_FEEDS
    from sigint_sources import ALL_SIGINT_SOURCES
    from cti_sources import ALL_CTI_SOURCES

    all_sources = ALL_FEEDS + ALL_SIGINT_SOURCES + ALL_CTI_SOURCES
    logger.info("feeds_loaded", total=len(all_sources),
                osint=len(ALL_FEEDS), sigint=len(ALL_SIGINT_SOURCES), cti=len(ALL_CTI_SOURCES))

    stop_event = asyncio.Event()

    def _signal_handler(sig, frame):
        logger.info("shutdown_signal", signal=sig)
        stop_event.set()

    signal.signal(signal.SIGTERM, _signal_handler)
    signal.signal(signal.SIGINT, _signal_handler)

    async with aiohttp.ClientSession() as session:
        while not stop_event.is_set():
            cycle_start = datetime.now(timezone.utc)
            total_items = 0

            # Poll all feeds concurrently with semaphore limiting
            sem = asyncio.Semaphore(10)

            async def limited_poll(feed):
                async with sem:
                    return await poll_feed(producer, feed, session)

            tasks = [asyncio.create_task(limited_poll(f)) for f in all_sources]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            total_items = sum(r for r in results if isinstance(r, int))

            elapsed = (datetime.now(timezone.utc) - cycle_start).total_seconds()
            logger.info("poll_cycle_complete",
                        total_items=total_items, elapsed_sec=f"{elapsed:.1f}",
                        next_poll=POLL_CYCLE)

            # Wait for next cycle or stop signal
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=POLL_CYCLE)
            except asyncio.TimeoutError:
                pass  # Normal: next poll cycle

    logger.info("feed_runner_stopped")


async def main():
    producer = SimpleKafkaProducer(KAFKA_BROKER)
    await producer.start()
    try:
        await run_all_feeds(producer)
    finally:
        await producer.stop()


if __name__ == "__main__":
    asyncio.run(main())

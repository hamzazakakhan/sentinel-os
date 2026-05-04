#!/usr/bin/env python3
# ──────────────────────────────────────────────────────────────
# sentinel-os/ai-workers/gnuradio/adsb_decoder.py
# ADS-B decoder — pipes decoded aircraft messages to Kafka
# RTL-SDR source at 1090 MHz
# ──────────────────────────────────────────────────────────────

"""
This is a reference implementation of the ADS-B GNU Radio flowgraph.
In production, this runs as a native GNU Radio process with the
osmosdr source block connected to the RTL-SDR hardware.

For development/testing without hardware, this script simulates
ADS-B messages by polling the OpenSky Network API.
"""

import asyncio
import json
import structlog
from datetime import datetime, timezone

import httpx

logger = structlog.get_logger("adsb-decoder")

KAFKA_BROKERS = "localhost:9092"
KAFKA_TOPIC = "sentinel.sigint.adsb.tracks"
OPENSKY_API = "https://opensky-network.org/api/states/all"


async def poll_opensky(opensky_user: str = "", opensky_pass: str = ""):
    """Poll OpenSky Network API for real ADS-B data (dev mode)."""
    auth = None
    if opensky_user and opensky_pass:
        auth = (opensky_user, opensky_pass)

    async with httpx.AsyncClient(auth=auth, timeout=30) as client:
        try:
            resp = await client.get(OPENSKY_API)
            resp.raise_for_status()
            data = resp.json()

            states = data.get("states", [])
            tracks = []
            for s in states:
                if len(s) < 15:
                    continue
                track = {
                    "icao24": s[0],
                    "callsign": (s[1] or "").strip(),
                    "origin_country": s[2],
                    "time_position": s[3],
                    "longitude": s[5],
                    "latitude": s[6],
                    "baro_altitude": s[7],       # meters
                    "on_ground": s[8],
                    "velocity": s[9],            # m/s
                    "heading": s[10],             # degrees
                    "vertical_rate": s[11],       # m/s
                    "squawk": s[14],
                    "source": "opensky-network",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
                tracks.append(track)

            return tracks
        except Exception as e:
            logger.error("opensky_poll_failed", error=str(e))
            return []


async def run_decoder(mode: str = "opensky"):
    """Run ADS-B decoder in specified mode.

    Modes:
      - 'opensky': Poll OpenSky Network API (no hardware needed)
      - 'rtlsdr': Use GNU Radio + RTL-SDR (requires hardware)
    """
    logger.info("adsb_decoder_starting", mode=mode)

    try:
        from aiokafka import AIOKafkaProducer
    except ImportError:
        logger.error("aiokafka not installed")
        return

    producer = AIOKafkaProducer(
        bootstrap_servers=KAFKA_BROKERS,
        value_serializer=lambda v: json.dumps(v).encode(),
    )
    await producer.start()

    try:
        if mode == "opensky":
            logger.info("using_opensky_api", url=OPENSKY_API)
            while True:
                tracks = await poll_opensky()
                if tracks:
                    for track in tracks:
                        await producer.send_and_wait(KAFKA_TOPIC, track)
                    logger.info("adsb_tracks_published", count=len(tracks))
                await asyncio.sleep(10)  # OpenSky rate limit: ~6/min without auth

        elif mode == "rtlsdr":
            logger.info("using_rtlsdr_hardware", freq="1090 MHz")
            # In production, this would spawn the GNU Radio flowgraph:
            # from gnuradio import gr, blocks, filter, analog
            # import osmosdr
            # ... (see blueprint for full flowgraph)
            logger.warning("rtlsdr_mode_requires_gnuradio_hardware")
            # Fall back to OpenSky
            while True:
                tracks = await poll_opensky()
                if tracks:
                    for track in tracks:
                        track["source"] = "rtl-sdr-simulated"
                        await producer.send_and_wait(KAFKA_TOPIC, track)
                await asyncio.sleep(10)
    finally:
        await producer.stop()


if __name__ == "__main__":
    import os
    mode = os.environ.get("ADSB_MODE", "opensky")
    asyncio.run(run_decoder(mode))

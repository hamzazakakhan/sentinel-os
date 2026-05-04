# ──────────────────────────────────────────────────────────────
# sentinel-os/services/live-integrations/sigint_sources.py
# Live SIGINT data sources: ADS-B, AIS, APRS, SDR spectrum
# ──────────────────────────────────────────────────────────────

from __future__ import annotations

import asyncio
import json
import structlog
from datetime import datetime, timezone
from typing import Any, Optional

import aiohttp

logger = structlog.get_logger()


class SIGINTSource:
    name: str = "unknown"
    source_type: str = "SIGINT"
    poll_interval: int = 30

    async def fetch(self, session: aiohttp.ClientSession) -> list[dict]:
        raise NotImplementedError

    def normalize(self, raw: dict) -> dict:
        return {
            "source_type": self.source_type,
            "source_name": self.name,
            "content": json.dumps(raw, default=str),
            "collected_at": datetime.now(timezone.utc).isoformat(),
            "threat_score": 0.3,
        }


# ── 1. OpenSky Network ADS-B ──────────────────────────────────
class ADSBSource(SIGINTSource):
    name = "ADS-B OpenSky"
    base_url = "https://opensky-network.org/api/states/all"
    poll_interval = 15

    async def fetch(self, session: aiohttp.ClientSession) -> list[dict]:
        try:
            async with session.get(self.base_url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status != 200: return []
                data = await resp.json()
                tracks = []
                for s in data.get("states", [])[:200]:
                    track = {
                        "callsign": (s[1] or "").strip(),
                        "origin_country": s[2],
                        "icao24": s[0],
                        "latitude": s[5], "longitude": s[6],
                        "altitude_m": s[7], "velocity_mps": s[9],
                        "heading_deg": s[10], "vertical_rate": s[11],
                        "on_ground": s[8], "category": s[17],
                    }
                    if track["latitude"] is not None and track["longitude"] is not None:
                        tracks.append(self.normalize(track))
                logger.info("adsb_fetched", count=len(tracks))
                return tracks
        except Exception as e:
            logger.warning("adsb_error", error=str(e))
            return []


# ── 2. APRS-IS (Amateur Radio Position Reporting) ────────────
class APRSSource(SIGINTSource):
    name = "APRS-IS"
    host = "rotate.aprs2.net"
    port = 14580
    poll_interval = 60

    async def fetch(self, session: aiohttp.ClientSession) -> list[dict]:
        try:
            reader, writer = await asyncio.open_connection(self.host, self.port)
            # Send login
            writer.write(f"user sentinel pass -1 vers sentinel-os 2.0 filter r/50.0/10.0/1\r\n".encode())
            await writer.drain()

            positions = []
            try:
                data = await asyncio.wait_for(reader.read(8192), timeout=10.0)
                for line in data.decode("utf-8", errors="ignore").splitlines():
                    if ":" not in line: continue
                    parts = line.split(":", 1)
                    if len(parts) < 2: continue
                    header = parts[0]
                    info = parts[1]
                    # Parse position reports
                    if len(info) > 0 and ("!" in info or "=" in info):
                        pos = {
                            "callsign": header.split(">")[0] if ">" in header else header,
                            "raw": line[:200],
                            "type": "position",
                        }
                        positions.append(self.normalize(pos))
            except asyncio.TimeoutError:
                pass
            writer.close()
            logger.info("aprs_fetched", count=len(positions))
            return positions[:50]
        except Exception as e:
            logger.warning("aprs_error", error=str(e))
            return []


# ── 3. AIS (Marine Vessel Tracking) ───────────────────────────
class AISSource(SIGINTSource):
    name = "AIS Marine Tracker"
    base_url = "https://services.marinetraffic.com/api/exportvessels"
    poll_interval = 120

    def __init__(self, api_key: str = ""):
        self.api_key = api_key

    async def fetch(self, session: aiohttp.ClientSession) -> list[dict]:
        if not self.api_key: return []
        try:
            params = {"v": "2", "apikey": self.api_key, "format": "json", "timeout": 60}
            async with session.get(self.base_url, params=params, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                if resp.status != 200: return []
                data = await resp.json()
                vessels = []
                for v in data[:100] if isinstance(data, list) else []:
                    vessels.append(self.normalize({
                        "mmsi": v.get("MMSI"), "ship_name": v.get("SHIPNAME"),
                        "lat": v.get("LAT"), "lon": v.get("LON"),
                        "speed": v.get("SPEED"), "course": v.get("COURSE"),
                        "ship_type": v.get("TYPE_VESSEL"), "flag": v.get("FLAG"),
                    }))
                return vessels
        except Exception as e:
            logger.warning("ais_error", error=str(e))
            return []


# ── 4. RTL-SDR Spectrum (local USB device) ────────────────────
class RTLSDRSource(SIGINTSource):
    name = "RTL-SDR Local"
    poll_interval = 5
    device_index: int = 0
    center_freq: int = 1090000000  # 1090 MHz (ADS-B)
    sample_rate: int = 2400000

    async def fetch(self, session: aiohttp.ClientSession) -> list[dict]:
        try:
            import subprocess
            result = subprocess.run(
                ["rtl_power", "-f", str(self.center_freq), "-s", str(self.sample_rate),
                 "-i", "1", "-e", "5s", "-"],
                capture_output=True, text=True, timeout=10
            )
            if result.returncode != 0: return []
            # Parse rtl_power CSV output
            bins = []
            for line in result.stdout.splitlines():
                parts = line.split(",")
                if len(parts) < 7: continue
                freq_start = float(parts[2])
                freq_step = float(parts[4])
                for i, pwr in enumerate(parts[6:]):
                    try:
                        bins.append({"freq_hz": freq_start + i * freq_step, "power_db": float(pwr)})
                    except ValueError:
                        continue
            if bins:
                return [self.normalize({"type": "spectrum", "center_freq": self.center_freq,
                    "sample_rate": self.sample_rate, "bins": bins[:256]})]
            return []
        except FileNotFoundError:
            logger.debug("rtl_power_not_found")
            return []
        except Exception as e:
            logger.warning("rtlsdr_error", error=str(e))
            return []


# ── 5. InfluxDB/Wireshark SIGINT Bridge ───────────────────────
class WiresharkBridge(SIGINTSource):
    name = "Wireshark/TShark Bridge"
    poll_interval = 60

    async def fetch(self, session: aiohttp.ClientSession) -> list[dict]:
        try:
            import subprocess
            result = subprocess.run(
                ["tshark", "-i", "any", "-c", "100", "-T", "json",
                 "-e", "ip.src", "-e", "ip.dst", "-e", "tcp.port",
                 "-e", "udp.port", "-e", "frame.protocols"],
                capture_output=True, text=True, timeout=15
            )
            if result.returncode != 0: return []
            data = json.loads(result.stdout)
            packets = []
            for pkt in data[:50]:
                layers = pkt.get("_source", {}).get("layers", {})
                packets.append(self.normalize({
                    "src_ip": layers.get("ip.src", [""])[0] if isinstance(layers.get("ip.src"), list) else layers.get("ip.src", ""),
                    "dst_ip": layers.get("ip.dst", [""])[0] if isinstance(layers.get("ip.dst"), list) else layers.get("ip.dst", ""),
                    "protocol": layers.get("frame.protocols", [""])[0] if isinstance(layers.get("frame.protocols"), list) else layers.get("frame.protocols", ""),
                }))
            return packets
        except (FileNotFoundError, json.JSONDecodeError):
            return []
        except Exception as e:
            logger.warning("tshark_error", error=str(e))
            return []


ALL_SIGINT_SOURCES: list[SIGINTSource] = [
    ADSBSource(), APRSSource(), AISSource(), RTLSDRSource(), WiresharkBridge(),
]

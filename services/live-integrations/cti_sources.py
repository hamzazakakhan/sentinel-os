# ──────────────────────────────────────────────────────────────
# sentinel-os/services/live-integrations/cti_sources.py
# Cyber Threat Intelligence feeds: MISP, MITRE ATT&CK, Abuse.ch
# ──────────────────────────────────────────────────────────────

from __future__ import annotations

import asyncio
import json
import structlog
from datetime import datetime, timezone
from typing import Any, Optional

import aiohttp

logger = structlog.get_logger()


class CTISource:
    name: str = "unknown"
    source_type: str = "CTI"
    poll_interval: int = 600

    async def fetch(self, session: aiohttp.ClientSession) -> list[dict]:
        raise NotImplementedError

    def normalize(self, raw: dict) -> dict:
        return {
            "source_type": self.source_type,
            "source_name": self.name,
            "content": json.dumps(raw, default=str),
            "collected_at": datetime.now(timezone.utc).isoformat(),
            "threat_score": 0.7,
        }


# ── 1. MITRE ATT&CK STIX ─────────────────────────────────────
class MITREATTCKSource(CTISource):
    name = "MITRE ATT&CK"
    base_url = "https://raw.githubusercontent.com/mitre/cti/master/enterprise-attack/enterprise-attack.json"
    poll_interval = 86400  # daily

    async def fetch(self, session: aiohttp.ClientSession) -> list[dict]:
        try:
            async with session.get(self.base_url, timeout=aiohttp.ClientTimeout(total=120)) as resp:
                if resp.status != 200: return []
                data = await resp.json()
                items = []
                for obj in data.get("objects", []):
                    if obj.get("type") == "attack-pattern":
                        items.append(self.normalize({
                            "mitre_id": obj.get("external_references", [{}])[0].get("external_id", ""),
                            "name": obj.get("name", ""),
                            "description": (obj.get("description", "") or "")[:300],
                            "tactic": [p.get("phase_name") for p in obj.get("kill_chain_phases", [])],
                            "platforms": obj.get("x_mitre_platforms", []),
                            "detection": (obj.get("x_mitre_detection", "") or "")[:200],
                        }))
                logger.info("mitre_fetched", count=len(items))
                return items[:200]
        except Exception as e:
            logger.warning("mitre_error", error=str(e))
            return []


# ── 2. MISP Feed (if available) ──────────────────────────────
class MISPSource(CTISource):
    name = "MISP Threat Sharing"
    base_url = "https://mispp.circl.lu"

    def __init__(self, api_key: str = ""):
        self.api_key = api_key
        self.headers = {"Authorization": api_key, "Accept": "application/json"} if api_key else {}

    async def fetch(self, session: aiohttp.ClientSession) -> list[dict]:
        if not self.api_key: return []
        try:
            async with session.get(f"{self.base_url}/events/index", headers=self.headers,
                                   timeout=aiohttp.ClientTimeout(total=30)) as resp:
                if resp.status != 200: return []
                data = await resp.json()
                items = []
                for ev in data[:30] if isinstance(data, list) else []:
                    items.append(self.normalize({
                        "event_id": ev.get("id"), "info": ev.get("info", ""),
                        "threat_level": ev.get("threat_level_id"),
                        "analysis": ev.get("analysis"), "date": ev.get("date"),
                        "org": ev.get("Orgc", {}).get("name", ""),
                        "tags": [t.get("name") for t in ev.get("EventTag", [])],
                    }))
                return items
        except Exception as e:
            logger.warning("misp_error", error=str(e))
            return []


# ── 3. Abuse.ch MalwareBazaar ─────────────────────────────────
class MalwareBazaarSource(CTISource):
    name = "MalwareBazaar"
    base_url = "https://mb-api.abuse.ch/api/v1/"

    async def fetch(self, session: aiohttp.ClientSession) -> list[dict]:
        try:
            payload = {"query": "get_recent", "selector": "time"}
            async with session.post(self.base_url, data=payload,
                                    timeout=aiohttp.ClientTimeout(total=30)) as resp:
                if resp.status != 200: return []
                data = await resp.json()
                items = []
                for s in data.get("data", [])[:30]:
                    items.append(self.normalize({
                        "sha256": s.get("sha256_hash"), "sha1": s.get("sha1_hash"),
                        "md5": s.get("md5_hash"), "file_type": s.get("file_type"),
                        "signature": s.get("signature"), "tags": s.get("tags", ""),
                        "delivery_method": s.get("delivery_method"),
                        "file_name": s.get("file_name"),
                    }))
                return items
        except Exception as e:
            logger.warning("malwarebazaar_error", error=str(e))
            return []


# ── 4. Feodo Tracker (botnet C2) ──────────────────────────────
class FeodoTrackerSource(CTISource):
    name = "Feodo Tracker"
    base_url = "https://feodotracker.abuse.ch/downloads/ipblocklist.json"

    async def fetch(self, session: aiohttp.ClientSession) -> list[dict]:
        try:
            async with session.get(self.base_url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                if resp.status != 200: return []
                data = await resp.json()
                items = []
                for entry in data[:100] if isinstance(data, list) else []:
                    items.append(self.normalize({
                        "ip": entry.get("ip_address"), "port": entry.get("port"),
                        "status": entry.get("status"), "hostname": entry.get("hostname"),
                        "malware": entry.get("malware_printable"),
                        "sbl": entry.get("sbl_id"), "first_seen": entry.get("first_seen_utc"),
                    }))
                return items
        except Exception as e:
            logger.warning("feodo_error", error=str(e))
            return []


# ── 5. URLhaus Malware URLs ───────────────────────────────────
class URLhausMalwareSource(CTISource):
    name = "URLhaus Malware URLs"
    base_url = "https://urlhaus-api.abuse.ch/v1/payloads/recent/"

    async def fetch(self, session: aiohttp.ClientSession) -> list[dict]:
        try:
            async with session.get(self.base_url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                if resp.status != 200: return []
                data = await resp.json()
                items = []
                for p in data.get("payloads", [])[:30]:
                    items.append(self.normalize({
                        "sha256": p.get("sha256_hash"), "file_type": p.get("file_type"),
                        "signature": p.get("signature"), "tags": p.get("tags", []),
                        "url_count": p.get("url_count"),
                    }))
                return items
        except Exception as e:
            logger.warning("urlhaus_malware_error", error=str(e))
            return []


# ── 6. Botvrij.eu (Dutch abuse) ──────────────────────────────
class BotvrijSource(CTISource):
    name = "Botvrij.eu"
    base_url = "https://www.botvrij.eu/data/iocs/"

    async def fetch(self, session: aiohttp.ClientSession) -> list[dict]:
        try:
            async with session.get(self.base_url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                if resp.status != 200: return []
                text = await resp.text()
                items = []
                for line in text.splitlines()[:100]:
                    line = line.strip()
                    if not line or line.startswith("#"): continue
                    parts = line.split("|")
                    if len(parts) >= 2:
                        items.append(self.normalize({
                            "ioc_type": parts[0].strip(), "ioc_value": parts[1].strip(),
                            "source": "botvrij.eu",
                        }))
                return items
        except Exception as e:
            logger.warning("botvrij_error", error=str(e))
            return []


# ── 7. Spamhaus DROP ──────────────────────────────────────────
class SpamhausDROPSource(CTISource):
    name = "Spamhaus DROP"
    base_url = "https://www.spamhaus.org/drop/drop.txt"

    async def fetch(self, session: aiohttp.ClientSession) -> list[dict]:
        try:
            async with session.get(self.base_url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                if resp.status != 200: return []
                text = await resp.text()
                items = []
                for line in text.splitlines():
                    line = line.strip()
                    if not line or line.startswith(";"): continue
                    cidr = line.split(";")[0].strip()
                    items.append(self.normalize({"cidr": cidr, "list": "DROP"}))
                return items
        except Exception as e:
            logger.warning("spamhaus_error", error=str(e))
            return []


# ── 8. Tor Exit Nodes ─────────────────────────────────────────
class TorExitSource(CTISource):
    name = "Tor Exit Nodes"
    base_url = "https://check.torproject.org/torbulkexitlist"
    poll_interval = 3600

    async def fetch(self, session: aiohttp.ClientSession) -> list[dict]:
        try:
            async with session.get(self.base_url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                if resp.status != 200: return []
                text = await resp.text()
                items = []
                for ip in text.splitlines()[:500]:
                    ip = ip.strip()
                    if ip:
                        items.append(self.normalize({"ip": ip, "type": "tor_exit_node"}))
                return items
        except Exception as e:
            logger.warning("tor_exit_error", error=str(e))
            return []


# ── 9. Emerging Threats Rules ────────────────────────────────
class EmergingThreatsSource(CTISource):
    name = "Emerging Threats"
    base_url = "https://rules.emergingthreats.net/blocklists/compromised-ips.txt"

    async def fetch(self, session: aiohttp.ClientSession) -> list[dict]:
        try:
            async with session.get(self.base_url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                if resp.status != 200: return []
                text = await resp.text()
                items = []
                for ip in text.splitlines()[:200]:
                    ip = ip.strip()
                    if ip and not ip.startswith("#"):
                        items.append(self.normalize({"ip": ip, "list": "emerging_threats_compromised"}))
                return items
        except Exception as e:
            logger.warning("emerging_threats_error", error=str(e))
            return []


# ── 10. PhishTank ─────────────────────────────────────────────
class PhishTankSource(CTISource):
    name = "PhishTank"
    base_url = "https://data.phishtank.com/data/online-valid.json"

    async def fetch(self, session: aiohttp.ClientSession) -> list[dict]:
        try:
            async with session.get(self.base_url, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                if resp.status != 200: return []
                data = await resp.json()
                items = []
                for p in data[:50] if isinstance(data, list) else []:
                    items.append(self.normalize({
                        "url": p.get("url"), "phish_id": p.get("phish_id"),
                        "target": p.get("target"), "submission_time": p.get("submission_time"),
                        "verified": p.get("verified"), "online": p.get("online"),
                    }))
                return items
        except Exception as e:
            logger.warning("phishtank_error", error=str(e))
            return []


ALL_CTI_SOURCES: list[CTISource] = [
    MITREATTCKSource(), MalwareBazaarSource(), FeodoTrackerSource(),
    URLhausMalwareSource(), BotvrijSource(), SpamhausDROPSource(),
    TorExitSource(), EmergingThreatsSource(), PhishTankSource(),
    MISPSource(),  # requires API key
]

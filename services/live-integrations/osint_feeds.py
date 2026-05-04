# ──────────────────────────────────────────────────────────────
# sentinel-os/services/live-integrations/osint_feeds.py
# 20+ OSINT feed integrations with real API endpoints
# Each feed fetches, normalizes, and publishes to Kafka
# ──────────────────────────────────────────────────────────────

from __future__ import annotations

import asyncio
import hashlib
import json
import re
from datetime import datetime, timezone
from typing import Any, Optional

import aiohttp
import feedparser
import structlog

logger = structlog.get_logger()

# ── Base feed class ────────────────────────────────────────────

class OSINTFeed:
    name: str = "unknown"
    source_type: str = "OSINT"
    base_url: str = ""
    poll_interval: int = 300  # 5 minutes default
    headers: dict[str, str] = {}

    async def fetch(self, session: aiohttp.ClientSession) -> list[dict]:
        raise NotImplementedError

    def normalize(self, raw: Any) -> dict:
        return {
            "source_type": self.source_type,
            "source_name": self.name,
            "content": json.dumps(raw, default=str),
            "collected_at": datetime.now(timezone.utc).isoformat(),
            "threat_score": 0.5,
            "sentiment_score": 0.0,
        }


# ── RSS/Atom feeds ─────────────────────────────────────────────

class RSSFeedBase(OSINTFeed):
    source_type: str = "RSS"

    async def fetch(self, session: aiohttp.ClientSession) -> list[dict]:
        try:
            async with session.get(self.base_url, headers=self.headers, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                if resp.status != 200:
                    logger.warning("feed_fetch_failed", feed=self.name, status=resp.status)
                    return []
                text = await resp.text()
                feed = feedparser.parse(text)
                items = []
                for entry in feed.entries[:25]:
                    raw = {
                        "title": getattr(entry, "title", ""),
                        "link": getattr(entry, "link", ""),
                        "summary": getattr(entry, "summary", ""),
                        "published": getattr(entry, "published", ""),
                        "tags": [t.term for t in getattr(entry, "tags", [])],
                    }
                    items.append(self.normalize(raw))
                logger.info("feed_fetched", feed=self.name, count=len(items))
                return items
        except Exception as e:
            logger.warning("feed_error", feed=self.name, error=str(e))
            return []


# ── 1. CISA Cybersecurity Advisories ─────────────────────────
class CISACyberFeed(RSSFeedBase):
    name = "CISA Cybersecurity Advisories"
    base_url = "https://www.cisa.gov/news-events/cybersecurity-advisories/all.xml"


# ── 2. US-CERT ────────────────────────────────────────────────
class USCERTFeed(RSSFeedBase):
    name = "US-CERT Alerts"
    base_url = "https://www.us-cert.gov/ncas/alerts.xml"


# ── 3. SANS ISC ───────────────────────────────────────────────
class SANSISCFeed(RSSFeedBase):
    name = "SANS Internet Storm Center"
    base_url = "https://isc.sans.edu/rssfeed.xml"


# ── 4. The Hacker News ────────────────────────────────────────
class HackerNewsFeed(RSSFeedBase):
    name = "The Hacker News"
    base_url = "https://feeds.feedburner.com/TheHackersNews"


# ── 5. BleepingComputer ───────────────────────────────────────
class BleepingComputerFeed(RSSFeedBase):
    name = "BleepingComputer"
    base_url = "https://www.bleepingcomputer.com/feed/"


# ── 6. Krebs on Security ──────────────────────────────────────
class KrebsFeed(RSSFeedBase):
    name = "Krebs on Security"
    base_url = "https://krebsonsecurity.com/feed/"


# ── 7. Dark Reading ───────────────────────────────────────────
class DarkReadingFeed(RSSFeedBase):
    name = "Dark Reading"
    base_url = "https://www.darkreading.com/rss.xml"


# ── 8. Security Affairs ───────────────────────────────────────
class SecurityAffairsFeed(RSSFeedBase):
    name = "Security Affairs"
    base_url = "https://securityaffairs.co/wordpress/feed"


# ── 9. Threatpost ──────────────────────────────────────────────
class ThreatpostFeed(RSSFeedBase):
    name = "Threatpost"
    base_url = "https://threatpost.com/feed/"


# ── 10. NATO News ──────────────────────────────────────────────
class NATOFeed(RSSFeedBase):
    name = "NATO News"
    base_url = "https://www.nato.int/cps/en/natohq/rssFeed.rss"


# ── API-based feeds ────────────────────────────────────────────

class APIFeedBase(OSINTFeed):
    source_type: str = "API"

    async def fetch(self, session: aiohttp.ClientSession) -> list[dict]:
        raise NotImplementedError


# ── 11. NVD CVE ───────────────────────────────────────────────
class NVDCVEFeed(APIFeedBase):
    name = "NVD CVE"
    base_url = "https://services.nvd.nist.gov/rest/json/cves/2.0"
    poll_interval = 600

    async def fetch(self, session: aiohttp.ClientSession) -> list[dict]:
        try:
            params = {"resultsPerPage": 40, "isKev": "true"}
            async with session.get(self.base_url, params=params, timeout=aiohttp.ClientTimeout(total=60)) as resp:
                if resp.status != 200: return []
                data = await resp.json()
                items = []
                for vuln in data.get("vulnerabilities", []):
                    cve = vuln.get("cve", {})
                    metrics = cve.get("metrics", {})
                    cvss = (metrics.get("cvssMetricV31") or metrics.get("cvssMetricV2") or [{}])[0]
                    score = cvss.get("cvssData", {}).get("baseScore", 0)
                    desc = next((d["value"] for d in cve.get("descriptions", []) if d.get("lang") == "en"), "")
                    items.append(self.normalize({
                        "cve_id": cve.get("id"), "cvss": score,
                        "description": desc[:200], "published": cve.get("published"),
                        "exploitability": "KEV",
                    }))
                return items
        except Exception as e:
            logger.warning("nvd_fetch_error", error=str(e))
            return []


# ── 12. CISA Known Exploited Vulnerabilities ──────────────────
class CISAKEVFeed(APIFeedBase):
    name = "CISA KEV"
    base_url = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"

    async def fetch(self, session: aiohttp.ClientSession) -> list[dict]:
        try:
            async with session.get(self.base_url, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                if resp.status != 200: return []
                data = await resp.json()
                items = []
                for v in data.get("vulnerabilities", [])[:50]:
                    items.append(self.normalize({
                        "cve_id": v.get("cveID"), "vulnerability_name": v.get("vulnerabilityName"),
                        "product": v.get("product"), "date_added": v.get("dateAdded"),
                        "short_description": v.get("shortDescription"),
                        "action_required": v.get("requiredAction"),
                    }))
                return items
        except Exception as e:
            logger.warning("cisa_kev_error", error=str(e))
            return []


# ── 13. Shodan InternetDB ─────────────────────────────────────
class ShodanInternetDB(APIFeedBase):
    name = "Shodan InternetDB"
    base_url = "https://internetdb.shodan.io"

    async def fetch(self, session: aiohttp.ClientSession, ip: str = "") -> list[dict]:
        if not ip: return []
        try:
            async with session.get(f"{self.base_url}/{ip}", timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status != 200: return []
                data = await resp.json()
                return [self.normalize({"ip": ip, "ports": data.get("ports", []),
                    "hostnames": data.get("hostnames", []), "vulns": data.get("vulns", []),
                    "cpes": data.get("cpes", []), "tags": data.get("tags", [])})]
        except Exception as e:
            logger.warning("shodan_error", ip=ip, error=str(e))
            return []


# ── 14. AlienVault OTX ────────────────────────────────────────
class AlienVaultOTX(APIFeedBase):
    name = "AlienVault OTX"
    base_url = "https://otx.alienvault.com/api/v1/pulse/subscribed"
    poll_interval = 600

    def __init__(self, api_key: str = ""):
        self.api_key = api_key
        self.headers = {"X-OTX-API-KEY": api_key} if api_key else {}

    async def fetch(self, session: aiohttp.ClientSession) -> list[dict]:
        if not self.api_key: return []
        try:
            async with session.get(self.base_url, headers=self.headers, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                if resp.status != 200: return []
                data = await resp.json()
                items = []
                for pulse in data.get("results", [])[:20]:
                    indicators = [{"type": i.get("type"), "value": i.get("indicator")} for i in pulse.get("indicators", [])[:10]]
                    items.append(self.normalize({
                        "pulse_name": pulse.get("name"), "description": pulse.get("description", "")[:200],
                        "author": pulse.get("author_name"), "industries": pulse.get("industries", []),
                        "targeted_countries": pulse.get("targeted_countries", []),
                        "indicators": indicators,
                    }))
                return items
        except Exception as e:
            logger.warning("otx_error", error=str(e))
            return []


# ── 15. Abuse.ch SSL Blacklist ────────────────────────────────
class AbuseSSLFeed(APIFeedBase):
    name = "Abuse.ch SSL Blacklist"
    base_url = "https://sslbl.abuse.ch/blacklist/sslipblacklist.txt"

    async def fetch(self, session: aiohttp.ClientSession) -> list[dict]:
        try:
            async with session.get(self.base_url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                if resp.status != 200: return []
                text = await resp.text()
                items = []
                for line in text.splitlines()[:100]:
                    line = line.strip()
                    if not line or line.startswith("#"): continue
                    items.append(self.normalize({"ip": line, "list": "sslbl", "type": "malicious_ssl"}))
                return items
        except Exception as e:
            logger.warning("sslbl_error", error=str(e))
            return []


# ── 16. Abuse.ch URLhaus ──────────────────────────────────────
class URLhausFeed(APIFeedBase):
    name = "Abuse.ch URLhaus"
    base_url = "https://urlhaus-api.abuse.ch/v1/urls/recent/"

    async def fetch(self, session: aiohttp.ClientSession) -> list[dict]:
        try:
            async with session.get(self.base_url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                if resp.status != 200: return []
                data = await resp.json()
                items = []
                for u in data.get("urls", [])[:50]:
                    items.append(self.normalize({
                        "url": u.get("url"), "threat": u.get("threat"),
                        "host": u.get("host"), "tags": u.get("tags", []),
                        "url_status": u.get("url_status"),
                    }))
                return items
        except Exception as e:
            logger.warning("urlhaus_error", error=str(e))
            return []


# ── 17. Abuse.ch ThreatFox ────────────────────────────────────
class ThreatFoxFeed(APIFeedBase):
    name = "Abuse.ch ThreatFox"
    base_url = "https://threatfox-api.abuse.ch/api/v1/"

    async def fetch(self, session: aiohttp.ClientSession) -> list[dict]:
        try:
            payload = {"query": "search_ioc", "search_term": "recent"}
            async with session.post(self.base_url, json=payload, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                if resp.status != 200: return []
                data = await resp.json()
                items = []
                for ioc in data.get("data", [])[:50]:
                    items.append(self.normalize({
                        "ioc_value": ioc.get("ioc_value"), "ioc_type": ioc.get("ioc_type"),
                        "threat_type": ioc.get("threat_type"), "malware": ioc.get("malware_printable"),
                        "confidence": ioc.get("confidence_level"),
                    }))
                return items
        except Exception as e:
            logger.warning("threatfox_error", error=str(e))
            return []


# ── 18. VirusTotal (requires API key) ─────────────────────────
class VirusTotalFeed(APIFeedBase):
    name = "VirusTotal"
    base_url = "https://www.virustotal.com/api/v3"

    def __init__(self, api_key: str = ""):
        self.api_key = api_key
        self.headers = {"x-apikey": api_key} if api_key else {}

    async def fetch(self, session: aiohttp.ClientSession) -> list[dict]:
        if not self.api_key: return []
        try:
            async with session.get(f"{self.base_url}/intelligence/search?query=tag:malware&limit=20",
                headers=self.headers, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                if resp.status != 200: return []
                data = await resp.json()
                items = []
                for f in data.get("data", [])[:20]:
                    attrs = f.get("attributes", {})
                    items.append(self.normalize({
                        "sha256": f.get("id"), "name": attrs.get("meaningful_name", ""),
                        "tags": attrs.get("tags", []), "size": attrs.get("size", 0),
                        "threat_label": attrs.get("popular_threat_classification", {}).get("suggested_threat_label", ""),
                    }))
                return items
        except Exception as e:
            logger.warning("vt_error", error=str(e))
            return []


# ── 19. OpenSky Network (ADS-B) ──────────────────────────────
class OpenSkyFeed(APIFeedBase):
    name = "OpenSky Network ADS-B"
    base_url = "https://opensky-network.org/api/states/all"
    poll_interval = 30

    async def fetch(self, session: aiohttp.ClientSession) -> list[dict]:
        try:
            async with session.get(self.base_url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                if resp.status != 200: return []
                data = await resp.json()
                items = []
                for state in data.get("states", [])[:100]:
                    items.append(self.normalize({
                        "callsign": (state[1] or "").strip(),
                        "origin_country": state[2],
                        "latitude": state[5], "longitude": state[6],
                        "altitude": state[7], "velocity": state[9],
                        "heading": state[10], "on_ground": state[8],
                    }))
                return items
        except Exception as e:
            logger.warning("opensky_error", error=str(e))
            return []


# ── 20. GDELT Global Events ───────────────────────────────────
class GDELTFead(APIFeedBase):
    name = "GDELT Global Events"
    base_url = "https://api.gdeltproject.org/api/v2/doc/doc"
    poll_interval = 600

    async def fetch(self, session: aiohttp.ClientSession) -> list[dict]:
        try:
            params = {"query": "cyber attack OR terrorism OR security threat",
                      "mode": "ArtList", "maxrecords": 25, "format": "json"}
            async with session.get(self.base_url, params=params, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                if resp.status != 200: return []
                data = await resp.json()
                items = []
                for a in data.get("articles", [])[:25]:
                    items.append(self.normalize({
                        "title": a.get("title", ""), "url": a.get("url", ""),
                        "source": a.get("sourcecountry", ""), "date": a.get("seendate", ""),
                        "language": a.get("language", ""),
                    }))
                return items
        except Exception as e:
            logger.warning("gdelt_error", error=str(e))
            return []


# ── Feed Registry ──────────────────────────────────────────────

ALL_FEEDS: list[OSINTFeed] = [
    CISACyberFeed(), USCERTFeed(), SANSISCFeed(), HackerNewsFeed(),
    BleepingComputerFeed(), KrebsFeed(), DarkReadingFeed(), SecurityAffairsFeed(),
    ThreatpostFeed(), NATOFeed(), NVDCVEFeed(), CISAKEVFeed(),
    AbuseSSLFeed(), URLhausFeed(), ThreatFoxFeed(), OpenSkyFeed(), GDELTFead(),
    # API key required feeds (will return empty if no key)
    AlienVaultOTX(), VirusTotalFeed(),
]

def get_feed_by_name(name: str) -> Optional[OSINTFeed]:
    for f in ALL_FEEDS:
        if f.name == name: return f
    return None

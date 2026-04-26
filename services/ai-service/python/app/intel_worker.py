"""Continuous intelligence worker that uses Ollama to generate security intelligence
and feeds it into the Sentinel OS system via the API Gateway GraphQL mutations."""

import asyncio
import random
import time
from datetime import datetime

import httpx
import structlog

logger = structlog.get_logger(__name__)

API_GW_URL = "http://api-gateway:4000/graphql"
OLLAMA_URL = "http://ollama:11434"

SCENARIOS = [
    {"domain": "LAND", "prompt": "Generate a brief realistic military/security land surveillance report about suspicious activity near a perimeter. Include specifics like vehicle type, number of personnel, direction of movement, and grid coordinates. Keep it under 100 words."},
    {"domain": "AIR", "prompt": "Generate a brief realistic air defense radar contact report. Include aircraft type or unknown contact, altitude, speed, heading, and threat assessment. Keep it under 100 words."},
    {"domain": "SEA", "prompt": "Generate a brief realistic maritime security report about a vessel contact. Include vessel type, flag, heading, speed in knots, and proximity to restricted waters. Keep it under 100 words."},
    {"domain": "CYBER", "prompt": "Generate a brief realistic cybersecurity incident alert. Include attack type (e.g., DDoS, phishing, ransomware, lateral movement), source IP, target system, and indicators of compromise. Keep it under 100 words."},
    {"domain": "SPACE", "prompt": "Generate a brief realistic space surveillance report. Include satellite anomaly, orbital debris tracking, or communication interference event. Keep it under 100 words."},
    {"domain": "INTELLIGENCE", "prompt": "Generate a brief realistic HUMINT or SIGINT intelligence report about a potential threat. Include source reliability rating, information credibility, and recommended action. Keep it under 100 words."},
    {"domain": "OSINT", "prompt": "Generate a brief realistic open-source intelligence report from social media or news monitoring. Include the source platform, key indicators, sentiment, and potential threat relevance. Keep it under 100 words."},
]

SEVERITY_MAP = {
    "critical": "CRITICAL",
    "high": "HIGH",
    "medium": "MEDIUM",
    "low": "LOW",
    "info": "INFORMATIONAL",
}

FALLBACK_REPORTS = [
    {"domain": "CYBER", "severity": "HIGH", "text": "IDS Alert: Possible SQL injection attempt detected from 185.220.101.x targeting /api/auth endpoint. WAF rule triggered. Source IP matches known TOR exit node."},
    {"domain": "LAND", "severity": "MEDIUM", "text": "Perimeter sensor Zone-C triggered. Thermal signature consistent with 2-3 personnel moving NE at 3km/h. No vehicle detected. Forwarding to QRF for assessment."},
    {"domain": "AIR", "severity": "LOW", "text": "Radar contact bearing 270, range 15nm, altitude 3500ft, speed 120kts. Squawking Mode-C. Correlates with scheduled civilian rotary-wing traffic."},
    {"domain": "SEA", "severity": "MEDIUM", "text": "AIS track lost for MV Pacific Horizon (IMO 9432178) at 34.05N 118.25W. Last reported heading 195 at 12kts. Vessel was transiting toward restricted anchorage."},
    {"domain": "CYBER", "severity": "CRITICAL", "text": "SIEM correlation: Multiple failed RDP attempts from 103.224.x.x followed by successful auth to DC-PRIMARY. Potential credential stuffing. Lateral movement indicators present."},
    {"domain": "INTELLIGENCE", "severity": "HIGH", "text": "SIGINT intercept B-classification: Encrypted comms burst detected on non-standard frequency 147.325MHz near facility perimeter. Duration 45s. Pattern matches known C2 protocol."},
    {"domain": "OSINT", "severity": "MEDIUM", "text": "Twitter monitoring: Multiple posts referencing facility location with aerial photography. Geotag analysis places source within 2km of north perimeter. Sentiment analysis: hostile."},
    {"domain": "SPACE", "severity": "LOW", "text": "Satellite TLE update: Object 48275 (debris) predicted closest approach 2.3km to SENTINEL-SAT-3 in 14 hours. No maneuver required. Monitoring trajectory."},
]


async def check_ollama_ready() -> bool:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{OLLAMA_URL}/api/tags")
            if resp.status_code == 200:
                models = resp.json().get("models", [])
                return any(m.get("name", "").startswith("tinyllama") for m in models)
    except Exception:
        pass
    return False


async def generate_with_ollama(prompt: str) -> str | None:
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(f"{OLLAMA_URL}/api/generate", json={
                "model": "tinyllama",
                "prompt": prompt,
                "stream": False,
                "options": {"temperature": 0.8, "num_predict": 150},
            })
            if resp.status_code == 200:
                return resp.json().get("response", "").strip()
    except Exception as e:
        logger.warning("ollama_generate_failed", error=str(e))
    return None


async def ingest_to_system(text: str, domain: str, source: str = "ollama-worker") -> bool:
    mutation = """
    mutation IngestAI($rawText: String!, $source: String!) {
        ingestAiIntelligence(rawText: $rawText, source: $source) {
            success
            message
            id
        }
    }
    """
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(API_GW_URL, json={
                "query": mutation,
                "variables": {"rawText": text, "source": source},
            })
            if resp.status_code == 200:
                data = resp.json()
                result = data.get("data", {}).get("ingestAiIntelligence", {})
                logger.info("intel_ingested",
                    success=result.get("success"),
                    message=result.get("message"),
                    id=result.get("id"),
                    domain=domain,
                )
                return result.get("success", False)
    except Exception as e:
        logger.warning("ingest_failed", error=str(e))
    return False


async def run_intel_cycle(use_ollama: bool):
    scenario = random.choice(SCENARIOS)
    domain = scenario["domain"]

    if use_ollama:
        text = await generate_with_ollama(scenario["prompt"])
        if text:
            source = "ollama-ai"
            logger.info("ollama_generated", domain=domain, length=len(text))
        else:
            fallback = random.choice([r for r in FALLBACK_REPORTS if r["domain"] == domain] or FALLBACK_REPORTS)
            text = fallback["text"]
            source = "ollama-fallback"
    else:
        fallback = random.choice([r for r in FALLBACK_REPORTS if r["domain"] == domain] or FALLBACK_REPORTS)
        text = fallback["text"]
        domain = fallback["domain"]
        source = "intel-sim"

    await ingest_to_system(f"[{domain}] {text}", domain, source)


async def intel_worker_loop():
    logger.info("intel_worker_starting")
    await asyncio.sleep(15)

    cycle = 0
    while True:
        try:
            use_ollama = await check_ollama_ready()
            if cycle == 0:
                logger.info("intel_worker_ready", ollama_available=use_ollama)

            await run_intel_cycle(use_ollama)
            cycle += 1

            interval = random.randint(20, 45)
            logger.info("intel_cycle_complete", cycle=cycle, next_in=interval, ollama=use_ollama)
            await asyncio.sleep(interval)
        except Exception as e:
            logger.error("intel_worker_error", error=str(e))
            await asyncio.sleep(30)

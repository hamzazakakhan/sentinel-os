#!/usr/bin/env python3
# ──────────────────────────────────────────────────────────────
# sentinel-os/services/ai-service/src/intelligence/pakistan_theater_feed.py
# Pakistan Theater Intelligence Feed — AI-powered SITREP generator
# Uses Ollama LLM for analysis, Kafka for pub/sub
# ──────────────────────────────────────────────────────────────

"""
Pakistan Theater Intelligence Feed

Generates structured intelligence briefs for the Pakistan/Afghanistan
theater of operations using a local Ollama LLM.

Modes:
  1. One-shot query:   python3 pakistan_theater_feed.py query "your question"
  2. Domain brief:     python3 pakistan_theater_feed.py brief [air|land|sea|cyber|all]
  3. Continuous feed:  python3 pakistan_theater_feed.py

Requirements:
  - Ollama running locally (http://localhost:11434)
  - Model pulled: ollama pull llama3.2:3b
  - Python deps: pip install aiohttp aiokafka python-dotenv

Environment variables:
  OLLAMA_URL      — Ollama API endpoint (default: http://localhost:11434)
  OLLAMA_MODEL    — Model name (default: llama3.2:3b)
  KAFKA_SERVERS   — Kafka bootstrap servers (default: localhost:9092)
  NEWSAPI_KEY     — NewsAPI.org API key (optional)
  GDELT_KEY       — GDELT API key (optional)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import aiohttp
import structlog

# ── Optional Kafka ──
try:
    from aiokafka import AIOKafkaProducer
    KAFKA_AVAILABLE = True
except ImportError:
    KAFKA_AVAILABLE = False

# ── Optional dotenv ──
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except ImportError:
    pass

logger = structlog.get_logger("sentinel.pakistan-feed")

# ── Configuration ──
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:3b")
KAFKA_SERVERS = os.getenv("KAFKA_SERVERS", "localhost:9092")
KAFKA_TOPIC = "sentinel.ai.pakistan-theater"
NEWSAPI_KEY = os.getenv("NEWSAPI_KEY", "")
GDELT_KEY = os.getenv("GDELT_KEY", "")
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "900"))  # 15 min default


# ── Data classes ──
@dataclass
class SigAct:
    """Significant Activity event."""
    timestamp: str
    type: str       # MILITARY, TERROR, CIVIL, DIPLO, CYBER, ECON
    location: str
    description: str
    source: str = "OSINT"
    reliability: str = "B-2"  # NATO source reliability code
    intel_gaps: list = field(default_factory=list)


@dataclass
class IntelligenceBrief:
    """Structured intelligence brief."""
    id: str
    classification: str
    domain: str       # AIR, LAND, SEA, CYBER, ALL
    timestamp: str
    situation: str
    key_judgments: list
    sigacts: list
    intel_gaps: list
    source_reliability: str
    raw_llm_response: str = ""


# ── Context builder ──
# Canonical Pakistan theater context document for the LLM
PAKISTAN_CONTEXT = """
## PAKISTAN THEATER — INTELLIGENCE CONTEXT DOCUMENT

### GEOGRAPHIC OVERVIEW
Pakistan occupies 881,913 km², bordered by India (east), Iran/Afghanistan (west),
China (north), Arabian Sea (south). Key terrain: Karakoram/Hindu Kush mountains,
Indus River valley, Thar Desert, Makran Coast.

### STRATEGIC INFRASTRUCTURE
- Nuclear facilities: Kahuta, Khushab (plutonium), Chashma (civilian)
- Air bases: PAF Base Mushaf (Sargodha), PAF Base Rafiqui (Shorkot),
  PAF Base Masroor (Karachi), PAF Base Minhas (Kamra), PAF Base Peshawar
- Naval bases: Karachi (PNHQ), Ormara (Jinnah Naval Base), Gwadar
- CPEC corridor: Gwadar Port, Karakoram Highway, ML-1 railway upgrade
- Border posts: Torkham, Chaman, Spin Boldak (Afghan border)

### ACTIVE CONFLICT ZONES
1. **Durand Line**: Pakistan-Afghanistan border — TTP cross-border operations,
   Taliban relations, refugee movements
2. **Balochistan**: BLA/BLF insurgency, CPEC security, Gwadar port disputes
3. **Kashmir (LoC)**: India-Pakistan ceasefire since 2021, sporadic exchanges
4. **Former FATA**: Merged into KPK, ongoing clearance operations vs TTP/Khorasan
5. **Karachi**: Urban militancy, gang violence, political turf wars

### KEY ACTORS
- **Pakistan Army**: 12 corps, ~650K active. COAS leads.
- **ISI**: Directorate S (external), Directorate A (internal)
- **TTP**: Tehrik-e-Taliban Pakistan — ~3-5K fighters, Noor Wali Mehsud
- **BLA**: Baloch Liberation Army — CPEC targeting, urban ops
- **ETIM/TIP**: Turkistan Islamic Party — Xinjiang-linked, Syria/Afghan presence
- **IS-K (ISIS-K)**: Islamic State Khorasan — Nangarhar/Kunar, anti-state

### MILITARY ORDER OF BATTLE (UNCLASS/OSINT)
- Army: 2nd Corps (Multan), 4th Corps (Lahore), 5th Corps (Karachi),
  10th Corps (Rawalpindi), 11th Corps (Peshawar), 12th Corps (Quetta),
  30th Corps (Gujranwala), 31st Corps (Bahawalpur)
- Air Force: F-16C/D, JF-17 Thunder, Mirage III/5, J-10CE
- Navy: Agosta-90B submarines, F-22P frigates, Z-9EC helicopters

### DIPLOMATIC STATUS
- US-Pakistan: FMF reduced, CAATSA concerns, counterterror cooperation
- China-Pakistan: "All-weather" strategic partnership, CPEC $62B
- India-Pakistan: LoC ceasefire Feb 2021, Kashmir dispute frozen
- Afghanistan: Taliban recognition pending, TTP safe haven issue
- GCC: Labor exports, defense cooperation (Saudi, UAE)

### CYBER THREAT LANDSCAPE
- APT groups: APT36 (ProjectM), SideWinder, Rattlesnake
- State-sponsored: India-linked, China-linked targeting CPEC
- Hacktivist: Indian Cyber Troops, Hacktivist Syndicate
- Ransomware: LockBit, BlackCat targeting Pakistani infrastructure
"""

# ── Sample SIGACTs (for demo — in production, ingested from OSINT feeds) ──
SAMPLE_SIGACTS = [
    SigAct("2026-04-27T08:30:00Z", "MILITARY", "Torkham Border",
           "Pakistan Army 11th Corps reinforced border checkpoint following cross-border TTP movement. 3 militants killed in clash.", "ISPR", "A-1"),
    SigAct("2026-04-27T10:15:00Z", "TERROR", "Quetta, Balochistan",
           "BLA claimed responsibility for IED attack on CPEC convoy near Surab. 2 FC personnel injured.", "GDELT", "B-2"),
    SigAct("2026-04-27T12:00:00Z", "DIPLO", "Islamabad",
           "Chinese FM held talks with Pakistani counterpart on CPEC Phase-2 acceleration and Gwadar security.", "Reuters", "A-2"),
    SigAct("2026-04-27T14:30:00Z", "CYBER", "Karachi",
           "APT36 (ProjectM) phishing campaign targeting Pakistani government email accounts detected.", "AlienVault OTX", "B-3"),
    SigAct("2026-04-27T16:45:00Z", "MILITARY", "Arabian Sea",
           "PN PNS Zulfiquar (F-22P) conducted ASW exercise with Chinese PLAN destroyer in Arabian Sea.", "OSINT", "C-3"),
    SigAct("2026-04-28T06:00:00Z", "CIVIL", "Peshawar",
           "Refugee camp expansion at Jalozai — 5,000 new arrivals from Nangarhar province.", "UNHCR", "B-2"),
    SigAct("2026-04-28T09:30:00Z", "ECON", "Gwadar Port",
           "CPEC cargo throughput reached 2.1M tons Q1 2026, up 34% YoY.", "Gwadar Port Authority", "A-2"),
]


def build_context_document(sigacts: list[SigAct] = None) -> str:
    """Build the full context document for the LLM, including latest SIGACTs."""
    doc = PAKISTAN_CONTEXT

    if sigacts is None:
        sigacts = SAMPLE_SIGACTS

    doc += "\n### CURRENT SIGACTS (SIGNIFICANT ACTIVITIES)\n"
    for sa in sigacts:
        doc += f"- [{sa.timestamp}] {sa.type} | {sa.location}: {sa.description} (Source: {sa.source}, Rel: {sa.reliability})\n"
        if sa.intel_gaps:
            for gap in sa.intel_gaps:
                doc += f"  [INTEL GAP] {gap}\n"

    return doc


# ── Ollama LLM interface ──
async def call_ollama(prompt: str, context: str = "", timeout: int = 120) -> str:
    """Call Ollama API for text generation."""
    full_prompt = f"{context}\n\n---\n\n{prompt}" if context else prompt

    payload = {
        "model": OLLAMA_MODEL,
        "prompt": full_prompt,
        "stream": False,
        "options": {
            "temperature": 0.3,
            "num_predict": 2048,
        },
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{OLLAMA_URL}/api/generate",
                json=payload,
                timeout=aiohttp.ClientTimeout(total=timeout),
            ) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    logger.error("ollama_error", status=resp.status, body=text[:200])
                    return f"[ERROR] Ollama returned {resp.status}"

                data = await resp.json()
                return data.get("response", "[ERROR] No response field")

    except aiohttp.ClientConnectorError:
        return "[ERROR] Cannot connect to Ollama — is it running? Try: ollama serve"
    except asyncio.TimeoutError:
        return "[ERROR] Ollama request timed out — try a smaller model or increase timeout"
    except Exception as e:
        return f"[ERROR] Ollama call failed: {e}"


# ── Brief generators ──
DOMAIN_PROMPTS = {
    "air": """Generate a NATO-format AIR SITREP (Situation Report) for the Pakistan theater.
Focus on: PAF operations, airspace violations, drone activity, air defense, aviation incidents.
Use STANAG reporting format. Include SOURCE RELIABILITY and INTEL GAPS.""",

    "land": """Generate a NATO-format LAND SITREP for the Pakistan theater.
Focus on: ground operations, border clashes, insurgency, TTP/BLA activity, FATA clearance ops.
Use STANAG reporting format. Include SOURCE RELIABILITY and INTEL GAPS.""",

    "sea": """Generate a NATO-format MARITIME SITREP for the Pakistan theater.
Focus on: PN operations, Arabian Sea activity, Gwadar/CPEC maritime security, smuggling, piracy threats.
Use STANAG reporting format. Include SOURCE RELIABILITY and INTEL GAPS.""",

    "cyber": """Generate a CYBER THREAT SITREP for the Pakistan theater.
Focus on: APT campaigns, CPEC cyber espionage, critical infrastructure attacks, hacktivism, ransomware.
Include MITRE ATT&CK TTPs where applicable. Include SOURCE RELIABILITY and INTEL GAPS.""",

    "all": """Generate a comprehensive JOINT SITREP covering all domains (AIR, LAND, SEA, CYBER)
for the Pakistan theater. Use NATO/STANAG reporting format.
Include: 1. SITUATION 2. KEY JUDGMENTS 3. SIGACTS 4. INTEL GAPS 5. SOURCE RELIABILITY""",
}


async def generate_brief(domain: str = "all", sigacts: list[SigAct] = None) -> IntelligenceBrief:
    """Generate an intelligence brief for the specified domain."""
    context = build_context_document(sigacts)
    prompt = DOMAIN_PROMPTS.get(domain, DOMAIN_PROMPTS["all"])

    logger.info("generating_brief", domain=domain, model=OLLAMA_MODEL)
    response = await call_ollama(prompt, context)

    brief = IntelligenceBrief(
        id=str(uuid.uuid4())[:8],
        classification="UNCLASS//FOR OFFICIAL USE ONLY",
        domain=domain.upper(),
        timestamp=datetime.now(timezone.utc).isoformat(),
        situation=response[:500],
        key_judgments=[],
        sigacts=[asdict(sa) for sa in (sigacts or SAMPLE_SIGACTS)],
        intel_gaps=[],
        source_reliability="B-2",
        raw_llm_response=response,
    )

    logger.info("brief_generated", id=brief.id, domain=domain, chars=len(response))
    return brief


async def answer_query(question: str) -> str:
    """Answer a one-shot intelligence query."""
    context = build_context_document()
    prompt = f"""You are a military intelligence analyst for the Pakistan/Afghanistan theater.
Answer the following question using the provided context. Use STANAG format where appropriate.
Cite sources and note INTEL GAPS.

QUESTION: {question}"""

    logger.info("answering_query", question=question[:80])
    return await call_ollama(prompt, context)


# ── Kafka publisher ──
async def publish_to_kafka(brief: IntelligenceBrief) -> bool:
    """Publish an intelligence brief to Kafka."""
    if not KAFKA_AVAILABLE:
        logger.warn("kafka_unavailable", msg="Install aiokafka for Kafka integration")
        return False

    try:
        producer = AIOKafkaProducer(bootstrap_servers=KAFKA_SERVERS)
        await producer.start()

        value = json.dumps(asdict(brief), default=str).encode("utf-8")
        await producer.send_and_wait(KAFKA_TOPIC, value=value)
        await producer.stop()

        logger.info("kafka_published", topic=KAFKA_TOPIC, brief_id=brief.id)
        return True
    except Exception as e:
        logger.warn("kafka_publish_failed", error=str(e))
        return False


# ── OSINT data fetchers (lightweight — no external deps required) ──
async def fetch_gdelt_events(query: str = "Pakistan", max_records: int = 25) -> list[dict]:
    """Fetch recent GDELT events for the Pakistan theater."""
    try:
        url = "https://api.gdeltproject.org/api/v2/doc/doc"
        params = {
            "query": f'"{query}" sourcelang:english',
            "mode": "ArtList",
            "maxrecords": max_records,
            "format": "json",
            "timespan": "7d",
        }
        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return data.get("articles", [])
    except Exception as e:
        logger.warn("gdelt_fetch_failed", error=str(e))
    return []


async def fetch_newsapi(query: str = "Pakistan military") -> list[dict]:
    """Fetch recent news via NewsAPI."""
    if not NEWSAPI_KEY:
        return []
    try:
        url = "https://newsapi.org/v2/everything"
        params = {
            "q": query,
            "apiKey": NEWSAPI_KEY,
            "sortBy": "publishedAt",
            "pageSize": 20,
            "language": "en",
        }
        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return data.get("articles", [])
    except Exception as e:
        logger.warn("newsapi_fetch_failed", error=str(e))
    return []


# ── Continuous feed mode ──
async def run_continuous():
    """Run the intelligence feed in continuous mode."""
    logger.info("continuous_mode_starting", interval=POLL_INTERVAL, model=OLLAMA_MODEL)

    # Check Ollama connectivity
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(OLLAMA_URL, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                if resp.status != 200:
                    logger.error("ollama_unreachable", url=OLLAMA_URL)
                    return
    except Exception:
        logger.error("ollama_unreachable", url=OLLAMA_URL, hint="Run: ollama serve")
        return

    logger.info("ollama_connected", url=OLLAMA_URL, model=OLLAMA_MODEL)

    # Start Kafka producer if available
    kafka_producer = None
    if KAFKA_AVAILABLE:
        try:
            kafka_producer = AIOKafkaProducer(bootstrap_servers=KAFKA_SERVERS)
            await kafka_producer.start()
            logger.info("kafka_producer_started", servers=KAFKA_SERVERS, topic=KAFKA_TOPIC)
        except Exception as e:
            logger.warn("kafka_producer_failed", error=str(e), hint="Kafka optional — feed will still generate briefs")
            kafka_producer = None

    try:
        while True:
            cycle_start = datetime.now(timezone.utc)
            logger.info("refresh_cycle_start", time=cycle_start.isoformat())

            # Fetch OSINT data
            gdelt_articles = await fetch_gdelt_events()
            news_articles = await fetch_newsapi()
            logger.info("osint_fetched", gdelt=len(gdelt_articles), newsapi=len(news_articles))

            # Generate briefs for each domain
            for domain in ["air", "land", "sea", "cyber"]:
                brief = await generate_brief(domain)

                # Print to stdout
                print(f"\n{'='*70}")
                print(f"  SENTINEL PAKISTAN FEED — {brief.domain} SITREP")
                print(f"  ID: {brief.id} | {brief.timestamp}")
                print(f"  Classification: {brief.classification}")
                print(f"{'='*70}")
                print(brief.raw_llm_response)
                print(f"{'='*70}\n")

                # Publish to Kafka
                if kafka_producer:
                    try:
                        value = json.dumps(asdict(brief), default=str).encode("utf-8")
                        await kafka_producer.send_and_wait(KAFKA_TOPIC, value=value)
                        logger.info("kafka_published", domain=domain, brief_id=brief.id)
                    except Exception as e:
                        logger.warn("kafka_publish_error", domain=domain, error=str(e))

            # Wait for next cycle
            elapsed = (datetime.now(timezone.utc) - cycle_start).total_seconds()
            wait = max(0, POLL_INTERVAL - elapsed)
            logger.info("cycle_complete", elapsed=elapsed, next_in=wait)
            await asyncio.sleep(wait)

    except asyncio.CancelledError:
        logger.info("feed_cancelled")
    finally:
        if kafka_producer:
            await kafka_producer.stop()
            logger.info("kafka_producer_stopped")


# ── CLI ──
def main():
    parser = argparse.ArgumentParser(
        description="Sentinel Pakistan Theater Intelligence Feed",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Modes:
  query "question"   One-shot intelligence query
  brief [domain]     Generate domain brief (air|land|sea|cyber|all)
  (no args)          Run continuous feed mode

Examples:
  python3 pakistan_theater_feed.py query "What is the current TTP threat level?"
  python3 pakistan_theater_feed.py brief air
  python3 pakistan_theater_feed.py brief all
  python3 pakistan_theater_feed.py
        """,
    )

    subparsers = parser.add_subparsers(dest="command")

    # Query mode
    query_parser = subparsers.add_parser("query", help="One-shot intelligence query")
    query_parser.add_argument("question", help="Your intelligence question")

    # Brief mode
    brief_parser = subparsers.add_parser("brief", help="Generate domain intelligence brief")
    brief_parser.add_argument("domain", nargs="?", default="all",
                              choices=["air", "land", "sea", "cyber", "all"],
                              help="Domain to brief (default: all)")

    args = parser.parse_args()

    if args.command == "query":
        result = asyncio.run(answer_query(args.question))
        print(f"\n{'='*70}")
        print(f"  SENTINEL PAKISTAN FEED — QUERY RESPONSE")
        print(f"{'='*70}")
        print(result)
        print(f"{'='*70}")

    elif args.command == "brief":
        brief = asyncio.run(generate_brief(args.domain))
        print(f"\n{'='*70}")
        print(f"  SENTINEL PAKISTAN FEED — {brief.domain} SITREP")
        print(f"  ID: {brief.id} | {brief.timestamp}")
        print(f"  Classification: {brief.classification}")
        print(f"{'='*70}")
        print(brief.raw_llm_response)
        print(f"{'='*70}")

        # Optionally publish to Kafka
        if KAFKA_AVAILABLE:
            published = asyncio.run(publish_to_kafka(brief))
            if published:
                print(f"  [Published to Kafka topic: {KAFKA_TOPIC}]")

    else:
        # Continuous mode
        asyncio.run(run_continuous())


if __name__ == "__main__":
    main()

from __future__ import annotations

import asyncio
import io
import json
import pickle
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import numpy as np
import structlog
import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.config import get_settings

logger = structlog.get_logger(__name__)
settings = get_settings()

# ── Global model holders ──────────────────────────────────────
_yolo_model = None
_anomaly_model = None
_lstm_model = None
_ollama_available = False
_intel_worker_task = None
_intel_worker_status = {"running": False, "cycles": 0, "last_ingest": None}


# ── Pydantic models ──────────────────────────────────────────

class DetectionResult(BaseModel):
    label: str
    confidence: float
    bbox: list[float] | None = None
    track_id: int | None = None

class DetectionResponse(BaseModel):
    detections: list[DetectionResult]
    inference_ms: float
    model: str

class AnomalyRequest(BaseModel):
    features: list[list[float]]
    sensor_id: str | None = None

class AnomalyResult(BaseModel):
    is_anomaly: bool
    score: float
    index: int

class AnomalyResponse(BaseModel):
    results: list[AnomalyResult]
    model: str

class PredictionRequest(BaseModel):
    series: list[float]
    horizon: int = 12
    sensor_id: str | None = None

class PredictionResponse(BaseModel):
    predictions: list[float]
    confidence_lower: list[float]
    confidence_upper: list[float]
    model: str

class LLMRequest(BaseModel):
    prompt: str
    system_prompt: str | None = "You are a military intelligence analyst assistant. Provide concise, actionable analysis."
    max_tokens: int = 1024
    temperature: float = 0.3

class LLMResponse(BaseModel):
    response: str
    model: str
    tokens_used: int
    latency_ms: float

class ThreatClassifyRequest(BaseModel):
    text: str
    context: dict[str, Any] | None = None

class ThreatClassifyResponse(BaseModel):
    severity: str
    category: str
    domain: str = "INTELLIGENCE"
    confidence: float
    reasoning: str
    indicators: list[str]

class SummarizeRequest(BaseModel):
    documents: list[str]
    focus: str | None = None

class SummarizeResponse(BaseModel):
    summary: str
    key_points: list[str]
    entities: list[str]

class NLQueryRequest(BaseModel):
    question: str
    domain: str | None = None

class NLQueryResponse(BaseModel):
    answer: str
    sources: list[str]
    confidence: float


# ── Model loading ─────────────────────────────────────────────

def load_yolo():
    global _yolo_model
    try:
        from ultralytics import YOLO
        model_path = settings.yolo_model_path
        _yolo_model = YOLO(model_path)
        logger.info("yolo_loaded", model=model_path)
    except Exception as e:
        logger.warning("yolo_load_failed", error=str(e))


def load_anomaly_detector():
    global _anomaly_model
    model_path = Path(settings.anomaly_model_path)
    if model_path.exists():
        with open(model_path, "rb") as f:
            _anomaly_model = pickle.load(f)
        logger.info("anomaly_model_loaded", path=str(model_path))
    else:
        from sklearn.ensemble import IsolationForest
        _anomaly_model = IsolationForest(
            n_estimators=200, contamination=0.05, random_state=42, n_jobs=-1
        )
        logger.info("anomaly_model_created_default")


def load_lstm():
    global _lstm_model
    model_path = Path(settings.lstm_model_path)
    if model_path.exists():
        try:
            import torch
            _lstm_model = torch.load(model_path, map_location=settings.device)
            _lstm_model.eval()
            logger.info("lstm_loaded", path=str(model_path))
        except Exception as e:
            logger.warning("lstm_load_failed", error=str(e))
    else:
        logger.info("lstm_model_not_found_using_fallback")


async def check_ollama():
    global _ollama_available
    try:
        import httpx
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{settings.ollama_host}/api/tags")
            if resp.status_code == 200:
                _ollama_available = True
                models = [m["name"] for m in resp.json().get("models", [])]
                logger.info("ollama_connected", models=models)
            else:
                logger.warning("ollama_not_responding")
    except Exception as e:
        logger.warning("ollama_unavailable", error=str(e))


# ── Lifespan ──────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _intel_worker_task
    logger.info("ai_service_starting")
    load_yolo()
    load_anomaly_detector()
    load_lstm()
    await check_ollama()
    from app.intel_worker import intel_worker_loop
    _intel_worker_task = asyncio.create_task(intel_worker_loop())
    _intel_worker_status["running"] = True
    yield
    if _intel_worker_task:
        _intel_worker_task.cancel()
    logger.info("ai_service_stopping")


app = FastAPI(title="Sentinel OS AI Service", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ── Health ────────────────────────────────────────────────────

@app.get("/healthz")
async def health():
    return {
        "status": "healthy",
        "service": "ai-service",
        "models": {
            "yolo": _yolo_model is not None,
            "anomaly": _anomaly_model is not None,
            "lstm": _lstm_model is not None,
            "ollama": _ollama_available,
        },
        "intel_worker": _intel_worker_status,
    }


# ── YOLOv8 Object Detection ──────────────────────────────────

@app.post("/api/v1/detect", response_model=DetectionResponse)
async def detect_objects(file: UploadFile = File(...)):
    if _yolo_model is None:
        raise HTTPException(503, "YOLO model not loaded")

    from PIL import Image
    start = time.perf_counter()
    image_data = await file.read()
    image = Image.open(io.BytesIO(image_data))

    results = _yolo_model(image, conf=0.25, verbose=False)
    detections = []
    for r in results:
        for box in r.boxes:
            detections.append(DetectionResult(
                label=r.names[int(box.cls[0])],
                confidence=float(box.conf[0]),
                bbox=[float(x) for x in box.xyxy[0].tolist()],
                track_id=int(box.id[0]) if box.id is not None else None,
            ))

    elapsed = (time.perf_counter() - start) * 1000
    return DetectionResponse(detections=detections, inference_ms=elapsed, model=settings.yolo_model_path)


@app.post("/api/v1/detect/batch", response_model=list[DetectionResponse])
async def detect_batch(files: list[UploadFile] = File(...)):
    results = []
    for f in files:
        r = await detect_objects(f)
        results.append(r)
    return results


# ── Isolation Forest Anomaly Detection ────────────────────────

@app.post("/api/v1/anomaly/detect", response_model=AnomalyResponse)
async def detect_anomalies(request: AnomalyRequest):
    if _anomaly_model is None:
        raise HTTPException(503, "Anomaly model not loaded")

    features = np.array(request.features)
    if hasattr(_anomaly_model, "predict"):
        predictions = _anomaly_model.predict(features)
        scores = _anomaly_model.decision_function(features)
    else:
        from sklearn.ensemble import IsolationForest
        model = IsolationForest(n_estimators=200, contamination=0.05, random_state=42)
        model.fit(features)
        predictions = model.predict(features)
        scores = model.decision_function(features)

    results = [
        AnomalyResult(is_anomaly=bool(p == -1), score=float(s), index=i)
        for i, (p, s) in enumerate(zip(predictions, scores))
    ]
    return AnomalyResponse(results=results, model="isolation_forest")


@app.post("/api/v1/anomaly/train")
async def train_anomaly(request: AnomalyRequest):
    global _anomaly_model
    from sklearn.ensemble import IsolationForest
    features = np.array(request.features)
    _anomaly_model = IsolationForest(n_estimators=200, contamination=0.05, random_state=42, n_jobs=-1)
    _anomaly_model.fit(features)
    model_path = Path(settings.anomaly_model_path)
    model_path.parent.mkdir(parents=True, exist_ok=True)
    with open(model_path, "wb") as f:
        pickle.dump(_anomaly_model, f)
    return {"status": "trained", "samples": len(features), "path": str(model_path)}


# ── LSTM Time-Series Prediction ───────────────────────────────

@app.post("/api/v1/predict", response_model=PredictionResponse)
async def predict_timeseries(request: PredictionRequest):
    series = np.array(request.series)
    horizon = request.horizon

    if _lstm_model is not None:
        try:
            import torch
            with torch.no_grad():
                tensor = torch.FloatTensor(series).unsqueeze(0).unsqueeze(-1).to(settings.device)
                preds = _lstm_model(tensor).cpu().numpy().flatten()[:horizon]
                std = np.std(series[-20:]) if len(series) >= 20 else np.std(series)
                return PredictionResponse(
                    predictions=preds.tolist(),
                    confidence_lower=(preds - 1.96 * std).tolist(),
                    confidence_upper=(preds + 1.96 * std).tolist(),
                    model="lstm",
                )
        except Exception as e:
            logger.warning("lstm_predict_failed", error=str(e))

    # Fallback: simple exponential smoothing
    alpha = 0.3
    level = series[-1]
    preds = []
    for _ in range(horizon):
        level = alpha * series[-1] + (1 - alpha) * level
        preds.append(float(level))
    std = float(np.std(series[-20:]) if len(series) >= 20 else np.std(series))
    return PredictionResponse(
        predictions=preds,
        confidence_lower=[p - 1.96 * std for p in preds],
        confidence_upper=[p + 1.96 * std for p in preds],
        model="exponential_smoothing_fallback",
    )


# ── Ollama LLM Integration ───────────────────────────────────

async def _ollama_generate(prompt: str, system: str | None = None, max_tokens: int = 1024, temp: float = 0.3) -> dict:
    import httpx
    payload = {
        "model": settings.ollama_model,
        "prompt": prompt,
        "stream": False,
        "options": {"num_predict": max_tokens, "temperature": temp},
    }
    if system:
        payload["system"] = system

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(f"{settings.ollama_host}/api/generate", json=payload)
        resp.raise_for_status()
        return resp.json()


@app.post("/api/v1/llm/generate", response_model=LLMResponse)
async def llm_generate(request: LLMRequest):
    if not _ollama_available:
        raise HTTPException(503, "Ollama not available")

    start = time.perf_counter()
    result = await _ollama_generate(request.prompt, request.system_prompt, request.max_tokens, request.temperature)
    elapsed = (time.perf_counter() - start) * 1000

    return LLMResponse(
        response=result.get("response", ""),
        model=settings.ollama_model,
        tokens_used=result.get("eval_count", 0),
        latency_ms=elapsed,
    )


@app.post("/api/v1/llm/classify-threat", response_model=ThreatClassifyResponse)
async def classify_threat(request: ThreatClassifyRequest):
    def _detect_domain(text: str) -> str:
        t = text.lower()
        if any(w in t for w in ["ip", "port", "sql", "injection", "malware", "phishing", "rdp", "ssh", "firewall", "ids", "siem", "ransomware", "c2", "lateral", "exfil", "dns", "http", "endpoint"]):
            return "CYBER"
        if any(w in t for w in ["vessel", "ship", "maritime", "nautical", "ais", "knots", "anchorage", "port authority"]):
            return "SEA"
        if any(w in t for w in ["aircraft", "radar", "altitude", "airspace", "drone", "uav", "heading", "flight", "aerial"]):
            return "AIR"
        if any(w in t for w in ["satellite", "orbit", "debris", "tle", "space"]):
            return "SPACE"
        if any(w in t for w in ["twitter", "social media", "news", "osint", "blog", "forum", "telegram"]):
            return "OSINT"
        if any(w in t for w in ["perimeter", "vehicle", "personnel", "checkpoint", "fence", "zone", "patrol", "thermal", "camera", "intrusion"]):
            return "LAND"
        return "INTELLIGENCE"

    if not _ollama_available:
        text_lower = request.text.lower()
        severity = "MEDIUM"
        if any(w in text_lower for w in ["critical", "exploit", "zero-day", "ransomware", "c2", "exfil"]):
            severity = "CRITICAL"
        elif any(w in text_lower for w in ["brute", "injection", "malware", "backdoor"]):
            severity = "HIGH"
        elif any(w in text_lower for w in ["scan", "recon", "probe"]):
            severity = "LOW"
        domain = _detect_domain(request.text)
        return ThreatClassifyResponse(
            severity=severity, category="UNKNOWN", domain=domain, confidence=0.4,
            reasoning="Keyword-based fallback (Ollama unavailable)", indicators=[],
        )

    prompt = f"""Analyze this security event and classify it. Return JSON only:
{{
  "severity": "CRITICAL|HIGH|MEDIUM|LOW|INFORMATIONAL",
  "category": "category name",
  "domain": "LAND|AIR|SEA|CYBER|SPACE|INTELLIGENCE|OSINT",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation",
  "indicators": ["list", "of", "IOCs"]
}}

Event: {request.text}
Context: {json.dumps(request.context or {})}"""

    result = await _ollama_generate(prompt, "You are a cyber threat analyst. Respond with valid JSON only.", 512, 0.1)
    try:
        parsed = json.loads(result.get("response", "{}"))
        return ThreatClassifyResponse(**parsed)
    except Exception:
        return ThreatClassifyResponse(
            severity="MEDIUM", category="PARSE_ERROR", confidence=0.3,
            reasoning=result.get("response", "Failed to parse"), indicators=[],
        )


@app.post("/api/v1/llm/summarize", response_model=SummarizeResponse)
async def summarize_intel(request: SummarizeRequest):
    if not _ollama_available:
        return SummarizeResponse(
            summary="Ollama unavailable — cannot generate summary",
            key_points=[], entities=[],
        )

    docs_text = "\n---\n".join(request.documents[:10])
    focus = f"\nFocus area: {request.focus}" if request.focus else ""
    prompt = f"""Summarize these intelligence documents. Return JSON:
{{
  "summary": "concise summary",
  "key_points": ["point1", "point2"],
  "entities": ["entity1", "entity2"]
}}
{focus}

Documents:
{docs_text}"""

    result = await _ollama_generate(prompt, "You are a military intelligence summarizer. Respond with valid JSON only.", 1024, 0.2)
    try:
        parsed = json.loads(result.get("response", "{}"))
        return SummarizeResponse(**parsed)
    except Exception:
        return SummarizeResponse(
            summary=result.get("response", ""), key_points=[], entities=[],
        )


@app.post("/api/v1/llm/query", response_model=NLQueryResponse)
async def natural_language_query(request: NLQueryRequest):
    if not _ollama_available:
        return NLQueryResponse(answer="Ollama unavailable", sources=[], confidence=0.0)

    prompt = f"""Answer this intelligence query. Return JSON:
{{
  "answer": "your answer",
  "sources": ["source1"],
  "confidence": 0.0-1.0
}}

Domain: {request.domain or "all"}
Question: {request.question}"""

    result = await _ollama_generate(prompt, "You are a defense intelligence query system. Respond with valid JSON only.", 1024, 0.3)
    try:
        parsed = json.loads(result.get("response", "{}"))
        return NLQueryResponse(**parsed)
    except Exception:
        return NLQueryResponse(answer=result.get("response", ""), sources=[], confidence=0.3)


# ── Entrypoint ────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=settings.debug)

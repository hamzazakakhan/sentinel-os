from __future__ import annotations

import time
from contextlib import asynccontextmanager

import structlog
import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST
from strawberry.fastapi import GraphQLRouter

from app.config import get_settings
from app.db.postgres import close_db, init_db
from app.db.mongo import close_mongo, init_mongo
from app.db.neo4j_driver import close_neo4j, init_neo4j
from app.db.redis_cache import close_redis, init_redis
from app.graphql.schema import schema

logger = structlog.get_logger(__name__)

REQUEST_COUNT = Counter("http_requests_total", "Total HTTP requests", ["method", "path", "status"])
REQUEST_LATENCY = Histogram("http_request_duration_seconds", "Request latency", ["method", "path"])

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("starting_sentinel_api_gateway", version=settings.version, env=settings.environment.value)

    # Init databases — graceful if unavailable
    for name, init_fn in [
        ("PostgreSQL", init_db),
        ("Redis", init_redis),
        ("MongoDB", init_mongo),
        ("Neo4j", init_neo4j),
    ]:
        try:
            await init_fn()
            logger.info(f"{name.lower()}_connected")
        except Exception as e:
            logger.warning(f"{name.lower()}_unavailable", error=str(e))

    yield

    logger.info("shutting_down")
    await close_db()
    await close_redis()
    await close_mongo()
    await close_neo4j()


app = FastAPI(
    title=settings.app_name,
    version=settings.version,
    docs_url="/docs" if settings.environment != "production" else None,
    redoc_url="/redoc" if settings.environment != "production" else None,
    lifespan=lifespan,
)

# ── Middleware ────────────────────────────────────────────────

app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def metrics_middleware(request: Request, call_next):
    start = time.perf_counter()
    response: Response = await call_next(request)
    duration = time.perf_counter() - start
    path = request.url.path
    REQUEST_COUNT.labels(method=request.method, path=path, status=response.status_code).inc()
    REQUEST_LATENCY.labels(method=request.method, path=path).observe(duration)
    response.headers["X-Process-Time"] = f"{duration:.4f}"
    return response


# ── GraphQL ───────────────────────────────────────────────────

graphql_router = GraphQLRouter(schema, path="/graphql")
app.include_router(graphql_router)


# ── REST endpoints ────────────────────────────────────────────

@app.get("/healthz")
async def health():
    return {
        "status": "healthy",
        "service": "api-gateway",
        "version": settings.version,
    }


@app.get("/readyz")
async def readiness():
    checks = {}
    from app.db.redis_cache import get_redis
    try:
        await get_redis().ping()
        checks["redis"] = "ok"
    except Exception:
        checks["redis"] = "unavailable"

    from app.db.postgres import get_engine
    try:
        async with get_engine().connect() as conn:
            await conn.execute(select_text("SELECT 1"))
        checks["postgres"] = "ok"
    except Exception:
        checks["postgres"] = "unavailable"

    all_ok = all(v == "ok" for v in checks.values())
    return {"status": "ready" if all_ok else "degraded", "checks": checks}


@app.get("/metrics")
async def metrics():
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


def select_text(sql: str):
    from sqlalchemy import text
    return text(sql)


# ── Entrypoint ────────────────────────────────────────────────

def start():
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.environment == "development",
        log_level=settings.log_level.lower(),
        access_log=settings.debug,
        workers=1 if settings.environment == "development" else 4,
    )


if __name__ == "__main__":
    start()

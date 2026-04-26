from __future__ import annotations

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.config import get_settings

_client: AsyncIOMotorClient | None = None
_db: AsyncIOMotorDatabase | None = None


def get_mongo_db() -> AsyncIOMotorDatabase:
    global _client, _db
    if _db is None:
        settings = get_settings()
        _client = AsyncIOMotorClient(
            settings.mongo_uri,
            maxPoolSize=50,
            minPoolSize=5,
            serverSelectionTimeoutMS=5000,
            connectTimeoutMS=5000,
            retryWrites=True,
            appname="sentinel-api-gateway",
        )
        _db = _client[settings.mongo_database]
    return _db


async def init_mongo() -> None:
    db = get_mongo_db()
    await db.command("ping")

    await db.raw_detections.create_index([("timestamp", -1)])
    await db.raw_detections.create_index([("sensor_id", 1), ("timestamp", -1)])
    await db.raw_detections.create_index([("domain", 1)])

    await db.sensor_telemetry.create_index([("sensor_id", 1), ("timestamp", -1)])
    await db.sensor_telemetry.create_index(
        [("timestamp", 1)], expireAfterSeconds=86400 * 30
    )

    await db.osint_raw.create_index([("collected_at", -1)])
    await db.osint_raw.create_index([("source_type", 1)])
    await db.osint_raw.create_index([("hash", 1)], unique=True, sparse=True)

    await db.audit_log.create_index([("timestamp", -1)])
    await db.audit_log.create_index([("user_id", 1), ("timestamp", -1)])
    await db.audit_log.create_index([("action", 1)])


async def close_mongo() -> None:
    global _client, _db
    if _client:
        _client.close()
        _client = None
        _db = None

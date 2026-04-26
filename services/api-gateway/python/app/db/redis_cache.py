from __future__ import annotations

import json
from typing import Any

import redis.asyncio as redis

from app.config import get_settings

_pool: redis.ConnectionPool | None = None
_client: redis.Redis | None = None


def get_redis() -> redis.Redis:
    global _pool, _client
    if _client is None:
        settings = get_settings()
        _pool = redis.ConnectionPool.from_url(
            settings.redis_url,
            max_connections=50,
            decode_responses=True,
            socket_connect_timeout=5,
            socket_keepalive=True,
            retry_on_timeout=True,
        )
        _client = redis.Redis(connection_pool=_pool)
    return _client


async def cache_get(key: str) -> Any | None:
    client = get_redis()
    raw = await client.get(key)
    if raw is None:
        return None
    return json.loads(raw)


async def cache_set(key: str, value: Any, ttl: int = 300) -> None:
    client = get_redis()
    await client.setex(key, ttl, json.dumps(value, default=str))


async def cache_delete(key: str) -> None:
    client = get_redis()
    await client.delete(key)


async def cache_invalidate_pattern(pattern: str) -> None:
    client = get_redis()
    cursor = 0
    while True:
        cursor, keys = await client.scan(cursor=cursor, match=pattern, count=100)
        if keys:
            await client.delete(*keys)
        if cursor == 0:
            break


async def init_redis() -> None:
    client = get_redis()
    await client.ping()


async def close_redis() -> None:
    global _pool, _client
    if _client:
        await _client.aclose()
        _client = None
    if _pool:
        await _pool.aclose()
        _pool = None

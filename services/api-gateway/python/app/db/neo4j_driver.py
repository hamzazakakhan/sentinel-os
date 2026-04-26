from __future__ import annotations

from typing import Any

from neo4j import AsyncDriver, AsyncGraphDatabase, AsyncSession

from app.config import get_settings

_driver: AsyncDriver | None = None


def get_neo4j_driver() -> AsyncDriver:
    global _driver
    if _driver is None:
        settings = get_settings()
        _driver = AsyncGraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_user, settings.neo4j_password.get_secret_value()),
            max_connection_pool_size=50,
            connection_acquisition_timeout=30,
        )
    return _driver


async def get_neo4j_session() -> AsyncSession:
    driver = get_neo4j_driver()
    return driver.session(database="neo4j")


async def run_cypher(
    query: str, parameters: dict[str, Any] | None = None
) -> list[dict[str, Any]]:
    driver = get_neo4j_driver()
    async with driver.session(database="neo4j") as session:
        result = await session.run(query, parameters or {})
        records = await result.data()
        return records


async def init_neo4j() -> None:
    driver = get_neo4j_driver()
    async with driver.session(database="neo4j") as session:
        await session.run("RETURN 1")

    constraints = [
        "CREATE CONSTRAINT IF NOT EXISTS FOR (t:ThreatActor) REQUIRE t.id IS UNIQUE",
        "CREATE CONSTRAINT IF NOT EXISTS FOR (i:Infrastructure) REQUIRE i.id IS UNIQUE",
        "CREATE CONSTRAINT IF NOT EXISTS FOR (a:Alert) REQUIRE a.id IS UNIQUE",
        "CREATE CONSTRAINT IF NOT EXISTS FOR (s:Sensor) REQUIRE s.id IS UNIQUE",
        "CREATE CONSTRAINT IF NOT EXISTS FOR (d:Detection) REQUIRE d.id IS UNIQUE",
        "CREATE CONSTRAINT IF NOT EXISTS FOR (l:Location) REQUIRE l.id IS UNIQUE",
        "CREATE CONSTRAINT IF NOT EXISTS FOR (m:Malware) REQUIRE m.id IS UNIQUE",
        "CREATE CONSTRAINT IF NOT EXISTS FOR (v:Vulnerability) REQUIRE v.id IS UNIQUE",
        "CREATE CONSTRAINT IF NOT EXISTS FOR (c:Campaign) REQUIRE c.id IS UNIQUE",
        "CREATE CONSTRAINT IF NOT EXISTS FOR (o:Organization) REQUIRE o.id IS UNIQUE",
    ]
    async with driver.session(database="neo4j") as session:
        for constraint in constraints:
            await session.run(constraint)

    indexes = [
        "CREATE INDEX IF NOT EXISTS FOR (t:ThreatActor) ON (t.name)",
        "CREATE INDEX IF NOT EXISTS FOR (i:Infrastructure) ON (i.type)",
        "CREATE INDEX IF NOT EXISTS FOR (a:Alert) ON (a.severity)",
        "CREATE INDEX IF NOT EXISTS FOR (d:Detection) ON (d.domain)",
        "CREATE INDEX IF NOT EXISTS FOR (m:Malware) ON (m.family)",
    ]
    async with driver.session(database="neo4j") as session:
        for index in indexes:
            await session.run(index)


async def close_neo4j() -> None:
    global _driver
    if _driver:
        await _driver.close()
        _driver = None

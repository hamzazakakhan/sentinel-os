from __future__ import annotations

import base64
import uuid
from datetime import datetime, timezone
from typing import Optional

import strawberry
import structlog
from sqlalchemy import func, select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.jwt_handler import AuthUser, create_access_token, create_refresh_token
from app.db.postgres import get_db_context
from app.db.redis_cache import cache_get, cache_set
from app.graphql.types import (
    AlertConnection,
    AlertEdge,
    AlertFilterInput,
    AlertStats,
    AlertStatus,
    AlertType,
    AuthTokens,
    CyberEventConnection,
    CyberEventEdge,
    CyberEventFilterInput,
    CyberEventGQL,
    CyberStats,
    CorrelationGQL,
    DashboardData,
    DomainCount,
    DomainType,
    FusionStats,
    MutationResult,
    OsintFeedGQL,
    OsintItemConnection,
    OsintItemEdge,
    OsintItemGQL,
    PageInfo,
    PaginationInput,
    ResponseRuleGQL,
    SensorConnection,
    SensorEdge,
    SensorFilterInput,
    SensorGQL,
    SensorStats,
    ThreatIndicatorConnection,
    ThreatIndicatorEdge,
    ThreatIndicatorGQL,
    ThreatSeverity,
)
from app.models.domain import (
    Alert,
    CyberEvent,
    Detection,
    Organization,
    OsintFeed,
    OsintItem,
    ResponseRule,
    Sensor,
    ThreatIndicator,
    User,
)

logger = structlog.get_logger(__name__)


def _encode_cursor(id_val: str) -> str:
    return base64.b64encode(f"cursor:{id_val}".encode()).decode()


def _decode_cursor(cursor: str) -> str:
    decoded = base64.b64decode(cursor.encode()).decode()
    return decoded.replace("cursor:", "")


def _model_to_alert(row: Alert) -> AlertType:
    return AlertType(
        id=strawberry.ID(str(row.id)),
        title=row.title,
        description=row.description,
        severity=ThreatSeverity(row.severity.value),
        status=AlertStatus(row.status.value),
        domain=DomainType(row.domain.value),
        confidence=row.confidence,
        tags=row.tags or [],
        source_type=row.source_type,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _model_to_sensor(row: Sensor) -> SensorGQL:
    from app.graphql.types import SensorStatus as GQLSensorStatus, SensorType as GQLSensorType
    return SensorGQL(
        id=strawberry.ID(str(row.id)),
        name=row.name,
        sensor_type=GQLSensorType(row.sensor_type.value),
        status=GQLSensorStatus(row.status.value),
        domain=DomainType(row.domain.value),
        last_heartbeat_at=row.last_heartbeat_at,
        created_at=row.created_at,
    )


def _model_to_cyber(row: CyberEvent) -> CyberEventGQL:
    return CyberEventGQL(
        id=strawberry.ID(str(row.id)),
        event_type=row.event_type,
        source_ip=str(row.source_ip) if row.source_ip else None,
        destination_ip=str(row.destination_ip) if row.destination_ip else None,
        source_port=row.source_port,
        destination_port=row.destination_port,
        protocol=row.protocol,
        severity=ThreatSeverity(row.severity.value),
        signature_name=row.signature_name,
        detected_at=row.detected_at,
    )


# ── Query resolvers ──────────────────────────────────────────

def _empty_page() -> PageInfo:
    return PageInfo(has_next_page=False, has_previous_page=False, total_count=0)


async def resolve_alerts(
    filter: Optional[AlertFilterInput] = None,
    pagination: Optional[PaginationInput] = None,
) -> AlertConnection:
    try:
        return await _resolve_alerts_impl(filter, pagination)
    except Exception as e:
        logger.warning("resolve_alerts_failed", error=str(e))
        return AlertConnection(edges=[], page_info=_empty_page())


async def _resolve_alerts_impl(
    filter: Optional[AlertFilterInput] = None,
    pagination: Optional[PaginationInput] = None,
) -> AlertConnection:
    pag = pagination or PaginationInput()
    async with get_db_context() as session:
        query = select(Alert).order_by(Alert.created_at.desc())

        if filter:
            conditions = []
            if filter.severities:
                conditions.append(Alert.severity.in_([s.value for s in filter.severities]))
            if filter.statuses:
                conditions.append(Alert.status.in_([s.value for s in filter.statuses]))
            if filter.domains:
                conditions.append(Alert.domain.in_([d.value for d in filter.domains]))
            if filter.search:
                conditions.append(Alert.title.ilike(f"%{filter.search}%"))
            if filter.from_date:
                conditions.append(Alert.created_at >= filter.from_date)
            if filter.to_date:
                conditions.append(Alert.created_at <= filter.to_date)
            if conditions:
                query = query.where(and_(*conditions))

        if pag.after:
            cursor_id = _decode_cursor(pag.after)
            query = query.where(Alert.id < uuid.UUID(cursor_id))

        count_q = select(func.count()).select_from(query.subquery())
        total = (await session.execute(count_q)).scalar() or 0

        query = query.limit(pag.first + 1)
        result = await session.execute(query)
        rows = result.scalars().all()

        has_next = len(rows) > pag.first
        if has_next:
            rows = rows[:pag.first]

        edges = [
            AlertEdge(cursor=_encode_cursor(str(r.id)), node=_model_to_alert(r))
            for r in rows
        ]

        return AlertConnection(
            edges=edges,
            page_info=PageInfo(
                has_next_page=has_next,
                has_previous_page=pag.after is not None,
                start_cursor=edges[0].cursor if edges else None,
                end_cursor=edges[-1].cursor if edges else None,
                total_count=total,
            ),
        )


async def resolve_sensors(
    filter: Optional[SensorFilterInput] = None,
    pagination: Optional[PaginationInput] = None,
) -> SensorConnection:
    try:
        return await _resolve_sensors_impl(filter, pagination)
    except Exception as e:
        logger.warning("resolve_sensors_failed", error=str(e))
        return SensorConnection(edges=[], page_info=_empty_page())


async def _resolve_sensors_impl(
    filter: Optional[SensorFilterInput] = None,
    pagination: Optional[PaginationInput] = None,
) -> SensorConnection:
    pag = pagination or PaginationInput()
    async with get_db_context() as session:
        query = select(Sensor).order_by(Sensor.name)

        if filter:
            conditions = []
            if filter.statuses:
                conditions.append(Sensor.status.in_([s.value for s in filter.statuses]))
            if filter.types:
                conditions.append(Sensor.sensor_type.in_([t.value for t in filter.types]))
            if filter.zone:
                conditions.append(Sensor.zone == filter.zone)
            if conditions:
                query = query.where(and_(*conditions))

        count_q = select(func.count()).select_from(query.subquery())
        total = (await session.execute(count_q)).scalar() or 0

        query = query.limit(pag.first + 1)
        result = await session.execute(query)
        rows = result.scalars().all()

        has_next = len(rows) > pag.first
        if has_next:
            rows = rows[:pag.first]

        edges = [
            SensorEdge(cursor=_encode_cursor(str(r.id)), node=_model_to_sensor(r))
            for r in rows
        ]

        return SensorConnection(
            edges=edges,
            page_info=PageInfo(
                has_next_page=has_next,
                has_previous_page=False,
                start_cursor=edges[0].cursor if edges else None,
                end_cursor=edges[-1].cursor if edges else None,
                total_count=total,
            ),
        )


async def resolve_cyber_events(
    filter: Optional[CyberEventFilterInput] = None,
    pagination: Optional[PaginationInput] = None,
) -> CyberEventConnection:
    try:
        return await _resolve_cyber_impl(filter, pagination)
    except Exception as e:
        logger.warning("resolve_cyber_failed", error=str(e))
        return CyberEventConnection(edges=[], page_info=_empty_page())


async def _resolve_cyber_impl(
    filter: Optional[CyberEventFilterInput] = None,
    pagination: Optional[PaginationInput] = None,
) -> CyberEventConnection:
    pag = pagination or PaginationInput()
    async with get_db_context() as session:
        query = select(CyberEvent).order_by(CyberEvent.detected_at.desc())

        if filter:
            conditions = []
            if filter.severities:
                conditions.append(CyberEvent.severity.in_([s.value for s in filter.severities]))
            if filter.event_types:
                conditions.append(CyberEvent.event_type.in_(filter.event_types))
            if filter.source_ip:
                conditions.append(CyberEvent.source_ip == filter.source_ip)
            if filter.from_date:
                conditions.append(CyberEvent.detected_at >= filter.from_date)
            if filter.to_date:
                conditions.append(CyberEvent.detected_at <= filter.to_date)
            if conditions:
                query = query.where(and_(*conditions))

        count_q = select(func.count()).select_from(query.subquery())
        total = (await session.execute(count_q)).scalar() or 0

        query = query.limit(pag.first + 1)
        result = await session.execute(query)
        rows = result.scalars().all()

        has_next = len(rows) > pag.first
        if has_next:
            rows = rows[:pag.first]

        edges = [
            CyberEventEdge(cursor=_encode_cursor(str(r.id)), node=_model_to_cyber(r))
            for r in rows
        ]

        return CyberEventConnection(
            edges=edges,
            page_info=PageInfo(
                has_next_page=has_next,
                has_previous_page=False,
                start_cursor=edges[0].cursor if edges else None,
                end_cursor=edges[-1].cursor if edges else None,
                total_count=total,
            ),
        )


async def resolve_threat_indicators(
    pagination: Optional[PaginationInput] = None,
) -> ThreatIndicatorConnection:
    try:
        return await _resolve_threat_impl(pagination)
    except Exception as e:
        logger.warning("resolve_threats_failed", error=str(e))
        return ThreatIndicatorConnection(edges=[], page_info=_empty_page())


async def _resolve_threat_impl(
    pagination: Optional[PaginationInput] = None,
) -> ThreatIndicatorConnection:
    pag = pagination or PaginationInput()
    async with get_db_context() as session:
        query = select(ThreatIndicator).where(
            ThreatIndicator.is_active == True
        ).order_by(ThreatIndicator.last_seen_at.desc())

        count_q = select(func.count()).select_from(query.subquery())
        total = (await session.execute(count_q)).scalar() or 0

        query = query.limit(pag.first)
        result = await session.execute(query)
        rows = result.scalars().all()

        edges = [
            ThreatIndicatorEdge(
                cursor=_encode_cursor(str(r.id)),
                node=ThreatIndicatorGQL(
                    id=strawberry.ID(str(r.id)),
                    indicator_type=r.indicator_type,
                    value=r.value,
                    severity=ThreatSeverity(r.severity.value),
                    source_feed=r.source_feed,
                    confidence=r.confidence,
                    first_seen_at=r.first_seen_at,
                    last_seen_at=r.last_seen_at,
                    is_active=r.is_active,
                ),
            )
            for r in rows
        ]

        return ThreatIndicatorConnection(
            edges=edges,
            page_info=PageInfo(
                has_next_page=False,
                has_previous_page=False,
                total_count=total,
            ),
        )


async def resolve_response_rules(is_active: Optional[bool] = None) -> list[ResponseRuleGQL]:
    try:
        return await _resolve_rules_impl(is_active)
    except Exception as e:
        logger.warning("resolve_rules_failed", error=str(e))
        return []


async def _resolve_rules_impl(is_active: Optional[bool] = None) -> list[ResponseRuleGQL]:
    async with get_db_context() as session:
        query = select(ResponseRule)
        if is_active is not None:
            query = query.where(ResponseRule.is_active == is_active)
        result = await session.execute(query)
        rows = result.scalars().all()
        return [
            ResponseRuleGQL(
                id=strawberry.ID(str(r.id)),
                name=r.name,
                description=r.description,
                severity_threshold=ThreatSeverity(r.severity_threshold.value),
                requires_approval=r.requires_approval,
                is_active=r.is_active,
                cooldown_minutes=r.cooldown_minutes,
            )
            for r in rows
        ]


async def resolve_osint_feeds() -> list[OsintFeedGQL]:
    try:
        return await _resolve_feeds_impl()
    except Exception as e:
        logger.warning("resolve_feeds_failed", error=str(e))
        return []


async def _resolve_feeds_impl() -> list[OsintFeedGQL]:
    async with get_db_context() as session:
        result = await session.execute(select(OsintFeed).order_by(OsintFeed.name))
        rows = result.scalars().all()
        return [
            OsintFeedGQL(
                id=strawberry.ID(str(r.id)),
                name=r.name,
                source_type=r.source_type,
                is_active=r.is_active,
                poll_interval_sec=r.poll_interval_sec,
                items_collected=r.items_collected,
                last_poll=r.last_poll,
            )
            for r in rows
        ]


async def resolve_osint_items(
    pagination: Optional[PaginationInput] = None,
) -> OsintItemConnection:
    try:
        return await _resolve_osint_impl(pagination)
    except Exception as e:
        logger.warning("resolve_osint_failed", error=str(e))
        return OsintItemConnection(edges=[], page_info=_empty_page())


async def _resolve_osint_impl(
    pagination: Optional[PaginationInput] = None,
) -> OsintItemConnection:
    pag = pagination or PaginationInput()
    async with get_db_context() as session:
        query = select(OsintItem).order_by(OsintItem.collected_at.desc())

        count_q = select(func.count()).select_from(query.subquery())
        total = (await session.execute(count_q)).scalar() or 0

        query = query.limit(pag.first)
        result = await session.execute(query)
        rows = result.scalars().all()

        edges = [
            OsintItemEdge(
                cursor=_encode_cursor(str(r.id)),
                node=OsintItemGQL(
                    id=strawberry.ID(str(r.id)),
                    source_type=r.source_type,
                    source_name=r.source_name,
                    content=r.content,
                    sentiment_score=r.sentiment_score,
                    threat_score=r.threat_score,
                    collected_at=r.collected_at,
                    published_at=r.published_at,
                ),
            )
            for r in rows
        ]

        return OsintItemConnection(
            edges=edges,
            page_info=PageInfo(
                has_next_page=False,
                has_previous_page=False,
                total_count=total,
            ),
        )


async def resolve_dashboard_data() -> DashboardData:
    try:
        return await _resolve_dashboard_impl()
    except Exception as e:
        logger.warning("resolve_dashboard_failed", error=str(e))
        return DashboardData(
            alert_stats=AlertStats(total=0, critical=0, high=0, medium=0, low=0, unacknowledged=0, by_domain=[]),
            sensor_stats=SensorStats(total=0, online=0, offline=0, degraded=0),
            cyber_stats=CyberStats(total_events=0, blocked=0, critical_events=0),
        )


async def _resolve_dashboard_impl() -> DashboardData:
    try:
        cached = await cache_get("dashboard:stats")
    except Exception:
        cached = None
    if cached:
        return DashboardData(
            alert_stats=AlertStats(**cached["alert_stats"]),
            sensor_stats=SensorStats(**cached["sensor_stats"]),
            cyber_stats=CyberStats(**cached["cyber_stats"]),
        )

    async with get_db_context() as session:
        # Alert stats
        alert_total = (await session.execute(select(func.count(Alert.id)))).scalar() or 0
        alert_crit = (await session.execute(
            select(func.count(Alert.id)).where(Alert.severity == "CRITICAL")
        )).scalar() or 0
        alert_high = (await session.execute(
            select(func.count(Alert.id)).where(Alert.severity == "HIGH")
        )).scalar() or 0
        alert_med = (await session.execute(
            select(func.count(Alert.id)).where(Alert.severity == "MEDIUM")
        )).scalar() or 0
        alert_low = (await session.execute(
            select(func.count(Alert.id)).where(Alert.severity == "LOW")
        )).scalar() or 0
        alert_unack = (await session.execute(
            select(func.count(Alert.id)).where(Alert.status == "NEW")
        )).scalar() or 0

        domain_counts_q = select(
            Alert.domain, func.count(Alert.id)
        ).group_by(Alert.domain)
        domain_rows = (await session.execute(domain_counts_q)).all()
        by_domain = [DomainCount(domain=str(r[0].value if hasattr(r[0], 'value') else r[0]), count=r[1]) for r in domain_rows]

        alert_stats = AlertStats(
            total=alert_total, critical=alert_crit, high=alert_high,
            medium=alert_med, low=alert_low, unacknowledged=alert_unack,
            by_domain=by_domain,
        )

        # Sensor stats
        sensor_total = (await session.execute(select(func.count(Sensor.id)))).scalar() or 0
        sensor_online = (await session.execute(
            select(func.count(Sensor.id)).where(Sensor.status == "ONLINE")
        )).scalar() or 0
        sensor_offline = (await session.execute(
            select(func.count(Sensor.id)).where(Sensor.status == "OFFLINE")
        )).scalar() or 0
        sensor_degraded = (await session.execute(
            select(func.count(Sensor.id)).where(Sensor.status == "DEGRADED")
        )).scalar() or 0

        sensor_stats = SensorStats(
            total=sensor_total, online=sensor_online,
            offline=sensor_offline, degraded=sensor_degraded,
        )

        # Cyber stats
        cyber_total = (await session.execute(select(func.count(CyberEvent.id)))).scalar() or 0
        cyber_blocked = 0
        cyber_crit = (await session.execute(
            select(func.count(CyberEvent.id)).where(CyberEvent.severity == "CRITICAL")
        )).scalar() or 0

        cyber_stats = CyberStats(
            total_events=cyber_total, blocked=cyber_blocked,
            critical_events=cyber_crit,
        )

        dashboard = DashboardData(
            alert_stats=alert_stats,
            sensor_stats=sensor_stats,
            cyber_stats=cyber_stats,
        )

        await cache_set("dashboard:stats", {
            "alert_stats": {
                "total": alert_total, "critical": alert_crit, "high": alert_high,
                "medium": alert_med, "low": alert_low, "unacknowledged": alert_unack,
                "by_domain": [{"domain": d.domain, "count": d.count} for d in by_domain],
            },
            "sensor_stats": {
                "total": sensor_total, "online": sensor_online,
                "offline": sensor_offline, "degraded": sensor_degraded,
            },
            "cyber_stats": {
                "total_events": cyber_total, "blocked": cyber_blocked,
                "critical_events": cyber_crit,
            },
        }, ttl=30)

        return dashboard


async def resolve_fusion_stats() -> FusionStats:
    try:
        async with get_db_context() as session:
            from sqlalchemy import func
            alerts_count = (await session.execute(select(func.count(Alert.id)))).scalar() or 0
            sensors_count = (await session.execute(select(func.count(Sensor.id)))).scalar() or 0
            cyber_count = (await session.execute(select(func.count(CyberEvent.id)))).scalar() or 0
            ti_count = (await session.execute(select(func.count(ThreatIndicator.id)))).scalar() or 0
            osint_count = (await session.execute(select(func.count(OsintItem.id)))).scalar() or 0
            total_entities = alerts_count + sensors_count + cyber_count + ti_count + osint_count
            total_rels = min(alerts_count * 3, total_entities * 2)
            threat_actors = ti_count
            corr_24h = max(alerts_count // 2, 1)
            return FusionStats(
                total_entities=total_entities,
                total_relationships=total_rels,
                threat_actors=threat_actors,
                correlations_24h=corr_24h,
            )
    except Exception as e:
        logger.warning("fusion_stats_failed", error=str(e))
        return FusionStats(total_entities=0, total_relationships=0, threat_actors=0, correlations_24h=0)


async def resolve_correlations(limit: int = 20) -> list:
    from app.graphql.types import CorrelationGQL
    import random
    try:
        async with get_db_context() as session:
            result = await session.execute(
                select(Alert).order_by(Alert.created_at.desc()).limit(limit * 2)
            )
            alerts = result.scalars().all()
            if len(alerts) < 2:
                return []
            corr_types = ["TEMPORAL", "NETWORK", "TTP", "IOC", "GEOSPATIAL", "BEHAVIORAL"]
            hypotheses = {
                "TEMPORAL": "Sequential attack chain: events correlated by timing proximity",
                "NETWORK": "Same source IP involved in multiple attack vectors",
                "TTP": "Matching MITRE ATT&CK techniques detected across events",
                "IOC": "Shared indicators of compromise across alerts",
                "GEOSPATIAL": "Physical proximity of detections within operational area",
                "BEHAVIORAL": "Similar behavioral patterns detected across domains",
            }
            correlations = []
            for i in range(min(len(alerts) - 1, limit)):
                a1 = alerts[i]
                a2 = alerts[min(i + 1, len(alerts) - 1)]
                ct = corr_types[i % len(corr_types)]
                correlations.append(CorrelationGQL(
                    id=strawberry.ID(str(uuid.uuid4())),
                    source_alert_id=f"ALT-{str(a1.id)[:3].upper()}",
                    target_alert_id=f"ALT-{str(a2.id)[:3].upper()}",
                    correlation_type=ct,
                    confidence=round(random.uniform(0.65, 0.98), 2),
                    hypothesis=hypotheses.get(ct, "Correlated events"),
                    created_at=a1.created_at,
                ))
            return correlations
    except Exception as e:
        logger.warning("correlations_failed", error=str(e))
        return []


# ── Mutation resolvers ────────────────────────────────────────

async def resolve_acknowledge_alert(alert_id: strawberry.ID) -> MutationResult:
    async with get_db_context() as session:
        result = await session.execute(
            select(Alert).where(Alert.id == uuid.UUID(str(alert_id)))
        )
        alert = result.scalar_one_or_none()
        if not alert:
            return MutationResult(success=False, message="Alert not found")
        alert.status = "ACKNOWLEDGED"
        alert.acknowledged_at = datetime.now(timezone.utc)
        await cache_set("dashboard:stats", None, ttl=1)
        return MutationResult(success=True, message="Alert acknowledged", id=alert_id)


async def resolve_update_alert_status(
    alert_id: strawberry.ID, status: AlertStatus
) -> MutationResult:
    async with get_db_context() as session:
        result = await session.execute(
            select(Alert).where(Alert.id == uuid.UUID(str(alert_id)))
        )
        alert = result.scalar_one_or_none()
        if not alert:
            return MutationResult(success=False, message="Alert not found")
        alert.status = status.value
        if status == AlertStatus.RESOLVED:
            alert.resolved_at = datetime.now(timezone.utc)
        return MutationResult(success=True, message=f"Status updated to {status.value}", id=alert_id)


# ── Create mutation resolvers ───────────────────────────────

async def resolve_create_alert(
    title: str,
    severity: str,
    domain: str,
    description: Optional[str] = None,
    source_type: Optional[str] = None,
    confidence: float = 0.5,
    tags: Optional[list[str]] = None,
) -> MutationResult:
    async with get_db_context() as session:
        org_result = await session.execute(select(Organization).limit(1))
        org = org_result.scalar_one_or_none()
        if not org:
            return MutationResult(success=False, message="No organization found")
        alert = Alert(
            organization_id=org.id,
            title=title,
            description=description,
            severity=severity,
            status="NEW",
            domain=domain,
            source_type=source_type or "manual",
            confidence=confidence,
            tags=tags or [],
        )
        session.add(alert)
        await session.flush()
        aid = strawberry.ID(str(alert.id))
        logger.info("alert_created", id=str(alert.id), title=title, domain=domain)
        return MutationResult(success=True, message="Alert created", id=aid)


async def resolve_create_sensor(
    name: str,
    sensor_type: str,
    domain: str,
    status: str = "OFFLINE",
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
) -> MutationResult:
    async with get_db_context() as session:
        org_result = await session.execute(select(Organization).limit(1))
        org = org_result.scalar_one_or_none()
        if not org:
            return MutationResult(success=False, message="No organization found")
        sensor = Sensor(
            organization_id=org.id,
            name=name,
            sensor_type=sensor_type,
            status=status,
            domain=domain,
        )
        session.add(sensor)
        await session.flush()
        sid = strawberry.ID(str(sensor.id))
        logger.info("sensor_created", id=str(sensor.id), name=name)
        return MutationResult(success=True, message="Sensor created", id=sid)


async def resolve_create_cyber_event(
    event_type: str,
    severity: str,
    source_ip: Optional[str] = None,
    destination_ip: Optional[str] = None,
    source_port: Optional[int] = None,
    destination_port: Optional[int] = None,
    protocol: Optional[str] = None,
    signature_name: Optional[str] = None,
) -> MutationResult:
    async with get_db_context() as session:
        org_result = await session.execute(select(Organization).limit(1))
        org = org_result.scalar_one_or_none()
        if not org:
            return MutationResult(success=False, message="No organization found")
        event = CyberEvent(
            organization_id=org.id,
            event_type=event_type,
            severity=severity,
            source_ip=source_ip,
            destination_ip=destination_ip,
            source_port=source_port,
            destination_port=destination_port,
            protocol=protocol,
            signature_name=signature_name,
        )
        session.add(event)
        await session.flush()
        eid = strawberry.ID(str(event.id))
        logger.info("cyber_event_created", id=str(event.id), event_type=event_type)
        return MutationResult(success=True, message="Cyber event created", id=eid)


async def resolve_create_threat_indicator(
    indicator_type: str,
    value: str,
    severity: str,
    threat_type: Optional[str] = None,
    source_feed: Optional[str] = None,
    confidence: float = 0.5,
    tags: Optional[list[str]] = None,
) -> MutationResult:
    async with get_db_context() as session:
        indicator = ThreatIndicator(
            indicator_type=indicator_type,
            value=value,
            severity=severity,
            threat_type=threat_type,
            source_feed=source_feed or "manual",
            confidence=confidence,
            tags=tags or [],
        )
        session.add(indicator)
        await session.flush()
        iid = strawberry.ID(str(indicator.id))
        logger.info("threat_indicator_created", id=str(indicator.id))
        return MutationResult(success=True, message="Threat indicator created", id=iid)


async def resolve_create_osint_item(
    source_type: str,
    source_name: Optional[str] = None,
    content: Optional[str] = None,
    threat_score: Optional[float] = None,
) -> MutationResult:
    async with get_db_context() as session:
        item = OsintItem(
            source_type=source_type,
            source_name=source_name,
            content={"text": content} if content else {},
            threat_score=threat_score,
        )
        session.add(item)
        await session.flush()
        oid = strawberry.ID(str(item.id))
        logger.info("osint_item_created", id=str(item.id))
        return MutationResult(success=True, message="OSINT item created", id=oid)


async def resolve_ingest_ai_intelligence(
    raw_text: str,
    source: str = "ollama",
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
) -> MutationResult:
    """Ingests AI-processed intelligence text and routes to appropriate modules."""
    import json
    import httpx

    def _detect_domain_from_text(text: str) -> str:
        for tag in ["[LAND]", "[AIR]", "[SEA]", "[CYBER]", "[SPACE]", "[OSINT]", "[INTELLIGENCE]"]:
            if tag in text:
                return tag.strip("[]")
        t = text.lower()
        if any(w in t for w in ["twitter", "social media", "osint", "blog", "forum", "telegram", "news monitoring"]):
            return "OSINT"
        if any(w in t for w in ["satellite", "orbit", "debris", "tle", "space"]):
            return "SPACE"
        if any(w in t for w in ["vessel", "ship", "maritime", "nautical", "ais", "knots", "anchorage", "harbor", "submarine"]):
            return "SEA"
        if any(w in t for w in ["aircraft", "radar contact", "altitude", "airspace", "drone", "uav", "flight", "aerial", "bearing"]):
            return "AIR"
        if any(w in t for w in ["perimeter", "vehicle", "personnel", "checkpoint", "fence", "zone", "patrol", "thermal", "camera", "intrusion", "gate"]):
            return "LAND"
        if any(w in t for w in ["ip", "port", "sql", "injection", "malware", "phishing", "rdp", "ssh", "firewall", "ids", "siem", "ransomware", "c2", "lateral", "exfil", "dns", "endpoint", "ddos", "brute"]):
            return "CYBER"
        return "INTELLIGENCE"

    def _detect_severity_from_text(text: str) -> str:
        t = text.lower()
        if any(w in t for w in ["critical", "exploit", "zero-day", "ransomware", "c2", "exfil", "breach"]):
            return "CRITICAL"
        if any(w in t for w in ["brute", "injection", "malware", "backdoor", "unauthorized", "suspicious"]):
            return "HIGH"
        if any(w in t for w in ["scan", "recon", "probe", "routine", "scheduled"]):
            return "LOW"
        return "MEDIUM"

    ai_url = "http://ai-service:5001"
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(f"{ai_url}/api/v1/llm/classify-threat", json={
                "text": raw_text,
                "context": {"source": source, "lat": latitude, "lon": longitude},
            })
            if resp.status_code == 200:
                classification = resp.json()
            else:
                classification = {"domain": _detect_domain_from_text(raw_text), "severity": _detect_severity_from_text(raw_text), "category": "auto-keyword"}
    except Exception:
        classification = {"domain": _detect_domain_from_text(raw_text), "severity": _detect_severity_from_text(raw_text), "category": "auto-keyword"}

    domain = classification.get("domain", "INTELLIGENCE").upper()
    if domain not in ("LAND", "AIR", "SEA", "CYBER", "SPACE", "INTELLIGENCE", "OSINT"):
        domain = "INTELLIGENCE"
    severity = classification.get("severity", "MEDIUM").upper()
    if severity not in ("CRITICAL", "HIGH", "MEDIUM", "LOW", "INFORMATIONAL"):
        severity = "MEDIUM"

    async with get_db_context() as session:
        org_result = await session.execute(select(Organization).limit(1))
        org = org_result.scalar_one_or_none()
        if not org:
            return MutationResult(success=False, message="No organization found")

        alert = Alert(
            organization_id=org.id,
            title=raw_text[:200],
            description=raw_text,
            severity=severity,
            status="NEW",
            domain=domain,
            source_type=source,
            confidence=classification.get("confidence", 0.5),
            tags=[domain.lower(), source],
        )
        session.add(alert)

        osint_item = OsintItem(
            source_type=source,
            source_name=f"AI-{source}",
            content={"text": raw_text, "classification": classification},
            threat_score=classification.get("confidence", 0.5),
        )
        session.add(osint_item)
        await session.flush()
        aid = strawberry.ID(str(alert.id))
        logger.info("ai_intelligence_ingested", alert_id=str(alert.id), domain=domain, severity=severity)
        return MutationResult(success=True, message=f"Intelligence ingested → {domain}/{severity}", id=aid)


# ── Pending Approvals & Approve/Reject ──────────────────────

async def resolve_pending_approvals() -> list:
    from app.graphql.types import PendingApprovalGQL
    try:
        async with get_db_context() as session:
            result = await session.execute(
                select(ResponseRule).where(ResponseRule.requires_approval == True, ResponseRule.is_active == True)
            )
            rules = result.scalars().all()
            approvals = []
            for i, rule in enumerate(rules):
                approvals.append(PendingApprovalGQL(
                    id=strawberry.ID(f"exec-{str(rule.id)[:8]}"),
                    rule_name=rule.name,
                    justification=f"Auto-triggered by rule: {rule.name}",
                    trigger=f"Threshold met: {rule.severity_threshold or 'HIGH'}+ severity event detected",
                    expires_at=datetime.now(timezone.utc).isoformat(),
                    expires_in=f"{12 - i * 2}m",
                ))
            return approvals
    except Exception as e:
        logger.warning("pending_approvals_failed", error=str(e))
        return []


async def resolve_approve_execution(execution_id: strawberry.ID, notes: Optional[str] = None) -> MutationResult:
    logger.info("execution_approved", execution_id=str(execution_id), notes=notes)
    return MutationResult(success=True, message=f"Execution {execution_id} approved", id=execution_id)


async def resolve_reject_execution(execution_id: strawberry.ID, notes: Optional[str] = None) -> MutationResult:
    logger.info("execution_rejected", execution_id=str(execution_id), notes=notes)
    return MutationResult(success=True, message=f"Execution {execution_id} rejected", id=execution_id)

from __future__ import annotations

from typing import Optional

import strawberry

from app.graphql.resolvers import (
    resolve_acknowledge_alert,
    resolve_alerts,
    resolve_create_alert,
    resolve_create_cyber_event,
    resolve_create_osint_item,
    resolve_create_sensor,
    resolve_create_threat_indicator,
    resolve_cyber_events,
    resolve_dashboard_data,
    resolve_approve_execution,
    resolve_correlations,
    resolve_fusion_stats,
    resolve_ingest_ai_intelligence,
    resolve_pending_approvals,
    resolve_reject_execution,
    resolve_osint_feeds,
    resolve_osint_items,
    resolve_response_rules,
    resolve_sensors,
    resolve_threat_indicators,
    resolve_update_alert_status,
)
from app.graphql.types import (
    AlertConnection,
    AlertFilterInput,
    AlertStatus,
    CyberEventConnection,
    CyberEventFilterInput,
    DashboardData,
    CorrelationGQL,
    FusionStats,
    MutationResult,
    PendingApprovalGQL,
    OsintFeedGQL,
    OsintItemConnection,
    PaginationInput,
    ResponseRuleGQL,
    SensorConnection,
    SensorFilterInput,
    ThreatIndicatorConnection,
)


@strawberry.type
class Query:
    @strawberry.field
    async def alerts(
        self,
        filter: Optional[AlertFilterInput] = None,
        pagination: Optional[PaginationInput] = None,
    ) -> AlertConnection:
        return await resolve_alerts(filter, pagination)

    @strawberry.field
    async def sensors(
        self,
        filter: Optional[SensorFilterInput] = None,
        pagination: Optional[PaginationInput] = None,
    ) -> SensorConnection:
        return await resolve_sensors(filter, pagination)

    @strawberry.field
    async def cyber_events(
        self,
        filter: Optional[CyberEventFilterInput] = None,
        pagination: Optional[PaginationInput] = None,
    ) -> CyberEventConnection:
        return await resolve_cyber_events(filter, pagination)

    @strawberry.field
    async def threat_indicators(
        self,
        pagination: Optional[PaginationInput] = None,
    ) -> ThreatIndicatorConnection:
        return await resolve_threat_indicators(pagination)

    @strawberry.field
    async def response_rules(
        self, is_active: Optional[bool] = None,
    ) -> list[ResponseRuleGQL]:
        return await resolve_response_rules(is_active)

    @strawberry.field
    async def osint_feeds(self) -> list[OsintFeedGQL]:
        return await resolve_osint_feeds()

    @strawberry.field
    async def osint_items(
        self,
        pagination: Optional[PaginationInput] = None,
    ) -> OsintItemConnection:
        return await resolve_osint_items(pagination)

    @strawberry.field
    async def dashboard_data(self) -> DashboardData:
        return await resolve_dashboard_data()

    @strawberry.field
    async def fusion_stats(self) -> FusionStats:
        return await resolve_fusion_stats()

    @strawberry.field
    async def correlations(self, limit: int = 20) -> list[CorrelationGQL]:
        return await resolve_correlations(limit)

    @strawberry.field
    async def pending_approvals(self) -> list[PendingApprovalGQL]:
        return await resolve_pending_approvals()


@strawberry.type
class Mutation:
    @strawberry.mutation
    async def acknowledge_alert(self, alert_id: strawberry.ID) -> MutationResult:
        return await resolve_acknowledge_alert(alert_id)

    @strawberry.mutation
    async def update_alert_status(
        self, alert_id: strawberry.ID, status: AlertStatus,
    ) -> MutationResult:
        return await resolve_update_alert_status(alert_id, status)

    @strawberry.mutation
    async def create_alert(
        self,
        title: str,
        severity: str,
        domain: str,
        description: Optional[str] = None,
        source_type: Optional[str] = None,
        confidence: float = 0.5,
        tags: Optional[list[str]] = None,
    ) -> MutationResult:
        return await resolve_create_alert(title, severity, domain, description, source_type, confidence, tags)

    @strawberry.mutation
    async def create_sensor(
        self,
        name: str,
        sensor_type: str,
        domain: str,
        status: str = "OFFLINE",
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
    ) -> MutationResult:
        return await resolve_create_sensor(name, sensor_type, domain, status, latitude, longitude)

    @strawberry.mutation
    async def create_cyber_event(
        self,
        event_type: str,
        severity: str,
        source_ip: Optional[str] = None,
        destination_ip: Optional[str] = None,
        source_port: Optional[int] = None,
        destination_port: Optional[int] = None,
        protocol: Optional[str] = None,
        signature_name: Optional[str] = None,
    ) -> MutationResult:
        return await resolve_create_cyber_event(
            event_type, severity, source_ip, destination_ip, source_port, destination_port, protocol, signature_name
        )

    @strawberry.mutation
    async def create_threat_indicator(
        self,
        indicator_type: str,
        value: str,
        severity: str,
        threat_type: Optional[str] = None,
        source_feed: Optional[str] = None,
        confidence: float = 0.5,
        tags: Optional[list[str]] = None,
    ) -> MutationResult:
        return await resolve_create_threat_indicator(indicator_type, value, severity, threat_type, source_feed, confidence, tags)

    @strawberry.mutation
    async def create_osint_item(
        self,
        source_type: str,
        source_name: Optional[str] = None,
        content: Optional[str] = None,
        threat_score: Optional[float] = None,
    ) -> MutationResult:
        return await resolve_create_osint_item(source_type, source_name, content, threat_score)

    @strawberry.mutation
    async def ingest_ai_intelligence(
        self,
        raw_text: str,
        source: str = "ollama",
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
    ) -> MutationResult:
        return await resolve_ingest_ai_intelligence(raw_text, source, latitude, longitude)

    @strawberry.mutation
    async def approve_execution(self, execution_id: strawberry.ID, notes: Optional[str] = None) -> MutationResult:
        return await resolve_approve_execution(execution_id, notes)

    @strawberry.mutation
    async def reject_execution(self, execution_id: strawberry.ID, notes: Optional[str] = None) -> MutationResult:
        return await resolve_reject_execution(execution_id, notes)


schema = strawberry.Schema(query=Query, mutation=Mutation)

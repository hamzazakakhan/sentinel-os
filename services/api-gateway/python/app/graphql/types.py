from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Optional

import strawberry


@strawberry.enum
class ThreatSeverity(Enum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    INFORMATIONAL = "INFORMATIONAL"


@strawberry.enum
class AlertStatus(Enum):
    NEW = "NEW"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    INVESTIGATING = "INVESTIGATING"
    ESCALATED = "ESCALATED"
    RESOLVED = "RESOLVED"
    FALSE_POSITIVE = "FALSE_POSITIVE"
    CLOSED = "CLOSED"


@strawberry.enum
class DomainType(Enum):
    LAND = "LAND"
    AIR = "AIR"
    SEA = "SEA"
    CYBER = "CYBER"
    SPACE = "SPACE"
    INTELLIGENCE = "INTELLIGENCE"
    OSINT = "OSINT"


@strawberry.enum
class SensorStatus(Enum):
    ONLINE = "ONLINE"
    OFFLINE = "OFFLINE"
    DEGRADED = "DEGRADED"
    MAINTENANCE = "MAINTENANCE"
    DECOMMISSIONED = "DECOMMISSIONED"


@strawberry.enum
class SensorType(Enum):
    CCTV = "CCTV"
    DRONE = "DRONE"
    RADAR = "RADAR"
    IOT = "IOT"
    ACOUSTIC = "ACOUSTIC"
    SEISMIC = "SEISMIC"
    RF = "RF"
    LIDAR = "LIDAR"
    THERMAL = "THERMAL"
    SATELLITE = "SATELLITE"


# ── Input types ───────────────────────────────────────────────

@strawberry.input
class PaginationInput:
    first: int = 25
    after: Optional[str] = None
    last: Optional[int] = None
    before: Optional[str] = None


@strawberry.input
class AlertFilterInput:
    severities: Optional[list[ThreatSeverity]] = None
    statuses: Optional[list[AlertStatus]] = None
    domains: Optional[list[DomainType]] = None
    search: Optional[str] = None
    from_date: Optional[datetime] = None
    to_date: Optional[datetime] = None


@strawberry.input
class SensorFilterInput:
    statuses: Optional[list[SensorStatus]] = None
    types: Optional[list[SensorType]] = None
    zone: Optional[str] = None


@strawberry.input
class CyberEventFilterInput:
    severities: Optional[list[ThreatSeverity]] = None
    event_types: Optional[list[str]] = None
    source_ip: Optional[str] = None
    from_date: Optional[datetime] = None
    to_date: Optional[datetime] = None


# ── Output types ──────────────────────────────────────────────

@strawberry.type
class PageInfo:
    has_next_page: bool
    has_previous_page: bool
    start_cursor: Optional[str] = None
    end_cursor: Optional[str] = None
    total_count: int = 0


@strawberry.type
class AlertType:
    id: strawberry.ID
    title: str
    description: Optional[str]
    severity: ThreatSeverity
    status: AlertStatus
    domain: DomainType
    confidence: float
    tags: list[str]
    source_type: Optional[str]
    created_at: datetime
    updated_at: datetime


@strawberry.type
class AlertEdge:
    cursor: str
    node: AlertType


@strawberry.type
class AlertConnection:
    edges: list[AlertEdge]
    page_info: PageInfo


@strawberry.type
class SensorGQL:
    id: strawberry.ID
    name: str
    sensor_type: SensorType
    status: SensorStatus
    domain: DomainType
    last_heartbeat_at: Optional[datetime]
    created_at: datetime


@strawberry.type
class SensorEdge:
    cursor: str
    node: SensorGQL


@strawberry.type
class SensorConnection:
    edges: list[SensorEdge]
    page_info: PageInfo


@strawberry.type
class CyberEventGQL:
    id: strawberry.ID
    event_type: str
    source_ip: Optional[str]
    destination_ip: Optional[str]
    source_port: Optional[int]
    destination_port: Optional[int]
    protocol: Optional[str]
    severity: ThreatSeverity
    signature_name: Optional[str]
    detected_at: datetime


@strawberry.type
class CyberEventEdge:
    cursor: str
    node: CyberEventGQL


@strawberry.type
class CyberEventConnection:
    edges: list[CyberEventEdge]
    page_info: PageInfo


@strawberry.type
class ThreatIndicatorGQL:
    id: strawberry.ID
    indicator_type: str
    value: str
    severity: ThreatSeverity
    source_feed: Optional[str]
    confidence: float
    first_seen_at: datetime
    last_seen_at: datetime
    is_active: bool


@strawberry.type
class ThreatIndicatorEdge:
    cursor: str
    node: ThreatIndicatorGQL


@strawberry.type
class ThreatIndicatorConnection:
    edges: list[ThreatIndicatorEdge]
    page_info: PageInfo


@strawberry.type
class ResponseRuleGQL:
    id: strawberry.ID
    name: str
    description: Optional[str]
    severity_threshold: ThreatSeverity
    requires_approval: bool
    is_active: bool
    cooldown_minutes: int


@strawberry.type
class OsintFeedGQL:
    id: strawberry.ID
    name: str
    source_type: str
    is_active: bool
    poll_interval_sec: int
    items_collected: int
    last_poll: Optional[datetime]


@strawberry.type
class OsintItemGQL:
    id: strawberry.ID
    source_type: str
    source_name: Optional[str]
    content: strawberry.scalars.JSON
    sentiment_score: Optional[float]
    threat_score: Optional[float]
    collected_at: datetime
    published_at: Optional[datetime]


@strawberry.type
class OsintItemEdge:
    cursor: str
    node: OsintItemGQL


@strawberry.type
class OsintItemConnection:
    edges: list[OsintItemEdge]
    page_info: PageInfo


@strawberry.type
class DomainCount:
    domain: str
    count: int


@strawberry.type
class AlertStats:
    total: int
    critical: int
    high: int
    medium: int
    low: int
    unacknowledged: int
    by_domain: list[DomainCount]


@strawberry.type
class SensorStats:
    total: int
    online: int
    offline: int
    degraded: int


@strawberry.type
class CyberStats:
    total_events: int
    blocked: int
    critical_events: int


@strawberry.type
class DashboardData:
    alert_stats: AlertStats
    sensor_stats: SensorStats
    cyber_stats: CyberStats


@strawberry.type
class FusionStats:
    total_entities: int
    total_relationships: int
    threat_actors: int
    correlations_24h: int


@strawberry.type
class CorrelationGQL:
    id: strawberry.ID
    source_alert_id: str
    target_alert_id: str
    correlation_type: str
    confidence: float
    hypothesis: str
    created_at: datetime


@strawberry.type
class PendingApprovalGQL:
    id: strawberry.ID
    rule_name: str
    justification: str
    trigger: str
    expires_at: str
    expires_in: str


# ── Mutation results ──────────────────────────────────────────

@strawberry.type
class AuthTokens:
    access_token: str
    refresh_token: str
    expires_in: int


@strawberry.type
class MutationResult:
    success: bool
    message: str
    id: Optional[strawberry.ID] = None

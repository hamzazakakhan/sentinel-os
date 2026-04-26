from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum as SAEnum,
    Float,
    ForeignKey,
    Index,
    Integer,
    Interval,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, INET, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from geoalchemy2 import Geometry

from app.db.postgres import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_uuid() -> uuid.UUID:
    return uuid.uuid4()


class ThreatSeverity(str, enum.Enum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    INFORMATIONAL = "INFORMATIONAL"


class AlertStatus(str, enum.Enum):
    NEW = "NEW"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    INVESTIGATING = "INVESTIGATING"
    ESCALATED = "ESCALATED"
    RESOLVED = "RESOLVED"
    FALSE_POSITIVE = "FALSE_POSITIVE"
    CLOSED = "CLOSED"


class DomainType(str, enum.Enum):
    LAND = "LAND"
    AIR = "AIR"
    SEA = "SEA"
    CYBER = "CYBER"
    SPACE = "SPACE"
    INTELLIGENCE = "INTELLIGENCE"
    OSINT = "OSINT"


class SensorStatus(str, enum.Enum):
    ONLINE = "ONLINE"
    OFFLINE = "OFFLINE"
    DEGRADED = "DEGRADED"
    MAINTENANCE = "MAINTENANCE"
    DECOMMISSIONED = "DECOMMISSIONED"


class SensorType(str, enum.Enum):
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


class UserRole(str, enum.Enum):
    SYSTEM_ADMIN = "SYSTEM_ADMIN"
    SECURITY_ADMIN = "SECURITY_ADMIN"
    ANALYST = "ANALYST"
    OPERATOR = "OPERATOR"
    COMMANDER = "COMMANDER"
    INTELLIGENCE_OFFICER = "INTELLIGENCE_OFFICER"
    CYBER_OPERATOR = "CYBER_OPERATOR"
    OSINT_ANALYST = "OSINT_ANALYST"
    AUDITOR = "AUDITOR"
    VIEWER = "VIEWER"
    API_SERVICE = "API_SERVICE"


class ClassificationLevel(str, enum.Enum):
    UNCLASSIFIED = "UNCLASSIFIED"
    CONFIDENTIAL = "CONFIDENTIAL"
    SECRET = "SECRET"
    TOP_SECRET = "TOP_SECRET"
    SCI = "SCI"


class ResponseActionType(str, enum.Enum):
    BLOCK_IP = "BLOCK_IP"
    ISOLATE_HOST = "ISOLATE_HOST"
    QUARANTINE_FILE = "QUARANTINE_FILE"
    DISABLE_ACCOUNT = "DISABLE_ACCOUNT"
    ALERT_OPERATOR = "ALERT_OPERATOR"
    DISPATCH_UNIT = "DISPATCH_UNIT"
    LOCK_PERIMETER = "LOCK_PERIMETER"
    ACTIVATE_COUNTERMEASURE = "ACTIVATE_COUNTERMEASURE"
    ESCALATE = "ESCALATE"
    LOG_ONLY = "LOG_ONLY"
    CUSTOM = "CUSTOM"


# ── Organization ──────────────────────────────────────────────

class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    short_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    parent_org_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    classification_ceiling: Mapped[ClassificationLevel] = mapped_column(
        SAEnum(ClassificationLevel, name="classification_level", create_type=False),
        default=ClassificationLevel.UNCLASSIFIED,
    )
    country_code: Mapped[str] = mapped_column(String(3), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    users: Mapped[list[User]] = relationship(back_populates="organization")
    sensors: Mapped[list[Sensor]] = relationship(back_populates="organization")


# ── User ──────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        Index("ix_users_org_role", "organization_id", "role"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        SAEnum(UserRole, name="user_role", create_type=False),
        default=UserRole.VIEWER,
    )
    clearance_level: Mapped[ClassificationLevel] = mapped_column(
        SAEnum(ClassificationLevel, name="classification_level", create_type=False),
        default=ClassificationLevel.UNCLASSIFIED,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failed_login_count: Mapped[int] = mapped_column(Integer, default=0)
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    mfa_secret_enc: Mapped[bytes | None] = mapped_column(nullable=True)
    mfa_recovery_codes_enc: Mapped[bytes | None] = mapped_column(nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_login_ip: Mapped[str | None] = mapped_column(INET(), nullable=True)
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    federation_provider: Mapped[str | None] = mapped_column(String(100), nullable=True)
    federation_subject: Mapped[str | None] = mapped_column(String(255), nullable=True)
    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    organization: Mapped[Organization] = relationship(back_populates="users")


# ── Sensor ────────────────────────────────────────────────────

class Sensor(Base):
    __tablename__ = "sensors"
    __table_args__ = (
        Index("ix_sensors_status", "status"),
        Index("ix_sensors_type", "sensor_type"),
        Index("ix_sensors_org", "organization_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    sensor_type: Mapped[SensorType] = mapped_column(SAEnum(SensorType, name="sensor_type", create_type=False))
    status: Mapped[SensorStatus] = mapped_column(
        SAEnum(SensorStatus, name="sensor_status", create_type=False), default=SensorStatus.OFFLINE
    )
    domain: Mapped[DomainType] = mapped_column(
        SAEnum(DomainType, name="domain_type", create_type=False)
    )
    location = mapped_column(Geometry(geometry_type="POINT", srid=4326), nullable=True)
    altitude_meters: Mapped[float | None] = mapped_column(Float, nullable=True)
    heading_degrees: Mapped[float | None] = mapped_column(Float, nullable=True)
    field_of_view_deg: Mapped[float | None] = mapped_column(Float, nullable=True)
    range_meters: Mapped[float | None] = mapped_column(Float, nullable=True)
    connection_uri: Mapped[str | None] = mapped_column(Text, nullable=True)
    connection_protocol: Mapped[str | None] = mapped_column(String(50), nullable=True)
    edge_node_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    firmware_version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    calibration_data: Mapped[dict] = mapped_column(JSONB, default=dict)
    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    classification: Mapped[ClassificationLevel] = mapped_column(
        SAEnum(ClassificationLevel, name="classification_level", create_type=False),
        default=ClassificationLevel.UNCLASSIFIED,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    organization: Mapped[Organization] = relationship(back_populates="sensors")
    detections: Mapped[list[Detection]] = relationship(back_populates="sensor")


# ── Detection ─────────────────────────────────────────────────

class Detection(Base):
    __tablename__ = "detections"
    __table_args__ = (
        Index("ix_detections_time", "detected_at"),
        Index("ix_detections_domain", "domain"),
        Index("ix_detections_sensor", "sensor_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    sensor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sensors.id"), nullable=False)
    domain: Mapped[DomainType] = mapped_column(SAEnum(DomainType, name="domain_type", create_type=False))
    detection_type: Mapped[str] = mapped_column(String(100), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    location = mapped_column(Geometry(geometry_type="POINT", srid=4326), nullable=True)
    bounding_box: Mapped[dict] = mapped_column(JSONB, default=dict)
    raw_data_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    model_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    model_version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    attributes: Mapped[dict] = mapped_column(JSONB, default=dict)
    classification: Mapped[ClassificationLevel] = mapped_column(
        SAEnum(ClassificationLevel, name="classification_level", create_type=False),
        default=ClassificationLevel.UNCLASSIFIED,
    )
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    sensor: Mapped[Sensor] = relationship(back_populates="detections")


# ── Alert ─────────────────────────────────────────────────────

class Alert(Base):
    __tablename__ = "alerts"
    __table_args__ = (
        Index("ix_alerts_severity", "severity"),
        Index("ix_alerts_status", "status"),
        Index("ix_alerts_domain", "domain"),
        Index("ix_alerts_created", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    severity: Mapped[ThreatSeverity] = mapped_column(SAEnum(ThreatSeverity, name="threat_severity", create_type=False))
    status: Mapped[AlertStatus] = mapped_column(
        SAEnum(AlertStatus, name="alert_status", create_type=False), default=AlertStatus.NEW
    )
    domain: Mapped[DomainType] = mapped_column(SAEnum(DomainType, name="domain_type", create_type=False))
    source_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    source_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    location = mapped_column(Geometry(geometry_type="POINT", srid=4326), nullable=True)
    affected_area = mapped_column(Geometry(geometry_type="POLYGON", srid=4326), nullable=True)
    correlation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    assigned_to: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    acknowledged_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolution_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    related_alert_ids: Mapped[list] = mapped_column(ARRAY(UUID(as_uuid=True)), default=list)
    tags: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    classification: Mapped[ClassificationLevel] = mapped_column(
        SAEnum(ClassificationLevel, name="classification_level", create_type=False),
        default=ClassificationLevel.UNCLASSIFIED,
    )
    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


# ── CyberEvent ────────────────────────────────────────────────

class CyberEvent(Base):
    __tablename__ = "cyber_events"
    __table_args__ = (
        Index("ix_cyber_events_time", "detected_at"),
        Index("ix_cyber_events_type", "event_type"),
        Index("ix_cyber_events_severity", "severity"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    source_ip: Mapped[str | None] = mapped_column(INET(), nullable=True)
    destination_ip: Mapped[str | None] = mapped_column(INET(), nullable=True)
    source_port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    destination_port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    protocol: Mapped[str | None] = mapped_column(String(20), nullable=True)
    signature_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    signature_name: Mapped[str | None] = mapped_column(String(500), nullable=True)
    severity: Mapped[ThreatSeverity] = mapped_column(
        SAEnum(ThreatSeverity, name="threat_severity", create_type=False)
    )
    payload_excerpt: Mapped[str | None] = mapped_column(Text, nullable=True)
    raw_log_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    ioc_matches: Mapped[dict] = mapped_column(JSONB, default=dict)
    mitre_techniques: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    geo_source: Mapped[dict] = mapped_column(JSONB, default=dict)
    geo_destination: Mapped[dict] = mapped_column(JSONB, default=dict)
    alert_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    sensor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    classification: Mapped[ClassificationLevel] = mapped_column(
        SAEnum(ClassificationLevel, name="classification_level", create_type=False),
        default=ClassificationLevel.UNCLASSIFIED,
    )
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ── ThreatIndicator ───────────────────────────────────────────

class ThreatIndicator(Base):
    __tablename__ = "threat_indicators"
    __table_args__ = (
        Index("ix_threat_ind_type", "indicator_type"),
        Index("ix_threat_ind_value", "value"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    indicator_type: Mapped[str] = mapped_column(String(50), nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    threat_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    source_feed: Mapped[str | None] = mapped_column(String(255), nullable=True)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    severity: Mapped[ThreatSeverity] = mapped_column(
        SAEnum(ThreatSeverity, name="threat_severity", create_type=False)
    )
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    tags: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    context: Mapped[dict] = mapped_column(JSONB, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ── ResponseRule ──────────────────────────────────────────────

class ResponseRule(Base):
    __tablename__ = "response_rules"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    conditions: Mapped[dict] = mapped_column(JSONB, nullable=False)
    actions: Mapped[dict] = mapped_column(JSONB, nullable=False)
    action_type: Mapped[ResponseActionType] = mapped_column(
        SAEnum(ResponseActionType, name="response_action_type", create_type=False)
    )
    severity_threshold: Mapped[ThreatSeverity] = mapped_column(
        SAEnum(ThreatSeverity, name="threat_severity", create_type=False)
    )
    requires_approval: Mapped[bool] = mapped_column(Boolean, default=True)
    approval_timeout_min: Mapped[int] = mapped_column(Integer, default=15)
    cooldown_minutes: Mapped[int] = mapped_column(Integer, default=5)
    max_executions_per_hour: Mapped[int] = mapped_column(Integer, default=10)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    priority: Mapped[int] = mapped_column(Integer, default=5)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    classification: Mapped[ClassificationLevel] = mapped_column(
        SAEnum(ClassificationLevel, name="classification_level", create_type=False),
        default=ClassificationLevel.UNCLASSIFIED,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


# ── OsintFeed ─────────────────────────────────────────────────

class OsintFeed(Base):
    __tablename__ = "osint_feeds"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    source_type: Mapped[str] = mapped_column(String(50), nullable=False)
    url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    poll_interval_sec: Mapped[int] = mapped_column(Integer, default=300)
    last_poll: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    items_collected: Mapped[int] = mapped_column(Integer, default=0)
    config: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class OsintItem(Base):
    __tablename__ = "osint_items"
    __table_args__ = (
        Index("ix_osint_items_collected", "collected_at"),
        Index("ix_osint_items_source", "source_type"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    feed_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("osint_feeds.id"), nullable=True)
    source_type: Mapped[str] = mapped_column(String(50), nullable=False)
    source_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    content: Mapped[dict] = mapped_column(JSONB, default=dict)
    sentiment_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    threat_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    entities: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    indicators: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    collected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

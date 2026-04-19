-- ══════════════════════════════════════════════════════════════
-- ORGANIZATIONS & MULTI-AGENCY
-- ══════════════════════════════════════════════════════════════

CREATE TABLE organizations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL UNIQUE,
    short_code      VARCHAR(16) NOT NULL UNIQUE,
    parent_org_id   UUID REFERENCES organizations(id),
    classification_ceiling classification_level NOT NULL DEFAULT 'UNCLASSIFIED',
    country_code    CHAR(3) NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_organizations_parent ON organizations(parent_org_id);
CREATE INDEX idx_organizations_country ON organizations(country_code);

-- ══════════════════════════════════════════════════════════════
-- USERS & AUTHENTICATION
-- ══════════════════════════════════════════════════════════════

CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id     UUID NOT NULL REFERENCES organizations(id),
    username            VARCHAR(128) NOT NULL,
    email               VARCHAR(255) NOT NULL,
    password_hash       VARCHAR(255),
    role                user_role NOT NULL DEFAULT 'VIEWER',
    clearance_level     classification_level NOT NULL DEFAULT 'UNCLASSIFIED',
    is_active           BOOLEAN NOT NULL DEFAULT true,
    is_locked           BOOLEAN NOT NULL DEFAULT false,
    locked_until        TIMESTAMPTZ,
    failed_login_count  INT NOT NULL DEFAULT 0,
    mfa_enabled         BOOLEAN NOT NULL DEFAULT false,
    mfa_secret_enc      BYTEA,
    mfa_recovery_codes_enc BYTEA,
    last_login_at       TIMESTAMPTZ,
    last_login_ip       INET,
    password_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    federation_provider VARCHAR(64),
    federation_subject  VARCHAR(512),
    metadata            JSONB NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, username),
    UNIQUE(email)
);

CREATE INDEX idx_users_org ON users(organization_id);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_federation ON users(federation_provider, federation_subject);

CREATE TABLE user_sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash VARCHAR(128) NOT NULL UNIQUE,
    ip_address      INET NOT NULL,
    user_agent      TEXT,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_sessions_expires ON user_sessions(expires_at);

CREATE TABLE api_keys (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            VARCHAR(128) NOT NULL,
    key_hash        VARCHAR(128) NOT NULL UNIQUE,
    key_prefix      VARCHAR(12) NOT NULL,
    permissions     JSONB NOT NULL DEFAULT '[]',
    rate_limit      INT NOT NULL DEFAULT 1000,
    expires_at      TIMESTAMPTZ,
    last_used_at    TIMESTAMPTZ,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_keys_user ON api_keys(user_id);
CREATE INDEX idx_api_keys_prefix ON api_keys(key_prefix);

-- ══════════════════════════════════════════════════════════════
-- RBAC: PERMISSIONS & POLICIES
-- ══════════════════════════════════════════════════════════════

CREATE TABLE permissions (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    resource    VARCHAR(128) NOT NULL,
    action      VARCHAR(64) NOT NULL,
    description TEXT,
    UNIQUE(resource, action)
);

CREATE TABLE role_permissions (
    role        user_role NOT NULL,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    conditions  JSONB NOT NULL DEFAULT '{}',
    granted_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (role, permission_id)
);

CREATE TABLE data_access_policies (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                VARCHAR(255) NOT NULL UNIQUE,
    description         TEXT,
    classification_min  classification_level NOT NULL DEFAULT 'UNCLASSIFIED',
    classification_max  classification_level NOT NULL DEFAULT 'UNCLASSIFIED',
    allowed_domains     domain_type[] NOT NULL DEFAULT '{}',
    allowed_org_ids     UUID[] NOT NULL DEFAULT '{}',
    conditions          JSONB NOT NULL DEFAULT '{}',
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════
-- SENSORS & DEVICES
-- ══════════════════════════════════════════════════════════════

CREATE TABLE sensors (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id     UUID NOT NULL REFERENCES organizations(id),
    name                VARCHAR(255) NOT NULL,
    sensor_type         sensor_type NOT NULL,
    status              sensor_status NOT NULL DEFAULT 'OFFLINE',
    domain              domain_type NOT NULL,
    location            GEOMETRY(Point, 4326),
    altitude_meters     DOUBLE PRECISION,
    heading_degrees     DOUBLE PRECISION,
    field_of_view_deg   DOUBLE PRECISION,
    range_meters        DOUBLE PRECISION,
    connection_uri      TEXT,
    connection_protocol VARCHAR(32),
    edge_node_id        UUID,
    firmware_version    VARCHAR(64),
    last_heartbeat_at   TIMESTAMPTZ,
    calibration_data    JSONB NOT NULL DEFAULT '{}',
    metadata            JSONB NOT NULL DEFAULT '{}',
    classification      classification_level NOT NULL DEFAULT 'UNCLASSIFIED',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sensors_org ON sensors(organization_id);
CREATE INDEX idx_sensors_type ON sensors(sensor_type);
CREATE INDEX idx_sensors_status ON sensors(status);
CREATE INDEX idx_sensors_domain ON sensors(domain);
CREATE INDEX idx_sensors_location ON sensors USING GIST(location);
CREATE INDEX idx_sensors_edge_node ON sensors(edge_node_id);

CREATE TABLE edge_nodes (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id     UUID NOT NULL REFERENCES organizations(id),
    hostname            VARCHAR(255) NOT NULL,
    ip_address          INET NOT NULL,
    location            GEOMETRY(Point, 4326),
    capabilities        JSONB NOT NULL DEFAULT '{}',
    gpu_available       BOOLEAN NOT NULL DEFAULT false,
    status              sensor_status NOT NULL DEFAULT 'OFFLINE',
    last_heartbeat_at   TIMESTAMPTZ,
    os_version          VARCHAR(128),
    agent_version       VARCHAR(64),
    resource_usage      JSONB NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sensors ADD CONSTRAINT fk_sensors_edge_node 
    FOREIGN KEY (edge_node_id) REFERENCES edge_nodes(id);

-- ══════════════════════════════════════════════════════════════
-- DETECTIONS & ALERTS
-- ══════════════════════════════════════════════════════════════

CREATE TABLE detections (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sensor_id           UUID NOT NULL REFERENCES sensors(id),
    domain              domain_type NOT NULL,
    detection_type      VARCHAR(128) NOT NULL,
    confidence          DOUBLE PRECISION NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    location            GEOMETRY(Point, 4326),
    bounding_box        JSONB,
    raw_data_ref        TEXT,
    model_id            UUID,
    model_version       VARCHAR(64),
    attributes          JSONB NOT NULL DEFAULT '{}',
    classification      classification_level NOT NULL DEFAULT 'UNCLASSIFIED',
    detected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ingested_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at        TIMESTAMPTZ
);

SELECT create_hypertable('detections', 'detected_at',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

CREATE INDEX idx_detections_sensor ON detections(sensor_id, detected_at DESC);
CREATE INDEX idx_detections_type ON detections(detection_type, detected_at DESC);
CREATE INDEX idx_detections_domain ON detections(domain, detected_at DESC);
CREATE INDEX idx_detections_confidence ON detections(confidence DESC, detected_at DESC);
CREATE INDEX idx_detections_location ON detections USING GIST(location);

CREATE TABLE alerts (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id     UUID NOT NULL REFERENCES organizations(id),
    title               VARCHAR(512) NOT NULL,
    description         TEXT,
    severity            threat_severity NOT NULL,
    status              alert_status NOT NULL DEFAULT 'NEW',
    domain              domain_type NOT NULL,
    source_type         VARCHAR(64) NOT NULL,
    source_id           UUID,
    location            GEOMETRY(Point, 4326),
    affected_area       GEOMETRY(Polygon, 4326),
    correlation_id      UUID,
    assigned_to         UUID REFERENCES users(id),
    acknowledged_by     UUID REFERENCES users(id),
    acknowledged_at     TIMESTAMPTZ,
    resolved_by         UUID REFERENCES users(id),
    resolved_at         TIMESTAMPTZ,
    resolution_notes    TEXT,
    confidence          DOUBLE PRECISION NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
    source_reliability  source_reliability NOT NULL DEFAULT 'F_CANNOT_BE_JUDGED',
    info_credibility    information_credibility NOT NULL DEFAULT '6_CANNOT_BE_JUDGED',
    related_alert_ids   UUID[] NOT NULL DEFAULT '{}',
    tags                TEXT[] NOT NULL DEFAULT '{}',
    classification      classification_level NOT NULL DEFAULT 'UNCLASSIFIED',
    metadata            JSONB NOT NULL DEFAULT '{}',
    ttl                 INTERVAL,
    expires_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

SELECT create_hypertable('alerts', 'created_at',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists => TRUE
);

CREATE INDEX idx_alerts_org ON alerts(organization_id, created_at DESC);
CREATE INDEX idx_alerts_severity ON alerts(severity, created_at DESC);
CREATE INDEX idx_alerts_status ON alerts(status, created_at DESC);
CREATE INDEX idx_alerts_domain ON alerts(domain, created_at DESC);
CREATE INDEX idx_alerts_assigned ON alerts(assigned_to) WHERE status NOT IN ('RESOLVED', 'CLOSED');
CREATE INDEX idx_alerts_correlation ON alerts(correlation_id);
CREATE INDEX idx_alerts_location ON alerts USING GIST(location);
CREATE INDEX idx_alerts_area ON alerts USING GIST(affected_area);
CREATE INDEX idx_alerts_tags ON alerts USING GIN(tags);
CREATE INDEX idx_alerts_classification ON alerts(classification);

-- ══════════════════════════════════════════════════════════════
-- TRACKS (Unified Entity Tracking)
-- ══════════════════════════════════════════════════════════════

CREATE TABLE tracks (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id     UUID NOT NULL REFERENCES organizations(id),
    track_number        VARCHAR(32) NOT NULL,
    entity_type         VARCHAR(64) NOT NULL,
    identity            VARCHAR(64),
    domain              domain_type NOT NULL,
    current_location    GEOMETRY(Point, 4326),
    altitude_meters     DOUBLE PRECISION,
    speed_mps           DOUBLE PRECISION,
    heading_degrees     DOUBLE PRECISION,
    course_history      GEOMETRY(LineString, 4326),
    first_detected_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_sensor_ids   UUID[] NOT NULL DEFAULT '{}',
    confidence          DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    threat_assessment   threat_severity,
    attributes          JSONB NOT NULL DEFAULT '{}',
    classification      classification_level NOT NULL DEFAULT 'UNCLASSIFIED',
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tracks_org ON tracks(organization_id);
CREATE INDEX idx_tracks_number ON tracks(track_number);
CREATE INDEX idx_tracks_domain ON tracks(domain);
CREATE INDEX idx_tracks_location ON tracks USING GIST(current_location);
CREATE INDEX idx_tracks_active ON tracks(is_active) WHERE is_active = true;
CREATE INDEX idx_tracks_threat ON tracks(threat_assessment) WHERE threat_assessment IS NOT NULL;

CREATE TABLE track_history (
    id              UUID DEFAULT uuid_generate_v4(),
    track_id        UUID NOT NULL REFERENCES tracks(id),
    location        GEOMETRY(Point, 4326) NOT NULL,
    altitude_meters DOUBLE PRECISION,
    speed_mps       DOUBLE PRECISION,
    heading_degrees DOUBLE PRECISION,
    sensor_id       UUID REFERENCES sensors(id),
    attributes      JSONB NOT NULL DEFAULT '{}',
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, recorded_at)
);

SELECT create_hypertable('track_history', 'recorded_at',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

CREATE INDEX idx_track_history_track ON track_history(track_id, recorded_at DESC);

-- ══════════════════════════════════════════════════════════════
-- MISSIONS & TASKING
-- ══════════════════════════════════════════════════════════════

CREATE TABLE missions (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id     UUID NOT NULL REFERENCES organizations(id),
    name                VARCHAR(255) NOT NULL,
    description         TEXT,
    status              mission_status NOT NULL DEFAULT 'PLANNED',
    commander_id        UUID REFERENCES users(id),
    area_of_operations  GEOMETRY(Polygon, 4326),
    start_time          TIMESTAMPTZ,
    end_time            TIMESTAMPTZ,
    objectives          JSONB NOT NULL DEFAULT '[]',
    rules_of_engagement TEXT,
    classification      classification_level NOT NULL DEFAULT 'CONFIDENTIAL',
    metadata            JSONB NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_missions_org ON missions(organization_id);
CREATE INDEX idx_missions_status ON missions(status);
CREATE INDEX idx_missions_commander ON missions(commander_id);
CREATE INDEX idx_missions_aoo ON missions USING GIST(area_of_operations);

CREATE TABLE tasks (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mission_id          UUID REFERENCES missions(id),
    organization_id     UUID NOT NULL REFERENCES organizations(id),
    title               VARCHAR(512) NOT NULL,
    description         TEXT,
    status              task_status NOT NULL DEFAULT 'PENDING',
    priority            task_priority NOT NULL DEFAULT 'ROUTINE',
    assigned_to         UUID REFERENCES users(id),
    assigned_unit       VARCHAR(128),
    parent_task_id      UUID REFERENCES tasks(id),
    depends_on          UUID[] NOT NULL DEFAULT '{}',
    due_at              TIMESTAMPTZ,
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    location            GEOMETRY(Point, 4326),
    resources_required  JSONB NOT NULL DEFAULT '[]',
    resources_allocated JSONB NOT NULL DEFAULT '[]',
    outcome             TEXT,
    classification      classification_level NOT NULL DEFAULT 'CONFIDENTIAL',
    metadata            JSONB NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tasks_mission ON tasks(mission_id);
CREATE INDEX idx_tasks_org ON tasks(organization_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_priority ON tasks(priority);
CREATE INDEX idx_tasks_assigned ON tasks(assigned_to);
CREATE INDEX idx_tasks_parent ON tasks(parent_task_id);

-- ══════════════════════════════════════════════════════════════
-- RESPONSE ACTIONS & APPROVAL WORKFLOWS
-- ══════════════════════════════════════════════════════════════

CREATE TABLE response_rules (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id     UUID NOT NULL REFERENCES organizations(id),
    name                VARCHAR(255) NOT NULL,
    description         TEXT,
    conditions          JSONB NOT NULL,
    actions             JSONB NOT NULL,
    action_type         response_action_type NOT NULL,
    severity_threshold  threat_severity NOT NULL DEFAULT 'HIGH',
    requires_approval   BOOLEAN NOT NULL DEFAULT true,
    approval_timeout_min INT NOT NULL DEFAULT 15,
    cooldown_minutes    INT NOT NULL DEFAULT 5,
    max_executions_per_hour INT NOT NULL DEFAULT 10,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    priority            INT NOT NULL DEFAULT 100,
    created_by          UUID REFERENCES users(id),
    classification      classification_level NOT NULL DEFAULT 'CONFIDENTIAL',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_response_rules_org ON response_rules(organization_id);
CREATE INDEX idx_response_rules_active ON response_rules(is_active, priority);

CREATE TABLE response_executions (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rule_id             UUID NOT NULL REFERENCES response_rules(id),
    alert_id            UUID,
    action_type         response_action_type NOT NULL,
    parameters          JSONB NOT NULL DEFAULT '{}',
    approval_status     approval_status NOT NULL DEFAULT 'PENDING',
    approved_by         UUID REFERENCES users(id),
    approved_at         TIMESTAMPTZ,
    executed_at         TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    result              JSONB,
    error               TEXT,
    rollback_data       JSONB,
    rolled_back_at      TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_response_exec_rule ON response_executions(rule_id);
CREATE INDEX idx_response_exec_alert ON response_executions(alert_id);
CREATE INDEX idx_response_exec_status ON response_executions(approval_status);

CREATE TABLE approval_requests (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    execution_id        UUID NOT NULL REFERENCES response_executions(id),
    requested_by        UUID REFERENCES users(id),
    approver_role       user_role NOT NULL,
    approver_id         UUID REFERENCES users(id),
    status              approval_status NOT NULL DEFAULT 'PENDING',
    justification       TEXT,
    decision_notes      TEXT,
    expires_at          TIMESTAMPTZ NOT NULL,
    decided_at          TIMESTAMPTZ,
    escalated_to        UUID REFERENCES users(id),
    escalated_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_approval_execution ON approval_requests(execution_id);
CREATE INDEX idx_approval_approver ON approval_requests(approver_id, status);
CREATE INDEX idx_approval_expires ON approval_requests(expires_at) WHERE status = 'PENDING';

-- ══════════════════════════════════════════════════════════════
-- AI MODEL REGISTRY & GOVERNANCE
-- ══════════════════════════════════════════════════════════════

CREATE TABLE ai_models (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                VARCHAR(255) NOT NULL,
    version             VARCHAR(64) NOT NULL,
    model_type          VARCHAR(64) NOT NULL,
    framework           VARCHAR(64) NOT NULL,
    status              model_status NOT NULL DEFAULT 'TRAINING',
    artifact_path       TEXT NOT NULL,
    input_schema        JSONB NOT NULL,
    output_schema       JSONB NOT NULL,
    hyperparameters     JSONB NOT NULL DEFAULT '{}',
    training_metrics    JSONB NOT NULL DEFAULT '{}',
    validation_metrics  JSONB NOT NULL DEFAULT '{}',
    training_data_ref   TEXT,
    training_started_at TIMESTAMPTZ,
    training_completed_at TIMESTAMPTZ,
    deployed_at         TIMESTAMPTZ,
    retired_at          TIMESTAMPTZ,
    created_by          UUID REFERENCES users(id),
    approved_by         UUID REFERENCES users(id),
    metadata            JSONB NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(name, version)
);

CREATE INDEX idx_ai_models_status ON ai_models(status);
CREATE INDEX idx_ai_models_type ON ai_models(model_type);

CREATE TABLE model_drift_metrics (
    id              UUID DEFAULT uuid_generate_v4(),
    model_id        UUID NOT NULL REFERENCES ai_models(id),
    metric_name     VARCHAR(128) NOT NULL,
    baseline_value  DOUBLE PRECISION NOT NULL,
    current_value   DOUBLE PRECISION NOT NULL,
    drift_score     DOUBLE PRECISION NOT NULL,
    threshold       DOUBLE PRECISION NOT NULL,
    is_drifted      BOOLEAN NOT NULL DEFAULT false,
    sample_size     INT NOT NULL,
    measured_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, measured_at)
);

SELECT create_hypertable('model_drift_metrics', 'measured_at',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

CREATE INDEX idx_drift_model ON model_drift_metrics(model_id, measured_at DESC);

CREATE TABLE model_predictions (
    id              UUID DEFAULT uuid_generate_v4(),
    model_id        UUID NOT NULL REFERENCES ai_models(id),
    input_hash      VARCHAR(64) NOT NULL,
    prediction      JSONB NOT NULL,
    confidence      DOUBLE PRECISION NOT NULL,
    latency_ms      INT NOT NULL,
    feedback        JSONB,
    is_correct      BOOLEAN,
    predicted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, predicted_at)
);

SELECT create_hypertable('model_predictions', 'predicted_at',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

CREATE INDEX idx_predictions_model ON model_predictions(model_id, predicted_at DESC);

-- ══════════════════════════════════════════════════════════════
-- CYBER DEFENSE
-- ══════════════════════════════════════════════════════════════

CREATE TABLE cyber_events (
    id                  UUID DEFAULT uuid_generate_v4(),
    organization_id     UUID NOT NULL REFERENCES organizations(id),
    event_type          VARCHAR(128) NOT NULL,
    source_ip           INET,
    destination_ip      INET,
    source_port         INT,
    destination_port    INT,
    protocol            VARCHAR(16),
    signature_id        VARCHAR(64),
    signature_name      VARCHAR(512),
    severity            threat_severity NOT NULL,
    payload_excerpt     TEXT,
    raw_log_ref         TEXT,
    ioc_matches         JSONB NOT NULL DEFAULT '[]',
    mitre_techniques    TEXT[] NOT NULL DEFAULT '{}',
    geo_source          JSONB,
    geo_destination     JSONB,
    alert_id            UUID,
    sensor_id           UUID REFERENCES sensors(id),
    classification      classification_level NOT NULL DEFAULT 'CONFIDENTIAL',
    detected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ingested_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, detected_at)
);

SELECT create_hypertable('cyber_events', 'detected_at',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

CREATE INDEX idx_cyber_events_org ON cyber_events(organization_id, detected_at DESC);
CREATE INDEX idx_cyber_events_type ON cyber_events(event_type, detected_at DESC);
CREATE INDEX idx_cyber_events_severity ON cyber_events(severity, detected_at DESC);
CREATE INDEX idx_cyber_events_src_ip ON cyber_events(source_ip, detected_at DESC);
CREATE INDEX idx_cyber_events_dst_ip ON cyber_events(destination_ip, detected_at DESC);
CREATE INDEX idx_cyber_events_sig ON cyber_events(signature_id);
CREATE INDEX idx_cyber_events_mitre ON cyber_events USING GIN(mitre_techniques);

CREATE TABLE threat_indicators (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    indicator_type      VARCHAR(64) NOT NULL,
    value               TEXT NOT NULL,
    threat_type         VARCHAR(128),
    source_feed         VARCHAR(128) NOT NULL,
    confidence          DOUBLE PRECISION NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    severity            threat_severity NOT NULL DEFAULT 'MEDIUM',
    first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ,
    tags                TEXT[] NOT NULL DEFAULT '{}',
    context             JSONB NOT NULL DEFAULT '{}',
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_threat_indicators_type_value ON threat_indicators(indicator_type, value);
CREATE INDEX idx_threat_indicators_source ON threat_indicators(source_feed);
CREATE INDEX idx_threat_indicators_active ON threat_indicators(is_active, expires_at);
CREATE INDEX idx_threat_indicators_tags ON threat_indicators USING GIN(tags);

-- ══════════════════════════════════════════════════════════════
-- AUDIT & GOVERNANCE
-- ══════════════════════════════════════════════════════════════

CREATE TABLE audit_log (
    id              UUID DEFAULT uuid_generate_v4(),
    user_id         UUID,
    organization_id UUID,
    action          VARCHAR(128) NOT NULL,
    resource_type   VARCHAR(128) NOT NULL,
    resource_id     UUID,
    old_values      JSONB,
    new_values      JSONB,
    ip_address      INET,
    user_agent      TEXT,
    request_id      UUID,
    session_id      UUID,
    result          VARCHAR(32) NOT NULL DEFAULT 'SUCCESS',
    error_message   TEXT,
    classification  classification_level NOT NULL DEFAULT 'CONFIDENTIAL',
    checksum        VARCHAR(128) NOT NULL,
    previous_checksum VARCHAR(128),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
);

SELECT create_hypertable('audit_log', 'created_at',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

CREATE INDEX idx_audit_user ON audit_log(user_id, created_at DESC);
CREATE INDEX idx_audit_org ON audit_log(organization_id, created_at DESC);
CREATE INDEX idx_audit_resource ON audit_log(resource_type, resource_id, created_at DESC);
CREATE INDEX idx_audit_action ON audit_log(action, created_at DESC);

CREATE TABLE data_classifications (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    resource_type   VARCHAR(128) NOT NULL,
    resource_id     UUID NOT NULL,
    classification  classification_level NOT NULL,
    caveats         TEXT[] NOT NULL DEFAULT '{}',
    releasable_to   VARCHAR(64)[] NOT NULL DEFAULT '{}',
    classified_by   UUID REFERENCES users(id),
    reason          TEXT,
    review_date     DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(resource_type, resource_id)
);

CREATE INDEX idx_data_class_resource ON data_classifications(resource_type, resource_id);
CREATE INDEX idx_data_class_level ON data_classifications(classification);

CREATE TABLE retention_policies (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                VARCHAR(255) NOT NULL UNIQUE,
    resource_type       VARCHAR(128) NOT NULL,
    classification      classification_level NOT NULL DEFAULT 'UNCLASSIFIED',
    retention_days      INT NOT NULL,
    archive_after_days  INT,
    delete_after_days   INT,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════
-- SIMULATION
-- ══════════════════════════════════════════════════════════════

CREATE TABLE simulations (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id     UUID NOT NULL REFERENCES organizations(id),
    name                VARCHAR(255) NOT NULL,
    description         TEXT,
    scenario_type       VARCHAR(64) NOT NULL,
    scenario_config     JSONB NOT NULL,
    area_of_interest    GEOMETRY(Polygon, 4326),
    status              mission_status NOT NULL DEFAULT 'PLANNED',
    time_acceleration   DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    results             JSONB,
    created_by          UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_simulations_org ON simulations(organization_id);
CREATE INDEX idx_simulations_status ON simulations(status);

-- ══════════════════════════════════════════════════════════════
-- COUNTER-INTELLIGENCE
-- ══════════════════════════════════════════════════════════════

CREATE TABLE honeypots (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id     UUID NOT NULL REFERENCES organizations(id),
    name                VARCHAR(255) NOT NULL,
    honeypot_type       VARCHAR(64) NOT NULL,
    deployment_config   JSONB NOT NULL,
    ip_address          INET,
    port                INT,
    status              sensor_status NOT NULL DEFAULT 'OFFLINE',
    interaction_count   BIGINT NOT NULL DEFAULT 0,
    last_interaction_at TIMESTAMPTZ,
    classification      classification_level NOT NULL DEFAULT 'SECRET',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE adversary_profiles (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id     UUID NOT NULL REFERENCES organizations(id),
    name                VARCHAR(255) NOT NULL,
    aliases             TEXT[] NOT NULL DEFAULT '{}',
    threat_actor_type   VARCHAR(64) NOT NULL,
    origin_country      CHAR(3),
    motivation          VARCHAR(128),
    sophistication      VARCHAR(32),
    known_ttps          JSONB NOT NULL DEFAULT '[]',
    known_iocs          JSONB NOT NULL DEFAULT '[]',
    mitre_groups        TEXT[] NOT NULL DEFAULT '{}',
    active_campaigns    JSONB NOT NULL DEFAULT '[]',
    first_observed_at   TIMESTAMPTZ,
    last_observed_at    TIMESTAMPTZ,
    confidence          DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    classification      classification_level NOT NULL DEFAULT 'SECRET',
    metadata            JSONB NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_adversary_org ON adversary_profiles(organization_id);
CREATE INDEX idx_adversary_aliases ON adversary_profiles USING GIN(aliases);

-- ══════════════════════════════════════════════════════════════
-- FUNCTIONS & TRIGGERS
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN
        SELECT table_name FROM information_schema.columns
        WHERE column_name = 'updated_at'
        AND table_schema = 'public'
        GROUP BY table_name
    LOOP
        EXECUTE format('
            CREATE TRIGGER trg_%I_updated_at
            BEFORE UPDATE ON %I
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at()',
            t, t);
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION compute_audit_checksum()
RETURNS TRIGGER AS $$
DECLARE
    prev_checksum TEXT;
    payload TEXT;
BEGIN
    SELECT checksum INTO prev_checksum
    FROM audit_log
    ORDER BY created_at DESC
    LIMIT 1;

    NEW.previous_checksum := prev_checksum;

    payload := COALESCE(NEW.user_id::TEXT, '') ||
               NEW.action ||
               NEW.resource_type ||
               COALESCE(NEW.resource_id::TEXT, '') ||
               NEW.created_at::TEXT ||
               COALESCE(prev_checksum, 'GENESIS');

    NEW.checksum := encode(digest(payload, 'sha256'), 'hex');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_checksum
BEFORE INSERT ON audit_log
FOR EACH ROW
EXECUTE FUNCTION compute_audit_checksum();

CREATE OR REPLACE FUNCTION check_clearance(
    p_user_id UUID,
    p_required_level classification_level
) RETURNS BOOLEAN AS $$
DECLARE
    user_level classification_level;
    level_order INT[];
BEGIN
    level_order := ARRAY[0, 1, 2, 3, 4];
    
    SELECT clearance_level INTO user_level
    FROM users WHERE id = p_user_id;
    
    IF user_level IS NULL THEN RETURN FALSE; END IF;
    
    RETURN array_position(
        ARRAY['UNCLASSIFIED','CONFIDENTIAL','SECRET','TOP_SECRET','SCI']::classification_level[],
        user_level
    ) >= array_position(
        ARRAY['UNCLASSIFIED','CONFIDENTIAL','SECRET','TOP_SECRET','SCI']::classification_level[],
        p_required_level
    );
END;
$$ LANGUAGE plpgsql STABLE;

ALTER TABLE detections ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cyber_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_isolation_detections ON detections
    USING (
        EXISTS (
            SELECT 1 FROM sensors s
            WHERE s.id = detections.sensor_id
            AND s.organization_id IN (
                SELECT organization_id FROM users WHERE id = current_setting('app.current_user_id')::UUID
            )
        )
    );

CREATE POLICY org_isolation_alerts ON alerts
    USING (
        organization_id IN (
            SELECT organization_id FROM users WHERE id = current_setting('app.current_user_id')::UUID
        )
    );

CREATE POLICY org_isolation_missions ON missions
    USING (
        organization_id IN (
            SELECT organization_id FROM users WHERE id = current_setting('app.current_user_id')::UUID
        )
    );

CREATE POLICY org_isolation_tasks ON tasks
    USING (
        organization_id IN (
            SELECT organization_id FROM users WHERE id = current_setting('app.current_user_id')::UUID
        )
    );

CREATE POLICY org_isolation_cyber ON cyber_events
    USING (
        organization_id IN (
            SELECT organization_id FROM users WHERE id = current_setting('app.current_user_id')::UUID
        )
    );

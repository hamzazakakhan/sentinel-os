# Sentinel OS

**Production-Ready Defense & Intelligence Operating System**

A real-time, scalable C4ISR (Command, Control, Communications, Computers, Intelligence, Surveillance, and Reconnaissance) platform built on microservices architecture with event-driven Kafka backbone, Istio service mesh, and AI-powered analytics.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Istio Ingress Gateway                     │
│                   (TLS 1.3 / mTLS / JWT Auth)                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │  Sentinel UI  │  │ API Gateway  │  │ Auth Service │           │
│  │  (React/TS)   │  │  (GraphQL)   │  │ (JWT/MFA)    │           │
│  └──────────────┘  └──────┬───────┘  └──────────────┘           │
│                           │                                       │
│  ┌────────────────────────┼────────────────────────────┐         │
│  │              Apache Kafka (Event Bus)                │         │
│  │  3-broker cluster, 25+ topics, Strimzi operator     │         │
│  └────────┬───────┬───────┬───────┬───────┬────────────┘         │
│           │       │       │       │       │                       │
│  ┌────────┴┐ ┌────┴────┐ ┌┴──────┐ ┌─────┴──┐ ┌────────┐       │
│  │Ingestion│ │   AI    │ │ OSINT │ │ Fusion │ │  Cyber │       │
│  │ Service │ │ Service │ │Service│ │Service │ │Service │       │
│  │RTSP/MQTT│ │YOLOv8   │ │RSS/API│ │Neo4j   │ │IDS/SIEM│       │
│  │Radar/WS │ │IF/LSTM  │ │Scrape │ │Graph   │ │ELK     │       │
│  │Webhook  │ │Ollama   │ │NLP    │ │Correlat│ │ThreatFd│       │
│  └─────────┘ └─────────┘ └───────┘ └────────┘ └────────┘       │
│           │                                       │               │
│  ┌────────┴────────┐  ┌──────────────────────────┴──┐           │
│  │Response Service  │  │   Governance / Simulation   │           │
│  │Rule Engine       │  │   Audit / Counter-Intel     │           │
│  │Approval Workflows│  │   Digital Twin              │           │
│  └─────────────────┘  └─────────────────────────────┘           │
│                                                                   │
├─────────────────────────────────────────────────────────────────┤
│  PostgreSQL+PostGIS │ MongoDB │ Neo4j │ Redis │ Elasticsearch   │
│  TimescaleDB+RLS    │ GridFS  │ Graph │ Cache │ SIEM Indexing   │
└─────────────────────────────────────────────────────────────────┘
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| **API Gateway** | 4000 | GraphQL gateway with subscriptions, directives, rate limiting |
| **Auth Service** | 4001 | JWT RS256, MFA/TOTP, RBAC, API keys, session management |
| **Ingestion Service** | 4002 | RTSP/MQTT/Radar/Drone/Webhook connectors, edge processing |
| **AI Service** | 4003 | YOLOv8, Isolation Forest, LSTM, Ollama LLM, drift monitoring |
| **OSINT Service** | 4004 | RSS/API/Scrape feeds, IOC extraction, NLP, misinformation detection |
| **Fusion Service** | 4005 | Neo4j graph correlation, geospatial proximity, entity linking |
| **Cyber Service** | 4006 | Suricata IDS integration, ELK SIEM, threat intel feeds |
| **Response Service** | 4007 | Rule engine, approval workflows, automated response pipelines |
| **Simulation Service** | 4008 | Red/Blue/Purple team, digital twin, MITRE ATT&CK, honeypots |
| **Governance Service** | 4009 | Audit logs, retention policies, compliance checks, AI governance |
| **CLI** | — | Operator command-line interface for all services |

## Tech Stack

- **Runtime**: Node.js 20 + TypeScript 5
- **API**: GraphQL (Apollo Server 4) with subscriptions
- **Messaging**: Apache Kafka (KafkaJS) — 3-broker cluster, 25+ topics
- **Databases**: PostgreSQL 16 + PostGIS + TimescaleDB, MongoDB 7, Neo4j 5
- **Cache**: Redis 7 (cluster mode)
- **AI/ML**: YOLOv8 (Python subprocess), scikit-learn, PyTorch LSTM, Ollama LLM
- **Search**: Elasticsearch 8 + Kibana
- **IDS**: Suricata
- **Observability**: OpenTelemetry, Prometheus, Grafana, Jaeger
- **Service Mesh**: Istio (mTLS, traffic management, authorization)
- **Container Orchestration**: Kubernetes + Helm
- **CI/CD**: GitHub Actions (lint → test → security scan → build → deploy)
- **Infrastructure as Code**: Terraform, Kustomize

## Project Structure

```
sentinel-os/
├── .github/workflows/ci-cd.yaml        # Full CI/CD pipeline
├── databases/
│   ├── postgresql/schemas/              # Extensions, types, 30+ tables, RLS
│   ├── mongodb/schemas/                 # Collections with validation
│   └── neo4j/constraints/              # Constraints, indexes, relationships
├── infrastructure/
│   ├── docker/docker-compose.yml        # Full stack (30+ containers)
│   ├── kubernetes/base/                 # K8s deployments, services, HPA, PDB
│   ├── istio/gateway.yaml              # Gateway, VirtualService, mTLS, AuthZ
│   └── kafka/topics.yaml               # 25+ Strimzi KafkaTopic resources
├── services/
│   ├── api-gateway/                     # GraphQL gateway
│   │   ├── src/schema/typeDefs.graphql
│   │   ├── src/resolvers/
│   │   ├── src/middleware/              # Auth, telemetry, dataloaders
│   │   ├── src/subscriptions/           # PubSub, Kafka event bus
│   │   └── src/directives/             # Classification, rate limiting
│   ├── auth-service/                    # Authentication & authorization
│   ├── ingestion-service/               # Sensor data ingestion
│   │   ├── src/connectors/rtsp/        # RTSP/FFmpeg video streams
│   │   ├── src/connectors/mqtt/        # IoT MQTT broker
│   │   ├── src/connectors/radar/       # UDP radar sweeps
│   │   ├── src/connectors/drone/       # WebSocket drone telemetry
│   │   ├── src/connectors/webhook/     # HMAC-verified webhooks
│   │   ├── src/edge/                   # Edge processing, motion detection
│   │   └── src/processors/            # Kafka buffering
│   ├── ai-service/                      # AI & analytics
│   │   ├── src/models/yolov8/          # Object detection
│   │   ├── src/models/isolation-forest/ # Anomaly detection
│   │   ├── src/models/lstm/            # Time series prediction
│   │   ├── src/models/ollama/          # LLM integration (7 prompt types)
│   │   └── src/pipelines/             # Inference routing, drift, registry
│   ├── osint-service/                   # Open source intelligence
│   ├── fusion-service/                  # Intelligence fusion (Neo4j)
│   ├── cyber-service/                   # Cyber defense (ELK + IDS)
│   └── response-service/               # Automated response engine
├── package.json                         # Monorepo (npm workspaces)
└── turbo.json                          # Turborepo build config
```

## Quick Start

### Prerequisites

- Docker & Docker Compose v2
- Node.js 20+
- Python 3.11+ (for AI service)
- CUDA toolkit (optional, for GPU inference)

### Development

```bash
# Clone and install
git clone <repo-url> sentinel-os
cd sentinel-os
npm install

# Start infrastructure
docker compose -f infrastructure/docker/docker-compose.yml up -d \
  zookeeper-1 kafka-1 kafka-2 kafka-3 \
  postgres-primary redis-cluster neo4j mongodb \
  elasticsearch kibana

# Run database migrations
psql -h localhost -U sentinel_admin -d sentinel \
  -f databases/postgresql/schemas/001_extensions.sql \
  -f databases/postgresql/schemas/002_core_types.sql \
  -f databases/postgresql/schemas/003_core_tables.sql

# Start services in dev mode
npm run dev --workspace=services/api-gateway
npm run dev --workspace=services/auth-service
npm run dev --workspace=services/ingestion-service
npm run dev --workspace=services/ai-service
npm run dev --workspace=services/osint-service
npm run dev --workspace=services/fusion-service
npm run dev --workspace=services/cyber-service
npm run dev --workspace=services/response-service
```

### Full Stack (Docker)

```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d
```

### Kubernetes Deployment

```bash
# Apply namespaces and base resources
kubectl apply -f infrastructure/kubernetes/base/namespace.yaml
kubectl apply -f infrastructure/kubernetes/base/

# Apply Istio configuration
kubectl apply -f infrastructure/istio/

# Apply Kafka topics
kubectl apply -f infrastructure/kafka/topics.yaml
```

## Security Model

- **Authentication**: JWT RS256 tokens with refresh rotation
- **MFA**: TOTP (RFC 6238) with backup codes
- **Authorization**: Role-based (OPERATOR, ANALYST, COMMANDER, ADMIN, SUPER_ADMIN)
- **Classification**: NATO-standard levels (UNCLASSIFIED → TOP_SECRET/SCI)
- **Transport**: TLS 1.3 with Istio mTLS between services
- **Data**: Row-level security in PostgreSQL, field-level encryption
- **API Keys**: Scoped, prefixed, bcrypt-hashed with expiry
- **Audit**: Immutable audit logs with SHA-256 checksums
- **Network**: Kubernetes NetworkPolicies, Istio AuthorizationPolicies
- **Secrets**: External secret management (Kubernetes Secrets / Vault)

## Kafka Topics

| Topic | Partitions | Retention | Purpose |
|-------|-----------|-----------|---------|
| `sentinel.ingestion.video-frames` | 12 | 1h | Video frame data |
| `sentinel.ingestion.sensor-telemetry` | 24 | 24h | Sensor readings |
| `sentinel.ingestion.radar-sweeps` | 6 | 2h | Radar returns |
| `sentinel.detections.created` | 12 | 30d | AI detections |
| `sentinel.alerts.created` | 6 | 90d | System alerts |
| `sentinel.cyber.raw-events` | 24 | 30d | IDS/network events |
| `sentinel.cyber.threat-indicators` | 6 | 90d | IOCs |
| `sentinel.osint.items` | 12 | 30d | OSINT items |
| `sentinel.ai.inference-requests` | 12 | 24h | AI inference queue |
| `sentinel.ai.analysis-results` | 6 | 30d | Ollama analysis |
| `sentinel.fusion.correlations` | 6 | 90d | Cross-domain links |
| `sentinel.response.approvals` | 3 | 90d | Approval requests |
| `sentinel.response.executed` | 3 | 90d | Executed actions |
| `sentinel.audit.events` | 6 | 365d | Audit trail |

## AI Models

| Model | Framework | Purpose | Input | Output |
|-------|-----------|---------|-------|--------|
| **YOLOv8** | Ultralytics/Python | Object detection | Video frames | Bounding boxes, labels, confidence |
| **Isolation Forest** | scikit-learn/Python | Anomaly detection | Sensor telemetry vectors | Anomaly score, feature contributions |
| **LSTM** | PyTorch/Python | Time series forecasting | Historical sequences | Predictions, confidence intervals |
| **Ollama LLM** | Ollama API | NLP/Analysis | Text prompts + context | Structured intelligence reports |

### Ollama Prompt Types

1. **THREAT_INVESTIGATION** — Analyze threats with IOC correlation
2. **INTELLIGENCE_SUMMARY** — NATO STANAG 2022 intelligence briefings
3. **NATURAL_LANGUAGE_QUERY** — Translate natural language to structured queries
4. **ENTITY_EXTRACTION** — Named entity recognition for intelligence
5. **MISINFORMATION_DETECTION** — Content credibility analysis
6. **DECISION_SUPPORT** — Military decision-making process (MDMP)
7. **REPORT_GENERATION** — Standardized intelligence reports

## Observability

- **Tracing**: OpenTelemetry → Jaeger (distributed trace correlation)
- **Metrics**: Prometheus scraping all services + Grafana dashboards
- **Logging**: Pino structured JSON → stdout → collected by Fluentd/ELK
- **Health**: `/health/live` and `/health/ready` endpoints on all services
- **Alerting**: Grafana alerting rules for SLO violations

## CI/CD Pipeline

```
Lint & Typecheck → Unit/Integration Tests → Security Scan (Trivy/Semgrep)
    → Build & Push Docker Images → Deploy Dev → Deploy Staging → Deploy Prod
```

- **Matrix builds** across all 10 services
- **Service containers** for PostgreSQL, Redis, Kafka in CI
- **Canary deployments** to production
- **Database migrations** as separate job
- **Security scanning**: npm audit, Trivy filesystem scan, Semgrep SAST

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KAFKA_BROKERS` | `kafka-1:9092,kafka-2:9092,kafka-3:9092` | Kafka broker addresses |
| `PG_HOST` | `postgres-primary` | PostgreSQL host |
| `PG_DATABASE` | `sentinel` | Database name |
| `REDIS_URL` | `redis://redis-cluster:6379` | Redis connection URL |
| `NEO4J_URI` | `bolt://neo4j:7687` | Neo4j Bolt URI |
| `OLLAMA_URL` | `http://ollama:11434` | Ollama LLM endpoint |
| `ELASTICSEARCH_URL` | `http://elasticsearch:9200` | Elasticsearch endpoint |
| `JWT_PRIVATE_KEY_PATH` | `/etc/sentinel/jwt/private.pem` | JWT signing key |
| `CORS_ORIGINS` | `https://sentinel.internal` | Allowed CORS origins |
| `LOG_LEVEL` | `info` | Pino log level |

## Roadmap

### Completed
- [x] Core architecture (monorepo, Docker Compose, Kafka, Istio)
- [x] Database schemas (PostgreSQL+PostGIS, MongoDB, Neo4j)
- [x] GraphQL API Gateway with subscriptions and directives
- [x] Auth Service (JWT, MFA, RBAC, API keys)
- [x] AI Service (YOLOv8, Isolation Forest, LSTM, Ollama, drift monitoring)
- [x] Ingestion Service (RTSP, MQTT, Radar, Drone, Webhook, Edge processing)
- [x] OSINT Service (RSS/API/Scrape feeds, IOC extraction, indicator lookup)
- [x] Fusion Service (Neo4j graph correlation, geospatial, entity linking)
- [x] Cyber Service (Elasticsearch SIEM, IDS integration, threat intel feeds)
- [x] Response Service (rule engine, approval workflows, automated actions)
- [x] Kubernetes manifests (Deployments, HPA, PDB, NetworkPolicy)
- [x] Istio configuration (Gateway, VirtualService, mTLS, AuthZ)
- [x] Kafka topic definitions (25+ Strimzi resources)
- [x] CI/CD pipeline (GitHub Actions, multi-environment)

- [x] Command UI (React dashboard with maps, graph view, alerts)
- [x] Simulation Service (red/blue/purple team, digital twin, MITRE ATT&CK, honeypots)
- [x] Governance Service (audit logs, retention policies, compliance checks, AI governance)
- [x] CLI tool (alerts, sensors, cyber, response, sim, osint, governance, health)

### Pending
- [ ] Helm charts for production deployment
- [ ] Terraform modules for cloud infrastructure
- [ ] Comprehensive test suites per service
- [ ] API documentation (OpenAPI/Swagger)
- [ ] MapLibre GL tactical map integration
- [ ] D3.js force-directed graph visualization for Fusion

## License

Proprietary — All rights reserved.

## Classification

**UNCLASSIFIED // FOR OFFICIAL USE ONLY**

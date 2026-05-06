# Sentinel OS

**Production-Ready Defense & Intelligence Operating System**

A real-time, scalable C4ISR (Command, Control, Communications, Computers, Intelligence, Surveillance, and Reconnaissance) platform built on microservices architecture with event-driven Kafka backbone, Istio service mesh, and AI-powered analytics.

> **Bootable ISO Available** — Sentinel OS ships as a complete Kali Linux-based bootable ISO (6.3 GB) with all services, databases, and AI models pre-installed. Flash to USB and boot on any x86_64 system.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           Istio Ingress Gateway                                  │
│                      (TLS 1.3 / mTLS / JWT Auth)                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │  Sentinel UI  │  │ Tauri Shell  │  │ API Gateway  │  │ Auth Service │         │
│  │  (React/TS)   │  │ (Desktop HUD)│  │  (GraphQL)   │  │ (JWT/MFA)    │         │
│  └──────────────┘  └──────────────┘  └──────┬───────┘  └──────────────┘         │
│                                              │                                    │
│  ┌───────────────────────────────────────────┼──────────────────────────────┐    │
│  │                    Apache Kafka (Event Bus)                               │    │
│  │         3-broker cluster, 25+ topics, Strimzi operator                    │    │
│  └────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬────────────┘    │
│       │      │      │      │      │      │      │      │      │                  │
│  ┌────┴──┐┌──┴───┐┌─┴────┐┌┴─────┐┌┴─────┐┌┴─────┐┌┴──────┐┌┴──────┐┌──┴───┐ │
│  │Ingest ││  AI  ││OSINT ││Fusion││Cyber ││Respon││SIGINT ││  Geo  ││Simul │ │
│  │Service││Servce││Servce││Servce││Servce││  se  ││Service││Service││ation │ │
│  │RTSP   ││YOLOv8││RSS   ││Neo4j ││IDS   ││Rules ││ADS-B  ││NASA   ││MITRE │ │
│  │MQTT   ││LSTM  ││API   ││Graph ││SIEM  ││Apprvl││AIS    ││OWM    ││Twin  │ │
│  │Radar  ││IF    ││NLP   ││Spatal││ELK   ││Auto  ││SDR    ││USGS   ││Honeyp│ │
│  │Drone  ││Ollama││Scrape││Link  ││Threat││Pipes ││APRS   ││SatImg ││R/B/P │ │
│  └───────┘└──────┘└──────┘└──────┘└──────┘└──────┘└───────┘└───────┘└──────┘ │
│       │                                                          │               │
│  ┌────┴────────────┐  ┌─────────────────┐  ┌────────────────────┴──┐            │
│  │ Healing Agent    │  │   Governance    │  │    Live Integrations  │            │
│  │ MAPE-K Loop      │  │   Audit/Comply  │  │    CTI/OSINT/SIGINT   │            │
│  │ Ollama RCA       │  │   AI Governance │  │    Real-time Feeds    │            │
│  │ Tamper Response  │  │   Retention     │  │    Auto-Ingest        │            │
│  └─────────────────┘  └─────────────────┘  └───────────────────────┘            │
│                                                                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│  PostgreSQL+PostGIS │ MongoDB │ Neo4j │ Redis │ Elasticsearch │ TimescaleDB     │
│  RLS + Audit Chain  │ GridFS  │ Graph │ Cache │ SIEM Indexing │ Hypertables     │
├─────────────────────────────────────────────────────────────────────────────────┤
│  Sentinel LSM (Kernel) │ Sentinel-WM (Wayland Compositor) │ CRT/Radar Shaders  │
│  RTL-SDR Driver        │ wlroots 0.19 + 6 Workspaces      │ GPU Post-Processing│
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Services (13 Microservices + CLI)

| Service | Port | Language | Description |
|---------|------|----------|-------------|
| **API Gateway** | 4000 | TypeScript | GraphQL (Apollo Server 4), subscriptions, directives, dataloaders, rate limiting |
| **Auth Service** | 4001 | TypeScript | JWT RS256/ES256, MFA/TOTP, RBAC, API keys, session mgmt, account lockout |
| **Ingestion Service** | 4002 | TypeScript + Go | RTSP/MQTT/Radar/Drone/Webhook connectors, edge processing, DLQ |
| **AI Service** | 4003/5001 | TypeScript + Python | YOLOv8, Isolation Forest, LSTM, Ollama LLM, drift monitoring, model registry |
| **OSINT Service** | 4004 | TypeScript | RSS/API/Scrape/Telegram/Reddit, IOC extraction, NLP sentiment, GDELT, NewsAPI |
| **Fusion Service** | 4005 | TypeScript | Neo4j graph correlation, geospatial proximity, entity linking, path analysis |
| **Cyber Service** | 4006 | TypeScript | Suricata IDS, Elasticsearch SIEM, threat intel feeds, CVE enrichment |
| **Response Service** | 4007 | TypeScript | Rule engine (conditions + actions), approval workflows, automated pipelines |
| **Simulation Service** | 4008 | TypeScript | Red/Blue/Purple team, digital twin, MITRE ATT&CK (190+ techniques), honeypots |
| **Governance Service** | 4009 | TypeScript | Tamper-evident audit logs, retention policies, compliance checks, AI governance |
| **SIGINT Service** | 4010 | TypeScript + Python | ADS-B (OpenSky), AIS (MarineTraffic), SDR spectrum, APRS, ACARS, KrakenSDR |
| **Geo Service** | 4011 | TypeScript | NASA GIBS satellite imagery, OpenWeatherMap, USGS earthquakes, Sentinel Hub |
| **Healing Agent** | 4012 | TypeScript | MAPE-K self-healing loop, Ollama RCA, runbook automation, tamper response |
| **CLI** | — | TypeScript | Commander.js operator CLI: alerts, sensors, cyber, response, sim, osint, health |
| **Live Integrations** | — | Python | Continuous CTI/OSINT/SIGINT feed runner with auto-ingest to API Gateway |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Node.js 20, TypeScript 5, Python 3.12, Go 1.22, Rust 1.77, C (kernel) |
| **API** | GraphQL (Apollo Server 4) with subscriptions + WebSocket |
| **Messaging** | Apache Kafka 3.x (KafkaJS) — 3-broker cluster, 25+ Strimzi topics |
| **Primary DB** | PostgreSQL 16 + PostGIS 3.4 + TimescaleDB (hypertables, RLS) |
| **Document DB** | MongoDB 7 (GridFS, validation schemas) |
| **Graph DB** | Neo4j 5 (entity linking, path analysis, threat graphs) |
| **Cache/Sessions** | Redis 7 (cluster mode, pub/sub, rate limiting) |
| **Search/SIEM** | Elasticsearch 8 + Kibana (IDS log indexing) |
| **AI/ML** | YOLOv8, scikit-learn, PyTorch LSTM, Ollama (tinyllama/llama3), TorchSig |
| **IDS** | Suricata (integrated with Cyber Service) |
| **Desktop Shell** | Tauri v2 (Rust backend + React frontend), fullscreen HUD |
| **Compositor** | Custom Wayland compositor (wlroots 0.19), CRT/radar GLSL shaders |
| **Kernel** | Custom LSM (module lockdown, mount audit, ptrace block), RTL-SDR char driver |
| **Observability** | OpenTelemetry, Prometheus, Grafana, Jaeger |
| **Service Mesh** | Istio (strict mTLS, traffic mgmt, JWT auth, circuit breakers) |
| **Orchestration** | Kubernetes (Deployments, HPA, PDB, NetworkPolicy, KEDA) |
| **Database HA** | CloudNativePG (3-node streaming replication) |
| **Helm** | 6 Helm charts (gateway, ai, cyber, fusion, ingestion, osint) |
| **IaC** | Terraform (VPC, EKS, RDS, ElastiCache, MSK) — 3 environments |
| **CI/CD** | GitHub Actions (lint → test → scan → build → deploy → ISO) |
| **Build** | Turborepo (npm workspaces monorepo) |
| **ISO** | live-build (Kali rolling, EFI + BIOS hybrid, 6.3 GB) |

---

## Project Structure

```
sentinel-os/
├── .github/workflows/ci-cd.yaml           # CI/CD: lint, test, scan, build, ISO
├── ai-workers/                             # Python AI worker processes
│   ├── yolov8_worker.py                   # YOLOv8 object detection (Ultralytics)
│   ├── lstm_worker.py                     # Time-series prediction (PyTorch)
│   ├── torchsig_worker.py                 # RF signal classification (TorchSig)
│   ├── system_anomaly.py                  # System anomaly detection
│   ├── predictive_failure.py              # Predictive failure analysis
│   └── gnuradio/adsb_decoder.py           # GNURadio ADS-B decoder
├── cli/src/index.ts                        # Commander.js operator CLI
├── compositor/                             # Custom Wayland compositor
│   ├── sentinel-wm.c                      # wlroots 0.19 compositor (6 workspaces)
│   ├── config.lua                         # Lua configuration
│   ├── shaders/crt.frag                   # CRT scanline + phosphor glow shader
│   └── shaders/radar.frag                 # Radar sweep animation shader
├── databases/
│   ├── postgresql/schemas/                # 3 migration files, 30+ tables, RLS
│   │   ├── 001_extensions.sql            # PostGIS, TimescaleDB, pg_trgm, uuid
│   │   ├── 002_core_types.sql            # 15 ENUM types (roles, severity, etc.)
│   │   └── 003_core_tables.sql           # All tables + triggers + checksums
│   ├── mongodb/schemas/                   # Collection validation schemas
│   └── neo4j/constraints/                 # Graph constraints & indexes
├── docs/
│   ├── ISO_BUILD.md                       # ISO build instructions
│   ├── KERNEL_BUILD.md                    # Kernel module compilation
│   ├── LIVE_USB.md                        # USB flashing guide
│   └── SEMESTER_PROJECT_EVALUATION_REPORT.md
├── infrastructure/
│   ├── docker/
│   │   ├── docker-compose.yml             # Production (30+ containers, replicas)
│   │   └── docker-compose.dev.yml         # Development stack
│   ├── istio/
│   │   ├── gateway.yaml                   # TLS 1.3 ingress, HTTPS redirect
│   │   ├── virtual-services.yaml          # Routing, retries, timeouts, CORS
│   │   ├── authorization-policies.yaml    # Strict mTLS, namespace isolation
│   │   └── circuit-breakers.yaml          # Outlier detection, connection pools
│   ├── kafka/topics.yaml                  # 25 Strimzi KafkaTopic resources
│   ├── kubernetes/
│   │   ├── base/                          # Deployments, HPA, PDB, NetworkPolicy
│   │   ├── helm-charts/                   # 6 Helm charts with values
│   │   ├── cloudnativepg-cluster.yaml     # PostgreSQL HA (3 instances)
│   │   └── keda-scalers.yaml              # Kafka-lag autoscaling
│   └── terraform/
│       ├── modules/vpc/                   # AWS VPC (public/private/isolated)
│       ├── modules/eks/                   # EKS + GPU node groups
│       ├── modules/rds/                   # RDS PostgreSQL
│       ├── modules/elasticache/           # Redis cluster
│       ├── modules/kafka/                 # Amazon MSK
│       └── environments/{dev,staging,prod}
├── kernel/
│   ├── sentinel-lsm.c                    # Linux Security Module
│   ├── rtlsdr-sentinel.c                 # RTL-SDR character device driver
│   └── Makefile
├── scripts/
│   ├── build-iso.sh                       # Full ISO build script
│   ├── generate-docker-assets.sh
│   └── seed/                              # DB seed scripts (PG, Mongo, Neo4j)
├── services/                              # 13 microservices (see table above)
├── shared/
│   ├── types/index.ts                     # Shared TypeScript interfaces
│   ├── constants/index.ts                 # Shared constants
│   ├── crypto/index.ts                    # Shared crypto utilities
│   └── utils/index.ts                     # Shared utility functions
├── shell/                                  # Tauri v2 Desktop Shell
│   ├── src/App.tsx                        # Multi-workspace HUD layout
│   ├── src/panels/                        # 11 panel components
│   │   ├── TacticalMap.tsx                # MapLibre GL + alert clustering
│   │   ├── SigintWaterfall.tsx            # Real-time SDR spectrum display
│   │   ├── IntelGraph.tsx                 # D3 force-directed graph
│   │   ├── CveDashboard.tsx              # CVE/vulnerability dashboard
│   │   ├── Terminal.tsx                   # Embedded xterm.js terminal
│   │   ├── EncryptionWorkbench.tsx        # Crypto tools
│   │   ├── OsintBrowser.tsx              # OSINT feed browser
│   │   ├── SimulationRoom.tsx            # Red/Blue team simulation
│   │   ├── ReportGenerator.tsx           # Intelligence report builder
│   │   ├── PakistanFeed.tsx              # Theater-specific feed
│   │   └── WeatherGeo.tsx                # Weather/geospatial overlay
│   └── src-tauri/                         # Rust Tauri backend
│       ├── src/main.rs
│       ├── Cargo.toml
│       └── tauri.conf.json
├── tests/test_integration.py              # pytest integration suite
├── ui/                                     # React web dashboard
│   ├── src/pages/                         # Dashboard, Alerts, Map, Sensors, etc.
│   ├── src/graphql/                       # Queries, mutations, subscriptions
│   └── src/store/useStore.ts              # Zustand global state
├── package.json                            # Monorepo root (npm workspaces)
└── turbo.json                             # Turborepo pipeline config
```

---

## Detailed Service Descriptions

### API Gateway (Port 4000)

The central GraphQL entry point for all client interactions. Built on Apollo Server 4 with Express.

- **Schema**: Strongly-typed GraphQL schema with custom scalars (`DateTime`, `JSON`, `BigInt`, `UUID`)
- **Subscriptions**: Real-time WebSocket subscriptions for alerts, detections, tracks, cyber events, sensor status, approvals, and system health
- **Middleware**: Authentication (JWT verification), OpenTelemetry tracing, compression, Helmet security headers, rate limiting (configurable window/max)
- **DataLoaders**: Batched database queries with per-request caching; supports row-level security via `SET LOCAL app.current_user_id`
- **Directives**: Classification-based field access, rate limiting per operation
- **Pagination**: Cursor-based pagination on all list queries
- **Health**: `/health/live` and `/health/ready` endpoints
- **Kafka Integration**: Publishes and subscribes to events for real-time push to clients

### Auth Service (Port 4001)

Handles all identity and access management.

- **Registration**: Email/username uniqueness per organization, bcrypt password hashing (12 rounds)
- **Login**: Credential verification, account lockout after failed attempts (Redis-backed counter), JWT access + refresh token issuance
- **JWT**: RS256/ES256 signed, issuer `sentinel-os`, audience `sentinel-api`, 30s clock tolerance
- **MFA**: TOTP setup/enable with QR code generation (RFC 6238)
- **API Keys**: Prefixed (`sk_`), bcrypt-hashed, scoped permissions, expiry support
- **Sessions**: Redis-backed session management with logout/revocation
- **RBAC**: Roles — `OPERATOR`, `ANALYST`, `COMMANDER`, `ADMIN`, `SUPER_ADMIN`
- **Clearance**: Hierarchical — `UNCLASSIFIED → CONFIDENTIAL → SECRET → TOP_SECRET → SCI`

### Ingestion Service (Port 4002)

Multi-protocol sensor data ingestion with edge processing.

- **RTSP Connector**: FFmpeg-based RTSP stream capture, frame extraction, Kafka publishing
- **MQTT Connector**: Subscribes to IoT sensor topics, parses payloads, buffers to Kafka
- **Radar Connector**: UDP socket listener for radar sweep data, azimuth/range parsing
- **Drone Connector**: WebSocket server for MAVLink-compatible drone telemetry
- **Webhook Router**: HMAC-SHA256 validated webhooks for sensor data, intel feeds, threat indicators, cyber events
- **Edge Processing**: Motion detection, frame differencing, pre-filtering before AI pipeline
- **Ingestion Buffer**: Batched Kafka producer with configurable flush intervals
- **Dead Letter Queue**: Failed messages routed to DLQ topic for retry

### AI Service (Port 4003 / Python 5001)

Dual-runtime AI inference engine.

**TypeScript Layer (Port 4003)**:
- Model registry with version tracking and health monitoring
- Pipeline manager routing inference requests to appropriate models
- Drift detection — monitors input feature distributions for concept drift
- Kafka consumer for async inference requests, producer for results

**Python Layer (Port 5001)**:
- **YOLOv8**: Object detection on video frames (persons, vehicles, aircraft, weapons); Ultralytics `yolov8n.pt` (nano) for CPU, `yolov8x.pt` for GPU
- **Isolation Forest**: Anomaly detection on sensor telemetry vectors; configurable contamination threshold (default 0.1)
- **LSTM**: Time-series prediction for sensor readings; 2-layer LSTM (hidden_size=64), trained on windowed sequences
- **Ollama Client**: 7 prompt templates (see AI Models section), configurable model/temperature/context
- **TorchSig Worker**: RF signal classification for SDR data

**AI Workers** (standalone Python processes):
- `yolov8_worker.py` — Kafka consumer for video frames → detection results
- `lstm_worker.py` — Kafka consumer for time-series → predictions
- `torchsig_worker.py` — RF signal classification
- `system_anomaly.py` — Infrastructure anomaly detection
- `predictive_failure.py` — Predictive failure analysis
- `gnuradio/adsb_decoder.py` — GNURadio ADS-B signal decoding

### OSINT Service (Port 4004)

Open-source intelligence collection and analysis.

- **RSS Collector**: Configurable feeds (CISA, US-CERT, SANS ISC, BleepingComputer, KrebsOnSecurity, DarkReading, NATO) with poll intervals
- **API Collectors**: NewsAPI, GDELT, VirusTotal, AlienVault OTX, Shodan, Have I Been Pwned
- **Web Scraper**: Cheerio-based HTML extraction with configurable CSS selectors
- **Telegram/Reddit**: Social media monitoring for threat intelligence
- **IOC Extraction**: Automatic extraction of IPs, domains, URLs, hashes, CVEs from content
- **NLP Pipeline**: Sentiment analysis, credibility scoring, misinformation detection via Ollama
- **Deduplication**: Redis-backed seen-item tracking to prevent duplicates
- **Scheduling**: Cron-based polling per feed with individual intervals

### Fusion Service (Port 4005)

Intelligence fusion engine using Neo4j graph database.

- **Graph Correlator**: Creates nodes (alerts, IOCs, entities, sensors, actors) and edges (relationships) in Neo4j
- **Geospatial Proximity**: Links entities based on geographic proximity (PostGIS calculations)
- **Entity Linking**: Merges related entities across intelligence domains
- **Path Analysis**: Graph traversal to find connections between seemingly unrelated events
- **Temporal Correlation**: Links events within configurable time windows
- **Cross-Domain Fusion**: Correlates OSINT + SIGINT + CYBER + SENSOR data into unified intelligence picture
- **Kafka Consumer**: Subscribes to detections, alerts, OSINT items, cyber events; publishes correlations

### Cyber Service (Port 4006)

Cyber defense integration layer.

- **Suricata IDS**: Parses EVE JSON logs, normalizes alerts into sentinel schema
- **Elasticsearch SIEM**: Indexes all cyber events for full-text search and analytics
- **Threat Intel Feeds**: Ingests STIX/TAXII indicators, AlienVault OTX, MISP
- **CVE Enrichment**: Cross-references detections with NVD/CVE database
- **MITRE ATT&CK Mapping**: Tags events with tactic/technique IDs (T1xxx)
- **IOC Matching**: Real-time matching of network traffic against known IOCs
- **Kibana Dashboards**: Pre-configured dashboards for SOC operators
- **Alert Correlation**: Groups related cyber events into unified incidents

### Response Service (Port 4007)

Automated response orchestration with human-in-the-loop approval.

- **Rule Engine**: Condition-based rules (severity, domain, source, keyword matching) → action sets
- **Approval Workflows**: Multi-level approval for high-impact actions (COMMANDER+ clearance)
- **Action Types**: Block IP, isolate host, notify team, create ticket, trigger playbook, enrich IOC, quarantine file
- **Execution Pipeline**: Condition evaluation → risk assessment → approval (if required) → execution → audit
- **Kafka Integration**: Listens to alert/detection topics, publishes approval requests and execution results
- **Rule Toggle**: Enable/disable rules without deletion
- **Cooldown**: Per-rule cooldown periods to prevent action storms

### Simulation Service (Port 4008)

Red/Blue/Purple team exercises and digital twin modeling.

- **MITRE ATT&CK Engine**: 190+ techniques across 14 tactics (Reconnaissance → Impact)
- **Team Exercises**: Start attacks as RED/BLUE/PURPLE team, track detection/miss/block rates
- **Kill Chain Coverage**: Reports detection coverage per tactic across scenarios
- **Digital Twin**: Mirrors real infrastructure — assets (servers, workstations, firewalls, sensors), networks (CIDRs, firewall rules, zones)
- **Attack Surface Analysis**: Identifies exposed services and open vulnerabilities per zone
- **Scenario Management**: Create, start, complete scenarios with team assignments
- **Metrics**: Average detection time, detection rate, blocked rate per scenario
- **Honeypots**: Decoy assets for adversary detection and deception

### Governance Service (Port 4009)

Compliance, audit, and AI governance.

- **Tamper-Evident Audit Logs**: SHA-256 chained checksums (`previous_checksum` → `current_checksum`), immutable append-only
- **Retention Policies**: Configurable per-table retention with automated cleanup
- **Compliance Checks**: Validates classification markings, access controls, data handling
- **AI Governance**: Model performance monitoring, bias detection, explainability requirements
- **Data Classification**: Resource-level classification tagging (UNCLASSIFIED → TOP_SECRET/SCI)
- **Reporting**: Generates compliance reports for audit periods

### SIGINT Service (Port 4010)

Signals intelligence collection.

- **ADS-B (OpenSky Network)**: Real-time aircraft position tracking, callsign/ICAO24 enrichment
- **AIS (MarineTraffic)**: Vessel position tracking, MMSI/IMO resolution
- **SDR Spectrum Analysis**: RTL-SDR power spectral density, peak detection, frequency occupation
- **APRS**: Amateur radio position reporting
- **ACARS**: Aircraft communications data
- **KrakenSDR**: Direction-finding / geolocation
- **GNURadio Integration**: Signal processing pipelines for demodulation and decoding

### Geo Service (Port 4011)

Geospatial intelligence and environmental data.

- **NASA GIBS**: Satellite imagery layer tiles (MODIS, VIIRS, Landsat)
- **OpenWeatherMap**: Current weather, forecasts, severe weather alerts
- **USGS Earthquakes**: Real-time seismic event data
- **Sentinel Hub**: Copernicus satellite imagery (SAR, optical)
- **GeoNames**: Geographic feature and place name resolution

### Healing Agent (Port 4012)

Autonomous self-healing system based on the MAPE-K control loop.

- **Monitor**: Prometheus alertmanager webhook receiver + periodic service health polling
- **Analyze**: Checks if automated runbook exists for incident type
- **Plan**: Selects appropriate runbook or escalates to Ollama LLM for root cause analysis
- **Execute**: Runs healing action (pod restart, config rollback, resource scaling)
- **Knowledge**: Stores healing history for pattern recognition
- **Ollama RCA**: LLM-powered root cause analysis with structured output (root cause, confidence, immediate action, prevention)
- **Tamper Response**: Handles code integrity violations detected by Falco/IMA/RASP
- **Kafka Consumer**: Subscribes to `sentinel.security.tamper` and `sentinel.healing.commands` topics

---

## Desktop Shell (Tauri v2)

A fullscreen military-grade HUD built with Tauri v2 (Rust + React).

### Workspaces (6 configurable layouts)

| Workspace | Panels | Description |
|-----------|--------|-------------|
| **INTEL** | Map, Intel Graph, Reports | Intelligence analysis workspace |
| **CYBER** | CVE Dashboard, OSINT Browser, Terminal | Cyber operations workspace |
| **COMMS** | Pakistan Feed, Weather/Geo, Reports | Communications and theater awareness |
| **SIGINT** | SIGINT Waterfall, Map, Terminal | Signals intelligence workspace |
| **SIM** | Simulation Room, Intel Graph, Terminal | Red/Blue team exercises |
| **CRYPTO** | Encryption Workbench, Terminal, Reports | Cryptographic operations |

### Shell Features
- Real-time threat level indicator (LOW → SEVERE)
- Service health status bar (online/total nodes)
- SDR device detection indicator
- Tor circuit status indicator
- Live clock
- Dark theme with CRT scanline aesthetic
- Keyboard shortcuts (Alt+1-6 workspace switch)

### Tauri Configuration
- **Target**: Fullscreen, undecorated window (1920×1080)
- **Bundle**: `.deb` and `.AppImage` for Linux
- **CSP**: Strict content security policy (no inline scripts, whitelisted connects)
- **Plugins**: Shell (process spawning), FS (scoped file access)

---

## Custom Kernel Modules

### Sentinel LSM (Linux Security Module)
File: `kernel/sentinel-lsm.c`

- **Module Load Lockdown**: Blocks kernel module loading after boot (configurable via `lockdown_active` param)
- **Mount Auditing**: Logs all mount operations with device, type, flags, PID
- **Service Integrity**: Blocks mounting over `/opt/sentinel` (service binary directory)
- **Ptrace Protection**: Blocks ptrace attach to Sentinel processes (anti-debugging)
- **xattr Privileged Check**: Processes with `security.sentinel` xattr gain elevated trust

### RTL-SDR Character Device Driver
File: `kernel/rtlsdr-sentinel.c`

- Custom character device (`/dev/rtlsdr0`) for RTL-SDR USB dongles
- `ioctl` interface for frequency tuning, sample rate, gain control
- Kernel-space buffering for high-throughput SDR data
- Integration with SIGINT service

---

## Custom Wayland Compositor (Sentinel-WM)

File: `compositor/sentinel-wm.c`

Built on **wlroots 0.19** (same foundation as Sway/Hyprland).

- **6 Named Workspaces**: INTEL, CYBER, COMMS, SIGINT, MAP, TERMINAL
- **Keybindings**: Alt+1-6 (workspace), Alt+Shift+Return (terminal), Alt+Shift+Q (kill), Alt+Tab (cycle)
- **Full wlroots Integration**: Cursor, keyboard, seat, XDG shell, scene graph
- **GPU Shaders**:
  - `crt.frag`: CRT scanlines, vignette, phosphor glow, subtle flicker
  - `radar.frag`: Rotating radar sweep beam with range rings and fade trail

---

## Quick Start

### Prerequisites

- Docker & Docker Compose v2
- Node.js 20+ (with npm 9+)
- Python 3.12+ (for AI workers)
- CUDA toolkit (optional, for GPU inference)
- Rust 1.77+ (for Tauri shell, optional)

### Development

```bash
# Clone and install
git clone https://github.com/hamzazakakhan/sentinel-os.git
cd sentinel-os
npm install

# Start infrastructure (databases + Kafka + observability)
docker compose -f infrastructure/docker/docker-compose.dev.yml up -d

# Run database migrations
psql -h localhost -U sentinel_admin -d sentinel \
  -f databases/postgresql/schemas/001_extensions.sql \
  -f databases/postgresql/schemas/002_core_types.sql \
  -f databases/postgresql/schemas/003_core_tables.sql

# Seed demo data
psql -h localhost -U sentinel_admin -d sentinel -f scripts/seed/seed-postgresql.sql
node scripts/seed/seed-mongodb.js
cat scripts/seed/seed-neo4j.cypher | cypher-shell -u neo4j -p password

# Start services in dev mode (each in separate terminal)
npm run dev --workspace=services/api-gateway
npm run dev --workspace=services/auth-service
npm run dev --workspace=services/ingestion-service
npm run dev --workspace=services/ai-service
npm run dev --workspace=services/osint-service
npm run dev --workspace=services/fusion-service
npm run dev --workspace=services/cyber-service
npm run dev --workspace=services/response-service
npm run dev --workspace=services/simulation-service
npm run dev --workspace=services/governance-service
npm run dev --workspace=services/sigint-service
npm run dev --workspace=services/geo-service
npm run dev --workspace=services/healing-agent

# Start AI workers
python ai-workers/yolov8_worker.py &
python ai-workers/lstm_worker.py &
python ai-workers/torchsig_worker.py &

# Start UI (web dashboard)
cd ui && npm run dev

# Start Shell (desktop HUD)
cd shell && npm run tauri dev
```

### Full Stack (Docker Compose)

```bash
# Production mode (all 30+ containers)
docker compose -f infrastructure/docker/docker-compose.yml up -d

# Development mode (lighter, hot-reload)
docker compose -f infrastructure/docker/docker-compose.dev.yml up -d
```

### Kubernetes Deployment

```bash
# Create namespace and apply base resources
kubectl apply -f infrastructure/kubernetes/base/namespace.yaml
kubectl apply -f infrastructure/kubernetes/base/

# Deploy CloudNativePG PostgreSQL cluster
kubectl apply -f infrastructure/kubernetes/cloudnativepg-cluster.yaml

# Apply Istio service mesh configuration
kubectl apply -f infrastructure/istio/

# Create Kafka topics via Strimzi operator
kubectl apply -f infrastructure/kafka/topics.yaml

# Deploy services via Helm
helm install sentinel-gateway infrastructure/kubernetes/helm-charts/sentinel-gateway/
helm install sentinel-ai infrastructure/kubernetes/helm-charts/sentinel-ai/
helm install sentinel-cyber infrastructure/kubernetes/helm-charts/sentinel-cyber/
helm install sentinel-fusion infrastructure/kubernetes/helm-charts/sentinel-fusion/
helm install sentinel-ingestion infrastructure/kubernetes/helm-charts/sentinel-ingestion/
helm install sentinel-osint infrastructure/kubernetes/helm-charts/sentinel-osint/

# Apply KEDA autoscalers
kubectl apply -f infrastructure/kubernetes/base/keda-scalers.yaml
```

### Terraform (AWS)

```bash
cd infrastructure/terraform/environments/dev
terraform init
terraform plan -var="environment=dev"
terraform apply
```

### Bootable ISO

```bash
# Build ISO (requires root, ~45 min)
sudo ./scripts/build-iso.sh

# Flash to USB
sudo dd if=build/sentinel-os-1.0.0-full/sentinel-os-1.0.0-full.iso of=/dev/sdX bs=4M status=progress && sync
```

---

## Security Model

### Authentication
- **JWT Tokens**: RS256/ES256 signed, 15-min access + 7-day refresh with rotation
- **Issuer/Audience**: `sentinel-os` / `sentinel-api`
- **Clock Tolerance**: 30 seconds for distributed systems
- **Account Lockout**: Redis-backed counter, locks after N failed attempts

### Multi-Factor Authentication
- **TOTP**: RFC 6238 compliant, 30-second window
- **QR Code**: Provisioning URI for authenticator apps
- **Backup Codes**: One-time-use recovery codes

### Authorization
- **RBAC Roles**: OPERATOR → ANALYST → COMMANDER → ADMIN → SUPER_ADMIN
- **Clearance Levels**: UNCLASSIFIED → CONFIDENTIAL → SECRET → TOP_SECRET → SCI
- **Per-Operation Enforcement**: GraphQL resolvers check role AND clearance
- **API Keys**: Prefixed (`sk_`), bcrypt-hashed, scoped permissions, expiration

### Transport Security
- **TLS 1.3**: Istio ingress with `TLSV1_3` minimum, AES-256-GCM ciphers
- **mTLS**: Strict mutual TLS between all service-to-service communication
- **HTTPS Redirect**: HTTP → HTTPS redirect at gateway level

### Data Security
- **Row-Level Security**: PostgreSQL RLS with `SET LOCAL app.current_user_id`
- **Field-Level Encryption**: Sensitive fields encrypted at application layer
- **Tamper-Evident Audit**: SHA-256 chained checksums (each entry links to previous)
- **Classification Marking**: Every record tagged with classification level

### Network Security
- **NetworkPolicies**: Kubernetes network segmentation per service
- **Istio AuthorizationPolicies**: Namespace-level and service-level access control
- **Deny-by-Default**: All traffic denied unless explicitly allowed
- **Ingress Isolation**: Only Istio ingress gateway can reach API Gateway

### Kernel Security (Sentinel LSM)
- Module loading blocked after boot completion
- Mount operations over `/opt/sentinel` blocked
- Ptrace to Sentinel processes blocked
- All mount operations audited with PID tracking

---

## Kafka Topics (25 Strimzi-managed)

| Topic | Partitions | Replicas | Retention | Compression | Purpose |
|-------|-----------|----------|-----------|-------------|---------|
| `sentinel.ingestion.video-frames` | 12 | 3 | 1h | lz4 | Video frame data from RTSP/drone |
| `sentinel.ingestion.sensor-telemetry` | 24 | 3 | 24h | snappy | IoT sensor readings |
| `sentinel.ingestion.radar-sweeps` | 6 | 3 | 2h | lz4 | Radar return data |
| `sentinel.ingestion.intel-feeds` | 6 | 3 | 7d | snappy | Raw intelligence feeds |
| `sentinel.ingestion.generic` | 6 | 3 | 7d | — | Generic ingestion |
| `sentinel.detections.created` | 12 | 3 | 30d | snappy | AI detection events |
| `sentinel.alerts.created` | 6 | 3 | 90d | snappy | New alert notifications |
| `sentinel.alerts.updated` | 6 | 3 | 90d | — | Alert status changes |
| `sentinel.tracks.updated` | 12 | 3 | 7d | — | Object track updates (compact) |
| `sentinel.cyber.raw-events` | 24 | 3 | 30d | snappy | IDS/network events |
| `sentinel.cyber.threat-indicators` | 6 | 3 | 90d | — | IOC indicators (compact) |
| `sentinel.osint.items` | 12 | 3 | 30d | snappy | Collected OSINT items |
| `sentinel.osint.for-analysis` | 6 | 3 | 7d | — | Items queued for NLP analysis |
| `sentinel.ai.inference-requests` | 12 | 3 | 24h | — | AI inference queue |
| `sentinel.ai.inference-results` | 12 | 3 | 7d | — | Inference results |
| `sentinel.ai.analysis-results` | 6 | 3 | 30d | — | Ollama analysis output |
| `sentinel.ai.errors` | 3 | 3 | 30d | — | AI pipeline errors |
| `sentinel.fusion.correlations` | 6 | 3 | 90d | — | Cross-domain correlations |
| `sentinel.response.approvals` | 3 | 3 | 90d | — | Pending approval requests |
| `sentinel.response.executed` | 3 | 3 | 90d | — | Executed response actions |
| `sentinel.missions.updated` | 3 | 3 | 30d | — | Mission status changes |
| `sentinel.system.health` | 3 | 3 | 7d | — | Service health (compact) |
| `sentinel.simulation.ticks` | 6 | 3 | 24h | — | Simulation time ticks |
| `sentinel.sensors.status` | 6 | 3 | 7d | — | Sensor status (compact) |
| `sentinel.audit.events` | 6 | 3 | 365d | snappy | Immutable audit trail |
| `sentinel.healing.events` | — | — | — | — | Self-healing outcomes |
| `sentinel.security.tamper` | — | — | — | — | Code tampering alerts |

All topics configured with `min.insync.replicas: 2` for durability.

---

## AI Models & Pipelines

### Model Registry

The AI Service maintains a model registry tracking:
- Model name, version, framework
- Status: `TRAINING`, `VALIDATING`, `DEPLOYED`, `DEPRECATED`, `FAILED`
- Performance metrics (accuracy, latency, throughput)
- Drift detection scores

### YOLOv8 Object Detection

| Parameter | Value |
|-----------|-------|
| Framework | Ultralytics |
| Models | `yolov8n.pt` (CPU), `yolov8x.pt` (GPU) |
| Target Classes | person, bicycle, car, motorcycle, bus, truck, dog + custom weapons |
| Input | Video frames (RTSP, drone, uploaded) |
| Output | Bounding boxes, class labels, confidence scores |
| Kafka Topic | `sentinel.ai.detections` |

### Isolation Forest (Anomaly Detection)

| Parameter | Value |
|-----------|-------|
| Framework | scikit-learn |
| Contamination | 0.1 (configurable) |
| Input | Sensor telemetry feature vectors |
| Output | Anomaly score (-1/1), feature contributions |
| Use Case | Detect abnormal sensor readings, network traffic patterns |

### LSTM (Time-Series Forecasting)

| Parameter | Value |
|-----------|-------|
| Framework | PyTorch |
| Architecture | 2-layer LSTM, hidden_size=64 |
| Input | Windowed time-series sequences |
| Output | Predictions with confidence intervals |
| Use Case | Sensor trend prediction, capacity forecasting |

### TorchSig (RF Signal Classification)

| Parameter | Value |
|-----------|-------|
| Framework | TorchSig + PyTorch |
| Input | SDR IQ samples |
| Output | Signal type classification, modulation scheme |
| Use Case | Automated signal identification from RTL-SDR |

### Ollama LLM Integration

| Parameter | Value |
|-----------|-------|
| Models | `tinyllama`, `llama3.2` |
| Endpoint | `http://ollama:11434/api/generate` |
| Temperature | 0.1 (deterministic) for RCA, 0.3 for analysis |
| Stream | Disabled (full response) |
| Timeout | 30s |

#### 7 Prompt Templates

1. **THREAT_INVESTIGATION** — Structured threat analysis with IOC correlation, severity assessment, recommended actions
2. **INTELLIGENCE_SUMMARY** — NATO STANAG 2022 formatted intelligence briefings with situation, assessment, outlook
3. **NATURAL_LANGUAGE_QUERY** — Converts plain English questions to structured database/API queries
4. **ENTITY_EXTRACTION** — Named entity recognition (persons, organizations, locations, weapons, infrastructure)
5. **MISINFORMATION_DETECTION** — Content credibility scoring, source reliability assessment
6. **DECISION_SUPPORT** — Military Decision-Making Process (MDMP) structured analysis
7. **REPORT_GENERATION** — Generates standardized intelligence reports (INTSUM, SITREP, INTREP)

### Healing Agent RCA (Root Cause Analysis)

The Healing Agent uses Ollama for automated root cause analysis:
- System prompt: "You are SENTINEL system health AI. Analyze incidents."
- Output format: ROOT CAUSE, CONFIDENCE (HIGH/MED/LOW), IMMEDIATE ACTION (kubectl command), PREVENTION
- Fallback: If Ollama unavailable, returns generic restart recommendation

### Drift Detection

The AI pipeline monitors for concept drift:
- Feature distribution comparison (KL divergence)
- Model performance degradation tracking
- Automated alerts when drift threshold exceeded
- Model retraining triggers

---

## Database Schema

### PostgreSQL (30+ tables)

#### Extensions
- `postgis` — Geospatial queries and geometry types
- `timescaledb` — Time-series hypertables for sensor data
- `pg_trgm` — Trigram similarity for fuzzy text search
- `btree_gist` — GiST index for exclusion constraints
- `uuid-ossp` — UUID generation

#### ENUM Types (15)
`classification_level`, `domain_type`, `threat_severity`, `alert_status`, `sensor_type`, `sensor_status`, `user_role`, `mission_status`, `task_status`, `detection_type`, `model_status`, `response_action_type`, `rule_condition_op`, `approval_status`, `simulation_status`

#### Core Tables
- `organizations` — Multi-tenant orgs with classification ceilings, hierarchical parent/child
- `users` — Full user model with MFA, lockout, clearance, permissions
- `sensors` — Registered sensors with type, status, location, domain
- `alerts` — Core alert table with severity, classification, IOCs, geolocation
- `detections` — AI detection results linked to models and sensors
- `tracks` — Object tracking with position history
- `missions` — Operational missions with status lifecycle
- `tasks` — Mission-linked tasks with assignment and priority
- `response_rules` — Condition → action rule definitions
- `response_executions` — Execution history with approval tracking
- `cyber_events` — TimescaleDB hypertable for IDS/network events (source/dest IP, port, protocol, MITRE mapping)
- `audit_log` — Immutable audit trail with SHA-256 checksum chain
- `data_classifications` — Per-resource classification markings
- `retention_policies` — Data lifecycle management
- `simulations` — Scenario definitions for red/blue team
- `honeypots` — Decoy asset configurations
- `adversary_profiles` — Threat actor tracking (TTPs, capabilities, intent)

#### Security Features
- **Row-Level Security (RLS)**: Enabled on all tables, filters by `app.current_user_id`
- **Audit Triggers**: `update_updated_at()` on all tables
- **Checksum Chain**: `compute_audit_checksum()` links each audit entry to previous via SHA-256
- **Classification Enforcement**: All tables include `classification_level` column

### MongoDB Collections
- Intelligence reports with GridFS attachments
- Unstructured OSINT raw data
- Model training artifacts

### Neo4j Graph
- **Nodes**: Alert, IOC, Entity, Sensor, ThreatActor, Vulnerability, Organization
- **Edges**: RELATED_TO, TARGETS, EXPLOITS, INDICATES, OBSERVED_BY, ATTRIBUTED_TO
- **Constraints**: Unique ID per node type, existence constraints on required properties

---

## Observability Stack

| Component | Role | Port |
|-----------|------|------|
| **OpenTelemetry Collector** | Trace/metric ingestion & export | 4317 (gRPC), 4318 (HTTP) |
| **Prometheus** | Metrics storage & alerting | 9090 |
| **Grafana** | Dashboards & visualization | 3001 |
| **Jaeger** | Distributed tracing UI | 16686 |
| **Elasticsearch** | Log indexing (via Kibana) | 9200 |
| **Kibana** | Log exploration & SIEM dashboards | 5601 |

### Instrumentation
- Every service exports traces via OpenTelemetry SDK
- Pino structured JSON logging (correlationId, requestId, userId)
- Prometheus `/metrics` endpoint on all services
- Custom Grafana dashboards per service
- Alerting rules for SLO violations (latency, error rate, saturation)

### Health Endpoints
All services expose:
- `GET /health/live` — Liveness probe (process is running)
- `GET /health/ready` — Readiness probe (dependencies connected)

---

## CI/CD Pipeline (GitHub Actions)

```yaml
Pipeline: push to main/develop/release/** or PR to main/develop
```

### Jobs

| Job | Trigger | Description |
|-----|---------|-------------|
| `lint-python` | Always | Ruff linter on `services/`, `ai-workers/`, `services/live-integrations/` |
| `lint-ui` | Always | TypeScript type-check on `ui/` |
| `lint-shell` | Always | TypeScript type-check on `shell/` |
| `lint-shell-rust` | Always | `cargo fmt --check` + `cargo clippy` on `shell/src-tauri/` |
| `integration-tests` | After lint | pytest `tests/test_integration.py` |
| `build-api-gateway` | Push only | Docker build + push to `ghcr.io` |
| `build-ui` | Push only | Docker build + push to `ghcr.io` |
| `security-scan` | After tests | Trivy filesystem scan (CRITICAL, HIGH) |
| `build-iso` | Release branches | Full ISO build + artifact upload (30-day retention) |

### Container Registry
- Registry: `ghcr.io`
- Image naming: `ghcr.io/<owner>/sentinel-os/<service>:<sha>`
- Push: Only on `main` branch

### Concurrency
- Group: `workflow-ref` (cancels in-progress runs on same branch)

---

## Kubernetes Architecture

### Namespace: `sentinel-os`

#### Deployments
- All services deployed with `securityContext`: non-root, read-only root filesystem, all capabilities dropped
- JWT keys mounted as Kubernetes Secrets (read-only volume)
- Temporary storage via `emptyDir` (size-limited)

#### Autoscaling
- **HPA**: CPU (70%) and memory (80%) based scaling
- **KEDA**: Kafka consumer lag-based scaling for AI, Ingestion, Cyber services
- Scale-up: 2 pods per 60s, scale-down: 1 pod per 120s (stabilization windows)

#### High Availability
- **PodDisruptionBudget**: `minAvailable: 2` for API Gateway
- **CloudNativePG**: 3-instance PostgreSQL cluster (1 primary + 2 replicas)
- **Kafka**: 3-broker cluster with `min.insync.replicas: 2`

#### Network Security
- **NetworkPolicies**: Per-service ingress/egress rules
- Only Istio ingress gateway can reach API Gateway
- Backend services only accept traffic from `sentinel-os` namespace
- DNS (port 53) allowed for all pods

#### Node Groups (EKS)
- **Core**: `m5.xlarge` (3-10 instances) — general workloads
- **AI GPU**: `g4dn.xlarge` (0-4 instances) — GPU inference, tainted with `nvidia.com/gpu`

---

## Terraform Modules

| Module | Resources |
|--------|-----------|
| `vpc` | VPC, 3 AZs, public/private/isolated subnets, NAT gateways, flow logs |
| `eks` | EKS cluster (v1.29), core + GPU node groups, KMS encryption, audit logs |
| `rds` | PostgreSQL RDS instance with Multi-AZ |
| `elasticache` | Redis cluster |
| `kafka` | Amazon MSK cluster |

### Environments
- `dev` — Public endpoint, minimal instances, GPU node group at 0
- `staging` — Private endpoint, moderate instances
- `prod` — Private endpoint, full HA, GPU nodes at 2

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | Per-service (4000-4012) | Service listen port |
| `NODE_ENV` | `development` | Environment mode |
| `KAFKA_BROKERS` | `kafka-1:9092,kafka-2:9092,kafka-3:9092` | Kafka broker addresses |
| `PG_HOST` | `postgres-primary` | PostgreSQL host |
| `PG_PORT` | `5432` | PostgreSQL port |
| `PG_DATABASE` | `sentinel` | Database name |
| `PG_USER` | `sentinel_admin` | Database user |
| `PG_PASSWORD` | — | Database password (secret) |
| `REDIS_URL` | `redis://redis-cluster:6379` | Redis connection URL |
| `NEO4J_URI` | `bolt://neo4j:7687` | Neo4j Bolt URI |
| `NEO4J_USER` | `neo4j` | Neo4j username |
| `NEO4J_PASSWORD` | — | Neo4j password (secret) |
| `OLLAMA_URL` | `http://ollama:11434` | Ollama LLM endpoint |
| `ELASTICSEARCH_URL` | `http://elasticsearch:9200` | Elasticsearch endpoint |
| `MONGODB_URI` | `mongodb://mongo:27017/sentinel` | MongoDB connection string |
| `JWT_PRIVATE_KEY_PATH` | `/etc/sentinel/jwt/private.pem` | JWT RS256 private key |
| `JWT_PUBLIC_KEY_PATH` | `/etc/sentinel/jwt/public.pem` | JWT RS256 public key |
| `CORS_ORIGINS` | `https://sentinel.internal` | Allowed CORS origins |
| `LOG_LEVEL` | `info` | Pino log level (trace/debug/info/warn/error) |
| `GRAPHQL_DEPTH_LIMIT` | `10` | Max GraphQL query depth |
| `GRAPHQL_COMPLEXITY_LIMIT` | `2000` | Max query complexity score |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window (ms) |
| `RATE_LIMIT_MAX` | `1000` | Max requests per window |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4317` | OpenTelemetry collector |
| `SURICATA_EVE_LOG` | `/var/log/suricata/eve.json` | Suricata EVE JSON path |

---

## Roadmap

### Completed
- [x] Core microservices architecture (13 services, monorepo, Turborepo)
- [x] Event-driven Kafka backbone (25+ Strimzi topics, 3-broker cluster)
- [x] GraphQL API Gateway with real-time subscriptions (6 subscription types)
- [x] Auth Service (JWT RS256, MFA/TOTP, RBAC, API keys, account lockout)
- [x] AI Service (YOLOv8, Isolation Forest, LSTM, Ollama LLM, drift detection)
- [x] Python AI Workers (YOLOv8, LSTM, TorchSig, anomaly detection, GNURadio)
- [x] Ingestion Service (RTSP, MQTT, Radar, Drone, Webhook, edge processing)
- [x] OSINT Service (RSS, API, scraping, Telegram, Reddit, IOC extraction, NLP)
- [x] Fusion Service (Neo4j graph correlation, geospatial, entity linking)
- [x] Cyber Service (Elasticsearch SIEM, Suricata IDS, threat intel, CVE enrichment)
- [x] Response Service (rule engine, approval workflows, automated pipelines)
- [x] Simulation Service (MITRE ATT&CK 190+ techniques, digital twin, honeypots)
- [x] Governance Service (tamper-evident audit, retention, compliance, AI governance)
- [x] SIGINT Service (ADS-B, AIS, SDR spectrum, APRS, ACARS, KrakenSDR)
- [x] Geo Service (NASA GIBS, OpenWeatherMap, USGS, Sentinel Hub, GeoNames)
- [x] Healing Agent (MAPE-K loop, Ollama RCA, runbook automation, tamper response)
- [x] PostgreSQL schema (30+ tables, 15 ENUM types, RLS, TimescaleDB, checksums)
- [x] Kubernetes manifests (Deployments, HPA, PDB, NetworkPolicy, KEDA scalers)
- [x] Helm charts (6 services with values, HPA, security contexts)
- [x] CloudNativePG (3-node PostgreSQL HA cluster)
- [x] Istio configuration (Gateway, VirtualService, mTLS, AuthZ, circuit breakers)
- [x] Terraform modules (VPC, EKS, RDS, ElastiCache, MSK — 3 environments)
- [x] CI/CD pipeline (GitHub Actions: lint, test, scan, build, ISO)
- [x] React web dashboard (Dashboard, Alerts, Map, Sensors, Cyber, Fusion, OSINT, Response)
- [x] Tauri v2 desktop shell (11 panels, 6 workspaces, fullscreen HUD)
- [x] Custom Wayland compositor (wlroots 0.19, CRT/radar shaders)
- [x] Custom kernel modules (Sentinel LSM, RTL-SDR driver)
- [x] CLI tool (Commander.js — alerts, sensors, cyber, response, sim, osint, health)
- [x] Bootable ISO (Kali-based, EFI+BIOS, 6.3 GB, live-build)
- [x] Integration test suite (pytest)
- [x] Database seeding (PostgreSQL, MongoDB, Neo4j)
- [x] Docker Compose (dev + production, 30+ containers)
- [x] MapLibre GL tactical map with alert clustering
- [x] D3 force-directed graph for intelligence fusion

### In Progress
- [ ] E2E Playwright test coverage
- [ ] Helm umbrella chart for single-command deployment
- [ ] OpenAPI documentation generation from GraphQL schema
- [ ] Multi-region Terraform deployment
- [ ] Automated model retraining pipeline

---

## CLI Usage

```bash
# Set API URL and token
export SENTINEL_API_URL=http://localhost:4000
export SENTINEL_TOKEN=<your-jwt-token>

# List alerts
sentinel alerts list --severity CRITICAL --limit 10

# Acknowledge an alert
sentinel alerts acknowledge <alert-id>

# List sensors
sentinel sensors list --type RADAR

# Query system health
sentinel health status

# Run simulation
sentinel sim start --team RED --technique T1566.001

# Query OSINT
sentinel osint feeds --enabled
```

---

## Testing

```bash
# Run integration tests
python -m pytest tests/test_integration.py -v

# Tests verify:
# - Kernel module sources exist with key functions
# - RTL-SDR driver has character device operations
# - All services have valid TypeScript/Python source
# - Compositor builds with wlroots dependencies
# - Shell Tauri configuration is valid
# - AI workers import correctly
# - Database schemas are syntactically valid
```

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit with conventional commits (`feat:`, `fix:`, `docs:`, `chore:`)
4. Push and open a Pull Request
5. CI must pass (lint, test, security scan)

---

## License

Proprietary — All rights reserved.

---

## Classification

**UNCLASSIFIED // FOR OFFICIAL USE ONLY**

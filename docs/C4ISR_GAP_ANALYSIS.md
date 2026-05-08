# Sentinel OS — C4ISR Gap Analysis & Enhancement Plan

**Date:** 2026-05-08
**Scope:** Comparison against US (JADC2/Project Maven), NATO (FMN), Chinese (PLA INEW), and Russian (Strelets/Akatsiya-M) C4ISR systems plus commercial platforms (Palantir Gotham, ATAK).

---

## 1. Comparative Capability Matrix

| Capability | US JADC2 | NATO FMN | PLA (China) | Russia (Strelets) | Palantir Gotham | **Sentinel OS (current)** |
|---|---|---|---|---|---|---|
| Cross-domain C2 (land/sea/air/space/cyber) | ✓ | ✓ | ✓ | partial | ✓ | partial |
| AI-driven sensor fusion (multi-INT) | ✓ (Maven) | ✓ | ✓ | partial | ✓ | partial (`fusion-service` stub) |
| Common Operating Picture (COP) w/ MIL-STD-2525 | ✓ | ✓ (STANAG 2525) | ✓ | ✓ | ✓ | ✗ (basic map only) |
| Blue Force Tracking (BFT) | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Tactical Data Links (Link 16/22, VMF) | ✓ | ✓ | proprietary | proprietary | ✓ | ✗ |
| ATAK / Team Awareness Kit | ✓ | partial | — | — | ✓ | ✗ |
| Federated identity (coalition partners) | ✓ | ✓ (CFI) | n/a | n/a | ✓ | ✗ |
| Zero-Trust security (mTLS, ABAC) | ✓ | ✓ | n/a | n/a | ✓ | partial |
| Quantum-safe crypto (Kyber, Dilithium) | in progress | in progress | claimed | claimed | partial | ✗ |
| STIX/TAXII threat intel ingest | ✓ | ✓ | n/a | n/a | ✓ | ✗ |
| MITRE ATT&CK mapping | ✓ | ✓ | n/a | n/a | ✓ | ✗ |
| Mission Planning / COA generation | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Counter-UAS / drone detection | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Space Situational Awareness (SSA) | ✓ | partial | ✓ | partial | ✓ | ✗ |
| MUM-T (Manned-Unmanned Teaming) | ✓ | partial | ✓ | partial | ✓ | ✗ |
| Edge inference (ONNX/TensorRT) | ✓ | partial | ✓ | partial | ✓ | partial (Ollama only) |
| Real-time collaboration (chat/whiteboard) | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| GEOINT (imagery analysis, change detection) | ✓ | ✓ | ✓ | partial | ✓ | partial (basic map) |
| HUMINT case management | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Predictive analytics / forecasting | ✓ | ✓ | ✓ | partial | ✓ | partial (ai-service) |
| Reconnaissance-strike loop / sensor-to-shooter | ✓ | ✓ | ✓ | ✓ (key feature) | ✓ | ✗ |
| EW / spectrum management | ✓ | ✓ | ✓ (INEW) | ✓ | partial | partial (sigint-service) |

---

## 2. Identified Gaps (Priority-Ranked)

### Priority 1 — Critical for credibility as a C4ISR platform
1. **Common Operating Picture with MIL-STD-2525D military symbology** — every modern C4ISR uses this NATO standard for tactical icons (friendly/hostile/neutral/unknown × air/ground/sea/space).
2. **Blue Force Tracking (BFT)** — track friendly assets in real-time on map; required for fratricide prevention.
3. **ATAK / TAK-server protocol (CoT XML over TCP/UDP)** — de-facto standard for tactical situational awareness across US/NATO; ingests from ATAK Android/iTAK iOS clients.
4. **Threat Intelligence (STIX/TAXII 2.1 + MITRE ATT&CK)** — automated ingest of indicators of compromise from MISP, AlienVault OTX, govt feeds.
5. **Mission Planning / Course-of-Action (COA) generator** — AI-recommended action plans with risk scoring.

### Priority 2 — Modernization parity
6. **Counter-UAS (C-UAS) detection** — RF/radar/EO drone detection panel; integrate with existing SIGINT.
7. **Space Situational Awareness** — TLE-based satellite tracking (SGP4), conjunction warning, anti-satellite threat detection.
8. **Sensor-to-Shooter (Recon-Strike Loop)** — Russian/Chinese strength: automated target → effector pairing with engagement authorization workflow.
9. **Federated identity (OAuth2/OIDC + SAML)** for coalition partners — FMN requirement.
10. **Zero-Trust mTLS** between all microservices (currently plaintext on docker network).

### Priority 3 — Future-proofing
11. **Quantum-safe cryptography** (Kyber-1024 KEM, Dilithium-5 signatures) — NIST post-quantum standards, mandatory for new US DoD systems by 2027.
12. **MUM-T (Manned-Unmanned Teaming)** — drone swarm control via STANAG 4586.
13. **Real-time collaboration** — operator chat, shared whiteboard, voice-over-IP within ops room.
14. **GEOINT change detection** — automated satellite imagery diff, AI object detection (ships, vehicles, buildings).
15. **HUMINT case management** — source/agent/contact graph with link analysis.
16. **Edge inference** — ONNX/TensorRT models for tactical edge devices (without internet).

---

## 3. Implementation Plan

### Phase 1 (this commit)
- **`tak-service`** — TAK-server compatible CoT XML ingestion (UDP 4242, TCP 8087)
- **`threat-intel-service`** — STIX/TAXII 2.1 ingest, MITRE ATT&CK mapping
- **`mission-planning-service`** — COA generator using LLM + rule engine
- **`space-awareness-service`** — TLE feed (CelesTrak), SGP4 propagation, conjunction warning
- **`counter-uas-service`** — RF anomaly detection, drone signature DB
- **New Tauri panels:**
  - `BlueForceTracker.tsx` (MIL-STD-2525 symbology overlay)
  - `ThreatIntel.tsx` (STIX feeds + MITRE ATT&CK matrix)
  - `MissionPlanner.tsx` (COA generator + map)
  - `CounterUAS.tsx` (drone detection HUD)
  - `SpaceSA.tsx` (orbital tracker)
  - `Collaboration.tsx` (chat/whiteboard)

### Phase 2 (✓ COMPLETED)
- ✓ **`coalition-auth-service`** (port 8095) — OIDC + JWT (RS256), Argon2id passwords,
  ABAC claims (nation, clearance, caveats, COI, roles), JWKS, discovery endpoint,
  4 seeded users (USA/GBR/FRA), session revocation, introspection
- ✓ **`crypto-service`** (port 8096) — NIST FIPS 203/204/205:
  ML-KEM (Kyber) 512/768/1024, ML-DSA (Dilithium) 44/65/87, SLH-DSA (SPHINCS+),
  hybrid Kyber + AES-256-GCM envelope encryption
- ✓ **`edge-inference-service`** (port 8097) — ONNX Runtime Node,
  multi-model serving with hot-reload, anomaly scoring (3-sigma),
  default model auto-download (YOLOv4, MobileNetV2)
- (mTLS mesh — runtime config, not service code; provided via docker network encryption flag)

### Phase 3 (✓ COMPLETED)
- ✓ **`link16-service`** (port 8098) — MIL-STD-6016 J-series messaging:
  J2.0/2.2/2.3/2.5, J3.2/3.3/3.5/3.7, J7.0, J12.0/12.6 (PPLI, tracks, EW, mission)
- ✓ **`data-seeder-service`** (port 8099) — Ollama-driven continuous seeder:
  3 modes (exercise/quiet/stop), feeds tak/ti/mp/cuas/l16/auth services,
  geographic region biases (E.Europe, M.East, SCS, Korea, Pakistan/AF),
  marks all synthetic data with `synthetic=true` tag
- ATAK Android client: covered by `tak-service` (CoT 2.0 fully compliant)
- AIS marine tracking: existing in `sigint-service` connectors
- STANAG 4586, Mumble VoIP: deferred (low priority for this iteration)

---

## 4. References
- US JADC2: https://www.idga.org/command-and-control/articles/c4isr-jadc2-the-next-frontier-in-military-command-and-control
- NATO FMN: https://www.act.nato.int/activities/federated-mission-networking/
- PLA INEW: https://idsa.in/system/files/jds_4_2_dsharma.pdf
- Russian Strelets/Akatsiya-M: https://www.cna.org/reports/2019/10/IOP-2019-U-021801-Final.pdf
- Palantir Gotham: https://www.palantir.com/platforms/gotham/
- MIL-STD-2525D: NATO STANAG 2525 (joint military symbology)
- STIX/TAXII 2.1: https://oasis-open.github.io/cti-documentation/
- MITRE ATT&CK: https://attack.mitre.org/
- ATAK/TAK CoT: https://github.com/deptofdefense/AndroidTacticalAssaultKit-CIV

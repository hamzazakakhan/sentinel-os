-- ═══════════════════════════════════════════════════════════════
-- Sentinel OS — Full Seed Data (matches 003_core_tables.sql)
-- ═══════════════════════════════════════════════════════════════

-- Organizations
INSERT INTO organizations (id, name, short_code, country_code, classification_ceiling, created_at) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Joint Task Force Alpha', 'JTF-A', 'US', 'SECRET', NOW()),
  ('a0000000-0000-0000-0000-000000000002', 'Cyber Defense Command', 'CYBERDEF', 'US', 'TOP_SECRET', NOW()),
  ('a0000000-0000-0000-0000-000000000003', 'Forward Operating Base Delta', 'FOB-D', 'US', 'SECRET', NOW())
ON CONFLICT DO NOTHING;

-- Users
INSERT INTO users (id, organization_id, username, email, password_hash, role, clearance_level, is_active, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'cdr.harris', 'harris@jtf-alpha.mil', '$2b$12$fakehashfakehashfakehashfakehashfakehashfakehashfake', 'COMMANDER', 'TOP_SECRET', true, NOW()),
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'lt.martinez', 'martinez@jtf-alpha.mil', '$2b$12$fakehashfakehashfakehashfakehashfakehashfakehashfake', 'OPERATOR', 'SECRET', true, NOW()),
  ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 'cyber.analyst1', 'analyst1@cyberdef.mil', '$2b$12$fakehashfakehashfakehashfakehashfakehashfakehashfake', 'ANALYST', 'TOP_SECRET', true, NOW()),
  ('b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000003', 'sgt.walker', 'walker@fob-delta.mil', '$2b$12$fakehashfakehashfakehashfakehashfakehashfakehashfake', 'OPERATOR', 'SECRET', true, NOW()),
  ('b0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000002', 'sys.sentinel', 'system@sentinel.mil', '$2b$12$fakehashfakehashfakehashfakehashfakehashfakehashfake', 'API_SERVICE', 'SCI', true, NOW())
ON CONFLICT DO NOTHING;

-- Sensors (location is GEOMETRY(Point,4326), use ST_SetSRID(ST_MakePoint(lon,lat),4326))
INSERT INTO sensors (id, organization_id, name, sensor_type, status, domain, location, created_at) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', 'Camera Alpha-1', 'CCTV', 'ONLINE', 'LAND', ST_SetSRID(ST_MakePoint(-117.0383, 32.5150), 4326), NOW()),
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003', 'Camera Alpha-2', 'THERMAL', 'ONLINE', 'LAND', ST_SetSRID(ST_MakePoint(-117.0390, 32.5155), 4326), NOW()),
  ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'Radar GR-01', 'RADAR', 'ONLINE', 'AIR', ST_SetSRID(ST_MakePoint(-117.0520, 32.5420), 4326), NOW()),
  ('c0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000003', 'Seismic Sensor S-4', 'SEISMIC', 'ONLINE', 'LAND', ST_SetSRID(ST_MakePoint(-117.0202, 32.5102), 4326), NOW()),
  ('c0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000002', 'IDS-Primary', 'IOT', 'ONLINE', 'CYBER', NULL, NOW()),
  ('c0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'Drone Overwatch-1', 'DRONE', 'ONLINE', 'AIR', ST_SetSRID(ST_MakePoint(-117.0400, 32.5200), 4326), NOW()),
  ('c0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000003', 'RF Scanner RF-01', 'RF', 'DEGRADED', 'LAND', ST_SetSRID(ST_MakePoint(-117.0370, 32.5160), 4326), NOW()),
  ('c0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000002', 'SIEM-Collector', 'IOT', 'ONLINE', 'CYBER', NULL, NOW())
ON CONFLICT DO NOTHING;

-- Detections (location is GEOMETRY)
INSERT INTO detections (id, sensor_id, domain, detection_type, confidence, location, detected_at) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'LAND', 'PERSON', 0.94, ST_SetSRID(ST_MakePoint(-117.0383, 32.5150), 4326), NOW() - INTERVAL '5 minutes'),
  ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'LAND', 'VEHICLE', 0.87, ST_SetSRID(ST_MakePoint(-117.0385, 32.5152), 4326), NOW() - INTERVAL '3 minutes'),
  ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'AIR', 'AIRCRAFT', 0.72, ST_SetSRID(ST_MakePoint(-117.0520, 32.5420), 4326), NOW() - INTERVAL '10 minutes'),
  ('d0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000004', 'LAND', 'VIBRATION_ANOMALY', 0.65, ST_SetSRID(ST_MakePoint(-117.0202, 32.5102), 4326), NOW() - INTERVAL '15 minutes'),
  ('d0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000005', 'CYBER', 'INTRUSION_ATTEMPT', 0.91, NULL, NOW() - INTERVAL '2 minutes')
ON CONFLICT DO NOTHING;

-- Alerts
INSERT INTO alerts (id, organization_id, title, description, severity, status, domain, source_type, source_id, confidence, tags, created_at) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', 'Unauthorized personnel detected in Sector A', 'Camera Alpha-1 detected 3 individuals crossing perimeter fence at grid ref 32.515N 117.038W', 'CRITICAL', 'NEW', 'LAND', 'SENSOR', 'd0000000-0000-0000-0000-000000000001', 0.94, '{perimeter,intrusion,sector-a}', NOW() - INTERVAL '5 minutes'),
  ('e0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003', 'Unregistered vehicle approaching checkpoint', 'Sedan-type vehicle without transponder moving north on access road', 'HIGH', 'ACKNOWLEDGED', 'LAND', 'SENSOR', 'd0000000-0000-0000-0000-000000000002', 0.87, '{vehicle,checkpoint,unregistered}', NOW() - INTERVAL '3 minutes'),
  ('e0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'Low-altitude aircraft in restricted airspace', 'Radar GR-01 tracking unidentified aircraft at 500ft AGL, bearing 270', 'HIGH', 'INVESTIGATING', 'AIR', 'SENSOR', 'd0000000-0000-0000-0000-000000000003', 0.72, '{airspace,radar,unidentified}', NOW() - INTERVAL '10 minutes'),
  ('e0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'Seismic anomaly — possible tunnel activity', 'Sustained low-frequency vibrations detected, pattern consistent with excavation', 'MEDIUM', 'NEW', 'LAND', 'SENSOR', 'd0000000-0000-0000-0000-000000000004', 0.65, '{seismic,tunnel,anomaly}', NOW() - INTERVAL '15 minutes'),
  ('e0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000002', 'SQL injection attempt from 185.220.101.34', 'IDS signature match: SQL injection targeting /api/auth endpoint, payload encoded', 'CRITICAL', 'NEW', 'CYBER', 'IDS', 'd0000000-0000-0000-0000-000000000005', 0.91, '{sql-injection,ids,web-app}', NOW() - INTERVAL '2 minutes'),
  ('e0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000002', 'Brute force SSH attack detected', 'Over 500 failed SSH attempts from 45.155.205.189 in last 10 minutes', 'HIGH', 'NEW', 'CYBER', 'IDS', NULL, 0.95, '{ssh,brute-force,external}', NOW() - INTERVAL '8 minutes'),
  ('e0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000002', 'C2 beacon traffic identified', 'Outbound HTTPS traffic matching known Cobalt Strike C2 profile to 91.92.248.0/24', 'CRITICAL', 'ESCALATED', 'CYBER', 'NDR', NULL, 0.88, '{c2,cobalt-strike,exfil}', NOW() - INTERVAL '20 minutes'),
  ('e0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000001', 'OSINT: Threat actor forum post mentions target', 'Dark web forum post referencing operational infrastructure by name', 'HIGH', 'NEW', 'OSINT', 'OSINT_FEED', NULL, 0.78, '{darkweb,threat-intel,opsec}', NOW() - INTERVAL '45 minutes'),
  ('e0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000003', 'Drone RF signature detected near perimeter', 'RF sensor detected 2.4GHz control signal consistent with commercial drone', 'MEDIUM', 'NEW', 'LAND', 'SENSOR', NULL, 0.70, '{drone,rf,perimeter}', NOW() - INTERVAL '12 minutes'),
  ('e0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000002', 'Anomalous DNS exfiltration pattern', 'High volume of TXT queries to suspicious domain — possible data exfiltration', 'HIGH', 'NEW', 'CYBER', 'NDR', NULL, 0.83, '{dns,exfiltration,anomaly}', NOW() - INTERVAL '6 minutes')
ON CONFLICT DO NOTHING;

-- Cyber Events (no blocked/ioc_match columns; use ioc_matches JSONB and organization_id)
INSERT INTO cyber_events (id, organization_id, event_type, source_ip, destination_ip, source_port, destination_port, protocol, severity, signature_name, ioc_matches, detected_at) VALUES
  ('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'IDS_ALERT', '185.220.101.34', '10.0.1.50', 45832, 443, 'TCP', 'CRITICAL', 'ET ATTACK SQL Injection Attempt', '["185.220.101.34"]', NOW() - INTERVAL '2 minutes'),
  ('f0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'IDS_ALERT', '45.155.205.189', '10.0.1.10', 55123, 22, 'TCP', 'HIGH', 'ET SCAN SSH Brute Force', '[]', NOW() - INTERVAL '8 minutes'),
  ('f0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 'NETWORK_ANOMALY', '10.0.2.105', '91.92.248.15', 49200, 443, 'TCP', 'CRITICAL', 'Cobalt Strike C2 Beacon', '["91.92.248.15"]', NOW() - INTERVAL '20 minutes'),
  ('f0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000002', 'DNS_ANOMALY', '10.0.3.22', '8.8.8.8', 53401, 53, 'UDP', 'HIGH', 'DNS Exfiltration via TXT Records', '[]', NOW() - INTERVAL '6 minutes'),
  ('f0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000002', 'IDS_ALERT', '103.75.201.44', '10.0.1.50', 38291, 80, 'TCP', 'MEDIUM', 'ET EXPLOIT Apache Struts RCE', '["103.75.201.44"]', NOW() - INTERVAL '30 minutes'),
  ('f0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000002', 'PORT_SCAN', '45.155.205.189', '10.0.1.0', 0, 0, 'TCP', 'MEDIUM', 'Nmap SYN Scan Detected', '[]', NOW() - INTERVAL '35 minutes'),
  ('f0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000002', 'MALWARE', '10.0.2.200', '185.100.87.202', 61234, 443, 'TCP', 'CRITICAL', 'Cobalt Strike Loader DLL', '["185.100.87.202"]', NOW() - INTERVAL '22 minutes'),
  ('f0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000002', 'LATERAL_MOVEMENT', '10.0.2.105', '10.0.2.110', 49300, 445, 'TCP', 'HIGH', 'SMB Lateral Movement PsExec', '[]', NOW() - INTERVAL '18 minutes')
ON CONFLICT DO NOTHING;

-- Threat Indicators (no hit_count; use threat_type, confidence, first_seen_at)
INSERT INTO threat_indicators (id, indicator_type, value, threat_type, severity, source_feed, confidence, tags, is_active, first_seen_at, created_at) VALUES
  ('aa000000-0000-0000-0000-000000000001', 'IP', '185.220.101.34', 'SCANNER', 'CRITICAL', 'AbuseIPDB', 0.98, '{tor-exit,brute-force}', true, NOW() - INTERVAL '30 days', NOW() - INTERVAL '7 days'),
  ('aa000000-0000-0000-0000-000000000002', 'IP', '45.155.205.189', 'APT', 'HIGH', 'AlienVault OTX', 0.85, '{apt28,scanner}', true, NOW() - INTERVAL '14 days', NOW() - INTERVAL '3 days'),
  ('aa000000-0000-0000-0000-000000000003', 'IP', '91.92.248.15', 'C2', 'CRITICAL', 'Mandiant', 0.95, '{cobalt-strike,c2}', true, NOW() - INTERVAL '7 days', NOW() - INTERVAL '1 day'),
  ('aa000000-0000-0000-0000-000000000004', 'DOMAIN', 'evil-c2-domain.xyz', 'C2', 'CRITICAL', 'VirusTotal', 0.92, '{c2,malware-delivery}', true, NOW() - INTERVAL '10 days', NOW() - INTERVAL '2 days'),
  ('aa000000-0000-0000-0000-000000000005', 'HASH_SHA256', 'a1b2c3d4e5f6deadbeef1234567890abcdef1234567890abcdef1234567890ab', 'MALWARE', 'HIGH', 'Mandiant', 0.88, '{cobalt-strike,loader}', true, NOW() - INTERVAL '20 days', NOW() - INTERVAL '5 days'),
  ('aa000000-0000-0000-0000-000000000006', 'IP', '103.75.201.44', 'EXPLOIT', 'MEDIUM', 'CrowdStrike', 0.72, '{exploit,struts}', true, NOW() - INTERVAL '45 days', NOW() - INTERVAL '10 days'),
  ('aa000000-0000-0000-0000-000000000007', 'URL', 'https://phishing-kit.example.com/login', 'PHISHING', 'HIGH', 'PhishTank', 0.90, '{phishing,credential-harvest}', true, NOW() - INTERVAL '21 days', NOW() - INTERVAL '4 days'),
  ('aa000000-0000-0000-0000-000000000008', 'EMAIL', 'attacker@spear-phish.ru', 'PHISHING', 'MEDIUM', 'Recorded Future', 0.65, '{spear-phishing,apt29}', true, NOW() - INTERVAL '60 days', NOW() - INTERVAL '14 days')
ON CONFLICT DO NOTHING;

-- Response Rules (no execution_count; use action_type, priority, created_by)
INSERT INTO response_rules (id, organization_id, name, description, conditions, actions, action_type, severity_threshold, requires_approval, is_active, priority, created_by, created_at) VALUES
  ('bb000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Auto-Block Critical IPs', 'Automatically block IPs with CRITICAL threat indicators at firewall', '{"severity":"CRITICAL","indicator_type":"IP"}', '{"action":"block_at_firewall"}', 'BLOCK_IP', 'CRITICAL', false, true, 1, 'b0000000-0000-0000-0000-000000000001', NOW() - INTERVAL '30 days'),
  ('bb000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'Isolate Compromised Host', 'Network-isolate hosts with confirmed C2 communication', '{"event_type":"C2","confidence_min":0.8}', '{"action":"network_isolate"}', 'ISOLATE_HOST', 'CRITICAL', true, true, 2, 'b0000000-0000-0000-0000-000000000003', NOW() - INTERVAL '60 days'),
  ('bb000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003', 'Alert QRF — Perimeter Breach', 'Dispatch Quick Reaction Force on confirmed perimeter intrusion', '{"domain":"LAND","detection_type":"PERSON","zone":"perimeter"}', '{"action":"dispatch_qrf"}', 'ALERT_OPERATOR', 'HIGH', true, true, 1, 'b0000000-0000-0000-0000-000000000004', NOW() - INTERVAL '90 days'),
  ('bb000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000002', 'Quarantine Malware Sample', 'Move detected malware to sandbox for analysis', '{"event_type":"MALWARE"}', '{"action":"sandbox_submit"}', 'QUARANTINE_FILE', 'HIGH', false, true, 3, 'b0000000-0000-0000-0000-000000000003', NOW() - INTERVAL '45 days'),
  ('bb000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'Drone Intercept Protocol', 'Launch counter-UAS protocol for unauthorized drones', '{"domain":"AIR","detection_type":"DRONE","confidence_min":0.7}', '{"action":"activate_counter_uas"}', 'ACTIVATE_COUNTERMEASURE', 'HIGH', true, true, 2, 'b0000000-0000-0000-0000-000000000001', NOW() - INTERVAL '120 days')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- Sentinel OS — PostgreSQL Seed Data
-- Realistic defense & intelligence operational data
-- ============================================================================

-- Organization
INSERT INTO organizations (id, name, description, classification) VALUES
  ('org-alpha-001', 'Joint Task Force Alpha', 'Multi-domain operations command', 'SECRET'),
  ('org-bravo-002', 'Cyber Defense Unit Bravo', 'Dedicated cyber warfare and defense', 'TOP_SECRET'),
  ('org-charlie-003', 'Intelligence Fusion Center', 'Cross-agency intelligence coordination', 'SECRET');

-- Users
INSERT INTO users (id, organization_id, username, email, password_hash, role, clearance_level, is_active, mfa_enabled) VALUES
  ('usr-cmd-001', 'org-alpha-001', 'col.harris', 'harris@sentinel.mil', '$2b$12$LJ3m5Z5Q5Z5Q5Z5Q5Z5Q5eABCDEFGHIJKLMNOPQRSTUVWXYZ012345', 'COMMANDER', 'TOP_SECRET', true, true),
  ('usr-anl-002', 'org-alpha-001', 'maj.chen', 'chen@sentinel.mil', '$2b$12$LJ3m5Z5Q5Z5Q5Z5Q5Z5Q5eABCDEFGHIJKLMNOPQRSTUVWXYZ012345', 'ANALYST', 'SECRET', true, true),
  ('usr-opr-003', 'org-alpha-001', 'cpt.rodriguez', 'rodriguez@sentinel.mil', '$2b$12$LJ3m5Z5Q5Z5Q5Z5Q5Z5Q5eABCDEFGHIJKLMNOPQRSTUVWXYZ012345', 'OPERATOR', 'SECRET', true, false),
  ('usr-adm-004', 'org-bravo-002', 'lt.nakamura', 'nakamura@sentinel.mil', '$2b$12$LJ3m5Z5Q5Z5Q5Z5Q5Z5Q5eABCDEFGHIJKLMNOPQRSTUVWXYZ012345', 'ADMIN', 'TOP_SECRET', true, true),
  ('usr-anl-005', 'org-bravo-002', 'sgt.okonkwo', 'okonkwo@sentinel.mil', '$2b$12$LJ3m5Z5Q5Z5Q5Z5Q5Z5Q5eABCDEFGHIJKLMNOPQRSTUVWXYZ012345', 'ANALYST', 'SECRET', true, true),
  ('usr-opr-006', 'org-charlie-003', 'cpl.martinez', 'martinez@sentinel.mil', '$2b$12$LJ3m5Z5Q5Z5Q5Z5Q5Z5Q5eABCDEFGHIJKLMNOPQRSTUVWXYZ012345', 'OPERATOR', 'CONFIDENTIAL', true, false);

-- Sensors
INSERT INTO sensors (id, organization_id, name, sensor_type, domain, status, latitude, longitude, configuration, classification) VALUES
  ('sen-cam-001', 'org-alpha-001', 'Perimeter Camera North Gate', 'CCTV', 'LAND', 'ONLINE', 38.8977, -77.0365, '{"resolution":"4K","fps":30,"nightVision":true,"model":"Axis P1448-LE"}', 'CONFIDENTIAL'),
  ('sen-cam-002', 'org-alpha-001', 'Perimeter Camera East Fence', 'CCTV', 'LAND', 'ONLINE', 38.8980, -77.0350, '{"resolution":"1080p","fps":25,"nightVision":true,"model":"Hikvision DS-2CD2T85"}', 'CONFIDENTIAL'),
  ('sen-cam-003', 'org-alpha-001', 'Watchtower Camera South', 'CCTV', 'LAND', 'DEGRADED', 38.8965, -77.0370, '{"resolution":"4K","fps":15,"nightVision":true,"model":"Bosch DINION IP 7100i"}', 'CONFIDENTIAL'),
  ('sen-rad-001', 'org-alpha-001', 'Primary Surveillance Radar', 'RADAR', 'AIR', 'ONLINE', 38.8990, -77.0380, '{"range_km":120,"update_rate_s":4,"type":"PSR","frequency":"S-band"}', 'SECRET'),
  ('sen-rad-002', 'org-alpha-001', 'Secondary Surveillance Radar', 'RADAR', 'AIR', 'ONLINE', 38.8992, -77.0375, '{"range_km":200,"update_rate_s":6,"type":"SSR","mode":"Mode-S"}', 'SECRET'),
  ('sen-rad-003', 'org-alpha-001', 'Coastal Radar Station', 'RADAR', 'SEA', 'ONLINE', 38.8700, -76.9900, '{"range_km":80,"update_rate_s":3,"type":"surface_search","frequency":"X-band"}', 'SECRET'),
  ('sen-iot-001', 'org-alpha-001', 'Seismic Sensor Array Alpha', 'IOT', 'LAND', 'ONLINE', 38.8960, -77.0340, '{"type":"seismic","sensitivity":"high","array_size":12}', 'CONFIDENTIAL'),
  ('sen-iot-002', 'org-alpha-001', 'Weather Station Bravo', 'IOT', 'LAND', 'ONLINE', 38.8985, -77.0360, '{"sensors":["temp","humidity","wind","pressure","rain"],"interval_s":60}', 'UNCLASSIFIED'),
  ('sen-iot-003', 'org-alpha-001', 'Acoustic Sensor Fence Line', 'IOT', 'LAND', 'ONLINE', 38.8970, -77.0355, '{"type":"acoustic","range_m":500,"sensitivity":"medium"}', 'CONFIDENTIAL'),
  ('sen-drn-001', 'org-alpha-001', 'Patrol Drone Alpha-1', 'DRONE', 'AIR', 'ONLINE', 38.8990, -77.0365, '{"model":"DJI Matrice 350","endurance_min":55,"payload":"thermal+optical","altitude_m":120}', 'SECRET'),
  ('sen-drn-002', 'org-alpha-001', 'Patrol Drone Alpha-2', 'DRONE', 'AIR', 'OFFLINE', 38.8977, -77.0365, '{"model":"DJI Matrice 350","endurance_min":55,"payload":"optical","altitude_m":100}', 'SECRET'),
  ('sen-drn-003', 'org-alpha-001', 'Recon Drone Bravo-1', 'DRONE', 'AIR', 'ONLINE', 38.9010, -77.0400, '{"model":"Skydio X10","endurance_min":40,"payload":"lidar+thermal","altitude_m":80}', 'SECRET'),
  ('sen-sonar-001', 'org-alpha-001', 'Harbor Sonar Array', 'SONAR', 'SEA', 'ONLINE', 38.8700, -76.9910, '{"type":"passive","depth_m":15,"range_km":5}', 'SECRET'),
  ('sen-net-001', 'org-bravo-002', 'Network TAP Core Switch', 'NETWORK', 'CYBER', 'ONLINE', NULL, NULL, '{"interface":"10GbE","capture":"full_packet","storage_tb":50}', 'SECRET'),
  ('sen-net-002', 'org-bravo-002', 'Suricata IDS Node 1', 'IDS', 'CYBER', 'ONLINE', NULL, NULL, '{"rules":45000,"throughput_gbps":10,"version":"7.0.3"}', 'SECRET'),
  ('sen-net-003', 'org-bravo-002', 'Honeypot Cluster Alpha', 'HONEYPOT', 'CYBER', 'ONLINE', NULL, NULL, '{"services":["ssh","http","smb","rdp"],"instances":8}', 'TOP_SECRET');

-- Detections
INSERT INTO detections (id, organization_id, sensor_id, detection_type, domain, confidence, latitude, longitude, metadata, classification, created_at) VALUES
  ('det-001', 'org-alpha-001', 'sen-cam-001', 'PERSON', 'LAND', 0.94, 38.8978, -77.0364, '{"model":"yolov8x","bbox":[120,340,280,510],"label":"person","speed_mph":3.2,"direction":"SE","clothing":"dark_jacket"}', 'CONFIDENTIAL', NOW() - INTERVAL '2 hours'),
  ('det-002', 'org-alpha-001', 'sen-cam-001', 'VEHICLE', 'LAND', 0.97, 38.8979, -77.0363, '{"model":"yolov8x","bbox":[50,200,400,380],"label":"sedan","color":"black","plate":"WA-4521-BR","speed_mph":15}', 'CONFIDENTIAL', NOW() - INTERVAL '1 hour 45 minutes'),
  ('det-003', 'org-alpha-001', 'sen-cam-002', 'WEAPON', 'LAND', 0.88, 38.8981, -77.0349, '{"model":"yolov8x","bbox":[200,150,320,250],"label":"rifle","associated_person":"det-001"}', 'SECRET', NOW() - INTERVAL '1 hour 30 minutes'),
  ('det-004', 'org-alpha-001', 'sen-rad-001', 'AIRCRAFT', 'AIR', 0.92, 38.9100, -77.0200, '{"type":"rotary_wing","altitude_ft":2500,"speed_kts":85,"heading":270,"squawk":"1200","track_id":"trk-air-001"}', 'SECRET', NOW() - INTERVAL '1 hour'),
  ('det-005', 'org-alpha-001', 'sen-rad-001', 'AIRCRAFT', 'AIR', 0.96, 38.9200, -77.0500, '{"type":"fixed_wing","altitude_ft":15000,"speed_kts":250,"heading":180,"squawk":"4732","callsign":"N742BA","track_id":"trk-air-002"}', 'CONFIDENTIAL', NOW() - INTERVAL '55 minutes'),
  ('det-006', 'org-alpha-001', 'sen-rad-001', 'UAV', 'AIR', 0.78, 38.8995, -77.0370, '{"type":"small_uas","altitude_ft":400,"speed_kts":25,"heading":90,"rf_signature":"2.4GHz","track_id":"trk-air-003"}', 'SECRET', NOW() - INTERVAL '45 minutes'),
  ('det-007', 'org-alpha-001', 'sen-rad-003', 'VESSEL', 'SEA', 0.91, 38.8650, -76.9850, '{"type":"small_craft","speed_kts":18,"heading":315,"length_m":12,"mmsi":"unknown","track_id":"trk-sea-001"}', 'SECRET', NOW() - INTERVAL '40 minutes'),
  ('det-008', 'org-alpha-001', 'sen-iot-001', 'ANOMALY', 'LAND', 0.72, 38.8961, -77.0341, '{"model":"isolation_forest","anomaly_score":-0.82,"features":{"vibration":4.2,"frequency":12.5},"type":"seismic_anomaly"}', 'CONFIDENTIAL', NOW() - INTERVAL '35 minutes'),
  ('det-009', 'org-alpha-001', 'sen-drn-001', 'PERSON', 'LAND', 0.89, 38.8995, -77.0380, '{"model":"yolov8x","bbox":[100,200,180,400],"label":"person","thermal_signature":"warm","behavior":"loitering"}', 'SECRET', NOW() - INTERVAL '25 minutes'),
  ('det-010', 'org-alpha-001', 'sen-drn-001', 'VEHICLE', 'LAND', 0.95, 38.9000, -77.0385, '{"model":"yolov8x","bbox":[50,100,450,350],"label":"pickup_truck","color":"white","engine":"running","occupants":2}', 'SECRET', NOW() - INTERVAL '20 minutes'),
  ('det-011', 'org-alpha-001', 'sen-sonar-001', 'VESSEL', 'SEA', 0.65, 38.8710, -76.9920, '{"type":"subsurface_contact","classification":"possible_diver","depth_m":8,"bearing":45}', 'TOP_SECRET', NOW() - INTERVAL '15 minutes'),
  ('det-012', 'org-alpha-001', 'sen-drn-003', 'INFRASTRUCTURE', 'LAND', 0.93, 38.9012, -77.0402, '{"model":"yolov8x","label":"fence_breach","bbox":[300,50,500,200],"damage_assessment":"cut_wire"}', 'SECRET', NOW() - INTERVAL '10 minutes'),
  ('det-013', 'org-bravo-002', 'sen-net-002', 'CYBER_INTRUSION', 'CYBER', 0.87, NULL, NULL, '{"signature":"ET EXPLOIT CVE-2024-1234","src_ip":"185.220.101.34","dst_ip":"10.0.1.50","dst_port":443,"protocol":"TLS","bytes":4521}', 'SECRET', NOW() - INTERVAL '8 minutes'),
  ('det-014', 'org-bravo-002', 'sen-net-002', 'MALWARE', 'CYBER', 0.91, NULL, NULL, '{"signature":"MALWARE-CNC Win.Trojan.Cobalt","src_ip":"10.0.2.15","dst_ip":"45.155.205.189","beacon_interval_s":60,"hash":"a1b2c3d4e5f6"}', 'TOP_SECRET', NOW() - INTERVAL '5 minutes'),
  ('det-015', 'org-bravo-002', 'sen-net-003', 'CYBER_RECON', 'CYBER', 0.83, NULL, NULL, '{"activity":"ssh_brute_force","src_ip":"91.219.236.174","attempts":347,"usernames":["root","admin","sentinel"],"duration_min":12}', 'SECRET', NOW() - INTERVAL '3 minutes');

-- Alerts
INSERT INTO alerts (id, organization_id, title, description, severity, domain, status, source_detection_id, latitude, longitude, classification, created_at) VALUES
  ('alt-001', 'org-alpha-001', 'Armed individual detected at North Gate', 'YOLOv8 detected person carrying weapon near perimeter camera. High confidence weapon classification. Individual approaching from northeast.', 'CRITICAL', 'LAND', 'OPEN', 'det-003', 38.8981, -77.0349, 'SECRET', NOW() - INTERVAL '1 hour 30 minutes'),
  ('alt-002', 'org-alpha-001', 'Unauthorized UAV in restricted airspace', 'Small UAS detected by primary radar at 400ft AGL. No ADS-B transponder. RF signature suggests commercial drone. Heading toward facility.', 'HIGH', 'AIR', 'INVESTIGATING', 'det-006', 38.8995, -77.0370, 'SECRET', NOW() - INTERVAL '45 minutes'),
  ('alt-003', 'org-alpha-001', 'Unidentified vessel approaching harbor', 'Surface radar tracking small craft at 18 knots heading NW toward harbor. No AIS transponder. No MMSI broadcast. Possible smuggling vessel.', 'HIGH', 'SEA', 'OPEN', 'det-007', 38.8650, -76.9850, 'SECRET', NOW() - INTERVAL '40 minutes'),
  ('alt-004', 'org-alpha-001', 'Seismic anomaly near perimeter', 'Isolation Forest model detected anomalous seismic activity. Possible tunneling or excavation activity near eastern fence line.', 'MEDIUM', 'LAND', 'INVESTIGATING', 'det-008', 38.8961, -77.0341, 'CONFIDENTIAL', NOW() - INTERVAL '35 minutes'),
  ('alt-005', 'org-alpha-001', 'Suspicious loitering near facility', 'Drone Alpha-1 thermal detection of individual loitering in restricted zone for 15+ minutes. No badge detected. Potential surveillance activity.', 'MEDIUM', 'LAND', 'OPEN', 'det-009', 38.8995, -77.0380, 'SECRET', NOW() - INTERVAL '25 minutes'),
  ('alt-006', 'org-alpha-001', 'Possible subsurface intrusion', 'Passive sonar array detected possible diver contact at 8m depth bearing 045. Contact intermittent. Possible combat diver or UUV.', 'CRITICAL', 'SEA', 'OPEN', 'det-011', 38.8710, -76.9920, 'TOP_SECRET', NOW() - INTERVAL '15 minutes'),
  ('alt-007', 'org-alpha-001', 'Perimeter fence breach detected', 'Recon drone LIDAR scan detected cut wire on eastern perimeter fence. Physical security compromise. Immediate response required.', 'CRITICAL', 'LAND', 'OPEN', 'det-012', 38.9012, -77.0402, 'SECRET', NOW() - INTERVAL '10 minutes'),
  ('alt-008', 'org-bravo-002', 'Critical CVE exploitation attempt', 'Suricata IDS matched signature for CVE-2024-1234 exploitation. Source: 185.220.101.34 (known Tor exit node). Target: internal web server.', 'CRITICAL', 'CYBER', 'INVESTIGATING', 'det-013', NULL, NULL, 'SECRET', NOW() - INTERVAL '8 minutes'),
  ('alt-009', 'org-bravo-002', 'Cobalt Strike beacon detected', 'Network sensor detected Cobalt Strike C2 beacon from internal host 10.0.2.15. 60-second beacon interval to known malicious IP. Possible APT compromise.', 'CRITICAL', 'CYBER', 'OPEN', 'det-014', NULL, NULL, 'TOP_SECRET', NOW() - INTERVAL '5 minutes'),
  ('alt-010', 'org-bravo-002', 'SSH brute force from threat actor IP', 'Honeypot cluster detected 347 SSH login attempts from 91.219.236.174 over 12 minutes. IP linked to APT-28 infrastructure.', 'HIGH', 'CYBER', 'OPEN', 'det-015', NULL, NULL, 'SECRET', NOW() - INTERVAL '3 minutes'),
  ('alt-011', 'org-alpha-001', 'Unregistered vehicle in restricted zone', 'License plate WA-4521-BR not found in authorized vehicle database. Vehicle observed entering restricted zone via north gate.', 'MEDIUM', 'LAND', 'RESOLVED', 'det-002', 38.8979, -77.0363, 'CONFIDENTIAL', NOW() - INTERVAL '1 hour 40 minutes'),
  ('alt-012', 'org-alpha-001', 'Drone Alpha-2 offline', 'Patrol Drone Alpha-2 has not reported heartbeat in 15 minutes. Last known position 38.8977°N 77.0365°W. Battery was at 12%. Possible crash.', 'MEDIUM', 'AIR', 'INVESTIGATING', NULL, 38.8977, -77.0365, 'SECRET', NOW() - INTERVAL '30 minutes'),
  ('alt-013', 'org-alpha-001', 'Watchtower camera degraded', 'Camera sen-cam-003 reporting intermittent connection. Frame rate dropped from 15fps to 3fps. Night vision module offline.', 'LOW', 'LAND', 'OPEN', NULL, 38.8965, -77.0370, 'CONFIDENTIAL', NOW() - INTERVAL '2 hours'),
  ('alt-014', 'org-bravo-002', 'Data exfiltration attempt blocked', 'DLP system blocked 2.3GB upload to external cloud storage from workstation WS-INTEL-042. User: sgt.williams. Content: classified documents.', 'HIGH', 'CYBER', 'INVESTIGATING', NULL, NULL, NULL, 'TOP_SECRET', NOW() - INTERVAL '1 hour'),
  ('alt-015', 'org-charlie-003', 'OSINT: Threat actor infrastructure identified', 'Automated OSINT scan identified new C2 domain registered by APT-41. Domain: update-service[.]cloud. Hosting: 103.75.190.0/24.', 'HIGH', 'CYBER', 'OPEN', NULL, NULL, NULL, 'SECRET', NOW() - INTERVAL '50 minutes');

-- Tracks
INSERT INTO tracks (id, organization_id, track_type, domain, status, first_detection_id, latitude, longitude, metadata, classification, created_at) VALUES
  ('trk-air-001', 'org-alpha-001', 'AIRBORNE', 'AIR', 'ACTIVE', 'det-004', 38.9100, -77.0200, '{"type":"rotary_wing","altitude_ft":2500,"speed_kts":85,"heading":270,"squawk":"1200","iff":"UNKNOWN","threat_assessment":"PENDING"}', 'SECRET', NOW() - INTERVAL '1 hour'),
  ('trk-air-002', 'org-alpha-001', 'AIRBORNE', 'AIR', 'ACTIVE', 'det-005', 38.9200, -77.0500, '{"type":"fixed_wing","altitude_ft":15000,"speed_kts":250,"heading":180,"callsign":"N742BA","iff":"FRIENDLY","threat_assessment":"NONE"}', 'CONFIDENTIAL', NOW() - INTERVAL '55 minutes'),
  ('trk-air-003', 'org-alpha-001', 'AIRBORNE', 'AIR', 'ACTIVE', 'det-006', 38.8995, -77.0370, '{"type":"small_uas","altitude_ft":400,"speed_kts":25,"heading":90,"iff":"HOSTILE","threat_assessment":"HIGH"}', 'SECRET', NOW() - INTERVAL '45 minutes'),
  ('trk-sea-001', 'org-alpha-001', 'SURFACE', 'SEA', 'ACTIVE', 'det-007', 38.8650, -76.9850, '{"type":"small_craft","speed_kts":18,"heading":315,"length_m":12,"iff":"UNKNOWN","threat_assessment":"MEDIUM"}', 'SECRET', NOW() - INTERVAL '40 minutes'),
  ('trk-land-001', 'org-alpha-001', 'GROUND', 'LAND', 'ACTIVE', 'det-001', 38.8978, -77.0364, '{"type":"person_on_foot","speed_mph":3.2,"heading":"SE","armed":true,"threat_assessment":"HIGH"}', 'SECRET', NOW() - INTERVAL '2 hours');

-- Missions
INSERT INTO missions (id, organization_id, name, description, status, commander_id, priority, classification, created_at) VALUES
  ('mis-001', 'org-alpha-001', 'Operation Sentinel Watch', 'Continuous perimeter surveillance and threat detection operations', 'ACTIVE', 'usr-cmd-001', 1, 'SECRET', NOW() - INTERVAL '30 days'),
  ('mis-002', 'org-alpha-001', 'Operation Neptune Guard', 'Harbor and coastal defense monitoring', 'ACTIVE', 'usr-cmd-001', 2, 'SECRET', NOW() - INTERVAL '15 days'),
  ('mis-003', 'org-bravo-002', 'Operation Cyber Shield', 'Active cyber defense and threat hunting', 'ACTIVE', 'usr-adm-004', 1, 'TOP_SECRET', NOW() - INTERVAL '45 days'),
  ('mis-004', 'org-charlie-003', 'Operation Open Eye', 'OSINT collection and analysis of adversary activities', 'ACTIVE', 'usr-cmd-001', 3, 'SECRET', NOW() - INTERVAL '60 days');

-- Tasks
INSERT INTO tasks (id, organization_id, mission_id, title, description, assignee_id, priority, status, classification) VALUES
  ('tsk-001', 'org-alpha-001', 'mis-001', 'Investigate fence breach at eastern perimeter', 'Deploy QRF to grid 38.9012/-77.0402. Assess damage, collect forensic evidence, establish temporary barrier.', 'usr-opr-003', 1, 'IN_PROGRESS', 'SECRET'),
  ('tsk-002', 'org-alpha-001', 'mis-001', 'Track and identify unauthorized UAV', 'Coordinate with drone team to intercept UAV detected at 400ft. Attempt electronic identification before kinetic response.', 'usr-opr-003', 1, 'IN_PROGRESS', 'SECRET'),
  ('tsk-003', 'org-alpha-001', 'mis-002', 'Investigate unidentified vessel', 'Task patrol boat to intercept vessel at bearing 315 from harbor. Conduct VHF challenge and visual identification.', 'usr-opr-003', 2, 'PENDING', 'SECRET'),
  ('tsk-004', 'org-bravo-002', 'mis-003', 'Isolate compromised host 10.0.2.15', 'Implement network isolation for host showing Cobalt Strike beacon. Preserve memory dump for forensic analysis.', 'usr-anl-005', 1, 'IN_PROGRESS', 'TOP_SECRET'),
  ('tsk-005', 'org-bravo-002', 'mis-003', 'Block threat actor IPs at perimeter firewall', 'Add 185.220.101.34, 45.155.205.189, 91.219.236.174 to perimeter firewall blocklist. Verify no legitimate traffic impact.', 'usr-anl-005', 2, 'COMPLETED', 'SECRET');

-- Response Rules
INSERT INTO response_rules (id, organization_id, name, description, conditions, actions, action_type, severity_threshold, requires_approval, approval_timeout_min, cooldown_minutes, max_executions_per_hour, priority, is_active, created_by, classification) VALUES
  ('rule-001', 'org-alpha-001', 'Auto-escalate weapon detection', 'Escalate any weapon detection to CRITICAL and notify commander', '[{"field":"detection_type","operator":"eq","value":"WEAPON"},{"field":"confidence","operator":"gte","value":0.8}]', '[{"type":"ESCALATE_ALERT","params":{"newSeverity":"CRITICAL"}},{"type":"NOTIFY","params":{"channel":"commander","webhookUrl":"http://localhost:4007/webhook/commander"}}]', 'ESCALATE', 'HIGH', false, 15, 1, 60, 1, true, 'usr-cmd-001', 'SECRET'),
  ('rule-002', 'org-bravo-002', 'Block malicious IP on IDS alert', 'Automatically block source IP when IDS detects exploitation attempt', '[{"field":"severity","operator":"eq","value":"CRITICAL"},{"field":"domain","operator":"eq","value":"CYBER"},{"field":"source","operator":"eq","value":"IDS_ALERT"}]', '[{"type":"BLOCK_IP","params":{"firewallApi":"http://firewall.internal/api/block","duration":"24h"}},{"type":"CREATE_TASK","params":{"title":"Investigate blocked IP","priority":2}}]', 'BLOCK', 'CRITICAL', false, 15, 5, 30, 2, true, 'usr-adm-004', 'SECRET'),
  ('rule-003', 'org-alpha-001', 'UAV incursion response', 'Trigger counter-UAS protocol on unauthorized drone detection', '[{"field":"detection_type","operator":"eq","value":"UAV"},{"field":"metadata.iff","operator":"ne","value":"FRIENDLY"}]', '[{"type":"ESCALATE_ALERT","params":{"newSeverity":"HIGH"}},{"type":"NOTIFY","params":{"channel":"air_defense"}},{"type":"CREATE_TASK","params":{"title":"Deploy counter-UAS measures"}}]', 'ESCALATE', 'MEDIUM', true, 5, 10, 10, 3, true, 'usr-cmd-001', 'SECRET'),
  ('rule-004', 'org-bravo-002', 'Isolate host on C2 detection', 'Network-isolate any host showing C2 beacon activity', '[{"field":"detection_type","operator":"in","value":["MALWARE","C2_BEACON"]},{"field":"confidence","operator":"gte","value":0.85}]', '[{"type":"ISOLATE_HOST","params":{}},{"type":"NOTIFY","params":{"channel":"soc_team"}},{"type":"CREATE_TASK","params":{"title":"Forensic analysis of isolated host"}}]', 'ISOLATE', 'HIGH', true, 10, 30, 5, 4, true, 'usr-adm-004', 'TOP_SECRET');

-- Threat Indicators (IOCs)
INSERT INTO threat_indicators (id, organization_id, indicator_type, value, severity, source, confidence, tags, metadata, classification, first_seen_at) VALUES
  ('ioc-001', 'org-bravo-002', 'IP', '185.220.101.34', 'CRITICAL', 'suricata_ids', 0.95, ARRAY['tor_exit','apt28','exploitation'], '{"country":"RU","asn":"AS60729","abuse_reports":1247,"first_seen":"2024-01-15"}', 'SECRET', NOW() - INTERVAL '30 days'),
  ('ioc-002', 'org-bravo-002', 'IP', '45.155.205.189', 'CRITICAL', 'threat_intel', 0.92, ARRAY['cobalt_strike','c2','apt41'], '{"country":"NL","asn":"AS209588","malware_family":"CobaltStrike","c2_type":"HTTPS"}', 'SECRET', NOW() - INTERVAL '7 days'),
  ('ioc-003', 'org-bravo-002', 'IP', '91.219.236.174', 'HIGH', 'honeypot', 0.88, ARRAY['brute_force','apt28','recon'], '{"country":"UA","asn":"AS35804","attack_type":"ssh_bruteforce","attempts":12400}', 'SECRET', NOW() - INTERVAL '3 days'),
  ('ioc-004', 'org-bravo-002', 'DOMAIN', 'update-service.cloud', 'HIGH', 'osint', 0.85, ARRAY['apt41','c2','newly_registered'], '{"registrar":"Namecheap","registered":"2024-03-10","hosting":"103.75.190.42","dns_records":["A","TXT"]}', 'SECRET', NOW() - INTERVAL '1 day'),
  ('ioc-005', 'org-bravo-002', 'HASH', 'a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890', 'CRITICAL', 'malware_analysis', 0.98, ARRAY['cobalt_strike','beacon','payload'], '{"file_type":"PE32","size_bytes":284672,"family":"CobaltStrike","packer":"custom"}', 'TOP_SECRET', NOW() - INTERVAL '5 days'),
  ('ioc-006', 'org-bravo-002', 'IP', '103.75.190.42', 'HIGH', 'osint', 0.82, ARRAY['apt41','hosting','bulletproof'], '{"country":"IN","asn":"AS138749","hosting_type":"bulletproof","domains_hosted":23}', 'SECRET', NOW() - INTERVAL '2 days'),
  ('ioc-007', 'org-bravo-002', 'URL', 'https://update-service.cloud/api/v2/check', 'HIGH', 'malware_analysis', 0.90, ARRAY['c2_callback','apt41','https'], '{"response_code":200,"content_type":"application/octet-stream","payload_size":1024}', 'SECRET', NOW() - INTERVAL '1 day'),
  ('ioc-008', 'org-bravo-002', 'EMAIL', 'admin@update-service.cloud', 'MEDIUM', 'osint', 0.70, ARRAY['apt41','phishing','social_engineering'], '{"associated_campaigns":["OP-SHADOW-NET"],"first_seen":"2024-03-12"}', 'SECRET', NOW() - INTERVAL '12 hours');

-- Cyber Events
INSERT INTO cyber_events (id, organization_id, event_type, severity, source_ip, destination_ip, destination_port, protocol, signature, raw_data, classification, created_at) VALUES
  ('cev-001', 'org-bravo-002', 'IDS_ALERT', 'CRITICAL', '185.220.101.34', '10.0.1.50', 443, 'TLS', 'ET EXPLOIT CVE-2024-1234 RCE Attempt', '{"bytes_in":4521,"bytes_out":128,"duration_ms":340,"rule_id":"2024001"}', 'SECRET', NOW() - INTERVAL '8 minutes'),
  ('cev-002', 'org-bravo-002', 'C2_BEACON', 'CRITICAL', '10.0.2.15', '45.155.205.189', 443, 'HTTPS', 'MALWARE-CNC Win.Trojan.CobaltStrike', '{"beacon_interval":60,"jitter":15,"user_agent":"Mozilla/5.0","pipe_name":"\\\\pipe\\\\msagent_f8"}', 'TOP_SECRET', NOW() - INTERVAL '5 minutes'),
  ('cev-003', 'org-bravo-002', 'BRUTE_FORCE', 'HIGH', '91.219.236.174', '10.0.3.1', 22, 'SSH', 'SSH Brute Force Attack', '{"attempts":347,"unique_users":12,"success":false,"duration_min":12}', 'SECRET', NOW() - INTERVAL '3 minutes'),
  ('cev-004', 'org-bravo-002', 'PORT_SCAN', 'MEDIUM', '185.220.101.34', '10.0.0.0/16', NULL, 'TCP', 'Nmap SYN Scan Detected', '{"ports_scanned":1024,"open_ports":[22,80,443,8080],"scan_type":"SYN","duration_s":45}', 'SECRET', NOW() - INTERVAL '30 minutes'),
  ('cev-005', 'org-bravo-002', 'DNS_TUNNEL', 'HIGH', '10.0.4.22', NULL, 53, 'DNS', 'Possible DNS Tunneling', '{"queries":2400,"unique_subdomains":890,"avg_label_len":48,"domain":"data.update-service.cloud"}', 'SECRET', NOW() - INTERVAL '20 minutes'),
  ('cev-006', 'org-bravo-002', 'DATA_EXFIL', 'CRITICAL', '10.0.5.10', '104.18.32.7', 443, 'HTTPS', 'Large Data Upload to Cloud Storage', '{"bytes_uploaded":2400000000,"destination":"cloudflare-storage","duration_min":45,"file_count":127}', 'TOP_SECRET', NOW() - INTERVAL '1 hour'),
  ('cev-007', 'org-bravo-002', 'MALWARE', 'HIGH', NULL, NULL, NULL, NULL, 'Suspicious PowerShell Execution', '{"host":"WS-INTEL-042","user":"sgt.williams","command":"powershell -enc BASE64...","parent":"explorer.exe"}', 'SECRET', NOW() - INTERVAL '55 minutes'),
  ('cev-008', 'org-bravo-002', 'IDS_ALERT', 'MEDIUM', '103.75.190.42', '10.0.1.80', 80, 'HTTP', 'Web Application SQL Injection', '{"uri":"/api/search?q=1%27+OR+1%3D1","method":"GET","payload":"sqli","waf_blocked":true}', 'SECRET', NOW() - INTERVAL '2 hours');

-- AI Models
INSERT INTO ai_models (id, organization_id, name, model_type, version, status, accuracy, configuration, classification) VALUES
  ('mdl-001', 'org-alpha-001', 'YOLOv8x-Sentinel', 'OBJECT_DETECTION', '8.1.0-sentinel-v3', 'DEPLOYED', 0.94, '{"input_size":640,"classes":["person","vehicle","weapon","aircraft","vessel","drone"],"backend":"onnxruntime","device":"cuda:0"}', 'SECRET'),
  ('mdl-002', 'org-alpha-001', 'IsolationForest-Telemetry', 'ANOMALY_DETECTION', '2.1.0', 'DEPLOYED', 0.87, '{"n_estimators":200,"contamination":0.05,"features":["vibration","temperature","humidity","signal_strength"]}', 'CONFIDENTIAL'),
  ('mdl-003', 'org-alpha-001', 'LSTM-TrackPredictor', 'TIME_SERIES', '1.3.0', 'DEPLOYED', 0.91, '{"hidden_size":128,"num_layers":3,"sequence_length":50,"prediction_horizon":10}', 'SECRET'),
  ('mdl-004', 'org-bravo-002', 'IsolationForest-NetFlow', 'ANOMALY_DETECTION', '1.8.0', 'DEPLOYED', 0.89, '{"n_estimators":300,"contamination":0.03,"features":["bytes_in","bytes_out","packets","duration","port_entropy"]}', 'SECRET'),
  ('mdl-005', 'org-alpha-001', 'Ollama-IntelAnalyst', 'LLM', 'llama3-8b-sentinel', 'DEPLOYED', NULL, '{"provider":"ollama","model":"llama3:8b","temperature":0.3,"max_tokens":4096,"system_prompt":"intelligence_analyst"}', 'SECRET');

-- Audit Logs
INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, details, ip_address, user_agent, checksum) VALUES
  (gen_random_uuid(), 'usr-cmd-001', 'LOGIN', 'session', NULL, '{"method":"password+mfa","success":true}', '10.0.10.5', 'SentinelOS-Desktop/1.0', 'abc123'),
  (gen_random_uuid(), 'usr-anl-002', 'VIEW_ALERT', 'alert', 'alt-001', '{"alert_severity":"CRITICAL"}', '10.0.10.12', 'SentinelOS-Desktop/1.0', 'def456'),
  (gen_random_uuid(), 'usr-cmd-001', 'APPROVE_RESPONSE', 'response_execution', 'exec-001', '{"rule":"UAV incursion response","action":"counter_uas"}', '10.0.10.5', 'SentinelOS-Desktop/1.0', 'ghi789'),
  (gen_random_uuid(), 'usr-adm-004', 'UPDATE_RULE', 'response_rule', 'rule-002', '{"field":"cooldown_minutes","old":10,"new":5}', '10.0.20.3', 'SentinelOS-Desktop/1.0', 'jkl012'),
  (gen_random_uuid(), 'usr-opr-003', 'CONNECT_SENSOR', 'sensor', 'sen-drn-001', '{"action":"deploy_drone","mission":"mis-001"}', '10.0.10.8', 'SentinelOS-Mobile/1.0', 'mno345');

-- Retention Policies
INSERT INTO retention_policies (id, data_type, retention_days, classification, archive_before_delete, is_active, created_by) VALUES
  (gen_random_uuid(), 'audit_logs', 365, 'SECRET', true, true, 'usr-adm-004'),
  (gen_random_uuid(), 'cyber_events', 90, 'SECRET', true, true, 'usr-adm-004'),
  (gen_random_uuid(), 'detections', 30, 'CONFIDENTIAL', false, true, 'usr-adm-004'),
  (gen_random_uuid(), 'model_predictions', 14, 'CONFIDENTIAL', false, true, 'usr-adm-004');

-- Simulations
INSERT INTO simulations (id, organization_id, name, description, scenario_type, parameters, duration_seconds, status, created_by, classification, created_at) VALUES
  ('sim-001', 'org-bravo-002', 'Red Team Exercise: APT-28 Simulation', 'Simulate APT-28 TTP kill chain against network infrastructure', 'RED_TEAM', '{"targetNetwork":"10.0.0.0/16","ttps":["T1566","T1059","T1053","T1548","T1070","T1003","T1021","T1041"]}', 7200, 'COMPLETED', 'usr-adm-004', 'TOP_SECRET', NOW() - INTERVAL '7 days'),
  ('sim-002', 'org-alpha-001', 'Digital Twin: Base Defense Scenario', 'Full facility digital twin with simulated sensor feeds and threat actors', 'DIGITAL_TWIN', '{"centerLat":38.8977,"centerLon":-77.0365,"radius_km":2,"threat_actors":3}', 3600, 'COMPLETED', 'usr-cmd-001', 'SECRET', NOW() - INTERVAL '3 days'),
  ('sim-003', 'org-bravo-002', 'Purple Team: Ransomware Response', 'Combined attack/defense exercise simulating ransomware incident', 'PURPLE_TEAM', '{"attack_vector":"phishing","target":"finance_dept","encryption_speed":"fast"}', 5400, 'CREATED', 'usr-adm-004', 'SECRET', NOW() - INTERVAL '1 day');

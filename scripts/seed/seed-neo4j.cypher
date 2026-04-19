// ============================================================================
// Sentinel OS — Neo4j Seed Data
// Knowledge graph with entities, relationships, and correlations
// ============================================================================

// ── Threat Actors ───────────────────────────────────────────────────────────

CREATE (apt28:ThreatActor {
  id: 'ta-apt28', name: 'APT-28', aliases: ['Fancy Bear', 'Sofacy', 'Pawn Storm'],
  origin: 'Russia', motivation: 'Espionage',
  first_seen: date('2008-01-01'), last_seen: date('2024-03-18'),
  ttp_count: 47, confidence: 0.95,
  description: 'Russian state-sponsored cyber espionage group affiliated with GRU'
});

CREATE (apt41:ThreatActor {
  id: 'ta-apt41', name: 'APT-41', aliases: ['Winnti', 'Double Dragon', 'Barium'],
  origin: 'China', motivation: 'Espionage/Financial',
  first_seen: date('2012-01-01'), last_seen: date('2024-03-15'),
  ttp_count: 52, confidence: 0.92,
  description: 'Chinese state-sponsored group conducting espionage and financially motivated operations'
});

CREATE (unknown1:ThreatActor {
  id: 'ta-unknown-001', name: 'UNKNOWN-RECON-001',
  origin: 'Unknown', motivation: 'Reconnaissance',
  first_seen: date('2024-03-18'), last_seen: date('2024-03-18'),
  ttp_count: 3, confidence: 0.60,
  description: 'Unattributed actor conducting physical reconnaissance of facility'
});

// ── Infrastructure ──────────────────────────────────────────────────────────

CREATE (ip1:IPAddress {
  id: 'ip-185.220.101.34', value: '185.220.101.34',
  country: 'RU', asn: 'AS60729', isp: 'Tor Exit Node',
  first_seen: date('2024-01-15'), last_seen: date('2024-03-18'),
  threat_score: 98, abuse_reports: 1247
});

CREATE (ip2:IPAddress {
  id: 'ip-45.155.205.189', value: '45.155.205.189',
  country: 'NL', asn: 'AS209588', isp: 'Serverius',
  first_seen: date('2024-03-08'), last_seen: date('2024-03-18'),
  threat_score: 95, abuse_reports: 892
});

CREATE (ip3:IPAddress {
  id: 'ip-91.219.236.174', value: '91.219.236.174',
  country: 'UA', asn: 'AS35804', isp: 'Dataline',
  first_seen: date('2024-03-15'), last_seen: date('2024-03-18'),
  threat_score: 88, abuse_reports: 634
});

CREATE (ip4:IPAddress {
  id: 'ip-103.75.190.42', value: '103.75.190.42',
  country: 'IN', asn: 'AS138749', isp: 'Bulletproof Hosting',
  first_seen: date('2024-03-10'), last_seen: date('2024-03-18'),
  threat_score: 82, abuse_reports: 45
});

CREATE (domain1:Domain {
  id: 'dom-update-service', value: 'update-service.cloud',
  registrar: 'Namecheap', registered: date('2024-03-10'),
  threat_score: 85, category: 'c2_domain'
});

CREATE (hash1:FileHash {
  id: 'hash-cobalt-beacon', value: 'a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890',
  file_type: 'PE32', size_bytes: 284672,
  malware_family: 'CobaltStrike', detection_rate: '48/72'
});

// ── Locations ───────────────────────────────────────────────────────────────

CREATE (loc1:Location {
  id: 'loc-north-gate', name: 'North Gate',
  latitude: 38.8977, longitude: -77.0365,
  type: 'access_point', security_zone: 'perimeter'
});

CREATE (loc2:Location {
  id: 'loc-east-fence', name: 'Eastern Perimeter Fence',
  latitude: 38.9012, longitude: -77.0402,
  type: 'perimeter', security_zone: 'outer'
});

CREATE (loc3:Location {
  id: 'loc-harbor', name: 'Harbor Approach',
  latitude: 38.8700, longitude: -76.9900,
  type: 'waterway', security_zone: 'maritime'
});

CREATE (loc4:Location {
  id: 'loc-airspace', name: 'Restricted Airspace Zone',
  latitude: 38.8995, longitude: -77.0370,
  type: 'airspace', security_zone: 'restricted'
});

// ── Alerts as graph nodes ───────────────────────────────────────────────────

CREATE (alert1:Alert {
  id: 'alt-001', title: 'Armed individual detected at North Gate',
  severity: 'CRITICAL', domain: 'LAND', status: 'OPEN',
  created_at: datetime() - duration('PT1H30M')
});

CREATE (alert2:Alert {
  id: 'alt-002', title: 'Unauthorized UAV in restricted airspace',
  severity: 'HIGH', domain: 'AIR', status: 'INVESTIGATING',
  created_at: datetime() - duration('PT45M')
});

CREATE (alert3:Alert {
  id: 'alt-003', title: 'Unidentified vessel approaching harbor',
  severity: 'HIGH', domain: 'SEA', status: 'OPEN',
  created_at: datetime() - duration('PT40M')
});

CREATE (alert7:Alert {
  id: 'alt-007', title: 'Perimeter fence breach detected',
  severity: 'CRITICAL', domain: 'LAND', status: 'OPEN',
  created_at: datetime() - duration('PT10M')
});

CREATE (alert8:Alert {
  id: 'alt-008', title: 'Critical CVE exploitation attempt',
  severity: 'CRITICAL', domain: 'CYBER', status: 'INVESTIGATING',
  created_at: datetime() - duration('PT8M')
});

CREATE (alert9:Alert {
  id: 'alt-009', title: 'Cobalt Strike beacon detected',
  severity: 'CRITICAL', domain: 'CYBER', status: 'OPEN',
  created_at: datetime() - duration('PT5M')
});

CREATE (alert10:Alert {
  id: 'alt-010', title: 'SSH brute force from threat actor IP',
  severity: 'HIGH', domain: 'CYBER', status: 'OPEN',
  created_at: datetime() - duration('PT3M')
});

// ── Detections ──────────────────────────────────────────────────────────────

CREATE (det3:Detection {
  id: 'det-003', type: 'WEAPON', domain: 'LAND', confidence: 0.88,
  latitude: 38.8981, longitude: -77.0349
});

CREATE (det6:Detection {
  id: 'det-006', type: 'UAV', domain: 'AIR', confidence: 0.78,
  latitude: 38.8995, longitude: -77.0370
});

CREATE (det12:Detection {
  id: 'det-012', type: 'INFRASTRUCTURE', domain: 'LAND', confidence: 0.93,
  latitude: 38.9012, longitude: -77.0402
});

CREATE (det13:Detection {
  id: 'det-013', type: 'CYBER_INTRUSION', domain: 'CYBER', confidence: 0.87
});

CREATE (det14:Detection {
  id: 'det-014', type: 'MALWARE', domain: 'CYBER', confidence: 0.91
});

// ── Sensors ─────────────────────────────────────────────────────────────────

CREATE (sen1:Sensor { id: 'sen-cam-001', name: 'Perimeter Camera North Gate', type: 'CCTV', domain: 'LAND' });
CREATE (sen4:Sensor { id: 'sen-rad-001', name: 'Primary Surveillance Radar', type: 'RADAR', domain: 'AIR' });
CREATE (senDrn:Sensor { id: 'sen-drn-003', name: 'Recon Drone Bravo-1', type: 'DRONE', domain: 'AIR' });
CREATE (senNet:Sensor { id: 'sen-net-002', name: 'Suricata IDS Node 1', type: 'IDS', domain: 'CYBER' });

// ── CVE ─────────────────────────────────────────────────────────────────────

CREATE (cve1:CVE {
  id: 'CVE-2024-1234', cvss: 9.8, severity: 'CRITICAL',
  description: 'Remote Code Execution in OpenSSL 3.2.x',
  exploited_in_wild: true, patch_available: true
});

// ── RELATIONSHIPS ───────────────────────────────────────────────────────────

// Threat actor → infrastructure
MATCH (apt28:ThreatActor {id:'ta-apt28'}), (ip1:IPAddress {id:'ip-185.220.101.34'})
CREATE (apt28)-[:USES_INFRASTRUCTURE {since: date('2024-01-15'), confidence: 0.90}]->(ip1);

MATCH (apt28:ThreatActor {id:'ta-apt28'}), (ip3:IPAddress {id:'ip-91.219.236.174'})
CREATE (apt28)-[:USES_INFRASTRUCTURE {since: date('2024-03-15'), confidence: 0.85}]->(ip3);

MATCH (apt41:ThreatActor {id:'ta-apt41'}), (ip2:IPAddress {id:'ip-45.155.205.189'})
CREATE (apt41)-[:USES_INFRASTRUCTURE {since: date('2024-03-08'), confidence: 0.92}]->(ip2);

MATCH (apt41:ThreatActor {id:'ta-apt41'}), (ip4:IPAddress {id:'ip-103.75.190.42'})
CREATE (apt41)-[:USES_INFRASTRUCTURE {since: date('2024-03-10'), confidence: 0.82}]->(ip4);

MATCH (apt41:ThreatActor {id:'ta-apt41'}), (d:Domain {id:'dom-update-service'})
CREATE (apt41)-[:REGISTERED_DOMAIN {date: date('2024-03-10')}]->(d);

// Domain → IP
MATCH (d:Domain {id:'dom-update-service'}), (ip4:IPAddress {id:'ip-103.75.190.42'})
CREATE (d)-[:RESOLVES_TO {first_seen: date('2024-03-10')}]->(ip4);

// Malware → infrastructure
MATCH (h:FileHash {id:'hash-cobalt-beacon'}), (ip2:IPAddress {id:'ip-45.155.205.189'})
CREATE (h)-[:COMMUNICATES_WITH {protocol: 'HTTPS', port: 443}]->(ip2);

MATCH (h:FileHash {id:'hash-cobalt-beacon'}), (d:Domain {id:'dom-update-service'})
CREATE (h)-[:COMMUNICATES_WITH {protocol: 'HTTPS', port: 443}]->(d);

// Alerts → detections → sensors → locations
MATCH (a:Alert {id:'alt-001'}), (d:Detection {id:'det-003'})
CREATE (a)-[:TRIGGERED_BY]->(d);

MATCH (a:Alert {id:'alt-002'}), (d:Detection {id:'det-006'})
CREATE (a)-[:TRIGGERED_BY]->(d);

MATCH (a:Alert {id:'alt-007'}), (d:Detection {id:'det-012'})
CREATE (a)-[:TRIGGERED_BY]->(d);

MATCH (a:Alert {id:'alt-008'}), (d:Detection {id:'det-013'})
CREATE (a)-[:TRIGGERED_BY]->(d);

MATCH (a:Alert {id:'alt-009'}), (d:Detection {id:'det-014'})
CREATE (a)-[:TRIGGERED_BY]->(d);

MATCH (d:Detection {id:'det-003'}), (s:Sensor {id:'sen-cam-001'})
CREATE (d)-[:DETECTED_BY]->(s);

MATCH (d:Detection {id:'det-006'}), (s:Sensor {id:'sen-rad-001'})
CREATE (d)-[:DETECTED_BY]->(s);

MATCH (d:Detection {id:'det-012'}), (s:Sensor {id:'sen-drn-003'})
CREATE (d)-[:DETECTED_BY]->(s);

MATCH (d:Detection {id:'det-013'}), (s:Sensor {id:'sen-net-002'})
CREATE (d)-[:DETECTED_BY]->(s);

MATCH (d:Detection {id:'det-014'}), (s:Sensor {id:'sen-net-002'})
CREATE (d)-[:DETECTED_BY]->(s);

// Alerts → locations
MATCH (a:Alert {id:'alt-001'}), (l:Location {id:'loc-north-gate'})
CREATE (a)-[:LOCATED_AT]->(l);

MATCH (a:Alert {id:'alt-002'}), (l:Location {id:'loc-airspace'})
CREATE (a)-[:LOCATED_AT]->(l);

MATCH (a:Alert {id:'alt-003'}), (l:Location {id:'loc-harbor'})
CREATE (a)-[:LOCATED_AT]->(l);

MATCH (a:Alert {id:'alt-007'}), (l:Location {id:'loc-east-fence'})
CREATE (a)-[:LOCATED_AT]->(l);

// Cyber alerts → threat actors (attribution)
MATCH (a:Alert {id:'alt-008'}), (ta:ThreatActor {id:'ta-apt28'})
CREATE (a)-[:ATTRIBUTED_TO {confidence: 0.75, method: 'ip_overlap'}]->(ta);

MATCH (a:Alert {id:'alt-009'}), (ta:ThreatActor {id:'ta-apt41'})
CREATE (a)-[:ATTRIBUTED_TO {confidence: 0.88, method: 'c2_infrastructure'}]->(ta);

MATCH (a:Alert {id:'alt-010'}), (ta:ThreatActor {id:'ta-apt28'})
CREATE (a)-[:ATTRIBUTED_TO {confidence: 0.80, method: 'ip_overlap'}]->(ta);

// Cyber alerts → IOCs
MATCH (a:Alert {id:'alt-008'}), (ip:IPAddress {id:'ip-185.220.101.34'})
CREATE (a)-[:INVOLVES_IOC]->(ip);

MATCH (a:Alert {id:'alt-009'}), (ip:IPAddress {id:'ip-45.155.205.189'})
CREATE (a)-[:INVOLVES_IOC]->(ip);

MATCH (a:Alert {id:'alt-009'}), (h:FileHash {id:'hash-cobalt-beacon'})
CREATE (a)-[:INVOLVES_IOC]->(h);

MATCH (a:Alert {id:'alt-010'}), (ip:IPAddress {id:'ip-91.219.236.174'})
CREATE (a)-[:INVOLVES_IOC]->(ip);

// CVE → alert
MATCH (a:Alert {id:'alt-008'}), (c:CVE {id:'CVE-2024-1234'})
CREATE (a)-[:EXPLOITS]->(c);

// Cross-domain correlation: physical + cyber = coordinated attack
MATCH (a1:Alert {id:'alt-001'}), (a7:Alert {id:'alt-007'})
CREATE (a1)-[:CORRELATED_WITH {type: 'temporal_proximity', time_delta_min: 80, confidence: 0.72}]->(a7);

MATCH (a1:Alert {id:'alt-001'}), (a2:Alert {id:'alt-002'})
CREATE (a1)-[:CORRELATED_WITH {type: 'geospatial_proximity', distance_km: 0.3, confidence: 0.68}]->(a2);

MATCH (a7:Alert {id:'alt-007'}), (a9:Alert {id:'alt-009'})
CREATE (a7)-[:CORRELATED_WITH {type: 'cross_domain', hypothesis: 'coordinated_physical_cyber_attack', confidence: 0.65}]->(a9);

// Physical recon actor → locations
MATCH (ta:ThreatActor {id:'ta-unknown-001'}), (l:Location {id:'loc-north-gate'})
CREATE (ta)-[:OBSERVED_AT {timestamp: datetime() - duration('PT2H'), confidence: 0.70}]->(l);

MATCH (ta:ThreatActor {id:'ta-unknown-001'}), (l:Location {id:'loc-east-fence'})
CREATE (ta)-[:OBSERVED_AT {timestamp: datetime() - duration('PT10M'), confidence: 0.60}]->(l);

MATCH (ta:ThreatActor {id:'ta-unknown-001'}), (a:Alert {id:'alt-001'})
CREATE (a)-[:ATTRIBUTED_TO {confidence: 0.60, method: 'behavioral_analysis'}]->(ta);

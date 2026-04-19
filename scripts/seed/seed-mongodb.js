// ============================================================================
// Sentinel OS — MongoDB Seed Data
// Realistic raw sensor data, OSINT feeds, and IDS logs
// ============================================================================

db = db.getSiblingDB('sentinel');

// ── Raw Sensor Data ─────────────────────────────────────────────────────────

db.raw_sensor_data.insertMany([
  {
    sensor_id: 'sen-cam-001', sensor_type: 'CCTV', domain: 'LAND',
    timestamp: new Date(Date.now() - 120000),
    data: {
      frame_number: 184320, resolution: '3840x2160', fps: 30,
      objects_detected: [
        { class: 'person', confidence: 0.94, bbox: [120, 340, 280, 510], track_id: 'p-001' },
        { class: 'vehicle', confidence: 0.97, bbox: [50, 200, 400, 380], track_id: 'v-001' }
      ],
      scene_classification: 'outdoor_gate', lighting: 'daylight', motion_detected: true
    },
    metadata: { organization_id: 'org-alpha-001', classification: 'CONFIDENTIAL', ingested_at: new Date() }
  },
  {
    sensor_id: 'sen-rad-001', sensor_type: 'RADAR', domain: 'AIR',
    timestamp: new Date(Date.now() - 60000),
    data: {
      sweep_number: 45230, azimuth_deg: 127.4, range_km: 15.2,
      targets: [
        { id: 'tgt-001', range_km: 15.2, azimuth_deg: 127.4, altitude_ft: 2500, speed_kts: 85, heading: 270, rcs_dbsm: 12.5, classification: 'rotary_wing' },
        { id: 'tgt-002', range_km: 42.8, azimuth_deg: 195.1, altitude_ft: 15000, speed_kts: 250, heading: 180, rcs_dbsm: 25.0, classification: 'fixed_wing' },
        { id: 'tgt-003', range_km: 2.1, azimuth_deg: 88.7, altitude_ft: 400, speed_kts: 25, heading: 90, rcs_dbsm: -5.2, classification: 'small_uas' }
      ],
      clutter_level: 'low', weather_mode: false
    },
    metadata: { organization_id: 'org-alpha-001', classification: 'SECRET', ingested_at: new Date() }
  },
  {
    sensor_id: 'sen-iot-001', sensor_type: 'IOT', domain: 'LAND',
    timestamp: new Date(Date.now() - 30000),
    data: {
      array_id: 'seismic-alpha', sample_rate_hz: 100,
      channels: [
        { id: 'ch-01', peak_amplitude: 0.42, frequency_hz: 12.5, snr_db: 18.3 },
        { id: 'ch-02', peak_amplitude: 0.38, frequency_hz: 12.7, snr_db: 17.1 },
        { id: 'ch-03', peak_amplitude: 4.20, frequency_hz: 12.5, snr_db: 35.8 },
        { id: 'ch-04', peak_amplitude: 0.35, frequency_hz: 11.9, snr_db: 16.5 }
      ],
      anomaly_detected: true, anomaly_channel: 'ch-03', anomaly_score: -0.82
    },
    metadata: { organization_id: 'org-alpha-001', classification: 'CONFIDENTIAL', ingested_at: new Date() }
  },
  {
    sensor_id: 'sen-drn-001', sensor_type: 'DRONE', domain: 'AIR',
    timestamp: new Date(Date.now() - 15000),
    data: {
      telemetry: {
        latitude: 38.8995, longitude: -77.0380, altitude_m: 120, heading_deg: 45,
        speed_ms: 8.5, battery_pct: 72, gps_fix: '3D', satellites: 14,
        gimbal_pitch: -30, gimbal_yaw: 0
      },
      detections: [
        { class: 'person', confidence: 0.89, bbox: [100, 200, 180, 400], thermal_signature: 'warm', behavior: 'loitering' }
      ],
      flight_mode: 'PATROL', waypoint_index: 7, total_waypoints: 12
    },
    metadata: { organization_id: 'org-alpha-001', classification: 'SECRET', ingested_at: new Date() }
  },
  {
    sensor_id: 'sen-sonar-001', sensor_type: 'SONAR', domain: 'SEA',
    timestamp: new Date(Date.now() - 10000),
    data: {
      beam_count: 64, sample_rate_khz: 192,
      contacts: [
        { bearing_deg: 45, range_m: 320, depth_m: 8, signal_strength_db: -42, classification: 'possible_diver', confidence: 0.65, doppler_shift: 0.3 }
      ],
      ambient_noise_db: -55, sea_state: 2, water_temp_c: 18.5
    },
    metadata: { organization_id: 'org-alpha-001', classification: 'TOP_SECRET', ingested_at: new Date() }
  },
  {
    sensor_id: 'sen-rad-003', sensor_type: 'RADAR', domain: 'SEA',
    timestamp: new Date(Date.now() - 20000),
    data: {
      sweep_number: 12450, mode: 'surface_search',
      targets: [
        { id: 'sfc-001', range_km: 4.8, bearing_deg: 315, speed_kts: 18, heading: 315, rcs_dbsm: 8.0, length_est_m: 12, classification: 'small_craft', ais: false }
      ],
      sea_clutter: 'moderate', visibility_nm: 8
    },
    metadata: { organization_id: 'org-alpha-001', classification: 'SECRET', ingested_at: new Date() }
  }
]);

// ── OSINT Raw Feeds ─────────────────────────────────────────────────────────

db.osint_raw_feeds.insertMany([
  {
    feed_id: 'nvd-cve', feed_name: 'NVD CVE Feed', feed_type: 'API', status: 'ACTIVE',
    url: 'https://services.nvd.nist.gov/rest/json/cves/2.0',
    last_fetch: new Date(Date.now() - 120000), fetch_interval_min: 15,
    items_fetched: 1247, error_count: 0,
    recent_items: [
      { cve_id: 'CVE-2024-1234', title: 'Critical RCE in OpenSSL 3.2.x', severity: 'CRITICAL', cvss: 9.8, published: new Date('2024-03-15'), affected: 'OpenSSL 3.2.0-3.2.1', exploited_in_wild: true },
      { cve_id: 'CVE-2024-5678', title: 'Authentication bypass in Cisco IOS XE', severity: 'HIGH', cvss: 8.6, published: new Date('2024-03-14'), affected: 'IOS XE 17.x', exploited_in_wild: false },
      { cve_id: 'CVE-2024-9012', title: 'Privilege escalation in Linux kernel 6.x', severity: 'HIGH', cvss: 7.8, published: new Date('2024-03-13'), affected: 'kernel 6.1-6.7', exploited_in_wild: true }
    ]
  },
  {
    feed_id: 'abuseipdb', feed_name: 'AbuseIPDB', feed_type: 'API', status: 'ACTIVE',
    url: 'https://api.abuseipdb.com/api/v2/blacklist',
    last_fetch: new Date(Date.now() - 900000), fetch_interval_min: 60,
    items_fetched: 892, error_count: 0,
    recent_items: [
      { ip: '185.220.101.34', abuse_confidence: 100, country: 'RU', isp: 'Tor Exit Node', reports: 1247, categories: ['SSH', 'Web Attack', 'Brute Force'] },
      { ip: '45.155.205.189', abuse_confidence: 98, country: 'NL', isp: 'Serverius', reports: 892, categories: ['C2', 'Malware', 'Port Scan'] },
      { ip: '91.219.236.174', abuse_confidence: 95, country: 'UA', isp: 'Dataline', reports: 634, categories: ['SSH', 'Brute Force'] }
    ]
  },
  {
    feed_id: 'alienvault-otx', feed_name: 'AlienVault OTX', feed_type: 'API', status: 'ACTIVE',
    url: 'https://otx.alienvault.com/api/v1/pulses/subscribed',
    last_fetch: new Date(Date.now() - 480000), fetch_interval_min: 30,
    items_fetched: 2341, error_count: 0,
    recent_items: [
      { pulse_id: 'p-2024-0342', title: 'APT-28 New Infrastructure March 2024', author: 'AlienVault', created: new Date('2024-03-12'), indicators: 47, tags: ['apt28', 'russia', 'espionage'] },
      { pulse_id: 'p-2024-0338', title: 'Ransomware Campaign Targeting Healthcare', author: 'USCert', created: new Date('2024-03-11'), indicators: 123, tags: ['ransomware', 'healthcare', 'lockbit'] }
    ]
  },
  {
    feed_id: 'threatfox', feed_name: 'ThreatFox IOCs', feed_type: 'API', status: 'ACTIVE',
    url: 'https://threatfox-api.abuse.ch/api/v1/',
    last_fetch: new Date(Date.now() - 300000), fetch_interval_min: 15,
    items_fetched: 5678, error_count: 0,
    recent_items: [
      { ioc: 'update-service.cloud', type: 'domain', threat: 'CobaltStrike', malware: 'CobaltStrike', confidence: 90, first_seen: new Date('2024-03-10'), reporter: 'abuse.ch' },
      { ioc: 'a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890', type: 'sha256', threat: 'CobaltStrike', malware: 'win.cobalt_strike.beacon', confidence: 100, first_seen: new Date('2024-03-08') }
    ]
  },
  {
    feed_id: 'mitre-attack', feed_name: 'MITRE ATT&CK Updates', feed_type: 'API', status: 'ACTIVE',
    url: 'https://raw.githubusercontent.com/mitre/cti/master/enterprise-attack/enterprise-attack.json',
    last_fetch: new Date(Date.now() - 86400000), fetch_interval_min: 1440,
    items_fetched: 780, error_count: 0,
    recent_items: [
      { technique_id: 'T1566.001', name: 'Spearphishing Attachment', tactic: 'Initial Access', data_sources: ['Email', 'File', 'Network'], platforms: ['Windows', 'macOS', 'Linux'] }
    ]
  }
]);

// ── IDS Logs ────────────────────────────────────────────────────────────────

db.ids_logs.insertMany([
  {
    timestamp: new Date(Date.now() - 480000), event_type: 'alert',
    src_ip: '185.220.101.34', src_port: 48923, dest_ip: '10.0.1.50', dest_port: 443,
    proto: 'TCP', app_proto: 'tls',
    alert: { signature_id: 2024001, signature: 'ET EXPLOIT CVE-2024-1234 RCE Attempt', category: 'Attempted Administrator Privilege Gain', severity: 1, action: 'allowed' },
    flow: { bytes_toserver: 4521, bytes_toclient: 128, pkts_toserver: 12, pkts_toclient: 3, start: new Date(Date.now() - 480340) },
    metadata: { sensor: 'sen-net-002', organization_id: 'org-bravo-002' }
  },
  {
    timestamp: new Date(Date.now() - 300000), event_type: 'alert',
    src_ip: '10.0.2.15', src_port: 49152, dest_ip: '45.155.205.189', dest_port: 443,
    proto: 'TCP', app_proto: 'tls',
    alert: { signature_id: 2024050, signature: 'MALWARE-CNC Win.Trojan.CobaltStrike Beacon', category: 'A Network Trojan was Detected', severity: 1, action: 'allowed' },
    flow: { bytes_toserver: 256, bytes_toclient: 1024, pkts_toserver: 4, pkts_toclient: 6, start: new Date(Date.now() - 300060) },
    metadata: { sensor: 'sen-net-002', organization_id: 'org-bravo-002' }
  },
  {
    timestamp: new Date(Date.now() - 180000), event_type: 'alert',
    src_ip: '91.219.236.174', src_port: 52341, dest_ip: '10.0.3.1', dest_port: 22,
    proto: 'TCP', app_proto: 'ssh',
    alert: { signature_id: 2003068, signature: 'ET SCAN SSH Brute Force Attempt', category: 'Attempted Information Leak', severity: 2, action: 'allowed' },
    flow: { bytes_toserver: 89200, bytes_toclient: 34500, pkts_toserver: 694, pkts_toclient: 347, start: new Date(Date.now() - 900000) },
    metadata: { sensor: 'sen-net-002', organization_id: 'org-bravo-002' }
  },
  {
    timestamp: new Date(Date.now() - 1800000), event_type: 'alert',
    src_ip: '185.220.101.34', src_port: 44123, dest_ip: '10.0.0.0', dest_port: null,
    proto: 'TCP', app_proto: null,
    alert: { signature_id: 2009582, signature: 'ET SCAN Nmap SYN Scan', category: 'Detection of a Network Scan', severity: 2, action: 'allowed' },
    flow: { bytes_toserver: 40960, bytes_toclient: 8192, pkts_toserver: 1024, pkts_toclient: 256, start: new Date(Date.now() - 1845000) },
    metadata: { sensor: 'sen-net-002', organization_id: 'org-bravo-002' }
  },
  {
    timestamp: new Date(Date.now() - 1200000), event_type: 'alert',
    src_ip: '10.0.4.22', src_port: 53421, dest_ip: '8.8.8.8', dest_port: 53,
    proto: 'UDP', app_proto: 'dns',
    alert: { signature_id: 2027863, signature: 'ET DNS Excessive DNS Queries for TXT Records - Possible DNS Tunnel', category: 'Potentially Bad Traffic', severity: 2, action: 'allowed' },
    flow: { bytes_toserver: 240000, bytes_toclient: 120000, pkts_toserver: 2400, pkts_toclient: 2400, start: new Date(Date.now() - 2400000) },
    metadata: { sensor: 'sen-net-002', organization_id: 'org-bravo-002' }
  },
  {
    timestamp: new Date(Date.now() - 3600000), event_type: 'alert',
    src_ip: '10.0.5.10', src_port: 58923, dest_ip: '104.18.32.7', dest_port: 443,
    proto: 'TCP', app_proto: 'tls',
    alert: { signature_id: 2030001, signature: 'ET POLICY Large Outbound Data Transfer', category: 'Potential Corporate Privacy Violation', severity: 2, action: 'allowed' },
    flow: { bytes_toserver: 2400000000, bytes_toclient: 45000, pkts_toserver: 1600000, pkts_toclient: 30000, start: new Date(Date.now() - 6300000) },
    metadata: { sensor: 'sen-net-002', organization_id: 'org-bravo-002' }
  },
  {
    timestamp: new Date(Date.now() - 7200000), event_type: 'alert',
    src_ip: '103.75.190.42', src_port: 39102, dest_ip: '10.0.1.80', dest_port: 80,
    proto: 'TCP', app_proto: 'http',
    alert: { signature_id: 2019408, signature: 'ET WEB_SERVER SQL Injection Attempt - SELECT', category: 'Web Application Attack', severity: 2, action: 'allowed' },
    flow: { bytes_toserver: 512, bytes_toclient: 8192, pkts_toserver: 4, pkts_toclient: 6, start: new Date(Date.now() - 7200100) },
    metadata: { sensor: 'sen-net-002', organization_id: 'org-bravo-002' }
  }
]);

// ── Ollama Interactions ─────────────────────────────────────────────────────

db.ollama_interactions.insertMany([
  {
    interaction_id: 'ollama-001',
    timestamp: new Date(Date.now() - 3600000),
    model: 'llama3:8b', prompt_type: 'THREAT_INVESTIGATION',
    input: {
      alert_id: 'alt-009', title: 'Cobalt Strike beacon detected',
      iocs: ['45.155.205.189', 'a1b2c3d4e5f6...', 'update-service.cloud'],
      context: 'Internal host 10.0.2.15 exhibiting C2 beacon behavior with 60s interval'
    },
    output: {
      threat_assessment: 'HIGH - Active APT compromise with established C2 channel',
      attribution: 'Indicators overlap with APT-41 (Winnti Group) infrastructure. Domain update-service.cloud registered via same registrar used in previous APT-41 campaigns.',
      kill_chain_phase: 'Command & Control (Phase 6 of 7)',
      recommendations: [
        'IMMEDIATE: Isolate host 10.0.2.15 from network',
        'URGENT: Memory dump and forensic image of affected host',
        'HIGH: Scan all endpoints for beacon artifacts and lateral movement indicators',
        'MEDIUM: Review DNS logs for additional C2 domains',
        'LOW: Update threat intelligence feeds with new IOCs'
      ],
      confidence: 0.87,
      mitre_techniques: ['T1071.001', 'T1573.002', 'T1132.001']
    },
    tokens_used: 2847, latency_ms: 3420,
    user_id: 'usr-anl-005', organization_id: 'org-bravo-002'
  },
  {
    interaction_id: 'ollama-002',
    timestamp: new Date(Date.now() - 1800000),
    model: 'llama3:8b', prompt_type: 'INTELLIGENCE_SUMMARY',
    input: {
      time_range: 'last_6_hours',
      domains: ['LAND', 'AIR', 'SEA', 'CYBER'],
      classification: 'SECRET'
    },
    output: {
      summary: 'SITUATION REPORT - Period: Last 6 Hours\n\n1. LAND DOMAIN: Armed individual detected at North Gate (CRITICAL). Fence breach on eastern perimeter. Suspicious loitering activity near restricted zone. Seismic anomaly suggests possible tunneling.\n\n2. AIR DOMAIN: Unauthorized UAV penetrated restricted airspace at 400ft AGL. One patrol drone offline (battery depletion). Fixed-wing traffic normal.\n\n3. SEA DOMAIN: Unidentified small craft approaching harbor without AIS. Possible subsurface contact (diver/UUV) detected by sonar array.\n\n4. CYBER DOMAIN: Active APT compromise detected (Cobalt Strike C2). CVE exploitation attempt from known Tor exit. SSH brute force from APT-28 linked IP. DNS tunneling activity from internal host.\n\n5. ASSESSMENT: Multi-domain threat posture elevated. Physical and cyber indicators suggest coordinated reconnaissance activity. Recommend FPCON DELTA.',
      priority_actions: [
        'Deploy QRF to eastern perimeter breach',
        'Activate counter-UAS measures',
        'Intercept unidentified vessel',
        'Complete forensic analysis of compromised host'
      ],
      threat_level: 'SUBSTANTIAL'
    },
    tokens_used: 3156, latency_ms: 4100,
    user_id: 'usr-cmd-001', organization_id: 'org-alpha-001'
  }
]);

print('MongoDB seed data inserted successfully');

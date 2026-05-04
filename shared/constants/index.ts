// sentinel-os/shared/constants/index.ts
export const KAFKA_TOPICS = {
  INTELLIGENCE: 'sentinel.intelligence',
  ALERTS: 'sentinel.alerts',
  ALERTS_ENRICHED: 'sentinel.alerts.enriched',
  CYBER_RAW: 'sentinel.cyber.raw-events',
  CYBER_IOC: 'sentinel.cyber.threat-indicators',
  OSINT_ITEMS: 'sentinel.osint.items',
  OSINT_IOC: 'sentinel.osint.ioc',
  SIGINT_SIGNALS: 'sentinel.sigint.signals',
  FUSION_CORRELATED: 'sentinel.fusion.correlated',
  FUSION_GRAPH: 'sentinel.fusion.graph-ops',
  RESPONSE_EXECUTED: 'sentinel.response.executed',
  RESPONSE_APPROVALS: 'sentinel.response.approvals',
  GOVERNANCE_AUDIT: 'sentinel.governance.audit',
  GOVERNANCE_COMPLIANCE: 'sentinel.governance.compliance',
  SENSOR_TELEMETRY: 'sentinel.sensors.telemetry',
  AI_INFERENCE: 'sentinel.ai.inference',
  SIMULATION_EVENTS: 'sentinel.simulation.events',
} as const;

export const SERVICE_PORTS = {
  API_GATEWAY: 4000,
  AUTH: 4001,
  CYBER: 4002,
  FUSION: 4003,
  INGESTION: 4004,
  OSINT: 4005,
  AI: 5000,
  RESPONSE: 4006,
  SIMULATION: 4007,
  GOVERNANCE: 4008,
} as const;

export const CLASSIFICATION_LEVELS = ['UNCLASSIFIED', 'CUI', 'CONFIDENTIAL', 'SECRET', 'TOP_SECRET', 'TOP_SECRET_SCI'] as const;

export const SEVERITY_LEVELS = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export const IOC_TYPES = ['ip', 'domain', 'url', 'hash_md5', 'hash_sha256', 'email', 'cidr', 'signature', 'cve'] as const;

export const MITRE_TACTICS = [
  'Reconnaissance', 'Resource Development', 'Initial Access', 'Execution',
  'Persistence', 'Privilege Escalation', 'Defense Evasion', 'Credential Access',
  'Discovery', 'Lateral Movement', 'Collection', 'Command and Control',
  'Exfiltration', 'Impact',
] as const;

export const TLP_MARKINGS = ['TLP:RED', 'TLP:AMBER+STRICT', 'TLP:AMBER', 'TLP:GREEN', 'TLP:CLEAR'] as const;

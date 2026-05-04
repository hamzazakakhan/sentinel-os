// sentinel-os/shared/types/index.ts
export interface Alert {
  id: string;
  title: string;
  description: string;
  severity: Severity;
  classification: ClassificationLevel;
  domain: string;
  source: string;
  iocs: IOC[];
  created_at: string;
  updated_at: string;
  acknowledged_by?: string;
  resolved_by?: string;
  status: 'NEW' | 'ACKNOWLEDGED' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
}

export interface IOC {
  type: IOCType;
  value: string;
  confidence: number;
  source: string;
  tlp?: string;
  first_seen?: string;
  last_seen?: string;
  tags: string[];
}

export interface SensorReading {
  sensor_id: string;
  timestamp: string;
  data_type: string;
  payload: Record<string, unknown>;
  location?: { lat: number; lon: number; alt?: number };
  classification: ClassificationLevel;
}

export interface IntelligenceItem {
  id: string;
  source: string;
  feed_type: 'OSINT' | 'SIGINT' | 'CTI' | 'HUMINT';
  title?: string;
  content: string;
  iocs: IOC[];
  sentiment?: number;
  credibility?: number;
  collected_at: string;
  tlp: string;
  classification: ClassificationLevel;
}

export type Severity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ClassificationLevel = 'UNCLASSIFIED' | 'CUI' | 'CONFIDENTIAL' | 'SECRET' | 'TOP_SECRET' | 'TOP_SECRET_SCI';
export type IOCType = 'ip' | 'domain' | 'url' | 'hash_md5' | 'hash_sha256' | 'email' | 'cidr' | 'signature' | 'cve';

export interface KafkaMessage<T = unknown> {
  key: string;
  value: T;
  topic: string;
  partition?: number;
  offset?: number;
  timestamp: string;
  headers?: Record<string, string>;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  has_next: boolean;
}

export interface HealthCheck {
  service: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime_sec: number;
  dependencies: Record<string, 'healthy' | 'degraded' | 'unhealthy'>;
  checked_at: string;
}

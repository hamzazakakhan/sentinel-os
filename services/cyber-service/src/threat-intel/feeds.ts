// ──────────────────────────────────────────────────────────────
// sentinel-os/services/cyber-service/src/threat-intel/feeds.ts
// Threat intelligence feed aggregation and IOC matching
// ──────────────────────────────────────────────────────────────

import { Kafka } from 'kafkajs';
import { pino } from 'pino';

const logger = pino({ name: 'threat-intel' });
const KAFKA_BROKER = process.env.KAFKA_BROKERS || 'localhost:9092';
const TOPIC_IOC = 'sentinel.cyber.threat-indicators';

export interface IOC {
  type: 'ip' | 'domain' | 'url' | 'hash_md5' | 'hash_sha256' | 'email' | 'cidr' | 'signature';
  value: string;
  source: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  confidence: number;
  tags: string[];
  first_seen?: string;
  last_seen?: string;
  description?: string;
  tlp?: string;
}

export interface ThreatFeedConfig {
  name: string;
  url: string;
  format: 'stix' | 'csv' | 'json' | 'txt' | 'misp';
  poll_interval_sec: number;
  enabled: boolean;
  severity_override?: string;
}

const DEFAULT_FEEDS: ThreatFeedConfig[] = [
  { name: 'abuse-ch-ssl', url: 'https://sslbl.abuse.ch/blacklist/sslipblacklist.txt', format: 'txt', poll_interval_sec: 3600, enabled: true },
  { name: 'abuse-ch-urlhaus', url: 'https://urlhaus-api.abuse.ch/v1/urls/recent/', format: 'json', poll_interval_sec: 1800, enabled: true },
  { name: 'abuse-ch-threatfox', url: 'https://threatfox-api.abuse.ch/api/v1/', format: 'json', poll_interval_sec: 3600, enabled: true },
  { name: 'feodo-tracker', url: 'https://feodotracker.abuse.ch/downloads/ipblocklist.json', format: 'json', poll_interval_sec: 3600, enabled: true },
  { name: 'spamhaus-drop', url: 'https://www.spamhaus.org/drop/drop.txt', format: 'txt', poll_interval_sec: 7200, enabled: true },
  { name: 'tor-exit-nodes', url: 'https://check.torproject.org/torbulkexitlist', format: 'txt', poll_interval_sec: 3600, enabled: true },
  { name: 'emerging-threats', url: 'https://rules.emergingthreats.net/blocklists/compromised-ips.txt', format: 'txt', poll_interval_sec: 7200, enabled: true },
  { name: 'phishtank', url: 'https://data.phishtank.com/data/online-valid.json', format: 'json', poll_interval_sec: 3600, enabled: true },
  { name: 'cisa-kev', url: 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json', format: 'json', poll_interval_sec: 86400, enabled: true },
];

export class ThreatIntelAggregator {
  private feeds: ThreatFeedConfig[];
  private iocCache: Map<string, IOC> = new Map();
  private kafka: Kafka;

  constructor(feeds?: ThreatFeedConfig[]) {
    this.feeds = feeds || DEFAULT_FEEDS;
    this.kafka = new Kafka({ brokers: [KAFKA_BROKER] });
  }

  async start(): Promise<void> {
    logger.info('Starting threat intel aggregator with %d feeds', this.feeds.length);
    for (const feed of this.feeds) {
      if (feed.enabled) this.pollFeed(feed);
    }
  }

  private async pollFeed(feed: ThreatFeedConfig): Promise<void> {
    const poll = async () => {
      try {
        const iocs = await this.fetchFeed(feed);
        for (const ioc of iocs) {
          this.iocCache.set(`${ioc.type}:${ioc.value}`, ioc);
        }
        if (iocs.length > 0) {
          await this.publishIOCs(iocs);
          logger.info({ feed: feed.name, count: iocs.length }, 'Feed polled');
        }
      } catch (err: any) {
        logger.warn({ feed: feed.name, error: err.message }, 'Feed poll failed');
      }
    };

    await poll();
    setInterval(poll, feed.poll_interval_sec * 1000);
  }

  private async fetchFeed(feed: ThreatFeedConfig): Promise<IOC[]> {
    try {
      const resp = await fetch(feed.url);
      if (!resp.ok) return [];

      if (feed.format === 'txt') {
        const text = await resp.text();
        return text.split('\n')
          .filter((l: string) => l.trim() && !l.startsWith('#') && !l.startsWith(';'))
          .map((l: string) => this.parseTxtLine(l.trim(), feed));
      }

      if (feed.format === 'json') {
        const data = await resp.json();
        return this.parseJsonFeed(data, feed);
      }

      return [];
    } catch { return []; }
  }

  private parseTxtLine(line: string, feed: ThreatFeedConfig): IOC {
    const type = line.includes('/') ? 'cidr' : line.includes('.') ? 'ip' : 'domain';
    return {
      type: type as any,
      value: line.split(';')[0].split('|')[0].trim(),
      source: feed.name,
      severity: (feed.severity_override as any) || 'MEDIUM',
      confidence: 0.7,
      tags: [feed.name],
    };
  }

  private parseJsonFeed(data: any, feed: ThreatFeedConfig): IOC[] {
    const iocs: IOC[] = [];
    const items = Array.isArray(data) ? data : (data.vulnerabilities || data.urls || data.payloads || data.data || []);
    for (const item of items.slice(0, 100)) {
      if (item.ip_address || item.ip) {
        iocs.push({ type: 'ip', value: item.ip_address || item.ip, source: feed.name, severity: 'HIGH', confidence: 0.8, tags: [feed.name] });
      }
      if (item.url) {
        iocs.push({ type: 'url', value: item.url, source: feed.name, severity: 'HIGH', confidence: 0.8, tags: [feed.name] });
      }
      if (item.cveID) {
        iocs.push({ type: 'signature', value: item.cveID, source: feed.name, severity: 'CRITICAL', confidence: 0.9, tags: [feed.name, 'kev'], description: item.vulnerabilityName });
      }
      if (item.ioc_value) {
        iocs.push({ type: (item.ioc_type || 'ip') as any, value: item.ioc_value, source: feed.name, severity: 'HIGH', confidence: 0.7, tags: [feed.name] });
      }
      if (item.sha256_hash) {
        iocs.push({ type: 'hash_sha256', value: item.sha256_hash, source: feed.name, severity: 'HIGH', confidence: 0.8, tags: [feed.name, 'malware'] });
      }
    }
    return iocs;
  }

  private async publishIOCs(iocs: IOC[]): Promise<void> {
    try {
      const producer = this.kafka.producer();
      await producer.connect();
      await producer.send({
        topic: TOPIC_IOC,
        messages: iocs.map(ioc => ({
          key: `${ioc.type}:${ioc.value}`,
          value: JSON.stringify(ioc),
        })),
      });
      await producer.disconnect();
    } catch (err: any) {
      logger.warn('Failed to publish IOCs to Kafka: %s', err.message);
    }
  }

  matchIOC(type: string, value: string): IOC | undefined {
    return this.iocCache.get(`${type}:${value}`);
  }

  matchIP(ip: string): IOC | undefined {
    return this.matchIOC('ip', ip) || this.matchIOC('cidr', ip);
  }

  matchHash(hash: string): IOC | undefined {
    return this.matchIOC('hash_sha256', hash) || this.matchIOC('hash_md5', hash);
  }

  getAllIOCs(): IOC[] {
    return Array.from(this.iocCache.values());
  }

  getStats(): { total: number; by_type: Record<string, number>; by_source: Record<string, number> } {
    const all = this.getAllIOCs();
    const by_type: Record<string, number> = {};
    const by_source: Record<string, number> = {};
    for (const ioc of all) {
      by_type[ioc.type] = (by_type[ioc.type] || 0) + 1;
      by_source[ioc.source] = (by_source[ioc.source] || 0) + 1;
    }
    return { total: all.length, by_type, by_source };
  }
}

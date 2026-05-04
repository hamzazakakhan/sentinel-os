// ──────────────────────────────────────────────────────────────
// sentinel-os/services/cyber-service/src/threat-intel/nvd-cve.ts
// LIVE NVD CVE Feed — pulls critical CVEs, enriches with CVSS
// Cross-references with Shodan for exposure analysis
// ──────────────────────────────────────────────────────────────

import axios from 'axios';
import { pino } from 'pino';
import { Kafka } from 'kafkajs';

const logger = pino({ name: 'nvd-cve' });
const KAFKA_BROKER = process.env.KAFKA_BROKERS || 'localhost:9092';

export interface CveRecord {
  id: string;
  description: string;
  cvssScore: number | null;
  exploitabilityScore: number | null;
  cpe: string[];
  references: string[];
  publishedDate: string;
  kev: boolean;
}

export interface ExposureReport {
  ip: string;
  exposed: boolean;
  products: string[];
  risk: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
}

export class NvdCveConnector {
  private readonly BASE = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
  private readonly CISA_KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
  private kafka: Kafka;
  private kevCache = new Set<string>();

  constructor() {
    this.kafka = new Kafka({ brokers: [KAFKA_BROKER] });
  }

  async start(): Promise<void> {
    // Load CISA KEV cache for cross-referencing
    await this.loadKevCache();
    // Initial poll
    await this.pollCritical();
    // Periodic poll every 6 hours
    setInterval(() => this.pollCritical(), 6 * 3600 * 1000);
    // Refresh KEV daily
    setInterval(() => this.loadKevCache(), 86400 * 1000);
  }

  private async loadKevCache(): Promise<void> {
    try {
      const { data } = await axios.get(this.CISA_KEV_URL, { timeout: 30000 });
      if (data?.vulnerabilities) {
        this.kevCache.clear();
        for (const v of data.vulnerabilities) {
          this.kevCache.add(v.cveID);
        }
        logger.info({ count: this.kevCache.size }, 'CISA KEV cache loaded');
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Failed to load CISA KEV cache');
    }
  }

  async pollCritical(): Promise<CveRecord[]> {
    try {
      const { data } = await axios.get(this.BASE, {
        headers: { apiKey: process.env.NVD_API_KEY || '' },
        params: {
          cvssV3Severity: 'CRITICAL',
          pubStartDate: new Date(Date.now() - 86400000).toISOString(),
          resultsPerPage: 20,
        },
        timeout: 30000,
      });

      const cves: CveRecord[] = (data.vulnerabilities || []).map((v: any) => ({
        id: v.cve.id,
        description: v.cve.descriptions.find((d: any) => d.lang === 'en')?.value || '',
        cvssScore: v.cve.metrics?.cvssMetricV31?.[0]?.cvssData?.baseScore ?? null,
        exploitabilityScore: v.cve.metrics?.cvssMetricV31?.[0]?.exploitabilityScore ?? null,
        cpe: v.cve.configurations?.[0]?.nodes?.[0]?.cpeMatch?.map((c: any) => c.criteria) || [],
        references: v.cve.references?.map((r: any) => r.url) || [],
        publishedDate: v.cve.published,
        kev: this.kevCache.has(v.cve.id),
      }));

      if (cves.length > 0) {
        await this.publishCves(cves);
        logger.info({ count: cves.length }, 'Critical CVEs published');
      }

      return cves;
    } catch (err: any) {
      logger.warn({ err: err.message }, 'NVD CVE poll failed');
      return [];
    }
  }

  async searchCve(keyword: string): Promise<CveRecord[]> {
    try {
      const { data } = await axios.get(this.BASE, {
        params: { keywordSearch: keyword, resultsPerPage: 20 },
        timeout: 30000,
      });

      return (data.vulnerabilities || []).map((v: any) => ({
        id: v.cve.id,
        description: v.cve.descriptions.find((d: any) => d.lang === 'en')?.value || '',
        cvssScore: v.cve.metrics?.cvssMetricV31?.[0]?.cvssData?.baseScore ?? null,
        exploitabilityScore: v.cve.metrics?.cvssMetricV31?.[0]?.exploitabilityScore ?? null,
        cpe: v.cve.configurations?.[0]?.nodes?.[0]?.cpeMatch?.map((c: any) => c.criteria) || [],
        references: v.cve.references?.map((r: any) => r.url) || [],
        publishedDate: v.cve.published,
        kev: this.kevCache.has(v.cve.id),
      }));
    } catch (err: any) {
      logger.warn({ err: err.message }, 'NVD CVE search failed');
      return [];
    }
  }

  async crossRefWithShodan(ip: string, cpeList: string[]): Promise<ExposureReport> {
    const shodanKey = process.env.SHODAN_KEY;
    if (!shodanKey) {
      return { ip, exposed: false, products: [], risk: 'LOW' };
    }

    try {
      const { data } = await axios.get(
        `https://api.shodan.io/shodan/host/${ip}?key=${shodanKey}`,
        { timeout: 10000 }
      );
      const products = data.data?.map((d: any) => d.product).filter(Boolean) ?? [];
      const exposed = cpeList.some(cpe =>
        products.some((p: string) => cpe.toLowerCase().includes(p?.toLowerCase()))
      );
      return { ip, exposed, products, risk: exposed ? 'CRITICAL' : 'LOW' };
    } catch (err: any) {
      logger.warn({ err: err.message, ip }, 'Shodan lookup failed');
      return { ip, exposed: false, products: [], risk: 'LOW' };
    }
  }

  private async publishCves(cves: CveRecord[]): Promise<void> {
    try {
      const producer = this.kafka.producer();
      await producer.connect();
      await producer.send({
        topic: 'sentinel.cyber.cve-critical',
        messages: cves.map(cve => ({
          key: cve.id,
          value: JSON.stringify(cve),
        })),
      });
      await producer.disconnect();
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Failed to publish CVEs to Kafka');
    }
  }
}

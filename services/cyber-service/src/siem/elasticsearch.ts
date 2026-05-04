// ──────────────────────────────────────────────────────────────
// sentinel-os/services/cyber-service/src/siem/elasticsearch.ts
// Elasticsearch SIEM queries for threat hunting and log analysis
// ──────────────────────────────────────────────────────────────

import { pino } from 'pino';

const logger = pino({ name: 'elk-siem' });
const ES_URL = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';

export interface SearchHit {
  _index: string;
  _id: string;
  _score: number;
  _source: Record<string, any>;
}

export interface SearchResult {
  total: number;
  hits: SearchHit[];
  aggregations?: Record<string, any>;
}

export class ElasticsearchSIEM {
  private baseUrl: string;

  constructor(url?: string) {
    this.baseUrl = url || ES_URL;
  }

  private async request(method: string, path: string, body?: any): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    const opts: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);

    const resp = await fetch(url, opts);
    if (!resp.ok) {
      const text = await resp.text();
      logger.warn('ES request failed: %s %s → %d %s', method, path, resp.status, text.substring(0, 200));
      return null;
    }
    return resp.json();
  }

  async search(index: string, query: any, size: number = 50): Promise<SearchResult> {
    const data = await this.request('POST', `/${index}/_search`, { size, ...query });
    if (!data?.hits) return { total: 0, hits: [] };
    return {
      total: data.hits.total?.value ?? data.hits.total ?? 0,
      hits: data.hits.hits || [],
      aggregations: data.aggregations,
    };
  }

  async getAlerts(severity?: string, from?: string, to?: string, size: number = 50): Promise<SearchResult> {
    const must: any[] = [
      { term: { 'event.category': 'threat' } },
    ];
    if (severity) must.push({ term: { 'event.severity': severity } });
    if (from || to) {
      const range: any = { range: { '@timestamp': {} } };
      if (from) range.range['@timestamp'].gte = from;
      if (to) range.range['@timestamp'].lte = to;
      must.push(range);
    }
    return this.search('sentinel-cyber-*', { query: { bool: { must } } }, size);
  }

  async getNetworkEvents(srcIp?: string, destIp?: string, protocol?: string, size: number = 100): Promise<SearchResult> {
    const must: any[] = [
      { terms: { 'event.category': ['network', 'traffic'] } },
    ];
    if (srcIp) must.push({ term: { 'source.ip': srcIp } });
    if (destIp) must.push({ term: { 'destination.ip': destIp } });
    if (protocol) must.push({ term: { 'network.protocol': protocol } });
    return this.search('sentinel-cyber-*', { query: { bool: { must } } }, size);
  }

  async getTopTalkers(field: string, size: number = 20): Promise<SearchResult> {
    return this.search('sentinel-cyber-*', {
      query: { terms: { 'event.category': ['network'] } },
      aggs: { top_talkers: { terms: { field, size } } },
      size: 0,
    });
  }

  async getDnsLookups(domain?: string, size: number = 50): Promise<SearchResult> {
    const must: any[] = [{ term: { 'event.dataset': 'dns' } }];
    if (domain) must.push({ wildcard: { 'dns.question.name': `*${domain}*` } });
    return this.search('sentinel-cyber-*', { query: { bool: { must } } }, size);
  }

  async getHttpLogs(hostname?: string, statusCode?: number, size: number = 50): Promise<SearchResult> {
    const must: any[] = [{ term: { 'event.dataset': 'http' } }];
    if (hostname) must.push({ term: { 'http.request.referrer': hostname } });
    if (statusCode) must.push({ term: { 'http.response.status_code': statusCode } });
    return this.search('sentinel-cyber-*', { query: { bool: { must } } }, size);
  }

  async indexDocument(index: string, doc: Record<string, any>): Promise<string | null> {
    const data = await this.request('POST', `/${index}/_doc`, doc);
    return data?._id ?? null;
  }

  async bulkIndex(index: string, docs: Record<string, any>[]): Promise<number> {
    const body = docs.flatMap(d => [
      { index: { _index: index } },
      d,
    ]).map(l => JSON.stringify(l)).join('\n') + '\n';

    const url = `${this.baseUrl}/_bulk`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-ndjson' },
      body,
    });
    const data = await resp.json();
    return data.items?.length ?? 0;
  }

  async createIndex(index: string, mappings?: any): Promise<boolean> {
    const body = mappings ? { mappings } : undefined;
    const data = await this.request('PUT', `/${index}`, body);
    return data?.acknowledged ?? false;
  }

  async getClusterHealth(): Promise<Record<string, any>> {
    const data = await this.request('GET', '/_cluster/health');
    return data ?? {};
  }
}

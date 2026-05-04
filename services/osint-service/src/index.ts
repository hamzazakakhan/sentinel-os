import express from 'express';
import { Kafka, Producer, Consumer, EachMessagePayload } from 'kafkajs';
import { Redis } from 'ioredis';
import { Pool } from 'pg';
import axios from 'axios';
import { CronJob } from 'cron';
import RSSParser from 'rss-parser';
import * as cheerio from 'cheerio';
import { v4 as uuid } from 'uuid';
import { pino } from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info', name: 'osint-service' });
const PORT = parseInt(process.env.PORT || '4004', 10);

const pgPool = new Pool({
  host: process.env.PG_HOST, port: parseInt(process.env.PG_PORT || '5432', 10),
  database: process.env.PG_DATABASE, user: process.env.PG_USER || 'sentinel_admin',
  password: process.env.PG_PASSWORD, max: 15,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined,
});

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: 3, lazyConnect: true });

const kafka = new Kafka({
  clientId: 'osint-service',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  retry: { initialRetryTime: 1000, retries: 10 },
});

interface FeedConfig {
  id: string;
  name: string;
  url: string;
  type: 'rss' | 'api' | 'scrape' | 'twitter' | 'telegram';
  schedule: string;
  classification: string;
  reliability: string;
  enabled: boolean;
  headers?: Record<string, string>;
  extractionRules?: Record<string, any>;
}

const rssParser = new RSSParser({
  timeout: 30000,
  maxRedirects: 5,
  headers: { 'User-Agent': 'Sentinel-OS-OSINT/1.0' },
});

async function bootstrap(): Promise<void> {
  const app = express();
  app.use(express.json());

  const producer: Producer = kafka.producer({ allowAutoTopicCreation: false });
  await producer.connect();

  const consumer: Consumer = kafka.consumer({ groupId: 'osint-service-processing' });
  await consumer.connect();

  const feedConfigs: FeedConfig[] = [
    { id: 'cve-feed', name: 'NVD CVE Feed', url: 'https://services.nvd.nist.gov/rest/json/cves/2.0', type: 'api', schedule: '*/15 * * * *', classification: 'UNCLASSIFIED', reliability: 'A', enabled: true },
    { id: 'abuse-ipdb', name: 'AbuseIPDB Feed', url: 'https://api.abuseipdb.com/api/v2/blacklist', type: 'api', schedule: '0 */4 * * *', classification: 'UNCLASSIFIED', reliability: 'B', enabled: true, headers: { 'Key': process.env.ABUSEIPDB_API_KEY || '', 'Accept': 'application/json' } },
    { id: 'alienvault-otx', name: 'AlienVault OTX', url: 'https://otx.alienvault.com/api/v1/pulses/subscribed', type: 'api', schedule: '*/30 * * * *', classification: 'UNCLASSIFIED', reliability: 'B', enabled: true, headers: { 'X-OTX-API-KEY': process.env.OTX_API_KEY || '' } },
    { id: 'threatfox', name: 'ThreatFox IOCs', url: 'https://threatfox-api.abuse.ch/api/v1/', type: 'api', schedule: '*/20 * * * *', classification: 'UNCLASSIFIED', reliability: 'B', enabled: true },
    { id: 'feodo-tracker', name: 'Feodo Tracker', url: 'https://feodotracker.abuse.ch/downloads/ipblocklist_recommended.json', type: 'api', schedule: '0 */2 * * *', classification: 'UNCLASSIFIED', reliability: 'B', enabled: true },
  ];

  const activeCrons: CronJob[] = [];

  for (const feed of feedConfigs) {
    if (!feed.enabled) continue;

    const job = new CronJob(feed.schedule, async () => {
      try {
        logger.info({ feedId: feed.id, feedName: feed.name }, 'Fetching OSINT feed');
        const items = await fetchFeed(feed);
        let newItems = 0;

        for (const item of items) {
          const dedupeKey = `sentinel:osint:dedup:${feed.id}:${item.hash || item.id}`;
          const exists = await redis.exists(dedupeKey);
          if (exists) continue;

          await redis.setex(dedupeKey, 604800, '1');
          newItems++;

          await producer.send({
            topic: 'sentinel.osint.items',
            messages: [{
              key: feed.id,
              value: JSON.stringify({
                id: uuid(),
                feedId: feed.id,
                feedName: feed.name,
                feedType: feed.type,
                title: item.title,
                content: item.content,
                url: item.url,
                author: item.author,
                publishedAt: item.publishedAt,
                classification: feed.classification,
                reliability: feed.reliability,
                tags: item.tags || [],
                indicators: item.indicators || [],
                rawData: item.rawData,
                ingestedAt: new Date().toISOString(),
              }),
            }],
          });
        }

        logger.info({ feedId: feed.id, total: items.length, new: newItems }, 'Feed fetch complete');
      } catch (error: any) {
        logger.error({ feedId: feed.id, error: error.message }, 'Feed fetch failed');
      }
    }, null, true, 'UTC');

    activeCrons.push(job);
  }

  await consumer.subscribe({ topics: ['sentinel.osint.for-analysis'], fromBeginning: false });
  await consumer.run({
    eachMessage: async (payload: EachMessagePayload) => {
      if (!payload.message.value) return;
      try {
        const data = JSON.parse(payload.message.value.toString());
        await processOsintItem(data, producer);
      } catch (error: any) {
        logger.error({ error: error.message }, 'OSINT processing failed');
      }
    },
  });

  app.post('/api/v1/osint/feeds', async (req, res) => {
    const feed: FeedConfig = { id: uuid(), ...req.body, enabled: true };
    feedConfigs.push(feed);
    res.status(201).json(feed);
  });

  app.get('/api/v1/osint/feeds', (_req, res) => {
    res.json(feedConfigs.map(f => ({ ...f, headers: undefined })));
  });

  app.post('/api/v1/osint/search', async (req, res) => {
    const { query, feedTypes, timeRange, limit } = req.body;
    try {
      const params: any[] = [];
      let sql = `SELECT * FROM osint_items WHERE 1=1`;
      if (query) { params.push(`%${query}%`); sql += ` AND (title ILIKE $${params.length} OR content->>'text' ILIKE $${params.length})`; }
      if (feedTypes?.length) { params.push(feedTypes); sql += ` AND feed_type = ANY($${params.length}::text[])`; }
      if (timeRange?.start) { params.push(timeRange.start); sql += ` AND ingested_at >= $${params.length}`; }
      if (timeRange?.end) { params.push(timeRange.end); sql += ` AND ingested_at <= $${params.length}`; }
      params.push(limit || 50);
      sql += ` ORDER BY ingested_at DESC LIMIT $${params.length}`;

      const result = await pgPool.query(sql, params);
      res.json({ items: result.rows, total: result.rowCount });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/v1/osint/indicator-lookup', async (req, res) => {
    const { indicator, type } = req.body;
    try {
      const results = await lookupIndicator(indicator, type);
      res.json(results);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      feeds: { total: feedConfigs.length, active: feedConfigs.filter(f => f.enabled).length },
      timestamp: new Date().toISOString(),
    });
  });

  app.listen(PORT, '0.0.0.0', () => logger.info(`OSINT Service ready at http://0.0.0.0:${PORT}`));

  process.on('SIGTERM', async () => {
    activeCrons.forEach(c => c.stop());
    await consumer.disconnect();
    await producer.disconnect();
    await pgPool.end();
    redis.disconnect();
    process.exit(0);
  });
}

async function fetchFeed(feed: FeedConfig): Promise<any[]> {
  switch (feed.type) {
    case 'rss': return fetchRSSFeed(feed);
    case 'api': return fetchAPIFeed(feed);
    case 'scrape': return fetchScrapeFeed(feed);
    default: return [];
  }
}

async function fetchRSSFeed(feed: FeedConfig): Promise<any[]> {
  const parsed = await rssParser.parseURL(feed.url);
  return (parsed.items || []).map(item => ({
    id: item.guid || item.link || uuid(),
    hash: Buffer.from(item.guid || item.link || '').toString('base64').substring(0, 32),
    title: item.title || '',
    content: { text: item.contentSnippet || item.content || '', html: item.content },
    url: item.link,
    author: item.creator || item.author,
    publishedAt: item.pubDate || new Date().toISOString(),
    tags: item.categories || [],
    rawData: item,
  }));
}

async function fetchAPIFeed(feed: FeedConfig): Promise<any[]> {
  const response = await axios.get(feed.url, {
    headers: feed.headers || {},
    timeout: 60000,
  });

  const data = response.data;
  if (Array.isArray(data)) {
    return data.map(item => ({
      id: item.id || uuid(),
      hash: Buffer.from(JSON.stringify(item).substring(0, 100)).toString('base64').substring(0, 32),
      title: item.title || item.name || item.indicator || '',
      content: { text: JSON.stringify(item) },
      indicators: extractIndicators(item),
      tags: item.tags || [],
      rawData: item,
    }));
  }

  const items = data.vulnerabilities || data.results || data.data || data.pulses || data.iocs || [];
  return items.slice(0, 500).map((item: any) => ({
    id: item.id || item.cve?.id || uuid(),
    hash: Buffer.from(JSON.stringify(item).substring(0, 100)).toString('base64').substring(0, 32),
    title: item.title || item.cve?.id || item.name || '',
    content: { text: item.description || item.cve?.descriptions?.[0]?.value || JSON.stringify(item) },
    url: item.url || item.link,
    publishedAt: item.published || item.created || item.date_added,
    indicators: extractIndicators(item),
    tags: item.tags || [],
    rawData: item,
  }));
}

async function fetchScrapeFeed(feed: FeedConfig): Promise<any[]> {
  const response = await axios.get(feed.url, { timeout: 30000, headers: { 'User-Agent': 'Sentinel-OS-OSINT/1.0' } });
  const $ = cheerio.load(response.data);
  const items: any[] = [];
  const rules = feed.extractionRules || {};

  $(rules.itemSelector || 'article, .post, .entry').each((i, el) => {
    if (i >= 100) return;
    items.push({
      id: uuid(),
      hash: Buffer.from($(el).text().substring(0, 100)).toString('base64').substring(0, 32),
      title: $(el).find(rules.titleSelector || 'h1, h2, h3, .title').first().text().trim(),
      content: { text: $(el).find(rules.contentSelector || 'p, .content, .body').text().trim() },
      url: $(el).find('a').first().attr('href'),
      rawData: { html: $(el).html() },
    });
  });

  return items;
}

function extractIndicators(item: any): Array<{ type: string; value: string }> {
  const indicators: Array<{ type: string; value: string }> = [];
  const text = JSON.stringify(item);

  const ipv4Regex = /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g;
  const domainRegex = /\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}\b/g;
  const md5Regex = /\b[a-fA-F0-9]{32}\b/g;
  const sha1Regex = /\b[a-fA-F0-9]{40}\b/g;
  const sha256Regex = /\b[a-fA-F0-9]{64}\b/g;
  const emailRegex = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;
  const urlRegex = /https?:\/\/[^\s"'<>]+/g;
  const cveRegex = /CVE-\d{4}-\d{4,}/g;

  for (const match of text.matchAll(ipv4Regex)) indicators.push({ type: 'ipv4', value: match[0] });
  for (const match of text.matchAll(sha256Regex)) indicators.push({ type: 'sha256', value: match[0] });
  for (const match of text.matchAll(sha1Regex)) indicators.push({ type: 'sha1', value: match[0] });
  for (const match of text.matchAll(md5Regex)) indicators.push({ type: 'md5', value: match[0] });
  for (const match of text.matchAll(emailRegex)) indicators.push({ type: 'email', value: match[0] });
  for (const match of text.matchAll(urlRegex)) indicators.push({ type: 'url', value: match[0] });
  for (const match of text.matchAll(cveRegex)) indicators.push({ type: 'cve', value: match[0] });

  const seen = new Set<string>();
  return indicators.filter(i => { const k = `${i.type}:${i.value}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

async function processOsintItem(data: any, producer: Producer): Promise<void> {
  const indicators = extractIndicators(data);

  if (indicators.length > 0) {
    await producer.send({
      topic: 'sentinel.cyber.threat-indicators',
      messages: indicators.map(ioc => ({
        key: `${ioc.type}:${ioc.value}`,
        value: JSON.stringify({
          id: uuid(),
          type: ioc.type,
          value: ioc.value,
          source: data.feedName || 'osint',
          reliability: data.reliability || 'C',
          classification: data.classification || 'UNCLASSIFIED',
          context: { feedId: data.feedId, itemTitle: data.title },
          firstSeen: new Date().toISOString(),
        }),
      })),
    });
  }

  if (data.requiresAnalysis) {
    await producer.send({
      topic: 'sentinel.osint.for-analysis',
      messages: [{
        key: data.id,
        value: JSON.stringify({ ...data, requiresMisinfoCheck: true }),
      }],
    });
  }
}

async function lookupIndicator(indicator: string, type: string): Promise<any> {
  const results: any = { indicator, type, sources: [] };

  try {
    if (type === 'ipv4' && process.env.ABUSEIPDB_API_KEY) {
      const resp = await axios.get(`https://api.abuseipdb.com/api/v2/check`, {
        params: { ipAddress: indicator, maxAgeInDays: 90 },
        headers: { Key: process.env.ABUSEIPDB_API_KEY, Accept: 'application/json' },
        timeout: 10000,
      });
      results.sources.push({ name: 'AbuseIPDB', data: resp.data.data });
    }
  } catch (error: any) {
    results.sources.push({ name: 'AbuseIPDB', error: error.message });
  }

  try {
    if (process.env.OTX_API_KEY) {
      const endpoint = type === 'ipv4' ? `IPv4/${indicator}/general` : `domain/${indicator}/general`;
      const resp = await axios.get(`https://otx.alienvault.com/api/v1/indicators/${endpoint}`, {
        headers: { 'X-OTX-API-KEY': process.env.OTX_API_KEY },
        timeout: 10000,
      });
      results.sources.push({ name: 'AlienVault OTX', data: resp.data });
    }
  } catch (error: any) {
    results.sources.push({ name: 'AlienVault OTX', error: error.message });
  }

  return results;
}

bootstrap().catch((error) => {
  logger.fatal({ error }, 'Failed to start OSINT Service');
  process.exit(1);
});

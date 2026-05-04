// ──────────────────────────────────────────────────────────────
// sentinel-os/services/osint-service/src/collectors/rss.ts
// RSS/Atom feed collector with configurable polling
// ──────────────────────────────────────────────────────────────

import { Kafka } from 'kafkajs';
import { pino } from 'pino';

const logger = pino({ name: 'rss-collector' });

export interface RSSFeedConfig {
  name: string;
  url: string;
  poll_interval_sec: number;
  enabled: boolean;
  tags: string[];
}

export interface RSSItem {
  title: string;
  link: string;
  description: string;
  pub_date: string;
  source: string;
  tags: string[];
  guid?: string;
  author?: string;
}

const DEFAULT_FEEDS: RSSFeedConfig[] = [
  { name: 'CISA', url: 'https://www.cisa.gov/news.xml', poll_interval_sec: 1800, enabled: true, tags: ['cisa', 'advisory'] },
  { name: 'US-CERT', url: 'https://www.us-cert.gov/ncas/alerts.xml', poll_interval_sec: 1800, enabled: true, tags: ['us-cert', 'alert'] },
  { name: 'SANS-ISC', url: 'https://isc.sans.edu/rssfeed.xml', poll_interval_sec: 900, enabled: true, tags: ['sans', 'isc'] },
  { name: 'BleepingComputer', url: 'https://www.bleepingcomputer.com/feed/', poll_interval_sec: 900, enabled: true, tags: ['news', 'malware'] },
  { name: 'KrebsOnSecurity', url: 'https://krebsonsecurity.com/feed/', poll_interval_sec: 3600, enabled: true, tags: ['news', 'investigation'] },
  { name: 'DarkReading', url: 'https://www.darkreading.com/rss.xml', poll_interval_sec: 1800, enabled: true, tags: ['news', 'industry'] },
  { name: 'SecurityAffairs', url: 'https://securityaffairs.co/wordpress/feed', poll_interval_sec: 1800, enabled: true, tags: ['news', 'research'] },
  { name: 'NATO', url: 'https://www.nato.int/cps/en/natohq/rss.htm', poll_interval_sec: 3600, enabled: true, tags: ['nato', 'geopolitical'] },
];

export class RSSCollector {
  private feeds: RSSFeedConfig[];
  private kafka: Kafka;

  constructor(feeds?: RSSFeedConfig[]) {
    this.feeds = feeds || DEFAULT_FEEDS;
    this.kafka = new Kafka({ brokers: [process.env.KAFKA_BROKERS || 'localhost:9092'] });
  }

  async start(): Promise<void> {
    logger.info('Starting RSS collector with %d feeds', this.feeds.filter(f => f.enabled).length);
    for (const feed of this.feeds) {
      if (feed.enabled) this.pollFeed(feed);
    }
  }

  private async pollFeed(feed: RSSFeedConfig): Promise<void> {
    const poll = async () => {
      try {
        const items = await this.fetchFeed(feed);
        if (items.length > 0) {
          await this.publishItems(items);
          logger.info({ feed: feed.name, count: items.length }, 'RSS feed polled');
        }
      } catch (err: any) {
        logger.warn({ feed: feed.name, error: err.message }, 'RSS poll failed');
      }
    };
    await poll();
    setInterval(poll, feed.poll_interval_sec * 1000);
  }

  async fetchFeed(feed: RSSFeedConfig): Promise<RSSItem[]> {
    const resp = await fetch(feed.url, { headers: { 'User-Agent': 'Sentinel-OS/2.0' } });
    if (!resp.ok) return [];
    const xml = await resp.text();
    return this.parseRSS(xml, feed);
  }

  private parseRSS(xml: string, feed: RSSFeedConfig): RSSItem[] {
    const items: RSSItem[] = [];
    const itemRegex = /<item[\s\S]*?<\/item>/gi;
    const matches = xml.match(itemRegex) || [];

    for (const match of matches.slice(0, 50)) {
      const getTag = (tag: string) => {
        const m = match.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'));
        return m ? m[1].trim() : '';
      };
      items.push({
        title: getTag('title'),
        link: getTag('link'),
        description: getTag('description').substring(0, 500),
        pub_date: getTag('pubDate') || getTag('published') || new Date().toISOString(),
        source: feed.name,
        tags: feed.tags,
        guid: getTag('guid'),
        author: getTag('author') || getTag('dc:creator'),
      });
    }
    return items;
  }

  private async publishItems(items: RSSItem[]): Promise<void> {
    try {
      const producer = this.kafka.producer();
      await producer.connect();
      await producer.send({
        topic: 'sentinel.osint.items',
        messages: items.map(item => ({
          key: item.guid || `${item.source}:${item.title.substring(0, 50)}`,
          value: JSON.stringify(item),
        })),
      });
      await producer.disconnect();
    } catch (err: any) {
      logger.warn('Kafka publish failed: %s', err.message);
    }
  }
}

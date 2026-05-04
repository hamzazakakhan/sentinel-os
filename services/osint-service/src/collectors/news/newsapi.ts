// ──────────────────────────────────────────────────────────────
// sentinel-os/services/osint-service/src/collectors/news/newsapi.ts
// NewsAPI connector — real-time news article collection
// ──────────────────────────────────────────────────────────────

import axios from 'axios';
import { pino } from 'pino';

const logger = pino({ name: 'newsapi-collector' });

export interface NewsArticle {
  source: string;
  author: string | null;
  title: string;
  description: string | null;
  url: string;
  publishedAt: string;
  content: string | null;
}

export class NewsApiCollector {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://newsapi.org/v2';

  constructor() {
    this.apiKey = process.env.NEWSAPI_KEY || '';
    if (!this.apiKey) {
      logger.warn('NEWSAPI_KEY not set — NewsAPI queries will be disabled');
    }
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async searchEverything(query: string, pageSize = 50): Promise<NewsArticle[]> {
    if (!this.apiKey) return [];

    try {
      const { data } = await axios.get(`${this.baseUrl}/everything`, {
        params: {
          apiKey: this.apiKey,
          q: query,
          pageSize,
          sortBy: 'publishedAt',
          language: 'en',
        },
        timeout: 10000,
      });

      return (data.articles || []).map((a: any) => ({
        source: a.source?.name || 'unknown',
        author: a.author,
        title: a.title,
        description: a.description,
        url: a.url,
        publishedAt: a.publishedAt,
        content: a.content,
      }));
    } catch (err: any) {
      logger.warn({ err: err.message, query }, 'NewsAPI search failed');
      return [];
    }
  }

  async topHeadlines(category = 'general', country = 'us'): Promise<NewsArticle[]> {
    if (!this.apiKey) return [];

    try {
      const { data } = await axios.get(`${this.baseUrl}/top-headlines`, {
        params: { apiKey: this.apiKey, category, country, pageSize: 50 },
        timeout: 10000,
      });

      return (data.articles || []).map((a: any) => ({
        source: a.source?.name || 'unknown',
        author: a.author,
        title: a.title,
        description: a.description,
        url: a.url,
        publishedAt: a.publishedAt,
        content: a.content,
      }));
    } catch (err: any) {
      logger.warn({ err: err.message }, 'NewsAPI headlines failed');
      return [];
    }
  }
}

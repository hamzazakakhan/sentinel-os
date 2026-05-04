// ──────────────────────────────────────────────────────────────
// sentinel-os/services/osint-service/src/collectors/news/gdelt.ts
// GDELT Realtime API — global event tone analysis, theme extraction
// ──────────────────────────────────────────────────────────────

import axios from 'axios';
import { pino } from 'pino';

const logger = pino({ name: 'gdelt-collector' });

export interface GdeltEvent {
  eventId: string;
  date: string;
  actor1: string | null;
  actor2: string | null;
  eventCode: string;
  eventDescription: string;
  goldsteinScale: number;
  avgTone: number;
  sourceUrl: string;
  lat: number | null;
  lon: number | null;
  country: string | null;
}

export interface GdeltArticle {
  url: string;
  title: string;
  source: string;
  publishedAt: string;
  language: string;
  tone: number;
  themes: string[];
}

export class GdeltCollector {
  private readonly baseUrl = 'https://api.gdeltproject.org/api/v2';

  async searchEvents(query: string, maxRecords = 50): Promise<GdeltEvent[]> {
    try {
      const { data } = await axios.get(`${this.baseUrl}/doc/doc`, {
        params: {
          query: `${query} sourcelang:english`,
          mode: 'ArtList',
          maxRecords,
          format: 'json',
        },
        timeout: 15000,
      });

      return (data.articles || []).map((a: any, i: number) => ({
        eventId: `gdelt-${Date.now()}-${i}`,
        date: a.seendate || '',
        actor1: null,
        actor2: null,
        eventCode: '',
        eventDescription: a.title || '',
        goldsteinScale: 0,
        avgTone: a.social?.avgTone ? parseFloat(a.social.avgTone) : 0,
        sourceUrl: a.url,
        lat: null,
        lon: null,
        country: null,
      }));
    } catch (err: any) {
      logger.warn({ err: err.message, query }, 'GDELT event search failed');
      return [];
    }
  }

  async searchArticles(query: string, maxRecords = 25): Promise<GdeltArticle[]> {
    try {
      const { data } = await axios.get(`${this.baseUrl}/doc/doc`, {
        params: {
          query: `${query} sourcelang:english`,
          mode: 'ArtList',
          maxRecords,
          format: 'json',
        },
        timeout: 15000,
      });

      return (data.articles || []).map((a: any) => ({
        url: a.url,
        title: a.title || '',
        source: a.source?.name || 'unknown',
        publishedAt: a.seendate || '',
        language: a.language || 'English',
        tone: 0,
        themes: [],
      }));
    } catch (err: any) {
      logger.warn({ err: err.message, query }, 'GDELT article search failed');
      return [];
    }
  }

  async getTimeline(query: string): Promise<{ date: string; count: number; tone: number }[]> {
    try {
      const { data } = await axios.get(`${this.baseUrl}/timeline/tone`, {
        params: { query, format: 'json' },
        timeout: 15000,
      });

      // GDELT timeline response parsing
      const timeline = data.timeline || [];
      return timeline.map((t: any) => ({
        date: t.date || '',
        count: t.count || 0,
        tone: t.avgTone || 0,
      }));
    } catch (err: any) {
      logger.warn({ err: err.message, query }, 'GDELT timeline failed');
      return [];
    }
  }
}

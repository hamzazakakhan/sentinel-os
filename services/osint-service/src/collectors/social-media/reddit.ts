// ──────────────────────────────────────────────────────────────
// sentinel-os/services/osint-service/src/collectors/social-media/reddit.ts
// Reddit OSINT — subreddit monitoring via public JSON API
// ──────────────────────────────────────────────────────────────

import axios from 'axios';
import { pino } from 'pino';

const logger = pino({ name: 'reddit-collector' });

export interface RedditPost {
  id: string;
  subreddit: string;
  title: string;
  author: string;
  selftext: string;
  url: string;
  score: number;
  numComments: number;
  createdUtc: number;
  linkFlairText: string | null;
}

export class RedditCollector {
  private readonly baseUrl = 'https://www.reddit.com';
  private subreddits: string[];

  constructor() {
    const subs = process.env.REDDIT_SUBREDDITS || 'cybersecurity,netsec,hacking,OSINT';
    this.subreddits = subs.split(',').map((s: string) => s.trim());
  }

  async getHotPosts(subreddit: string, limit = 25): Promise<RedditPost[]> {
    try {
      const { data } = await axios.get(`${this.baseUrl}/r/${subreddit}/hot.json`, {
        params: { limit },
        headers: { 'User-Agent': 'sentinel-os/2.0 (research platform)' },
        timeout: 10000,
      });

      return (data.data?.children || []).map((c: any) => this.parsePost(c.data));
    } catch (err: any) {
      logger.warn({ err: err.message, subreddit }, 'Reddit hot posts failed');
      return [];
    }
  }

  async searchPosts(query: string, subreddit?: string, limit = 25): Promise<RedditPost[]> {
    try {
      const path = subreddit ? `/r/${subreddit}/search.json` : '/search.json';
      const { data } = await axios.get(`${this.baseUrl}${path}`, {
        params: { q: query, limit, sort: 'new', restrict_sr: subreddit ? 'on' : 'off' },
        headers: { 'User-Agent': 'sentinel-os/2.0 (research platform)' },
        timeout: 10000,
      });

      return (data.data?.children || []).map((c: any) => this.parsePost(c.data));
    } catch (err: any) {
      logger.warn({ err: err.message, query }, 'Reddit search failed');
      return [];
    }
  }

  async pollAllSubreddits(): Promise<RedditPost[]> {
    const allPosts: RedditPost[] = [];

    for (const sub of this.subreddits) {
      const posts = await this.getHotPosts(sub, 10);
      allPosts.push(...posts);
    }

    logger.info({ count: allPosts.length, subreddits: this.subreddits.length }, 'Reddit poll complete');
    return allPosts;
  }

  private parsePost(d: any): RedditPost {
    return {
      id: d.id,
      subreddit: d.subreddit,
      title: d.title,
      author: d.author || '[deleted]',
      selftext: (d.selftext || '').slice(0, 1000),
      url: `https://reddit.com${d.permalink}`,
      score: d.score || 0,
      numComments: d.num_comments || 0,
      createdUtc: d.created_utc || 0,
      linkFlairText: d.link_flair_text || null,
    };
  }
}

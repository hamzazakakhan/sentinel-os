// ──────────────────────────────────────────────────────────────
// sentinel-os/services/osint-service/src/processors/entity-extraction/extractor.ts
// Named entity recognition for intelligence — IPs, domains, hashes, CVEs, emails
// ──────────────────────────────────────────────────────────────

import { pino } from 'pino';
const logger = pino({ name: 'entity-extractor' });

export interface ExtractedEntity {
  type: 'ip' | 'domain' | 'hash_md5' | 'hash_sha256' | 'cve' | 'email' | 'url' | 'phone' | 'bitcoin_address';
  value: string;
  context: string;
  confidence: number;
  start: number;
  end: number;
}

const PATTERNS: Record<string, { regex: RegExp; type: ExtractedEntity['type']; confidence: number }> = {
  ipv4: { regex: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g, type: 'ip', confidence: 0.95 },
  ipv6: { regex: /(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}/g, type: 'ip', confidence: 0.9 },
  domain: { regex: /\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+(?:[a-zA-Z]{2,6})\b/g, type: 'domain', confidence: 0.8 },
  sha256: { regex: /\b[0-9a-fA-F]{64}\b/g, type: 'hash_sha256', confidence: 0.95 },
  md5: { regex: /\b[0-9a-fA-F]{32}\b/g, type: 'hash_md5', confidence: 0.9 },
  cve: { regex: /CVE-\d{4}-\d{4,7}/gi, type: 'cve', confidence: 0.99 },
  email: { regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, type: 'email', confidence: 0.9 },
  url: { regex: /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi, type: 'url', confidence: 0.85 },
  btc: { regex: /\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/g, type: 'bitcoin_address', confidence: 0.7 },
};

export class EntityExtractor {
  extract(text: string): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];
    const seen = new Set<string>();

    for (const [name, pattern] of Object.entries(PATTERNS)) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        const value = match[0];
        const key = `${pattern.type}:${value}`;
        if (seen.has(key)) continue;
        seen.add(key);

        // Filter false positives
        if (pattern.type === 'domain' && this.isLikelyFalsePositive(value)) continue;
        if (pattern.type === 'hash_md5' && this.isLikelyMD5FalsePositive(value)) continue;

        entities.push({
          type: pattern.type,
          value,
          context: text.substring(Math.max(0, match.index - 40), Math.min(text.length, match.index + value.length + 40)),
          confidence: pattern.confidence,
          start: match.index,
          end: match.index + value.length,
        });
      }
    }

    return entities.sort((a, b) => b.confidence - a.confidence);
  }

  private isLikelyFalsePositive(domain: string): boolean {
    const tlds = ['com', 'org', 'net', 'gov', 'mil', 'io', 'info', 'int'];
    const parts = domain.split('.');
    const tld = parts[parts.length - 1].toLowerCase();
    return !tlds.includes(tld) && tld.length > 6;
  }

  private isLikelyMD5FalsePositive(value: string): boolean {
    return /^[0-9a-f]{32}$/i.test(value) && /^0+$/.test(value);
  }

  extractFromArticle(title: string, body: string): { iocs: ExtractedEntity[]; context: Record<string, string[]> } {
    const allText = `${title}\n${body}`;
    const entities = this.extract(allText);

    const iocs = entities.filter(e => ['ip', 'domain', 'hash_md5', 'hash_sha256', 'cve', 'url', 'email'].includes(e.type));
    const context: Record<string, string[]> = {};
    for (const e of iocs) {
      const key = `${e.type}:${e.value}`;
      if (!context[key]) context[key] = [];
      context[key].push(e.context);
    }

    logger.info({ title: title.substring(0, 50), iocs: iocs.length, total: entities.length }, 'Entities extracted');
    return { iocs, context };
  }
}

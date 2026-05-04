// ──────────────────────────────────────────────────────────────
// sentinel-os/services/osint-service/src/processors/nlp/sentiment.ts
// NLP sentiment + misinformation credibility scoring
// ──────────────────────────────────────────────────────────────

import { pino } from 'pino';
const logger = pino({ name: 'nlp-processor' });

export interface SentimentResult {
  score: number;       // -1.0 to 1.0
  magnitude: number;   // 0.0 to infinity
  label: 'NEGATIVE' | 'NEUTRAL' | 'POSITIVE';
}

export interface CredibilityResult {
  score: number;       // 0.0 to 1.0
  flags: string[];
  recommendation: string;
}

const NEGATIVE_WORDS = new Set(['attack', 'breach', 'malware', 'exploit', 'threat', 'vulnerability', 'hack', 'ransomware', 'phishing', 'compromised', 'critical', 'severe', 'dangerous', 'malicious', 'zero-day', 'apt', 'backdoor', 'trojan', 'botnet', 'ddos', 'injection', 'exfiltration']);
const POSITIVE_WORDS = new Set(['patched', 'resolved', 'secured', 'protected', 'mitigated', 'defended', 'safe', 'update', 'fixed', 'improvement', 'enhanced', 'strengthened']);
const CREDIBILITY_FLAGS: Record<string, string[]> = {
  'sensational': ['breaking', 'shocking', 'unprecedented', 'massive', 'devastating', 'catastrophic', 'worst ever'],
  'unverified': ['rumored', 'unconfirmed', 'alleged', 'possibly', 'might be', 'sources say'],
  'clickbait': ['you won\'t believe', 'must see', 'exposed', 'revealed', 'secret', 'hidden'],
};

export class NLPProcessor {
  analyzeSentiment(text: string): SentimentResult {
    const words = text.toLowerCase().split(/\W+/);
    let posCount = 0, negCount = 0;
    for (const w of words) {
      if (NEGATIVE_WORDS.has(w)) negCount++;
      if (POSITIVE_WORDS.has(w)) posCount++;
    }
    const total = Math.max(posCount + negCount, 1);
    const score = (posCount - negCount) / total;
    const magnitude = (posCount + negCount) / words.length;

    return {
      score: Math.max(-1, Math.min(1, score)),
      magnitude,
      label: score < -0.2 ? 'NEGATIVE' : score > 0.2 ? 'POSITIVE' : 'NEUTRAL',
    };
  }

  assessCredibility(title: string, body: string, source?: string): CredibilityResult {
    const flags: string[] = [];
    const text = `${title} ${body}`.toLowerCase();
    let score = 0.5;

    // Check for sensational language
    for (const [flag, keywords] of Object.entries(CREDIBILITY_FLAGS)) {
      for (const kw of keywords) {
        if (text.includes(kw)) {
          flags.push(flag);
          score -= 0.1;
          break;
        }
      }
    }

    // Source credibility
    const trustedSources = ['cisa.gov', 'nist.gov', 'nvd.nist.gov', 'us-cert.gov', 'sans.org', 'mitre.org'];
    if (source && trustedSources.some(s => source.toLowerCase().includes(s))) {
      score += 0.3;
    }

    // Has technical details (CVEs, hashes, IPs)
    if (/CVE-\d{4}-\d{4,7}/i.test(text)) score += 0.1;
    if (/[0-9a-fA-F]{32,64}/.test(text)) score += 0.1;
    if (/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(text)) score += 0.05;

    // ALL CAPS title (low credibility signal)
    if (title === title.toUpperCase() && title.length > 10) {
      flags.push('all_caps_title');
      score -= 0.15;
    }

    score = Math.max(0, Math.min(1, score));

    return {
      score,
      flags: [...new Set(flags)],
      recommendation: score >= 0.7 ? 'HIGH_CREDIBILITY' : score >= 0.4 ? 'MODERATE_CREDIBILITY' : 'LOW_CREDIBILITY_VERIFY',
    };
  }

  extractKeyPhrases(text: string, maxPhrases: number = 10): string[] {
    const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'and', 'but', 'or', 'not', 'this', 'that', 'it', 'its']);
    const freq: Record<string, number> = {};
    for (const w of words) {
      if (w.length > 3 && !stopWords.has(w)) freq[w] = (freq[w] || 0) + 1;
    }
    return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, maxPhrases).map(([w]) => w);
  }
}

// ──────────────────────────────────────────────────────────────
// sentinel-os/shell/src/panels/PakistanFeed.tsx
// Pakistan Theater Intelligence Feed — live SITREP display
// Connects to ai-service pakistan_theater_feed output
// ──────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback, useRef } from 'react';

interface Brief {
  id: string;
  domain: string;
  timestamp: string;
  classification: string;
  situation: string;
  raw_llm_response: string;
}

interface SigAct {
  timestamp: string;
  type: string;
  location: string;
  description: string;
  source: string;
  reliability: string;
}

const DOMAINS = ['all', 'air', 'land', 'sea', 'cyber'] as const;
type Domain = typeof DOMAINS[number];

const DOMAIN_COLORS: Record<string, string> = {
  AIR: 'text-sentinel-crt', LAND: 'text-sentinel-lime', SEA: 'text-sentinel-gold',
  CYBER: 'text-sentinel-ember', ALL: 'text-purple-400',
};

const TYPE_COLORS: Record<string, string> = {
  MILITARY: 'bg-sentinel-crt/20 text-sentinel-crt',
  TERROR: 'bg-sentinel-ember/20 text-sentinel-ember',
  DIPLO: 'bg-sentinel-gold/20 text-sentinel-gold',
  CYBER: 'bg-red-500/20 text-red-400',
  CIVIL: 'bg-sentinel-lime/20 text-sentinel-lime',
  ECON: 'bg-blue-500/20 text-blue-400',
};

export function PakistanFeed() {
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [sigacts, setSigacts] = useState<SigAct[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeDomain, setActiveDomain] = useState<Domain>('all');
  const [query, setQuery] = useState('');
  const [queryResult, setQueryResult] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchBrief = useCallback(async (domain: Domain) => {
    setLoading(true);
    try {
      const resp = await fetch(`http://localhost:5001/api/intelligence/brief?domain=${domain}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (resp.ok) {
        const data = await resp.json();
        setBriefs(prev => [data, ...prev].slice(0, 20));
      }
    } catch {
      // ai-service not running — show sample data
      setBriefs(prev => [{
        id: 'sim-001',
        domain: domain.toUpperCase(),
        timestamp: new Date().toISOString(),
        classification: 'UNCLASS//FOUO',
        situation: 'Pakistan-Afghanistan Eid ceasefire remains fragile. Sporadic violations along Durand Line reported.',
        raw_llm_response: `SITREP — ${domain.toUpperCase()} DOMAIN\n\n1. SITUATION:\nAs of April 2026, the Pakistan-Afghanistan Eid ceasefire brokered March 18 remains in effect but is extremely fragile. Both sides report sporadic violations along the Durand Line.\n\n2. KEY JUDGMENTS:\n- TTP cross-border operations likely to increase post-ceasefire breakdown\n- BLA CPEC targeting continues in Balochistan\n- CPEC Phase-2 acceleration talks ongoing with China\n\n3. INTEL GAPS:\n- Exact Taliban force disposition near Spin Boldak\n- TTP leadership current location post-Oct 2025 strikes\n\nSOURCE RELIABILITY: B-2 (usually reliable, probably true)`,
      }, ...prev].slice(0, 20));
    }
    setLoading(false);
  }, []);

  const runQuery = useCallback(async () => {
    if (!query.trim()) return;
    try {
      const resp = await fetch('http://localhost:5001/api/intelligence/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: query }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setQueryResult(data.response || data.answer || 'No response');
      }
    } catch {
      setQueryResult('[OFFLINE] ai-service not running — start with: python3 pakistan_theater_feed.py query "your question"');
    }
  }, [query]);

  // Sample SIGACTs
  useEffect(() => {
    setSigacts([
      { timestamp: '2026-04-27T08:30Z', type: 'MILITARY', location: 'Torkham Border', description: '11th Corps reinforced checkpoint following TTP movement. 3 militants killed.', source: 'ISPR', reliability: 'A-1' },
      { timestamp: '2026-04-27T10:15Z', type: 'TERROR', location: 'Quetta, Balochistan', description: 'BLA IED attack on CPEC convoy near Surab. 2 FC injured.', source: 'GDELT', reliability: 'B-2' },
      { timestamp: '2026-04-27T12:00Z', type: 'DIPLO', location: 'Islamabad', description: 'Chinese FM talks on CPEC Phase-2 and Gwadar security.', source: 'Reuters', reliability: 'A-2' },
      { timestamp: '2026-04-27T14:30Z', type: 'CYBER', location: 'Karachi', description: 'APT36 phishing campaign targeting gov email accounts.', source: 'OTX', reliability: 'B-3' },
      { timestamp: '2026-04-27T16:45Z', type: 'MILITARY', location: 'Arabian Sea', description: 'PN PNS Zulfiquar ASW exercise with Chinese PLAN destroyer.', source: 'OSINT', reliability: 'C-3' },
    ]);
  }, []);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="panel-header">
        <span className="panel-icon">◈</span> PAKISTAN THEATER FEED
        <span className="ml-auto flex gap-2">
          {DOMAINS.map(d => (
            <button key={d} className={`px-2 py-0.5 text-[8px] font-mono rounded border transition-colors ${activeDomain === d ? 'border-sentinel-crt text-sentinel-crt bg-sentinel-crt/10' : 'border-sentinel-border text-sentinel-muted'}`}
              onClick={() => { setActiveDomain(d); fetchBrief(d); }}>{d.toUpperCase()}</button>
          ))}
          <button className="btn-crt px-2 py-0.5 text-[8px]" onClick={() => fetchBrief(activeDomain)} disabled={loading}>
            {loading ? '⟳' : 'GEN SITREP'}
          </button>
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-1" ref={scrollRef}>
        {/* Query bar */}
        <div className="flex gap-1 mb-2">
          <input className="flex-1 bg-sentinel-deep border border-sentinel-border rounded px-2 py-1 text-xs font-mono text-sentinel-text placeholder-sentinel-muted"
            placeholder="Intelligence query (e.g. 'TTP threat level')..." value={query}
            onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && runQuery()} />
          <button className="btn-crt px-2 py-1 text-[9px]" onClick={runQuery}>ASK</button>
        </div>

        {queryResult && (
          <div className="code mb-2 text-[10px] whitespace-pre-wrap">{queryResult}</div>
        )}

        {/* SIGACTs */}
        <div className="mb-2">
          <div className="text-[9px] font-mono text-sentinel-muted mb-1 tracking-wider">SIGACTS</div>
          {sigacts.map((sa, i) => (
            <div key={i} className="flex items-start gap-2 py-1 border-b border-sentinel-border/20">
              <span className={`px-1.5 py-0.5 text-[7px] font-mono font-bold rounded ${TYPE_COLORS[sa.type] || 'bg-sentinel-crt/20 text-sentinel-crt'}`}>
                {sa.type}
              </span>
              <div className="flex-1">
                <div className="text-[10px] font-mono text-sentinel-text">{sa.description}</div>
                <div className="flex gap-3 mt-0.5">
                  <span className="text-[8px] font-mono text-sentinel-muted">{sa.location}</span>
                  <span className="text-[8px] font-mono text-sentinel-muted">{sa.source}</span>
                  <span className="text-[8px] font-mono text-sentinel-crt">Rel: {sa.reliability}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Briefs */}
        {briefs.map(b => (
          <div key={b.id} className="border border-sentinel-border rounded mb-2">
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-sentinel-border bg-sentinel-crt/5">
              <span className={`text-[9px] font-mono font-bold ${DOMAIN_COLORS[b.domain] || 'text-sentinel-crt'}`}>
                {b.domain} SITREP
              </span>
              <span className="text-[8px] font-mono text-sentinel-muted">{b.id}</span>
              <span className="text-[8px] font-mono text-sentinel-muted ml-auto">
                {new Date(b.timestamp).toLocaleString()}
              </span>
              <span className="text-[7px] font-mono text-sentinel-gold border border-sentinel-gold/30 rounded px-1">
                {b.classification}
              </span>
            </div>
            <div className="p-3 text-[10px] font-mono text-sentinel-text whitespace-pre-wrap leading-relaxed">
              {b.raw_llm_response}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

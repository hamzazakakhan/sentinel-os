// ──────────────────────────────────────────────────────────────
// sentinel-os/shell/src/panels/OsintBrowser.tsx
// OSINT Browser — aggregated news, GDELT events, social feeds
// Queries osint-service and live APIs for open-source intelligence
// ──────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react';

interface OsintItem {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  domain: string;
  sentiment: string;
}

const GDELT_API = 'https://api.gdeltproject.org/api/v2/doc/doc';
const NEWSAPI_URL = 'https://newsapi.org/v2/everything';

const DOMAINS = [
  { key: 'pakistan', label: 'PAKISTAN', query: 'Pakistan military OR Pakistan security OR CPEC' },
  { key: 'cyber', label: 'CYBER', query: 'cyber attack OR APT OR zero-day OR CVE critical' },
  { key: 'mideast', label: 'MIDEAST', query: 'Middle East conflict OR Iran OR Israel OR Syria' },
  { key: 'maritime', label: 'MARITIME', query: 'maritime security OR piracy OR AIS OR naval' },
];

export function OsintBrowser() {
  const [items, setItems] = useState<OsintItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeDomain, setActiveDomain] = useState('pakistan');
  const [search, setSearch] = useState('');

  const fetchOsint = useCallback(async (domain: string) => {
    setLoading(true);
    const domainConfig = DOMAINS.find(d => d.key === domain) || DOMAINS[0];
    const newItems: OsintItem[] = [];

    // Fetch GDELT
    try {
      const resp = await fetch(`${GDELT_API}?query=${encodeURIComponent(domainConfig.query)}&mode=ArtList&maxrecords=20&format=json&timespan=7d`);
      if (resp.ok) {
        const data = await resp.json();
        for (const a of data.articles || []) {
          newItems.push({
            id: `gdelt-${a.url?.slice(-20) || Math.random()}`,
            title: a.title || 'Untitled',
            source: a.source?.name || a.domain || 'GDELT',
            url: a.url || '#',
            publishedAt: a.seendate || new Date().toISOString(),
            domain: domainConfig.label,
            sentiment: a.sentiment > 0 ? 'POSITIVE' : a.sentiment < 0 ? 'NEGATIVE' : 'NEUTRAL',
          });
        }
      }
    } catch (e) {
      console.warn('GDELT fetch failed:', e);
    }

    // Fetch from osint-service if available
    try {
      const resp = await fetch('http://localhost:4003/api/osint/recent?limit=20');
      if (resp.ok) {
        const data = await resp.json();
        for (const a of data.items || data || []) {
          newItems.push({
            id: a.id || `osint-${Math.random()}`,
            title: a.title || a.headline || 'Untitled',
            source: a.source || 'Sentinel OSINT',
            url: a.url || '#',
            publishedAt: a.publishedAt || a.timestamp || new Date().toISOString(),
            domain: domainConfig.label,
            sentiment: a.sentiment || 'NEUTRAL',
          });
        }
      }
    } catch {
      // osint-service not running
    }

    // Sort by date
    newItems.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
    setItems(newItems);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchOsint(activeDomain);
    const id = setInterval(() => fetchOsint(activeDomain), 60000);
    return () => clearInterval(id);
  }, [activeDomain, fetchOsint]);

  const filtered = items.filter(i =>
    !search || i.title.toLowerCase().includes(search.toLowerCase()) || i.source.toLowerCase().includes(search.toLowerCase())
  );

  const SENT_COLORS: Record<string, string> = {
    POSITIVE: 'text-sentinel-lime', NEGATIVE: 'text-sentinel-ember', NEUTRAL: 'text-sentinel-muted',
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="panel-header">
        <span className="panel-icon">◈</span> OSINT BROWSER
        <span className="ml-auto text-[9px]" style={{ color: 'var(--text2)' }}>{filtered.length} articles</span>
      </div>
      <div className="flex gap-1 px-3 py-2 border-b border-sentinel-border">
        {DOMAINS.map(d => (
          <button key={d.key} className={`px-2 py-1 text-[9px] font-mono rounded border transition-colors ${activeDomain === d.key ? 'border-sentinel-crt text-sentinel-crt bg-sentinel-crt/10' : 'border-sentinel-border text-sentinel-muted'}`}
            onClick={() => setActiveDomain(d.key)}>{d.label}</button>
        ))}
        <input className="flex-1 bg-sentinel-deep border border-sentinel-border rounded px-2 py-1 text-xs font-mono text-sentinel-text placeholder-sentinel-muted ml-2"
          placeholder="Search articles..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {loading ? (
          <div className="text-center py-8 text-xs font-mono text-sentinel-muted">Fetching OSINT feeds...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8 text-xs font-mono text-sentinel-muted">No articles found.</div>
        ) : (
          filtered.slice(0, 50).map(item => (
            <div key={item.id} className="border-b border-sentinel-border/30 py-2 px-1 hover:bg-sentinel-crt/5 cursor-pointer"
              onClick={() => window.open(item.url, '_blank')}>
              <div className="flex items-center gap-2">
                <span className={`text-[8px] font-mono font-bold ${SENT_COLORS[item.sentiment] || 'text-sentinel-muted'}`}>
                  [{item.sentiment}]
                </span>
                <span className="text-[10px] font-mono text-sentinel-text flex-1 truncate">{item.title}</span>
              </div>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-[8px] font-mono text-sentinel-muted">{item.source}</span>
                <span className="text-[8px] font-mono text-sentinel-muted">
                  {new Date(item.publishedAt).toLocaleString()}
                </span>
                <span className="text-[8px] font-mono text-sentinel-crt">{item.domain}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

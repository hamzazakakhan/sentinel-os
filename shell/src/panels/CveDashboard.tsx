// ──────────────────────────────────────────────────────────────
// sentinel-os/shell/src/panels/CveDashboard.tsx
// Live NVD + CISA KEV feed with CVSS filtering
// Fetches from real NVD 2.0 API and CISA feed
// ──────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react';

interface CveItem {
  id: string; description: string; cvssScore: number | null;
  cvssVersion: string; published: string; exploitStatus: string;
  source: string; severity: string;
}

const NVD_API = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const CISA_KEV = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';

export function CveDashboard() {
  const [cves, setCves] = useState<CveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'critical' | 'high' | 'kev'>('all');
  const [search, setSearch] = useState('');

  const fetchNvd = useCallback(async () => {
    try {
      const resp = await fetch(`${NVD_API}?resultsPerPage=40&isKev=true`, {
        headers: { 'Accept': 'application/json' },
      });
      if (!resp.ok) throw new Error('NVD API error');
      const data = await resp.json();
      const items: CveItem[] = (data.vulnerabilities ?? []).map((v: any) => {
        const cve = v.cve;
        const metrics = cve?.metrics?.cvssMetricV31?.[0] ?? cve?.metrics?.cvssMetricV2?.[0];
        const score = metrics?.cvssData?.baseScore ?? null;
        const version = metrics?.cvssData?.version ?? '2.0';
        const desc = cve?.descriptions?.find((d: any) => d.lang === 'en')?.value ?? '';
        const severity = score && score >= 9 ? 'CRITICAL' : score && score >= 7 ? 'HIGH' : score && score >= 4 ? 'MEDIUM' : 'LOW';
        return { id: cve?.id ?? 'N/A', description: desc.slice(0, 120), cvssScore: score, cvssVersion: version, published: cve?.published ?? '', exploitStatus: 'KEV', source: 'NVD', severity };
      });
      return items;
    } catch (e) {
      console.warn('NVD fetch failed:', e);
      return [];
    }
  }, []);

  const fetchCisa = useCallback(async () => {
    try {
      const resp = await fetch(CISA_KEV);
      if (!resp.ok) throw new Error('CISA KEV error');
      const data = await resp.json();
      const items: CveItem[] = (data.vulnerabilities ?? []).slice(0, 40).map((v: any) => ({
        id: v.cveID, description: v.vulnerabilityName?.slice(0, 120) ?? '',
        cvssScore: null, cvssVersion: '-', published: v.dateAdded ?? '',
        exploitStatus: 'EXPLOITED', source: 'CISA KEV',
        severity: v.cveID?.includes('-2024') ? 'HIGH' : 'MEDIUM',
      }));
      return items;
    } catch (e) {
      console.warn('CISA KEV fetch failed:', e);
      return [];
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [nvd, cisa] = await Promise.all([fetchNvd(), fetchCisa()]);
      const merged = [...nvd, ...cisa].sort((a, b) => (b.cvssScore ?? 0) - (a.cvssScore ?? 0));
      setCves(merged);
      setLoading(false);
    })();
  }, [fetchNvd, fetchCisa]);

  const filtered = cves.filter(c => {
    if (filter === 'critical') return c.cvssScore != null && c.cvssScore >= 9;
    if (filter === 'high') return c.cvssScore != null && c.cvssScore >= 7;
    if (filter === 'kev') return c.exploitStatus === 'EXPLOITED' || c.exploitStatus === 'KEV';
    return true;
  }).filter(c => !search || c.id.toLowerCase().includes(search.toLowerCase()) || c.description.toLowerCase().includes(search.toLowerCase()));

  const SEV_CLASS: Record<string, string> = { CRITICAL: 'br', HIGH: 'be', MEDIUM: 'bd', LOW: 'bg' };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="panel-header">
        <span className="panel-icon">◈</span> CVE DASHBOARD — NVD + CISA KEV
        <span className="ml-auto text-[9px]" style={{ color: 'var(--text2)' }}>{filtered.length} CVEs</span>
      </div>
      <div className="flex gap-2 px-3 py-2 border-b border-sentinel-border">
        <input className="flex-1 bg-sentinel-deep border border-sentinel-border rounded px-2 py-1 text-xs font-mono text-sentinel-text placeholder-sentinel-muted"
          placeholder="Search CVE ID or description..." value={search} onChange={e => setSearch(e.target.value)} />
        {(['all', 'critical', 'high', 'kev'] as const).map(f => (
          <button key={f} className={`px-2 py-1 text-[9px] font-mono rounded border transition-colors ${filter === f ? 'border-sentinel-crt text-sentinel-crt bg-sentinel-crt/10' : 'border-sentinel-border text-sentinel-muted'}`}
            onClick={() => setFilter(f)}>{f.toUpperCase()}</button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {loading ? (
          <div className="text-center py-8 text-xs font-mono text-sentinel-muted">Fetching NVD + CISA feeds...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8 text-xs font-mono text-sentinel-muted">No CVEs match filter.</div>
        ) : (
          <table className="w-full text-[10px] font-mono">
            <thead><tr className="text-sentinel-muted border-b border-sentinel-border">
              <th className="text-left py-1 px-1">CVE ID</th><th className="text-left py-1 px-1">CVSS</th>
              <th className="text-left py-1 px-1">SEV</th><th className="text-left py-1 px-1">Description</th>
              <th className="text-left py-1 px-1">Source</th>
            </tr></thead>
            <tbody>
              {filtered.slice(0, 50).map(c => (
                <tr key={c.id} className="border-b border-sentinel-border/30 hover:bg-sentinel-crt/5">
                  <td className="py-1 px-1 text-sentinel-crt">{c.id}</td>
                  <td className="py-1 px-1">{c.cvssScore != null ? c.cvssScore.toFixed(1) : '-'}</td>
                  <td className="py-1 px-1"><span className={SEV_CLASS[c.severity] || 'bc'}>{c.severity}</span></td>
                  <td className="py-1 px-1 text-sentinel-text truncate max-w-[200px]">{c.description}</td>
                  <td className="py-1 px-1 text-sentinel-muted">{c.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

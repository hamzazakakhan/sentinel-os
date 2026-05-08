// Threat Intel panel — live IoCs + MITRE ATT&CK matrix view
import { useEffect, useState } from 'react';

const TI_API = (typeof window !== 'undefined' && (window as any).SENTINEL_TI_API)
  || 'http://localhost:8091';

interface Indicator {
  id: string; type: string; value: string; source: string;
  confidence: number; severity: string; tags: string[];
  description?: string; first_seen: string; last_seen: string;
}
interface Technique {
  id: string; name: string; tactic: string;
  description?: string; platforms?: string[]; url?: string;
}

const SEV_COLOR: Record<string, string> = {
  critical: '#ff3344', high: '#ff8c33', medium: '#ffd23f', low: '#7dd87f',
};
const TYPE_LABEL: Record<string, string> = {
  ipv4: 'IPv4', ipv6: 'IPv6', domain: 'DOMAIN', url: 'URL',
  'hash-md5': 'MD5', 'hash-sha1': 'SHA1', 'hash-sha256': 'SHA256',
  email: 'EMAIL', cve: 'CVE', 'mitre-technique': 'TTP',
};

const TACTIC_ORDER = [
  'reconnaissance','resource-development','initial-access','execution',
  'persistence','privilege-escalation','defense-evasion','credential-access',
  'discovery','lateral-movement','collection','command-and-control',
  'exfiltration','impact',
];

export function ThreatIntel() {
  const [tab, setTab] = useState<'iocs'|'attack'>('iocs');
  const [iocs, setIocs] = useState<Indicator[]>([]);
  const [techniques, setTechniques] = useState<Technique[]>([]);
  const [filter, setFilter] = useState({ type: '', severity: '' });
  const [selected, setSelected] = useState<Technique | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== 'iocs') return;
    setLoading(true); setError(null);
    const params = new URLSearchParams();
    if (filter.type) params.set('type', filter.type);
    if (filter.severity) params.set('severity', filter.severity);
    params.set('limit', '200');
    fetch(`${TI_API}/indicators?${params}`)
      .then((r) => r.json())
      .then((d) => setIocs(d.indicators ?? []))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [tab, filter]);

  useEffect(() => {
    if (tab !== 'attack') return;
    setLoading(true); setError(null);
    fetch(`${TI_API}/mitre/techniques`)
      .then((r) => r.json())
      .then((d) => setTechniques(d.techniques ?? []))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [tab]);

  const triggerIngest = () => {
    fetch(`${TI_API}/ingest/now`, { method: 'POST' })
      .then(() => setTimeout(() => setFilter({ ...filter }), 5000));
  };

  const byTactic: Record<string, Technique[]> = {};
  for (const t of techniques) {
    const key = t.tactic ?? 'other';
    (byTactic[key] = byTactic[key] ?? []).push(t);
  }

  return (
    <div className="flex flex-col h-full bg-sentinel-void text-sentinel-text font-mono text-[11px]">
      <div className="px-2 py-1 border-b border-sentinel-rust/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sentinel-amber font-bold">THREAT INTEL</span>
          <button className={`px-2 py-0.5 ${tab==='iocs' ? 'bg-sentinel-rust/40 text-sentinel-amber' : 'text-sentinel-muted'}`} onClick={() => setTab('iocs')}>IoCs</button>
          <button className={`px-2 py-0.5 ${tab==='attack' ? 'bg-sentinel-rust/40 text-sentinel-amber' : 'text-sentinel-muted'}`} onClick={() => setTab('attack')}>MITRE ATT&amp;CK</button>
        </div>
        <button className="px-2 py-0.5 bg-sentinel-rust/20 text-sentinel-amber" onClick={triggerIngest}>↻ INGEST NOW</button>
      </div>

      {tab === 'iocs' && (
        <>
          <div className="px-2 py-1 border-b border-sentinel-rust/20 flex items-center gap-2">
            <select value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })} className="bg-sentinel-void border border-sentinel-rust/30 px-1 py-0.5">
              <option value="">ALL TYPES</option>
              {Object.keys(TYPE_LABEL).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
            <select value={filter.severity} onChange={(e) => setFilter({ ...filter, severity: e.target.value })} className="bg-sentinel-void border border-sentinel-rust/30 px-1 py-0.5">
              <option value="">ALL SEV</option>
              <option value="critical">CRITICAL</option>
              <option value="high">HIGH</option>
              <option value="medium">MEDIUM</option>
              <option value="low">LOW</option>
            </select>
            <span className="text-sentinel-muted ml-auto">{iocs.length} indicators</span>
          </div>
          <div className="flex-1 overflow-auto">
            {loading && <div className="p-2 text-sentinel-muted">Loading…</div>}
            {error && <div className="p-2 text-sentinel-blood">Error: {error}</div>}
            <table className="w-full text-[10px]">
              <thead className="sticky top-0 bg-sentinel-void">
                <tr className="text-sentinel-muted border-b border-sentinel-rust/30">
                  <th className="text-left px-2 py-1">SEV</th>
                  <th className="text-left px-1 py-1">TYPE</th>
                  <th className="text-left px-1 py-1">VALUE</th>
                  <th className="text-left px-1 py-1">SOURCE</th>
                  <th className="text-right px-1 py-1">CONF</th>
                  <th className="text-left px-1 py-1">TAGS</th>
                  <th className="text-left px-1 py-1">LAST SEEN</th>
                </tr>
              </thead>
              <tbody>
                {iocs.map((i) => (
                  <tr key={i.id} className="border-b border-sentinel-rust/10 hover:bg-sentinel-rust/10">
                    <td className="px-2 py-1"><span style={{ color: SEV_COLOR[i.severity] }}>●</span> <span style={{ color: SEV_COLOR[i.severity] }}>{i.severity.toUpperCase()}</span></td>
                    <td className="px-1 py-1 text-sentinel-amber">{TYPE_LABEL[i.type] ?? i.type}</td>
                    <td className="px-1 py-1 truncate max-w-xs" title={i.value}>{i.value}</td>
                    <td className="px-1 py-1 text-sentinel-muted">{i.source}</td>
                    <td className="px-1 py-1 text-right">{i.confidence}%</td>
                    <td className="px-1 py-1 text-sentinel-muted truncate max-w-[200px]">{(i.tags ?? []).slice(0,3).join(', ')}</td>
                    <td className="px-1 py-1 text-sentinel-muted">{new Date(i.last_seen).toISOString().slice(0,16).replace('T',' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'attack' && (
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-auto p-2">
            <div className="grid grid-cols-7 gap-1">
              {TACTIC_ORDER.map((tac) => (
                <div key={tac} className="flex flex-col">
                  <div className="text-sentinel-amber text-[9px] uppercase mb-1 truncate" title={tac}>{tac.replace(/-/g,' ')}</div>
                  <div className="flex flex-col gap-0.5">
                    {(byTactic[tac] ?? []).slice(0, 30).map((t) => (
                      <button key={t.id} onClick={() => setSelected(t)}
                        className={`text-left px-1 py-0.5 text-[9px] truncate border-l-2
                          ${selected?.id === t.id ? 'bg-sentinel-rust/40 border-sentinel-amber' : 'border-sentinel-rust/30 hover:bg-sentinel-rust/10'}`}
                        title={t.name}>
                        <span className="text-sentinel-muted">{t.id}</span> {t.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {selected && (
            <div className="w-80 border-l border-sentinel-rust/30 p-2 overflow-auto bg-sentinel-void/80">
              <div className="text-sentinel-amber font-bold mb-1">{selected.id} — {selected.name}</div>
              <div className="text-sentinel-muted text-[10px] mb-2">Tactic: {selected.tactic}</div>
              {selected.description && (
                <div className="text-[10px] whitespace-pre-wrap mb-2">{selected.description.slice(0, 800)}…</div>
              )}
              {selected.platforms?.length ? (
                <div className="text-[10px] text-sentinel-muted">Platforms: {selected.platforms.join(', ')}</div>
              ) : null}
              {selected.url && <a href={selected.url} target="_blank" rel="noreferrer" className="text-[10px] text-sentinel-amber underline">View on attack.mitre.org →</a>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

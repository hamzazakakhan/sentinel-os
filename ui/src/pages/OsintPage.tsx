import { useState, useMemo } from 'react';
import { useQuery } from '@apollo/client';
import { Globe, Rss, Search, ExternalLink } from 'lucide-react';
import { GET_OSINT_FEEDS, GET_OSINT_ITEMS } from '../graphql/queries';

const seedFeeds = [
  { id: 'cve-feed', name: 'NVD CVE Feed', type: 'API', status: 'ACTIVE', lastFetch: '2 min ago', itemCount: 1247 },
  { id: 'abuse-ipdb', name: 'AbuseIPDB', type: 'API', status: 'ACTIVE', lastFetch: '15 min ago', itemCount: 892 },
  { id: 'alienvault', name: 'AlienVault OTX', type: 'API', status: 'ACTIVE', lastFetch: '8 min ago', itemCount: 2341 },
  { id: 'threatfox', name: 'ThreatFox IOCs', type: 'API', status: 'ACTIVE', lastFetch: '5 min ago', itemCount: 5678 },
  { id: 'feodo', name: 'Feodo Tracker', type: 'API', status: 'PAUSED', lastFetch: '2h ago', itemCount: 342 },
  { id: 'mitre-att', name: 'MITRE ATT&CK Feed', type: 'API', status: 'ACTIVE', lastFetch: '1h ago', itemCount: 1563 },
  { id: 'virustotal', name: 'VirusTotal Retro Hunt', type: 'API', status: 'ACTIVE', lastFetch: '30 min ago', itemCount: 412 },
];

const seedRecentItems = [
  { id: 'osint-001', title: 'APT29 campaign targeting NATO defense contractors via spear-phishing', feed: 'AlienVault OTX', indicators: 14, ingestedAt: new Date(Date.now() - 120000).toISOString() },
  { id: 'osint-002', title: 'CVE-2024-3094: Critical backdoor in xz-utils (liblzma)', feed: 'NVD CVE Feed', indicators: 3, ingestedAt: new Date(Date.now() - 360000).toISOString() },
  { id: 'osint-003', title: 'Lazarus Group deploys new DTrack variant against energy infrastructure', feed: 'ThreatFox IOCs', indicators: 22, ingestedAt: new Date(Date.now() - 600000).toISOString() },
  { id: 'osint-004', title: 'Volt Typhoon living-off-the-land techniques in critical infrastructure', feed: 'MITRE ATT&CK Feed', indicators: 8, ingestedAt: new Date(Date.now() - 900000).toISOString() },
  { id: 'osint-005', title: 'Sandworm targets Ukrainian power grid with Industroyer2', feed: 'AlienVault OTX', indicators: 17, ingestedAt: new Date(Date.now() - 1200000).toISOString() },
  { id: 'osint-006', title: 'New Emotet variant spreading via macro-enabled documents', feed: 'VirusTotal Retro Hunt', indicators: 6, ingestedAt: new Date(Date.now() - 1800000).toISOString() },
  { id: 'osint-007', title: 'Turla Group C2 infrastructure identified across 12 countries', feed: 'AbuseIPDB', indicators: 31, ingestedAt: new Date(Date.now() - 2400000).toISOString() },
  { id: 'osint-008', title: 'Ransomware-as-a-Service: LockBit 4.0 affiliate program analysis', feed: 'ThreatFox IOCs', indicators: 9, ingestedAt: new Date(Date.now() - 3000000).toISOString() },
  { id: 'osint-009', title: 'Iranian APT42 credential harvesting campaign targeting think tanks', feed: 'AlienVault OTX', indicators: 11, ingestedAt: new Date(Date.now() - 3600000).toISOString() },
  { id: 'osint-010', title: 'Feodo Tracker: 47 new Dridex C2 servers identified', feed: 'Feodo Tracker', indicators: 47, ingestedAt: new Date(Date.now() - 4200000).toISOString() },
];

export function OsintPage() {
  const [search, setSearch] = useState('');
  const { data: feedsData } = useQuery(GET_OSINT_FEEDS, { pollInterval: 60000, errorPolicy: 'all' });
  const { data: itemsData } = useQuery(GET_OSINT_ITEMS, { variables: { pagination: { first: 50 } }, pollInterval: 30000, errorPolicy: 'all' });

  const feeds = useMemo(() => {
    const api = feedsData?.osintFeeds || [];
    return api.length > 0 ? api : seedFeeds;
  }, [feedsData]);

  const recentItems = useMemo(() => {
    const edges = itemsData?.osintItems?.edges || [];
    const apiItems = edges.map((e: any) => {
      const node = e.node;
      const rawText = typeof node.content === 'string' ? node.content : (node.content?.text || node.content?.title || '');
      const title = rawText.length > 120 ? rawText.slice(0, 120) + '…' : rawText || node.sourceName || 'Untitled';
      const iocPatterns = rawText.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b|CVE-\d{4}-\d+|[a-f0-9]{32,64}\b|[a-zA-Z0-9.-]+\[?\.\]?(?:com|net|org|io|ru|cn)\b/gi);
      return {
        id: node.id,
        title,
        feed: (node.sourceName || node.sourceType || 'Unknown').replace(/^AI-/, ''),
        indicators: iocPatterns ? iocPatterns.length : 0,
        ingestedAt: node.collectedAt || node.publishedAt,
      };
    });
    const items = apiItems.length > 0 ? apiItems : seedRecentItems;
    if (!search) return items;
    return items.filter((item: any) => item.title.toLowerCase().includes(search.toLowerCase()));
  }, [itemsData, search]);
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Globe className="w-6 h-6 text-sentinel-400" />
          OSINT
        </h1>
        <div className="relative">
          <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search OSINT items..."
            className="bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-4 py-1.5 text-sm text-gray-300 w-72 focus:outline-none focus:ring-1 focus:ring-sentinel-500"
            value={search}
            onChange={(e: any) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="glass-panel p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
            <Rss className="w-4 h-4 text-sentinel-400" /> Active Feeds
          </h3>
          <div className="space-y-3">
            {feeds.map((feed: any) => (
              <div key={feed.id} className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
                <div>
                  <span className="text-sm text-white">{feed.name}</span>
                  <div className="text-xs text-gray-500 mt-0.5">{feed.type} · {feed.lastFetch || 'N/A'}</div>
                </div>
                <div className="text-right">
                  <span className={`text-[10px] font-bold ${feed.status === 'ACTIVE' ? 'text-green-400' : 'text-yellow-400'}`}>
                    {feed.status}
                  </span>
                  <div className="text-xs text-gray-500">{feed.itemCount || feed.items || 0} items</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-2 glass-panel p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Recent Items</h3>
          <div className="space-y-2">
            {recentItems.map((item: any) => (
              <div key={item.id} className="flex items-center justify-between p-3 rounded-lg bg-gray-800/50 hover:bg-gray-800 transition-colors cursor-pointer">
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm text-white truncate">{item.title}</h4>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                    <span>{item.feed || item.feedName || 'Unknown'}</span>
                    <span>{item.indicators || 0} IOCs</span>
                    <span>{item.ingestedAt ? new Date(item.ingestedAt).toLocaleTimeString() : '-'}</span>
                  </div>
                </div>
                <ExternalLink className="w-4 h-4 text-gray-600 flex-shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

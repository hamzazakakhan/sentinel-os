import { useMemo } from 'react';
import { useQuery } from '@apollo/client';
import { Shield, AlertTriangle, Globe, Server } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { GET_CYBER_EVENTS, GET_THREAT_INDICATORS } from '../graphql/queries';

const seedCyberTimeline = Array.from({ length: 24 }, (_, i) => ({
  hour: `${String(i).padStart(2, '0')}:00`,
  ids: [87,124,95,142,203,178,156,189,167,134,112,198,245,213,178,156,134,167,189,201,178,145,112,98][i],
  blocked: [12,34,18,45,67,52,38,61,49,27,19,58,72,63,48,37,29,44,56,68,51,35,21,14][i],
  iocMatches: [3,7,2,9,12,8,5,11,7,4,2,10,14,9,6,4,3,8,11,13,7,5,3,1][i],
}));

const seedTopSources = [
  { ip: '185.220.101.34', events: 1247, country: 'RU', threat: 'CRITICAL', eventType: 'BRUTE_FORCE' },
  { ip: '45.155.205.189', events: 892, country: 'NL', threat: 'HIGH', eventType: 'PORT_SCAN' },
  { ip: '192.241.235.101', events: 634, country: 'US', threat: 'MEDIUM', eventType: 'SQL_INJECTION' },
  { ip: '103.75.190.42', events: 521, country: 'IN', threat: 'HIGH', eventType: 'C2_BEACON' },
  { ip: '91.219.236.174', events: 412, country: 'UA', threat: 'MEDIUM', eventType: 'DATA_EXFIL' },
  { ip: '198.51.100.77', events: 389, country: 'CN', threat: 'CRITICAL', eventType: 'MALWARE_DOWNLOAD' },
  { ip: '203.0.113.45', events: 276, country: 'IR', threat: 'HIGH', eventType: 'DNS_TUNNEL' },
];

const seedCyberStats = { totalEvents: 12431, idsAlerts: 347, iocMatches: 89, blocked: 1203 };

const THREAT_COLORS: Record<string, string> = {
  CRITICAL: 'text-red-400',
  HIGH: 'text-orange-400',
  MEDIUM: 'text-yellow-400',
  LOW: 'text-green-400',
};

export function CyberPage() {
  const { data: cyberData } = useQuery(GET_CYBER_EVENTS, { variables: { pagination: { first: 500 } }, pollInterval: 30000, errorPolicy: 'all' });
  const { data: threatData } = useQuery(GET_THREAT_INDICATORS, { variables: { pagination: { first: 20 } }, pollInterval: 60000, errorPolicy: 'all' });

  const cyberTimeline = useMemo(() => {
    const edges = cyberData?.cyberEvents?.edges || [];
    if (!edges.length) return seedCyberTimeline;
    const events = edges.map((e: any) => e.node);
    const hourMap: Record<string, { ids: number; blocked: number; iocMatches: number }> = {};
    for (let h = 0; h < 24; h++) {
      const key = `${String(h).padStart(2, '0')}:00`;
      hourMap[key] = { ids: 0, blocked: 0, iocMatches: 0 };
    }
    events.forEach((e: any) => {
      const h = `${String(new Date(e.detectedAt).getHours()).padStart(2, '0')}:00`;
      if (hourMap[h]) {
        hourMap[h].ids++;
        if (e.blocked) hourMap[h].blocked++;
        if (e.iocMatch) hourMap[h].iocMatches++;
      }
    });
    return Object.entries(hourMap).map(([hour, v]) => ({ hour, ...v }));
  }, [cyberData]);

  const topSources = useMemo(() => {
    const indicators = threatData?.threatIndicators || [];
    if (!indicators.length) return seedTopSources;
    return indicators.slice(0, 7).map((t: any) => ({
      ip: t.value || t.indicator,
      events: t.hitCount || 0,
      country: t.sourceFeed?.substring(0, 2).toUpperCase() || '??',
      threat: t.severity || 'MEDIUM',
      eventType: t.indicatorType || 'UNKNOWN',
    }));
  }, [threatData]);

  const stats = useMemo(() => {
    const edges2 = cyberData?.cyberEvents?.edges || [];
    if (!edges2.length) return seedCyberStats;
    const events = edges2.map((e: any) => e.node);
    return {
      totalEvents: events.length,
      idsAlerts: events.filter((e: any) => e.severity === 'HIGH' || e.severity === 'CRITICAL').length,
      iocMatches: events.filter((e: any) => e.iocMatch).length,
      blocked: events.filter((e: any) => e.blocked).length,
    };
  }, [cyberData]);

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-bold text-white flex items-center gap-2">
        <Shield className="w-6 h-6 text-sentinel-400" />
        Cyber Operations
      </h1>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Events (24h)', value: stats.totalEvents.toLocaleString(), icon: Server, color: 'text-blue-400' },
          { label: 'IDS Alerts', value: stats.idsAlerts.toLocaleString(), icon: AlertTriangle, color: 'text-red-400' },
          { label: 'IOC Matches', value: stats.iocMatches.toLocaleString(), icon: Globe, color: 'text-purple-400' },
          { label: 'Blocked', value: stats.blocked.toLocaleString(), icon: Shield, color: 'text-green-400' },
        ].map((stat) => (
          <div key={stat.label} className="stat-card">
            <span className="text-xs text-gray-500">{stat.label}</span>
            <span className="text-xl font-bold text-white">{stat.value}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 glass-panel p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Network Events Timeline</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={cyberTimeline}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="hour" tick={{ fill: '#6b7280', fontSize: 10 }} interval={3} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} />
              <Tooltip contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px' }} />
              <Bar dataKey="ids" fill="#3b82f6" radius={[2, 2, 0, 0]} name="IDS Events" />
              <Bar dataKey="blocked" fill="#ef4444" radius={[2, 2, 0, 0]} name="Blocked" />
              <Bar dataKey="iocMatches" fill="#a855f7" radius={[2, 2, 0, 0]} name="IOC Matches" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="glass-panel p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Top Threat Sources</h3>
          <div className="space-y-3">
            {topSources.map((src: any) => (
              <div key={src.ip} className="flex items-center justify-between text-sm">
                <div>
                  <span className="text-white font-mono text-xs">{src.ip}</span>
                  <span className="text-gray-600 text-xs ml-2">({src.country})</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 text-xs">{src.events}</span>
                  <span className={`text-[10px] font-bold ${THREAT_COLORS[src.threat]}`}>{src.threat}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

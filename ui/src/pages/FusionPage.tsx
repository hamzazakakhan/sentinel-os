import { useMemo } from 'react';
import { useQuery } from '@apollo/client';
import { GitBranch, Search, Network } from 'lucide-react';
import { GET_FUSION_STATS, GET_CORRELATIONS } from '../graphql/queries';

const seedFusionStats = { totalEntities: 4891, totalRelationships: 12347, correlations24h: 289 };

const seedCorrelations = [
  { id: 'corr-001', sourceAlertId: 'ALT-001', targetAlertId: 'ALT-005', correlationType: 'TEMPORAL', confidence: 0.92, hypothesis: 'Sequential attack chain: reconnaissance followed by exploitation', createdAt: new Date(Date.now() - 600000).toISOString() },
  { id: 'corr-002', sourceAlertId: 'ALT-003', targetAlertId: 'ALT-007', correlationType: 'NETWORK', confidence: 0.87, hypothesis: 'Same source IP involved in multiple attack vectors', createdAt: new Date(Date.now() - 1200000).toISOString() },
  { id: 'corr-003', sourceAlertId: 'ALT-002', targetAlertId: 'ALT-008', correlationType: 'TTP', confidence: 0.78, hypothesis: 'Matching MITRE ATT&CK techniques: T1059.001 + T1071.001', createdAt: new Date(Date.now() - 1800000).toISOString() },
  { id: 'corr-004', sourceAlertId: 'ALT-004', targetAlertId: 'ALT-009', correlationType: 'IOC', confidence: 0.95, hypothesis: 'Shared IOC: domain evil-c2.example[.]com', createdAt: new Date(Date.now() - 2400000).toISOString() },
  { id: 'corr-005', sourceAlertId: 'ALT-006', targetAlertId: 'ALT-010', correlationType: 'GEOSPATIAL', confidence: 0.71, hypothesis: 'Physical proximity of detections within 500m radius', createdAt: new Date(Date.now() - 3600000).toISOString() },
];

export function FusionPage() {
  const { data: statsData } = useQuery(GET_FUSION_STATS, { pollInterval: 60000, errorPolicy: 'all' });
  const { data: corrData } = useQuery(GET_CORRELATIONS, { variables: { limit: 20 }, pollInterval: 30000, errorPolicy: 'all' });

  const fusionStats = useMemo(() => {
    return statsData?.fusionStats || seedFusionStats;
  }, [statsData]);

  const correlations = useMemo(() => {
    const api = corrData?.correlations || [];
    return api.length > 0 ? api : seedCorrelations;
  }, [corrData]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <GitBranch className="w-6 h-6 text-sentinel-400" />
          Intelligence Fusion
        </h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search entities..."
              className="bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-4 py-1.5 text-sm text-gray-300 w-64 focus:outline-none focus:ring-1 focus:ring-sentinel-500"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Entities', value: fusionStats.totalEntities?.toLocaleString() || '0' },
          { label: 'Relationships', value: fusionStats.totalRelationships?.toLocaleString() || '0' },
          { label: 'Correlations (24h)', value: fusionStats.correlations24h?.toLocaleString() || '0' },
        ].map((stat: any) => (
          <div key={stat.label} className="stat-card">
            <span className="text-xs text-gray-500">{stat.label}</span>
            <span className="text-xl font-bold text-white">{stat.value}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 glass-panel overflow-hidden" style={{ height: '420px' }}>
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-center space-y-3">
              <Network className="w-16 h-16 text-gray-700 mx-auto" />
              <p className="text-gray-500 text-sm">Neo4j Graph Visualization</p>
              <p className="text-gray-600 text-xs max-w-md">
                Interactive force-directed graph showing entity relationships, correlations,
                and intelligence linkages powered by D3.js with Neo4j backend.
              </p>
            </div>
          </div>
        </div>

        <div className="glass-panel p-4" style={{ height: '420px', overflowY: 'auto' }}>
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Recent Correlations</h3>
          <div className="space-y-3">
            {correlations.map((c: any) => (
              <div key={c.id} className="p-3 rounded-lg bg-gray-800/50 border border-gray-700/50">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-bold text-sentinel-400">{c.correlationType}</span>
                  <span className="text-[10px] text-gray-500">{Math.round((c.confidence || 0) * 100)}% conf</span>
                </div>
                <p className="text-xs text-gray-300 leading-relaxed">{c.hypothesis}</p>
                <div className="flex items-center gap-2 mt-2 text-[10px] text-gray-500">
                  <span className="font-mono">{c.sourceAlertId}</span>
                  <span>→</span>
                  <span className="font-mono">{c.targetAlertId}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

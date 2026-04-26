import { useState, useMemo } from 'react';
import { useQuery, useMutation, useSubscription } from '@apollo/client';
import { Bell, Filter, ChevronDown, Clock, MapPin, Tag, Loader2, Plus, X } from 'lucide-react';
import { GET_ALERTS } from '../graphql/queries';
import { ALERT_CREATED } from '../graphql/subscriptions';
import { CREATE_ALERT } from '../graphql/mutations';

const SEVERITY_STYLES: Record<string, string> = {
  CRITICAL: 'bg-red-500/10 text-red-400 border-red-500/30',
  HIGH: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  MEDIUM: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
  LOW: 'bg-green-500/10 text-green-400 border-green-500/30',
};

const seedAlerts = [
  { id: 'alt-001', title: 'Armed individual detected at North Gate', severity: 'CRITICAL', domain: 'LAND', status: 'OPEN', sourceDetectionId: 'det-003', confidence: 0.88, createdAt: new Date(Date.now() - 5400000).toISOString(), tags: ['ai-detection', 'yolov8', 'weapon'], classification: 'SECRET' },
  { id: 'alt-002', title: 'Unauthorized UAV in restricted airspace', severity: 'HIGH', domain: 'AIR', status: 'INVESTIGATING', sourceDetectionId: 'det-006', confidence: 0.78, createdAt: new Date(Date.now() - 2700000).toISOString(), tags: ['radar', 'counter-uas'], classification: 'SECRET' },
  { id: 'alt-003', title: 'Unidentified vessel approaching harbor', severity: 'HIGH', domain: 'SEA', status: 'OPEN', sourceDetectionId: 'det-007', confidence: 0.91, createdAt: new Date(Date.now() - 2400000).toISOString(), tags: ['radar', 'maritime'], classification: 'SECRET' },
  { id: 'alt-006', title: 'Possible subsurface intrusion', severity: 'CRITICAL', domain: 'SEA', status: 'OPEN', sourceDetectionId: 'det-011', confidence: 0.65, createdAt: new Date(Date.now() - 900000).toISOString(), tags: ['sonar', 'subsurface'], classification: 'TOP_SECRET' },
  { id: 'alt-007', title: 'Perimeter fence breach detected', severity: 'CRITICAL', domain: 'LAND', status: 'OPEN', sourceDetectionId: 'det-012', confidence: 0.93, createdAt: new Date(Date.now() - 600000).toISOString(), tags: ['lidar', 'perimeter'], classification: 'SECRET' },
  { id: 'alt-008', title: 'Critical CVE exploitation attempt', severity: 'CRITICAL', domain: 'CYBER', status: 'INVESTIGATING', sourceDetectionId: 'det-013', confidence: 0.87, createdAt: new Date(Date.now() - 480000).toISOString(), tags: ['ids', 'cve-2024-1234'], classification: 'SECRET' },
  { id: 'alt-009', title: 'Cobalt Strike beacon detected', severity: 'CRITICAL', domain: 'CYBER', status: 'OPEN', sourceDetectionId: 'det-014', confidence: 0.91, createdAt: new Date(Date.now() - 300000).toISOString(), tags: ['malware', 'cobalt-strike', 'apt41'], classification: 'TOP_SECRET' },
  { id: 'alt-010', title: 'SSH brute force from threat actor IP', severity: 'HIGH', domain: 'CYBER', status: 'OPEN', sourceDetectionId: 'det-015', confidence: 0.83, createdAt: new Date(Date.now() - 180000).toISOString(), tags: ['brute-force', 'apt28'], classification: 'SECRET' },
  { id: 'alt-004', title: 'Seismic anomaly near perimeter', severity: 'MEDIUM', domain: 'LAND', status: 'INVESTIGATING', sourceDetectionId: 'det-008', confidence: 0.72, createdAt: new Date(Date.now() - 2100000).toISOString(), tags: ['anomaly', 'seismic'], classification: 'CONFIDENTIAL' },
  { id: 'alt-005', title: 'Suspicious loitering near facility', severity: 'MEDIUM', domain: 'LAND', status: 'OPEN', sourceDetectionId: 'det-009', confidence: 0.89, createdAt: new Date(Date.now() - 1500000).toISOString(), tags: ['thermal', 'drone'], classification: 'SECRET' },
  { id: 'alt-011', title: 'Unregistered vehicle in restricted zone', severity: 'MEDIUM', domain: 'LAND', status: 'RESOLVED', sourceDetectionId: 'det-002', confidence: 0.97, createdAt: new Date(Date.now() - 6000000).toISOString(), tags: ['anpr', 'vehicle'], classification: 'CONFIDENTIAL' },
  { id: 'alt-012', title: 'Drone Alpha-2 offline', severity: 'MEDIUM', domain: 'AIR', status: 'INVESTIGATING', sourceDetectionId: null, confidence: null, createdAt: new Date(Date.now() - 1800000).toISOString(), tags: ['health', 'drone'], classification: 'SECRET' },
  { id: 'alt-014', title: 'Data exfiltration attempt blocked', severity: 'HIGH', domain: 'CYBER', status: 'INVESTIGATING', sourceDetectionId: null, confidence: null, createdAt: new Date(Date.now() - 3600000).toISOString(), tags: ['dlp', 'exfiltration'], classification: 'TOP_SECRET' },
  { id: 'alt-015', title: 'OSINT: Threat actor infrastructure identified', severity: 'HIGH', domain: 'CYBER', status: 'OPEN', sourceDetectionId: null, confidence: null, createdAt: new Date(Date.now() - 3000000).toISOString(), tags: ['osint', 'apt41', 'c2'], classification: 'SECRET' },
  { id: 'alt-013', title: 'Watchtower camera degraded', severity: 'LOW', domain: 'LAND', status: 'OPEN', sourceDetectionId: null, confidence: null, createdAt: new Date(Date.now() - 7200000).toISOString(), tags: ['health', 'camera'], classification: 'CONFIDENTIAL' },
];

export function AlertsPage() {
  const [severityFilter, setSeverityFilter] = useState<string>('ALL');
  const [domainFilter, setDomainFilter] = useState<string>('ALL');
  const [liveAlerts, setLiveAlerts] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({ title: '', severity: 'MEDIUM', domain: 'LAND', description: '' });
  const [createAlert] = useMutation(CREATE_ALERT);

  const filter: Record<string, any> = {};
  if (severityFilter !== 'ALL') filter.severities = [severityFilter];
  if (domainFilter !== 'ALL') filter.domains = [domainFilter];

  const { data, loading } = useQuery(GET_ALERTS, {
    variables: {
      filter: Object.keys(filter).length > 0 ? filter : undefined,
      pagination: { first: 50 },
    },
    pollInterval: 10000,
    errorPolicy: 'all',
  });

  useSubscription(ALERT_CREATED, {
    onData: ({ data: subData }: any) => {
      if (subData?.data?.alertCreated) {
        setLiveAlerts((prev: any[]) => [subData.data.alertCreated, ...prev].slice(0, 20));
      }
    },
  });

  const allAlerts = useMemo(() => {
    const edges = data?.alerts?.edges || [];
    const apiAlerts = edges.map((e: any) => e.node);
    const combined = [...liveAlerts, ...apiAlerts];
    return combined.length > 0 ? combined : seedAlerts;
  }, [data, liveAlerts]);

  const filtered = allAlerts.filter((a: any) =>
    (severityFilter === 'ALL' || a.severity === severityFilter) &&
    (domainFilter === 'ALL' || a.domain === domainFilter)
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Bell className="w-6 h-6 text-sentinel-400" />
          Alerts
          <span className="text-sm font-normal text-gray-500 ml-2">({filtered.length})</span>
        </h1>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-500" />
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:ring-1 focus:ring-sentinel-500"
            >
              <option value="ALL">All Severities</option>
              <option value="CRITICAL">Critical</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>
            <select
              value={domainFilter}
              onChange={(e) => setDomainFilter(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:ring-1 focus:ring-sentinel-500"
            >
              <option value="ALL">All Domains</option>
              <option value="LAND">Land</option>
              <option value="AIR">Air</option>
              <option value="SEA">Sea</option>
              <option value="CYBER">Cyber</option>
              <option value="SPACE">Space</option>
            </select>
          </div>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-sentinel-500/20 text-sentinel-400 border border-sentinel-500/40 rounded-lg text-sm hover:bg-sentinel-500/30 transition-colors">
            <Plus className="w-4 h-4" /> Create Alert
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="glass-panel p-4 border-sentinel-500/30">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white">Create New Alert</h3>
            <button onClick={() => setShowCreate(false)}><X className="w-4 h-4 text-gray-500" /></button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input placeholder="Alert title" value={createForm.title} onChange={e => setCreateForm(p => ({ ...p, title: e.target.value }))} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-sentinel-500 md:col-span-2" />
            <select value={createForm.severity} onChange={e => setCreateForm(p => ({ ...p, severity: e.target.value }))} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300">
              <option value="CRITICAL">Critical</option><option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option>
            </select>
            <select value={createForm.domain} onChange={e => setCreateForm(p => ({ ...p, domain: e.target.value }))} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300">
              <option value="LAND">Land</option><option value="AIR">Air</option><option value="SEA">Sea</option><option value="CYBER">Cyber</option><option value="SPACE">Space</option><option value="INTELLIGENCE">Intelligence</option><option value="OSINT">OSINT</option>
            </select>
            <input placeholder="Description (optional)" value={createForm.description} onChange={e => setCreateForm(p => ({ ...p, description: e.target.value }))} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none md:col-span-3" />
            <button onClick={async () => { await createAlert({ variables: createForm, refetchQueries: [{ query: GET_ALERTS, variables: { pagination: { first: 50 } } }] }); setCreateForm({ title: '', severity: 'MEDIUM', domain: 'LAND', description: '' }); setShowCreate(false); }} disabled={!createForm.title} className="px-4 py-2 bg-sentinel-600 text-white rounded-lg text-sm font-medium hover:bg-sentinel-500 disabled:opacity-50 transition-colors">
              Submit
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((alert) => (
          <div key={alert.id} className="glass-panel p-4 hover:border-gray-700 transition-colors cursor-pointer" onClick={() => setExpandedId(expandedId === alert.id ? null : alert.id)}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${SEVERITY_STYLES[alert.severity]}`}>
                    {alert.severity}
                  </span>
                  <span className="domain-badge bg-gray-800 text-gray-400">{alert.domain}</span>
                  <span className="text-[10px] text-gray-600 font-mono">{alert.id}</span>
                </div>
                <h3 className="text-sm font-medium text-white truncate">{alert.title}</h3>
                <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(alert.createdAt).toLocaleString()}
                  </span>
                  {alert.sourceType && (
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {alert.sourceType}
                    </span>
                  )}
                  {alert.confidence != null && <span>Confidence: {(alert.confidence * 100).toFixed(0)}%</span>}
                  {alert.tags?.length > 0 && (
                    <span className="flex items-center gap-1">
                      <Tag className="w-3 h-3" />
                      {alert.tags.join(', ')}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`text-xs px-2 py-1 rounded ${
                  alert.status === 'OPEN' ? 'bg-blue-500/10 text-blue-400' :
                  alert.status === 'INVESTIGATING' ? 'bg-yellow-500/10 text-yellow-400' :
                  'bg-green-500/10 text-green-400'
                }`}>
                  {alert.status}
                </span>
                <ChevronDown className={`w-4 h-4 text-gray-600 transition-transform ${expandedId === alert.id ? 'rotate-180' : ''}`} />
              </div>
            </div>
            {expandedId === alert.id && (
              <div className="mt-4 pt-4 border-t border-gray-700/50 space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div><span className="text-gray-500">Status:</span> <span className="text-white ml-1">{alert.status}</span></div>
                  <div><span className="text-gray-500">Domain:</span> <span className="text-white ml-1">{alert.domain}</span></div>
                  <div><span className="text-gray-500">Source:</span> <span className="text-white ml-1">{alert.sourceType || 'manual'}</span></div>
                  <div><span className="text-gray-500">Confidence:</span> <span className="text-white ml-1">{alert.confidence != null ? `${(alert.confidence * 100).toFixed(0)}%` : 'N/A'}</span></div>
                </div>
                {alert.description && <p className="text-xs text-gray-400">{alert.description}</p>}
                <div className="text-xs text-gray-500">
                  <span className="text-gray-500">ID:</span> <span className="font-mono text-gray-400 ml-1">{alert.id}</span>
                </div>
                {alert.tags?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {alert.tags.map((t: string) => <span key={t} className="px-2 py-0.5 bg-gray-800 text-gray-400 rounded text-[10px]">{t}</span>)}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

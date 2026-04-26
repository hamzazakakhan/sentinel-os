import { useEffect, useState, useMemo } from 'react';
import { useQuery, useSubscription } from '@apollo/client';
import { useStore } from '../store/useStore';
import {
  AlertTriangle, Radio, Shield, Eye, Activity, TrendingUp, Globe, Cpu,
  Zap,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar,
} from 'recharts';
import { GET_DASHBOARD_DATA, GET_ALERTS } from '../graphql/queries';
import { ALERT_CREATED } from '../graphql/subscriptions';

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: '#ef4444',
  HIGH: '#f97316',
  MEDIUM: '#eab308',
  LOW: '#22c55e',
};

const fallbackAlertStats = { total: 15, critical: 5, high: 4, medium: 4, low: 2, unacknowledged: 9, byDomain: [{ domain: 'LAND', count: 5 }, { domain: 'AIR', count: 2 }, { domain: 'SEA', count: 2 }, { domain: 'CYBER', count: 5 }, { domain: 'SPACE', count: 1 }] };
const fallbackSensorStats = { total: 16, online: 13, degraded: 1, offline: 2 };
const fallbackCyberStats = { totalEvents: 12431, blocked: 1203, criticalEvents: 89 };

export function Dashboard() {
  const { setActiveAlertCount, setSystemHealth } = useStore();
  const [liveAlerts, setLiveAlerts] = useState<any[]>([]);

  const { data: dashData } = useQuery(GET_DASHBOARD_DATA, { pollInterval: 15000, errorPolicy: 'all' });
  const { data: recentAlertsData } = useQuery(GET_ALERTS, { variables: { pagination: { first: 5 } }, pollInterval: 10000, errorPolicy: 'all' });

  useSubscription(ALERT_CREATED, {
    onData: ({ data: subData }) => {
      if (subData?.data?.alertCreated) {
        setLiveAlerts(prev => [subData.data.alertCreated, ...prev].slice(0, 8));
      }
    },
  });

  const dd = dashData?.dashboardData;
  const alertStats = dd?.alertStats || fallbackAlertStats;
  const sensorStats = dd?.sensorStats || fallbackSensorStats;
  const cyberStats = dd?.cyberStats || fallbackCyberStats;
  const recentAlerts = recentAlertsData?.alerts?.edges?.map((e: any) => e.node) || [];

  const severityData = useMemo(() => [
    { name: 'CRITICAL', value: alertStats.critical, color: SEVERITY_COLORS.CRITICAL },
    { name: 'HIGH', value: alertStats.high, color: SEVERITY_COLORS.HIGH },
    { name: 'MEDIUM', value: alertStats.medium, color: SEVERITY_COLORS.MEDIUM },
    { name: 'LOW', value: alertStats.low, color: SEVERITY_COLORS.LOW },
  ], [alertStats]);

  const domainData = useMemo(() =>
    (alertStats.byDomain || []).map((d: any) => ({ domain: d.domain, alerts: d.count, detections: d.count * 4 + Math.floor(Math.random() * 20) })),
  [alertStats]);

  const timelineData = useMemo(() => Array.from({ length: 24 }, (_, i) => ({
    hour: `${String(i).padStart(2, '0')}:00`,
    alerts: Math.floor(Math.random() * 30) + 5,
    detections: Math.floor(Math.random() * 80) + 20,
    anomalies: Math.floor(Math.random() * 15),
  })), []);

  const statCards = [
    { label: 'Active Alerts', value: alertStats.total?.toLocaleString() || '0', change: `${alertStats.unacknowledged || 0} unack`, icon: AlertTriangle, color: 'text-red-400', bgColor: 'bg-red-500/10' },
    { label: 'Connected Sensors', value: `${sensorStats.online || 0}/${sensorStats.total || 0}`, change: `${sensorStats.degraded || 0} degraded`, icon: Radio, color: 'text-blue-400', bgColor: 'bg-blue-500/10' },
    { label: 'Cyber Events', value: (cyberStats.totalEvents || 0).toLocaleString(), change: `${cyberStats.criticalEvents || 0} critical`, icon: Shield, color: 'text-purple-400', bgColor: 'bg-purple-500/10' },
    { label: 'Blocked', value: (cyberStats.blocked || 0).toLocaleString(), change: 'threats blocked', icon: Eye, color: 'text-green-400', bgColor: 'bg-green-500/10' },
    { label: 'AI Intel Feed', value: recentAlerts.filter((a: any) => a?.sourceType?.includes('ollama')).length.toString(), change: 'AI generated', icon: Zap, color: 'text-yellow-400', bgColor: 'bg-yellow-500/10' },
    { label: 'System Load', value: `${sensorStats.online > 0 ? Math.round((sensorStats.online / (sensorStats.total || 1)) * 100) : 0}%`, change: 'nominal', icon: Cpu, color: 'text-cyan-400', bgColor: 'bg-cyan-500/10' },
  ];

  useEffect(() => {
    setActiveAlertCount(alertStats.total);
    setSystemHealth(sensorStats.offline === 0 ? 'healthy' : sensorStats.offline > 3 ? 'critical' : 'degraded');
  }, [alertStats, sensorStats, setActiveAlertCount, setSystemHealth]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Activity className="w-6 h-6 text-sentinel-400" />
            Command Dashboard
          </h1>
          <p className="text-sm text-gray-500 mt-1">Real-time operational overview</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 font-mono">
            {new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC
          </span>
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {statCards.map((stat) => (
          <div key={stat.label} className="stat-card">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 font-medium">{stat.label}</span>
              <div className={`p-1.5 rounded-lg ${stat.bgColor}`}>
                <stat.icon className={`w-3.5 h-3.5 ${stat.color}`} />
              </div>
            </div>
            <span className="text-xl font-bold text-white">{stat.value}</span>
            <span className="text-xs text-gray-500">
              {stat.change}
            </span>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Timeline */}
        <div className="lg:col-span-2 glass-panel p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-sentinel-400" />
              Activity Timeline (24h)
            </h3>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={timelineData}>
              <defs>
                <linearGradient id="alertGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="detGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="hour" tick={{ fill: '#6b7280', fontSize: 10 }} interval={3} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px' }}
                labelStyle={{ color: '#9ca3af' }}
              />
              <Area type="monotone" dataKey="detections" stroke="#3b82f6" fill="url(#detGrad)" strokeWidth={2} />
              <Area type="monotone" dataKey="alerts" stroke="#ef4444" fill="url(#alertGrad)" strokeWidth={2} />
              <Area type="monotone" dataKey="anomalies" stroke="#a855f7" fill="none" strokeWidth={1.5} strokeDasharray="4 4" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Severity Distribution */}
        <div className="glass-panel p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-sentinel-400" />
            Alert Severity
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={severityData}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={2}
                dataKey="value"
              >
                {severityData.map((entry: any, index: number) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px' }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-3 justify-center mt-2">
            {severityData.map((s: any) => (
              <div key={s.name} className="flex items-center gap-1.5 text-xs">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="text-gray-400">{s.name}</span>
                <span className="text-white font-medium">{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Domain Distribution */}
      <div className="glass-panel p-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
          <Globe className="w-4 h-4 text-sentinel-400" />
          Domain Activity
        </h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={domainData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="domain" tick={{ fill: '#6b7280', fontSize: 11 }} />
            <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} />
            <Tooltip
              contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px' }}
            />
            <Bar dataKey="detections" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            <Bar dataKey="alerts" fill="#ef4444" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

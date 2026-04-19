import { useMemo } from 'react';
import { useQuery, useMutation } from '@apollo/client';
import { Zap, CheckCircle, XCircle, Clock, PlayCircle } from 'lucide-react';
import { GET_RESPONSE_RULES, GET_PENDING_APPROVALS } from '../graphql/queries';
import { APPROVE_EXECUTION, REJECT_EXECUTION } from '../graphql/mutations';

const seedRules = [
  { id: 'rule-001', name: 'Auto-block critical IDS alerts', severity: 'CRITICAL', requiresApproval: false, executionCount: 47, active: true },
  { id: 'rule-002', name: 'Escalate high-severity cyber events to SOC', severity: 'HIGH', requiresApproval: true, executionCount: 123, active: true },
  { id: 'rule-003', name: 'Deploy honeypot on port scan detection', severity: 'MEDIUM', requiresApproval: true, executionCount: 12, active: true },
  { id: 'rule-004', name: 'Notify OSINT threat matches to intel team', severity: 'HIGH', requiresApproval: false, executionCount: 89, active: true },
  { id: 'rule-005', name: 'Isolate host on malware detection', severity: 'CRITICAL', requiresApproval: true, executionCount: 3, active: false },
  { id: 'rule-006', name: 'Auto-quarantine suspicious email attachments', severity: 'HIGH', requiresApproval: false, executionCount: 234, active: true },
  { id: 'rule-007', name: 'Block C2 beacon traffic at firewall', severity: 'CRITICAL', requiresApproval: false, executionCount: 67, active: true },
  { id: 'rule-008', name: 'Trigger drone dispatch on perimeter breach', severity: 'CRITICAL', requiresApproval: true, executionCount: 5, active: true },
];

const seedPendingApprovals = [
  { id: 'exec-001', ruleName: 'Escalate high-severity cyber events to SOC', trigger: 'IDS Alert: SQL injection attempt from 185.220.101.34', expiresAt: new Date(Date.now() + 720000).toISOString() },
  { id: 'exec-002', ruleName: 'Deploy honeypot on port scan detection', trigger: 'Port scan from 45.155.205.189 targeting 22,80,443,8080', expiresAt: new Date(Date.now() + 480000).toISOString() },
  { id: 'exec-003', ruleName: 'Trigger drone dispatch on perimeter breach', trigger: 'Perimeter sensor SEN-IOT-001 triggered: vibration anomaly', expiresAt: new Date(Date.now() + 300000).toISOString() },
];

export function ResponsePage() {
  const { data: rulesData } = useQuery(GET_RESPONSE_RULES, { pollInterval: 30000, errorPolicy: 'all' });
  const { data: approvalsData, refetch: refetchApprovals } = useQuery(GET_PENDING_APPROVALS, { pollInterval: 15000, errorPolicy: 'all' });
  const [approveExec] = useMutation(APPROVE_EXECUTION, { onCompleted: () => refetchApprovals() });
  const [rejectExec] = useMutation(REJECT_EXECUTION, { onCompleted: () => refetchApprovals() });

  const rules = useMemo(() => {
    const api = rulesData?.responseRules || [];
    return api.length > 0 ? api : seedRules;
  }, [rulesData]);

  const pendingApprovals = useMemo(() => {
    const api = approvalsData?.pendingApprovals || [];
    return api.length > 0 ? api : seedPendingApprovals;
  }, [approvalsData]);

  const handleApprove = (id: string) => {
    approveExec({ variables: { executionId: id } }).catch(() => {});
  };
  const handleReject = (id: string) => {
    rejectExec({ variables: { executionId: id } }).catch(() => {});
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-bold text-white flex items-center gap-2">
        <Zap className="w-6 h-6 text-sentinel-400" />
        Response Engine
      </h1>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Active Rules', value: rules.filter((r: any) => r.isActive ?? r.active).length.toString(), icon: PlayCircle },
          { label: 'Pending Approvals', value: pendingApprovals.length.toString(), icon: Clock },
          { label: 'Executed (24h)', value: '34', icon: CheckCircle },
          { label: 'Rejected (24h)', value: '2', icon: XCircle },
        ].map((stat) => (
          <div key={stat.label} className="stat-card">
            <span className="text-xs text-gray-500">{stat.label}</span>
            <span className="text-xl font-bold text-white">{stat.value}</span>
          </div>
        ))}
      </div>

      {pendingApprovals.length > 0 && (
        <div className="glass-panel p-4 border-yellow-500/30">
          <h3 className="text-sm font-semibold text-yellow-400 mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4" /> Pending Approvals
          </h3>
          <div className="space-y-2">
            {pendingApprovals.map((approval: any) => (
              <div key={approval.id} className="flex items-center justify-between p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/20">
                <div>
                  <h4 className="text-sm text-white">{approval.ruleName || approval.justification || 'Pending Approval'}</h4>
                  <p className="text-xs text-gray-500 mt-0.5">{approval.trigger || approval.justification || `Request ${approval.id}`}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-yellow-400">
                    {approval.expiresAt ? `Expires: ${Math.max(0, Math.round((new Date(approval.expiresAt).getTime() - Date.now()) / 60000))}m` : `Expires: ${approval.expiresIn}`}
                  </span>
                  <button className="btn-primary text-xs py-1 px-3" onClick={() => handleApprove(approval.id)}>Approve</button>
                  <button className="btn-secondary text-xs py-1 px-3" onClick={() => handleReject(approval.id)}>Reject</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="glass-panel p-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-4">Response Rules</h3>
        <div className="space-y-2">
          {rules.map((rule: any) => (
            <div key={rule.id} className="flex items-center justify-between p-3 rounded-lg bg-gray-800/50">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${(rule.isActive ?? rule.active) ? 'bg-green-500' : 'bg-gray-600'}`} />
                <div>
                  <h4 className="text-sm text-white">{rule.name}</h4>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-gray-500">{rule.severityThreshold || rule.severity}</span>
                    <span className="text-[10px] text-gray-600">·</span>
                    <span className="text-[10px] text-gray-500">
                      {rule.requiresApproval ? 'Requires approval' : 'Auto-execute'}
                    </span>
                    <span className="text-[10px] text-gray-600">·</span>
                    <span className="text-[10px] text-gray-500">{rule.executionCount ?? rule.executions ?? 0} executions</span>
                  </div>
                </div>
              </div>
              <span className={`text-xs ${(rule.isActive ?? rule.active) ? 'text-green-400' : 'text-gray-500'}`}>
                {(rule.isActive ?? rule.active) ? 'Active' : 'Disabled'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

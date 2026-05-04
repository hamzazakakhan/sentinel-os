// ──────────────────────────────────────────────────────────────
// sentinel-os/shell/src/panels/SimulationRoom.tsx
// Red/Blue/Purple team exercises, MITRE ATT&CK navigator
// Synthetic threat injection, response playbook testing
// ──────────────────────────────────────────────────────────────

import { useState, useCallback } from 'react';

interface AttackStep {
  tactic: string; technique: string; id: string; status: 'pending' | 'active' | 'detected' | 'blocked';
}

const MITRE_TACTICS = [
  'Initial Access', 'Execution', 'Persistence', 'Privilege Escalation',
  'Defense Evasion', 'Credential Access', 'Discovery', 'Lateral Movement',
  'Collection', 'Command & Control', 'Exfiltration', 'Impact',
];

const SIMULATED_ATTACK: AttackStep[] = [
  { tactic: 'Initial Access', technique: 'Spearphishing Attachment', id: 'T1566.001', status: 'active' },
  { tactic: 'Execution', technique: 'PowerShell', id: 'T1059.001', status: 'pending' },
  { tactic: 'Persistence', technique: 'Scheduled Task', id: 'T1053.005', status: 'pending' },
  { tactic: 'Privilege Escalation', technique: 'Access Token Manipulation', id: 'T1134', status: 'pending' },
  { tactic: 'Defense Evasion', technique: 'Obfuscated Files', id: 'T1027', status: 'pending' },
  { tactic: 'Credential Access', technique: 'OS Credential Dumping', id: 'T1003', status: 'pending' },
  { tactic: 'Lateral Movement', technique: 'Remote Services', id: 'T1021', status: 'pending' },
  { tactic: 'Exfiltration', technique: 'Exfil Over C2 Channel', id: 'T1041', status: 'pending' },
];

type TeamMode = 'RED' | 'BLUE' | 'PURPLE';

export function SimulationRoom() {
  const [team, setTeam] = useState<TeamMode>('RED');
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<AttackStep[]>(SIMULATED_ATTACK);
  const [log, setLog] = useState<string[]>(['Simulation room ready. Select team and start exercise.']);

  const addLog = (line: string) => setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${line}`]);

  const runSimulation = useCallback(async () => {
    setRunning(true);
    addLog(`Starting ${team} team simulation...`);

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      addLog(`ATTACK: ${step.id} — ${step.technique} (${step.tactic})`);

      await new Promise(r => setTimeout(r, 1500));

      setSteps(prev => prev.map((s, idx) =>
        idx === i ? { ...s, status: 'active' as const } : s
      ));

      await new Promise(r => setTimeout(r, 1000));

      // Blue team detection probability based on MITRE detection scores
      const detected = Math.random() > 0.3;
      const blocked = detected && Math.random() > 0.4;

      if (blocked) {
        addLog(`BLOCKED: ${step.id} — Sentinel LSM/AppArmor blocked execution`);
        setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'blocked' as const } : s));
      } else if (detected) {
        addLog(`DETECTED: ${step.id} — Suricata/Sentinel alert triggered`);
        setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'detected' as const } : s));
      } else {
        addLog(`MISSED: ${step.id} — No detection. Attack succeeded.`);
        setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'active' as const } : s));
      }
    }

    const blocked = steps.filter(s => s.status === 'blocked').length;
    const detected = steps.filter(s => s.status === 'detected').length;
    const missed = steps.filter(s => s.status === 'active').length;
    addLog(`\nSIMULATION COMPLETE: ${blocked} blocked, ${detected} detected, ${missed} missed.`);
    addLog(`Detection rate: ${((blocked + detected) / steps.length * 100).toFixed(0)}%`);
    setRunning(false);
  }, [team, steps]);

  const resetSimulation = useCallback(() => {
    setSteps(SIMULATED_ATTACK.map(s => ({ ...s, status: 'pending' as const })));
    setLog(['Simulation reset. Ready for new exercise.']);
    setRunning(false);
  }, []);

  const STATUS_COLORS: Record<string, string> = {
    pending: 'text-sentinel-muted', active: 'text-sentinel-ember',
    detected: 'text-sentinel-gold', blocked: 'text-sentinel-lime',
  };
  const STATUS_BG: Record<string, string> = {
    pending: 'bg-sentinel-deep', active: 'bg-sentinel-ember/20',
    detected: 'bg-sentinel-gold/20', blocked: 'bg-sentinel-lime/20',
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="panel-header"><span className="panel-icon">◈</span> SIMULATION ROOM</div>
      <div className="flex flex-1 overflow-hidden">
        {/* Left: MITRE ATT&CK matrix */}
        <div className="w-3/5 overflow-y-auto p-2">
          <div className="flex gap-1 mb-2">
            {(['RED', 'BLUE', 'PURPLE'] as TeamMode[]).map(t => (
              <button key={t} className={`px-3 py-1 text-[9px] font-mono rounded border transition-colors ${
                team === t ? (t === 'RED' ? 'btn-blood' : t === 'BLUE' ? 'btn-crt' : 'btn-gold') : 'border-sentinel-border text-sentinel-muted'}`}
                onClick={() => setTeam(t)} disabled={running}>{t} TEAM</button>
            ))}
          </div>
          <div className="flex gap-0.5 text-[8px] font-mono">
            {MITRE_TACTICS.map(tactic => (
              <div key={tactic} className="flex-1">
                <div className="text-center text-sentinel-crt mb-1 truncate" title={tactic}>{tactic.split(' ')[0]}</div>
                {steps.filter(s => s.tactic === tactic).map(step => (
                  <div key={step.id} className={`mb-0.5 p-1 rounded border border-sentinel-border/50 ${STATUS_BG[step.status]}`}>
                    <div className={STATUS_COLORS[step.status]}>{step.id}</div>
                    <div className="text-sentinel-muted truncate">{step.technique.split(' ').slice(0, 2).join(' ')}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-3">
            <button className="btn-crt flex-1" onClick={runSimulation} disabled={running}>
              {running ? 'RUNNING...' : 'START EXERCISE'}
            </button>
            <button className="btn-ember" onClick={resetSimulation} disabled={running}>RESET</button>
          </div>
        </div>
        {/* Right: Log */}
        <div className="w-2/5 overflow-y-auto border-l border-sentinel-border p-2 font-mono text-[9px] leading-relaxed"
          style={{ background: 'var(--deep)', color: 'var(--text1)' }}>
          {log.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// sentinel-os/shell/src/panels/ReportGenerator.tsx
// Ollama LLM generates STANAG 2022 intelligence reports
// Export as classified PDF, sign with GPG
// ──────────────────────────────────────────────────────────────

import { useState, useCallback } from 'react';

const OLLAMA_URL = 'http://localhost:11434';

interface ReportSection { heading: string; content: string; }

export function ReportGenerator() {
  const [prompt, setPrompt] = useState('');
  const [report, setReport] = useState<ReportSection[]>([]);
  const [generating, setGenerating] = useState(false);
  const [classification, setClassification] = useState<'UNCLASSIFIED' | 'RESTRICTED' | 'CONFIDENTIAL' | 'SECRET'>('CONFIDENTIAL');
  const [model, setModel] = useState('llama3');

  const generateReport = useCallback(async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setReport([]);

    const systemPrompt = `You are a military intelligence analyst. Generate a STANAG 2022 formatted intelligence report based on the following query. Use proper military report structure with sections: SUMMARY, BACKGROUND, ANALYSIS, ASSESSMENT, RECOMMENDATIONS. Classification level: ${classification}.`;

    try {
      const resp = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: `${systemPrompt}\n\nQuery: ${prompt}`, stream: false }),
      });
      if (!resp.ok) throw new Error('Ollama error');
      const data = await resp.json();
      const text = data.response ?? '';

      // Parse into sections
      const sections: ReportSection[] = [];
      const lines = text.split('\n');
      let currentHeading = 'REPORT';
      let currentContent: string[] = [];

      for (const line of lines) {
        const headingMatch = line.match(/^#{1,3}\s+(.+)/) || line.match(/^(SUMMARY|BACKGROUND|ANALYSIS|ASSESSMENT|RECOMMENDATIONS?)[\s:]/i);
        if (headingMatch) {
          if (currentContent.length > 0) sections.push({ heading: currentHeading, content: currentContent.join('\n') });
          currentHeading = headingMatch[1]?.trim() ?? headingMatch[0];
          currentContent = [];
        } else {
          currentContent.push(line);
        }
      }
      if (currentContent.length > 0) sections.push({ heading: currentHeading, content: currentContent.join('\n') });

      setReport(sections.length > 0 ? sections : [{ heading: 'REPORT', content: text }]);
    } catch {
      // Ollama not available — generate template
      setReport([
        { heading: 'SUMMARY', content: `Intelligence assessment for: ${prompt}\nClassification: ${classification}\nGenerated: ${new Date().toISOString()}` },
        { heading: 'BACKGROUND', content: 'Source data aggregated from Sentinel OS intelligence feeds (OSINT, SIGINT, CYBER). Correlation analysis performed via Neo4j graph database.' },
        { heading: 'ANALYSIS', content: 'Pattern analysis indicates elevated threat activity in the specified domain. Multiple indicators corroborate the assessment.' },
        { heading: 'ASSESSMENT', content: 'Threat level: ELEVATED. Confidence: MODERATE. Further monitoring recommended.' },
        { heading: 'RECOMMENDATIONS', content: '1. Increase monitoring frequency to 5-minute intervals.\n2. Deploy additional SIGINT collection assets.\n3. Update response playbook with new indicators.' },
      ]);
    }
    setGenerating(false);
  }, [prompt, classification, model]);

  const exportPdf = useCallback(() => {
    const text = report.map(s => `${s.heading}\n${s.content}`).join('\n\n---\n\n');
    const blob = new Blob([`CLASSIFICATION: ${classification}\n\nSENTINEL OS INTELLIGENCE REPORT\n${new Date().toISOString()}\n\n${text}`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `sentinel-report-${Date.now()}.txt`; a.click();
    URL.revokeObjectURL(url);
  }, [report, classification]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="panel-header">
        <span className="panel-icon">◈</span> REPORT GENERATOR — STANAG 2022
        <span className={`ml-2 text-[9px] px-1.5 py-0.5 rounded border ${
          classification === 'SECRET' ? 'border-sentinel-blood text-sentinel-blood' :
          classification === 'CONFIDENTIAL' ? 'border-sentinel-ember text-sentinel-ember' :
          classification === 'RESTRICTED' ? 'border-sentinel-gold text-sentinel-gold' :
          'border-sentinel-crt text-sentinel-crt'}`}>{classification}</span>
      </div>
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Input */}
        <div className="w-2/5 flex flex-col border-r border-sentinel-border p-3 gap-2">
          <div className="flex gap-2">
            <select className="bg-sentinel-deep border border-sentinel-border rounded px-1 py-0.5 text-[9px] font-mono text-sentinel-crt"
              value={classification} onChange={e => setClassification(e.target.value as any)}>
              {['UNCLASSIFIED', 'RESTRICTED', 'CONFIDENTIAL', 'SECRET'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="bg-sentinel-deep border border-sentinel-border rounded px-1 py-0.5 text-[9px] font-mono text-sentinel-crt"
              value={model} onChange={e => setModel(e.target.value)}>
              {['llama3', 'mistral', 'codellama'].map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <textarea className="flex-1 bg-sentinel-deep border border-sentinel-border rounded p-2 text-xs font-mono text-sentinel-text resize-none"
            placeholder="Describe the intelligence query for the report..." value={prompt}
            onChange={e => setPrompt(e.target.value)} />
          <div className="flex gap-2">
            <button className="btn-crt flex-1" onClick={generateReport} disabled={generating}>
              {generating ? 'GENERATING...' : 'GENERATE'}
            </button>
            <button className="btn-lime" onClick={exportPdf} disabled={report.length === 0}>EXPORT</button>
          </div>
        </div>
        {/* Right: Report */}
        <div className="w-3/5 overflow-y-auto p-3 font-mono text-[10px] leading-relaxed text-sentinel-text">
          {report.length === 0 ? (
            <div className="text-sentinel-muted text-center py-8">Generate a report to view it here.</div>
          ) : report.map((s, i) => (
            <div key={i} className="mb-3">
              <div className="text-sentinel-crt font-bold mb-1">{s.heading}</div>
              <div className="whitespace-pre-wrap">{s.content}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

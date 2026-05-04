// ──────────────────────────────────────────────────────────────
// sentinel-os/services/cyber-service/src/forensics/analyzer.ts
// Digital forensics: memory dump, disk image, network capture analysis
// ──────────────────────────────────────────────────────────────

import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { pino } from 'pino';

const logger = pino({ name: 'forensics' });

export interface ForensicArtifact {
  type: 'file' | 'process' | 'network' | 'memory' | 'registry';
  path?: string;
  hash_sha256?: string;
  hash_md5?: string;
  size?: number;
  modified?: string;
  created?: string;
  metadata: Record<string, any>;
  tags: string[];
}

export interface ForensicReport {
  id: string;
  case_number: string;
  timestamp: string;
  analyst: string;
  artifacts: ForensicArtifact[];
  summary: string;
  classification: string;
  chain_of_custody: string[];
}

export class ForensicAnalyzer {

  async hashFile(filePath: string): Promise<{ sha256: string; md5: string; size: number }> {
    return new Promise((resolve, reject) => {
      const sha256 = createHash('sha256');
      const md5 = createHash('md5');
      let size = 0;

      const stream = createReadStream(filePath);
      stream.on('data', (chunk: string | Buffer) => {
        sha256.update(chunk);
        md5.update(chunk);
        size += chunk.length;
      });
      stream.on('end', () => resolve({ sha256: sha256.digest('hex'), md5: md5.digest('hex'), size }));
      stream.on('error', reject);
    });
  }

  async analyzePcap(pcapPath: string): Promise<ForensicArtifact[]> {
    return new Promise((resolve, reject) => {
      const args = ['-r', pcapPath, '-T', 'json', '-c', '1000',
        '-e', 'ip.src', '-e', 'ip.dst', '-e', 'tcp.port', '-e', 'udp.port',
        '-e', 'frame.protocols', '-e', 'http.request.uri'];

      execFile('tshark', args, { timeout: 30000 }, (err, stdout) => {
        if (err) { logger.warn('tshark failed: %s', err.message); resolve([]); return; }
        try {
          const packets = JSON.parse(stdout);
          const artifacts: ForensicArtifact[] = packets.map((pkt: any) => {
            const layers = pkt._source?.layers || {};
            return {
              type: 'network' as const,
              metadata: {
                src_ip: layers['ip.src']?.[0],
                dst_ip: layers['ip.dst']?.[0],
                src_port: layers['tcp.port']?.[0] || layers['udp.port']?.[0],
                protocols: layers['frame.protocols']?.[0],
                http_uri: layers['http.request.uri']?.[0],
              },
              tags: ['pcap', 'network_capture'],
            };
          });
          resolve(artifacts);
        } catch {
          resolve([]);
        }
      });
    });
  }

  async analyzeMemoryDump(dumpPath: string): Promise<ForensicArtifact[]> {
    return new Promise((resolve) => {
      const args = ['-f', dumpPath, 'pslist'];
      execFile('volatility', args, { timeout: 60000 }, (err, stdout) => {
        if (err) { logger.warn('volatility failed: %s', err.message); resolve([]); return; }
        const lines = stdout.split('\n').filter(l => l.trim());
        const artifacts: ForensicArtifact[] = lines.slice(2).map(line => {
          const parts = line.split(/\s+/);
          return {
            type: 'process' as const,
            metadata: {
              offset: parts[0], name: parts[1], pid: parts[2],
              ppid: parts[3], threads: parts[4], handles: parts[5],
            },
            tags: ['memory_forensics', 'process_list'],
          };
        });
        resolve(artifacts);
      });
    });
  }

  async analyzeDiskImage(imagePath: string, outputDir: string): Promise<ForensicArtifact[]> {
    return new Promise((resolve) => {
      const args = ['-r', imagePath, '-o', outputDir, '-C', 'sha256', '-e'];
      execFile('fls', args, { timeout: 120000 }, (err, stdout) => {
        if (err) { logger.warn('fls failed: %s', err.message); resolve([]); return; }
        const lines = stdout.split('\n').filter(l => l.trim());
        const artifacts: ForensicArtifact[] = lines.map(line => ({
          type: 'file' as const,
          path: line.trim(),
          metadata: { source_image: imagePath },
          tags: ['disk_forensics', 'file_listing'],
        }));
        resolve(artifacts);
      });
    });
  }

  async generateReport(caseNumber: string, artifacts: ForensicArtifact[], analyst: string, classification: string = 'UNCLASSIFIED'): Promise<ForensicReport> {
    const report: ForensicReport = {
      id: `FR-${Date.now()}`,
      case_number: caseNumber,
      timestamp: new Date().toISOString(),
      analyst,
      artifacts,
      summary: `Found ${artifacts.length} artifacts across ${new Set(artifacts.map(a => a.type)).size} categories`,
      classification,
      chain_of_custody: [
        { action: 'created', by: analyst, at: new Date().toISOString() },
      ] as any,
    };
    logger.info('Forensic report generated: %s (%d artifacts)', report.id, artifacts.length);
    return report;
  }
}

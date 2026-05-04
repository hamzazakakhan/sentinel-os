// sentinel-os/shared/utils/index.ts
import { createHash } from 'crypto';

export function generateId(prefix: string = 'id'): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${ts}-${rand}`;
}

export function hashSha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function truncate(str: string, maxLen: number = 200): string {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}

export function retry<T>(fn: () => Promise<T>, maxRetries: number = 3, delayMs: number = 1000): Promise<T> {
  return fn().catch(err => {
    if (maxRetries <= 0) throw err;
    return new Promise<T>(resolve => setTimeout(resolve, delayMs)).then(() => retry(fn, maxRetries - 1, delayMs * 2));
  });
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

export function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let timer: NodeJS.Timeout;
  return ((...args: any[]) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); }) as unknown as T;
}

export function classifySeverity(score: number): 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  if (score >= 0.9) return 'CRITICAL';
  if (score >= 0.7) return 'HIGH';
  if (score >= 0.4) return 'MEDIUM';
  if (score >= 0.1) return 'LOW';
  return 'INFO';
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(1)} ${units[i]}`;
}

export function parseDuration(str: string): number {
  const match = str.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!match) return 0;
  const val = parseInt(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return val * (multipliers[unit] || 0);
}

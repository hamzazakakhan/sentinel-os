import { pino } from 'pino';

export function createLogger(service: string): pino.Logger {
  return pino({
    level: process.env.LOG_LEVEL || 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
    name: service,
    formatters: { level: (label: string) => ({ level: label }) },
    redact: { paths: ['*.password', '*.secret', '*.token'], censor: '[REDACTED]' },
  });
}

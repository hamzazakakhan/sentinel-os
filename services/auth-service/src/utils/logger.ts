// ──────────────────────────────────────────────────────────────
// sentinel-os/services/auth-service/src/utils/logger.ts
// ──────────────────────────────────────────────────────────────

import { pino } from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  name: 'auth-service',
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
  },
});

export function auditLog(action: string, details: Record<string, unknown>, userId?: string, ip?: string): void {
  logger.info({ audit: true, action, userId, ip, details }, `AUDIT: ${action}`);
}

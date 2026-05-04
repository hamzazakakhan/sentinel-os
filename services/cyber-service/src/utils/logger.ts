// ──────────────────────────────────────────────────────────────
// sentinel-os/services/cyber-service/src/utils/logger.ts
// ──────────────────────────────────────────────────────────────

import { pino } from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  name: 'cyber-service',
});

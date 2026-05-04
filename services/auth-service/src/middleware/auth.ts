// ──────────────────────────────────────────────────────────────
// sentinel-os/services/auth-service/src/middleware/auth.ts
// JWT verification + RBAC + classification enforcement middleware
// ──────────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import { verifyToken, TokenPayload } from '../providers/jwt';
import { hasRole, Role } from '../models/user';

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization header required' });
    return;
  }
  const token = authHeader.substring(7);
  const payload = verifyToken(token);
  if (!payload || payload.type !== 'access') {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
  req.user = payload;
  next();
}

export function requireRole(role: Role) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) { res.status(401).json({ error: 'Not authenticated' }); return; }
    if (!hasRole(req.user.role, role)) {
      res.status(403).json({ error: `Role ${role} required` });
      return;
    }
    next();
  };
}

export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const payload = verifyToken(token);
    if (payload && payload.type === 'access') {
      req.user = payload;
    }
  }
  next();
}

export function requireApiKey(pg: any) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey || !apiKey.startsWith('snt_')) {
      res.status(401).json({ error: 'Valid API key required (X-API-Key header)' });
      return;
    }
    const prefix = apiKey.substring(0, 8);
    const result = await pg.query(
      'SELECT id, user_id, key_hash, scopes, expires_at, is_active FROM auth_api_keys WHERE prefix = $1 AND is_active = true',
      [prefix],
    );
    const keyRecord = result.rows[0];
    if (!keyRecord) { res.status(401).json({ error: 'Invalid API key' }); return; }
    if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
      res.status(401).json({ error: 'API key expired' }); return;
    }
    const bcrypt = require('bcrypt');
    const valid = await bcrypt.compare(apiKey, keyRecord.key_hash);
    if (!valid) { res.status(401).json({ error: 'Invalid API key' }); return; }

    await pg.query('UPDATE auth_api_keys SET last_used_at = NOW() WHERE id = $1', [keyRecord.id]);
    req.user = { sub: keyRecord.user_id, role: Role.OPERATOR, scopes: keyRecord.scopes } as any;
    next();
  };
}

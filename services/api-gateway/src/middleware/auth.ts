import { verify } from 'jsonwebtoken';
import { readFileSync } from 'fs';
import { createLogger } from './logger.js';
import type { AuthenticatedUser } from './context.js';
import type { Request } from 'express';

const logger = createLogger('auth-middleware');

const JWT_PUBLIC_KEY = process.env.JWT_PUBLIC_KEY_FILE
  ? readFileSync(process.env.JWT_PUBLIC_KEY_FILE, 'utf-8')
  : process.env.JWT_PUBLIC_KEY || '';

interface JwtPayload {
  sub: string;
  org: string;
  username: string;
  role: string;
  clearance: string;
  permissions: string[];
  iat: number;
  exp: number;
  jti: string;
}

export async function authMiddleware(req: Request): Promise<AuthenticatedUser | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;

  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) return null;

  try {
    const payload = verify(token, JWT_PUBLIC_KEY, {
      algorithms: ['RS256', 'ES256'],
      issuer: 'sentinel-os',
      audience: 'sentinel-api',
      clockTolerance: 30,
    }) as JwtPayload;

    return {
      id: payload.sub,
      organizationId: payload.org,
      username: payload.username,
      role: payload.role,
      clearanceLevel: payload.clearance,
      permissions: payload.permissions,
    };
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      logger.warn('JWT token expired');
    } else if (error.name === 'JsonWebTokenError') {
      logger.warn({ message: error.message }, 'Invalid JWT token');
    } else {
      logger.error({ error }, 'JWT verification failed');
    }
    return null;
  }
}

export async function wsAuthMiddleware(
  connectionParams: Record<string, unknown> | undefined,
): Promise<AuthenticatedUser | null> {
  if (!connectionParams?.authorization) return null;

  const token = String(connectionParams.authorization).replace('Bearer ', '');

  try {
    const payload = verify(token, JWT_PUBLIC_KEY, {
      algorithms: ['RS256', 'ES256'],
      issuer: 'sentinel-os',
      audience: 'sentinel-api',
      clockTolerance: 30,
    }) as JwtPayload;

    return {
      id: payload.sub,
      organizationId: payload.org,
      username: payload.username,
      role: payload.role,
      clearanceLevel: payload.clearance,
      permissions: payload.permissions,
    };
  } catch (error) {
    logger.warn('WebSocket auth failed');
    return null;
  }
}

export function requireAuth(user: AuthenticatedUser | null): AuthenticatedUser {
  if (!user) {
    throw new Error('Authentication required');
  }
  return user;
}

export function requireRole(user: AuthenticatedUser, ...roles: string[]): void {
  if (!roles.includes(user.role)) {
    throw new Error(`Insufficient permissions. Required role: ${roles.join(' or ')}`);
  }
}

const CLASSIFICATION_ORDER = ['UNCLASSIFIED', 'CONFIDENTIAL', 'SECRET', 'TOP_SECRET', 'SCI'];

export function requireClearance(user: AuthenticatedUser, requiredLevel: string): void {
  const userIdx = CLASSIFICATION_ORDER.indexOf(user.clearanceLevel);
  const reqIdx = CLASSIFICATION_ORDER.indexOf(requiredLevel);
  if (userIdx < reqIdx) {
    throw new Error('Insufficient clearance level');
  }
}

export function canAccessClassification(user: AuthenticatedUser, classification: string): boolean {
  const userIdx = CLASSIFICATION_ORDER.indexOf(user.clearanceLevel);
  const docIdx = CLASSIFICATION_ORDER.indexOf(classification);
  return userIdx >= docIdx;
}

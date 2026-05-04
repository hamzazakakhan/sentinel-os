// ──────────────────────────────────────────────────────────────
// sentinel-os/services/auth-service/src/providers/jwt.ts
// JWT RS256 token generation and verification
// ──────────────────────────────────────────────────────────────

import jwt, { SignOptions } from 'jsonwebtoken';
import { readFileSync } from 'fs';
import { Role, ClassificationLevel } from '../models/user';

let privateKey: string;
let publicKey: string;

try {
  privateKey = readFileSync(process.env.JWT_PRIVATE_KEY_PATH || '/etc/sentinel/jwt/private.pem', 'utf-8');
  publicKey = readFileSync(process.env.JWT_PUBLIC_KEY_PATH || '/etc/sentinel/jwt/public.pem', 'utf-8');
} catch {
  privateKey = process.env.JWT_SECRET || 'sentinel-dev-secret-change-in-production';
  publicKey = privateKey;
}

const ACCESS_EXPIRY = process.env.ACCESS_TOKEN_EXPIRY || '15m';
const REFRESH_EXPIRY = process.env.REFRESH_TOKEN_EXPIRY || '7d';
const ISSUER = 'sentinel-os';

export interface TokenPayload {
  sub: string;
  username: string;
  role: Role;
  clearance: ClassificationLevel;
  sess: string;
  type: 'access' | 'refresh';
}

export function generateAccessToken(user: { id: string; username: string; role: Role; clearance: ClassificationLevel }, sessionId: string): string {
  const payload: TokenPayload = {
    sub: user.id, username: user.username, role: user.role,
    clearance: user.clearance, sess: sessionId, type: 'access',
  };
  const opts: SignOptions = {
    algorithm: privateKey.includes('-----BEGIN') ? 'RS256' : 'HS256',
    expiresIn: ACCESS_EXPIRY as any, issuer: ISSUER, subject: user.id,
  };
  return jwt.sign(payload, privateKey, opts);
}

export function generateRefreshToken(user: { id: string; username: string; role: Role; clearance: ClassificationLevel }, sessionId: string): string {
  const payload: TokenPayload = {
    sub: user.id, username: user.username, role: user.role,
    clearance: user.clearance, sess: sessionId, type: 'refresh',
  };
  const opts: SignOptions = {
    algorithm: privateKey.includes('-----BEGIN') ? 'RS256' : 'HS256',
    expiresIn: REFRESH_EXPIRY as any, issuer: ISSUER, subject: user.id,
  };
  return jwt.sign(payload, privateKey, opts);
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, publicKey, {
      algorithms: [privateKey.includes('-----BEGIN') ? 'RS256' : 'HS256'],
      issuer: ISSUER,
    }) as TokenPayload;
  } catch {
    return null;
  }
}

export function decodeTokenHeader(token: string): { typ?: string; alg?: string; kid?: string } | null {
  try {
    return jwt.decode(token, { complete: true })?.header ?? null;
  } catch {
    return null;
  }
}

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import { readFileSync } from 'fs';
import { v4 as uuid } from 'uuid';
import { pino } from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info', name: 'auth-service' });
const PORT = parseInt(process.env.PORT || '4001', 10);

const pgPool = new Pool({
  host: process.env.PG_HOST,
  port: parseInt(process.env.PG_PORT || '5432', 10),
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER || 'sentinel_admin',
  password: process.env.PG_PASSWORD,
  max: 20,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined,
});

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

let JWT_PRIVATE_KEY: string;
let JWT_PUBLIC_KEY: string;
try {
  JWT_PRIVATE_KEY = readFileSync(process.env.JWT_PRIVATE_KEY_PATH || '/etc/sentinel/jwt/private.pem', 'utf-8');
  JWT_PUBLIC_KEY = readFileSync(process.env.JWT_PUBLIC_KEY_PATH || '/etc/sentinel/jwt/public.pem', 'utf-8');
} catch {
  JWT_PRIVATE_KEY = process.env.JWT_SECRET || 'sentinel-dev-secret-change-in-production';
  JWT_PUBLIC_KEY = JWT_PRIVATE_KEY;
}

const ACCESS_TOKEN_EXPIRY = process.env.ACCESS_TOKEN_EXPIRY || '15m';
const REFRESH_TOKEN_EXPIRY = process.env.REFRESH_TOKEN_EXPIRY || '7d';
const MAX_LOGIN_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10);
const LOCKOUT_DURATION_MINUTES = parseInt(process.env.LOCKOUT_DURATION_MINUTES || '30', 10);
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);

function generateAccessToken(user: any): string {
  const payload = {
    sub: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    organizationId: user.organization_id,
    clearanceLevel: user.clearance_level,
    permissions: user.permissions || [],
    iss: 'sentinel-os-auth',
    aud: 'sentinel-api',
    jti: uuid(),
  };
  return jwt.sign(payload, JWT_PRIVATE_KEY, {
    algorithm: JWT_PRIVATE_KEY.includes('BEGIN') ? 'RS256' : 'HS256',
    expiresIn: ACCESS_TOKEN_EXPIRY as any,
  });
}

function generateRefreshToken(userId: string, sessionId: string): string {
  return jwt.sign(
    { sub: userId, sid: sessionId, type: 'refresh', jti: uuid() },
    JWT_PRIVATE_KEY,
    { algorithm: JWT_PRIVATE_KEY.includes('BEGIN') ? 'RS256' : 'HS256', expiresIn: REFRESH_TOKEN_EXPIRY as any },
  );
}

async function bootstrap(): Promise<void> {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: process.env.CORS_ORIGINS?.split(',') || ['https://sentinel.internal'], credentials: true }));
  app.use(express.json());

  app.post('/api/v1/auth/login', async (req, res) => {
    const { username, password, orgShortCode, mfaCode } = req.body;
    if (!username || !password || !orgShortCode) {
      return res.status(400).json({ error: 'username, password, and orgShortCode required' });
    }

    try {
      const lockKey = `sentinel:auth:lockout:${username}`;
      const lockout = await redis.get(lockKey);
      if (lockout && parseInt(lockout) >= MAX_LOGIN_ATTEMPTS) {
        const ttl = await redis.ttl(lockKey);
        return res.status(429).json({ error: 'Account locked', retryAfterSeconds: ttl });
      }

      const userResult = await pgPool.query(
        `SELECT u.*, o.short_code FROM users u
         JOIN organizations o ON u.organization_id = o.id
         WHERE u.username = $1 AND o.short_code = $2 AND u.is_active = true AND o.is_active = true`,
        [username, orgShortCode],
      );

      if (userResult.rows.length === 0) {
        await redis.incr(lockKey);
        await redis.expire(lockKey, LOCKOUT_DURATION_MINUTES * 60);
        await auditLog('LOGIN_FAILED', null, { username, orgShortCode, reason: 'user_not_found' }, req);
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const user = userResult.rows[0];
      const validPassword = await bcrypt.compare(password, user.password_hash);
      if (!validPassword) {
        await redis.incr(lockKey);
        await redis.expire(lockKey, LOCKOUT_DURATION_MINUTES * 60);
        await auditLog('LOGIN_FAILED', user.id, { reason: 'invalid_password' }, req);
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      if (user.mfa_enabled) {
        if (!mfaCode) {
          return res.status(200).json({ mfaRequired: true, mfaType: user.mfa_type || 'totp' });
        }
        const verified = speakeasy.totp.verify({
          secret: user.mfa_secret,
          encoding: 'base32',
          token: mfaCode,
          window: 1,
        });
        if (!verified) {
          await auditLog('MFA_FAILED', user.id, { mfaType: user.mfa_type }, req);
          return res.status(401).json({ error: 'Invalid MFA code' });
        }
      }

      await redis.del(lockKey);

      const sessionId = uuid();
      const accessToken = generateAccessToken(user);
      const refreshToken = generateRefreshToken(user.id, sessionId);

      await pgPool.query(
        `INSERT INTO sessions (id, user_id, refresh_token_hash, ip_address, user_agent, expires_at)
         VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '7 days')`,
        [sessionId, user.id, await bcrypt.hash(refreshToken.substring(0, 32), 6), req.ip, req.headers['user-agent']],
      );

      await pgPool.query(
        `UPDATE users SET last_login_at = NOW(), failed_login_attempts = 0 WHERE id = $1`,
        [user.id],
      );

      await redis.setex(`sentinel:session:${sessionId}`, 86400 * 7, JSON.stringify({
        userId: user.id, role: user.role, organizationId: user.organization_id,
        clearanceLevel: user.clearance_level,
      }));

      await auditLog('LOGIN_SUCCESS', user.id, { sessionId }, req);

      res.json({
        accessToken,
        refreshToken,
        tokenType: 'Bearer',
        expiresIn: ACCESS_TOKEN_EXPIRY,
        user: {
          id: user.id, username: user.username, email: user.email,
          role: user.role, organizationId: user.organization_id,
          clearanceLevel: user.clearance_level,
        },
      });
    } catch (error: any) {
      logger.error({ error }, 'Login error');
      res.status(500).json({ error: 'Authentication service error' });
    }
  });

  app.post('/api/v1/auth/refresh', async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });

    try {
      const decoded = jwt.verify(refreshToken, JWT_PUBLIC_KEY, {
        algorithms: [JWT_PUBLIC_KEY.includes('BEGIN') ? 'RS256' : 'HS256'],
      }) as any;

      const sessionData = await redis.get(`sentinel:session:${decoded.sid}`);
      if (!sessionData) return res.status(401).json({ error: 'Session expired' });

      const userResult = await pgPool.query(
        'SELECT * FROM users WHERE id = $1 AND is_active = true', [decoded.sub],
      );
      if (userResult.rows.length === 0) return res.status(401).json({ error: 'User not found' });

      const user = userResult.rows[0];
      const newAccessToken = generateAccessToken(user);

      res.json({ accessToken: newAccessToken, tokenType: 'Bearer', expiresIn: ACCESS_TOKEN_EXPIRY });
    } catch (error: any) {
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Refresh token expired' });
      }
      res.status(401).json({ error: 'Invalid refresh token' });
    }
  });

  app.post('/api/v1/auth/logout', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(200).json({ success: true });

    try {
      const token = authHeader.replace('Bearer ', '');
      const decoded = jwt.verify(token, JWT_PUBLIC_KEY, {
        algorithms: [JWT_PUBLIC_KEY.includes('BEGIN') ? 'RS256' : 'HS256'],
      }) as any;

      await redis.setex(`sentinel:blacklist:${decoded.jti}`, 86400, '1');
      const sessions = await pgPool.query(
        'SELECT id FROM sessions WHERE user_id = $1 AND is_active = true', [decoded.sub],
      );
      for (const session of sessions.rows) {
        await redis.del(`sentinel:session:${session.id}`);
      }
      await pgPool.query('UPDATE sessions SET is_active = false WHERE user_id = $1', [decoded.sub]);
      await auditLog('LOGOUT', decoded.sub, {}, req);
    } catch { /* token invalid, still logout */ }

    res.json({ success: true });
  });

  app.post('/api/v1/auth/mfa/setup', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const decoded = jwt.verify(authHeader.replace('Bearer ', ''), JWT_PUBLIC_KEY) as any;
      const secret = speakeasy.generateSecret({
        name: `Sentinel OS (${decoded.username})`,
        issuer: 'Sentinel OS',
        length: 32,
      });

      await pgPool.query(
        'UPDATE users SET mfa_secret = $2, mfa_type = $3 WHERE id = $1',
        [decoded.sub, secret.base32, 'totp'],
      );

      const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url || '');

      res.json({
        secret: secret.base32,
        qrCode: qrCodeUrl,
        backupCodes: Array.from({ length: 10 }, () =>
          Array.from({ length: 8 }, () => Math.floor(Math.random() * 36).toString(36)).join('').toUpperCase()
        ),
      });
    } catch {
      res.status(401).json({ error: 'Invalid token' });
    }
  });

  app.post('/api/v1/auth/mfa/verify', async (req, res) => {
    const authHeader = req.headers.authorization;
    const { code } = req.body;
    if (!authHeader || !code) return res.status(400).json({ error: 'Authorization and code required' });

    try {
      const decoded = jwt.verify(authHeader.replace('Bearer ', ''), JWT_PUBLIC_KEY) as any;
      const userResult = await pgPool.query('SELECT mfa_secret FROM users WHERE id = $1', [decoded.sub]);
      if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });

      const verified = speakeasy.totp.verify({
        secret: userResult.rows[0].mfa_secret,
        encoding: 'base32',
        token: code,
        window: 1,
      });

      if (verified) {
        await pgPool.query('UPDATE users SET mfa_enabled = true WHERE id = $1', [decoded.sub]);
        await auditLog('MFA_ENABLED', decoded.sub, {}, req);
        res.json({ success: true });
      } else {
        res.status(400).json({ error: 'Invalid verification code' });
      }
    } catch {
      res.status(401).json({ error: 'Invalid token' });
    }
  });

  app.post('/api/v1/auth/api-keys', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const decoded = jwt.verify(authHeader.replace('Bearer ', ''), JWT_PUBLIC_KEY) as any;
      const { name, scopes, expiresInDays } = req.body;

      const rawKey = `sentinel_${uuid().replace(/-/g, '')}`;
      const keyHash = await bcrypt.hash(rawKey, 10);
      const prefix = rawKey.substring(0, 12);

      const result = await pgPool.query(
        `INSERT INTO api_keys (user_id, organization_id, name, key_hash, key_prefix, scopes, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '${expiresInDays || 365} days')
         RETURNING id, name, key_prefix, scopes, created_at, expires_at`,
        [decoded.sub, decoded.organizationId, name, keyHash, prefix, scopes || ['read']],
      );

      await auditLog('API_KEY_CREATED', decoded.sub, { keyId: result.rows[0].id, name }, req);

      res.status(201).json({
        ...result.rows[0],
        key: rawKey,
        warning: 'Store this key securely. It will not be shown again.',
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/v1/auth/verify', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ valid: false });

    try {
      const token = authHeader.replace('Bearer ', '');
      const decoded = jwt.verify(token, JWT_PUBLIC_KEY, {
        algorithms: [JWT_PUBLIC_KEY.includes('BEGIN') ? 'RS256' : 'HS256'],
      }) as any;

      const blacklisted = await redis.get(`sentinel:blacklist:${decoded.jti}`);
      if (blacklisted) return res.status(401).json({ valid: false, error: 'Token revoked' });

      res.json({ valid: true, user: decoded });
    } catch (error: any) {
      res.status(401).json({ valid: false, error: error.message });
    }
  });

  app.get('/.well-known/jwks.json', (_req, res) => {
    if (JWT_PUBLIC_KEY.includes('BEGIN')) {
      res.json({ keys: [{ kty: 'RSA', use: 'sig', alg: 'RS256', kid: 'sentinel-primary' }] });
    } else {
      res.status(404).json({ error: 'JWKS not available in symmetric mode' });
    }
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  });

  async function auditLog(action: string, userId: string | null, details: any, req: any) {
    try {
      await pgPool.query(
        `INSERT INTO audit_logs (user_id, action, resource_type, details, ip_address, user_agent)
         VALUES ($1, $2, 'auth', $3, $4, $5)`,
        [userId, action, JSON.stringify(details), req.ip, req.headers?.['user-agent']],
      );
    } catch (error) {
      logger.error({ error, action }, 'Audit log failed');
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Auth Service ready at http://0.0.0.0:${PORT}`);
  });

  process.on('SIGTERM', async () => {
    await pgPool.end();
    redis.disconnect();
    process.exit(0);
  });
}

bootstrap().catch((error) => {
  logger.fatal({ error }, 'Failed to start Auth Service');
  process.exit(1);
});

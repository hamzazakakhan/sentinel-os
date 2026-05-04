// ──────────────────────────────────────────────────────────────
// sentinel-os/services/auth-service/src/controllers/auth.ts
// Auth controllers: login, register, token refresh, MFA, API keys
// ──────────────────────────────────────────────────────────────

import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { v4 as uuid } from 'uuid';
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { Role, ClassificationLevel, User } from '../models/user';
import { generateAccessToken, generateRefreshToken, verifyToken } from '../providers/jwt';
import { generateMfaSecret, verifyMfaToken, verifyBackupCode } from '../providers/mfa';

const BCRYPT_ROUNDS = 12;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 30;

export class AuthController {
  constructor(private pg: Pool, private redis: Redis) {}

  async register(req: Request, res: Response): Promise<void> {
    const { username, email, password, role, clearance } = req.body;
    if (!username || !email || !password) {
      res.status(400).json({ error: 'username, email, and password are required' });
      return;
    }
    const userRole = Object.values(Role).includes(role) ? role : Role.OPERATOR;
    const userClearance = Object.values(ClassificationLevel).includes(clearance) ? clearance : ClassificationLevel.UNCLASSIFIED;

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const id = uuid();

    try {
      await this.pg.query(
        `INSERT INTO auth_users (id, username, email, password_hash, role, clearance, mfa_enabled, is_active, is_locked, login_attempts, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, false, true, false, 0, NOW(), NOW())`,
        [id, username, email, hash, userRole, userClearance],
      );
      const sessionId = uuid();
      const user = { id, username, role: userRole, clearance: userClearance };
      const accessToken = generateAccessToken(user, sessionId);
      const refreshToken = generateRefreshToken(user, sessionId);

      await this.redis.set(`session:${sessionId}:${id}`, refreshToken, 'EX', 7 * 24 * 3600);
      res.status(201).json({ user: { id, username, email, role: userRole, clearance: userClearance }, accessToken, refreshToken });
    } catch (err: any) {
      if (err.code === '23505') {
        res.status(409).json({ error: 'Username or email already exists' });
      } else {
        res.status(500).json({ error: 'Registration failed' });
      }
    }
  }

  async login(req: Request, res: Response): Promise<void> {
    const { username, password, mfa_token } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: 'username and password required' });
      return;
    }

    const result = await this.pg.query('SELECT * FROM auth_users WHERE username = $1', [username]);
    const user = result.rows[0] as User | undefined;
    if (!user) { res.status(401).json({ error: 'Invalid credentials' }); return; }

    // Check lockout
    if (user.is_locked) {
      const lockKey = `lockout:${user.id}`;
      const ttl = await this.redis.ttl(lockKey);
      if (ttl > 0) { res.status(423).json({ error: 'Account locked', lockout_remaining_sec: ttl }); return; }
      await this.pg.query('UPDATE auth_users SET is_locked = false, login_attempts = 0 WHERE id = $1', [user.id]);
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      const attempts = (user.login_attempts || 0) + 1;
      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        await this.pg.query('UPDATE auth_users SET is_locked = true, login_attempts = $1 WHERE id = $2', [attempts, user.id]);
        await this.redis.set(`lockout:${user.id}`, '1', 'EX', LOCKOUT_MINUTES * 60);
        res.status(423).json({ error: 'Account locked due to too many failed attempts' });
      } else {
        await this.pg.query('UPDATE auth_users SET login_attempts = $1 WHERE id = $2', [attempts, user.id]);
        res.status(401).json({ error: 'Invalid credentials', attempts_remaining: MAX_LOGIN_ATTEMPTS - attempts });
      }
      return;
    }

    // MFA check
    if (user.mfa_enabled) {
      if (!mfa_token) { res.status(200).json({ mfa_required: true, user_id: user.id }); return; }
      const mfaValid = verifyMfaToken(user.mfa_secret!, mfa_token) ||
        verifyBackupCode(user.mfa_backup_codes || [], mfa_token).valid;
      if (!mfaValid) { res.status(401).json({ error: 'Invalid MFA token' }); return; }
    }

    await this.pg.query('UPDATE auth_users SET login_attempts = 0, is_locked = false, last_login_at = NOW(), last_login_ip = $1 WHERE id = $2',
      [req.ip, user.id]);

    const sessionId = uuid();
    const tokenUser = { id: user.id, username: user.username, role: user.role as Role, clearance: user.clearance as ClassificationLevel };
    const accessToken = generateAccessToken(tokenUser, sessionId);
    const refreshToken = generateRefreshToken(tokenUser, sessionId);
    await this.redis.set(`session:${sessionId}:${user.id}`, refreshToken, 'EX', 7 * 24 * 3600);

    res.json({ accessToken, refreshToken, user: { id: user.id, username: user.username, role: user.role, clearance: user.clearance } });
  }

  async refreshToken(req: Request, res: Response): Promise<void> {
    const { refreshToken } = req.body;
    if (!refreshToken) { res.status(400).json({ error: 'refreshToken required' }); return; }

    const payload = verifyToken(refreshToken);
    if (!payload || payload.type !== 'refresh') { res.status(401).json({ error: 'Invalid refresh token' }); return; }

    const sessionKey = `session:${payload.sess}:${payload.sub}`;
    const stored = await this.redis.get(sessionKey);
    if (!stored) { res.status(401).json({ error: 'Session expired' }); return; }

    const sessionId = uuid();
    const user = { id: payload.sub, username: payload.username, role: payload.role, clearance: payload.clearance };
    const newAccess = generateAccessToken(user, sessionId);
    const newRefresh = generateRefreshToken(user, sessionId);

    await this.redis.del(sessionKey);
    await this.redis.set(`session:${sessionId}:${user.id}`, newRefresh, 'EX', 7 * 24 * 3600);
    res.json({ accessToken: newAccess, refreshToken: newRefresh });
  }

  async setupMfa(req: Request, res: Response): Promise<void> {
    const userId = (req as any).user?.sub;
    if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }

    const userResult = await this.pg.query('SELECT username, mfa_enabled FROM auth_users WHERE id = $1', [userId]);
    const user = userResult.rows[0];
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    const mfaSetup = generateMfaSecret(user.username);
    await this.pg.query('UPDATE auth_users SET mfa_secret = $1, mfa_backup_codes = $2 WHERE id = $3',
      [mfaSetup.secret, JSON.stringify(mfaSetup.backup_codes), userId]);

    res.json({ secret: mfaSetup.secret, otpauth_url: mfaSetup.otpauth_url, qr_code: mfaSetup.qr_code_data_url, backup_codes: mfaSetup.backup_codes });
  }

  async enableMfa(req: Request, res: Response): Promise<void> {
    const userId = (req as any).user?.sub;
    const { token } = req.body;
    const userResult = await this.pg.query('SELECT mfa_secret FROM auth_users WHERE id = $1', [userId]);
    const user = userResult.rows[0];
    if (!user?.mfa_secret) { res.status(400).json({ error: 'MFA not set up' }); return; }

    if (!verifyMfaToken(user.mfa_secret, token)) { res.status(401).json({ error: 'Invalid MFA token' }); return; }
    await this.pg.query('UPDATE auth_users SET mfa_enabled = true WHERE id = $1', [userId]);
    res.json({ enabled: true });
  }

  async createApiKey(req: Request, res: Response): Promise<void> {
    const userId = (req as any).user?.sub;
    const { name, scopes, expires_in_days } = req.body;
    if (!name || !scopes?.length) { res.status(400).json({ error: 'name and scopes required' }); return; }

    const rawKey = `snt_${uuid().replace(/-/g, '')}`;
    const prefix = rawKey.substring(0, 8);
    const keyHash = await bcrypt.hash(rawKey, BCRYPT_ROUNDS);
    const id = uuid();
    const expiresAt = expires_in_days ? new Date(Date.now() + expires_in_days * 86400000) : null;

    await this.pg.query(
      `INSERT INTO auth_api_keys (id, user_id, prefix, key_hash, name, scopes, expires_at, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW())`,
      [id, userId, prefix, keyHash, name, scopes, expiresAt],
    );
    res.status(201).json({ id, key: rawKey, prefix, name, scopes, expires_at: expiresAt });
  }

  async listApiKeys(req: Request, res: Response): Promise<void> {
    const userId = (req as any).user?.sub;
    const result = await this.pg.query(
      'SELECT id, prefix, name, scopes, expires_at, last_used_at, is_active, created_at FROM auth_api_keys WHERE user_id = $1 ORDER BY created_at DESC',
      [userId],
    );
    res.json({ keys: result.rows });
  }

  async revokeApiKey(req: Request, res: Response): Promise<void> {
    const userId = (req as any).user?.sub;
    const { key_id } = req.params;
    await this.pg.query('UPDATE auth_api_keys SET is_active = false WHERE id = $1 AND user_id = $2', [key_id, userId]);
    res.json({ revoked: true });
  }

  async me(req: Request, res: Response): Promise<void> {
    const userId = (req as any).user?.sub;
    const result = await this.pg.query(
      'SELECT id, username, email, role, clearance, mfa_enabled, is_active, last_login_at, created_at FROM auth_users WHERE id = $1',
      [userId],
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'User not found' }); return; }
    res.json({ user: result.rows[0] });
  }

  async logout(req: Request, res: Response): Promise<void> {
    const payload = (req as any).user;
    if (payload?.sess && payload?.sub) {
      await this.redis.del(`session:${payload.sess}:${payload.sub}`);
    }
    res.json({ logged_out: true });
  }
}

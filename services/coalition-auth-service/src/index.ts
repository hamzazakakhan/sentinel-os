// Coalition Authentication Service — OIDC-style JWT issuer for FMN partners
// - Federated identity for coalition partners (US, UK, FRA, GER, AUS, NZL, CAN, ...)
// - Argon2id password hashing
// - RS256 JWT (compatible with any standard OIDC client)
// - Discovery endpoint /.well-known/openid-configuration
// - JWKS endpoint /jwks
// - ABAC claims: nation, clearance, caveats[], coi[]
import express from 'express';
import * as jose from 'jose';
import argon2 from 'argon2';
import pg from 'pg';
import pino from 'pino';
import crypto from 'node:crypto';

const logger = pino({ name: 'coalition-auth-service' });
const PORT = parseInt(process.env.PORT || '8095', 10);
const PG_URL = process.env.DATABASE_URL || 'postgres://sentinel:sentinel@localhost:5432/sentinel';
const ISSUER = process.env.OIDC_ISSUER || `http://localhost:${PORT}`;
const TOKEN_TTL_SEC = parseInt(process.env.TOKEN_TTL_SEC || '3600', 10);

const pool = new pg.Pool({ connectionString: PG_URL, max: 10 });

// ── Key management (RS256) ────────────────────────────────────
let privateKey: jose.KeyLike;
let publicKey: jose.KeyLike;
let kid: string;
async function loadOrGenerateKeys() {
  await pool.query(`CREATE TABLE IF NOT EXISTS oidc_keys (
    kid TEXT PRIMARY KEY, alg TEXT NOT NULL, public_jwk JSONB NOT NULL,
    private_pem TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`);
  const r = await pool.query('SELECT * FROM oidc_keys ORDER BY created_at DESC LIMIT 1');
  if (r.rowCount && r.rows[0]) {
    const row = r.rows[0];
    kid = row.kid;
    privateKey = await jose.importPKCS8(row.private_pem, row.alg) as jose.KeyLike;
    publicKey = await jose.importJWK(row.public_jwk, row.alg) as jose.KeyLike;
    logger.info({ kid }, 'OIDC keys loaded from DB');
    return;
  }
  const pair = await jose.generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey;
  publicKey = pair.publicKey;
  kid = crypto.randomUUID();
  const privatePem = await jose.exportPKCS8(privateKey);
  const publicJwk = await jose.exportJWK(publicKey);
  publicJwk.kid = kid; publicJwk.use = 'sig'; publicJwk.alg = 'RS256';
  await pool.query('INSERT INTO oidc_keys(kid,alg,public_jwk,private_pem) VALUES($1,$2,$3,$4)',
    [kid, 'RS256', publicJwk, privatePem]);
  logger.info({ kid }, 'OIDC keys generated and persisted');
}

// ── User schema ───────────────────────────────────────────────
async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS coalition_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nation TEXT NOT NULL,           -- ISO 3166 alpha-3 (USA, GBR, FRA, ...)
      clearance TEXT NOT NULL,        -- UNCLASSIFIED, CONFIDENTIAL, SECRET, TOP_SECRET
      caveats TEXT[] DEFAULT '{}',    -- e.g., NOFORN, REL TO FVEY
      coi TEXT[] DEFAULT '{}',        -- communities of interest
      roles TEXT[] DEFAULT '{}',      -- analyst, operator, commander, admin
      enabled BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_login TIMESTAMPTZ);
    CREATE TABLE IF NOT EXISTS coalition_sessions (
      jti UUID PRIMARY KEY,
      user_id UUID REFERENCES coalition_users(id) ON DELETE CASCADE,
      issued_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      revoked BOOLEAN DEFAULT FALSE);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON coalition_sessions(user_id);
  `);
  logger.info('coalition auth schema ready');
}

// Seed default users (operator/sentinel, commander/sentinel)
async function seedDefaultUsers() {
  const r = await pool.query('SELECT COUNT(*) FROM coalition_users');
  if (Number(r.rows[0].count) > 0) return;
  const users = [
    { u: 'sentinel', p: 'sentinel', nation: 'USA', clearance: 'SECRET', roles: ['admin','operator','analyst'], caveats: ['NOFORN'], coi: ['SENTINEL_OPS'] },
    { u: 'commander', p: 'sentinel', nation: 'USA', clearance: 'TOP_SECRET', roles: ['commander','operator'], caveats: ['NOFORN'], coi: ['SENTINEL_OPS'] },
    { u: 'analyst', p: 'sentinel', nation: 'GBR', clearance: 'SECRET', roles: ['analyst'], caveats: ['REL TO FVEY'], coi: ['CYBER_TI'] },
    { u: 'partner_fra', p: 'sentinel', nation: 'FRA', clearance: 'CONFIDENTIAL', roles: ['analyst'], caveats: ['REL TO NATO'], coi: ['NATO_CFI'] },
  ];
  for (const u of users) {
    const hash = await argon2.hash(u.p, { type: argon2.argon2id });
    await pool.query(
      `INSERT INTO coalition_users(username,password_hash,nation,clearance,roles,caveats,coi)
       VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(username) DO NOTHING`,
      [u.u, hash, u.nation, u.clearance, u.roles, u.caveats, u.coi]);
  }
  logger.info('Seeded 4 default coalition users');
}

// ── HTTP API ──────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (_q, r) => r.json({ status: 'ok', service: 'coalition-auth-service' }));

app.get('/.well-known/openid-configuration', (_q, r) => {
  r.json({
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: `${ISSUER}/token`,
    userinfo_endpoint: `${ISSUER}/userinfo`,
    jwks_uri: `${ISSUER}/jwks`,
    introspection_endpoint: `${ISSUER}/introspect`,
    response_types_supported: ['code', 'token', 'id_token'],
    grant_types_supported: ['password', 'refresh_token', 'client_credentials'],
    id_token_signing_alg_values_supported: ['RS256'],
    scopes_supported: ['openid', 'profile', 'email', 'coalition'],
    claims_supported: ['sub','iss','aud','exp','iat','nation','clearance','caveats','coi','roles','username'],
  });
});

app.get('/jwks', async (_q, r) => {
  const jwk = await jose.exportJWK(publicKey);
  jwk.kid = kid; jwk.use = 'sig'; jwk.alg = 'RS256';
  r.json({ keys: [jwk] });
});

// OIDC password grant for coalition partners
app.post('/token', async (req, res) => {
  const { grant_type, username, password } = req.body;
  if (grant_type !== 'password') return res.status(400).json({ error: 'unsupported_grant_type' });
  if (!username || !password) return res.status(400).json({ error: 'invalid_request' });

  const u = await pool.query('SELECT * FROM coalition_users WHERE username=$1 AND enabled=TRUE', [username]);
  if (!u.rowCount) return res.status(401).json({ error: 'invalid_grant' });
  const user = u.rows[0];
  const ok = await argon2.verify(user.password_hash, password).catch(() => false);
  if (!ok) return res.status(401).json({ error: 'invalid_grant' });

  await pool.query('UPDATE coalition_users SET last_login=NOW() WHERE id=$1', [user.id]);
  const jti = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const exp = now + TOKEN_TTL_SEC;
  await pool.query('INSERT INTO coalition_sessions(jti,user_id,expires_at) VALUES($1,$2,to_timestamp($3))',
    [jti, user.id, exp]);

  const accessToken = await new jose.SignJWT({
    sub: user.id, username: user.username,
    nation: user.nation, clearance: user.clearance,
    caveats: user.caveats, coi: user.coi, roles: user.roles,
    scope: 'openid profile coalition',
  })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(ISSUER).setAudience('sentinel-os')
    .setSubject(user.id).setJti(jti)
    .setIssuedAt(now).setExpirationTime(exp).sign(privateKey);

  const idToken = await new jose.SignJWT({
    sub: user.id, username: user.username, nation: user.nation, clearance: user.clearance,
  })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(ISSUER).setAudience('sentinel-os')
    .setSubject(user.id).setIssuedAt(now).setExpirationTime(exp).sign(privateKey);

  res.json({
    access_token: accessToken, id_token: idToken, token_type: 'Bearer',
    expires_in: TOKEN_TTL_SEC, scope: 'openid profile coalition',
  });
});

app.get('/userinfo', async (req, res) => {
  const auth = req.header('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'invalid_token' });
  try {
    const { payload } = await jose.jwtVerify(token, publicKey, { issuer: ISSUER, audience: 'sentinel-os' });
    res.json({
      sub: payload.sub, username: payload.username, nation: payload.nation,
      clearance: payload.clearance, caveats: payload.caveats, coi: payload.coi, roles: payload.roles,
    });
  } catch { res.status(401).json({ error: 'invalid_token' }); }
});

app.post('/introspect', async (req, res) => {
  const token = req.body.token;
  if (!token) return res.json({ active: false });
  try {
    const { payload } = await jose.jwtVerify(token, publicKey, { issuer: ISSUER, audience: 'sentinel-os' });
    if (payload.jti) {
      const s = await pool.query('SELECT revoked FROM coalition_sessions WHERE jti=$1', [payload.jti]);
      if (s.rows[0]?.revoked) return res.json({ active: false });
    }
    res.json({ active: true, ...payload });
  } catch { res.json({ active: false }); }
});

app.post('/revoke', async (req, res) => {
  const { jti } = req.body;
  if (!jti) return res.status(400).json({ error: 'jti required' });
  await pool.query('UPDATE coalition_sessions SET revoked=TRUE WHERE jti=$1', [jti]);
  res.json({ revoked: true });
});

app.get('/users', async (_q, r) => {
  const u = await pool.query('SELECT id,username,nation,clearance,caveats,coi,roles,enabled,last_login FROM coalition_users ORDER BY username');
  r.json({ count: u.rowCount, users: u.rows });
});

app.post('/users', async (req, res) => {
  const { username, password, nation, clearance, roles, caveats, coi } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username,password required' });
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  try {
    const r = await pool.query(
      `INSERT INTO coalition_users(username,password_hash,nation,clearance,roles,caveats,coi)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,username,nation,clearance,roles,caveats,coi`,
      [username, hash, nation ?? 'USA', clearance ?? 'UNCLASSIFIED',
       roles ?? ['analyst'], caveats ?? [], coi ?? []]);
    res.json(r.rows[0]);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

async function main() {
  await initSchema();
  await loadOrGenerateKeys();
  await seedDefaultUsers();
  app.listen(PORT, () => logger.info({ port: PORT, issuer: ISSUER }, 'coalition-auth-service listening'));
}
main().catch((err) => { logger.error({ err }, 'startup failed'); process.exit(1); });

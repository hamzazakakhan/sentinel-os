// ──────────────────────────────────────────────────────────────
// sentinel-os/services/auth-service/src/models/user.ts
// User model with RBAC roles and classification levels
// ──────────────────────────────────────────────────────────────

export enum Role {
  OPERATOR = 'OPERATOR',
  ANALYST = 'ANALYST',
  COMMANDER = 'COMMANDER',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
}

export enum ClassificationLevel {
  UNCLASSIFIED = 'UNCLASSIFIED',
  CUI = 'CUI',
  CONFIDENTIAL = 'CONFIDENTIAL',
  SECRET = 'SECRET',
  TOP_SECRET = 'TOP_SECRET',
  TOP_SECRET_SCI = 'TOP_SECRET_SCI',
}

export interface User {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  role: Role;
  clearance: ClassificationLevel;
  mfa_enabled: boolean;
  mfa_secret?: string;
  mfa_backup_codes?: string[];
  is_active: boolean;
  is_locked: boolean;
  login_attempts: number;
  last_login_at?: Date;
  last_login_ip?: string;
  created_at: Date;
  updated_at: Date;
}

export interface ApiKey {
  id: string;
  user_id: string;
  prefix: string;
  key_hash: string;
  name: string;
  scopes: string[];
  expires_at?: Date;
  last_used_at?: Date;
  is_active: boolean;
  created_at: Date;
}

export interface Session {
  id: string;
  user_id: string;
  refresh_token_hash: string;
  device_info?: string;
  ip_address: string;
  expires_at: Date;
  created_at: Date;
}

export interface AuditLog {
  id: string;
  user_id?: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  details: Record<string, unknown>;
  ip_address: string;
  user_agent?: string;
  created_at: Date;
}

export const ROLE_HIERARCHY: Record<Role, Role[]> = {
  [Role.OPERATOR]: [Role.OPERATOR],
  [Role.ANALYST]: [Role.OPERATOR, Role.ANALYST],
  [Role.COMMANDER]: [Role.OPERATOR, Role.ANALYST, Role.COMMANDER],
  [Role.ADMIN]: [Role.OPERATOR, Role.ANALYST, Role.COMMANDER, Role.ADMIN],
  [Role.SUPER_ADMIN]: [Role.OPERATOR, Role.ANALYST, Role.COMMANDER, Role.ADMIN, Role.SUPER_ADMIN],
};

export function hasRole(userRole: Role, requiredRole: Role): boolean {
  return ROLE_HIERARCHY[userRole]?.includes(requiredRole) ?? false;
}

export function canAccessClassification(userClearance: ClassificationLevel, requiredLevel: ClassificationLevel): boolean {
  const levels = Object.values(ClassificationLevel);
  return levels.indexOf(userClearance) >= levels.indexOf(requiredLevel);
}

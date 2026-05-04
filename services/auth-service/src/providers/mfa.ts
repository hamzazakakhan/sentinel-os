// ──────────────────────────────────────────────────────────────
// sentinel-os/services/auth-service/src/providers/mfa.ts
// TOTP MFA (RFC 6238) with backup code generation
// ──────────────────────────────────────────────────────────────

import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import { v4 as uuid } from 'uuid';

export interface MFASetupResult {
  secret: string;
  otpauth_url: string;
  qr_code_data_url: string;
  backup_codes: string[];
}

export function generateMfaSecret(username: string): MFASetupResult {
  const secret = speakeasy.generateSecret({
    name: `Sentinel OS (${username})`,
    issuer: 'Sentinel OS',
    length: 32,
  });

  const backupCodes = Array.from({ length: 10 }, () =>
    Array.from({ length: 4 }, () => Math.random().toString(36).substring(2, 6).toUpperCase()).join('-')
  );

  const otpauthUrl = speakeasy.otpauthURL({
    secret: secret.base32,
    label: `Sentinel OS (${username})`,
    issuer: 'Sentinel OS',
    encoding: 'base32',
  });

  const qrDataUrl = qrcode.toDataURL(otpauthUrl);

  return {
    secret: secret.base32,
    otpauth_url: otpauthUrl,
    qr_code_data_url: qrDataUrl as unknown as string,
    backup_codes: backupCodes,
  };
}

export function verifyMfaToken(secret: string, token: string, window: number = 1): boolean {
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token,
    window,
  });
}

export function verifyBackupCode(backupCodes: string[], code: string): { valid: boolean; remaining: string[] } {
  const idx = backupCodes.indexOf(code);
  if (idx === -1) return { valid: false, remaining: backupCodes };
  const remaining = [...backupCodes];
  remaining.splice(idx, 1);
  return { valid: true, remaining };
}

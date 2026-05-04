// sentinel-os/shared/crypto/index.ts
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

export function encrypt(text: string, key: Buffer | string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, typeof key === 'string' ? Buffer.from(key, 'hex') : key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

export function decrypt(encrypted: string, key: Buffer | string): string {
  const [ivHex, tagHex, data] = encrypted.split(':');
  const decipher = createDecipheriv(
    ALGORITHM,
    typeof key === 'string' ? Buffer.from(key, 'hex') : key,
    Buffer.from(ivHex, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  let decrypted = decipher.update(data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function hmacSha256(data: string, key: string): string {
  return createHmac('sha256', key).update(data).digest('hex');
}

export function generateKey(): string {
  return randomBytes(32).toString('hex');
}

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}
function key() {
  const value = Buffer.from(requiredEnv('CREDENTIAL_ENCRYPTION_KEY'), 'base64');
  if (value.length !== 32) throw new Error('CREDENTIAL_ENCRYPTION_KEY must contain 32 base64-encoded bytes');
  return value;
}
export function seal(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((x) => x.toString('base64url')).join('.');
}
export function unseal<T>(value: string): T {
  const parts = value.split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted credential');
  const [iv, tag, body] = parts.map((x) => Buffer.from(x, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')) as T;
}
export function equalSecret(a: string, b: string): boolean {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function safeError(error: unknown): string {
  return error instanceof Error
    ? error.message
        .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
        .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')
        .replace(
          /((?:access_token|refresh_token|client_secret|api_key)[\"'\s]*[:=][\"'\s]*)[^\"'\s,&}]+/gi,
          '$1[redacted]',
        )
    : 'The request failed';
}

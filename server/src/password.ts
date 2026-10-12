// SEC-WEBCRON-002: 비밀번호는 복호화할 수 없는 scrypt 해시로만 저장한다.
import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;
const MAXMEM = 64 * 1024 * 1024;

export const ENC_PREFIX = 'enc:';

export function isEncrypted(value: string): boolean {
  return value.startsWith(ENC_PREFIX);
}

export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `${ENC_PREFIX}scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifyPassword(plain: string, encoded: string): Promise<boolean> {
  const m = /^enc:scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(encoded);
  if (!m) return false;
  const [n, r, p] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const salt = Buffer.from(m[4], 'base64url');
  const expected = Buffer.from(m[5], 'base64url');
  if (expected.length === 0) return false;
  const actual = await new Promise<Buffer>((resolve, reject) => {
    scrypt(plain, salt, expected.length, { N: n, r, p, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key)));
  });
  return timingSafeEqual(actual, expected);
}

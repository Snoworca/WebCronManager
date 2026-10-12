// SEC-WEBCRON-005: MCP 키는 무작위 32바이트, SHA-256 해시로만 저장한다.
import { createHash, randomBytes } from 'node:crypto';

export const KEY_PREFIX = 'wcmcp_';

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function generateKey(): { key: string; keyHash: string; prefix: string } {
  const key = KEY_PREFIX + randomBytes(32).toString('base64url');
  return { key, keyHash: hashKey(key), prefix: key.slice(0, 12) };
}

/** Authorization: Bearer <key> 헤더에서 키를 꺼낸다. */
export function bearer(header: string | undefined): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  return m && m[1].startsWith(KEY_PREFIX) ? m[1] : null;
}

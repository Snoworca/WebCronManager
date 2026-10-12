// SEC-WEBCRON-001: 세션, SEC-WEBCRON-003: 로그인 연속 실패 차단
import { randomBytes } from 'node:crypto';

export class Sessions {
  ttlMs: number;
  now: () => number;
  map = new Map<string, number>(); // token → 마지막 요청 시각

  constructor(ttlMs: number, now: () => number) {
    this.ttlMs = ttlMs;
    this.now = now;
  }

  create(): string {
    const token = randomBytes(32).toString('base64url');
    this.map.set(token, this.now());
    return token;
  }

  /** 유효하면 마지막 요청 시각을 갱신하고 true. */
  touch(token: string | undefined): boolean {
    if (!token) return false;
    const last = this.map.get(token);
    if (last === undefined) return false;
    const t = this.now();
    if (t - last > this.ttlMs) { this.map.delete(token); return false; }
    this.map.set(token, t);
    return true;
  }

  destroy(token: string | undefined): void {
    if (token) this.map.delete(token);
  }
}

export const MAX_FAILURES = 5;
export const LOCK_MS = 5 * 60_000;

export class LoginLimiter {
  now: () => number;
  map = new Map<string, { fails: number; lockedUntil: number }>();

  constructor(now: () => number) {
    this.now = now;
  }

  /** 차단 중이면 남은 초, 아니면 0 */
  lockedFor(ip: string): number {
    const e = this.map.get(ip);
    if (!e || e.lockedUntil === 0) return 0;
    const left = e.lockedUntil - this.now();
    if (left <= 0) { this.map.delete(ip); return 0; }
    return Math.ceil(left / 1000);
  }

  /** 실패를 기록하고, 이번 실패로 차단되었으면 true */
  fail(ip: string): boolean {
    const e = this.map.get(ip) ?? { fails: 0, lockedUntil: 0 };
    e.fails++;
    const locked = e.fails >= MAX_FAILURES;
    if (locked) e.lockedUntil = this.now() + LOCK_MS;
    this.map.set(ip, e);
    return locked;
  }

  success(ip: string): void {
    this.map.delete(ip);
  }

  failures(ip: string): number {
    return this.map.get(ip)?.fails ?? 0;
  }
}

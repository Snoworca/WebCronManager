import { go, session } from './state.svelte.ts';

export class ApiError extends Error {
  status: number;
  errors: Record<string, string>;
  constructor(status: number, message: string, errors: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export async function api<T>(method: Method, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin' };
  if (method !== 'GET') {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body ?? {});
  }
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError(0, '서버에 연결할 수 없습니다.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== '/api/login') {
    session.me = null;
    go('/login');
  }
  if (!res.ok) throw new ApiError(res.status, data.message ?? `요청 실패 (HTTP ${res.status})`, data.errors);
  return data as T;
}

export function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

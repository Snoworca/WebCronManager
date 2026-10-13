import { i18n, t } from './i18n.svelte.ts';
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
  // IR-WEBCRON-003 AC-2: 선택한 화면 언어로 서버 메시지를 받는다.
  const headers: Record<string, string> = { 'accept-language': i18n.locale };
  const init: RequestInit = { method, credentials: 'same-origin', headers };
  if (method !== 'GET') {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body ?? {});
  }
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError(0, t('common.offline'));
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== '/api/login') {
    session.me = null;
    go('/login');
  }
  if (!res.ok) throw new ApiError(res.status, data.message ?? t('common.requestFailed', { status: res.status }), data.errors);
  return data as T;
}

export function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

// FR-WEBCRON-005: 웹훅 실행, FR-WEBCRON-006: 타임아웃, FR-WEBCRON-009: 중지
import { Capped, type ExecOptions, type ExecResult, type WebhookSpec } from './types.ts';
import { ts } from '../i18n.ts';

export const MAX_REDIRECTS = 10;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

class StopError extends Error {}

interface Attempt {
  ok: boolean;
  httpStatus: number | null;
  finalUrl: string;
  redirects: number;
  body: string;
  error: string | null;
}

async function readCapped(res: Response): Promise<string> {
  const cap = new Capped();
  if (!res.body) return '';
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    cap.push(Buffer.from(value));
    if (cap.truncated) { await reader.cancel(); break; }
  }
  return cap.text();
}

async function attempt(spec: WebhookSpec, signal: AbortSignal): Promise<Attempt> {
  let url = spec.url;
  let method: string = spec.method;
  let body: string | undefined = spec.method === 'POST' ? (spec.body ?? '') : undefined;
  let redirects = 0;
  for (;;) {
    let res: Response;
    try {
      res = await fetch(url, { method, headers: spec.headers ?? {}, body, redirect: 'manual', signal });
    } catch (e) {
      if (signal.aborted) throw new StopError();
      const cause = (e as { cause?: { code?: string; message?: string } }).cause;
      return { ok: false, httpStatus: null, finalUrl: url, redirects, body: '', error: ts('exec.requestFailed', { error: cause?.code ?? cause?.message ?? (e as Error).message }) };
    }
    const location = res.headers.get('location');
    if (REDIRECT_CODES.has(res.status) && location) {
      await res.body?.cancel();
      if (redirects >= MAX_REDIRECTS) {
        return { ok: false, httpStatus: res.status, finalUrl: url, redirects, body: '', error: ts('exec.tooManyRedirects', { max: MAX_REDIRECTS }) };
      }
      redirects++;
      url = new URL(location, url).toString();
      // fetch 표준과 같은 규칙: 303은 GET으로, 301/302의 POST도 GET으로 바꾼다. 307/308은 유지한다.
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
        method = 'GET';
        body = undefined;
      }
      continue;
    }
    let text: string;
    try { text = await readCapped(res); } catch (e) {
      if (signal.aborted) throw new StopError();
      text = '';
      return { ok: false, httpStatus: res.status, finalUrl: url, redirects, body: text, error: ts('exec.readFailed', { error: (e as Error).message }) };
    }
    const ok = res.status >= 200 && res.status < 300;
    return { ok, httpStatus: res.status, finalUrl: url, redirects, body: text, error: ok ? null : `HTTP ${res.status}` };
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new StopError()); return; }
    const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(new StopError()); };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function runWebhook(spec: WebhookSpec, opts: ExecOptions & { retryDelayMs?: number }): Promise<ExecResult> {
  const timeoutCtl = new AbortController();
  const timer = opts.timeoutSec > 0 ? setTimeout(() => timeoutCtl.abort(), opts.timeoutSec * 1000) : null;
  const signal = AbortSignal.any([opts.signal, timeoutCtl.signal]);
  const maxAttempts = 1 + Math.max(0, Math.min(5, spec.retryCount ?? 0));
  let attempts = 0;
  let last: Attempt | null = null;
  try {
    while (attempts < maxAttempts) {
      if (attempts > 0) await delay(opts.retryDelayMs ?? 1000, signal);
      attempts++;
      last = await attempt(spec, signal);
      if (last.ok) break;
    }
    return {
      status: last!.ok ? 'success' : 'failure',
      httpStatus: last!.httpStatus, finalUrl: last!.finalUrl, redirects: last!.redirects,
      responseBody: last!.body, error: last!.error, attempts,
    };
  } catch (e) {
    if (!(e instanceof StopError)) throw e;
    const timedOut = timeoutCtl.signal.aborted && !opts.signal.aborted;
    return {
      status: timedOut ? 'timeout' : 'canceled',
      httpStatus: last?.httpStatus ?? null, finalUrl: last?.finalUrl ?? spec.url, redirects: last?.redirects ?? 0,
      responseBody: last?.body ?? '', attempts,
      error: timedOut ? ts('exec.timeoutHook', { sec: opts.timeoutSec }) : ts('exec.canceled'),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

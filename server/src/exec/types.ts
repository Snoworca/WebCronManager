export type RunStatus = 'running' | 'success' | 'failure' | 'timeout' | 'canceled' | 'interrupted';
export type FinalStatus = Exclude<RunStatus, 'running'>;

export interface ExecOptions {
  /** 0이면 무제한 (FR-WEBCRON-006) */
  timeoutSec: number;
  /** 중지 요청 신호 (FR-WEBCRON-009) */
  signal: AbortSignal;
}

export interface ExecResult {
  status: FinalStatus;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  httpStatus?: number | null;
  finalUrl?: string | null;
  redirects?: number;
  attempts?: number;
  responseBody?: string;
  error?: string | null;
}

export interface CliSpec {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
}

export interface WebhookSpec {
  method: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  body?: string;
  retryCount?: number;
}

/** 출력과 응답 본문 저장 한도 (FR-WEBCRON-004 AC-3, FR-WEBCRON-005 AC-6) */
export const OUTPUT_LIMIT = 64 * 1024;
export const TRUNCATED_MARK = '\n…[잘림: 64KB를 넘는 출력은 저장하지 않았습니다]';

/** 바이트 한도까지 모은 버퍼를 문자열로 바꾼다. Windows에서 UTF-8이 아니면 CP949로 해석한다. */
export function decodeOutput(buf: Buffer, truncated: boolean): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    text = process.platform === 'win32'
      ? new TextDecoder('euc-kr').decode(buf)
      : new TextDecoder('utf-8').decode(buf);
  }
  return truncated ? text + TRUNCATED_MARK : text;
}

export class Capped {
  chunks: Buffer[] = [];
  size = 0;
  truncated = false;
  push(chunk: Buffer): void {
    if (this.size >= OUTPUT_LIMIT) { this.truncated = true; return; }
    const room = OUTPUT_LIMIT - this.size;
    if (chunk.length > room) { chunk = chunk.subarray(0, room); this.truncated = true; }
    this.chunks.push(chunk);
    this.size += chunk.length;
  }
  text(): string {
    return decodeOutput(Buffer.concat(this.chunks), this.truncated);
  }
}

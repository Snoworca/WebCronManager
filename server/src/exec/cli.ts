// FR-WEBCRON-004: CLI 작업 실행, FR-WEBCRON-006: 타임아웃, FR-WEBCRON-009: 중지
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { ts } from '../i18n.ts';
import { Capped, type CliSpec, type ExecOptions, type ExecResult } from './types.ts';

export { OUTPUT_LIMIT } from './types.ts';

const isWin = process.platform === 'win32';

/** 자식 프로세스와 그 하위 프로세스를 모두 종료한다. */
export function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    if (isWin) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    else process.kill(-child.pid, 'SIGKILL'); // detached로 만든 프로세스 그룹 전체
  } catch {
    try { child.kill('SIGKILL'); } catch { /* 이미 종료됨 */ }
  }
}

export type CliResult = ExecResult & { stdout: string; stderr: string };

export function runCli(spec: CliSpec, opts: ExecOptions): Promise<CliResult> {
  if (spec.cwd && !(existsSync(spec.cwd) && statSync(spec.cwd).isDirectory())) {
    return Promise.resolve({ status: 'failure', exitCode: null, stdout: '', stderr: '', error: ts('exec.cwdMissing', { cwd: spec.cwd }) });
  }
  if (opts.signal.aborted) return Promise.resolve({ status: 'canceled', exitCode: null, stdout: '', stderr: '' });

  return new Promise((resolve) => {
    const out = new Capped();
    const err = new Capped();
    let reason: 'timeout' | 'canceled' | null = null;
    let spawnError: string | null = null;

    const child = spawn(spec.command, {
      shell: true, // Windows: cmd.exe, 그 외: /bin/sh
      cwd: spec.cwd || undefined,
      env: { ...process.env, ...(spec.env ?? {}) },
      detached: !isWin,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout!.on('data', (c: Buffer) => out.push(c));
    child.stderr!.on('data', (c: Buffer) => err.push(c));

    const stop = (why: 'timeout' | 'canceled') => {
      if (reason) return;
      reason = why;
      killTree(child);
    };
    const timer = opts.timeoutSec > 0 ? setTimeout(() => stop('timeout'), opts.timeoutSec * 1000) : null;
    const onAbort = () => stop('canceled');
    opts.signal.addEventListener('abort', onAbort, { once: true });

    child.on('error', (e) => { spawnError = e.message; });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      opts.signal.removeEventListener('abort', onAbort);
      const base = { exitCode: code, stdout: out.text(), stderr: err.text() };
      if (reason === 'timeout') resolve({ ...base, status: 'timeout', error: ts('exec.timeoutCli', { sec: opts.timeoutSec }) });
      else if (reason === 'canceled') resolve({ ...base, status: 'canceled', error: ts('exec.canceled') });
      else if (spawnError) resolve({ ...base, status: 'failure', error: ts('exec.spawnFailed', { error: spawnError }) });
      else resolve({ ...base, status: code === 0 ? 'success' : 'failure' });
    });
  });
}

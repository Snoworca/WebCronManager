import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/db.ts';
import { tempDir } from './helpers.ts';

const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url));

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
  });
}

function launch(envPath: string, lang = 'ko_KR.UTF-8') {
  const env = { ...process.env, LANG: lang, LC_ALL: '', LC_MESSAGES: '' };
  const child = spawn(process.execPath, [MAIN, '--env', envPath], { stdio: ['ignore', 'pipe', 'pipe'], env });
  let out = '';
  child.stdout.on('data', (c) => (out += c));
  child.stderr.on('data', (c) => (out += c));
  const exited = new Promise<number | null>((r) => child.on('exit', (code) => r(code)));
  const ready = async () => {
    const end = Date.now() + 15000;
    while (!/시작:/.test(out)) {
      if (Date.now() > end || child.exitCode !== null) throw new Error(`server did not start:\n${out}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  return { child, exited, ready, output: () => out };
}

test('OPS-WEBCRON-001 AC-1: 설정 파일이 없으면 템플릿을 만들고 종료 코드 1로 끝난다', async () => {
  const t = tempDir();
  try {
    const envPath = join(t.dir, '.env');
    const p = launch(envPath);
    assert.equal(await p.exited, 1);
    assert.ok(existsSync(envPath));
    assert.match(p.output(), /템플릿/);
  } finally { t.cleanup(); }
});

test('OPS-WEBCRON-003 AC-1, AC-2: 서버 로캘에 따라 콘솔 메시지와 템플릿 주석 언어가 바뀐다', async () => {
  for (const [lang, word, hangul] of [['ko_KR.UTF-8', /템플릿/, true], ['en_US.UTF-8', /template/, false]] as const) {
    const t = tempDir();
    try {
      const envPath = join(t.dir, '.env');
      const p = launch(envPath, lang);
      assert.equal(await p.exited, 1);
      assert.match(p.output(), word);
      assert.equal(/[가-힣]/.test(readFileSync(envPath, 'utf8')), hangul);
    } finally { t.cleanup(); }
  }
});

test('OPS-WEBCRON-002, REL-WEBCRON-001 AC-1, SEC-WEBCRON-002 AC-5: 시작·종료를 기록하고 재기동 후 일정을 복원한다', { skip: process.platform === 'win32' && 'SIGTERM 미지원' }, async () => {
  const t = tempDir();
  try {
    const envPath = join(t.dir, '.env');
    const port = await freePort();
    writeFileSync(envPath, `WEBCRON_PORT=${port}\nWEBCRON_PASSWORD=pw-plain-1\nWEBCRON_TIMEZONE=UTC\n`);
    const base = `http://127.0.0.1:${port}`;

    const a = launch(envPath);
    await a.ready();
    const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'pw-plain-1' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const h = { 'content-type': 'application/json', cookie };
    const created = await fetch(`${base}/api/jobs`, { method: 'POST', headers: h, body: JSON.stringify({ name: 'n', cron: '0 0 1 1 *', type: 'webhook', webhook: { method: 'GET', url: 'http://127.0.0.1:1/' } }) });
    assert.equal(created.status, 201);
    a.child.kill('SIGTERM');
    assert.equal(await a.exited, 0);

    const b = launch(envPath);
    await b.ready();
    const login2 = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'pw-plain-1' }) });
    assert.equal(login2.status, 200, '해시로 바뀐 뒤에도 같은 비밀번호로 로그인된다');
    const cookie2 = login2.headers.get('set-cookie')!.split(';')[0];
    const jobs = await (await fetch(`${base}/api/jobs`, { headers: { cookie: cookie2 } })).json() as { items: { nextRunAt: string | null }[] };
    assert.equal(jobs.items.length, 1);
    assert.ok(jobs.items[0].nextRunAt);
    b.child.kill('SIGINT');
    assert.equal(await b.exited, 0);

    const store = new Store(join(t.dir, 'data'));
    const events = store.listAudit({ page: 1 }).items.map((x) => x.event).reverse();
    store.close();
    assert.deepEqual(events.filter((e) => e.startsWith('server.') || e.startsWith('config.')),
      ['config.password_encrypted', 'server.start', 'server.stop', 'server.start', 'server.stop']);
  } finally { t.cleanup(); }
});

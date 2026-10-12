import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { runWebhook } from '../src/exec/webhook.ts';
import { OUTPUT_LIMIT } from '../src/exec/cli.ts';
import { sleep } from './helpers.ts';

interface Seen { method: string; url: string; headers: IncomingMessage['headers']; body: string }
const seen: Seen[] = [];
let server: Server;
let base = '';
let flaky = 0;

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method!, url: req.url!, headers: req.headers, body });
      const u = new URL(req.url!, 'http://x');
      const p = u.pathname;
      if (p === '/ok') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); return; }
      if (p === '/r303') { res.writeHead(303, { location: '/ok' }); res.end(); return; }
      if (p === '/r307') { res.writeHead(307, { location: '/ok' }); res.end(); return; }
      if (p === '/r301') { res.writeHead(301, { location: `${base}/r302` }); res.end(); return; }
      if (p === '/r302') { res.writeHead(302, { location: '/ok' }); res.end(); return; }
      if (p === '/loop') { const n = Number(u.searchParams.get('n') ?? 0); res.writeHead(302, { location: `/loop?n=${n + 1}` }); res.end(); return; }
      if (p === '/chain') { const left = Number(u.searchParams.get('left')); res.writeHead(302, { location: left > 1 ? `/chain?left=${left - 1}` : '/ok' }); res.end(); return; }
      if (p === '/e502') { res.writeHead(502); res.end('bad gateway'); return; }
      if (p === '/flaky') { flaky++; res.writeHead(flaky < 3 ? 500 : 200); res.end(String(flaky)); return; }
      if (p === '/big') { res.writeHead(200); res.end('y'.repeat(OUTPUT_LIMIT * 2)); return; }
      if (p === '/slow') { setTimeout(() => { if (!res.destroyed) { res.writeHead(200); res.end('late'); } }, 5000); return; }
      res.writeHead(404); res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server.closeAllConnections(); server.close(); });

const never = () => new AbortController().signal;
const opts = { timeoutSec: 0, signal: never(), retryDelayMs: 10 };

test('FR-WEBCRON-005 AC-1: GET과 본문 있는 POST를 헤더와 함께 보낸다', async () => {
  seen.length = 0;
  const g = await runWebhook({ method: 'GET', url: `${base}/ok`, headers: { 'X-Test': 'g' } }, opts);
  assert.equal(g.status, 'success');
  assert.equal(g.httpStatus, 200);
  const p = await runWebhook({ method: 'POST', url: `${base}/ok`, headers: { 'Content-Type': 'application/json', 'X-Test': 'p' }, body: '{"a":1}' }, opts);
  assert.equal(p.status, 'success');
  assert.equal(seen[0].method, 'GET');
  assert.equal(seen[0].headers['x-test'], 'g');
  assert.equal(seen[1].method, 'POST');
  assert.equal(seen[1].body, '{"a":1}');
  assert.equal(seen[1].headers['content-type'], 'application/json');
});

test('FR-WEBCRON-005 AC-2: 리다이렉트를 따라가고 최종 2xx면 성공이다', async () => {
  seen.length = 0;
  const r = await runWebhook({ method: 'GET', url: `${base}/r301` }, opts);
  assert.equal(r.status, 'success');
  assert.equal(r.redirects, 2);
  assert.equal(r.finalUrl, `${base}/ok`);
  // 303은 GET으로 바꾸고, 307은 메서드와 본문을 유지한다.
  seen.length = 0;
  await runWebhook({ method: 'POST', url: `${base}/r303`, body: 'b1' }, opts);
  assert.equal(seen.at(-1)!.method, 'GET');
  await runWebhook({ method: 'POST', url: `${base}/r307`, body: 'b2' }, opts);
  assert.equal(seen.at(-1)!.method, 'POST');
  assert.equal(seen.at(-1)!.body, 'b2');
});

test('FR-WEBCRON-005 AC-3: 리다이렉트가 10회를 넘으면 실패한다', async () => {
  const r = await runWebhook({ method: 'GET', url: `${base}/loop` }, opts);
  assert.equal(r.status, 'failure');
  assert.match(r.error ?? '', /리다이렉트/);
  const ok = await runWebhook({ method: 'GET', url: `${base}/chain?left=10` }, opts);
  assert.equal(ok.status, 'success');
  assert.equal(ok.redirects, 10);
});

test('FR-WEBCRON-005 AC-4, AC-6: 4xx/5xx는 실패이며 상태 코드와 본문을 기록한다', async () => {
  const r = await runWebhook({ method: 'GET', url: `${base}/e502` }, opts);
  assert.equal(r.status, 'failure');
  assert.equal(r.httpStatus, 502);
  assert.equal(r.responseBody, 'bad gateway');
  assert.equal(r.finalUrl, `${base}/e502`);
});

test('FR-WEBCRON-005 AC-5: 네트워크 오류는 실패와 오류 메시지를 기록한다', async () => {
  const r = await runWebhook({ method: 'GET', url: 'http://127.0.0.1:1/x' }, opts);
  assert.equal(r.status, 'failure');
  assert.ok(r.error);
});

test('FR-WEBCRON-005 AC-6: 응답 본문은 64KB까지만 저장한다', async () => {
  const r = await runWebhook({ method: 'GET', url: `${base}/big` }, opts);
  assert.equal(r.status, 'success');
  assert.ok(Buffer.byteLength(r.responseBody ?? '') <= OUTPUT_LIMIT + 200);
  assert.match(r.responseBody ?? '', /잘림/);
});

test('FR-WEBCRON-005 AC-7: 재시도 횟수만큼 다시 시도하고 시도 횟수를 기록한다', async () => {
  flaky = 0;
  const r = await runWebhook({ method: 'GET', url: `${base}/flaky`, retryCount: 3 }, opts);
  assert.equal(r.status, 'success');
  assert.equal(r.attempts, 3);
  flaky = -10;
  const f = await runWebhook({ method: 'GET', url: `${base}/flaky`, retryCount: 1 }, opts);
  assert.equal(f.status, 'failure');
  assert.equal(f.attempts, 2);
});

test('FR-WEBCRON-006 AC-3: 타임아웃이 지나면 요청을 취소하고 timeout으로 기록한다', async () => {
  const started = Date.now();
  const r = await runWebhook({ method: 'GET', url: `${base}/slow`, retryCount: 3 }, { ...opts, timeoutSec: 1 });
  assert.equal(r.status, 'timeout');
  assert.ok(Date.now() - started < 3000);
});

test('FR-WEBCRON-009 AC-2: 중지하면 요청과 남은 재시도를 취소하고 canceled로 기록한다', async () => {
  const ac = new AbortController();
  const p = runWebhook({ method: 'GET', url: `${base}/slow`, retryCount: 5 }, { timeoutSec: 0, signal: ac.signal, retryDelayMs: 10 });
  await sleep(200);
  ac.abort();
  const r = await p;
  assert.equal(r.status, 'canceled');
  assert.equal(r.attempts, 1);
});

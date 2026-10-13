import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import type { Config } from '../src/config.ts';
import { Store } from '../src/db.ts';
import { hashPassword } from '../src/password.ts';
import { Runner } from '../src/runner.ts';
import { Scheduler } from '../src/scheduler.ts';
import { nodeCmd, tempDir } from './helpers.ts';

const PASSWORD = 'pw';
const HASH = hashPassword(PASSWORD);

interface Ctx { app: FastifyInstance; store: Store; scheduler: Scheduler; base: string; cookie: string; dataDir: string }

function setup(fn: (c: Ctx) => Promise<void>) {
  return async () => {
    const t = tempDir();
    const dataDir = join(t.dir, 'data');
    const store = new Store(dataDir);
    const runner = new Runner(store);
    const scheduler = new Scheduler('UTC', () => {});
    const config: Config = {
      envPath: join(t.dir, '.env'), host: '127.0.0.1', port: 0, passwordHash: HASH,
      sessionTtlMinutes: 10, timezone: 'UTC', logRetentionDays: 30, dataDir,
    };
    const app = await buildApp({ config, store, runner, scheduler });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    try {
      const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
      const cookie = login.headers.get('set-cookie')!.split(';')[0];
      await fn({ app, store, scheduler, base, cookie, dataDir });
    } finally {
      await runner.shutdown();
      scheduler.stopAll();
      await app.close();
      store.close();
      t.cleanup();
    }
  };
}

async function web(c: Ctx, method: string, path: string, body?: unknown) {
  const res = await fetch(`${c.base}${path}`, {
    method, headers: { cookie: c.cookie, ...(method === 'GET' ? {} : { 'content-type': 'application/json' }) },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function issueKey(c: Ctx, name = 'claude'): Promise<{ key: string; id: number }> {
  const r = await web(c, 'POST', '/api/mcp-keys', { name });
  assert.equal(r.status, 201);
  return { key: r.json.key, id: r.json.item.id };
}

async function connect(c: Ctx, key: string, lang?: string): Promise<Client> {
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${c.base}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${key}`, ...(lang ? { 'accept-language': lang } : {}) } },
  }));
  return client;
}

function rawMcp(c: Ctx, headers: Record<string, string>, method = 'POST') {
  return fetch(`${c.base}/mcp`, {
    method,
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: method === 'POST' ? JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) : undefined,
  });
}

const text = (r: unknown) => ((r as { content: { text: string }[] }).content[0].text);

test('FR-WEBCRON-010 AC-1, AC-2, AC-6: 키 원문은 발급 응답에서만 보이고 목록에는 접두사만 나온다', setup(async (c) => {
  const r = await web(c, 'POST', '/api/mcp-keys', { name: 'Claude Code' });
  assert.equal(r.status, 201);
  assert.match(r.json.key, /^wcmcp_[A-Za-z0-9_-]{43,}$/);
  const list = await web(c, 'GET', '/api/mcp-keys');
  assert.equal(list.json.items.length, 1);
  const item = list.json.items[0];
  assert.equal(item.name, 'Claude Code');
  assert.equal(item.prefix, r.json.key.slice(0, 12));
  assert.equal(item.revokedAt, null);
  assert.ok(!JSON.stringify(list.json).includes(r.json.key));
  assert.equal((await web(c, 'POST', '/api/mcp-keys', { name: '' })).status, 400);
  assert.equal((await web(c, 'POST', '/api/mcp-keys', { name: 'x'.repeat(101) })).status, 400);
}));

test('SEC-WEBCRON-005 AC-1: DB 파일에 키 원문이 저장되지 않는다', setup(async (c) => {
  const { key } = await issueKey(c);
  c.store.db.exec('PRAGMA wal_checkpoint(FULL)');
  const files = ['webcron.db', 'webcron.db-wal'].map((f) => { try { return readFileSync(join(c.dataDir, f)); } catch { return Buffer.alloc(0); } });
  for (const f of files) assert.equal(f.includes(Buffer.from(key)), false);
  assert.equal(files[0].includes(Buffer.from(key.slice(6))), false);
}));

test('SEC-WEBCRON-005 AC-2, FR-WEBCRON-010 AC-3: 키가 없거나 틀리거나 폐기되면 401이다', setup(async (c) => {
  const { key, id } = await issueKey(c);
  assert.equal((await rawMcp(c, {})).status, 401);
  assert.equal((await rawMcp(c, { authorization: 'Bearer wcmcp_wrong' })).status, 401);
  assert.equal((await rawMcp(c, { authorization: `Bearer ${key}` })).status, 200);
  assert.equal((await web(c, 'DELETE', `/api/mcp-keys/${id}`)).status, 200);
  assert.equal((await rawMcp(c, { authorization: `Bearer ${key}` })).status, 401);
  const item = (await web(c, 'GET', '/api/mcp-keys')).json.items[0];
  assert.ok(item.revokedAt);
}));

test('SEC-WEBCRON-005 AC-3: 세션 쿠키로는 /mcp 를, MCP 키로는 /api 를 쓸 수 없다', setup(async (c) => {
  const { key } = await issueKey(c);
  assert.equal((await rawMcp(c, { cookie: c.cookie })).status, 401);
  const r = await fetch(`${c.base}/api/jobs`, { headers: { authorization: `Bearer ${key}` } });
  assert.equal(r.status, 401);
}));

test('SEC-WEBCRON-005 AC-4: 유효한 키를 쓰면 마지막 사용 시각이 갱신된다', setup(async (c) => {
  const { key } = await issueKey(c);
  assert.equal((await web(c, 'GET', '/api/mcp-keys')).json.items[0].lastUsedAt, null);
  await rawMcp(c, { authorization: `Bearer ${key}` });
  assert.ok((await web(c, 'GET', '/api/mcp-keys')).json.items[0].lastUsedAt);
}));

test('FR-WEBCRON-010 AC-5: 키 발급·폐기는 감사 로그에 남고 원문은 남지 않는다', setup(async (c) => {
  const { key, id } = await issueKey(c, '내 키');
  await web(c, 'DELETE', `/api/mcp-keys/${id}`);
  const items = c.store.listAudit({ page: 1 }).items;
  const ev = items.map((a) => a.event);
  assert.ok(ev.includes('mcp_key.create') && ev.includes('mcp_key.revoke'));
  const create = items.find((a) => a.event === 'mcp_key.create')!;
  assert.equal((create.detail as { name: string }).name, '내 키');
  assert.ok(!JSON.stringify(items).includes(key));
}));

test('IR-WEBCRON-002 AC-1, AC-2: initialize 와 tools/list 가 세 도구를 돌려준다', setup(async (c) => {
  const { key } = await issueKey(c);
  const client = await connect(c, key);
  try {
    assert.equal(client.getServerVersion()?.name, 'webcron');
    assert.ok(client.getServerCapabilities()?.tools);
    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.map((t) => t.name).sort(), ['create_job', 'delete_job', 'list_jobs']);
    for (const t of tools) { assert.ok(t.description); assert.equal(t.inputSchema.type, 'object'); }
  } finally { await client.close(); }
}));

test('IR-WEBCRON-002 AC-3: /mcp GET·DELETE 는 405다', setup(async (c) => {
  const { key } = await issueKey(c);
  assert.equal((await rawMcp(c, { authorization: `Bearer ${key}` }, 'GET')).status, 405);
  assert.equal((await rawMcp(c, { authorization: `Bearer ${key}` }, 'DELETE')).status, 405);
}));

test('FR-WEBCRON-011 AC-1~AC-5: MCP로 작업을 만들고 조회하고 지운다', setup(async (c) => {
  const { key } = await issueKey(c, 'agent-key');
  // 웹에서 만든 작업도 MCP 목록에 나온다
  await web(c, 'POST', '/api/jobs', { name: '웹 작업', cron: '0 3 * * *', type: 'webhook', webhook: { method: 'GET', url: 'https://example.com/' } });
  const client = await connect(c, key);
  try {
    const cli = await client.callTool({ name: 'create_job', arguments: {
      name: 'MCP CLI', cron: '*/5 * * * *', type: 'cli', cli: { command: nodeCmd('1'), env: { A: 'b' } },
    } });
    assert.ok(!cli.isError, text(cli));
    const cliJob = JSON.parse(text(cli));
    assert.ok(c.scheduler.nextRun(cliJob.id), '재기동 없이 일정에 등록된다');
    const hook = await client.callTool({ name: 'create_job', arguments: {
      name: 'MCP 웹훅', cron: '*/10 * * * * *', type: 'webhook', timeoutSec: 30,
      webhook: { method: 'POST', url: 'https://example.com/hook', headers: { 'Content-Type': 'application/json' }, body: '{}', retryCount: 2 },
    } });
    assert.ok(!hook.isError, text(hook));

    const webList = (await web(c, 'GET', '/api/jobs')).json.items.map((j: { name: string }) => j.name).sort();
    assert.deepEqual(webList, ['MCP CLI', 'MCP 웹훅', '웹 작업']);

    const listed = JSON.parse(text(await client.callTool({ name: 'list_jobs', arguments: {} })));
    assert.equal(listed.jobs.length, 3);
    for (const k of ['id', 'name', 'type', 'cron', 'enabled', 'nextRunAt', 'lastRun']) assert.ok(k in listed.jobs[0], k);

    // AC-3: 검증 실패
    const bad = await client.callTool({ name: 'create_job', arguments: { name: '', cron: 'nope', type: 'cli', cli: { command: '' } } });
    assert.equal(bad.isError, true);
    assert.match(text(bad), /cron/);
    assert.match(text(bad), /name/);
    assert.equal((await web(c, 'GET', '/api/jobs')).json.items.length, 3);

    // AC-4: 삭제
    const del = await client.callTool({ name: 'delete_job', arguments: { id: cliJob.id } });
    assert.ok(!del.isError, text(del));
    assert.equal(c.scheduler.nextRun(cliJob.id), null);
    assert.equal((await web(c, 'GET', `/api/jobs/${cliJob.id}`)).status, 404);
    const missing = await client.callTool({ name: 'delete_job', arguments: { id: 99999 } });
    assert.equal(missing.isError, true);

    // AC-5: 감사 로그에 경로와 키 이름
    const audits = c.store.listAudit({ page: 1 }).items.filter((a) => a.event === 'job.create' || a.event === 'job.delete');
    const viaMcp = audits.filter((a) => (a.detail as { via?: string }).via === 'mcp');
    assert.equal(viaMcp.length, 3);
    for (const a of viaMcp) assert.equal((a.detail as { mcpKey?: string }).mcpKey, 'agent-key');
  } finally { await client.close(); }
}));

test('IR-WEBCRON-003 AC-3: MCP 도구 설명은 영어이고 결과 메시지는 Accept-Language 를 따른다', setup(async (c) => {
  const { key } = await issueKey(c);
  const en = await connect(c, key);
  const ko = await connect(c, key, 'ko-KR');
  try {
    const tools = (await en.listTools()).tools;
    assert.ok(!/[가-힣]/.test(JSON.stringify(tools)), '도구 설명에 한글이 없다');
    const badArgs = { name: '', cron: 'x', type: 'cli', cli: { command: 'echo' } };
    assert.match(text(await en.callTool({ name: 'create_job', arguments: badArgs })), /Could not create the job/);
    assert.match(text(await ko.callTool({ name: 'create_job', arguments: badArgs })), /작업을 만들지 못했습니다/);
    assert.match(text(await en.callTool({ name: 'delete_job', arguments: { id: 424242 } })), /Job not found/);
    assert.match(text(await ko.callTool({ name: 'delete_job', arguments: { id: 424242 } })), /작업을 찾을 수 없습니다/);
  } finally { await en.close(); await ko.close(); }
}));

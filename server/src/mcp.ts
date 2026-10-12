// IR-WEBCRON-002: /mcp Streamable HTTP(상태 비저장), FR-WEBCRON-011: 작업 목록·생성·삭제 도구, SEC-WEBCRON-005: 키 인증
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { JobActions } from './app.ts';
import type { McpKey, Store } from './db.ts';
import { bearer, hashKey } from './mcpkeys.ts';
import { VERSION } from './version.ts';

export interface McpDeps {
  store: Store;
  now: () => number;
  actions: JobActions;
}

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const fail = (message: string) => ({ ...text(message), isError: true });

const stringMap = z.record(z.string());

const createShape = {
  name: z.string().describe('작업 이름 (1~100자)'),
  description: z.string().optional().describe('설명 (500자 이하)'),
  cron: z.string().describe('크론 표현식. 5필드(분 단위, 예: "*/5 * * * *") 또는 6필드(초 단위, 예: "*/30 * * * * *"). 서버 설정 타임존 기준.'),
  type: z.enum(['cli', 'webhook']).describe('cli: 셸 명령 실행(종료 코드 0이면 성공), webhook: HTTP 요청(최종 응답 2xx면 성공)'),
  enabled: z.boolean().optional().describe('활성 여부 (기본 true)'),
  timeoutSec: z.number().int().optional().describe('타임아웃(초). 0이면 무제한(기본값)'),
  cli: z.object({
    command: z.string().describe('실행할 명령. Windows는 cmd.exe, Linux는 /bin/sh 로 실행'),
    cwd: z.string().optional().describe('작업 디렉터리'),
    env: stringMap.optional().describe('환경 변수 (이름: 값)'),
  }).optional().describe('type 이 cli 일 때 필수'),
  webhook: z.object({
    method: z.enum(['GET', 'POST']),
    url: z.string().describe('http 또는 https URL. 리다이렉트는 최대 10회 따라감'),
    headers: stringMap.optional().describe('요청 헤더 (이름: 값)'),
    body: z.string().optional().describe('POST 본문'),
    retryCount: z.number().int().optional().describe('실패 시 재시도 횟수 0~5 (기본 0)'),
  }).optional().describe('type 이 webhook 일 때 필수'),
};

function summarize(j: ReturnType<JobActions['listJobs']>[number]) {
  const last = j.lastRun as { status: string; startedAt: number } | null;
  return {
    id: j.id, name: j.name, description: j.description, type: j.type, cron: j.cron, enabled: j.enabled,
    timeoutSec: j.timeoutSec, nextRunAt: j.nextRunAt, runningCount: j.runningCount,
    lastRun: last ? { status: last.status, startedAt: new Date(last.startedAt).toISOString() } : null,
    target: j.type === 'cli' ? j.cli?.command : `${j.webhook?.method} ${j.webhook?.url}`,
  };
}

function buildServer(deps: McpDeps, key: McpKey, req: FastifyRequest): McpServer {
  const server = new McpServer({ name: 'webcron', version: VERSION }, { capabilities: { tools: {} } });
  const actor = { req, via: 'mcp' as const, mcpKey: key.name };

  server.registerTool('list_jobs', {
    title: '작업 목록',
    description: 'WebCron에 등록된 모든 작업(스케줄)의 ID, 이름, 유형, 크론 표현식, 활성 여부, 다음 실행 시각, 마지막 실행 결과를 돌려준다.',
    inputSchema: {},
  }, async () => text({ jobs: deps.actions.listJobs().map(summarize) }));

  server.registerTool('create_job', {
    title: '작업 생성',
    description: '새 작업(스케줄)을 만들고 바로 일정에 등록한다. type 이 cli 면 cli.command 가, webhook 이면 webhook.method 와 webhook.url 이 필요하다.',
    inputSchema: createShape,
  }, async (args) => {
    const r = deps.actions.createJob(args, actor);
    if (r.errors) {
      return fail(`작업을 만들지 못했습니다. 입력값을 확인하세요.\n${Object.entries(r.errors).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`);
    }
    return text(summarize(r.job));
  });

  server.registerTool('delete_job', {
    title: '작업 삭제',
    description: 'ID로 작업(스케줄)을 삭제한다. 일정에서 즉시 빠지며, 실행 이력은 남는다.',
    inputSchema: { id: z.number().int().describe('삭제할 작업 ID (list_jobs 로 확인)') },
  }, async ({ id }) => {
    const job = deps.actions.deleteJob(id, actor);
    if (!job) return fail(`작업을 찾을 수 없습니다: ${id}`);
    return text({ deleted: { id: job.id, name: job.name } });
  });

  return server;
}

export function registerMcp(app: FastifyInstance, deps: McpDeps): void {
  const authenticate = (req: FastifyRequest): McpKey | null => {
    const key = bearer(req.headers.authorization);
    if (!key) return null;
    const found = deps.store.findActiveMcpKey(hashKey(key));
    if (found) deps.store.touchMcpKey(found.id, deps.now());
    return found;
  };
  const unauthorized = { jsonrpc: '2.0', error: { code: -32001, message: '유효한 MCP 키가 필요합니다 (Authorization: Bearer <키>).' }, id: null };

  app.post('/mcp', async (req, reply) => {
    const key = authenticate(req);
    if (!key) return reply.code(401).header('www-authenticate', 'Bearer').send(unauthorized);
    const server = buildServer(deps, key, req);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on('close', () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } catch (e) {
      req.log.error(e);
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'content-type': 'application/json' });
        reply.raw.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: '서버 오류' }, id: null }));
      }
    }
  });

  const notAllowed = { jsonrpc: '2.0', error: { code: -32000, message: '이 서버는 상태 비저장 모드라 POST만 지원합니다.' }, id: null };
  app.get('/mcp', async (req, reply) => {
    if (!authenticate(req)) return reply.code(401).send(unauthorized);
    return reply.code(405).header('allow', 'POST').send(notAllowed);
  });
  app.delete('/mcp', async (req, reply) => {
    if (!authenticate(req)) return reply.code(401).send(unauthorized);
    return reply.code(405).header('allow', 'POST').send(notAllowed);
  });
}

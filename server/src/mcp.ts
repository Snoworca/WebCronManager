// IR-WEBCRON-002: /mcp Streamable HTTP(상태 비저장), FR-WEBCRON-011: 작업 목록·생성·삭제 도구, SEC-WEBCRON-005: 키 인증
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { reqLocale, type JobActions } from './app.ts';
import { t } from './i18n.ts';
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
  name: z.string().describe('Job name (1-100 characters)'),
  description: z.string().optional().describe('Description (up to 500 characters)'),
  cron: z.string().describe('Cron expression: 5 fields (minutes, e.g. "*/5 * * * *") or 6 fields (seconds, e.g. "*/30 * * * * *"), evaluated in the server time zone.'),
  type: z.enum(['cli', 'webhook']).describe('cli: run a shell command (success when the exit code is 0); webhook: send an HTTP request (success when the final response is 2xx)'),
  enabled: z.boolean().optional().describe('Whether the job is enabled (default true)'),
  timeoutSec: z.number().int().optional().describe('Timeout in seconds. 0 means no limit (default)'),
  cli: z.object({
    command: z.string().describe('Command to run. Runs with cmd.exe on Windows and /bin/sh on Linux'),
    cwd: z.string().optional().describe('Working directory'),
    env: stringMap.optional().describe('Environment variables (name: value)'),
  }).optional().describe('Required when type is cli'),
  webhook: z.object({
    method: z.enum(['GET', 'POST']),
    url: z.string().describe('http or https URL. Follows up to 10 redirects'),
    headers: stringMap.optional().describe('Request headers (name: value)'),
    body: z.string().optional().describe('POST body'),
    retryCount: z.number().int().optional().describe('Retries on failure, 0-5 (default 0)'),
  }).optional().describe('Required when type is webhook'),
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
  const locale = reqLocale(req);

  server.registerTool('list_jobs', {
    title: 'List jobs',
    description: 'Returns every job (schedule) registered in WebCron: ID, name, type, cron expression, enabled flag, next run time, and last run result.',
    inputSchema: {},
  }, async () => text({ jobs: deps.actions.listJobs().map(summarize) }));

  server.registerTool('create_job', {
    title: 'Create job',
    description: 'Creates a job (schedule) and schedules it immediately. When type is cli, cli.command is required; when type is webhook, webhook.method and webhook.url are required.',
    inputSchema: createShape,
  }, async (args) => {
    const r = deps.actions.createJob(args, actor);
    if (r.errors) {
      return fail(t(locale, 'mcp.createFailed', { errors: Object.entries(r.errors).map(([k, v]) => `- ${k}: ${v}`).join('\n') }));
    }
    return text(summarize(r.job));
  });

  server.registerTool('delete_job', {
    title: 'Delete job',
    description: 'Deletes a job (schedule) by ID. It is removed from the schedule at once; its run history is kept.',
    inputSchema: { id: z.number().int().describe('ID of the job to delete (see list_jobs)') },
  }, async ({ id }) => {
    const job = deps.actions.deleteJob(id, actor);
    if (!job) return fail(t(locale, 'mcp.jobNotFound', { id }));
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
  const rpcError = (req: FastifyRequest, code: number, key: 'mcp.unauthorized' | 'mcp.postOnly' | 'mcp.serverError') =>
    ({ jsonrpc: '2.0', error: { code, message: t(reqLocale(req), key) }, id: null });

  app.post('/mcp', async (req, reply) => {
    const key = authenticate(req);
    if (!key) return reply.code(401).header('www-authenticate', 'Bearer').send(rpcError(req, -32001, 'mcp.unauthorized'));
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
        reply.raw.end(JSON.stringify(rpcError(req, -32603, 'mcp.serverError')));
      }
    }
  });

  app.get('/mcp', async (req, reply) => {
    if (!authenticate(req)) return reply.code(401).send(rpcError(req, -32001, 'mcp.unauthorized'));
    return reply.code(405).header('allow', 'POST').send(rpcError(req, -32000, 'mcp.postOnly'));
  });
  app.delete('/mcp', async (req, reply) => {
    if (!authenticate(req)) return reply.code(401).send(rpcError(req, -32001, 'mcp.unauthorized'));
    return reply.code(405).header('allow', 'POST').send(rpcError(req, -32000, 'mcp.postOnly'));
  });
}

<script lang="ts">
  import { onMount } from 'svelte';
  import Badge from '../components/Badge.svelte';
  import Icon from '../components/Icon.svelte';
  import KvEditor from '../components/KvEditor.svelte';
  import { api, ApiError, qs } from '../lib/api.ts';
  import { fullTime, runCode, shortTime } from '../lib/format.ts';
  import { go, notify, session } from '../lib/state.svelte.ts';
  import type { Job, JobInput, JobType, Page, Pair, Run } from '../lib/types.ts';

  let { id }: { id: number | null } = $props();

  // 폼 상태
  let name = $state('');
  let description = $state('');
  let cron = $state('*/5 * * * *');
  let type = $state<JobType>('cli');
  let enabled = $state(true);
  let timeoutSec = $state(0);
  let command = $state('');
  let cwd = $state('');
  let env = $state<Pair[]>([]);
  let method = $state<'GET' | 'POST'>('POST');
  let url = $state('');
  let headers = $state<Pair[]>([{ key: 'Content-Type', value: 'application/json' }]);
  let body = $state('');
  let retryCount = $state(0);

  let loading = $state(true);
  let saving = $state(false);
  let errors = $state<Record<string, string>>({});
  let formError = $state('');
  let preview = $state<string[]>([]);
  let previewError = $state('');
  let recent = $state<Run[]>([]);
  let title = $state('새 작업');

  const toPairs = (o: Record<string, string> | undefined): Pair[] => Object.entries(o ?? {}).map(([key, value]) => ({ key, value }));
  const toObj = (rows: Pair[]) => Object.fromEntries(rows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value]));

  function fill(j: Job) {
    title = j.name;
    name = j.name; description = j.description; cron = j.cron; type = j.type; enabled = j.enabled; timeoutSec = j.timeoutSec;
    if (j.cli) { command = j.cli.command; cwd = j.cli.cwd ?? ''; env = toPairs(j.cli.env); }
    if (j.webhook) {
      method = j.webhook.method; url = j.webhook.url; headers = toPairs(j.webhook.headers);
      body = j.webhook.body ?? ''; retryCount = j.webhook.retryCount ?? 0;
    }
  }

  onMount(async () => {
    if (id === null) { loading = false; return; }
    try {
      fill(await api<Job>('GET', `/api/jobs/${id}`));
      recent = (await api<Page<Run>>('GET', `/api/runs${qs({ jobId: id })}`)).items.slice(0, 5);
    } catch (e) {
      formError = (e as Error).message;
    } finally {
      loading = false;
    }
  });

  // 크론 미리보기 (FR-WEBCRON-002 AC-4)
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const expr = cron;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      try {
        preview = (await api<{ next: string[] }>('POST', '/api/cron/preview', { cron: expr })).next;
        previewError = '';
      } catch (e) {
        preview = [];
        previewError = (e as Error).message;
      }
    }, 300);
    return () => clearTimeout(previewTimer);
  });

  function input(): JobInput {
    return {
      name, description, cron, type, enabled, timeoutSec: Number(timeoutSec) || 0,
      cli: type === 'cli' ? { command, cwd: cwd || undefined, env: toObj(env) } : null,
      webhook: type === 'webhook' ? { method, url, headers: toObj(headers), body: method === 'POST' ? body : '', retryCount: Number(retryCount) } : null,
    };
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    saving = true;
    errors = {};
    formError = '';
    try {
      const saved = id === null
        ? await api<Job>('POST', '/api/jobs', input())
        : await api<Job>('PUT', `/api/jobs/${id}`, input());
      notify(`‘${saved.name}’ 작업을 저장했습니다.`);
      go('/jobs');
    } catch (err) {
      const ae = err as ApiError;
      errors = ae.errors ?? {};
      formError = ae.message;
    } finally {
      saving = false;
    }
  }

  async function remove() {
    if (id === null || !confirm(`‘${title}’ 작업을 삭제할까요? 실행 이력은 남습니다.`)) return;
    try {
      await api('DELETE', `/api/jobs/${id}`);
      notify(`‘${title}’ 작업을 삭제했습니다.`);
      go('/jobs');
    } catch (e) {
      notify((e as Error).message);
    }
  }

  async function runNow() {
    if (id === null) return;
    try {
      const r = await api<{ runId: number }>('POST', `/api/jobs/${id}/run`);
      go(`/runs?run=${r.runId}`);
    } catch (e) {
      notify((e as Error).message);
    }
  }

  const err = (k: string) => errors[k];
  const kvError = (prefix: string) => Object.entries(errors).filter(([k]) => k.startsWith(prefix)).map(([, v]) => v).join(' ');
</script>

<main class="wrap">
  <div class="head">
    <div>
      <div class="crumb"><a href="#/jobs">작업</a> / {id === null ? '새 작업' : '편집'}</div>
      <h1>{title}</h1>
    </div>
    {#if id !== null}
      <button class="btn btn-lg" type="button" onclick={runNow}><Icon name="play" size={14} />지금 실행</button>
    {/if}
  </div>

  {#if loading}
    <div class="loading">불러오는 중…</div>
  {:else}
    <div class="split">
      <form class="main-col card" onsubmit={save} novalidate>
        {#if formError}<div class="card-b" style="padding-bottom:0"><div class="alert alert-bad" role="alert">{formError}</div></div>{/if}

        <div class="card-h"><h2>기본 정보</h2></div>
        <div class="card-b form-grid">
          <label class="field">이름
            <input class="input" maxlength="100" bind:value={name} aria-invalid={!!err('name')} />
            {#if err('name')}<span class="err-text">{err('name')}</span>{/if}
          </label>
          <div class="field">활성
            <div class="inline" style="min-height:40px">
              <button type="button" class="sw" role="switch" aria-checked={enabled} aria-label="작업 활성" onclick={() => (enabled = !enabled)}></button>
              <span class="hint" style="font-size:13px">활성 상태일 때만 일정에 따라 실행됩니다.</span>
            </div>
          </div>
          <label class="field full">설명
            <input class="input" maxlength="500" bind:value={description} />
          </label>
        </div>

        <div class="card-h" style="border-top:1px solid var(--line)"><h2>일정</h2><span class="chip">TZ {session.me?.timezone} · 설정 파일</span></div>
        <div class="card-b form-grid">
          <label class="field">크론 표현식
            <input class="input mono" bind:value={cron} aria-invalid={!!(err('cron') || previewError)} />
            <span class="hint">5필드(분 단위) 또는 6필드(초 단위). 예: <span class="mono">*/30 * * * * *</span> = 30초마다</span>
            {#if err('cron') || previewError}<span class="err-text">{err('cron') || previewError}</span>{/if}
          </label>
          <label class="field">타임아웃(초)
            <input class="input" type="number" min="0" bind:value={timeoutSec} aria-invalid={!!err('timeoutSec')} />
            <span class="hint">0 = 무제한(기본값). 넘으면 프로세스를 종료하고 ‘시간 초과’로 기록합니다.</span>
            {#if err('timeoutSec')}<span class="err-text">{err('timeoutSec')}</span>{/if}
          </label>
        </div>

        <div class="card-h" style="border-top:1px solid var(--line)"><h2>실행 방식</h2>
          <div class="seg" role="group" aria-label="작업 유형">
            <button type="button" aria-pressed={type === 'cli'} onclick={() => (type = 'cli')}><Icon name="cli" />CLI</button>
            <button type="button" aria-pressed={type === 'webhook'} onclick={() => (type = 'webhook')}><Icon name="webhook" />웹훅</button>
          </div>
        </div>

        {#if type === 'cli'}
          <div class="card-b form-grid">
            <label class="field full">명령
              <input class="input mono" bind:value={command} placeholder="python scripts/job.py" aria-invalid={!!err('cli.command')} />
              <span class="hint">Windows는 cmd.exe, Linux는 /bin/sh로 실행합니다. 종료 코드 0이면 성공입니다.</span>
              {#if err('cli.command')}<span class="err-text">{err('cli.command')}</span>{/if}
            </label>
            <label class="field full">작업 디렉터리 <span class="hint">비우면 서버 작업 디렉터리</span>
              <input class="input mono" bind:value={cwd} placeholder="/opt/jobs 또는 C:\jobs" />
            </label>
            <div class="field full">환경 변수 <span class="hint">감사 로그에는 값이 *** 로 가려져 기록됩니다.</span>
              <KvEditor bind:rows={env} keyLabel="이름" valueLabel="값" addLabel="변수 추가" />
              {#if kvError('cli.env')}<span class="err-text">{kvError('cli.env')}</span>{/if}
            </div>
          </div>
        {:else}
          <div class="card-b form-grid">
            <div class="field">메서드
              <div class="seg" role="group" aria-label="HTTP 메서드">
                <button type="button" aria-pressed={method === 'GET'} onclick={() => (method = 'GET')}>GET</button>
                <button type="button" aria-pressed={method === 'POST'} onclick={() => (method = 'POST')}>POST</button>
              </div>
            </div>
            <label class="field">실패 시 재시도
              <select class="input" bind:value={retryCount}>
                {#each [0, 1, 2, 3, 4, 5] as n (n)}<option value={n}>{n}회{n === 0 ? ' (기본)' : ''}</option>{/each}
              </select>
            </label>
            <label class="field full">URL
              <input class="input mono" type="url" bind:value={url} placeholder="https://example.com/hook" aria-invalid={!!err('webhook.url')} />
              <span class="hint">리다이렉트(301·302·303·307·308)는 최대 10회까지 따라갑니다. 최종 응답이 2xx면 성공입니다.</span>
              {#if err('webhook.url')}<span class="err-text">{err('webhook.url')}</span>{/if}
            </label>
            <div class="field full">요청 헤더 <span class="hint">감사 로그에는 값이 *** 로 가려져 기록됩니다.</span>
              <KvEditor bind:rows={headers} keyLabel="헤더 이름" valueLabel="헤더 값" addLabel="헤더 추가" />
              {#if kvError('webhook.headers')}<span class="err-text">{kvError('webhook.headers')}</span>{/if}
            </div>
            {#if method === 'POST'}
              <label class="field full">본문 <span class="hint">POST일 때만 전송합니다. Content-Type 헤더를 함께 지정하세요.</span>
                <textarea class="input mono" bind:value={body}></textarea>
                {#if err('webhook.body')}<span class="err-text">{err('webhook.body')}</span>{/if}
              </label>
            {/if}
          </div>
        {/if}

        <div class="footer-bar">
          <div>
            {#if id !== null}<button type="button" class="btn btn-danger" onclick={remove}>작업 삭제</button>{/if}
          </div>
          <div class="inline">
            <a class="btn btn-lg" href="#/jobs">취소</a>
            <button type="submit" class="btn btn-primary btn-lg" disabled={saving}>{saving ? '저장 중…' : '저장'}</button>
          </div>
        </div>
      </form>

      <aside class="side-col" style="display:flex;flex-direction:column;gap:24px">
        <section class="card">
          <div class="card-h"><h2>다음 실행 예정</h2></div>
          <div class="card-b" style="padding-top:8px;padding-bottom:8px">
            <ol class="next-list">
              {#each preview as t, i (t)}
                <li>{fullTime(t)}<span>{i === 0 ? '다음' : `+${i}`}</span></li>
              {:else}
                <li><span>올바른 표현식을 입력하면 미리 보기가 나타납니다.</span></li>
              {/each}
            </ol>
          </div>
        </section>
        {#if id !== null}
          <section class="card">
            <div class="card-h"><h2>최근 실행</h2><a href="#/runs?jobId={id}" style="font-size:13px;font-weight:600">전체 보기</a></div>
            <div class="card-b" style="padding-top:8px;padding-bottom:8px">
              <ol class="next-list">
                {#each recent as r (r.id)}
                  <li><a href="#/runs?run={r.id}" style="color:inherit;text-decoration:none">{shortTime(r.startedAt)}</a><Badge status={r.status} label={(r.status === 'success' || r.status === 'failure') && runCode(r) !== '—' ? runCode(r) : undefined} /></li>
                {:else}
                  <li><span>아직 실행 기록이 없습니다.</span></li>
                {/each}
              </ol>
            </div>
          </section>
        {/if}
      </aside>
    </div>
  {/if}
</main>

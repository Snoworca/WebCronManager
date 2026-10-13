<script lang="ts">
  import { onMount } from 'svelte';
  import Badge from '../components/Badge.svelte';
  import Icon from '../components/Icon.svelte';
  import Pager from '../components/Pager.svelte';
  import { api, qs } from '../lib/api.ts';
  import { dateEndExclusive, dateStart, fullTime, runCode, runDuration, shortTime, statusLabel, triggerLabel } from '../lib/format.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import { notify, route, session } from '../lib/state.svelte.ts';
  import type { Job, Page, Run } from '../lib/types.ts';

  let jobs = $state<Job[]>([]);
  let page = $state<Page<Run>>({ items: [], total: 0, page: 1, pageSize: 50 });
  let loaded = $state(false);
  let jobId = $state(route.query.get('jobId') ?? '');
  let status = $state('');
  let from = $state('');
  let to = $state('');
  let pageNo = $state(1);
  let selectedId = $state<number | null>(route.query.get('run') ? Number(route.query.get('run')) : null);
  let detail = $state<Run | null>(null);
  let stopping = $state(false);
  let now = $state(Date.now());

  async function loadList() {
    try {
      page = await api<Page<Run>>('GET', `/api/runs${qs({ jobId, status, from: dateStart(from), to: dateEndExclusive(to), page: pageNo })}`);
      if (selectedId === null && page.items.length) selectedId = page.items[0].id;
    } catch (e) {
      notify((e as Error).message);
    } finally {
      loaded = true;
    }
  }

  async function loadDetail() {
    if (selectedId === null) { detail = null; return; }
    try {
      detail = await api<Run>('GET', `/api/runs/${selectedId}`);
    } catch {
      detail = null;
    }
  }

  // 필터나 페이지가 바뀌면 목록을 다시 읽는다.
  $effect(() => {
    void [jobId, status, from, to, pageNo];
    loadList();
  });
  $effect(() => {
    void selectedId;
    loadDetail();
  });

  onMount(() => {
    api<{ items: Job[] }>('GET', '/api/jobs').then((r) => (jobs = r.items)).catch(() => {});
    // FR-WEBCRON-008 AC-4: 실행 중인 항목은 5초 이내에 결과가 반영된다.
    const timer = setInterval(() => {
      now = Date.now();
      loadList();
      if (detail?.status === 'running') loadDetail();
    }, 3000);
    return () => clearInterval(timer);
  });

  function resetPage() { pageNo = 1; }

  async function stop() {
    if (!detail || !confirm(t('runs.confirmStop', { name: detail.jobName, id: detail.id }))) return;
    stopping = true;
    try {
      await api('POST', `/api/runs/${detail.id}/cancel`);
      notify(t('runs.stopped'));
      setTimeout(() => { loadDetail(); loadList(); }, 400);
    } catch (e) {
      notify((e as Error).message);
      loadDetail();
    } finally {
      stopping = false;
    }
  }
</script>

<main class="wrap">
  <div class="head">
    <div>
      <h1>{t('runs.title')}</h1>
      <p>{t('runs.subtitle', { days: session.me?.logRetentionDays ?? 30 })}</p>
    </div>
  </div>
  <div class="split">
    <section class="card main-col" aria-label={t('runs.listAria')}>
      <div class="filters">
        <label class="field" style="flex:1 1 200px">{t('runs.job')}
          <select class="input" bind:value={jobId} onchange={resetPage}>
            <option value="">{t('runs.allJobs')}</option>
            {#each jobs as j (j.id)}<option value={String(j.id)}>{j.name}</option>{/each}
          </select>
        </label>
        <label class="field" style="flex:0 1 150px">{t('runs.result')}
          <select class="input" bind:value={status} onchange={resetPage}>
            <option value="">{t('common.all')}</option>
            {#each ['success', 'failure', 'timeout', 'running', 'canceled', 'interrupted'] as const as st (st)}
              <option value={st}>{statusLabel(st)}</option>
            {/each}
          </select>
        </label>
        <label class="field" style="flex:0 1 160px">{t('runs.from')}<input class="input" type="date" bind:value={from} onchange={resetPage} /></label>
        <label class="field" style="flex:0 1 160px">{t('runs.to')}<input class="input" type="date" bind:value={to} onchange={resetPage} /></label>
      </div>
      <div class="tbl-box">
        <table style="min-width:760px">
          <thead><tr><th>{t('runs.colResult')}</th><th>{t('runs.colJob')}</th><th>{t('runs.colTrigger')}</th><th>{t('runs.colStart')}</th><th>{t('runs.colDuration')}</th><th>{t('runs.colCode')}</th></tr></thead>
          <tbody>
            {#each page.items as r (r.id)}
              <tr class:sel={r.id === selectedId}>
                <td><Badge status={r.status} /></td>
                <td>
                  <button type="button" class="linkbtn" onclick={() => (selectedId = r.id)}>{r.jobName}</button>
                  <span class="t-sub mono" style="font-size:12px">#{r.id}</span>
                </td>
                <td><span class="type"><Icon name={r.jobType} />{triggerLabel(r.trigger)}</span></td>
                <td class="mono" style="font-size:13px;white-space:nowrap">{shortTime(r.startedAt)}</td>
                <td style="white-space:nowrap">{runDuration(r, now)}</td>
                <td class="mono" style="font-size:13px;white-space:nowrap">{runCode(r)}</td>
              </tr>
            {:else}
              <tr><td colspan="6" class="empty">{loaded ? t('runs.empty') : t('common.loading')}</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
      <Pager page={page.page} pageSize={page.pageSize} total={page.total} onpage={(p) => (pageNo = p)} />
    </section>

    <aside class="card side-col" aria-label={t('runs.detailAria')}>
      {#if detail}
        <div class="card-h"><h2>{detail.jobName}</h2><Badge status={detail.status} /></div>
        <div class="card-b">
          <dl class="meta">
            <dt>{t('runs.id')}</dt><dd class="mono">#{detail.id}</dd>
            <dt>{t('runs.trigger')}</dt><dd>{triggerLabel(detail.trigger)}</dd>
            <dt>{t('runs.start')}</dt><dd class="mono">{fullTime(detail.startedAt)}</dd>
            <dt>{t('runs.end')}</dt><dd class="mono">{fullTime(detail.finishedAt)}</dd>
            <dt>{t('runs.duration')}</dt><dd>{runDuration(detail, now)}</dd>
            {#if detail.jobType === 'cli'}
              <dt>{t('runs.exitCode')}</dt><dd class="mono">{detail.exitCode ?? '—'}</dd>
            {:else}
              <dt>{t('runs.finalUrl')}</dt><dd class="mono">{detail.finalUrl ?? '—'}</dd>
              <dt>{t('runs.httpStatus')}</dt><dd class="mono">{detail.httpStatus ?? '—'}</dd>
              <dt>{t('runs.redirects')}</dt><dd>{t('runs.times', { n: detail.redirects ?? 0 })}</dd>
              <dt>{t('runs.attempts')}</dt><dd>{detail.attempts === null ? '—' : t('runs.times', { n: detail.attempts })}</dd>
            {/if}
            {#if detail.error}<dt>{t('runs.error')}</dt><dd style="color:var(--bad)">{detail.error}</dd>{/if}
          </dl>
          {#if detail.status === 'running'}
            <div style="margin-top:16px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px" role="status">
              <span class="hint" style="font-size:13px">{t('runs.autoRefresh')}</span>
              <button type="button" class="btn btn-danger" onclick={stop} disabled={stopping}><Icon name="stop" size={14} />{t('runs.stop')}</button>
            </div>
          {/if}
          {#if detail.jobType === 'cli'}
            <div class="out-h"><span>stdout</span><span class="hint">{t('runs.outputLimit')}</span></div>
            <pre class="out">{detail.stdout || t('runs.noOutput')}</pre>
            <div class="out-h"><span>stderr</span></div>
            <pre class="out">{detail.stderr || t('runs.noOutput')}</pre>
          {:else}
            <div class="out-h"><span>{t('runs.responseBody')}</span><span class="hint">{t('runs.outputLimit')}</span></div>
            <pre class="out">{detail.responseBody || t('runs.noBody')}</pre>
          {/if}
        </div>
      {:else}
        <div class="card-b" style="color:var(--muted)">{t('runs.selectHint')}</div>
      {/if}
    </aside>
  </div>
</main>

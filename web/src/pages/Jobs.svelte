<script lang="ts">
  import { onMount } from 'svelte';
  import Badge from '../components/Badge.svelte';
  import Icon from '../components/Icon.svelte';
  import { api } from '../lib/api.ts';
  import { resultLabel, runDuration, shortTime, typeLabel } from '../lib/format.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import { notify } from '../lib/state.svelte.ts';
  import type { Job, RunStatus, Stats } from '../lib/types.ts';

  let jobs = $state<Job[]>([]);
  let stats = $state<Stats | null>(null);
  let loaded = $state(false);
  let error = $state('');
  let q = $state('');
  let type = $state('');
  let result = $state('');
  let ran = $state<{ name: string; runId: number } | null>(null);

  async function load() {
    try {
      const [j, s] = await Promise.all([api<{ items: Job[] }>('GET', '/api/jobs'), api<Stats>('GET', '/api/stats')]);
      jobs = j.items;
      stats = s;
      error = '';
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loaded = true;
    }
  }

  onMount(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  });

  const lastStatus = (j: Job): RunStatus | 'none' => (j.runningCount > 0 ? 'running' : (j.lastRun?.status ?? 'none'));

  const shown = $derived(jobs.filter((j) =>
    (!q || `${j.name} ${j.description}`.toLowerCase().includes(q.toLowerCase())) &&
    (!type || j.type === type) &&
    (!result || lastStatus(j) === result || (result === 'failure' && lastStatus(j) === 'timeout'))));

  function target(j: Job): string {
    if (j.description) return j.description;
    return j.type === 'cli' ? (j.cli?.command ?? '') : `${j.webhook?.method} ${j.webhook?.url}`;
  }

  async function toggle(j: Job) {
    try {
      const updated = await api<Job>('PATCH', `/api/jobs/${j.id}/enabled`, { enabled: !j.enabled });
      jobs = jobs.map((x) => (x.id === j.id ? updated : x));
    } catch (e) {
      notify((e as Error).message);
    }
  }

  async function runNow(j: Job) {
    try {
      const r = await api<{ runId: number }>('POST', `/api/jobs/${j.id}/run`);
      ran = { name: j.name, runId: r.runId };
      load();
    } catch (e) {
      notify((e as Error).message);
    }
  }
</script>

<main class="wrap">
  <div class="head">
    <div>
      <h1>{t('jobs.title')}</h1>
      <p>{t('jobs.summary', { total: jobs.length, enabled: jobs.filter((j) => j.enabled).length })}</p>
    </div>
    <a class="btn btn-primary btn-lg" href="#/jobs/new"><Icon name="plus" size={18} />{t('jobs.new')}</a>
  </div>

  {#if ran}
    <div class="notice" role="status">
      <span>{t('jobs.ranNotice', { name: ran.name })}</span>
      <a href="#/runs?run={ran.runId}" style="font-weight:600">{t('jobs.viewResult')}</a>
    </div>
  {/if}
  {#if error}<div class="alert alert-bad" role="alert">{error}</div>{/if}

  <section class="stats" aria-label={t('jobs.statsAria')}>
    <div class="card stat"><span>{t('jobs.statSuccess')}</span><b style="color:var(--ok)">{stats?.success24h ?? '—'}</b></div>
    <div class="card stat"><span>{t('jobs.statFailure')}</span><b style="color:var(--bad)">{stats?.failure24h ?? '—'}</b></div>
    <div class="card stat"><span>{t('jobs.statRunning')}</span><b style="color:var(--accent)">{stats?.running ?? '—'}</b></div>
    <div class="card stat"><span>{t('jobs.statEnabled')}</span><b>{stats?.enabledJobs ?? '—'} <small style="font-size:16px;font-weight:500;color:var(--muted)">/ {stats?.totalJobs ?? '—'}</small></b></div>
  </section>

  <section class="card" aria-label={t('jobs.listAria')}>
    <div class="filters">
      <label class="field" style="flex:1 1 260px">{t('jobs.search')}<input class="input" type="search" placeholder={t('jobs.searchPlaceholder')} bind:value={q} /></label>
      <label class="field" style="flex:0 1 160px">{t('jobs.type')}
        <select class="input" bind:value={type}>
          <option value="">{t('common.all')}</option><option value="cli">{typeLabel('cli')}</option><option value="webhook">{typeLabel('webhook')}</option>
        </select>
      </label>
      <label class="field" style="flex:0 1 170px">{t('jobs.lastResult')}
        <select class="input" bind:value={result}>
          <option value="">{t('common.all')}</option><option value="success">{t('status.success')}</option><option value="failure">{t('status.failure')}</option>
          <option value="timeout">{t('status.timeout')}</option><option value="running">{t('status.running')}</option><option value="none">{t('status.none')}</option>
        </select>
      </label>
    </div>
    <div class="tbl-box">
      <table style="min-width:1000px">
        <thead><tr>
          <th style="width:72px">{t('jobs.colEnabled')}</th><th>{t('jobs.colJob')}</th><th>{t('jobs.colType')}</th><th>{t('jobs.colSchedule')}</th>
          <th>{t('jobs.colNext')}</th><th>{t('jobs.colLast')}</th><th style="text-align:right">{t('jobs.colActions')}</th>
        </tr></thead>
        <tbody>
          {#each shown as j (j.id)}
            <tr class:off={!j.enabled}>
              <td><button type="button" class="sw" role="switch" aria-checked={j.enabled} aria-label={t('jobs.toggleAria', { name: j.name })} onclick={() => toggle(j)}></button></td>
              <td><a class="t-main" href="#/jobs/{j.id}">{j.name}</a><span class="t-sub mono" style="font-size:12px">{target(j)}</span></td>
              <td><span class="type"><Icon name={j.type} />{typeLabel(j.type)}</span></td>
              <td><span class="mono" style="font-size:13px">{j.cron}</span></td>
              <td class="mono" style="font-size:13px;white-space:nowrap">{j.enabled ? shortTime(j.nextRunAt) : t('jobs.disabled')}</td>
              <td>
                {#if j.runningCount > 0}
                  <Badge status="running" label={t('jobs.runningCount', { n: j.runningCount })} />
                {:else if j.lastRun}
                  <Badge status={j.lastRun.status} label={resultLabel(j.lastRun)} />
                  <span class="t-sub" style="font-size:12px;margin-top:4px;white-space:nowrap">{shortTime(j.lastRun.startedAt)} · {runDuration(j.lastRun)}</span>
                {:else}
                  <Badge status="none" />
                {/if}
              </td>
              <td style="text-align:right;white-space:nowrap">
                <button type="button" class="btn" onclick={() => runNow(j)}><Icon name="play" size={14} />{t('common.runNow')}</button>
                <a class="btn" href="#/jobs/{j.id}" style="margin-left:6px">{t('common.edit')}</a>
              </td>
            </tr>
          {:else}
            <tr><td colspan="7" class="empty">
              {#if !loaded}{t('common.loading')}{:else if jobs.length === 0}{t('jobs.empty')} <a href="#/jobs/new">{t('jobs.new')}</a>{:else}{t('jobs.noMatch')}{/if}
            </td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
</main>

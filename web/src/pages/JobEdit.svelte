<script lang="ts">
  import { onMount } from 'svelte';
  import Badge from '../components/Badge.svelte';
  import Icon from '../components/Icon.svelte';
  import KvEditor from '../components/KvEditor.svelte';
  import { api, ApiError, qs } from '../lib/api.ts';
  import { fullTime, runCode, shortTime, typeLabel } from '../lib/format.ts';
  import { t } from '../lib/i18n.svelte.ts';
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
  let loadedName = $state('');
  const title = $derived(loadedName || t('jobs.new'));

  const toPairs = (o: Record<string, string> | undefined): Pair[] => Object.entries(o ?? {}).map(([key, value]) => ({ key, value }));
  const toObj = (rows: Pair[]) => Object.fromEntries(rows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value]));

  function fill(j: Job) {
    loadedName = j.name;
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
      notify(t('edit.saved', { name: saved.name }));
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
    if (id === null || !confirm(t('edit.confirmDelete', { name: title }))) return;
    try {
      await api('DELETE', `/api/jobs/${id}`);
      notify(t('edit.deleted', { name: title }));
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
      <div class="crumb"><a href="#/jobs">{t('nav.jobs')}</a> / {id === null ? t('jobs.new') : t('edit.crumbEdit')}</div>
      <h1>{title}</h1>
    </div>
    {#if id !== null}
      <button class="btn btn-lg" type="button" onclick={runNow}><Icon name="play" size={14} />{t('common.runNow')}</button>
    {/if}
  </div>

  {#if loading}
    <div class="loading">{t('common.loading')}</div>
  {:else}
    <div class="split">
      <form class="main-col card" onsubmit={save} novalidate>
        {#if formError}<div class="card-b" style="padding-bottom:0"><div class="alert alert-bad" role="alert">{formError}</div></div>{/if}

        <div class="card-h"><h2>{t('edit.basic')}</h2></div>
        <div class="card-b form-grid">
          <label class="field">{t('edit.name')}
            <input class="input" maxlength="100" bind:value={name} aria-invalid={!!err('name')} />
            {#if err('name')}<span class="err-text">{err('name')}</span>{/if}
          </label>
          <div class="field">{t('edit.enabled')}
            <div class="inline" style="min-height:40px">
              <button type="button" class="sw" role="switch" aria-checked={enabled} aria-label={t('edit.enabledAria')} onclick={() => (enabled = !enabled)}></button>
              <span class="hint" style="font-size:13px">{t('edit.enabledHint')}</span>
            </div>
          </div>
          <label class="field full">{t('edit.description')}
            <input class="input" maxlength="500" bind:value={description} />
          </label>
        </div>

        <div class="card-h" style="border-top:1px solid var(--line)"><h2>{t('edit.schedule')}</h2><span class="chip">{t('edit.tzChip', { tz: session.me?.timezone ?? '' })}</span></div>
        <div class="card-b form-grid">
          <label class="field">{t('edit.cron')}
            <input class="input mono" bind:value={cron} aria-invalid={!!(err('cron') || previewError)} />
            <span class="hint">{t('edit.cronHint')} <span class="mono">*/30 * * * * *</span> {t('edit.cronHintTail')}</span>
            {#if err('cron') || previewError}<span class="err-text">{err('cron') || previewError}</span>{/if}
          </label>
          <label class="field">{t('edit.timeout')}
            <input class="input" type="number" min="0" bind:value={timeoutSec} aria-invalid={!!err('timeoutSec')} />
            <span class="hint">{t('edit.timeoutHint')}</span>
            {#if err('timeoutSec')}<span class="err-text">{err('timeoutSec')}</span>{/if}
          </label>
        </div>

        <div class="card-h" style="border-top:1px solid var(--line)"><h2>{t('edit.execution')}</h2>
          <div class="seg" role="group" aria-label={t('edit.typeAria')}>
            <button type="button" aria-pressed={type === 'cli'} onclick={() => (type = 'cli')}><Icon name="cli" />{typeLabel('cli')}</button>
            <button type="button" aria-pressed={type === 'webhook'} onclick={() => (type = 'webhook')}><Icon name="webhook" />{typeLabel('webhook')}</button>
          </div>
        </div>

        {#if type === 'cli'}
          <div class="card-b form-grid">
            <label class="field full">{t('edit.command')}
              <input class="input mono" bind:value={command} placeholder="python scripts/job.py" aria-invalid={!!err('cli.command')} />
              <span class="hint">{t('edit.commandHint')}</span>
              {#if err('cli.command')}<span class="err-text">{err('cli.command')}</span>{/if}
            </label>
            <label class="field full">{t('edit.cwd')} <span class="hint">{t('edit.cwdHint')}</span>
              <input class="input mono" bind:value={cwd} placeholder={t('edit.cwdPlaceholder')} />
            </label>
            <div class="field full">{t('edit.env')} <span class="hint">{t('edit.maskHint')}</span>
              <KvEditor bind:rows={env} keyLabel={t('edit.envKey')} valueLabel={t('edit.envValue')} addLabel={t('edit.addEnv')} />
              {#if kvError('cli.env')}<span class="err-text">{kvError('cli.env')}</span>{/if}
            </div>
          </div>
        {:else}
          <div class="card-b form-grid">
            <div class="field">{t('edit.method')}
              <div class="seg" role="group" aria-label={t('edit.methodAria')}>
                <button type="button" aria-pressed={method === 'GET'} onclick={() => (method = 'GET')}>GET</button>
                <button type="button" aria-pressed={method === 'POST'} onclick={() => (method = 'POST')}>POST</button>
              </div>
            </div>
            <label class="field">{t('edit.retry')}
              <select class="input" bind:value={retryCount}>
                {#each [0, 1, 2, 3, 4, 5] as n (n)}<option value={n}>{n === 0 ? t('edit.retryDefault', { n }) : t('edit.retryCount', { n })}</option>{/each}
              </select>
            </label>
            <label class="field full">{t('edit.url')}
              <input class="input mono" type="url" bind:value={url} placeholder="https://example.com/hook" aria-invalid={!!err('webhook.url')} />
              <span class="hint">{t('edit.urlHint')}</span>
              {#if err('webhook.url')}<span class="err-text">{err('webhook.url')}</span>{/if}
            </label>
            <div class="field full">{t('edit.headers')} <span class="hint">{t('edit.maskHint')}</span>
              <KvEditor bind:rows={headers} keyLabel={t('edit.headerKey')} valueLabel={t('edit.headerValue')} addLabel={t('edit.addHeader')} />
              {#if kvError('webhook.headers')}<span class="err-text">{kvError('webhook.headers')}</span>{/if}
            </div>
            {#if method === 'POST'}
              <label class="field full">{t('edit.body')} <span class="hint">{t('edit.bodyHint')}</span>
                <textarea class="input mono" bind:value={body}></textarea>
                {#if err('webhook.body')}<span class="err-text">{err('webhook.body')}</span>{/if}
              </label>
            {/if}
          </div>
        {/if}

        <div class="footer-bar">
          <div>
            {#if id !== null}<button type="button" class="btn btn-danger" onclick={remove}>{t('edit.delete')}</button>{/if}
          </div>
          <div class="inline">
            <a class="btn btn-lg" href="#/jobs">{t('common.cancel')}</a>
            <button type="submit" class="btn btn-primary btn-lg" disabled={saving}>{saving ? t('common.saving') : t('common.save')}</button>
          </div>
        </div>
      </form>

      <aside class="side-col" style="display:flex;flex-direction:column;gap:24px">
        <section class="card">
          <div class="card-h"><h2>{t('edit.nextRuns')}</h2></div>
          <div class="card-b" style="padding-top:8px;padding-bottom:8px">
            <ol class="next-list">
              {#each preview as time, i (time)}
                <li>{fullTime(time)}<span>{i === 0 ? t('edit.nextLabel') : `+${i}`}</span></li>
              {:else}
                <li><span>{t('edit.previewEmpty')}</span></li>
              {/each}
            </ol>
          </div>
        </section>
        {#if id !== null}
          <section class="card">
            <div class="card-h"><h2>{t('edit.recent')}</h2><a href="#/runs?jobId={id}" style="font-size:13px;font-weight:600">{t('edit.viewAll')}</a></div>
            <div class="card-b" style="padding-top:8px;padding-bottom:8px">
              <ol class="next-list">
                {#each recent as r (r.id)}
                  <li><a href="#/runs?run={r.id}" style="color:inherit;text-decoration:none">{shortTime(r.startedAt)}</a><Badge status={r.status} label={(r.status === 'success' || r.status === 'failure') && runCode(r) !== '—' ? runCode(r) : undefined} /></li>
                {:else}
                  <li><span>{t('edit.noRuns')}</span></li>
                {/each}
              </ol>
            </div>
          </section>
        {/if}
      </aside>
    </div>
  {/if}
</main>

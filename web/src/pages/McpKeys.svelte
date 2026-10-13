<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '../lib/api.ts';
  import { fullTime } from '../lib/format.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import { notify } from '../lib/state.svelte.ts';
  import type { McpKey } from '../lib/types.ts';

  let keys = $state<McpKey[]>([]);
  let loaded = $state(false);
  let name = $state('');
  let nameError = $state('');
  let issuing = $state(false);
  let issued = $state<{ key: string; name: string } | null>(null);

  const endpoint = `${location.origin}/mcp`;
  const shownKey = $derived(issued?.key ?? t('mcp.keyPlaceholder'));
  const cliExample = $derived(`claude mcp add --transport http webcron ${endpoint} --header "Authorization: Bearer ${shownKey}"`);
  const jsonExample = $derived(JSON.stringify({
    mcpServers: { webcron: { type: 'http', url: endpoint, headers: { Authorization: `Bearer ${shownKey}` } } },
  }, null, 2));

  async function load() {
    try {
      keys = (await api<{ items: McpKey[] }>('GET', '/api/mcp-keys')).items;
    } catch (e) {
      notify((e as Error).message);
    } finally {
      loaded = true;
    }
  }
  onMount(load);

  async function issue(e: SubmitEvent) {
    e.preventDefault();
    issuing = true;
    nameError = '';
    try {
      const r = await api<{ key: string; item: McpKey }>('POST', '/api/mcp-keys', { name });
      issued = { key: r.key, name: r.item.name };
      name = '';
      await load();
    } catch (err) {
      const ae = err as ApiError;
      nameError = ae.errors?.name ?? ae.message;
    } finally {
      issuing = false;
    }
  }

  async function revoke(k: McpKey) {
    if (!confirm(t('mcp.confirmRevoke', { name: k.name }))) return;
    try {
      await api('DELETE', `/api/mcp-keys/${k.id}`);
      notify(t('mcp.revokedNotice', { name: k.name }));
      if (issued && k.prefix === issued.key.slice(0, 12)) issued = null;
      await load();
    } catch (e) {
      notify((e as Error).message);
    }
  }

  // 복사한 버튼은 잠시 '복사됨'으로 바뀐다 (시안과 같은 동작).
  let copied = $state('');
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  async function copy(value: string, which: string) {
    try {
      await navigator.clipboard.writeText(value);
      copied = which;
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => (copied = ''), 1200);
    } catch {
      notify(t('common.copyFailed'));
    }
  }

  const usageExample = $derived(`${t('mcp.usageUser')}
→ create_job {
    "name": "${t('mcp.usageJobName')}",
    "cron": "0 9 * * 1",
    "type": "webhook",
    "webhook": { "method": "POST",
                 "url": "https://report.internal/run" }
  }`);
</script>

<main class="wrap">
  <div class="head">
    <div>
      <h1>MCP</h1>
      <p>{t('mcp.subtitle')}</p>
    </div>
  </div>

  <div class="alert alert-warn" role="note">
    {t('mcp.warning')}
  </div>

  <div class="split">
    <div class="main-col" style="display:flex;flex-direction:column;gap:24px">
      <section class="card" aria-label={t('mcp.issueTitle')}>
        <div class="card-h"><h2>{t('mcp.issueTitle')}</h2></div>
        <form class="card-b" onsubmit={issue} novalidate style="display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px">
          <label class="field" style="flex:1 1 260px">{t('mcp.keyName')}
            <input class="input" maxlength="100" placeholder={t('mcp.keyNamePlaceholder')} bind:value={name} aria-invalid={!!nameError} />
            {#if nameError}<span class="err-text">{nameError}</span>{/if}
          </label>
          <button class="btn btn-primary btn-lg" type="submit" disabled={issuing || !name.trim()}>{issuing ? t('mcp.issuing') : t('mcp.issue')}</button>
        </form>

        {#if issued}
          <div class="card-b" style="border-top:1px solid var(--line);display:flex;flex-direction:column;gap:10px">
            <div class="alert alert-warn" role="status">{t('mcp.issued', { name: issued.name })}</div>
            <div class="keybox">
              <code>{issued.key}</code>
              <button class="btn" type="button" onclick={() => copy(issued!.key, 'key')}>{copied === 'key' ? t('common.copied') : t('mcp.copyKey')}</button>
            </div>
          </div>
        {/if}
      </section>

      <section class="card" aria-label={t('mcp.howTo')}>
        <div class="card-h"><h2>{t('mcp.howTo')}</h2></div>
        <div class="card-b" style="display:flex;flex-direction:column;gap:6px">
          <dl class="meta">
            <dt>{t('mcp.endpoint')}</dt><dd class="mono">{endpoint}</dd>
            <dt>{t('mcp.transport')}</dt><dd>Streamable HTTP</dd>
            <dt>{t('mcp.authHeader')}</dt><dd class="mono">Authorization: Bearer &lt;{t('mcp.keyWord')}&gt;</dd>
          </dl>
          <div class="out-h"><span>Claude Code</span><button class="btn" type="button" onclick={() => copy(cliExample, 'cli')}>{copied === 'cli' ? t('common.copied') : t('common.copy')}</button></div>
          <pre class="out">{cliExample}</pre>
          <div class="out-h"><span>.mcp.json</span><button class="btn" type="button" onclick={() => copy(jsonExample, 'json')}>{copied === 'json' ? t('common.copied') : t('common.copy')}</button></div>
          <pre class="out">{jsonExample}</pre>
          <p class="hint" style="margin:8px 0 0">{t('mcp.approval')}</p>
        </div>
      </section>
    </div>

    <aside class="side-col card" aria-label={t('mcp.tools')}>
      <div class="card-h"><h2>{t('mcp.tools')}</h2></div>
      <div class="card-b">
        <dl class="tools">
          <dt>list_jobs</dt><dd>{t('mcp.toolList')}</dd>
          <dt>create_job</dt><dd>{t('mcp.toolCreate')}</dd>
          <dt>delete_job</dt><dd>{t('mcp.toolDelete')}</dd>
        </dl>
        <div class="out-h"><span>{t('mcp.usage')}</span></div>
        <pre class="out">{usageExample}</pre>
      </div>
    </aside>
  </div>

  <section class="card" aria-label={t('mcp.keys')}>
    <div class="card-h"><h2>{t('mcp.keys')}</h2></div>
    <div class="tbl-box">
      <table style="min-width:720px">
        <thead><tr><th>{t('mcp.colName')}</th><th>{t('mcp.colPrefix')}</th><th>{t('mcp.colCreated')}</th><th>{t('mcp.colLastUsed')}</th><th>{t('mcp.colStatus')}</th><th style="text-align:right">{t('mcp.colActions')}</th></tr></thead>
        <tbody>
          {#each keys as k (k.id)}
            <tr class:off={!!k.revokedAt}>
              <td style="font-weight:600">{k.name}</td>
              <td class="mono" style="font-size:13px">{k.prefix}…</td>
              <td class="mono" style="font-size:13px;white-space:nowrap">{fullTime(k.createdAt)}</td>
              <td class="mono" style="font-size:13px;white-space:nowrap">{k.lastUsedAt ? fullTime(k.lastUsedAt) : t('mcp.neverUsed')}</td>
              <td>
                {#if k.revokedAt}<span class="badge b-interrupted">{t('mcp.revoked')}</span>{:else}<span class="badge b-success">{t('mcp.active')}</span>{/if}
              </td>
              <td style="text-align:right">
                {#if !k.revokedAt}<button class="btn btn-danger" type="button" onclick={() => revoke(k)}>{t('mcp.revoke')}</button>{/if}
              </td>
            </tr>
          {:else}
            <tr><td colspan="6" class="empty">{loaded ? t('mcp.empty') : t('common.loading')}</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
</main>

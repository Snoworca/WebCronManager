<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import LangSwitch from '../components/LangSwitch.svelte';
  import { api, ApiError } from '../lib/api.ts';
  import { t } from '../lib/i18n.svelte.ts';
  import { go, session } from '../lib/state.svelte.ts';
  import type { Me } from '../lib/types.ts';

  let password = $state('');
  let error = $state('');
  let locked = $state(false);
  let busy = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = '';
    locked = false;
    try {
      await api('POST', '/api/login', { password });
      session.me = await api<Me>('GET', '/api/me');
      go('/jobs');
    } catch (err) {
      const ae = err as ApiError;
      locked = ae.status === 429;
      error = ae.message;
      password = '';
    } finally {
      busy = false;
    }
  }
</script>

<div class="login">
  <form class="card login-card" onsubmit={submit} novalidate>
    <div class="inline" style="justify-content:space-between;flex-wrap:wrap">
      <div class="inline">
        <Icon name="clock" size={28} stroke="#2B47C9" />
        <span style="font-size:20px;font-weight:700">WebCron</span>
      </div>
      <LangSwitch />
    </div>
    <div>
      <h1>{t('login.title')}</h1>
      <p style="margin:4px 0 0;color:var(--muted)">{t('login.subtitle')}</p>
    </div>
    {#if error}
      <div class="alert {locked ? 'alert-warn' : 'alert-bad'}" role="alert">{error}</div>
    {/if}
    <label class="field">{t('login.password')}<input class="input" type="password" autocomplete="current-password" bind:value={password} required /></label>
    <button class="btn btn-primary btn-lg" type="submit" disabled={busy || !password}>{busy ? t('login.checking') : t('login.submit')}</button>
    <p class="hint" style="margin:0">{t('login.hint')}</p>
  </form>
</div>

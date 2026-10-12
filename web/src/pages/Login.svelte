<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import { api, ApiError } from '../lib/api.ts';
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
    <div class="inline">
      <Icon name="clock" size={28} stroke="#2B47C9" />
      <span style="font-size:20px;font-weight:700">WebCron</span>
    </div>
    <div>
      <h1>로그인</h1>
      <p style="margin:4px 0 0;color:var(--muted)">관리자 비밀번호를 입력하세요.</p>
    </div>
    {#if error}
      <div class="alert {locked ? 'alert-warn' : 'alert-bad'}" role="alert">{error}</div>
    {/if}
    <label class="field">비밀번호<input class="input" type="password" autocomplete="current-password" bind:value={password} required /></label>
    <button class="btn btn-primary btn-lg" type="submit" disabled={busy || !password}>{busy ? '확인 중…' : '로그인'}</button>
    <p class="hint" style="margin:0">로그인을 5회 연속 실패하면 5분 동안 시도가 차단됩니다.</p>
  </form>
</div>

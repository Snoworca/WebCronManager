<script lang="ts">
  // FR-WEBCRON-012 AC-2: 언어 전환
  import { i18n, setLocale, t } from '../lib/i18n.svelte.ts';
</script>

<div class="seg seg-sm" role="group" aria-label={t('lang.label')}>
  <button type="button" lang="ko" aria-pressed={i18n.locale === 'ko'} onclick={() => setLocale('ko')}>한국어</button>
  <button type="button" lang="en" aria-pressed={i18n.locale === 'en'} onclick={() => setLocale('en')}>English</button>
</div>

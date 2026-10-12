<script lang="ts">
  let { name, size = 16, stroke = 'currentColor' }: { name: 'clock' | 'cli' | 'webhook' | 'play' | 'plus' | 'stop'; size?: number; stroke?: string } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" {stroke} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if name === 'clock'}<circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
  {:else if name === 'cli'}<path d="M4 17l6-5-6-5M12 19h8" />
  {:else if name === 'webhook'}<path d="M5 12h14M13 6l6 6-6 6" />
  {:else if name === 'play'}<path d="M7 5l12 7-12 7z" />
  {:else if name === 'plus'}<path d="M12 5v14M5 12h14" />
  {:else if name === 'stop'}<rect x="6" y="6" width="12" height="12" rx="1.5" />
  {/if}
</svg>

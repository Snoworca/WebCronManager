<script lang="ts">
  import type { Pair } from '../lib/types.ts';

  let { rows = $bindable(), keyLabel, valueLabel, addLabel, secret = false }:
    { rows: Pair[]; keyLabel: string; valueLabel: string; addLabel: string; secret?: boolean } = $props();
</script>

<div class="kv-list">
  {#each rows as row, i (i)}
    <div class="kv">
      <input class="input mono k" aria-label={keyLabel} placeholder={keyLabel} bind:value={row.key} />
      <input class="input mono" aria-label={valueLabel} placeholder={valueLabel} type={secret ? 'password' : 'text'} autocomplete="off" bind:value={row.value} />
      <button type="button" class="btn icon-btn" aria-label="{keyLabel} 삭제" onclick={() => rows.splice(i, 1)}>×</button>
    </div>
  {/each}
</div>
<div><button type="button" class="btn" onclick={() => rows.push({ key: '', value: '' })}>+ {addLabel}</button></div>

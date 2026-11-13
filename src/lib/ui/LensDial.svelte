<script lang="ts">
  import type { Lens } from '../engine/Viewer';

  let { lens, onchange }: { lens: Lens; onchange: (lens: Lens) => void } = $props();

  const LENSES: { id: Lens; label: string }[] = [
    { id: 'space', label: 'Space' },
    { id: 'sun', label: 'Sun' },
    { id: 'rules', label: 'Rules' }
  ];
  const index = $derived(LENSES.findIndex((l) => l.id === lens));

  function onkey(e: KeyboardEvent): void {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    onchange(LENSES[(index + step + LENSES.length) % LENSES.length].id);
  }
</script>

<!-- One control, three positions, switched like the modes of a camera. -->
<div class="dial glass" role="tablist" aria-label="What to look at" tabindex="-1" onkeydown={onkey}>
  <span class="thumb" style:transform="translateX({index * 100}%)" aria-hidden="true"></span>
  {#each LENSES as l (l.id)}
    <button role="tab" aria-selected={lens === l.id} tabindex={lens === l.id ? 0 : -1} class:on={lens === l.id} onclick={() => onchange(l.id)}>
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        {#if l.id === 'space'}
          <path d="M9 2.2 15.2 5.6v6.8L9 15.8l-6.2-3.4V5.6L9 2.2Z" />
          <path d="M2.8 5.6 9 9l6.2-3.4M9 9v6.8" />
        {:else if l.id === 'sun'}
          <circle cx="9" cy="9" r="3.1" />
          <path d="M9 1.6v1.9M9 14.5v1.9M1.6 9h1.9M14.5 9h1.9M3.8 3.8l1.3 1.3M12.9 12.9l1.3 1.3M3.8 14.2l1.3-1.3M12.9 5.1l1.3-1.3" />
        {:else}
          <path d="M2.5 4.5h13v9h-13zM2.5 9h13M7 4.5V9M11.5 9v4.5" />
        {/if}
      </svg>
      <span>{l.label}</span>
    </button>
  {/each}
</div>

<style>
  .dial {
    position: relative;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    width: min(100%, 318px);
    height: 52px;
    padding: 4px;
    border-radius: 999px;
  }
  .thumb {
    position: absolute;
    top: 4px;
    bottom: 4px;
    left: 4px;
    width: calc((100% - 8px) / 3);
    border-radius: 999px;
    background: var(--ink);
    transition: transform 520ms var(--spring-snappy);
  }
  button {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    border-radius: 999px;
    font-weight: 600;
    font-size: 14px;
    letter-spacing: -0.005em;
    color: var(--ink-2);
    transition: color 260ms;
  }
  button.on {
    color: var(--surface);
  }
  svg {
    flex: none;
  }
</style>

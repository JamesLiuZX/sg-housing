<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import LensDial from './LensDial.svelte';
  import RulesPanel from './RulesPanel.svelte';
  import type { Session } from './session.svelte';
  import SpacePanel from './SpacePanel.svelte';
  import SunPanel from './SunPanel.svelte';

  /**
   * Everything at the bottom of the screen: the lens dial, and above it the
   * few controls that belong to the lens in use. Its height is reported so
   * the engine can centre the model in what is left.
   */
  let { session, height = $bindable(0), onwalk }: { session: Session; height?: number; onwalk: () => void } = $props();
</script>

<div class="dock" bind:clientHeight={height}>
  <div class="panel">
    {#key session.lens}
      <div class="swap" in:fly={{ y: 16, duration: 420, delay: 110 }} out:fade={{ duration: 110 }}>
        {#if session.lens === 'space'}
          <SpacePanel {session} {onwalk} />
        {:else if session.lens === 'sun'}
          <SunPanel {session} />
        {:else}
          <RulesPanel {session} />
        {/if}
      </div>
    {/key}
  </div>
  <LensDial lens={session.lens} onchange={(l) => (session.lens = l)} />
</div>

<style>
  .dock {
    position: absolute;
    left: 50%;
    bottom: 0;
    width: min(100%, 560px);
    transform: translateX(-50%);
    padding: 10px calc(var(--gutter) + var(--safe-r)) calc(var(--gutter) + var(--safe-b)) calc(var(--gutter) + var(--safe-l));
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    pointer-events: none;
    animation: rise-in 700ms var(--ease-out) both;
  }
  .dock > :global(*) {
    pointer-events: auto;
  }
  /* Old and new panels share one cell while they swap, so the dock never jumps. */
  .panel {
    display: grid;
    width: 100%;
    pointer-events: none;
  }
  .swap {
    grid-area: 1 / 1;
    align-self: end;
    display: flex;
    justify-content: center;
    pointer-events: none;
  }
  .swap > :global(*) {
    pointer-events: auto;
  }
</style>

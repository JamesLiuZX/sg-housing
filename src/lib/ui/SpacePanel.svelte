<script lang="ts">
  import type { Session } from './session.svelte';

  let { session, onwalk }: { session: Session; onwalk: () => void } = $props();
</script>

<div class="space">
  <div class="seg glass" role="group" aria-label="Furniture">
    <span class="thumb" class:right={!session.furnished} aria-hidden="true"></span>
    <button aria-pressed={session.furnished} class:on={session.furnished} onclick={() => (session.furnished = true)}>Furnished</button>
    <button aria-pressed={!session.furnished} class:on={!session.furnished} onclick={() => (session.furnished = false)}>Bare</button>
  </div>
  <button class="btn btn-primary" onclick={onwalk}>
    Walk inside
    <svg class="nudge" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M3 9h12M10 4l5 5-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </button>
</div>

<style>
  .space {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    width: 100%;
  }
  .seg {
    position: relative;
    display: grid;
    grid-template-columns: 1fr 1fr;
    height: 48px;
    padding: 4px;
    border-radius: 999px;
  }
  .seg .thumb {
    position: absolute;
    top: 4px;
    bottom: 4px;
    left: 4px;
    width: calc((100% - 8px) / 2);
    border-radius: 999px;
    background: rgb(var(--ink-rgb) / 0.1);
    transition: transform 460ms var(--spring-snappy);
  }
  .seg .thumb.right {
    transform: translateX(100%);
  }
  .seg button {
    position: relative;
    padding: 0 16px;
    border-radius: 999px;
    font-weight: 600;
    font-size: 14px;
    color: var(--ink-2);
    transition: color 200ms;
  }
  .seg button.on {
    color: var(--ink);
  }
</style>

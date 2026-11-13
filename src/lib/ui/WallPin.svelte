<script lang="ts">
  import { onMount } from 'svelte';
  import type { Viewer } from '../engine/Viewer';
  import type { Wall } from '../plan/types';
  import { verdictFor, wallLength } from '../sg/rules';
  import { PlanSpace } from './scene';

  /**
   * A tag on the chosen wall itself, so there is no doubt which wall the
   * sheet below is talking about: its length, in the colour of its verdict,
   * on a short stem from the top of the wall.
   */
  let { viewer, frames, wall }: { viewer: Viewer; frames: Set<() => void>; wall: Wall } = $props();

  // The viewer is fixed for the life of the page.
  // svelte-ignore state_referenced_locally
  const space = new PlanSpace(viewer);
  const out = { x: 0, y: 0, front: false };
  let el = $state<HTMLElement>();

  function place(): void {
    if (!el) return;
    const h = (wall.h ?? viewer.plan.height) / 1000;
    space.screen((wall.a[0] + wall.b[0]) / 2, (wall.a[1] + wall.b[1]) / 2, h, out);
    el.style.transform = `translate3d(${out.x.toFixed(1)}px, ${out.y.toFixed(1)}px, 0)`;
    el.toggleAttribute('data-off', !out.front);
  }

  onMount(() => {
    frames.add(place);
    return () => frames.delete(place);
  });
  // A new wall moves the pin at once, without waiting for the camera to move.
  $effect(() => {
    void wall;
    place();
  });

  const tone = $derived(verdictFor(wall)?.tone ?? 'no');
</script>

<div class="pin" data-off bind:this={el} aria-hidden="true">
  {#key wall.id}
    <div class="tag" data-tone={tone}>
      <span class="dot"></span><span class="num">{wallLength(wall)}</span>
    </div>
  {/key}
</div>

<style>
  .pin {
    position: absolute;
    top: 0;
    left: 0;
    width: 0;
    height: 0;
    pointer-events: none;
    will-change: transform;
  }
  .pin[data-off] {
    visibility: hidden;
  }
  .tag {
    position: absolute;
    left: 0;
    bottom: 12px;
    translate: -50% 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 9px 5px 7px;
    border-radius: 999px;
    background: var(--ink);
    color: var(--surface);
    font-size: 11.5px;
    white-space: nowrap;
    box-shadow: 0 6px 16px -8px rgb(0 0 0 / 0.5);
    transform-origin: 50% 100%;
    animation: drop 460ms var(--spring) both;
  }
  /* The stem, down to the top of the wall. */
  .tag::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 100%;
    width: 1.5px;
    height: 12px;
    translate: -50% 0;
    background: var(--ink);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--tone);
    box-shadow: 0 0 0 1.5px rgb(255 255 255 / 0.85);
  }
  [data-tone='no'] {
    --tone: var(--no);
  }
  [data-tone='shelter'] {
    --tone: var(--shelter);
  }
  [data-tone='yes'] {
    --tone: var(--ok);
  }
  [data-tone='wet'] {
    --tone: var(--amber);
  }
  @keyframes drop {
    from {
      opacity: 0;
      transform: translateY(-10px) scale(0.8);
    }
  }
</style>

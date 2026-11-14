<script lang="ts">
  import { prefersReducedMotion } from 'svelte/motion';
  import type { Plan, Room } from '../plan/types';
  import { shortName } from './format';
  import { stripRooms } from './pins';

  /**
   * The rooms, in a strip along the bottom, to jump between while walking.
   * Each carries its own outline from the plan, a thumbnail that is true to
   * the room's shape. The room you are standing in is marked, and the strip
   * keeps it in view as you walk.
   */
  let { plan, here, onpick }: { plan: Plan; here: string; onpick: (roomId: string) => void } = $props();

  // A strip belongs to one walk, and the flat does not change during a walk.
  // svelte-ignore state_referenced_locally
  const rooms = stripRooms(plan);

  /** A room's outline, scaled into a 20-unit square and centred. */
  function glyph(r: Room): string {
    const xs = r.poly.map((p) => p[0]);
    const ys = r.poly.map((p) => p[1]);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const w = Math.max(...xs) - x0;
    const h = Math.max(...ys) - y0;
    const k = 15 / Math.max(w, h, 1);
    const ox = (20 - w * k) / 2;
    const oy = (20 - h * k) / 2;
    return `M${r.poly.map(([x, y]) => `${(ox + (x - x0) * k).toFixed(2)} ${(oy + (y - y0) * k).toFixed(2)}`).join('L')}Z`;
  }
  const glyphs = rooms.map(glyph);

  let track = $state<HTMLElement>();

  // Keeps the room you are in on screen, as the strip scrolls sideways on a phone.
  $effect(() => {
    const id = here;
    const el = track?.querySelector<HTMLElement>(`[data-room="${CSS.escape(id)}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: prefersReducedMotion.current ? 'auto' : 'smooth' });
  });
</script>

<nav class="strip glass" aria-label="Rooms" data-avoid>
  <div class="track" bind:this={track}>
    {#each rooms as r, i (r.id)}
      {@const on = r.id === here}
      <button class:on data-room={r.id} aria-label={r.name} aria-current={on ? 'location' : undefined} style="--i:{i}" onclick={() => onpick(r.id)}>
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d={glyphs[i]} /></svg>
        <span class="full" aria-hidden="true">{r.name}</span><span class="short" aria-hidden="true">{shortName(r.name)}</span>
      </button>
    {/each}
  </div>
</nav>

<style>
  .strip {
    border-radius: 999px;
    padding: 4px;
    overflow: hidden;
  }
  .track {
    display: flex;
    gap: 2px;
    overflow-x: auto;
    scroll-snap-type: x proximity;
    scrollbar-width: none;
    overscroll-behavior-x: contain;
    /* The strip fades at its ends, so a room cut off at the edge reads as "more this way". */
    mask-image: linear-gradient(to right, transparent, #000 14px, #000 calc(100% - 14px), transparent);
    -webkit-mask-image: linear-gradient(to right, transparent, #000 14px, #000 calc(100% - 14px), transparent);
  }
  .track::-webkit-scrollbar {
    display: none;
  }
  button {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 44px;
    padding: 0 14px 0 10px;
    border-radius: 999px;
    font-size: 13.5px;
    font-weight: 600;
    letter-spacing: -0.005em;
    color: var(--ink-2);
    white-space: nowrap;
    scroll-snap-align: center;
    animation: rise-in 420ms var(--ease-out) both;
    animation-delay: calc(820ms + var(--i) * 35ms);
    transition:
      background-color 240ms,
      color 240ms,
      transform 160ms var(--ease-out);
  }
  button:first-child {
    margin-left: 8px;
  }
  button:last-child {
    margin-right: 8px;
  }
  button:active {
    transform: scale(0.95);
  }
  button.on {
    background: var(--ink);
    color: var(--surface);
  }
  @media (hover: hover) {
    button:not(.on):hover {
      color: var(--ink);
      background: rgb(var(--ink-rgb) / 0.06);
    }
  }
  svg {
    flex: none;
  }
  path {
    fill: rgb(var(--ink-rgb) / 0.08);
    stroke: currentColor;
    stroke-width: 1.2;
    stroke-linejoin: round;
    transition: fill 240ms;
  }
  .on path {
    fill: rgb(var(--surface-rgb) / 0.22);
  }
  .short {
    display: none;
  }
  @media (max-width: 519px) {
    .full {
      display: none;
    }
    .short {
      display: inline;
    }
  }
</style>

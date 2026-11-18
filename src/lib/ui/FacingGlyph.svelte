<script lang="ts">
  import { flatPoint, groundBox, shapePath, sideMarks } from './outline';
  import type { Session } from './session.svelte';

  /**
   * Which way a flat in a real block faces, drawn rather than dialled: the
   * block from above, north up, with the side chosen on the block stage in
   * sun orange and the flat on it. It is a picture of a fact, so nothing on
   * it turns. Only the typical flat has a compass to turn.
   */
  let { session }: { session: Session } = $props();

  const block = $derived(session.block);
  const box = $derived(groundBox(block?.footprint ?? null));
  const own = $derived(block ? shapePath(block.footprint.parts) : '');
  const side = $derived(session.facade ? sideMarks(session.facade, box) : null);
  const flat = $derived(session.facade ? flatPoint(session.facade, session.along) : null);
</script>

<figure class="glyph" aria-hidden="true">
  <svg viewBox="{box.x} {box.y} {box.w} {box.h}">
    <path class="own" d={own} />
    {#if side}
      <path class="edge" d={side.line} />
      <path class="ray" d={side.ray} />
      <path
        class="head"
        d="M0 -3.2L-1.6 0H1.6Z"
        transform="translate({side.head.x.toFixed(1)} {side.head.y.toFixed(1)}) rotate({side.head.angle}) scale({(box.w / 40).toFixed(2)})"
      />
    {/if}
    {#if flat}
      <circle class="flat" cx={flat.x} cy={flat.y} r={box.w * 0.035} />
    {/if}
  </svg>
  <span class="n">N</span>
</figure>

<style>
  .glyph {
    position: relative;
    flex: none;
    width: 48px;
    height: 48px;
    margin: 0;
    border-radius: 12px;
    /* A tile, not a dial: square corners say "drawing", where the compass's circle says "turn me". */
    background: rgb(var(--ink-rgb) / 0.05);
    box-shadow: inset 0 0 0 0.5px var(--line);
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .own {
    fill: rgb(var(--ink-rgb) / 0.14);
    stroke: var(--ink);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
    stroke-linejoin: round;
  }
  .edge {
    fill: none;
    stroke: var(--sun);
    stroke-width: 3px;
    vector-effect: non-scaling-stroke;
    stroke-linecap: round;
  }
  .ray {
    fill: none;
    stroke: var(--sun);
    stroke-width: 1.25px;
    vector-effect: non-scaling-stroke;
    stroke-dasharray: 1.5 2;
  }
  .head {
    fill: var(--sun);
  }
  .flat {
    fill: var(--surface);
    stroke: var(--sun);
    stroke-width: 1.5px;
    vector-effect: non-scaling-stroke;
  }
  .n {
    position: absolute;
    top: 3px;
    right: 5px;
    font: 700 9px/1 var(--font-mark);
    color: var(--sun-ink);
  }
  @media (min-width: 820px) {
    .glyph {
      width: 52px;
      height: 52px;
    }
  }
</style>

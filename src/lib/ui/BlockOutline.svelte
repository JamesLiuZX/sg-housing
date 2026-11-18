<script lang="ts">
  import type { Facade } from '../data';
  import { flatPoint, groundBox, nearestSide, onFootprint, sameSide, shapePath, sideMarks } from './outline';
  import { facingWords } from './place';
  import type { Session } from './session.svelte';

  /**
   * The block from above, north up, as HDB surveyed it, with its neighbours
   * faint around it. A tap anywhere on it names the side nearest the finger,
   * and where along that side the flat is, so even a short side has the
   * whole drawing for a target; keys reach each side in turn. The chosen side
   * is drawn in sun orange with the view out of it, so the bearing the sun is
   * worked from is never in doubt.
   */
  let { session }: { session: Session } = $props();

  const block = $derived(session.block);
  const box = $derived(groundBox(block?.footprint ?? null));
  const own = $derived(block ? shapePath(block.footprint.parts) : '');
  const near = $derived(block ? block.neighbours.map((n) => shapePath(n.footprint.parts)).join('') : '');

  const sides = $derived(session.sides.map((f) => ({ f, ...sideMarks(f, box), words: facingWords(f.bearing) })));
  const chosen = $derived(session.facade);
  const flat = $derived(chosen ? flatPoint(chosen, session.along) : null);

  let svg = $state<SVGSVGElement>();
  /** The side a mouse over the drawing would choose, so a click is never a surprise. */
  let hover = $state(-1);

  /** The side under a pointer, through the drawing's own coordinates. */
  function sideAt(e: PointerEvent): { index: number; along: number } | null {
    const m = svg?.getScreenCTM();
    if (!m || !block) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return nearestSide(session.sides, p.x, p.y, onFootprint(block.footprint.parts, p.x, p.y));
  }

  function pick(e: PointerEvent): void {
    if (e.button !== 0) return;
    const hit = sideAt(e);
    if (hit) session.chooseSide(session.sides[hit.index], hit.along);
  }

  function point(e: PointerEvent): void {
    hover = e.pointerType === 'mouse' ? (sideAt(e)?.index ?? -1) : -1;
  }

  function key(e: KeyboardEvent, f: Facade): void {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    session.chooseSide(f);
  }
</script>

{#if block}
  <figure class="outline glass" aria-label="Blk {block.blk} from above, north up">
    <!-- The pointer reaches the sides through the whole drawing; each side is also its own button for keys and screen readers. -->
    <svg
      bind:this={svg}
      viewBox="{box.x} {box.y} {box.w} {box.h}"
      role="group"
      aria-label="Sides of the block"
      onpointerup={pick}
      onpointermove={point}
      onpointerleave={() => (hover = -1)}
    >
      <path class="near" d={near} />
      <path class="own" d={own} />
      {#each sides as s, i (i)}
        {@const on = sameSide(chosen, s.f)}
        <g
          class="side"
          class:on
          class:hover={hover === i}
          role="button"
          tabindex="0"
          aria-pressed={on}
          aria-label="Living room faces {s.words.point}, {s.words.deg} degrees"
          onkeydown={(e) => key(e, s.f)}
        >
          <path class="edge" d={s.line} />
          {#if on}
            <path class="ray" d={s.ray} />
            <path
              class="head"
              d="M0 -3.2L-1.6 0H1.6Z"
              transform="translate({s.head.x.toFixed(1)} {s.head.y.toFixed(1)}) rotate({s.head.angle}) scale({(box.w / 60).toFixed(2)})"
            />
          {/if}
        </g>
      {/each}
      {#if flat}
        <circle class="flat" cx={flat.x} cy={flat.y} r={box.w * 0.022} />
      {/if}
    </svg>
    <span class="n" aria-hidden="true">N</span>
  </figure>
{/if}

<style>
  .outline {
    position: relative;
    margin: 0;
    width: 112px;
    padding: 6px;
    border-radius: 18px;
    pointer-events: auto;
  }
  svg {
    display: block;
    width: 100%;
    height: auto;
    aspect-ratio: 1;
    overflow: visible;
    cursor: pointer;
    touch-action: manipulation;
  }
  .near {
    fill: rgb(var(--ink-rgb) / 0.07);
    stroke: none;
  }
  .own {
    fill: rgb(var(--ink-rgb) / 0.16);
    stroke: var(--ink);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
    stroke-linejoin: round;
  }
  .side {
    outline: none;
    /* The drawing as a whole takes the pointer; see sideAt. */
    pointer-events: none;
  }
  .edge {
    fill: none;
    stroke: var(--ink-3);
    stroke-width: 2px;
    vector-effect: non-scaling-stroke;
    stroke-linecap: round;
    stroke-dasharray: 2 3;
    transition: stroke 160ms;
  }
  .side.hover .edge {
    stroke: var(--ink);
    stroke-dasharray: none;
  }
  .side:focus-visible .edge {
    stroke: var(--ink);
    stroke-width: 3px;
    stroke-dasharray: none;
  }
  .side.on .edge {
    stroke: var(--sun);
    stroke-width: 3.5px;
    stroke-dasharray: none;
  }
  .ray {
    fill: none;
    stroke: var(--sun);
    stroke-width: 1.5px;
    vector-effect: non-scaling-stroke;
    stroke-dasharray: 1.5 2;
  }
  .head {
    fill: var(--sun);
  }
  .flat {
    fill: var(--surface);
    stroke: var(--sun);
    stroke-width: 2px;
    vector-effect: non-scaling-stroke;
  }
  .n {
    position: absolute;
    top: 6px;
    right: 9px;
    font: 700 11px/1 var(--font-mark);
    color: var(--sun-ink);
    pointer-events: none;
  }
  @media (min-width: 820px) {
    .outline {
      width: 168px;
      padding: 8px;
    }
  }
</style>

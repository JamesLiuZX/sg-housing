<script lang="ts">
  import type { Facade, Ring } from '../data';
  import { facingWords } from './place';
  import type { Session } from './session.svelte';

  /**
   * The block from above, north up, as HDB surveyed it, with its neighbours
   * faint around it. Each side a person would point at is a target: tap it,
   * or tab to it, to say the living room looks out that way. The chosen side
   * is drawn in sun orange with the view out of it, so the bearing the sun
   * is worked from is never in doubt.
   */
  let { session }: { session: Session } = $props();

  const block = $derived(session.block);
  /** Metres of ground shown round the block. */
  const box = $derived.by(() => {
    if (!block) return { x: -10, y: -10, w: 20, h: 20 };
    const b = block.footprint.bounds;
    const side = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 1.5 + 16;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    // SVG runs y down the page; north is up, so y is flipped.
    return { x: cx - side / 2, y: -cy - side / 2, w: side, h: side };
  });

  const ring = (r: Ring) => `M${r.map(([x, y]) => `${x.toFixed(1)} ${(-y).toFixed(1)}`).join('L')}Z`;
  const shape = (parts: { outer: Ring; holes: Ring[] }[]) => parts.map((p) => ring(p.outer) + p.holes.map(ring).join('')).join('');

  const own = $derived(block ? shape(block.footprint.parts) : '');
  const near = $derived(block ? block.neighbours.map((n) => shape(n.footprint.parts)).join('') : '');

  /** A side, stood off the wall a little so it reads as "this side" rather than as the wall. */
  function band(f: Facade) {
    const r = (f.bearing * Math.PI) / 180;
    const ox = Math.sin(r);
    const oy = -Math.cos(r);
    const off = box.w * 0.035;
    const p = (x: number, y: number, k = off) => `${(x + ox * k).toFixed(1)} ${(-y + oy * k).toFixed(1)}`;
    const mx = f.mid[0];
    const my = f.mid[1];
    return {
      line: `M${p(f.a[0], f.a[1])}L${p(f.b[0], f.b[1])}`,
      ray: `M${p(mx, my, off * 1.8)}L${p(mx, my, off * 5)}`,
      head: { x: mx + ox * off * 5, y: -my + oy * off * 5, angle: f.bearing }
    };
  }

  const sides = $derived(session.sides.map((f) => ({ f, ...band(f), words: facingWords(f.bearing) })));
  const chosen = $derived(session.facade);
  const isChosen = (f: Facade) => !!chosen && chosen.part === f.part && chosen.ring === f.ring && chosen.bearing === f.bearing && chosen.length === f.length;

  /** Where the flat sits along the chosen side. */
  const flat = $derived.by(() => {
    if (!chosen) return null;
    const t = session.along;
    return { x: chosen.a[0] + (chosen.b[0] - chosen.a[0]) * t, y: -(chosen.a[1] + (chosen.b[1] - chosen.a[1]) * t) };
  });

  function key(e: KeyboardEvent, f: Facade): void {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    session.chooseSide(f);
  }
</script>

{#if block}
  <figure class="outline glass" aria-label="Blk {block.blk} from above, north up">
    <svg viewBox="{box.x} {box.y} {box.w} {box.h}" role="group" aria-label="Sides of the block">
      <path class="near" d={near} />
      <path class="own" d={own} />
      {#each sides as s, i (i)}
        {@const on = isChosen(s.f)}
        <g
          class="side"
          class:on
          role="button"
          tabindex="0"
          aria-pressed={on}
          aria-label="Living room faces {s.words.point}, {s.words.deg} degrees"
          onclick={() => session.chooseSide(s.f)}
          onkeydown={(e) => key(e, s.f)}
        >
          <path class="hit" d={s.line} />
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
    width: 120px;
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
    cursor: pointer;
    outline: none;
  }
  /* A fat, invisible stroke: the target is far bigger than the line a person sees. */
  .hit {
    fill: none;
    stroke: transparent;
    stroke-width: 18px;
    vector-effect: non-scaling-stroke;
    stroke-linecap: round;
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
  @media (hover: hover) {
    .side:hover .edge {
      stroke: var(--ink);
      stroke-dasharray: none;
    }
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
  }
  @media (min-width: 820px) {
    .outline {
      width: 168px;
      padding: 8px;
    }
  }
</style>

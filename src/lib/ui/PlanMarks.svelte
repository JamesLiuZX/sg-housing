<script lang="ts">
  import { onMount } from 'svelte';
  import type { Viewer } from '../engine/Viewer';
  import { PlanSpace, type ScreenPoint } from './scene';

  /**
   * The marks an architect puts round a plan: overall dimensions along two
   * sides and a north arrow. They are measured off the drawing on screen, so
   * the numbers sit exactly where the plan's edges are, and north is true.
   * The arrow first points up the page, then swings round to north.
   */
  let { viewer, frames, bearing, leaving }: { viewer: Viewer; frames: Set<() => void>; bearing: number; leaving: boolean } = $props();

  // The viewer and its plan are fixed for the life of the page.
  // svelte-ignore state_referenced_locally
  const plan = viewer.plan;
  // svelte-ignore state_referenced_locally
  const space = new PlanSpace(viewer);
  const xs = plan.outline.map((p) => p[0]);
  const ys = plan.outline.map((p) => p[1]);
  const X0 = Math.min(...xs);
  const X1 = Math.max(...xs);
  const Y0 = Math.min(...ys);
  const Y1 = Math.max(...ys);

  /** How far the dimension line stands off the wall, px. */
  const OFF = 22;

  interface Dim {
    a: [number, number];
    b: [number, number];
    /** Witness lines from near the wall out past the dimension line. */
    wa: string;
    wb: string;
    ticks: string;
    label: { x: number; y: number; angle: number; text: string };
    len: number;
    /** Unit vector from the wall out to the line. */
    n: [number, number];
  }

  let dims = $state<Dim[]>([]);
  let north = $state<{ x: number; y: number; up: number; angle: number } | null>(null);
  let key = '';

  const pts = Array.from({ length: 4 }, (): ScreenPoint => ({ x: 0, y: 0, front: true }));

  function dim(ax: number, ay: number, bx: number, by: number, ox: number, oy: number, metres: number): Dim {
    const [A, B, O] = pts;
    space.screen(ax, ay, 0, A);
    space.screen(bx, by, 0, B);
    space.screen(ax + ox, ay + oy, 0, O);
    // Outward on screen, from the wall towards the side the line stands on.
    let nx = O.x - A.x;
    let ny = O.y - A.y;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl;
    ny /= nl;
    const a: [number, number] = [A.x + nx * OFF, A.y + ny * OFF];
    const b: [number, number] = [B.x + nx * OFF, B.y + ny * OFF];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const w = (p: ScreenPoint) => `M${(p.x + nx * 6).toFixed(1)} ${(p.y + ny * 6).toFixed(1)}L${(p.x + nx * (OFF + 6)).toFixed(1)} ${(p.y + ny * (OFF + 6)).toFixed(1)}`;
    // Architects' ticks: short strokes at 45° through each end.
    const tx = (ux + nx) * 4.2;
    const ty = (uy + ny) * 4.2;
    const tick = (p: [number, number]) => `M${(p[0] - tx).toFixed(1)} ${(p[1] - ty).toFixed(1)}L${(p[0] + tx).toFixed(1)} ${(p[1] + ty).toFixed(1)}`;
    let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle <= -90) angle += 180;
    return {
      a,
      b,
      wa: w(A),
      wb: w(B),
      ticks: tick(a) + tick(b),
      label: { x: (a[0] + b[0]) / 2 + nx * 11, y: (a[1] + b[1]) / 2 + ny * 11, angle, text: `${metres.toFixed(1)} m` },
      len,
      n: [nx, ny]
    };
  }

  function measure(): void {
    const next = [dim(X0, Y0, X1, Y0, 0, -1000, (X1 - X0) / 1000), dim(X1, Y0, X1, Y1, 1000, 0, (Y1 - Y0) / 1000)];
    // North: up the plan on screen, turned by the bearing the top of the plan faces.
    const [C, U] = [pts[0], pts[1]];
    space.screen((X0 + X1) / 2, (Y0 + Y1) / 2, 0, C);
    space.screen((X0 + X1) / 2, (Y0 + Y1) / 2 - 1000, 0, U);
    const up = (Math.atan2(U.x - C.x, -(U.y - C.y)) * 180) / Math.PI;
    // Out past the corner where the two dimension strings meet.
    const [w, d] = next;
    const x = w.b[0] - w.n[0] * OFF + (w.n[0] + d.n[0]) * 62;
    const y = w.b[1] - w.n[1] * OFF + (w.n[1] + d.n[1]) * 62;
    const k = next.map((m) => `${m.a.map(Math.round)}${m.b.map(Math.round)}`).join();
    if (k === key) return;
    key = k;
    dims = next;
    // The short way round, so the swing never spins past north.
    north = { x, y, up, angle: up + ((((-bearing % 360) + 540) % 360) - 180) };
  }

  // The arrow is drawn pointing up the plan, then released to swing to north.
  let swung = $state(false);

  onMount(() => {
    frames.add(measure);
    measure();
    const t = setTimeout(() => (swung = true), 1700);
    return () => {
      frames.delete(measure);
      clearTimeout(t);
    };
  });
</script>

<div class="marks" class:leaving aria-hidden="true">
  <svg class="dims">
    {#each dims as d, i (i)}
      <g style="--i:{i}">
        <path class="witness" d={d.wa + d.wb} />
        <path class="line" d="M{d.a[0].toFixed(1)} {d.a[1].toFixed(1)}L{d.b[0].toFixed(1)} {d.b[1].toFixed(1)}" style="--len:{d.len.toFixed(0)}" />
        <path class="tick" d={d.ticks} />
        <text x={d.label.x.toFixed(1)} y={d.label.y.toFixed(1)} transform="rotate({d.label.angle.toFixed(2)} {d.label.x.toFixed(1)} {d.label.y.toFixed(1)})">{d.label.text}</text>
      </g>
    {/each}
  </svg>
  {#if north}
    <div class="north" style:left="{north.x}px" style:top="{north.y}px">
      <svg width="34" height="46" viewBox="-17 -27 34 46" style:rotate="{swung ? north.angle : north.up}deg">
        <circle r="12" />
        <path class="half" d="M0 -12 4.6 9 0 5.6Z" />
        <path class="half-o" d="M0 -12 -4.6 9 0 5.6Z" />
        <text y="-16">N</text>
      </svg>
    </div>
  {/if}
</div>

<style>
  .marks {
    position: absolute;
    inset: 0;
    pointer-events: none;
    color: var(--ink);
    transition: opacity 320ms var(--ease-in);
  }
  .marks.leaving {
    opacity: 0;
  }
  .dims {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .witness,
  .line,
  .tick {
    fill: none;
    stroke: var(--ink-2);
    stroke-width: 0.75;
  }
  .tick {
    stroke: var(--ink);
    stroke-width: 1.2;
  }
  g {
    animation: fade-in 500ms var(--ease-out) both;
    animation-delay: calc(1500ms + var(--i) * 160ms);
  }
  /* The dimension line draws itself out from one end, like a pen. */
  .line {
    stroke-dasharray: var(--len) var(--len);
    animation: draw 900ms var(--ease-move) both;
    animation-delay: inherit;
  }
  @keyframes draw {
    from {
      stroke-dashoffset: var(--len);
    }
  }
  text {
    font: 500 10.5px/1 var(--font-mono);
    letter-spacing: 0.02em;
    fill: var(--ink-2);
    text-anchor: middle;
    dominant-baseline: central;
  }

  .north {
    position: absolute;
    translate: -50% -50%;
    animation: fade-in 600ms var(--ease-out) 1300ms both;
  }
  .north svg {
    display: block;
    width: 34px;
    height: 46px;
    overflow: visible;
    /* The centre of the ring, so it turns in place. */
    transform-origin: 50% 58.7%;
    transition: rotate 1400ms var(--spring);
  }
  @media (min-width: 820px) {
    .north svg {
      width: 42px;
      height: 57px;
    }
  }
  .north circle {
    fill: none;
    stroke: var(--ink-2);
    stroke-width: 0.75;
  }
  .half {
    fill: var(--ink);
  }
  .half-o {
    fill: var(--surface);
    stroke: var(--ink);
    stroke-width: 0.75;
    stroke-linejoin: round;
  }
  .north text {
    font: 700 11px/1 var(--font-mark);
    fill: var(--ink);
    text-anchor: middle;
    dominant-baseline: central;
  }
</style>

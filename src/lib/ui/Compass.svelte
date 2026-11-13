<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { Spring, prefersReducedMotion } from 'svelte/motion';
  import { windowAspects } from '../sg/solar';
  import type { Session } from './session.svelte';

  /**
   * Turns the flat. The model on screen stays put while the world turns
   * around it, so this dial does the same: the flat sits fixed in the middle,
   * plan-up at the top, and the compass rose turns under the finger. North
   * sits at minus the bearing from the top.
   */
  let { session }: { session: Session } = $props();

  // The session lives as long as the page; reading its plan once at set-up is the intent.
  // svelte-ignore state_referenced_locally
  const plan = session.plan;
  const RAD = Math.PI / 180;

  // The flat's footprint, scaled into the middle of the dial.
  const xs = plan.outline.map((p) => p[0]);
  const ys = plan.outline.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const k = 20 / Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const at = (x: number, y: number) => `${((x - cx) * k).toFixed(2)} ${((y - cy) * k).toFixed(2)}`;
  const outline = `M${plan.outline.map(([x, y]) => at(x, y)).join('L')}Z`;

  // The window the facing statement talks about, and a short ray out of it showing which way it looks.
  const view = (() => {
    const aspects = windowAspects(plan, 0);
    const nameOf = (id: string) => plan.rooms.find((r) => r.id === id)?.name ?? '';
    const a = aspects.find((w) => /living/i.test(nameOf(w.room))) ?? aspects[0];
    const o = a && plan.openings.find((x) => x.id === a.id);
    const wall = o && plan.walls.find((w) => w.id === o.wall);
    if (!a || !o || !wall) return null;
    const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
    const dx = (wall.b[0] - wall.a[0]) / len;
    const dy = (wall.b[1] - wall.a[1]) / len;
    const x0 = wall.a[0] + dx * o.at;
    const y0 = wall.a[1] + dy * o.at;
    const x1 = wall.a[0] + dx * (o.at + o.w);
    const y1 = wall.a[1] + dy * (o.at + o.w);
    const mx = ((x0 + x1) / 2 - cx) * k;
    const my = ((y0 + y1) / 2 - cy) * k;
    const ox = Math.sin(a.bearing * RAD);
    const oy = -Math.cos(a.bearing * RAD);
    const p = (d: number) => `${(mx + ox * d).toFixed(2)} ${(my + oy * d).toFixed(2)}`;
    return { glass: `M${at(x0, y0)}L${at(x1, y1)}`, ray: `M${p(1.8)}L${p(6.4)}` };
  })();

  /*
   * The rose's angle on screen. Unwrapped, so it always turns the short way
   * across north; sprung, so a key press or a release settles with weight.
   */
  // svelte-ignore state_referenced_locally
  let unwrapped = -session.bearing;
  // svelte-ignore state_referenced_locally
  let last = session.bearing;
  const spin = new Spring(unwrapped, { stiffness: 0.16, damping: 0.62 });

  let el = $state<HTMLElement>();
  let drag: { id: number; angle: number; turned: number; from: number; base: number } | null = null;
  let dragging = $state(false);

  $effect(() => {
    const b = session.bearing;
    untrack(() => {
      unwrapped += ((((last - b) % 360) + 540) % 360) - 180;
      last = b;
      if (!drag) void spin.set(unwrapped, { instant: prefersReducedMotion.current });
    });
  });

  // Says "this turns" once: the rose rocks a few degrees and settles, the way a drag would move it.
  onMount(() => {
    if (prefersReducedMotion.current) return;
    const a = setTimeout(() => !drag && void spin.set(unwrapped - 14), 650);
    const b = setTimeout(() => !drag && void spin.set(unwrapped), 900);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  });

  function angleOf(e: PointerEvent): number {
    const box = el!.getBoundingClientRect();
    return Math.atan2(e.clientX - (box.left + box.width / 2), -(e.clientY - (box.top + box.height / 2))) / RAD;
  }

  function down(e: PointerEvent): void {
    if (e.button !== 0 || drag) return;
    el!.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, angle: angleOf(e), turned: 0, from: session.bearing, base: spin.current };
    dragging = true;
  }

  function move(e: PointerEvent): void {
    if (!drag || drag.id !== e.pointerId) return;
    const a = angleOf(e);
    // Small steps, accumulated, so a finger passing close to the centre never jumps a whole turn.
    drag.turned += ((((a - drag.angle) % 360) + 540) % 360) - 180;
    drag.angle = a;
    // The rose follows the finger freely; the bearing itself clicks in 5° steps.
    void spin.set(drag.base + drag.turned, { instant: true });
    session.turn(Math.round((drag.from - drag.turned) / 5) * 5);
  }

  function release(e: PointerEvent): void {
    if (!drag || drag.id !== e.pointerId) return;
    drag = null;
    dragging = false;
    // Settle into the step the bearing clicked to.
    void spin.set(unwrapped, { instant: prefersReducedMotion.current });
  }

  const KEYS: Record<string, number> = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5, PageUp: 45, PageDown: -45 };

  function key(e: KeyboardEvent): void {
    const step = KEYS[e.key];
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    session.turn(Math.round((session.bearing + step) / 5) * 5);
  }

  const ticks = Array.from({ length: 24 }, (_, i) => i * 15);
  // The letter rides the rose but stays upright.
  const north = $derived({ x: Math.sin(spin.current * RAD) * 14.4, y: -Math.cos(spin.current * RAD) * 14.4 });
  const valueText = $derived(`${session.facing.room} faces ${session.facing.point}, ${session.facing.deg} degrees`);
</script>

<div
  class="compass"
  class:dragging
  bind:this={el}
  role="slider"
  tabindex="0"
  aria-label="Turn the flat"
  aria-valuemin={0}
  aria-valuemax={359}
  aria-valuenow={session.bearing}
  aria-valuetext={valueText}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={release}
  onpointercancel={release}
  onkeydown={key}
>
  <svg viewBox="-24 -24 48 48" aria-hidden="true">
    <circle class="face" r="23.25" />
    <g transform="rotate({spin.current.toFixed(2)})">
      {#each ticks as t (t)}
        <line class="tick" class:major={t % 90 === 0} x1="0" x2="0" y1="-23.25" y2={t % 90 === 0 ? -19.6 : -21.4} transform="rotate({t})" />
      {/each}
      <path class="needle" d="M0 -23.4L2.4 -19.1H-2.4Z" />
    </g>
    <text class="n" x={north.x.toFixed(2)} y={north.y.toFixed(2)}>N</text>
    <path class="flat" d={outline} />
    {#if view}
      <path class="window" d={view.glass} />
      <path class="ray" d={view.ray} />
    {/if}
  </svg>
</div>

<style>
  .compass {
    flex: none;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    touch-action: none;
    cursor: grab;
    outline: none;
  }
  .compass.dragging {
    cursor: grabbing;
  }
  .compass:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .face {
    fill: rgb(var(--ink-rgb) / 0.06);
    stroke: var(--ink-3);
    stroke-width: 0.75;
  }
  .tick {
    stroke: var(--ink-3);
    stroke-width: 0.75;
  }
  .tick.major {
    stroke: var(--ink-2);
    stroke-width: 1;
  }
  .needle {
    fill: var(--sun);
  }
  .n {
    font: 700 8.5px/1 var(--font-mark);
    fill: var(--sun-ink);
    text-anchor: middle;
    dominant-baseline: central;
  }
  .flat {
    fill: var(--surface);
    stroke: var(--ink);
    stroke-width: 1;
    stroke-linejoin: round;
  }
  .window {
    stroke: var(--sun);
    stroke-width: 2.2;
    stroke-linecap: round;
  }
  .ray {
    stroke: var(--sun);
    stroke-width: 1.1;
    stroke-linecap: round;
    stroke-dasharray: 1.2 1.5;
  }

  @media (min-width: 820px) {
    .compass {
      width: 52px;
      height: 52px;
    }
  }
</style>

<script lang="ts">
  import { onMount } from 'svelte';
  import type { Viewer } from '../engine/Viewer';
  import { roomPins, type Pin } from './pins';
  import { PlanSpace } from './scene';
  import type { Session } from './session.svelte';

  /**
   * Captions on the room you are standing in, written where each fact is
   * true: the sun's hours on the window, the clear size on the floor, and on
   * a partition, that it can usually go. They are placed on every rendered
   * frame by writing transforms straight to the DOM. A caption that would be
   * behind you, off the screen, or touching another caption or a control is
   * left out until it is clear again; it tries below its point before giving
   * up. Never more than three, and never a badge: words with a hairline.
   */
  let {
    viewer,
    session,
    frames,
    here
  }: { viewer: Viewer; session: Session; frames: Set<() => void>; here: string } = $props();

  // The viewer is fixed for the life of a walk.
  // svelte-ignore state_referenced_locally
  const space = new PlanSpace(viewer);
  const pins = $derived(here ? roomPins(session.plan, here, session.roomSun.get(here), session.month) : []);

  /** Stem from the point to the caption, px. */
  const STEM = 16;
  /** Clear space round a caption, px. */
  const GAP = 8;
  /** Captions stay this far inside the screen edge, px. */
  const EDGE = 8;

  type Box = { x: number; y: number; w: number; h: number };
  const els: (HTMLElement | undefined)[] = [];
  const caps: (HTMLElement | undefined)[] = [];
  const size: { w: number; h: number }[] = [];
  const out = { x: 0, y: 0, front: false };
  let shown: Pin[] = [];

  $effect(() => {
    shown = pins;
    place();
  });

  const clear = (b: Box, taken: Box[]) =>
    taken.every((p) => b.x >= p.x + p.w + GAP || p.x >= b.x + b.w + GAP || b.y >= p.y + p.h + GAP || p.y >= b.y + b.h + GAP);

  function place(): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const taken: Box[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('[data-avoid]')) {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) taken.push({ x: r.left, y: r.top, w: r.width, h: r.height });
    }
    const inside = (b: Box) => b.x >= EDGE && b.y >= EDGE && b.x + b.w <= vw - EDGE && b.y + b.h <= vh - EDGE;
    for (let i = 0; i < shown.length; i++) {
      const el = els[i];
      const s = size[i];
      if (!el || !s) continue;
      const p = shown[i];
      space.screen(p.x, p.y, p.h, out);
      let spot: 'above' | 'below' | null = null;
      if (out.front && s.w > 0) {
        // The point itself, then the caption on its stem: above, or failing that below.
        const dot = { x: out.x - 5, y: out.y - 5, w: 10, h: 10 };
        const above = { x: out.x - s.w / 2, y: out.y - STEM - s.h, w: s.w, h: s.h + STEM };
        const below = { x: out.x - s.w / 2, y: out.y, w: s.w, h: s.h + STEM };
        if (inside(dot) && clear(dot, taken)) {
          if (inside(above) && clear(above, taken)) spot = 'above';
          else if (inside(below) && clear(below, taken)) spot = 'below';
          if (spot) taken.push(spot === 'above' ? above : below, dot);
        }
      }
      el.style.transform = `translate3d(${out.x.toFixed(1)}px, ${out.y.toFixed(1)}px, 0)`;
      el.toggleAttribute('data-off', !spot);
      el.toggleAttribute('data-below', spot === 'below');
    }
  }

  const ro = new ResizeObserver(() => {
    caps.forEach((c, i) => {
      if (c) size[i] = { w: c.offsetWidth, h: c.offsetHeight };
    });
    place();
  });

  function track(i: number) {
    return (el: HTMLElement) => {
      els[i] = el;
      return () => {
        if (els[i] === el) els[i] = undefined;
      };
    };
  }
  function measure(i: number) {
    return (el: HTMLElement) => {
      caps[i] = el;
      size[i] = { w: el.offsetWidth, h: el.offsetHeight };
      ro.observe(el);
      return () => {
        ro.unobserve(el);
        if (caps[i] === el) caps[i] = undefined;
      };
    };
  }

  onMount(() => {
    frames.add(place);
    place();
    return () => {
      frames.delete(place);
      ro.disconnect();
    };
  });
</script>

<div class="pins">
  {#each pins as p, i (`${here}:${p.kind}`)}
    <div class="pin" data-kind={p.kind} data-off {@attach track(i)} style="--i:{i}">
      <span class="dot" aria-hidden="true"></span>
      <span class="stem" aria-hidden="true"></span>
      <span class="cap" {@attach measure(i)}>
        <span class="text" class:num={p.kind !== 'wall'}>{p.text}</span>
        <span class="sub">{p.sub}</span>
      </span>
    </div>
  {/each}
</div>

<style>
  .pins {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .pin {
    position: absolute;
    top: 0;
    left: 0;
    width: 0;
    height: 0;
    will-change: transform;
    --tone: var(--ink);
    animation: fade-in 420ms var(--ease-out) both;
    animation-delay: calc(240ms + var(--i) * 90ms);
    transition: opacity 240ms var(--ease-out);
  }
  .pin[data-kind='sun'] {
    --tone: var(--sun);
  }
  .pin[data-kind='wall'] {
    --tone: var(--ok);
  }
  /* Crowded out, off screen or behind you: gone at once, back with a fade, so two never share a spot. */
  .pin[data-off] {
    opacity: 0;
    visibility: hidden;
    transition: none;
  }

  .dot {
    position: absolute;
    left: -4px;
    top: -4px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--surface);
    box-shadow:
      0 0 0 1.5px var(--tone),
      0 0 0 5px rgb(var(--surface-rgb) / 0.45);
  }
  .stem {
    position: absolute;
    left: -0.5px;
    bottom: 5px;
    width: 1px;
    height: calc(16px - 5px);
    background: var(--tone);
    opacity: 0.8;
  }
  .cap {
    position: absolute;
    left: 0;
    bottom: 16px;
    translate: -50% 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 2px 4px;
    white-space: nowrap;
    text-align: center;
    line-height: 1.25;
    /* A paper halo, so a caption reads over glass, floor and shadow alike. */
    text-shadow:
      0 0 2px var(--surface),
      0 0 5px var(--surface),
      0 0 10px rgb(var(--surface-rgb) / 0.9);
  }
  .pin:global([data-below]) .stem {
    bottom: auto;
    top: 5px;
  }
  .pin:global([data-below]) .cap {
    bottom: auto;
    top: 16px;
  }
  .text {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: -0.005em;
  }
  .text.num {
    font-weight: 500;
    font-size: 13.5px;
  }
  .pin[data-kind='sun'] .text {
    color: var(--sun-ink);
  }
  .sub {
    font-size: 11px;
    color: var(--ink-2);
  }
  @media (min-width: 820px) {
    .text {
      font-size: 14px;
    }
    .text.num {
      font-size: 14.5px;
    }
    .sub {
      font-size: 12px;
    }
  }
</style>

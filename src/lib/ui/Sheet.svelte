<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fade } from 'svelte/transition';
  import { ms } from './motion';

  /**
   * The one sheet. Anything that is more than a control and less than a page
   * (sales in the block, what is nearby, a rule in full, sharing) rises from
   * the bottom edge in this, so every such surface moves, closes and reads the
   * same way. It sizes to its content up to most of the screen, then scrolls.
   *
   * Close it by the button, the handle (drag down), the dimmed page, or Escape.
   */
  let {
    open = $bindable(false),
    title,
    label,
    children,
    onclose
  }: {
    open?: boolean;
    /** Shown at the top of the sheet. */
    title?: string;
    /** For screen readers when there is no visible title. */
    label?: string;
    children?: Snippet;
    onclose?: () => void;
  } = $props();

  let sheet = $state<HTMLElement | null>(null);
  let drag = $state(0);
  let dragging = $state(false);
  let from: HTMLElement | null = null;
  let startY = 0;
  let lastY = 0;
  let lastT = 0;
  let speed = 0;

  function close(): void {
    open = false;
    onclose?.();
  }

  // Focus goes into the sheet when it opens and back to where it came from when it closes.
  $effect(() => {
    if (open && sheet) {
      from = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      drag = 0;
      sheet.focus({ preventScroll: true });
      return () => from?.focus({ preventScroll: true });
    }
  });

  function onkey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'Tab' || !sheet) return;
    const stops = [...sheet.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
      (el) => el.offsetParent !== null
    );
    if (!stops.length) return;
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === sheet)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function down(e: PointerEvent): void {
    dragging = true;
    startY = lastY = e.clientY;
    lastT = e.timeStamp;
    speed = 0;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent): void {
    if (!dragging) return;
    const dt = e.timeStamp - lastT;
    if (dt > 0) speed = (e.clientY - lastY) / dt;
    lastY = e.clientY;
    lastT = e.timeStamp;
    drag = Math.max(0, e.clientY - startY);
  }
  function up(): void {
    if (!dragging) return;
    dragging = false;
    // A long pull or a quick flick lets go of it; anything less and it springs back.
    if (drag > 96 || speed > 0.6) close();
    else drag = 0;
  }

  /** Slides the height of the sheet, so a tall one and a short one both leave the screen in the same time. */
  function rise(_node: Element, { duration }: { duration: number }) {
    return { duration, css: (t: number) => `transform: translateY(${(1 - t) * 100}%)`, easing: (t: number) => 1 - Math.pow(1 - t, 4) };
  }
</script>

{#if open}
  <div class="scrim" transition:fade={{ duration: ms(220) }} onclick={close} aria-hidden="true"></div>
  <div class="wrap" data-avoid>
    <div
      class="sheet"
      class:dragging
      bind:this={sheet}
      role="dialog"
      aria-modal="true"
      aria-label={title ?? label}
      tabindex="-1"
      style:--drag="{drag}px"
      transition:rise={{ duration: ms(420) }}
      onkeydown={onkey}
    >
      <div class="grip" onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}>
        <span class="bar" aria-hidden="true"></span>
        {#if title}<h2>{title}</h2>{/if}
        <button class="x" aria-label="Close" onclick={close} onpointerdown={(e) => e.stopPropagation()}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
        </button>
      </div>
      <div class="body">
        {@render children?.()}
      </div>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgb(var(--ink-rgb) / 0.22);
  }
  .wrap {
    position: fixed;
    inset: 0;
    z-index: 41;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    pointer-events: none;
  }
  .sheet {
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    width: min(100%, 560px);
    max-height: min(86dvh, 760px);
    border-radius: 24px 24px 0 0;
    background: var(--surface);
    color: var(--ink);
    box-shadow:
      0 -1px 0 var(--line-soft),
      0 -18px 48px rgb(0 0 0 / 0.16);
    translate: 0 var(--drag);
    transition: translate 420ms var(--spring-snappy);
    outline: none;
  }
  .sheet.dragging {
    transition: none;
  }
  .grip {
    position: relative;
    flex: none;
    display: flex;
    align-items: center;
    min-height: 56px;
    padding: 14px 60px 6px calc(20px + var(--safe-l));
    touch-action: none;
    cursor: grab;
  }
  .bar {
    position: absolute;
    top: 8px;
    left: 50%;
    width: 36px;
    height: 4px;
    margin-left: -18px;
    border-radius: 2px;
    background: var(--ink-3);
  }
  h2 {
    margin: 0;
    font-family: var(--font-mark);
    font-weight: 600;
    font-size: 26px;
    line-height: 1.1;
    letter-spacing: 0.01em;
    text-transform: uppercase;
  }
  .x {
    position: absolute;
    top: 8px;
    right: calc(10px + var(--safe-r));
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    color: var(--ink-2);
  }
  .x:hover {
    background: rgb(var(--ink-rgb) / 0.08);
    color: var(--ink);
  }
  .body {
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 6px calc(20px + var(--safe-r)) calc(20px + var(--safe-b)) calc(20px + var(--safe-l));
  }
  @media (min-width: 820px) {
    .wrap {
      align-items: center;
    }
    .sheet {
      border-radius: 24px;
      max-height: min(80dvh, 760px);
    }
    .bar {
      display: none;
    }
    .body {
      padding-bottom: 24px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .sheet {
      transition: none;
    }
  }
</style>

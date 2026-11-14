<script lang="ts">
  import { sqmText, typeWords } from './place';
  import type { Session } from './session.svelte';

  /**
   * Which flat: the types this block has, with their usual size here, and
   * how honest the stand-in is. A layout drawn for this type and size is
   * "Typical layout"; anything less is "Closest typical layout", with the
   * reason a tap away. Mirror flips the flat, as its twin across the party
   * wall is built.
   */
  let { session }: { session: Session } = $props();

  const options = $derived(session.options);
  const candidate = $derived(session.candidate);
  const good = $derived(candidate?.fit === 'good');
  let why = $state(false);
  let chips = $state<HTMLElement>();

  // A new choice closes the reason, which may not be the same reason any more, and keeps the chosen chip in view.
  $effect(() => {
    const t = session.option?.flatType;
    why = false;
    chips?.querySelector<HTMLElement>(`[data-type="${t}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });

  function chosen(flatType: string): boolean {
    return session.option?.flatType === flatType;
  }

  // One tab stop for the group; arrows move the choice, as in any radio group.
  function key(e: KeyboardEvent): void {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step || !options.length) return;
    e.preventDefault();
    e.stopPropagation();
    const i = Math.max(0, options.findIndex((o) => chosen(o.flatType)));
    const next = (i + step + options.length) % options.length;
    session.chooseFlat(options[next]);
    chips?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
  }
</script>

<div class="chooser">
  <div class="chips" role="radiogroup" aria-label="Flat type" bind:this={chips} tabindex="-1" onkeydown={key}>
    {#each options as o, i (o.flatType)}
      {@const on = chosen(o.flatType)}
      <button role="radio" aria-checked={on} tabindex={on ? 0 : -1} class:on data-type={o.flatType} style="--i:{i}" onclick={() => session.chooseFlat(o)}>
        <span class="type">{typeWords(o.flatType)}</span>
        {#if o.areaSqm}<span class="area num">{sqmText(o.areaSqm)}</span>{/if}
      </button>
    {/each}
  </div>

  <div class="row">
    <p class="fit">
      {#if good}
        <strong>Typical layout</strong> for this flat type, not this block's own floor plan.
      {:else if candidate}
        <button class="why" aria-expanded={why} onclick={() => (why = !why)}>
          <strong>Closest typical layout</strong>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5.6" /><path d="M7 6.3v3.4M7 4.3v.2" /></svg>
        </button>, not this block's own floor plan.
      {/if}
    </p>
    <button class="mirror" aria-pressed={session.mirrored} class:on={session.mirrored} onclick={() => session.setMirrored(!session.mirrored)}>
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <path class="l" d="M8.2 4H3.5v12h4.7v-4.6" />
        <path class="r" d="M11.8 4h4.7v12h-4.7v-4.6" />
        <path class="axis" d="M10 2.5v15" />
      </svg>
      Mirror
    </button>
  </div>
  {#if why && candidate && !good}
    <p class="reason">{candidate.reason}</p>
  {/if}
</div>

<style>
  .chooser {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  /* The types run in one line and scroll sideways if a block has many. */
  .chips {
    display: flex;
    gap: 5px;
    overflow-x: auto;
    scrollbar-width: none;
    margin: 0 -2px;
    padding: 2px 14px 2px 2px;
    outline: none;
    /* A row that runs past the edge fades there, so a type half in view reads as "more this way". */
    mask-image: linear-gradient(to right, #000 calc(100% - 22px), transparent);
    -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 22px), transparent);
  }
  .chips::-webkit-scrollbar {
    display: none;
  }
  .chips button {
    flex: none;
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    height: 44px;
    padding: 0 13px;
    border-radius: 999px;
    box-shadow: inset 0 0 0 1px var(--line);
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.005em;
    line-height: 44px;
    animation: rise-in 420ms var(--ease-out) both;
    animation-delay: calc(120ms + var(--i) * 40ms);
    transition:
      background-color 220ms,
      color 220ms,
      box-shadow 220ms,
      transform 160ms var(--ease-out);
  }
  .chips button:active {
    transform: scale(0.96);
  }
  .chips .area {
    font-size: 12px;
    font-weight: 400;
    color: var(--ink-2);
    transition: color 220ms;
  }
  .chips button.on {
    background: var(--ink);
    color: var(--surface);
    box-shadow: none;
  }
  .chips button.on .area {
    color: rgb(var(--surface-rgb) / 0.72);
  }
  @media (hover: hover) {
    .chips button:not(.on):hover {
      background: rgb(var(--ink-rgb) / 0.05);
    }
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .fit {
    min-width: 0;
    font-size: 12.5px;
    line-height: 1.35;
    color: var(--ink-2);
    text-wrap: pretty;
  }
  .fit strong {
    font-weight: 600;
    color: var(--ink);
  }
  .why {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    /* A tall target round a line of text, without moving the text. */
    padding: 12px 0;
    margin: -12px 0;
    text-decoration: underline;
    text-decoration-color: var(--line);
    text-underline-offset: 3px;
  }
  .why svg {
    flex: none;
    color: var(--ink-2);
  }
  .why circle,
  .why path {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
  }
  .reason {
    font-size: 12.5px;
    line-height: 1.4;
    color: var(--ink);
    text-wrap: pretty;
    animation: rise-in 300ms var(--ease-out) both;
  }

  .mirror {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 44px;
    padding: 0 14px 0 10px;
    border-radius: 999px;
    font-size: 13.5px;
    font-weight: 600;
    color: var(--ink-2);
    box-shadow: inset 0 0 0 1px var(--line);
    transition:
      color 200ms,
      background-color 200ms,
      transform 160ms var(--ease-out);
  }
  .mirror:active {
    transform: scale(0.96);
  }
  .mirror.on {
    color: var(--ink);
    background: rgb(var(--ink-rgb) / 0.08);
  }
  .mirror path {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linejoin: round;
    transition: transform 420ms var(--spring-snappy);
    transform-origin: 10px 10px;
  }
  .mirror .axis {
    stroke-dasharray: 1.5 2;
    stroke-width: 1;
  }
  .mirror .l {
    stroke: var(--ink);
  }
  .mirror.on .l {
    transform: scaleX(-1);
  }
  .mirror.on .r {
    transform: scaleX(-1);
  }
</style>

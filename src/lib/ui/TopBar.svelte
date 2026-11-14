<script lang="ts">
  import { roadName, storeyTag, typeWords } from './place';
  import type { Session } from './session.svelte';

  /**
   * Which flat this is, in the words of its address: "Blk 440A · #25 ·
   * 4-room · 87 m²", with the layout standing in for it named underneath.
   * The typical flat keeps its own title. The way back to the block sits
   * first, where a thumb or a reader starts.
   */
  let { session, onback }: { session: Session; onback: (() => void) | null } = $props();

  const hit = $derived(session.place?.hit ?? null);
  const plan = $derived(session.plan);
  const option = $derived(session.option);
  /** The flat's own area from the block's records, when they give one. */
  const area = $derived(option?.areaSqm ?? null);
  const fit = $derived(session.candidate && session.candidate.fit !== 'good' ? 'Closest typical layout' : 'Typical layout');
  // Said only when the stand-in is noticeably bigger or smaller than the real flat.
  const differs = $derived(area !== null && Math.abs(area - plan.areaSqm) >= 3);
</script>

<!-- data-avoid: room labels keep clear of it. -->
<header class="bar" class:back={!!onback} data-avoid>
  {#if onback}
    <button class="out glass" onclick={onback} aria-label="Back to block">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M11 4 6 9l5 5" /></svg>
      <span class="word">Back to block</span>
    </button>
  {/if}
  {#if hit}
    <span class="mark" aria-label="Block {hit.blk}">Blk {hit.blk}</span>
  {:else}
    <span class="mark">BLK</span>
  {/if}
  <span class="rule" aria-hidden="true"></span>
  <p class="what">
    {#if hit && option}
      <span class="title"
        ><span class="num">{storeyTag(session.storey)}</span> · {typeWords(option.flatType)}{#if area}{' · '}<span class="num">{area} m²</span>{/if}</span
      >
      <span class="sub" title="Typical layout for this flat type, not this block's own floor plan."
        >{fit}{#if differs}&nbsp;of <span class="num">{plan.areaSqm} m²</span>{/if} · {roadName(hit.road)}</span
      >
    {:else}
      <span class="title">{plan.title} · <span class="num">{plan.areaSqm} m²</span></span>
      <span class="sub">{plan.subtitle}</span>
    {/if}
  </p>
  <!-- A standing disclosure. It stays on screen in every state. -->
  <p class="model">Computer-generated model, not a photograph</p>
</header>

<style>
  .bar {
    position: absolute;
    top: calc(var(--gutter) + var(--safe-t));
    left: calc(var(--gutter) + 4px + var(--safe-l));
    right: calc(var(--gutter) + 4px + var(--safe-r));
    display: grid;
    grid-template-columns: auto auto 1fr;
    align-items: center;
    column-gap: 12px;
    row-gap: 6px;
    pointer-events: none;
    animation: fade-in 600ms var(--ease-out) both;
    /* The model can be turned and zoomed under the bar; a paper halo keeps the words readable over it. */
    text-shadow:
      0 0 2px var(--surface),
      0 0 6px var(--surface),
      0 0 12px rgb(var(--surface-rgb) / 0.8);
  }
  .bar.back {
    left: calc(var(--gutter) + var(--safe-l));
    grid-template-columns: auto auto auto 1fr;
    column-gap: 10px;
  }
  .out {
    pointer-events: auto;
    display: inline-grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 999px;
    text-shadow: none;
    transition: transform 180ms var(--ease-out);
  }
  .out:active {
    transform: scale(0.94);
  }
  .out path {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .word {
    display: none;
  }
  .mark {
    font: 700 30px/0.8 var(--font-mark);
    letter-spacing: 0.005em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .rule {
    width: 1px;
    height: 24px;
    background: var(--line);
  }
  .what {
    display: flex;
    flex-direction: column;
    line-height: 1.2;
    min-width: 0;
  }
  .title {
    font-weight: 600;
    font-size: 14px;
    letter-spacing: -0.005em;
    white-space: nowrap;
  }
  .title .num {
    font-weight: 500;
    font-size: 13px;
  }
  .sub {
    font-size: 12px;
    color: var(--ink-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub .num {
    font-size: 11.5px;
  }
  .model {
    grid-column: 1 / -1;
    font-size: 11px;
    letter-spacing: 0.01em;
    color: var(--ink-2);
  }
  .back .model {
    padding-left: 4px;
  }

  @media (min-width: 820px) {
    .bar {
      grid-template-columns: auto auto auto 1fr;
    }
    .bar.back {
      grid-template-columns: auto auto auto auto 1fr;
      column-gap: 14px;
    }
    .out {
      display: inline-flex;
      gap: 6px;
      width: auto;
      padding: 0 16px 0 11px;
      font-weight: 600;
      font-size: 14px;
      letter-spacing: -0.005em;
    }
    .word {
      display: inline;
    }
    .mark {
      font-size: 34px;
    }
    .model {
      grid-column: auto;
      justify-self: end;
      font-size: 12px;
    }
    .back .model {
      padding-left: 0;
    }
  }
</style>

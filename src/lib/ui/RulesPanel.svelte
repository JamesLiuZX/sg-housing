<script lang="ts">
  import type { Wall } from '../plan/types';
  import { CAVEAT, LEGEND, verdictFor, wallLength, wallPlace } from '../sg/rules';
  import type { Session } from './session.svelte';

  /**
   * The Rules lens: the colour key, and when a wall is chosen, what HDB says
   * about it. Choosing and clearing both go through the engine, so the
   * highlight on the model and this sheet can never disagree.
   */
  let {
    session,
    onselect,
    onclear
  }: { session: Session; onselect: (wall: Wall) => void; onclear: () => void } = $props();

  /** Every wall that has a verdict, in plan order, for stepping through without aiming at thin partitions. */
  // svelte-ignore state_referenced_locally
  const walls = session.plan.walls.filter((w) => verdictFor(w));

  const wall = $derived(session.wall);
  const verdict = $derived(wall ? verdictFor(wall) : null);
  const place = $derived(wall ? wallPlace(session.plan, wall) : '');

  function step(by: number): void {
    const i = wall ? walls.findIndex((w) => w.id === wall.id) : by > 0 ? -1 : 0;
    onselect(walls[(i + by + walls.length) % walls.length]);
  }

  // The sheet eases to the height of its content rather than jumping from wall to wall.
  let inner = $state(0);

  function onkey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && wall) onclear();
  }
</script>

<svelte:window onkeydown={onkey} />

<section class="rules glass" aria-label="What HDB allows">
  <div class="body" style:height={inner ? `${inner}px` : null}>
    <div class="inner" bind:clientHeight={inner}>
      {#if wall && verdict}
        {#key wall.id}
          <article class="verdict" aria-live="polite">
            <header>
              <h2>{verdict.title}</h2>
              <div class="tools">
                <button class="icon" onclick={() => step(-1)} aria-label="Previous wall">
                  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M11 4 6 9l5 5" /></svg>
                </button>
                <button class="icon" onclick={() => step(1)} aria-label="Next wall">
                  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="m7 4 5 5-5 5" /></svg>
                </button>
                <button class="icon" onclick={onclear} aria-label="Close">
                  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="m4.5 4.5 9 9m0-9-9 9" /></svg>
                </button>
              </div>
            </header>
            <p class="where">{place ? `${place} · ` : ''}<span class="num">{wallLength(wall)}</span></p>

            <p class="chip" data-tone={verdict.tone}>
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                {#if verdict.tone === 'yes'}
                  <path d="m3 7.3 2.6 2.6L11 4.4" />
                {:else if verdict.tone === 'wet'}
                  <path d="M7 3.2v4.6M7 10.4v.4" />
                {:else}
                  <path d="m3.8 3.8 6.4 6.4m0-6.4-6.4 6.4" />
                {/if}
              </svg>
              {verdict.chip}
            </p>
            <p class="why">{verdict.why}</p>
            <p class="caveat">{CAVEAT}</p>
            <ul class="sources">
              {#each verdict.sources as s (s.url)}
                <li>
                  <a href={s.url} target="_blank" rel="noopener">
                    {s.label}
                    <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true"><path d="M3.5 2.5h5v5M8.5 2.5l-6 6" /></svg>
                    <span class="visually-hidden">(opens in a new tab)</span>
                  </a>
                </li>
              {/each}
            </ul>
          </article>
        {/key}
      {:else}
        <div class="prompt">
          <p>Tap a wall to see what HDB allows.</p>
          <button class="icon" onclick={() => step(1)} aria-label="Show the walls one by one" title="Step through the walls">
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="m7 4 5 5-5 5" /></svg>
          </button>
        </div>
      {/if}
    </div>
  </div>

  <ul class="legend" aria-label="Wall colours">
    {#each LEGEND as k (k.tone)}
      <li><span class="key" data-tone={k.tone} aria-hidden="true"></span>{k.label}</li>
    {/each}
  </ul>
</section>

<style>
  .rules {
    width: 100%;
    border-radius: 22px;
    padding: 0 14px;
    /* Each tone appears in three places here: chip, key and model. One definition. */
    --t-no: var(--no);
    --t-shelter: var(--shelter);
    --t-yes: var(--ok);
    --t-wet: var(--amber);
  }
  [data-tone='no'] {
    --tone: var(--t-no);
    --tone-deep: #c0392f;
  }
  [data-tone='shelter'] {
    --tone: var(--t-shelter);
    --tone-deep: #9c2a2a;
  }
  [data-tone='yes'] {
    --tone: var(--t-yes);
    --tone-deep: #1f7a50;
  }
  [data-tone='wet'] {
    --tone: var(--t-wet);
    --tone-deep: #d99a1e;
  }

  .body {
    overflow: hidden;
    transition: height 420ms var(--ease-out);
  }
  .inner {
    padding: 10px 0 8px;
  }

  /* ── Nothing chosen ── */
  .prompt {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: -6px -6px -4px 0;
  }
  .prompt p {
    font-size: 14px;
    font-weight: 500;
    letter-spacing: -0.005em;
  }

  /* ── A wall ── */
  .verdict {
    animation: rise-in 380ms var(--ease-out) both;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    height: 34px;
  }
  h2 {
    font-size: 16px;
    font-weight: 600;
    letter-spacing: -0.012em;
    line-height: 1.2;
  }
  .where {
    font-size: 12.5px;
    color: var(--ink-2);
  }
  .where .num {
    font-size: 12px;
  }
  .tools {
    display: flex;
    flex: none;
    margin-right: -10px;
  }
  .icon {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: var(--ink-2);
    transition:
      background-color 180ms,
      color 180ms,
      transform 160ms var(--ease-out);
  }
  .icon:active {
    transform: scale(0.9);
  }
  @media (hover: hover) {
    .icon:hover {
      color: var(--ink);
      background: rgb(var(--ink-rgb) / 0.06);
    }
  }
  .icon path {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* The answer, set like a stamp. White on the deep tones; ink on amber, which is too light for white. */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 9px;
    padding: 6px 12px 6px 9px;
    border-radius: 999px;
    background: var(--tone-deep);
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: -0.005em;
    line-height: 1.15;
    animation: stamp 520ms var(--spring) 90ms both;
  }
  .chip[data-tone='wet'] {
    color: #1e1f22;
  }
  .chip svg {
    flex: none;
  }
  .chip path {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.9;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  @keyframes stamp {
    from {
      opacity: 0;
      transform: scale(1.18) rotate(-3deg);
    }
    40% {
      opacity: 1;
    }
  }

  .why {
    margin-top: 8px;
    font-size: 13.5px;
    line-height: 1.38;
    text-wrap: pretty;
  }
  .caveat {
    margin-top: 6px;
    font-size: 12px;
    line-height: 1.35;
    color: var(--ink-2);
  }
  .sources {
    display: flex;
    flex-wrap: wrap;
    column-gap: 18px;
  }
  .sources a {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 34px;
    font-size: 12.5px;
    font-weight: 500;
    text-decoration: underline;
    text-decoration-color: var(--line);
    text-underline-offset: 3px;
    transition: text-decoration-color 180ms;
  }
  @media (hover: hover) {
    .sources a:hover {
      text-decoration-color: currentColor;
    }
  }
  .sources path {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* ── The key ── */
  .legend {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 5px 12px;
    padding: 9px 0 11px;
    border-top: 0.5px solid var(--line-soft);
    font-size: 12px;
    color: var(--ink-2);
  }
  .legend li {
    display: flex;
    align-items: center;
    gap: 8px;
    white-space: nowrap;
  }
  /* Drawn like a wall in plan: a short thick bar. */
  .key {
    flex: none;
    width: 14px;
    height: 5px;
    border-radius: 1.5px;
    background: var(--tone);
    /* A hairline edge, so the deep shelter red still reads on night glass. */
    box-shadow: 0 0 0 0.5px var(--line);
  }

  @media (min-width: 820px) {
    .rules {
      border-radius: 24px;
      padding: 0 18px;
    }
    .legend {
      display: flex;
      justify-content: space-between;
      gap: 14px;
    }
  }
</style>

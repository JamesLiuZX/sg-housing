<script lang="ts">
  import { searchAddress, type AddressHit } from '../data';
  import { roadName, searchTrouble } from './place';

  /**
   * The way in: one field for a block or a postal code, and what OneMap finds
   * as you type. What is typed goes to OneMap and nowhere else, and is not
   * kept. Every answer gets its own plain sentence: nothing yet, searching,
   * no HDB block, or OneMap not answering, which names OneMap and points to
   * the bundled block that works without it.
   *
   * A combobox: arrows move through the blocks, Enter takes one, Escape
   * clears. On a phone the list opens upward, clear of the keyboard.
   */
  let {
    finding,
    trouble,
    up = false,
    seeking = $bindable(false),
    onpick
  }: {
    /** The block being looked up after a pick, if any. */
    finding: string | null;
    /** What stopped the last pick, if anything. */
    trouble: string | null;
    /** Open the list above the field. */
    up?: boolean;
    seeking?: boolean;
    onpick: (hit: AddressHit) => void;
  } = $props();

  const uid = $props.id();
  /** The most places worth listing; more than this, and the query wants a street. */
  const MAX = 6;

  type Answer =
    | { kind: 'idle' }
    | { kind: 'hits'; hits: AddressHit[]; more: boolean }
    /** OneMap answered and nothing was a block. `places`: it matched roads or landmarks. */
    | { kind: 'none'; query: string; places: boolean }
    | { kind: 'down'; why: string };

  let query = $state('');
  let answer = $state.raw<Answer>({ kind: 'idle' });
  let busy = $state(false);
  let active = $state(-1);
  let focused = $state(false);
  let input = $state<HTMLInputElement>();

  let timer: ReturnType<typeof setTimeout> | undefined;
  let ctl: AbortController | null = null;
  /** Enter pressed before the answer came: take the first block when it does. */
  let takeFirst = false;

  const hits = $derived(answer.kind === 'hits' ? answer.hits : []);
  const open = $derived(focused && hits.length > 0 && !finding);

  $effect(() => {
    seeking = focused || query.trim() !== '' || !!finding;
  });

  function changed(): void {
    clearTimeout(timer);
    ctl?.abort();
    active = -1;
    takeFirst = false;
    const q = query.trim();
    if (!q) {
      busy = false;
      answer = { kind: 'idle' };
      return;
    }
    busy = true;
    timer = setTimeout(() => void run(q), 250);
  }

  async function run(q: string): Promise<void> {
    clearTimeout(timer);
    const c = (ctl = new AbortController());
    busy = true;
    const r = await searchAddress(q, { signal: c.signal });
    if (c.signal.aborted || r.status === 'aborted') return;
    busy = false;
    if (r.status === 'ok') {
      // Roads and landmarks have no block number: nothing for HDB to know about.
      const blocks = r.data.hits.filter((h) => h.blk !== '' && h.road !== '');
      answer = blocks.length
        ? { kind: 'hits', hits: blocks.slice(0, MAX), more: blocks.length > MAX || r.data.total > r.data.hits.length }
        : { kind: 'none', query: q, places: true };
    } else if (r.status === 'not-found') {
      answer = { kind: 'none', query: q, places: false };
    } else if (r.status === 'unavailable') {
      answer = { kind: 'down', why: searchTrouble(r) };
    } else {
      answer = { kind: 'idle' };
    }
    if (takeFirst && answer.kind === 'hits') take(answer.hits[0]);
    takeFirst = false;
  }

  function take(hit: AddressHit): void {
    query = `${hit.blk} ${roadName(hit.road)}`;
    active = -1;
    input?.blur();
    onpick(hit);
  }

  function key(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!hits.length) return;
      e.preventDefault();
      const n = hits.length;
      // On a list that opens upward, up moves away from the field just as down does on one below.
      const away = (e.key === 'ArrowDown') !== up;
      active = active < 0 ? (away ? 0 : n - 1) : (active + (away ? 1 : -1) + n) % n;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (hits[active]) take(hits[active]);
      else if (busy) {
        takeFirst = true;
        if (query.trim()) void run(query.trim());
      } else if (hits.length) take(hits[0]);
    } else if (e.key === 'Escape') {
      if (query) {
        query = '';
        changed();
      } else input?.blur();
    }
  }

  function clear(): void {
    query = '';
    changed();
    input?.focus();
  }

  /** The one sentence under the field, if there is one to say. */
  const note = $derived.by((): { text: string; tone: 'quiet' | 'warn' } | null => {
    if (finding) return { text: `Finding ${finding}`, tone: 'quiet' };
    if (trouble && !query.trim()) return { text: trouble, tone: 'warn' };
    if (busy && !hits.length) return { text: 'Searching OneMap', tone: 'quiet' };
    if (busy) return null;
    if (answer.kind === 'none') {
      return answer.places
        ? { text: 'That is a road or a place, not a block. Add the block number, like 440A Clementi Ave 3.', tone: 'warn' }
        : { text: `No HDB block found for “${answer.query}”. Try a block and street, or a six-digit postal code.`, tone: 'warn' };
    }
    if (answer.kind === 'down') return { text: `${answer.why} The block below works without it.`, tone: 'warn' };
    if (trouble) return { text: trouble, tone: 'warn' };
    return null;
  });
</script>

<div class="search" class:up class:open>
  <div class="field glass" class:busy={busy || !!finding}>
    <svg class="glyph" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="7.8" cy="7.8" r="5.3" />
      <path d="m11.8 11.8 4 4" />
    </svg>
    <input
      bind:this={input}
      bind:value={query}
      oninput={changed}
      onkeydown={key}
      onfocus={() => (focused = true)}
      onblur={() => (focused = false)}
      type="search"
      inputmode="search"
      enterkeyhint="search"
      autocomplete="off"
      autocapitalize="characters"
      spellcheck="false"
      placeholder="Type a block or postal code"
      aria-label="Block or postal code, for example 440A Clementi Ave 3"
      role="combobox"
      aria-expanded={open}
      aria-controls="{uid}-list"
      aria-autocomplete="list"
      aria-activedescendant={open && active >= 0 ? `${uid}-${active}` : undefined}
      aria-describedby="{uid}-note"
    />
    {#if query}
      <button class="clear" onclick={clear} aria-label="Clear">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" /></svg>
      </button>
    {/if}
    <span class="progress" aria-hidden="true"></span>
  </div>

  <ul class="list glass" id="{uid}-list" role="listbox" aria-label="Blocks" hidden={!open} class:stale={busy}>
    {#each hits as hit, i (hit.postal + hit.blk + hit.road)}
      <!-- Pointer down would take focus from the field and close the list before the click lands.
           Keys reach these options through the field, as in any combobox. -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <li
        id="{uid}-{i}"
        role="option"
        aria-selected={i === active}
        class:on={i === active}
        style="--i:{i}"
        onpointerdown={(e) => e.preventDefault()}
        onclick={() => take(hit)}
        onpointermove={() => (active = i)}
      >
        <span class="blk">Blk {hit.blk}</span>
        <span class="road">{roadName(hit.road)}</span>
        {#if hit.postal}<span class="postal num">{hit.postal}</span>{/if}
      </li>
    {/each}
    {#if answer.kind === 'hits' && answer.more}
      <li class="more" role="presentation">More places match. Add the street to narrow it down.</li>
    {/if}
  </ul>

  <p class="note" class:empty={!note} id="{uid}-note" aria-live="polite" data-tone={note?.tone}>
    {#if note}
      {#key note.text}<span class="say">{note.text}</span>{/key}
    {/if}
  </p>
</div>

<style>
  .search {
    position: relative;
    width: 100%;
    max-width: 460px;
  }

  /* ── The field ── */
  .field {
    position: relative;
    display: flex;
    align-items: center;
    height: 54px;
    padding: 0 6px 0 18px;
    border-radius: 999px;
    overflow: hidden;
    transition:
      box-shadow 240ms var(--ease-out),
      border-color 240ms;
  }
  .field:focus-within {
    border-color: rgb(var(--ink-rgb) / 0.42);
    box-shadow:
      0 0 0 4px rgb(var(--ink-rgb) / 0.06),
      0 14px 34px -20px rgb(0 0 0 / var(--shade));
  }
  .glyph {
    flex: none;
    margin-right: 10px;
    color: var(--ink-2);
  }
  .glyph circle,
  .glyph path,
  .clear path {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
  }
  input {
    flex: 1;
    min-width: 0;
    height: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    outline: none;
    color: var(--ink);
    font: 500 16px/1 var(--font-ui);
    letter-spacing: -0.005em;
    /* Typing is the one place the page lets text be selected. */
    user-select: text;
    -webkit-user-select: text;
  }
  input::placeholder {
    color: var(--ink-2);
    font-weight: 400;
  }
  input::-webkit-search-cancel-button,
  input::-webkit-search-decoration {
    -webkit-appearance: none;
    appearance: none;
  }
  .clear {
    flex: none;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: var(--ink-2);
    animation: fade-in 160ms var(--ease-out) both;
  }
  @media (hover: hover) {
    .clear:hover {
      color: var(--ink);
      background: rgb(var(--ink-rgb) / 0.06);
    }
  }

  /* A thin line runs along the bottom of the field while OneMap or the block index is being asked. */
  .progress {
    position: absolute;
    left: 22px;
    right: 22px;
    bottom: 0;
    height: 1.5px;
    overflow: hidden;
    opacity: 0;
    transition: opacity 200ms;
  }
  .progress::after {
    content: '';
    position: absolute;
    inset: 0;
    width: 36%;
    border-radius: 2px;
    background: var(--ink-2);
    animation: run 1100ms var(--ease-move) infinite;
  }
  .busy .progress {
    opacity: 1;
  }
  @keyframes run {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(280%);
    }
  }

  /* ── The blocks ── */
  .list {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(100% + 8px);
    z-index: 2;
    max-height: min(340px, 46vh);
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 6px;
    border-radius: 22px;
    animation: list-in 300ms var(--ease-out) both;
    transition: opacity 200ms;
  }
  .list[hidden] {
    display: none;
  }
  .up .list {
    top: auto;
    bottom: calc(100% + 8px);
    display: flex;
    flex-direction: column-reverse;
  }
  .up .list[hidden] {
    display: none;
  }
  .list.stale {
    opacity: 0.6;
  }
  @keyframes list-in {
    from {
      opacity: 0;
      transform: translateY(-6px) scale(0.985);
    }
  }
  .up .list {
    transform-origin: 50% 100%;
  }
  li[role='option'] {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: baseline;
    column-gap: 10px;
    min-height: 52px;
    padding: 14px 14px 12px;
    border-radius: 16px;
    cursor: pointer;
    animation: rise-in 360ms var(--ease-out) both;
    animation-delay: calc(var(--i) * 32ms);
    transition: background-color 140ms;
  }
  li.on {
    background: rgb(var(--ink-rgb) / 0.07);
  }
  .blk {
    font: 700 22px/0.9 var(--font-mark);
    letter-spacing: 0.005em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .road {
    min-width: 0;
    font-size: 14.5px;
    font-weight: 500;
    letter-spacing: -0.005em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .postal {
    font-size: 12px;
    color: var(--ink-2);
  }
  .more {
    padding: 10px 14px 8px;
    font-size: 12px;
    color: var(--ink-2);
  }

  /* ── What happened ── */
  .note {
    min-height: 0;
    margin-top: 8px;
    padding: 0 18px;
    font-size: 13px;
    line-height: 1.38;
    color: var(--ink-2);
    text-wrap: pretty;
  }
  .note.empty {
    margin: 0;
  }
  .note[data-tone='warn'] {
    color: var(--ink);
  }
  .say {
    display: block;
    animation: fade-in 260ms var(--ease-out) both;
  }
</style>

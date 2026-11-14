<script lang="ts">
  import { clock } from '../sg/solar';
  import type { Session } from './session.svelte';
  import SunArc from './SunArc.svelte';

  /** The compact sun: the time, the day's arc to drag along, and play. For walking and for the block, where the full sheet would cover the view. */
  let { session }: { session: Session } = $props();
</script>

<div class="pill glass">
  <p class="time num">{clock(session.minutes)}</p>
  <div class="track"><SunArc {session} compact /></div>
  <button class="play" class:on={session.playing} onclick={() => session.togglePlay()} aria-label={session.playing ? 'Pause' : 'Play the day'}>
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
      <path class="i-play" d="M7.2 5.1v9.8a.6.6 0 0 0 .9.5l7.6-4.9a.6.6 0 0 0 0-1L8.1 4.6a.6.6 0 0 0-.9.5Z" />
      <path class="i-pause" d="M6.4 5h2.4v10H6.4zM11.2 5h2.4v10h-2.4z" />
    </svg>
  </button>
</div>

<style>
  .pill {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 6px 6px 6px 16px;
    border-radius: 999px;
  }
  .time {
    min-width: 8ch;
    font-size: 16px;
    font-weight: 500;
    letter-spacing: -0.02em;
  }
  .track {
    min-width: 0;
  }
  .play {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    box-shadow: inset 0 0 0 1px var(--line);
    transition:
      background-color 220ms,
      color 220ms,
      transform 200ms var(--ease-out);
  }
  .play:active {
    transform: scale(0.92);
  }
  .play.on {
    background: var(--ink);
    color: var(--surface);
    box-shadow: none;
  }
  .play path {
    fill: currentColor;
    transform-origin: 10px 10px;
    transition:
      opacity 180ms,
      transform 320ms var(--spring-snappy);
  }
  .i-pause,
  .on .i-play {
    opacity: 0;
    transform: scale(0.5);
  }
  .on .i-pause {
    opacity: 1;
    transform: none;
  }
</style>

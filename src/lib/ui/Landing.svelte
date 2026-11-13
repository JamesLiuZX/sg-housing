<script lang="ts">
  /**
   * The poster. The flat is already on screen behind it as a line drawing;
   * this says what it is in as few words as possible and gets out of the way.
   */
  let {
    leaving,
    wide,
    height = $bindable(0),
    onstart
  }: { leaving: boolean; wide: boolean; height?: number; onstart: () => void } = $props();
</script>

<section class="poster" class:leaving class:wide bind:clientHeight={height} aria-label="Blk">
  <p class="tag num" style="--i:0">TYPICAL 4-ROOM · 93 m²</p>
  <h1 class="mark" style="--i:1" aria-label="Blk">BLK</h1>
  <p class="line" style="--i:2">A showflat for every flat.</p>
  <p class="say" style="--i:3">Walk any HDB flat at true scale. See the real sun. Know which walls can go.</p>
  <div class="go" style="--i:4">
    <button class="btn btn-primary" onclick={onstart} disabled={leaving}>
      Walk the 4-room
      <svg class="nudge" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <path d="M3 9h12M10 4l5 5-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
  </div>
  <p class="foot" style="--i:5">Typical 4-room BTO layout, about 93 m². Computer-generated model.</p>
</section>

<style>
  .poster {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 56px calc(var(--gutter) + 12px + var(--safe-r)) calc(22px + var(--safe-b)) calc(var(--gutter) + 12px + var(--safe-l));
    /* The drawing fades into the paper under the words, so lines never run through type. */
    background: linear-gradient(to bottom, transparent, var(--sky-1, #f1ede5) 34%);
    pointer-events: none;
  }
  .poster > * {
    pointer-events: auto;
    animation: rise-in 700ms var(--ease-out) both;
    animation-delay: calc(240ms + var(--i) * 70ms);
    transition:
      opacity 320ms var(--ease-in),
      transform 420ms var(--ease-in);
    transition-delay: calc((5 - var(--i)) * 34ms);
  }
  .poster.leaving > * {
    opacity: 0;
    transform: translateY(-18px);
  }

  .tag {
    font-size: 11px;
    letter-spacing: 0.08em;
    color: var(--ink-2);
    margin-bottom: 2px;
  }
  .mark {
    font: 700 clamp(112px, 34vw, 168px) / 0.8 var(--font-mark);
    letter-spacing: -0.01em;
    margin: 0 0 0 -0.045em;
    /* Painted on, like the number on the side of a block. */
    color: var(--ink);
  }
  .line {
    font: 600 22px/1.2 var(--font-ui);
    letter-spacing: -0.015em;
    margin-top: 14px;
  }
  .say {
    max-width: 30ch;
    margin-top: 8px;
    color: var(--ink-2);
    font-size: 15px;
    line-height: 1.45;
  }
  .go {
    margin-top: 20px;
  }
  .go .btn {
    height: 54px;
    padding: 0 26px;
    font-size: 16px;
  }
  .foot {
    margin-top: 16px;
    font-size: 12px;
    color: var(--ink-2);
  }

  .poster.wide {
    top: 0;
    right: auto;
    width: min(640px, 44vw);
    min-width: 400px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 0 0 0 calc(var(--gutter) + 40px);
    background: none;
  }
  .wide .mark {
    font-size: clamp(170px, 17vw, 260px);
  }
  .wide .line {
    font-size: 30px;
    margin-top: 22px;
  }
  .wide .say {
    font-size: 17px;
    margin-top: 12px;
    max-width: 34ch;
  }
  .wide .go {
    margin-top: 30px;
  }
  .wide .foot {
    margin-top: 22px;
    font-size: 12.5px;
  }
</style>

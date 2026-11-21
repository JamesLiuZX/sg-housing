<script lang="ts">
  import { fade } from 'svelte/transition';
  import { ms } from './motion';
  import logo from './onemap-logo.png';

  /**
   * OneMap's attribution, wherever its map is on screen. OneMap's developer
   * page for its base maps (https://www.onemap.gov.sg/docs/maps/) says that,
   * under its Terms of Use, anyone using them must include the OneMap logo
   * and this attribution: the logo, "OneMap" linked to onemap.gov.sg,
   * "© contributors", and "Singapore Land Authority" linked to sla.gov.sg.
   * The logo is OneMap's own file, unaltered, at the 20 px it asks for; it
   * comes with the app, so the credit shows with the bundled map offline.
   *
   * `shown` follows the engine's `map` hook: the credit comes and goes with
   * the map itself.
   */
  let { shown }: { shown: boolean } = $props();
</script>

{#if shown}
  <p class="credit" transition:fade={{ duration: ms(240) }}>
    <!-- The name follows at once, so the logo says nothing more to a screen reader. -->
    <img src={logo} width="20" height="20" alt="" />
    <span
      ><a href="https://www.onemap.gov.sg/" target="_blank" rel="noopener noreferrer">OneMap</a>&nbsp;©&nbsp;contributors&nbsp;| <a
        href="https://www.sla.gov.sg/"
        target="_blank"
        rel="noopener noreferrer">Singapore&nbsp;Land&nbsp;Authority</a
      ></span
    >
  </p>
{/if}

<style>
  .credit {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 20px;
    font-size: 11px;
    line-height: 1.3;
    color: var(--ink-2);
    text-shadow:
      0 0 3px var(--surface),
      0 0 8px var(--surface);
    pointer-events: none;
  }
  img {
    flex: none;
    display: block;
  }
  a {
    position: relative;
    color: var(--ink);
    text-decoration: none;
    pointer-events: auto;
  }
  /* About 44 px to the finger, over the space round the name, without moving a word. */
  a::before {
    content: '';
    position: absolute;
    inset: -14px -4px;
  }
  @media (hover: hover) {
    a:hover {
      text-decoration: underline;
      text-decoration-color: var(--line);
      text-underline-offset: 2px;
    }
  }
  @media (min-width: 820px) {
    .credit {
      font-size: 12px;
    }
  }
</style>

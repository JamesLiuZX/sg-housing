<script lang="ts">
  import type { Plan } from '../plan/types';

  let { plan }: { plan: Plan } = $props();
</script>

<!-- data-avoid: room labels keep clear of it. -->
<header class="bar" data-avoid>
  <span class="mark">BLK</span>
  <span class="rule" aria-hidden="true"></span>
  <p class="what">
    <span class="title">{plan.title} · <span class="num">{plan.areaSqm} m²</span></span>
    <span class="sub">{plan.subtitle}</span>
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
  .mark {
    font: 700 30px/0.8 var(--font-mark);
    letter-spacing: 0.005em;
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
  }
  .title .num {
    font-weight: 500;
    font-size: 13px;
  }
  .sub {
    font-size: 12px;
    color: var(--ink-2);
  }
  .model {
    grid-column: 1 / -1;
    font-size: 11px;
    letter-spacing: 0.01em;
    color: var(--ink-2);
  }

  @media (min-width: 820px) {
    .bar {
      grid-template-columns: auto auto auto 1fr;
    }
    .mark {
      font-size: 34px;
    }
    .model {
      grid-column: auto;
      justify-self: end;
      font-size: 12px;
    }
  }
</style>

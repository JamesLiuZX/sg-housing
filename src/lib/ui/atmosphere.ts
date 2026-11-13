/**
 * The page behind the model follows the time of day: paper by day, warm
 * peach as the sun nears the horizon, deep ink at night. The interface
 * follows too, ink on paper by day and light on ink at night.
 *
 * This runs on every frame of a sun drag, so it writes CSS variables
 * straight to the DOM and stays out of reactive state.
 */

type RGB = readonly [number, number, number];

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const triplet = (c: RGB) => `${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])}`;
const toHex = (c: RGB) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const smooth = (t: number) => {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
};

/** Three stops of a soft vignette: centre, body, edge. */
type Sky = readonly [RGB, RGB, RGB];
const sky = (a: string, b: string, c: string): Sky => [hex(a), hex(b), hex(c)];

const DAY = sky('#faf7f1', '#f1ede5', '#e3ddd0');
const GOLD = sky('#fce8d2', '#f5d2b1', '#e8b48e');
/** The few minutes around sunset. Without this stop, peach fades to ink through a muddy grey. */
const DUSK = sky('#a08078', '#84696b', '#5f4d58');
const NIGHT = sky('#1c2132', '#12151f', '#0a0c13');

const INK_DAY = hex('#1e1f22');
const INK_NIGHT = hex('#ece7dc');
const SURFACE_DAY = hex('#fbf8f2');
const SURFACE_NIGHT = hex('#171b27');

/** The theme flips where dark and light text read equally well on the sky, with a gap so it cannot flutter. */
const TO_NIGHT = 0.5;
const TO_DAY = 0.62;
const FLIP_MS = 420;

export class Atmosphere {
  private night = false;
  private theme = 0;
  private from = 0;
  private t0 = 0;
  private raf = 0;
  private lastSky = '';
  private meta: HTMLMetaElement | null;

  constructor(
    private root: HTMLElement,
    private skyEl: HTMLElement,
    private onNight: (night: boolean) => void = () => {}
  ) {
    this.meta = document.querySelector('meta[name="theme-color"]');
    this.paintTheme();
  }

  /** day: 0 night to 1 full daylight. gold: 1 at the horizon, 0 with the sun high. */
  set(day: number, gold: number): void {
    const warm = Math.pow(Math.min(1, Math.max(0, gold)), 1.6);
    const stops = [0, 1, 2].map((i) => {
      const lit = mix(DAY[i], GOLD[i], warm);
      return day >= 0.5 ? mix(DUSK[i], lit, smooth((day - 0.5) * 2)) : mix(NIGHT[i], DUSK[i], smooth(day * 2));
    });
    const key = stops.map(toHex).join();
    if (key !== this.lastSky) {
      this.lastSky = key;
      stops.forEach((c, i) => this.skyEl.style.setProperty(`--sky-${i}`, toHex(c)));
      this.meta?.setAttribute('content', toHex(stops[1]));
    }

    const night = this.night ? day < TO_DAY : day < TO_NIGHT;
    if (night !== this.night) {
      this.night = night;
      this.onNight(night);
      this.flip();
    }
  }

  private flip(): void {
    cancelAnimationFrame(this.raf);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      this.theme = this.night ? 1 : 0;
      this.paintTheme();
      return;
    }
    this.from = this.theme;
    this.t0 = performance.now();
    const step = (now: number) => {
      const k = smooth((now - this.t0) / FLIP_MS);
      this.theme = this.from + ((this.night ? 1 : 0) - this.from) * k;
      this.paintTheme();
      if (k < 1) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  private paintTheme(): void {
    const s = this.root.style;
    s.setProperty('--ink-rgb', triplet(mix(INK_DAY, INK_NIGHT, this.theme)));
    s.setProperty('--surface-rgb', triplet(mix(SURFACE_DAY, SURFACE_NIGHT, this.theme)));
    // Night glass sits on a dark model, so it needs more body and a deeper shadow to hold its edge.
    s.setProperty('--glass-alpha', (0.74 + 0.08 * this.theme).toFixed(3));
    s.setProperty('--shade', (0.16 + 0.34 * this.theme).toFixed(3));
    this.root.dataset.theme = this.night ? 'night' : 'day';
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
  }
}

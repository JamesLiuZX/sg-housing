export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  outQuint: (t: number) => 1 - Math.pow(1 - t, 5),
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inOutQuart: (t: number) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2)
} satisfies Record<string, Ease>;

interface Job {
  tag: string;
  elapsed: number;
  delay: number;
  dur: number;
  ease: Ease;
  fn: (k: number) => void;
  resolve: () => void;
}

/** A small tween runner driven by the render loop. One job per tag; a new job replaces the old. */
export class Tweens {
  private jobs: Job[] = [];

  get active(): boolean {
    return this.jobs.length > 0;
  }

  run(tag: string, dur: number, fn: (k: number) => void, opts: { ease?: Ease; delay?: number } = {}): Promise<void> {
    this.kill(tag);
    return new Promise((resolve) => {
      this.jobs.push({ tag, elapsed: 0, delay: opts.delay ?? 0, dur, ease: opts.ease ?? ease.inOut, fn, resolve });
    });
  }

  kill(tag: string): void {
    this.jobs = this.jobs.filter((j) => {
      if (j.tag !== tag) return true;
      j.resolve();
      return false;
    });
  }

  update(dt: number): void {
    if (!this.jobs.length) return;
    const done: Job[] = [];
    for (const j of [...this.jobs]) {
      j.elapsed += dt;
      const t = Math.min(1, Math.max(0, (j.elapsed - j.delay) / j.dur));
      if (j.elapsed >= j.delay) j.fn(j.ease(t));
      if (t >= 1) done.push(j);
    }
    if (done.length) {
      this.jobs = this.jobs.filter((j) => !done.includes(j));
      for (const j of done) j.resolve();
    }
  }
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

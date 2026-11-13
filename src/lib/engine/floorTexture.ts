import { boundsOf, frameOf, pointInPoly, solidSpans } from '../plan/geometry';
import type { Finish, Item, Plan, Pt } from '../plan/types';

export interface FloorBake {
  /** The finishes, in colour. */
  canvas: HTMLCanvasElement;
  /**
   * Contact shading, applied to sky light only, never to sunlight: red where
   * walls meet the floor, green where furniture does, so the furniture's can
   * come and go with the furniture. White is open floor.
   */
  ao: HTMLCanvasElement;
  /** Plan-space rectangle both canvases cover, mm. */
  minX: number;
  minY: number;
  sizeX: number;
  sizeY: number;
}

/** Deterministic noise, so a flat looks the same every time it is opened. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/** Finishes at true size, kept quiet: the joints are there when you look, and gone when you do not. */
function paintFinish(ctx: CanvasRenderingContext2D, finish: Finish, x0: number, y0: number, x1: number, y1: number, s: number, seed: number): void {
  const rand = rng(seed);
  const px = (mm: number) => mm * s;
  if (finish === 'vinyl') {
    // Timber-look planks, 180 by 1220 mm, laid along the long side of the room with staggered ends.
    const along = x1 - x0 >= y1 - y0;
    const plankW = 180;
    const plankL = 1220;
    const across0 = along ? y0 : x0;
    const across1 = along ? y1 : x1;
    const run0 = along ? x0 : y0;
    const run1 = along ? x1 : y1;
    const rect = (r: number, a: number, len: number, wid: number) => {
      if (along) ctx.fillRect(px(r), px(a), px(len), px(wid));
      else ctx.fillRect(px(a), px(r), px(wid), px(len));
    };
    for (let a = across0; a < across1; a += plankW) {
      let r = run0 - rand() * plankL;
      while (r < run1) {
        const len = plankL * (0.8 + rand() * 0.4);
        ctx.fillStyle = shade('#d3b58c', 0.955 + rand() * 0.075);
        rect(r, a, len + 2 / s, plankW + 2 / s);
        // A few long streaks of grain.
        for (let g = 0; g < 4; g++) {
          ctx.fillStyle = rand() < 0.5 ? 'rgba(120,84,46,0.07)' : 'rgba(255,240,215,0.08)';
          rect(r + rand() * len * 0.2, a + 12 + rand() * (plankW - 24), len * (0.5 + rand() * 0.5), 4 + rand() * 8);
        }
        ctx.fillStyle = 'rgba(88,58,30,0.2)';
        rect(r, a, 1 / s, plankW);
        r += len;
      }
      ctx.fillStyle = 'rgba(88,58,30,0.16)';
      rect(run0, a, run1 - run0, 1 / s);
    }
    return;
  }
  const spec = {
    porcelain: { base: '#e8e3d8', grid: 600, line: 'rgba(84,72,58,0.11)', vary: 0.014 },
    tile: { base: '#dcdfdc', grid: 300, line: 'rgba(52,62,66,0.15)', vary: 0.018 },
    cement: { base: '#d0ccc4', grid: 0, line: '', vary: 0 }
  }[finish];
  ctx.fillStyle = spec.base;
  ctx.fillRect(px(x0), px(y0), px(x1 - x0), px(y1 - y0));
  if (!spec.grid) {
    // Screed has no joints, only a faint trowelled cloud.
    for (let i = 0; i < ((x1 - x0) * (y1 - y0)) / 90000; i++) {
      ctx.fillStyle = rand() < 0.5 ? 'rgba(90,84,76,0.035)' : 'rgba(255,252,245,0.05)';
      const r = 60 + rand() * 220;
      ctx.beginPath();
      ctx.arc(px(x0 + rand() * (x1 - x0)), px(y0 + rand() * (y1 - y0)), px(r), 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  for (let y = y0; y < y1; y += spec.grid) {
    for (let x = x0; x < x1; x += spec.grid) {
      ctx.fillStyle = shade(spec.base, 1 - spec.vary + rand() * spec.vary * 2);
      ctx.fillRect(px(x), px(y), px(spec.grid) + 1, px(spec.grid) + 1);
    }
  }
  ctx.fillStyle = spec.line;
  for (let x = x0; x < x1; x += spec.grid) ctx.fillRect(px(x), px(y0), 1, px(y1 - y0));
  for (let y = y0; y < y1; y += spec.grid) ctx.fillRect(px(x0), px(y), px(x1 - x0), 1);
}

function footprint(it: Item): [number, number] {
  const w = it.w ?? 0;
  const d = it.d ?? 0;
  return it.face === 'E' || it.face === 'W' ? [d, w] : [w, d];
}

/** Blur a single-channel image in place with three box passes, which is close to a gaussian. */
function blur(data: Float32Array, w: number, h: number, r: number): void {
  const tmp = new Float32Array(data.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += data[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = acc / (2 * r + 1);
        acc += data[y * w + Math.min(w - 1, x + r + 1)] - data[y * w + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        data[y * w + x] = acc / (2 * r + 1);
        acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
  }
}

/** A grid in plan millimetres, for masks that are stamped and then blurred. */
class Mask {
  readonly data: Float32Array;
  readonly w: number;
  readonly h: number;
  constructor(
    readonly minX: number,
    readonly minY: number,
    sizeX: number,
    sizeY: number,
    readonly k: number
  ) {
    this.w = Math.ceil(sizeX * k);
    this.h = Math.ceil(sizeY * k);
    this.data = new Float32Array(this.w * this.h);
  }

  /** A rectangle centred on (cx, cy), turned to the unit direction (ux, uy). */
  stamp(cx: number, cy: number, ux: number, uy: number, halfU: number, halfV: number, weight: number): void {
    const { k, w, minX, minY } = this;
    const ext = Math.abs(ux) * halfU + Math.abs(uy) * halfV;
    const eyt = Math.abs(uy) * halfU + Math.abs(ux) * halfV;
    const x0 = Math.max(0, Math.floor((cx - ext - minX) * k));
    const x1 = Math.min(w - 1, Math.ceil((cx + ext - minX) * k));
    const y0 = Math.max(0, Math.floor((cy - eyt - minY) * k));
    const y1 = Math.min(this.h - 1, Math.ceil((cy + eyt - minY) * k));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const rx = (x + 0.5) / k + minX - cx;
        const ry = (y + 0.5) / k + minY - cy;
        const u = rx * ux + ry * uy;
        const v = -rx * uy + ry * ux;
        if (Math.abs(u) <= halfU && Math.abs(v) <= halfV) this.data[y * w + x] = Math.max(this.data[y * w + x], weight);
      }
    }
  }

  fillPoly(poly: Pt[]): void {
    for (let y = 0; y < this.h; y++) {
      const py = (y + 0.5) / this.k + this.minY;
      for (let x = 0; x < this.w; x++) if (pointInPoly((x + 0.5) / this.k + this.minX, py, poly)) this.data[y * this.w + x] = 1;
    }
  }
}

/** Walls as they meet the floor. */
function stampWalls(plan: Plan, m: Mask): void {
  for (const wall of plan.walls) {
    const f = frameOf(wall);
    const weight = wall.kind === 'parapet' ? 0.7 : 1;
    for (const [u0, u1] of solidSpans(plan, wall)) {
      const mid = (u0 + u1) / 2;
      m.stamp(wall.a[0] + f.dx * mid, wall.a[1] + f.dy * mid, f.dx, f.dy, (u1 - u0) / 2, wall.t / 2, weight);
    }
  }
}

/** Furniture as it meets the floor. */
function stampItems(plan: Plan, m: Mask): void {
  for (const it of plan.items) {
    if (!it.solid || it.kind === 'rug') continue;
    const [w, d] = footprint(it);
    // Lighter than a wall: most furniture stands on legs or a plinth and lets the sky under it.
    m.stamp(it.x, it.y, 1, 0, w / 2, d / 2, it.kind === 'plant' || it.kind === 'floorLamp' ? 0.32 : 0.5);
  }
}

/**
 * Paints the whole floor into one image, each room in its finish, plus a
 * second grey image of soft shading where walls and furniture meet the
 * floor. That shading is what makes the model read as an object with
 * weight, and it costs nothing to draw.
 */
export function bakeFloor(plan: Plan, maxSize = 2048): FloorBake {
  const b = boundsOf(plan);
  const pad = 400;
  const minX = b.minX - pad;
  const minY = b.minY - pad;
  const sizeX = b.maxX - b.minX + pad * 2;
  const sizeY = b.maxY - b.minY + pad * 2;
  const s = Math.min(maxSize / sizeX, maxSize / sizeY);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sizeX * s);
  canvas.height = Math.round(sizeY * s);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#e8e3d8';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(-minX * s, -minY * s);

  plan.slabs.forEach((slab, i) => {
    const [x0, y0, x1, y1] = slab.rect;
    paintFinish(ctx, slab.finish, x0 - 100, y0 - 100, x1 + 100, y1 + 100, s, 900 + i);
  });
  plan.rooms.forEach((room, i) => {
    const xs = room.poly.map((p) => p[0]);
    const ys = room.poly.map((p) => p[1]);
    ctx.save();
    ctx.beginPath();
    room.poly.forEach(([x, y], j) => (j ? ctx.lineTo(x * s, y * s) : ctx.moveTo(x * s, y * s)));
    ctx.closePath();
    ctx.clip();
    paintFinish(ctx, room.finish, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), s, 17 + i * 31);
    ctx.restore();
  });

  // Two scales of contact shading: a tight line where things touch, and a wide soft dimming.
  const k = 0.05;
  const contact = (stamp: (m: Mask) => void): Float32Array => {
    const tight = new Mask(minX, minY, sizeX, sizeY, k);
    stamp(tight);
    const wide = tight.data.slice();
    blur(tight.data, tight.w, tight.h, 1);
    blur(wide, tight.w, tight.h, 6);
    return tight.data.map((t, i) => Math.max(0, 1 - 0.36 * Math.min(1, t * 1.3) - 0.3 * Math.min(1, wide[i] * 1.2)));
  };
  const byWalls = contact((m) => stampWalls(plan, m));
  const byItems = contact((m) => stampItems(plan, m));
  const ao = document.createElement('canvas');
  ao.width = Math.ceil(sizeX * k);
  ao.height = Math.ceil(sizeY * k);
  const actx = ao.getContext('2d')!;
  const img = actx.createImageData(ao.width, ao.height);
  for (let i = 0; i < byWalls.length; i++) {
    img.data[i * 4] = Math.round(255 * byWalls[i]);
    img.data[i * 4 + 1] = Math.round(255 * byItems[i]);
    img.data[i * 4 + 3] = 255;
  }
  actx.putImageData(img, 0, 0);

  return { canvas, ao, minX, minY, sizeX, sizeY };
}

/**
 * The model's footprint as seen by the table: red is a tight contact shadow
 * hugging the slab, green a wide blur for the shadow the sun throws.
 */
export function bakeGroundShadow(plan: Plan): { canvas: HTMLCanvasElement; minX: number; minY: number; sizeX: number; sizeY: number } {
  const b = boundsOf(plan);
  const pad = 6000;
  const minX = b.minX - pad;
  const minY = b.minY - pad;
  const sizeX = b.maxX - b.minX + pad * 2;
  const sizeY = b.maxY - b.minY + pad * 2;
  const m = new Mask(minX, minY, sizeX, sizeY, 0.02);
  m.fillPoly(plan.outline);
  for (const s of plan.slabs) m.stamp((s.rect[0] + s.rect[2]) / 2, (s.rect[1] + s.rect[3]) / 2, 1, 0, (s.rect[2] - s.rect[0]) / 2, (s.rect[3] - s.rect[1]) / 2, 1);
  const tight = m.data.slice();
  blur(tight, m.w, m.h, 2);
  blur(m.data, m.w, m.h, 11);
  const canvas = document.createElement('canvas');
  canvas.width = m.w;
  canvas.height = m.h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(m.w, m.h);
  for (let i = 0; i < m.data.length; i++) {
    img.data[i * 4] = Math.round(255 * Math.min(1, tight[i]));
    img.data[i * 4 + 1] = Math.round(255 * Math.min(1, m.data[i]));
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, minX, minY, sizeX, sizeY };
}

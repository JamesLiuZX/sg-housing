import { boundsOf, frameOf, solidSpans } from '../plan/geometry';
import type { Finish, Item, Plan, Pt } from '../plan/types';

export interface FloorBake {
  canvas: HTMLCanvasElement;
  /** Plan-space rectangle the canvas covers, mm. */
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

function paintFinish(ctx: CanvasRenderingContext2D, finish: Finish, x0: number, y0: number, x1: number, y1: number, s: number, seed: number): void {
  const rand = rng(seed);
  const px = (mm: number) => mm * s;
  if (finish === 'vinyl') {
    // Timber-look planks, laid along the long side of the room.
    const along = x1 - x0 >= y1 - y0;
    const plankW = 180;
    const plankL = 1220;
    const across0 = along ? y0 : x0;
    const across1 = along ? y1 : x1;
    const run0 = along ? x0 : y0;
    const run1 = along ? x1 : y1;
    for (let a = across0, row = 0; a < across1; a += plankW, row++) {
      let r = run0 - rand() * plankL;
      while (r < run1) {
        const len = plankL * (0.85 + rand() * 0.3);
        ctx.fillStyle = shade('#d6ba93', 0.95 + rand() * 0.1);
        if (along) ctx.fillRect(px(r), px(a), px(len) + 1, px(plankW) + 1);
        else ctx.fillRect(px(a), px(r), px(plankW) + 1, px(len) + 1);
        ctx.fillStyle = 'rgba(92,62,32,0.16)';
        if (along) ctx.fillRect(px(r), px(a), 1, px(plankW));
        else ctx.fillRect(px(a), px(r), px(plankW), 1);
        r += len;
      }
      ctx.fillStyle = 'rgba(92,62,32,0.13)';
      if (along) ctx.fillRect(px(run0), px(a), px(run1 - run0), 1);
      else ctx.fillRect(px(a), px(run0), 1, px(run1 - run0));
    }
    return;
  }
  const spec = {
    porcelain: { base: '#e9e4d9', grid: 600, line: 'rgba(60,50,40,0.07)', vary: 0.018 },
    tile: { base: '#dcdedb', grid: 300, line: 'rgba(40,50,55,0.10)', vary: 0.02 },
    cement: { base: '#d3cfc7', grid: 0, line: '', vary: 0 }
  }[finish];
  ctx.fillStyle = spec.base;
  ctx.fillRect(px(x0), px(y0), px(x1 - x0), px(y1 - y0));
  if (!spec.grid) return;
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

/**
 * Paints the whole floor into one image: each room's finish, then soft
 * shading where walls and furniture meet the floor. That shading is what
 * makes the model read as an object with weight, and it costs nothing to draw.
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
  ctx.fillStyle = '#e9e4d9';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(-minX * s, -minY * s);

  const clipPoly = (poly: Pt[]) => {
    ctx.beginPath();
    poly.forEach(([x, y], i) => (i ? ctx.lineTo(x * s, y * s) : ctx.moveTo(x * s, y * s)));
    ctx.closePath();
    ctx.clip();
  };

  plan.slabs.forEach((slab, i) => {
    const [x0, y0, x1, y1] = slab.rect;
    paintFinish(ctx, slab.finish, x0 - 100, y0 - 100, x1 + 100, y1 + 100, s, 900 + i);
  });
  plan.rooms.forEach((room, i) => {
    const xs = room.poly.map((p) => p[0]);
    const ys = room.poly.map((p) => p[1]);
    ctx.save();
    clipPoly(room.poly);
    paintFinish(ctx, room.finish, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), s, 17 + i * 31);
    ctx.restore();
  });

  // Contact shading, computed at low resolution and blurred.
  const k = 0.02; // px per mm
  const mw = Math.ceil(sizeX * k);
  const mh = Math.ceil(sizeY * k);
  const mask = new Float32Array(mw * mh);
  const stamp = (cx: number, cy: number, ux: number, uy: number, halfU: number, halfV: number, weight: number) => {
    const ext = Math.abs(ux) * halfU + Math.abs(uy) * halfV;
    const eyt = Math.abs(uy) * halfU + Math.abs(ux) * halfV;
    const x0 = Math.max(0, Math.floor((cx - ext - minX) * k));
    const x1 = Math.min(mw - 1, Math.ceil((cx + ext - minX) * k));
    const y0 = Math.max(0, Math.floor((cy - eyt - minY) * k));
    const y1 = Math.min(mh - 1, Math.ceil((cy + eyt - minY) * k));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const rx = x / k + minX - cx;
        const ry = y / k + minY - cy;
        const u = rx * ux + ry * uy;
        const v = -rx * uy + ry * ux;
        if (Math.abs(u) <= halfU && Math.abs(v) <= halfV) mask[y * mw + x] = Math.max(mask[y * mw + x], weight);
      }
    }
  };
  for (const wall of plan.walls) {
    const f = frameOf(wall);
    const weight = wall.kind === 'parapet' ? 0.6 : 1;
    for (const [u0, u1] of solidSpans(plan, wall)) {
      const mid = (u0 + u1) / 2;
      stamp(wall.a[0] + f.dx * mid, wall.a[1] + f.dy * mid, f.dx, f.dy, (u1 - u0) / 2, wall.t / 2 + 60, weight);
    }
  }
  for (const it of plan.items) {
    if (!it.solid || it.kind === 'rug') continue;
    const [w, d] = footprint(it);
    stamp(it.x, it.y, 1, 0, w / 2, d / 2, 0.62);
  }
  blur(mask, mw, mh, 4);

  const shadeCanvas = document.createElement('canvas');
  shadeCanvas.width = mw;
  shadeCanvas.height = mh;
  const sctx = shadeCanvas.getContext('2d')!;
  const img = sctx.createImageData(mw, mh);
  for (let i = 0; i < mask.length; i++) {
    const m = Math.min(1, mask[i] * 1.15);
    const dark = m * m * 0.2 + m * 0.3;
    img.data[i * 4] = 255 * (1 - dark * 0.92);
    img.data[i * 4 + 1] = 255 * (1 - dark * 0.97);
    img.data[i * 4 + 2] = 255 * (1 - dark);
    img.data[i * 4 + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(shadeCanvas, 0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-over';

  return { canvas, minX, minY, sizeX, sizeY };
}

/** A soft dark silhouette of the flat, laid on the ground under the model. */
export function bakeGroundShadow(plan: Plan): { canvas: HTMLCanvasElement; minX: number; minY: number; sizeX: number; sizeY: number } {
  const b = boundsOf(plan);
  const pad = 3000;
  const minX = b.minX - pad;
  const minY = b.minY - pad;
  const sizeX = b.maxX - b.minX + pad * 2;
  const sizeY = b.maxY - b.minY + pad * 2;
  const k = 0.012;
  const w = Math.ceil(sizeX * k);
  const h = Math.ceil(sizeY * k);
  const mask = new Float32Array(w * h);
  const fill = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = Math.floor((y0 - minY) * k); y <= Math.ceil((y1 - minY) * k); y++)
      for (let x = Math.floor((x0 - minX) * k); x <= Math.ceil((x1 - minX) * k); x++) if (x >= 0 && y >= 0 && x < w && y < h) mask[y * w + x] = 1;
  };
  // The outline is rectilinear, so scanline-fill it row by row.
  for (let y = 0; y < h; y++) {
    const py = y / k + minY;
    for (let x = 0; x < w; x++) {
      const pxm = x / k + minX;
      let inside = false;
      const poly = plan.outline;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        if (yi > py !== yj > py && pxm < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) mask[y * w + x] = 1;
    }
  }
  for (const s of plan.slabs) fill(s.rect[0], s.rect[1], s.rect[2], s.rect[3]);
  blur(mask, w, h, 9);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < mask.length; i++) {
    img.data[i * 4] = 40;
    img.data[i * 4 + 1] = 32;
    img.data[i * 4 + 2] = 24;
    img.data[i * 4 + 3] = 255 * Math.min(1, mask[i]) * 0.34;
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, minX, minY, sizeX, sizeY };
}

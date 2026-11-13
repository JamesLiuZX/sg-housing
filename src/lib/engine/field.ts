import * as THREE from 'three';
import { boundsOf, frameOf, openingsOf, pointInPoly } from '../plan/geometry';
import type { Plan } from '../plan/types';

/**
 * Light that three's lights cannot give without heavy shadows, worked out once
 * on a 10 cm grid over the plan and stored in one small texture that every lit
 * surface samples by its position:
 *
 * - r, lamplight. Each bulb lights only what it can see across the plan, so a
 *   lamp never glows through a wall, and light spills out through open doors.
 * - g, sunlight bounced around a room after it comes in through the windows.
 *   It is the only channel that changes, and only with the sun.
 * - b, daylight: how much of the sky a spot can see through the windows. Used
 *   when walking, where the ceiling is in place.
 * - a, indoors.
 */
const CELL = 100;
/** Bounce is stored scaled up, so a sunny room's share fills the eight bits. */
export const BOUNCE_SCALE = 10;
/** Lamplight is stored scaled, so the pool under a ceiling bulb sits near 0.6. */
export const LAMP_SCALE = 3;

interface Win {
  /** Centre on the wall line and inward unit normal, plan mm. */
  x: number;
  y: number;
  nx: number;
  ny: number;
  area: number;
  zone: number;
}

export interface LightField {
  texture: THREE.DataTexture;
  /** World rectangle the texture covers: x, z, width, depth. */
  rect: THREE.Vector4;
  /** Re-spreads the bounced sun. The direction points at the sun, in world axes. */
  setSun(dir: THREE.Vector3): void;
  dispose(): void;
}

export function buildField(plan: Plan, toWorld: (x: number, y: number) => [number, number]): LightField {
  const b = boundsOf(plan);
  const pad = 400;
  const minX = b.minX - pad;
  const minY = b.minY - pad;
  const cols = Math.ceil((b.maxX - b.minX + pad * 2) / CELL);
  const rows = Math.ceil((b.maxY - b.minY + pad * 2) / CELL);
  const n = cols * rows;
  const H = plan.height / 1000;
  const cx = (c: number) => minX + (c + 0.5) * CELL;
  const cy = (r: number) => minY + (r + 0.5) * CELL;

  // Walls, drawn generously so a 10 cm partition always covers a cell. `wall` blocks
  // light; `shut` also closes doorways, which is what separates one room from the next.
  const inside = new Uint8Array(n);
  const wall = new Uint8Array(n);
  const shut = new Uint8Array(n);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) inside[r * cols + c] = pointInPoly(cx(c), cy(r), plan.outline) ? 1 : 0;
  for (const w of plan.walls) {
    if (w.kind === 'parapet') continue;
    const f = frameOf(w);
    const gaps = openingsOf(plan, w.id).filter((o) => o.type !== 'window');
    const half = w.t / 2 + CELL / 2;
    const x0 = Math.min(w.a[0], w.b[0]) - half - CELL;
    const x1 = Math.max(w.a[0], w.b[0]) + half + CELL;
    const y0 = Math.min(w.a[1], w.b[1]) - half - CELL;
    const y1 = Math.max(w.a[1], w.b[1]) + half + CELL;
    for (let r = Math.max(0, Math.floor((y0 - minY) / CELL)); r < Math.min(rows, Math.ceil((y1 - minY) / CELL)); r++) {
      for (let c = Math.max(0, Math.floor((x0 - minX) / CELL)); c < Math.min(cols, Math.ceil((x1 - minX) / CELL)); c++) {
        const rx = cx(c) - w.a[0];
        const ry = cy(r) - w.a[1];
        const u = rx * f.dx + ry * f.dy;
        if (Math.abs(rx * f.nx + ry * f.ny) > half || u < -half || u > f.len + half) continue;
        const i = r * cols + c;
        shut[i] = 1;
        // A doorway lets light through only where it is clear of the jambs.
        if (!gaps.some((g) => u > g.at + CELL / 2 && u < g.at + g.w - CELL / 2)) wall[i] = 1;
      }
    }
  }

  /** Whether the straight line between two cells crosses a wall, ignoring the last few cells at the far end. */
  const blocked = (c0: number, r0: number, c1: number, r1: number, skipEnd: number): boolean => {
    const dc = Math.abs(c1 - c0);
    const dr = Math.abs(r1 - r0);
    const sc = c0 < c1 ? 1 : -1;
    const sr = r0 < r1 ? 1 : -1;
    const steps = Math.max(dc, dr);
    let err = dc - dr;
    let c = c0;
    let r = r0;
    for (let k = 0; k < steps - skipEnd; k++) {
      const e2 = 2 * err;
      if (e2 > -dr) {
        err -= dr;
        c += sc;
      }
      if (e2 < dc) {
        err += dc;
        r += sr;
      }
      if (wall[r * cols + c]) return true;
    }
    return false;
  };
  const cellOf = (x: number, y: number): [number, number] => [
    Math.min(cols - 1, Math.max(0, Math.floor((x - minX) / CELL))),
    Math.min(rows - 1, Math.max(0, Math.floor((y - minY) / CELL)))
  ];

  // ── Lamps ────────────────────────────────────────────────────────────────
  const lamps: { x: number; y: number; h: number; p: number }[] = plan.lights.map(([x, y]) => ({ x, y, h: H - 0.35, p: 1 }));
  for (const it of plan.items) {
    if (it.kind === 'floorLamp') lamps.push({ x: it.x, y: it.y, h: 1.5, p: 0.42 });
    else if (it.kind === 'sideTable') lamps.push({ x: it.x, y: it.y, h: 0.78, p: 0.16 });
    else if (it.kind === 'desk' && !it.opts?.vanity) lamps.push({ x: it.x, y: it.y, h: 1.05, p: 0.18 });
  }
  const lamp = new Float32Array(n);
  for (const l of lamps) {
    const [lc, lr] = cellOf(l.x, l.y);
    const reach = 7000;
    for (let r = Math.max(0, lr - reach / CELL); r < Math.min(rows, lr + reach / CELL); r++) {
      for (let c = Math.max(0, lc - reach / CELL); c < Math.min(cols, lc + reach / CELL); c++) {
        const i = r * cols + c;
        if (wall[i]) continue;
        const d2 = ((cx(c) - l.x) ** 2 + (cy(r) - l.y) ** 2) / 1e6;
        if (d2 > 49 || blocked(lc, lr, c, r, 0)) continue;
        // Light on a floor from a point above it: the cosine over distance squared.
        lamp[i] += (l.p * l.h) / Math.pow(d2 + l.h * l.h, 1.5);
      }
    }
  }

  // ── Windows and daylight ────────────────────────────────────────────────
  const wins: Win[] = [];
  for (const o of plan.openings) {
    if (o.type !== 'window') continue;
    const w = plan.walls.find((x) => x.id === o.wall);
    if (!w) continue;
    const f = frameOf(w);
    const mid = o.at + o.w / 2;
    const x = w.a[0] + f.dx * mid;
    const y = w.a[1] + f.dy * mid;
    const toLeft = pointInPoly(x + f.nx * 400, y + f.ny * 400, plan.outline) ? 1 : -1;
    const area = (o.w / 1000) * (((o.head ?? plan.height) - (o.sill ?? 0)) / 1000);
    wins.push({ x, y, nx: f.nx * toLeft, ny: f.ny * toLeft, area, zone: -1 });
  }
  const day = new Float32Array(n);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!inside[i] || wall[i]) continue;
      let sum = 0;
      for (const w of wins) {
        const rx = (cx(c) - w.x) / 1000;
        const ry = (cy(r) - w.y) / 1000;
        const along = rx * w.nx + ry * w.ny;
        if (along <= 0.05) continue;
        const [wc, wr] = cellOf(w.x, w.y);
        if (blocked(c, r, wc, wr, 3)) continue;
        const d2 = rx * rx + ry * ry;
        // The window as seen from here, a metre below its middle: area, foreshortening, distance.
        sum += (w.area * (along / Math.sqrt(d2))) / (Math.PI * (d2 + 1));
      }
      day[i] = 1 - Math.exp(-6 * sum);
    }
  }

  // ── Zones for bounce: rooms joined by openings without doors ────────────
  const zone = new Int32Array(n).fill(-1);
  const zoneCells: number[] = [];
  const zoneEdge: number[] = [];
  const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (!inside[s] || shut[s] || zone[s] >= 0) continue;
    const z = zoneCells.length;
    zoneCells.push(0);
    zoneEdge.push(0);
    zone[s] = z;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      zoneCells[z]++;
      const c = i % cols;
      const r = (i - c) / cols;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const j = nr * cols + nc;
        if (shut[j]) zoneEdge[z]++;
        if (!inside[j] || shut[j] || zone[j] >= 0) continue;
        zone[j] = z;
        stack.push(j);
      }
    }
  }
  for (const w of wins) {
    const [c, r] = cellOf(w.x + w.nx * 350, w.y + w.ny * 350);
    w.zone = zone[r * cols + c];
  }
  // Each zone's share of the light, softened a few cells so doorways do not show a seam.
  const zones = zoneCells.length;
  const basis: Float32Array[] = [];
  for (let z = 0; z < zones; z++) {
    const m = new Float32Array(n);
    for (let i = 0; i < n; i++) if (zone[i] === z) m[i] = 1;
    spread(m, cols, rows, inside, 2);
    basis.push(m);
  }
  // What a zone's walls, floor and ceiling add up to, m², for spreading what comes in.
  const surface = zoneCells.map((cells, z) => 2 * cells * 0.01 + zoneEdge[z] * 0.1 * H);

  // Solid cells take their neighbours' light, so surfaces right at a wall do not sample a dark seam.
  // Outdoors sees the whole sky, which keeps the inside of an outer wall from reading as a dark cave.
  for (let i = 0; i < n; i++) if (!inside[i]) day[i] = 1;
  spread(lamp, cols, rows, inside, 1);
  fillWalls(lamp, wall, cols, rows);
  fillWalls(day, wall, cols, rows);
  spread(day, cols, rows, inside, 1);

  const data = new Uint8Array(n * 4);
  const enc = (v: number) => Math.round(Math.sqrt(Math.min(1, Math.max(0, v))) * 255);
  const inSoft = Float32Array.from(inside);
  spread(inSoft, cols, rows, null, 1);
  for (let i = 0; i < n; i++) {
    data[i * 4] = enc(lamp[i] * LAMP_SCALE);
    data[i * 4 + 2] = enc(inside[i] ? day[i] : 1);
    data[i * 4 + 3] = Math.round(inSoft[i] * 255);
  }
  const texture = new THREE.DataTexture(data, cols, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;

  const [rx, rz] = toWorld(minX, minY);
  const rect = new THREE.Vector4(rx, rz, (cols * CELL) / 1000, (rows * CELL) / 1000);
  const amount = new Float32Array(zones);

  return {
    texture,
    rect,
    setSun(dir) {
      amount.fill(0);
      if (dir.y > 0) {
        for (const w of wins) {
          if (w.zone < 0) continue;
          // Light through a window: its area times how squarely the sun meets it.
          const facing = -(w.nx * dir.x + w.ny * dir.z);
          if (facing > 0) amount[w.zone] += w.area * facing;
        }
      }
      // Half of what lands is reflected, and half of that again, and so on.
      for (let z = 0; z < zones; z++) amount[z] = (amount[z] * 0.55 * 2) / Math.max(1, surface[z]);
      for (let i = 0; i < n; i++) {
        let v = 0;
        for (let z = 0; z < zones; z++) if (amount[z] > 0) v += amount[z] * basis[z][i];
        data[i * 4 + 1] = enc(v * BOUNCE_SCALE);
      }
      texture.needsUpdate = true;
    },
    dispose() {
      texture.dispose();
    }
  };
}

/** Box-blurs a grid in place, radius in cells, twice. With a mask, cells outside it are left alone. */
function spread(v: Float32Array, cols: number, rows: number, mask: Uint8Array | null, radius: number): void {
  const tmp = new Float32Array(v.length);
  for (let pass = 0; pass < 2; pass++) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let s = 0;
        let k = 0;
        for (let d = -radius; d <= radius; d++) {
          const cc = c + d;
          if (cc < 0 || cc >= cols) continue;
          s += v[r * cols + cc];
          k++;
        }
        tmp[r * cols + c] = s / k;
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (mask && !mask[i]) continue;
        let s = 0;
        let k = 0;
        for (let d = -radius; d <= radius; d++) {
          const rr = r + d;
          if (rr < 0 || rr >= rows) continue;
          s += tmp[rr * cols + c];
          k++;
        }
        v[i] = s / k;
      }
    }
  }
}

/** Gives each wall cell the average of the open cells beside it, a few cells deep. */
function fillWalls(v: Float32Array, wall: Uint8Array, cols: number, rows: number): void {
  const done = Uint8Array.from(wall, (w) => (w ? 0 : 1));
  for (let pass = 0; pass < 3; pass++) {
    const next = done.slice();
    for (let i = 0; i < v.length; i++) {
      if (done[i]) continue;
      const c = i % cols;
      let s = 0;
      let k = 0;
      for (const j of [i - 1, i + 1, i - cols, i + cols]) {
        if (j < 0 || j >= v.length || !done[j] || (j === i - 1 && c === 0) || (j === i + 1 && c === cols - 1)) continue;
        s += v[j];
        k++;
      }
      if (k) {
        v[i] = s / k;
        next[i] = 1;
      }
    }
    done.set(next);
  }
}

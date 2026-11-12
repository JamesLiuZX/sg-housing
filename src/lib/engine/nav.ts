import { boundsOf, frameOf, pointInPoly, solidSpans } from '../plan/geometry';
import type { Plan } from '../plan/types';

export interface P2 {
  x: number;
  z: number;
}

/**
 * Where a person can stand. The flat is rasterised to a 10 cm grid; a cell is
 * free when it lies inside a room or the corridor and clear of walls and
 * furniture by a body's half-width. Paths are found on the grid, then
 * straightened.
 */
export class Nav {
  readonly cell = 0.1;
  readonly cols: number;
  readonly rows: number;
  private ox: number;
  private oz: number;
  private blocked: Uint8Array;

  constructor(plan: Plan, toWorld: (x: number, y: number) => [number, number]) {
    const b = boundsOf(plan);
    const [x0, z0] = toWorld(b.minX - 300, b.minY - 300);
    const [x1, z1] = toWorld(b.maxX + 300, b.maxY + 300);
    this.ox = x0;
    this.oz = z0;
    this.cols = Math.ceil((x1 - x0) / this.cell);
    this.rows = Math.ceil((z1 - z0) / this.cell);
    this.blocked = new Uint8Array(this.cols * this.rows);
    const [wx0, wz0] = toWorld(0, 0);
    const body = 220; // mm

    const spans = plan.walls.map((w) => ({ w, f: frameOf(w), s: solidSpans(plan, w) }));
    const boxes = plan.items
      .filter((it) => it.solid && it.kind !== 'rug')
      .map((it) => {
        const turned = it.face === 'E' || it.face === 'W';
        const w = (turned ? it.d : it.w) ?? 0;
        const d = (turned ? it.w : it.d) ?? 0;
        return { x0: it.x - w / 2 - 110, x1: it.x + w / 2 + 110, y0: it.y - d / 2 - 110, y1: it.y + d / 2 + 110 };
      });
    const inSlab = (x: number, y: number) => plan.slabs.some((s) => s.id === 'corridor' && x > s.rect[0] && x < s.rect[2] && y > s.rect[1] - 200 && y < s.rect[3]);

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        // Back to plan millimetres for the tests.
        const x = (this.ox + (c + 0.5) * this.cell - wx0) * 1000;
        const y = (this.oz + (r + 0.5) * this.cell - wz0) * 1000;
        let free = plan.rooms.some((room) => pointInPoly(x, y, room.poly)) || inSlab(x, y);
        if (free) {
          for (const { w, f, s } of spans) {
            const rx = x - w.a[0];
            const ry = y - w.a[1];
            const u = rx * f.dx + ry * f.dy;
            const v = Math.abs(rx * f.nx + ry * f.ny);
            if (v > w.t / 2 + body) continue;
            for (const [u0, u1] of s) {
              const du = Math.max(u0 - u, 0, u - u1);
              const dv = Math.max(v - w.t / 2, 0);
              if (du * du + dv * dv < body * body) {
                free = false;
                break;
              }
            }
            if (!free) break;
          }
        }
        if (free) for (const bx of boxes) if (x > bx.x0 && x < bx.x1 && y > bx.y0 && y < bx.y1) free = false;
        this.blocked[r * this.cols + c] = free ? 0 : 1;
      }
    }
  }

  private cellOf(p: P2): [number, number] {
    return [Math.floor((p.x - this.ox) / this.cell), Math.floor((p.z - this.oz) / this.cell)];
  }

  private centre(c: number, r: number): P2 {
    return { x: this.ox + (c + 0.5) * this.cell, z: this.oz + (r + 0.5) * this.cell };
  }

  private freeCell(c: number, r: number): boolean {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows && this.blocked[r * this.cols + c] === 0;
  }

  isFree(p: P2): boolean {
    const [c, r] = this.cellOf(p);
    return this.freeCell(c, r);
  }

  /** The closest standable point to p, searching outward up to about 2.5 m. */
  nearestFree(p: P2): P2 | null {
    const [c0, r0] = this.cellOf(p);
    if (this.freeCell(c0, r0)) return p;
    for (let ring = 1; ring < 26; ring++) {
      let best: P2 | null = null;
      let bestD = Infinity;
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
          if (!this.freeCell(c0 + dc, r0 + dr)) continue;
          const q = this.centre(c0 + dc, r0 + dr);
          const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = q;
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  private clear(a: P2, b: P2): boolean {
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(dist / (this.cell * 0.5)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (!this.isFree({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })) return false;
    }
    return true;
  }

  /** A walkable route from a to b as a short list of corners, or null if there is none. */
  path(a: P2, b: P2): P2[] | null {
    const start = this.nearestFree(a);
    const goal = this.nearestFree(b);
    if (!start || !goal) return null;
    if (this.clear(start, goal)) return [start, goal];

    const [sc, sr] = this.cellOf(start);
    const [gc, gr] = this.cellOf(goal);
    const n = this.cols * this.rows;
    const g = new Float32Array(n).fill(Infinity);
    const from = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap: number[] = [];
    const fScore = new Float32Array(n);
    const h = (c: number, r: number) => Math.hypot(c - gc, r - gr);
    const push = (i: number) => {
      heap.push(i);
      let k = heap.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (fScore[heap[p]] <= fScore[heap[k]]) break;
        [heap[p], heap[k]] = [heap[k], heap[p]];
        k = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = k * 2 + 1;
          const r = l + 1;
          let m = k;
          if (l < heap.length && fScore[heap[l]] < fScore[heap[m]]) m = l;
          if (r < heap.length && fScore[heap[r]] < fScore[heap[m]]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]];
          k = m;
        }
      }
      return top;
    };
    const si = sr * this.cols + sc;
    const gi = gr * this.cols + gc;
    g[si] = 0;
    fScore[si] = h(sc, sr);
    push(si);
    let found = false;
    while (heap.length) {
      const cur = pop();
      if (cur === gi) {
        found = true;
        break;
      }
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cc = cur % this.cols;
      const cr = (cur - cc) / this.cols;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nc = cc + dc;
          const nr = cr + dr;
          if (!this.freeCell(nc, nr)) continue;
          // No cutting corners between two blocked cells.
          if (dr && dc && (!this.freeCell(cc + dc, cr) || !this.freeCell(cc, cr + dr))) continue;
          const ni = nr * this.cols + nc;
          const cost = g[cur] + (dr && dc ? 1.4142 : 1);
          if (cost < g[ni]) {
            g[ni] = cost;
            from[ni] = cur;
            fScore[ni] = cost + h(nc, nr);
            push(ni);
          }
        }
      }
    }
    if (!found) return null;

    const cells: P2[] = [];
    for (let i = gi; i !== -1; i = from[i]) {
      const c = i % this.cols;
      cells.push(this.centre(c, (i - c) / this.cols));
    }
    cells.reverse();
    cells[0] = start;
    cells[cells.length - 1] = goal;

    // Pull the route taut: keep a corner only when the straight line past it is blocked.
    const out: P2[] = [cells[0]];
    let i = 0;
    while (i < cells.length - 1) {
      let j = cells.length - 1;
      while (j > i + 1 && !this.clear(cells[i], cells[j])) j--;
      out.push(cells[j]);
      i = j;
    }
    return out;
  }
}

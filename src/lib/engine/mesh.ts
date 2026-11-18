import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { col } from './materials';

/** A point or a turn in the frame being built in: x across the front, y up, z out of the front. */
export type Vec3 = readonly [number, number, number];

/** Collects many small geometries into one buffer, so a whole flat draws in a handful of calls. */
export class Merger {
  private pos: number[] = [];
  private nor: number[] = [];
  private rgb: number[] = [];
  private piv: number[] = [];
  private del: number[] = [];
  private wal: number[] = [];
  private idx: number[] = [];
  private v = new THREE.Vector3();
  private nm = new THREE.Matrix3();

  get empty(): boolean {
    return this.pos.length === 0;
  }

  add(geo: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.Color, pivot: THREE.Vector3, delay: number, wall: number): void {
    const p = geo.getAttribute('position');
    const n = geo.getAttribute('normal');
    // A shape may carry its own shading, a paler midrib or a darker underside, as a tint on its colour.
    const tint = geo.hasAttribute('color') ? geo.getAttribute('color') : null;
    const base = this.pos.length / 3;
    this.nm.getNormalMatrix(m);
    for (let i = 0; i < p.count; i++) {
      this.v.fromBufferAttribute(p, i).applyMatrix4(m);
      this.pos.push(this.v.x, this.v.y, this.v.z);
      this.v.fromBufferAttribute(n, i).applyMatrix3(this.nm).normalize();
      this.nor.push(this.v.x, this.v.y, this.v.z);
      if (tint) this.rgb.push(color.r * tint.getX(i), color.g * tint.getY(i), color.b * tint.getZ(i));
      else this.rgb.push(color.r, color.g, color.b);
      this.piv.push(pivot.x, pivot.y, pivot.z);
      this.del.push(delay);
      this.wal.push(wall);
    }
    const index = geo.getIndex();
    if (index) for (let i = 0; i < index.count; i++) this.idx.push(base + index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    geo.dispose();
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.rgb, 3));
    g.setAttribute('aPivot', new THREE.Float32BufferAttribute(this.piv, 3));
    g.setAttribute('aDelay', new THREE.Float32BufferAttribute(this.del, 1));
    g.setAttribute('aWall', new THREE.Float32BufferAttribute(this.wal, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

type Target = 'solid' | 'glass' | 'lamp';

export interface PlaceOptions {
  /** The wall this object hangs on or stands in, so it is cut down with it. */
  wall?: number;
  /** Height it grows from, metres. Things hung on a wall appear where they hang, not from the floor. */
  pivotY?: number;
  /**
   * The wall a floor piece stands against. What the piece hangs on it (a
   * television, wall cabinets, a mirror) is drawn through `Kit.hang` and
   * leaves with that wall, rather than float in front of its cut stub.
   */
  back?: number;
}

/** The shape of a leaf and how it is held, for `Kit.leaf`. */
export interface LeafSpec {
  /** Length and greatest width of the blade, metres. */
  len: number;
  width: number;
  /** Half-widths from stalk to tip at even steps, as fractions of the greatest. At least two. */
  outline: readonly number[];
  /** Heading about the vertical, 0 along +z, and rise above the horizontal at the stalk, radians. */
  yaw: number;
  pitch: number;
  /** How far the blade has bowed down by its tip, radians. */
  curl?: number;
  /** Height of the edges above the midrib, as a fraction of the half-width. Positive cups the blade. */
  cup?: number;
  /** Turn of the blade about its own length, radians. */
  roll?: number;
}

const UP = new THREE.Vector3(0, 1, 0);
/** Gap between the two faces of a leaf, metres: enough to keep them apart in depth, too little to see. */
const LEAF_GAP = 0.0015;
/** Turns in a turned profile sharper than this (cosine of the angle) keep a crisp edge. */
const CREASE = Math.cos((40 * Math.PI) / 180);

/** x to the power e, keeping its sign. */
function spow(x: number, e: number): number {
  return Math.sign(x) * Math.abs(x) ** e;
}

/** 0 below a, 1 above b, eased between, as GLSL's smoothstep: for shading that fades in without a line. */
function smooth01(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** An indexed geometry from plain arrays, with a per-vertex tint when one is given. */
function geometry(pos: number[], nor: number[] | null, idx: number[], tint?: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (tint) g.setAttribute('color', new THREE.Float32BufferAttribute(tint, 3));
  g.setIndex(idx);
  if (nor) g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  else g.computeVertexNormals();
  return g;
}

/**
 * A modelling kit: place a frame of reference, then add simple rounded
 * shapes inside it. Local +Z is the front of whatever is being built.
 */
export class Kit {
  readonly solid = new Merger();
  readonly glass = new Merger();
  readonly lamp = new Merger();
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];
  private pivot = new THREE.Vector3();
  private delay = 0;
  private wall = -1;
  private back = -1;
  private tmp = new THREE.Matrix4();
  private e = new THREE.Euler();

  private get top(): THREE.Matrix4 {
    return this.stack[this.stack.length - 1];
  }

  /** Start a new object at a floor position, turned about the vertical. */
  place(x: number, z: number, rotY: number, delay: number, fn: () => void, opts: PlaceOptions = {}): void {
    this.stack.push(new THREE.Matrix4().makeRotationY(rotY).setPosition(x, 0, z));
    this.pivot.set(x, opts.pivotY ?? 0, z);
    this.delay = delay;
    this.wall = opts.wall ?? -1;
    this.back = opts.back ?? -1;
    fn();
    this.stack.pop();
  }

  /** A nested frame inside the current object. */
  sub(x: number, y: number, z: number, rotY: number, fn: () => void): void {
    const m = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y, z);
    this.stack.push(this.top.clone().multiply(m));
    fn();
    this.stack.pop();
  }

  /** A nested frame turned about all three axes (in x, y, z order), and stretched if `scale` is given. */
  frame(x: number, y: number, z: number, rot: Vec3, fn: () => void, scale?: Vec3): void {
    const m = new THREE.Matrix4().makeRotationFromEuler(this.e.set(rot[0], rot[1], rot[2]));
    if (scale) m.scale(new THREE.Vector3(scale[0], scale[1], scale[2]));
    m.setPosition(x, y, z);
    this.stack.push(this.top.clone().multiply(m));
    fn();
    this.stack.pop();
  }

  /**
   * Parts the current piece hangs on the wall behind it. They grow from the
   * point given, where they hang, and leave with that wall when it is cut
   * down for the camera. With no wall behind, they are drawn as usual.
   */
  hang(x: number, y: number, z: number, fn: () => void): void {
    if (this.back < 0) {
      fn();
      return;
    }
    const wall = this.wall;
    const pivot = this.pivot.clone();
    this.wall = this.back;
    this.pivot.set(x, y, z).applyMatrix4(this.top);
    fn();
    this.wall = wall;
    this.pivot.copy(pivot);
  }

  private put(geo: THREE.BufferGeometry, local: THREE.Matrix4, hex: number, to: Target): void {
    const m = this.top.clone().multiply(local);
    this[to].add(geo, m, col(hex), this.pivot, this.delay, this.wall);
  }

  private emit(geo: THREE.BufferGeometry, x: number, y: number, z: number, hex: number, rot: Vec3 | undefined, to: Target): void {
    if (rot) this.tmp.makeRotationFromEuler(this.e.set(rot[0], rot[1], rot[2]));
    else this.tmp.identity();
    this.tmp.setPosition(x, y, z);
    this.put(geo, this.tmp, hex, to);
  }

  /**
   * A box sitting on height y0, centred on x and z. Corners are rounded only
   * where the rounding is big enough to catch the light; below that it is a
   * plain box, which keeps the triangle count down.
   */
  box(w: number, h: number, d: number, x: number, y0: number, z: number, hex: number, r = 0.012, rot?: [number, number, number], to: Target = 'solid'): void {
    const rr = Math.min(r, Math.min(w, h, d) / 2 - 0.0005);
    const geo = rr >= 0.008 ? new RoundedBoxGeometry(w, h, d, rr > 0.04 ? 2 : 1, rr) : new THREE.BoxGeometry(w, h, d);
    this.emit(geo, x, y0 + h / 2, z, hex, rot, to);
  }

  /** An upright cylinder or cone sitting on height y0. */
  cyl(rTop: number, rBot: number, h: number, x: number, y0: number, z: number, hex: number, seg = 20, rot?: [number, number, number], to: Target = 'solid'): void {
    this.emit(new THREE.CylinderGeometry(rTop, rBot, h, seg), x, y0 + h / 2, z, hex, rot, to);
  }

  /** A squashed sphere centred on a point. */
  ball(r: number, x: number, y: number, z: number, hex: number, sx = 1, sy = 1, sz = 1): void {
    const geo = new THREE.SphereGeometry(r, 12, 8);
    geo.scale(sx, sy, sz);
    this.emit(geo, x, y, z, hex, undefined, 'solid');
  }

  /**
   * A round rod from a to b, tapering from r0 to r1: legs, rails, stems.
   * Its ends are left open, since they stand on the floor or run into
   * whatever they hold up.
   */
  rod(a: Vec3, b: Vec3, r0: number, r1: number, hex: number, seg = 8, to: Target = 'solid'): void {
    const from = new THREE.Vector3(a[0], a[1], a[2]);
    const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = dir.length();
    if (len < 1e-6) return;
    dir.divideScalar(len);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
    this.tmp.makeRotationFromQuaternion(q).setPosition(from.addScaledVector(dir, len / 2));
    this.put(new THREE.CylinderGeometry(r1, r0, len, seg, 1, true), this.tmp, hex, to);
  }

  /**
   * A turned shape, centred on x and z: `profile` is radius and height pairs
   * from the bottom of the axis, up the outside and back in over the top,
   * metres above y0. Turns sharper than about 40 degrees keep a crisp edge;
   * gentler ones shade smooth, so a pot reads as fired clay and not facets.
   */
  lathe(profile: readonly (readonly [number, number])[], x: number, y0: number, z: number, hex: number, seg = 24, to: Target = 'solid'): void {
    const n = profile.length;
    if (n < 2) return;
    // The outward normal of each step of the profile, in radius and height.
    const step: [number, number][] = [];
    for (let j = 0; j < n - 1; j++) {
      const dr = profile[j + 1][0] - profile[j][0];
      const dy = profile[j + 1][1] - profile[j][1];
      const l = Math.hypot(dr, dy) || 1;
      step.push([dy / l, -dr / l]);
    }
    const pos: number[] = [];
    const nor: number[] = [];
    const idx: number[] = [];
    const ring = (r: number, y: number, nr: number, ny: number): number => {
      const base = pos.length / 3;
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        const s = Math.sin(a);
        const c = Math.cos(a);
        pos.push(r * s, y, r * c);
        nor.push(nr * s, ny, nr * c);
      }
      return base;
    };
    // Each point is one ring of vertices, or two where the profile turns sharply,
    // so a lip or a foot keeps its edge. Unlike three's lathe this adds no
    // zero-width bands, and draws only the live half of a band that meets the axis.
    let last = -1;
    let lastR = 0;
    for (let j = 0; j < n; j++) {
      const r = Math.max(0, profile[j][0]);
      const y = profile[j][1];
      const a = j > 0 ? step[j - 1] : null;
      const b = j < n - 1 ? step[j] : null;
      let into: number;
      let out: number;
      if (a && b && a[0] * b[0] + a[1] * b[1] >= CREASE) {
        const mr = a[0] + b[0];
        const my = a[1] + b[1];
        const l = Math.hypot(mr, my) || 1;
        into = out = ring(r, y, mr / l, my / l);
      } else {
        into = a ? ring(r, y, a[0], a[1]) : -1;
        out = b ? ring(r, y, b[0], b[1]) : -1;
      }
      if (last >= 0 && into >= 0) {
        for (let i = 0; i < seg; i++) {
          const p = last + i;
          const q = into + i;
          if (lastR > 0) idx.push(p, p + 1, q);
          if (r > 0) idx.push(q + 1, q, p + 1);
        }
      }
      last = out;
      lastR = r;
    }
    this.emit(geometry(pos, nor, idx), x, y0, z, hex, undefined, to);
  }

  /**
   * A tube along a smooth curve through the points, tapering from r0 to r1:
   * stalks, spouts, handles, hooks. `steps` is how finely the curve is cut;
   * left at 0 it follows the number of points.
   */
  tube(pts: readonly Vec3[], r0: number, r1: number, hex: number, seg = 6, steps = 0, to: Target = 'solid'): void {
    const curve = new THREE.CatmullRomCurve3(
      pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
      false,
      'centripetal'
    );
    const n = steps > 0 ? steps : Math.max(2, (pts.length - 1) * 4);
    const frames = curve.computeFrenetFrames(n, false);
    const pos: number[] = [];
    const nor: number[] = [];
    const idx: number[] = [];
    const p = new THREE.Vector3();
    const v = new THREE.Vector3();
    for (let i = 0; i <= n; i++) {
      curve.getPointAt(i / n, p);
      const r = r0 + ((r1 - r0) * i) / n;
      const N = frames.normals[i];
      const B = frames.binormals[i];
      for (let j = 0; j <= seg; j++) {
        const a = (j / seg) * Math.PI * 2;
        const s = Math.sin(a);
        const c = -Math.cos(a);
        v.set(c * N.x + s * B.x, c * N.y + s * B.y, c * N.z + s * B.z).normalize();
        nor.push(v.x, v.y, v.z);
        pos.push(p.x + r * v.x, p.y + r * v.y, p.z + r * v.z);
      }
    }
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= seg; j++) {
        const a = (seg + 1) * (i - 1) + (j - 1);
        const b = (seg + 1) * i + (j - 1);
        const c = (seg + 1) * i + j;
        const d = (seg + 1) * (i - 1) + j;
        idx.push(a, b, d, b, c, d);
      }
    }
    this.tmp.identity();
    this.put(geometry(pos, nor, idx), this.tmp, hex, to);
  }

  /**
   * A soft solid w by h by d sitting on height y0, for cushions, pillows and
   * anything upholstered. It is a superellipsoid: `round` sets how square it
   * is from top to bottom, then around. Near 0 is a box with eased edges,
   * 1 is round, and above 1 pinches the seam the way a stuffed cushion does.
   * The underside is tinted darker by `under`, the shade a cushion keeps
   * where it presses on what holds it.
   */
  soft(w: number, h: number, d: number, x: number, y0: number, z: number, hex: number, round: readonly [number, number] = [0.35, 0.2], rot?: Vec3, seg = 16, under = 0.16): void {
    const [e1, e2] = round;
    const nu = Math.max(8, seg);
    const nv = Math.max(4, Math.round(seg / 2));
    const a = w / 2;
    const b = h / 2;
    const c = d / 2;
    const pos: number[] = [];
    const nor: number[] = [];
    const tint: number[] = [];
    const idx: number[] = [];
    const n = new THREE.Vector3();
    for (let j = 0; j <= nv; j++) {
      const eta = -Math.PI / 2 + (Math.PI * j) / nv;
      const ce = Math.cos(eta);
      const se = j === 0 ? -1 : j === nv ? 1 : Math.sin(eta);
      const t = 1 - under * (1 - smooth01(-1, 0.25, se));
      for (let i = 0; i <= nu; i++) {
        const om = -Math.PI + (2 * Math.PI * i) / nu;
        const co = Math.cos(om);
        const so = Math.sin(om);
        pos.push(a * spow(ce, e1) * spow(co, e2), b * spow(se, e1), c * spow(ce, e1) * spow(so, e2));
        n.set((spow(ce, 2 - e1) * spow(co, 2 - e2)) / a, spow(se, 2 - e1) / b, (spow(ce, 2 - e1) * spow(so, 2 - e2)) / c).normalize();
        nor.push(n.x, n.y, n.z);
        tint.push(t, t, t);
      }
    }
    // The rows at the poles close to a point: only one triangle of each of their quads has any area.
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const p0 = j * (nu + 1) + i;
        const p1 = p0 + nu + 1;
        if (j > 0) idx.push(p0, p1, p0 + 1);
        if (j < nv - 1) idx.push(p0 + 1, p1, p1 + 1);
      }
    }
    this.emit(geometry(pos, nor, idx, tint), x, y0 + h / 2, z, hex, rot, 'solid');
  }

  /**
   * A box w by h by d sitting on y0, bent round a vertical axis `radius` in
   * front of it, so its front is hollowed: the back rail of a chair, which
   * curves round whoever sits in it.
   */
  bent(w: number, h: number, d: number, radius: number, x: number, y0: number, z: number, hex: number, rot?: Vec3, seg = 8): void {
    const geo = new THREE.BoxGeometry(w, h, d, seg, 1, 1);
    const p = geo.getAttribute('position');
    const n = geo.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      const th = p.getX(i) / radius;
      const r = radius - p.getZ(i);
      const s = Math.sin(th);
      const c = Math.cos(th);
      p.setXYZ(i, r * s, p.getY(i), radius - r * c);
      const nx = n.getX(i);
      const nz = n.getZ(i);
      n.setXYZ(i, nx * c - nz * s, n.getY(i), nx * s + nz * c);
    }
    this.emit(geo, x, y0 + h / 2, z, hex, rot, 'solid');
  }

  /**
   * A leaf, drawn on both faces, growing from its stalk at x, y, z: cupped
   * about the midrib and bowing along its length as `spec` says. The upper
   * face is `hex` with a paler midrib; the underside is `back`, as leaves
   * are paler beneath.
   */
  leaf(x: number, y: number, z: number, spec: LeafSpec, hex: number, back = hex): void {
    const k = spec.outline.length;
    if (k < 2) return;
    const curl = spec.curl ?? 0;
    const cup = spec.cup ?? 0;
    const roll = spec.roll ?? 0;
    const sy = Math.sin(spec.yaw);
    const cy = Math.cos(spec.yaw);
    const flat = new THREE.Vector3(cy, 0, -sy);
    const dir = new THREE.Vector3();
    const up = new THREE.Vector3();
    const side = new THREE.Vector3();
    const p = new THREE.Vector3();
    const step = spec.len / (k - 1);
    const pitchAt = (t: number) => spec.pitch - curl * t * t;
    const top = col(hex);
    const under = col(back);
    const pos: number[] = [];
    const tint: number[] = [];
    // Upper face first, then the underside a hair below it.
    const lower: number[] = [];
    const lowerTint: number[] = [];
    for (let i = 0; i < k; i++) {
      const t = i / (k - 1);
      if (i > 0) {
        // Each step runs along the direction halfway through it, so the midrib is a smooth arc.
        const pm = pitchAt((i - 0.5) / (k - 1));
        p.x += Math.cos(pm) * sy * step;
        p.y += Math.sin(pm) * step;
        p.z += Math.cos(pm) * cy * step;
      }
      const pi = pitchAt(t);
      dir.set(Math.cos(pi) * sy, Math.sin(pi), Math.cos(pi) * cy);
      up.crossVectors(dir, flat);
      side.copy(flat).multiplyScalar(Math.cos(roll)).addScaledVector(up, Math.sin(roll));
      up.crossVectors(dir, side);
      const hw = (spec.outline[i] * spec.width) / 2;
      // Darker toward the stalk, the way a leaf is shaded where it meets the plant.
      const shade = 0.78 + 0.22 * smooth01(0, 0.4, t);
      for (const a of [-1, 0, 1]) {
        const lift = Math.abs(a) * hw * cup;
        const vx = p.x + side.x * a * hw + up.x * lift;
        const vy = p.y + side.y * a * hw + up.y * lift;
        const vz = p.z + side.z * a * hw + up.z * lift;
        pos.push(vx, vy, vz);
        lower.push(vx - up.x * LEAF_GAP, vy - up.y * LEAF_GAP, vz - up.z * LEAF_GAP);
        const vein = a === 0 ? 1.22 : 0.94;
        tint.push(top.r * shade * vein, top.g * shade * vein, top.b * shade * vein);
        lowerTint.push(under.r * shade, under.g * shade, under.b * shade);
      }
    }
    const idx: number[] = [];
    const off = k * 3;
    for (let i = 0; i < k - 1; i++) {
      // Where the outline closes to a point, at the tip or the stalk, half of each quad has no area.
      const open0 = spec.outline[i] > 0;
      const open1 = spec.outline[i + 1] > 0;
      for (let c = 0; c < 2; c++) {
        const v00 = i * 3 + c;
        const v10 = v00 + 3;
        const v01 = v00 + 1;
        const v11 = v10 + 1;
        if (open0) idx.push(v00, v10, v01, off + v00, off + v01, off + v10);
        if (open1) idx.push(v01, v10, v11, off + v01, off + v11, off + v10);
      }
    }
    const geo = geometry(pos.concat(lower), null, idx, tint.concat(lowerTint));
    this.tmp.makeTranslation(x, y, z);
    this.put(geo, this.tmp, 0xffffff, 'solid');
  }
}

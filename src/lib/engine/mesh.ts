import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { col } from './materials';

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
    const base = this.pos.length / 3;
    this.nm.getNormalMatrix(m);
    for (let i = 0; i < p.count; i++) {
      this.v.fromBufferAttribute(p, i).applyMatrix4(m);
      this.pos.push(this.v.x, this.v.y, this.v.z);
      this.v.fromBufferAttribute(n, i).applyMatrix3(this.nm).normalize();
      this.nor.push(this.v.x, this.v.y, this.v.z);
      this.rgb.push(color.r, color.g, color.b);
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

  private emit(geo: THREE.BufferGeometry, x: number, y: number, z: number, hex: number, rot: [number, number, number] | undefined, to: Target): void {
    if (rot) this.tmp.makeRotationFromEuler(this.e.set(rot[0], rot[1], rot[2]));
    else this.tmp.identity();
    this.tmp.setPosition(x, y, z);
    const m = this.top.clone().multiply(this.tmp);
    this[to].add(geo, m, col(hex), this.pivot, this.delay, this.wall);
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
}

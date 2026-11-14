import * as THREE from 'three';
import type { Facade } from '../data/types';
import { mainFacade } from '../plan/facing';
import { centroid } from '../plan/geometry';
import type { Plan } from '../plan/types';
import { floorY } from './site';
import { clamp } from './tween';

/**
 * Standing the flat in its block. The flat never moves: plan-up is the
 * world's -Z and the compass ring is turned by the plan's bearing. So the
 * site model is put in the frame around the flat instead, turned by the same
 * bearing (its true north then agrees with the compass, and the sun falls on
 * block and flat from one direction) and moved so that the chosen point of
 * the chosen facade, at the chosen storey, lands on the flat's window side.
 */

/** Where the flat is in its block. */
export interface Unit {
  /** Storey of the flat, 1 being the ground storey. */
  storey: number;
  /** The side of the block the flat's main windows look out of, from `facades(block.footprint)`. */
  facade: Facade;
  /** How far along that side the flat is, 0 at its `a` end to 1 at its `b` end. */
  along: number;
}

export interface Placement {
  /** Turn of the site frame about +Y, radians: the bearing of plan-up, the turn of the compass ring. */
  yaw: number;
  /** Where the site frame's origin, the block's centroid on the ground, lands in the world. */
  offset: THREE.Vector3;
  /** Where the middle of the flat's window side ended up along the facade, 0 to 1, once kept clear of its ends. */
  along: number;
  /** The middle of the outer face of the flat's window side on the floor, and the way it looks out, in the world. */
  window: { point: THREE.Vector3; normal: THREE.Vector3 } | null;
}

const DEG = Math.PI / 180;

/** A ground direction of the site frame (x east, y north) as the world sees it once turned. */
export function facadeNormal(bearing: number, yaw: number): THREE.Vector3 {
  return new THREE.Vector3(Math.sin(bearing * DEG), 0, -Math.cos(bearing * DEG)).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
}

/**
 * The site frame's turn and offset for a flat drawn with `toWorld` and turned
 * to `bearing`. With no unit the block simply stands round the origin. The
 * window side lines up exactly with the facade when `bearing` is
 * `northForFacing(plan, unit.facade.bearing)`, which the caller sets.
 */
export function placeSite(plan: Plan, bearing: number, unit: Unit | null, toWorld: (x: number, y: number) => [number, number]): Placement {
  const yaw = bearing * DEG;
  if (!unit) return { yaw, offset: new THREE.Vector3(), along: 0.5, window: null };
  const f = unit.facade;
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3(f.b[0] - f.a[0], 0, -(f.b[1] - f.a[1])).normalize().applyAxisAngle(up, yaw);

  // The outer face of the flat's window side, at the middle of that side.
  const main = mainFacade(plan);
  let point: THREE.Vector3;
  let normal: THREE.Vector3;
  if (main) {
    const half = Math.max(0, ...main.walls.map((id) => plan.walls.find((w) => w.id === id)?.t ?? 0)) / 2;
    const [x, z] = toWorld((main.a[0] + main.b[0]) / 2 + main.out[0] * half, (main.a[1] + main.b[1]) / 2 + main.out[1] * half);
    point = new THREE.Vector3(x, 0, z);
    normal = new THREE.Vector3(main.out[0], 0, main.out[1]);
  } else {
    // No outside window to go by: the flat's middle, brought out to its face on the facade's side.
    normal = facadeNormal(f.bearing, yaw);
    const [cx, cz] = toWorld(...centroid(plan.outline));
    let reach = 0;
    for (const [x, y] of plan.outline) {
      const [wx, wz] = toWorld(x, y);
      reach = Math.max(reach, (wx - cx) * normal.x + (wz - cz) * normal.z);
    }
    point = new THREE.Vector3(cx + normal.x * reach, 0, cz + normal.z * reach);
  }

  // Keep the whole flat on the facade where it fits, however near an end the tap was.
  let lo = Infinity;
  let hi = -Infinity;
  for (const [x, y] of plan.outline) {
    const [wx, wz] = toWorld(x, y);
    const s = (wx - point.x) * dir.x + (wz - point.z) * dir.z;
    lo = Math.min(lo, s);
    hi = Math.max(hi, s);
  }
  const s = hi - lo <= f.length ? clamp(clamp(unit.along, 0, 1) * f.length, -lo, f.length - hi) : f.length / 2 - (lo + hi) / 2;
  const k = s / f.length;
  const at = new THREE.Vector3(f.a[0] + (f.b[0] - f.a[0]) * k, floorY(unit.storey), -(f.a[1] + (f.b[1] - f.a[1]) * k)).applyAxisAngle(up, yaw);
  return { yaw, offset: point.clone().sub(at), along: k, window: { point, normal } };
}

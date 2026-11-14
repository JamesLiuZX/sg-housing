import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { facadeFacing, facades } from '../data/facades';
import type { Ring } from '../data/types';
import { mainFacade, northForFacing } from '../plan/facing';
import { boundsOf } from '../plan/geometry';
import { mirror } from '../plan/mirror';
import { templates } from '../plan/templates';
import type { Plan } from '../plan/types';
import { windowAspects } from '../sg/solar';
import { facadeNormal, placeSite } from './placement';
import { floorY } from './site';

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);

/** The flat's own frame, exactly as the scene builder draws it. */
function toWorldOf(plan: Plan): (x: number, y: number) => [number, number] {
  const b = boundsOf(plan);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return (x, y) => [(x - cx) / 1000, (y - cy) / 1000];
}

/** A 64 by 16 m slab block, counter-clockwise, whose first long side looks out on `bearing`. */
function slab(bearing: number): Ring {
  const corners: [number, number][] = [
    [-32, 8],
    [-32, -8],
    [32, -8],
    [32, 8]
  ];
  // Unturned, the side from (-32,-8) to (32,-8) looks south (180°); turn it clockwise to the bearing.
  const a = -(bearing - 180) * DEG;
  return corners.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);
}

/** A point of the site frame (x east, y north, metres; height up) in the world, as the viewer places the site. */
function toWorldSite(p: [number, number], height: number, yaw: number, offset: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(p[0], height, -p[1]).applyAxisAngle(UP, yaw).add(offset);
}

const plans: Plan[] = templates.flatMap((t) => [t.plan, mirror(t.plan)]);

describe('standing the flat in its block', () => {
  for (const plan of plans)
    for (const bearing of [0, 37.5, 90, 181, 250.3, 333]) {
      it(`${plan.id} looking out on ${bearing}°`, () => {
        const list = facades(slab(bearing));
        const facade = facadeFacing(list, bearing)!;
        expect(Math.abs(facade.bearing - bearing) % 360).toBeLessThan(1e-6);
        const north = northForFacing(plan, facade.bearing);
        const storey = 17;
        const p = placeSite(plan, north, { storey, facade, along: 0.3 }, toWorldOf(plan));
        const win = p.window!;

        // The compass: the plan's own windows now report the facade's bearing.
        const living = mainFacade({ ...plan, north })!;
        expect(Math.abs(((living.bearing - facade.bearing + 540) % 360) - 180)).toBeLessThan(1e-6);
        const aspects = windowAspects({ ...plan, north }, north).filter((w) => Math.abs(((w.bearing - facade.bearing + 540) % 360) - 180) < 1e-6);
        expect(aspects.length).toBeGreaterThan(0);

        // The facade's outward normal, as the turned site frame carries it into the world, is the window's normal.
        const n = facadeNormal(facade.bearing, p.yaw);
        expect(n.dot(win.normal)).toBeGreaterThan(1 - 1e-9);
        // And the compass ring, turned by the same bearing, points the same way for that bearing.
        const ring = new THREE.Vector3(Math.sin(facade.bearing * DEG), 0, -Math.cos(facade.bearing * DEG)).applyAxisAngle(UP, north * DEG);
        expect(ring.distanceTo(n)).toBeLessThan(1e-9);

        // The window's outer face lies on the facade's line, on the storey's floor, at the tapped point.
        const a = toWorldSite(facade.a, floorY(storey), p.yaw, p.offset);
        const b = toWorldSite(facade.b, floorY(storey), p.yaw, p.offset);
        const ab = b.clone().sub(a);
        const rel = win.point.clone().sub(a);
        const along = rel.dot(ab) / ab.lengthSq();
        expect(rel.clone().sub(ab.clone().multiplyScalar(along)).length()).toBeLessThan(1e-9);
        expect(Math.abs(a.y)).toBeLessThan(1e-9);
        expect(Math.abs(along - p.along)).toBeLessThan(1e-9);
        expect(p.along).toBeCloseTo(0.3, 9);

        // A sun low on the facade's bearing shines square onto the windows.
        const sun = new THREE.Vector3(Math.sin(facade.bearing * DEG), 0, -Math.cos(facade.bearing * DEG)).applyAxisAngle(UP, north * DEG);
        expect(sun.dot(win.normal)).toBeGreaterThan(1 - 1e-9);
      });
    }

  it('keeps the flat on the facade when the tap is at its very end', () => {
    const plan = templates[0].plan;
    const facade = facadeFacing(facades(slab(250)), 250)!;
    const north = northForFacing(plan, facade.bearing);
    const p = placeSite(plan, north, { storey: 5, facade, along: 0 }, toWorldOf(plan));
    const toWorld = toWorldOf(plan);
    const a = toWorldSite(facade.a, floorY(5), p.yaw, p.offset);
    const dir = toWorldSite(facade.b, floorY(5), p.yaw, p.offset).sub(a).normalize();
    for (const [x, y] of plan.outline) {
      const [wx, wz] = toWorld(x, y);
      const s = new THREE.Vector3(wx, 0, wz).sub(a).dot(dir);
      expect(s).toBeGreaterThan(-1e-6);
      expect(s).toBeLessThan(facade.length + 1e-6);
    }
  });
});

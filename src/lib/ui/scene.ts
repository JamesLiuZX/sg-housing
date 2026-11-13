import { Vector3 } from 'three';
import type { Viewer } from '../engine/Viewer';
import { boundsOf, centroid, frameOf } from '../plan/geometry';
import type { Opening, Plan, Pt, Room } from '../plan/types';

export interface ScreenPoint {
  x: number;
  y: number;
  front: boolean;
}

/**
 * Turns plan millimetres into screen pixels, for anything the interface pins to the model.
 *
 * The engine keeps its plan-to-world mapping private, but it publishes one world
 * position per room. A single anchor is enough to recover the offset, which keeps
 * this in step with the engine however it chooses to centre the model.
 */
export class PlanSpace {
  private ox: number;
  private oz: number;
  private v = new Vector3();

  constructor(private viewer: Viewer) {
    const plan = viewer.plan;
    const anchor = viewer.anchors[0];
    const room = anchor && plan.rooms.find((r) => r.id === anchor.id);
    if (anchor && room) {
      const [lx, ly] = labelPoint(room);
      this.ox = lx / 1000 - anchor.pos.x;
      this.oz = ly / 1000 - anchor.pos.z;
    } else {
      const b = boundsOf(plan);
      this.ox = (b.minX + b.maxX) / 2000;
      this.oz = (b.minY + b.maxY) / 2000;
    }
  }

  /** Screen position of a plan point at a height above the floor, in metres. */
  screen(x: number, y: number, height: number, out: ScreenPoint): ScreenPoint {
    this.v.set(x / 1000 - this.ox, height, y / 1000 - this.oz);
    this.viewer.project(this.v, out);
    return out;
  }
}

/** Where a room's label sits on the plan, mm. */
export function labelPoint(room: Room): Pt {
  return room.label ?? centroid(room.poly);
}

/** The middle of an opening, mm. */
export function openingPoint(plan: Plan, o: Opening): Pt | null {
  const wall = plan.walls.find((w) => w.id === o.wall);
  if (!wall) return null;
  const f = frameOf(wall);
  const mid = o.at + o.w / 2;
  return [wall.a[0] + f.dx * mid, wall.a[1] + f.dy * mid];
}

/**
 * Where to stand and what to look at when walking into a room: the label point,
 * facing the room's window if it has one, so the first thing seen is the light.
 */
export function walkTarget(plan: Plan, roomId: string): { at: { x: number; y: number }; lookAt?: { x: number; y: number } } | null {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room) return null;
  const [x, y] = labelPoint(room);
  const win = plan.openings.find((o) => o.type === 'window' && o.room === roomId);
  const p = win ? openingPoint(plan, win) : null;
  return { at: { x, y }, lookAt: p ? { x: p[0], y: p[1] } : undefined };
}

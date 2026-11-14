import type { Viewer } from '../engine/Viewer';
import { centroid, frameOf } from '../plan/geometry';
import type { Opening, Plan, Pt, Room } from '../plan/types';

export interface ScreenPoint {
  x: number;
  y: number;
  front: boolean;
}

/**
 * Turns plan millimetres into screen pixels, for anything the interface pins
 * to the model. The engine does the mapping, through the flat's own group, so
 * a pin stays on its wall however the engine centres, turns or raises the
 * flat (inside the real block, the flat stands on its storey).
 */
export class PlanSpace {
  constructor(private viewer: Viewer) {}

  /** Screen position of a plan point at a height above the floor, in metres. */
  screen(x: number, y: number, height: number, out: ScreenPoint): ScreenPoint {
    this.viewer.projectPlan(x, y, height, out);
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

/** A room's main window: its widest. */
export function mainWindow(plan: Plan, roomId: string): Opening | null {
  let best: Opening | null = null;
  for (const o of plan.openings) if (o.type === 'window' && o.room === roomId && (!best || o.w > best.w)) best = o;
  return best;
}


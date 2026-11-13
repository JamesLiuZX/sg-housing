import type { Lens } from '../engine/Viewer';

/**
 * What the address bar can ask for. These are the seeds of the shared link
 * ("the link is the flat"), and they let a test reach any state without
 * sitting through the opening sequence.
 *
 *   ?skip=1        land on the finished model
 *   ?lens=sun      space | sun | rules
 *   ?m=990         minutes of the day
 *   ?month=5       0 to 11
 *   ?facing=295    bearing of the top of the plan, degrees
 *   ?bare=1        unfurnished
 *   ?wall=p-beds   a wall chosen in the Rules lens
 *   ?walk=living   start inside a room (or ?walk=1 for the front door)
 */
export interface Params {
  skip: boolean;
  lens: Lens | null;
  minutes: number | null;
  month: number | null;
  facing: number | null;
  bare: boolean;
  wall: string | null;
  walk: string | null;
}

const LENSES: readonly Lens[] = ['space', 'sun', 'rules'];

function int(value: string | null, min: number, max: number): number | null {
  if (value === null || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null;
}

export function readParams(search: string = location.search): Params {
  const q = new URLSearchParams(search);
  const lens = q.get('lens') as Lens | null;
  const wall = q.get('wall');
  const walk = q.get('walk');
  return {
    // A link that names a state means "show me that", not "show me the poster".
    skip: q.get('skip') === '1' || !!wall || !!walk,
    lens: wall ? 'rules' : lens && LENSES.includes(lens) ? lens : null,
    minutes: int(q.get('m'), 0, 1440),
    month: int(q.get('month'), 0, 11),
    facing: int(q.get('facing'), 0, 359),
    bare: q.get('bare') === '1',
    wall,
    walk
  };
}

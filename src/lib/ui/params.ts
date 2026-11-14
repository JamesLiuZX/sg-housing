import { cleanPostal } from '../data';
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
 *   ?facing=295    bearing of the top of the plan, degrees (the typical flat)
 *   ?bare=1        unfurnished
 *   ?wall=p-beds   a wall chosen in the Rules lens
 *   ?walk=living   start inside a room (or ?walk=1 for the front door)
 *
 * A place, which opens on the block with these chosen (add ?skip=1 to go
 * straight into the flat):
 *
 *   ?demo=1          the bundled block, 440A Clementi Ave 3, which needs no network
 *   ?postal=121440   a block by postal code
 *   ?storey=25       the storey
 *   ?side=295        bearing of the side the living room faces, degrees
 *   ?type=4          flat type: 2, 3, 4, 5, or e for executive
 *   ?mirror=1        the flat the other way round
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
  demo: boolean;
  postal: string | null;
  storey: number | null;
  side: number | null;
  /** In the resale data's words: "4 ROOM", "EXECUTIVE". */
  type: string | null;
  mirror: boolean;
}

const LENSES: readonly Lens[] = ['space', 'sun', 'rules'];

function int(value: string | null, min: number, max: number): number | null {
  if (value === null || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null;
}

/** "4", "4-room" or "4 ROOM" to "4 ROOM"; "e" or "executive" to "EXECUTIVE". */
function flatType(value: string | null): string | null {
  const v = value?.trim().toUpperCase().replace(/[-_\s]+/g, ' ') ?? '';
  const n = v.match(/^([1-5])( ROOM)?$/);
  if (n) return `${n[1]} ROOM`;
  return v === 'E' || v === 'EXEC' || v === 'EXECUTIVE' ? 'EXECUTIVE' : null;
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
    walk,
    demo: q.get('demo') === '1',
    postal: q.get('postal') ? cleanPostal(q.get('postal')!) : null,
    storey: int(q.get('storey'), 1, 60),
    side: int(q.get('side'), 0, 359),
    type: flatType(q.get('type')),
    mirror: q.get('mirror') === '1'
  };
}

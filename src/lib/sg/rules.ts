import { frameOf, pointInPoly } from '../plan/geometry';
import type { Plan, Wall, WallKind } from '../plan/types';

/**
 * What HDB's renovation rules say about each kind of wall.
 *
 * Written by hand from HDB's published guidelines and kept as data, so a
 * correction never touches interface code. Blk describes the rule and points
 * to the authority. It does not approve anything, which is why every verdict
 * carries the same caveat and at least one official link.
 */

/** Matches the colours the engine paints walls in the Rules lens. */
export type Tone = 'no' | 'shelter' | 'yes' | 'wet';

export interface Source {
  label: string;
  url: string;
}

export interface Verdict {
  tone: Tone;
  /** The kind of wall, in the words used on an HDB floor plan. */
  title: string;
  /** The short answer. */
  chip: string;
  /** One or two sentences of why. */
  why: string;
  sources: Source[];
}

export const CAVEAT = 'Typical for this flat type. Your HDB floor plan and permit decide.';

const HDB_BUILDING_WORKS: Source = {
  label: 'HDB building works guidelines',
  url: 'https://www.hdb.gov.sg/managing-my-home/renovation-and-maintenance/renovation/renovation-guidelines/building-works'
};

const MYNICEHOME: Source = {
  label: 'MyNiceHome, HDB',
  url: 'https://www.mynicehome.gov.sg/hdb-how-to/renovate-your-flat/'
};

const SOURCES = [HDB_BUILDING_WORKS, MYNICEHOME];

/** The rule for bathroom finishes in a new flat. It rides on any wall that bounds a bathroom. */
const THREE_YEARS = 'the bathroom wall and floor finishes cannot be removed for the first 3 years';

const PARTITION_WHY =
  "Non-structural. It can usually be removed or opened once HDB approves a permit, through a contractor listed in HDB's Directory of Renovation Contractors.";

const BY_KIND: Record<Exclude<WallKind, 'parapet'>, Verdict> = {
  external: {
    tone: 'no',
    title: 'External wall',
    chip: 'Cannot be hacked',
    why: 'External walls cannot be hacked. Windows may only be replaced by a BCA-approved window contractor.',
    sources: SOURCES
  },
  structural: {
    tone: 'no',
    title: 'Structural wall',
    chip: 'Cannot be hacked',
    why: 'Reinforced concrete that holds the block up, so it cannot be hacked. Structural walls are the thick lines on the HDB floor plan.',
    sources: SOURCES
  },
  shelter: {
    tone: 'shelter',
    title: 'Household shelter wall',
    chip: 'Cannot be hacked or drilled',
    why: "The shelter's walls, floor and ceiling cannot be hacked or drilled. Its door must stay intact and working.",
    sources: SOURCES
  },
  partition: {
    tone: 'yes',
    title: 'Partition wall',
    chip: 'Can usually go, with an HDB permit',
    why: PARTITION_WHY,
    sources: SOURCES
  }
};

const WET_PARTITION: Verdict = {
  tone: 'wet',
  title: 'Bathroom partition wall',
  chip: 'Permit needed, and a 3-year rule in a new flat',
  why: `${PARTITION_WHY} In a new flat, ${THREE_YEARS}.`,
  sources: SOURCES
};

/** The verdict for a wall, or null for things that are not walls of the flat (parapets). */
export function verdictFor(wall: Wall): Verdict | null {
  if (wall.kind === 'parapet') return null;
  if (wall.kind === 'partition') return wall.wet ? WET_PARTITION : BY_KIND.partition;
  const base = BY_KIND[wall.kind];
  // A solid wall on a bathroom still cannot be hacked; the finishes rule is the extra fact worth saying.
  if (wall.wet && wall.kind !== 'shelter') {
    return { ...base, why: `${base.why} On the bathroom side of a new flat, ${THREE_YEARS}.` };
  }
  return base;
}

/** The key shown under the model. One entry per colour the engine uses. */
export const LEGEND: { tone: Tone; label: string }[] = [
  { tone: 'no', label: 'Cannot be hacked' },
  { tone: 'shelter', label: 'Household shelter' },
  { tone: 'yes', label: 'Can go, with permit' },
  { tone: 'wet', label: 'Bathroom wall' }
];

/** Rooms on each side of a wall, so the verdict can say which wall it is talking about. */
function roomsBeside(plan: Plan, wall: Wall): [string[], string[]] {
  const f = frameOf(wall);
  const sides: [string[], string[]] = [[], []];
  const reach = wall.t / 2 + 250;
  for (const k of [0.12, 0.5, 0.88]) {
    const px = wall.a[0] + f.dx * f.len * k;
    const py = wall.a[1] + f.dy * f.len * k;
    ([1, -1] as const).forEach((sign, i) => {
      const x = px + f.nx * reach * sign;
      const y = py + f.ny * reach * sign;
      const room = plan.rooms.find((r) => pointInPoly(x, y, r.poly));
      if (room && !sides[i].includes(room.name)) sides[i].push(room.name);
    });
  }
  return sides;
}

function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Where a wall is, in terms of the rooms it touches: "Between Bedroom 2 and Bedroom 3". */
export function wallPlace(plan: Plan, wall: Wall): string {
  const [left, right] = roomsBeside(plan, wall);
  if (left.length === 1 && right.length === 1) return `Between ${left[0]} and ${right[0]}`;
  const all = [...left, ...right.filter((n) => !left.includes(n))];
  if (!all.length) return '';
  return all.length > 3 ? `Along ${all.length} rooms` : `Along ${list(all)}`;
}

/** Length of a wall on its centreline, for the label: "3.2 m". */
export function wallLength(wall: Wall): string {
  return `${(frameOf(wall).len / 1000).toFixed(1)} m`;
}

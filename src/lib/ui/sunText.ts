import type { Plan, Room } from '../plan/types';
import { clock, compassPoint, windowAspects, type RoomSun, type Sun } from '../sg/solar';
import { clockRange, joinList } from './format';

/** The sun counts as up once its top edge clears the horizon, the same line sunTimes uses. */
const HORIZON = (-0.833 * Math.PI) / 180;

export function sunIsUp(sun: Sun): boolean {
  return sun.altitude >= HORIZON;
}

/** A room's name as it reads in the middle of a sentence. */
function inSentence(name: string): string {
  const n = name.toLowerCase();
  if (n === 'living') return 'the living room';
  if (n === 'dining') return 'the dining area';
  if (n === 'bath') return 'the common bath';
  if (/^bedroom \d+$/.test(n)) return n;
  return `the ${n}`;
}

const ALL_OF = ['', '', 'both', 'all three', 'all four', 'all five'];

/**
 * One plain sentence about where the sun is landing right now.
 * Bedrooms and bathrooms fold into "all three bedrooms" when every one is lit,
 * because that is how a person would say it.
 */
export function sunSummary(plan: Plan, lit: readonly string[], sun: Sun, rise: number): string {
  if (!sunIsUp(sun)) return `The sun is down. Sunrise is at ${clock(rise)}.`;
  if (!lit.length) return 'No direct sun in any room right now.';

  const isLit = new Set(lit);
  const groups: { rooms: Room[]; noun: string; said: boolean }[] = [
    { rooms: plan.rooms.filter((r) => /bedroom/i.test(r.name)), noun: 'bedrooms', said: false },
    { rooms: plan.rooms.filter((r) => /bath/i.test(r.name)), noun: 'bathrooms', said: false }
  ].filter((g) => g.rooms.length >= 2 && g.rooms.every((r) => isLit.has(r.id)));

  // Living room first: it is the room people ask about.
  const ordered = [...plan.rooms].sort((a, b) => Number(/living/i.test(b.name)) - Number(/living/i.test(a.name)));
  const parts: string[] = [];
  for (const room of ordered) {
    if (!isLit.has(room.id)) continue;
    const group = groups.find((g) => g.rooms.includes(room));
    if (!group) {
      parts.push(inSentence(room.name));
    } else if (!group.said) {
      group.said = true;
      parts.push(`${ALL_OF[group.rooms.length] ?? `all ${group.rooms.length}`} ${group.noun}`);
    }
  }
  return `Direct sun now in ${joinList(parts)}.`;
}

/** What a room's label says in the Sun lens: "Sun 3:40 – 6:50 pm" or "No direct sun". */
export function roomSunLabel(rs: RoomSun | undefined): string {
  if (!rs || !rs.spans.length) return 'No direct sun';
  return `Sun ${rs.spans
    .slice(0, 2)
    .map(([from, to]) => clockRange(from, to))
    .join(', ')}`;
}

export interface Facing {
  /** "Living room" */
  room: string;
  /** Compass bearing the room's window looks out on, whole degrees. */
  deg: number;
  /** "WNW" */
  point: string;
}

/**
 * Which way the living room looks out, given the bearing of the top of the plan.
 * The summary states the bearing it used, so a wrong orientation is easy to spot.
 */
export function facingOf(plan: Plan, bearing: number): Facing {
  const aspects = windowAspects(plan, bearing);
  const nameOf = (id: string) => plan.rooms.find((r) => r.id === id)?.name ?? '';
  const aspect = aspects.find((a) => /living/i.test(nameOf(a.room))) ?? aspects[0];
  const deg = aspect ? Math.round(aspect.bearing) % 360 : Math.round(bearing) % 360;
  const name = aspect ? nameOf(aspect.room) : 'Flat';
  return { room: /^living$/i.test(name) ? 'Living room' : name, deg, point: compassPoint(deg) };
}

/** "WNW · 23° high", for the readout that rides with the sun. */
export function sunReadout(sun: Sun): string {
  if (!sunIsUp(sun)) return 'below the horizon';
  const az = (sun.azimuth * 180) / Math.PI;
  const alt = Math.max(0, Math.round((sun.altitude * 180) / Math.PI));
  return `${compassPoint(az)} · ${alt}° high`;
}

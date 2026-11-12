import { centroid, frameOf, pointInPoly } from '../plan/geometry';
import type { Plan } from '../plan/types';

/** Singapore, near enough for any flat on the island. */
export const SG_LAT = 1.3521;
export const SG_LNG = 103.8198;

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;

export interface Sun {
  /** Radians clockwise from true north. */
  azimuth: number;
  /** Radians above the horizon. */
  altitude: number;
}

/** Position of the sun for an instant in time. Standard low-precision solar maths. */
export function sunPosition(utcMs: number, lat = SG_LAT, lng = SG_LNG): Sun {
  const d = utcMs / DAY_MS - 0.5 + J1970 - J2000;
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(L) * Math.sin(OBLIQUITY));
  const ra = Math.atan2(Math.sin(L) * Math.cos(OBLIQUITY), Math.cos(L));
  const phi = RAD * lat;
  const sidereal = RAD * (280.16 + 360.9856235 * d) + RAD * lng;
  const H = sidereal - ra;
  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const fromSouth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  const azimuth = (fromSouth + Math.PI + 2 * Math.PI) % (2 * Math.PI);
  return { azimuth, altitude };
}

export interface SunDate {
  year: number;
  /** 0 to 11. */
  month: number;
  day: number;
}

/** Singapore keeps UTC+8 all year. */
export function sgInstant(date: SunDate, minutes: number): number {
  return Date.UTC(date.year, date.month, date.day, 0, minutes) - 8 * 3600000;
}

export function sunAt(date: SunDate, minutes: number): Sun {
  return sunPosition(sgInstant(date, minutes));
}

export interface PathPoint extends Sun {
  minutes: number;
}

export function dayPath(date: SunDate, step = 6): PathPoint[] {
  const out: PathPoint[] = [];
  for (let m = 0; m <= 1440; m += step) out.push({ minutes: m, ...sunAt(date, m) });
  return out;
}

export function sunTimes(date: SunDate): { rise: number; set: number; noon: number } {
  let rise = 0;
  let set = 0;
  let noon = 0;
  let best = -Infinity;
  let prev = sunAt(date, 0).altitude;
  const horizon = -0.833 * RAD;
  for (let m = 1; m <= 1440; m++) {
    const alt = sunAt(date, m).altitude;
    if (prev < horizon && alt >= horizon) rise = m;
    if (prev >= horizon && alt < horizon) set = m;
    if (alt > best) {
      best = alt;
      noon = m;
    }
    prev = alt;
  }
  return { rise, set, noon };
}

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function compassPoint(deg: number): string {
  return POINTS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

export function clock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${h < 12 ? 'am' : 'pm'}`;
}

export interface WindowAspect {
  id: string;
  room: string;
  /** Compass bearing the window looks out on, degrees. */
  bearing: number;
  head: number;
}

/** Which way each window faces, given the bearing of the top of the plan. */
export function windowAspects(plan: Plan, north: number): WindowAspect[] {
  const out: WindowAspect[] = [];
  for (const o of plan.openings) {
    if (o.type !== 'window' || !o.room) continue;
    const wall = plan.walls.find((w) => w.id === o.wall);
    const room = plan.rooms.find((r) => r.id === o.room);
    if (!wall || !room) continue;
    const f = frameOf(wall);
    const mid = o.at + o.w / 2;
    const px = wall.a[0] + f.dx * mid;
    const py = wall.a[1] + f.dy * mid;
    // Outward is whichever side of the wall is not the room.
    const inward = pointInPoly(px + f.nx * 400, py + f.ny * 400, room.poly) ? 1 : -1;
    const ox = -f.nx * inward;
    const oy = -f.ny * inward;
    // Plan-up is bearing `north`; turn the outward vector into a bearing.
    const turn = Math.atan2(ox, -oy) / RAD;
    out.push({ id: o.id, room: o.room, bearing: (north + turn + 360) % 360, head: o.head ?? plan.height });
  }
  return out;
}

/**
 * How far direct sun reaches across the floor from a window, in mm.
 * Zero when the sun is behind the wall or below the horizon.
 */
export function sunReach(win: WindowAspect, sun: Sun): number {
  if (sun.altitude <= 0.02) return 0;
  const off = sun.azimuth - win.bearing * RAD;
  const facing = Math.cos(off);
  if (facing <= 0.05) return 0;
  // Altitude of the sun as seen in the vertical plane through the window normal.
  const profile = Math.atan2(Math.tan(sun.altitude), facing);
  return win.head / Math.tan(profile);
}

export interface RoomSun {
  room: string;
  /** Minutes of the day with meaningful direct sun, as [from, to] spans. */
  spans: [number, number][];
  /** Deepest reach across the floor during the day, mm. */
  reach: number;
}

/** A patch shallower than this is a strip under the sill, not sun in the room. */
const MEANINGFUL_REACH = 900;

export function roomSunForDay(plan: Plan, north: number, date: SunDate, step = 5): RoomSun[] {
  const aspects = windowAspects(plan, north);
  const rooms = new Map<string, RoomSun>();
  for (const a of aspects) if (!rooms.has(a.room)) rooms.set(a.room, { room: a.room, spans: [], reach: 0 });
  const open = new Map<string, number | null>();
  for (let m = 0; m <= 1440; m += step) {
    const sun = sunAt(date, m);
    for (const [id, rs] of rooms) {
      let reach = 0;
      for (const a of aspects) if (a.room === id) reach = Math.max(reach, sunReach(a, sun));
      const lit = reach >= MEANINGFUL_REACH;
      rs.reach = Math.max(rs.reach, Math.min(reach, 12000));
      const start = open.get(id) ?? null;
      if (lit && start === null) open.set(id, m);
      if (!lit && start !== null) {
        rs.spans.push([start, m]);
        open.set(id, null);
      }
    }
  }
  return [...rooms.values()];
}

/** Rooms with direct sun at this moment. */
export function roomsLitNow(plan: Plan, north: number, sun: Sun): string[] {
  const lit = new Set<string>();
  for (const a of windowAspects(plan, north)) if (sunReach(a, sun) >= MEANINGFUL_REACH) lit.add(a.room);
  return [...lit];
}

export function roomCentre(plan: Plan, id: string) {
  const r = plan.rooms.find((x) => x.id === id);
  return r ? (r.label ?? centroid(r.poly)) : null;
}

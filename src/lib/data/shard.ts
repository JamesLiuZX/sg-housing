/**
 * Reading the block index files that scripts/build-blocks.mjs writes to
 * public/blocks/. The format is described at the top of that script; this is
 * its exact inverse, and the tests check the two against each other.
 */

import type { Bounds, Footprint, Part, Ring, XY } from './types';

export const SHARD_VERSION = 1;

/** One row of a shard: postal code, block number, then encoded rings. */
export type ShardRow = [postal: string, blk: string, ...rings: string[]];

export interface Shard {
  v: number;
  sector: string;
  /** [lat, lng] of the frame all of this file's coordinates are measured from. */
  origin: [lat: number, lng: number];
  /** Metres per coordinate step. */
  unit: number;
  blocks: ShardRow[];
}

export interface ManifestSector {
  blocks: number;
  bytes: number;
  /** [south, west, north, east], degrees. */
  bbox: [number, number, number, number];
}

export interface Manifest {
  v: number;
  /** ISO time the index was built. */
  built: string;
  blocks: number;
  sectors: Record<string, ManifestSector>;
  sources: { id: string; name: string; lastUpdatedAt: string | null; url: string }[];
  licence: string;
  licenceUrl: string;
  /** The notice the Singapore Open Data Licence asks for. Show it on the method page. */
  attribution: string;
}

// WGS84, as in the build script.
const WGS84_A = 6378137;
const WGS84_E2 = 0.00669437999014;
const RAD = Math.PI / 180;

export interface LocalFrame {
  /** Latitude and longitude to metres east and north of the frame's origin. */
  toLocal(lat: number, lng: number): XY;
  toLatLng(x: number, y: number): [lat: number, lng: number];
}

/**
 * A local tangent-plane frame using the ellipsoid's radii of curvature at the
 * origin. True to scale at the origin and within a few parts per million
 * across a postal sector; north is +y everywhere in it.
 */
export function localFrame(lat0: number, lng0: number): LocalFrame {
  const s = Math.sin(lat0 * RAD);
  const w = 1 - WGS84_E2 * s * s;
  const meridional = (WGS84_A * (1 - WGS84_E2)) / (w * Math.sqrt(w));
  const primeVertical = WGS84_A / Math.sqrt(w);
  const kx = primeVertical * Math.cos(lat0 * RAD) * RAD;
  const ky = meridional * RAD;
  return {
    toLocal: (lat, lng) => [(lng - lng0) * kx, (lat - lat0) * ky],
    toLatLng: (x, y) => [lat0 + y / ky, lng0 + x / kx]
  };
}

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';
const DIGIT = new Int8Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) DIGIT[ALPHABET.charCodeAt(i)] = i;

/**
 * One encoded ring to points in metres from the shard origin.
 * Returns null for anything malformed rather than guessing.
 */
export function decodeRing(text: string, unit: number): Ring | null {
  const ints: number[] = [];
  let z = 0;
  let scale = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const d = c < 128 ? DIGIT[c] : -1;
    if (d < 0) return null;
    if (d >= 32) {
      z += (d - 32) * scale;
      scale *= 32;
    } else {
      z += d * scale;
      // Undo the zigzag: 0, 1, 2, 3, ... back to 0, -1, 1, -2, ...
      ints.push(z % 2 === 0 ? z / 2 : -(z + 1) / 2);
      z = 0;
      scale = 1;
    }
  }
  if (scale !== 1 || ints.length % 2 !== 0 || ints.length < 6) return null;
  const ring: Ring = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < ints.length; i += 2) {
    x += ints[i];
    y += ints[i + 1];
    ring.push([x * unit, y * unit]);
  }
  return ring;
}

export function signedArea(ring: Ring): number {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % n];
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
}

/**
 * Groups decoded rings into parts by orientation: each counter-clockwise ring
 * starts a part and the clockwise rings after it are its holes.
 */
export function groupParts(rings: Ring[]): Part[] {
  const parts: Part[] = [];
  for (const r of rings) {
    if (signedArea(r) > 0 || !parts.length) parts.push({ outer: r, holes: [] });
    else parts[parts.length - 1].holes.push(r);
  }
  return parts;
}

/** Area-weighted centroid of a set of parts, holes subtracted. */
export function centroidOf(parts: Part[]): XY {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (const p of parts)
    for (const r of [p.outer, ...p.holes]) {
      for (let i = 0, n = r.length; i < n; i++) {
        const [x0, y0] = r[i];
        const [x1, y1] = r[(i + 1) % n];
        const k = x0 * y1 - x1 * y0;
        cx += (x0 + x1) * k;
        cy += (y0 + y1) * k;
        a += k;
      }
    }
  // Holes run clockwise, so their negative area is subtracted without special handling.
  return a === 0 ? (parts[0]?.outer[0] ?? [0, 0]) : [cx / (3 * a), cy / (3 * a)];
}

export function boundsOf(parts: Part[]): Bounds {
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of parts)
    for (const [x, y] of p.outer) {
      if (x < b.minX) b.minX = x;
      if (y < b.minY) b.minY = y;
      if (x > b.maxX) b.maxX = x;
      if (y > b.maxY) b.maxY = y;
    }
  return b;
}

/** Moves every point of a set of parts by (-dx, -dy): puts them in a frame whose origin is (dx, dy). */
export function shiftParts(parts: Part[], dx: number, dy: number): Part[] {
  const move = (r: Ring): Ring => r.map(([x, y]) => [x - dx, y - dy]);
  return parts.map((p) => ({ outer: move(p.outer), holes: p.holes.map(move) }));
}

export function footprintOf(parts: Part[]): Footprint {
  let area = 0;
  for (const p of parts) {
    area += signedArea(p.outer);
    for (const h of p.holes) area += signedArea(h);
  }
  return { parts, area, bounds: boundsOf(parts) };
}

/** A decoded row: parts in metres from the shard origin. */
export interface DecodedRow {
  postal: string;
  blk: string;
  parts: Part[];
}

export function decodeRow(row: ShardRow, unit: number): DecodedRow | null {
  const [postal, blk, ...encoded] = row;
  const rings: Ring[] = [];
  for (const e of encoded) {
    const r = decodeRing(e, unit);
    if (r) rings.push(r);
  }
  if (!rings.length) return null;
  return { postal, blk, parts: groupParts(rings) };
}

/** Checks that a fetched body really is a shard this code can read. */
export function isShard(x: unknown): x is Shard {
  if (typeof x !== 'object' || x === null) return false;
  const s = x as Partial<Shard>;
  return (
    s.v === SHARD_VERSION &&
    typeof s.sector === 'string' &&
    Array.isArray(s.origin) &&
    s.origin.length === 2 &&
    s.origin.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    typeof s.unit === 'number' &&
    s.unit > 0 &&
    Array.isArray(s.blocks)
  );
}

export function isManifest(x: unknown): x is Manifest {
  if (typeof x !== 'object' || x === null) return false;
  const m = x as Partial<Manifest>;
  return m.v === SHARD_VERSION && typeof m.sectors === 'object' && m.sectors !== null && typeof m.attribution === 'string';
}

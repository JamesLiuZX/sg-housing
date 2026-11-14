/**
 * The block index: a postal code in, the block's footprint out, positioned in
 * its own frame (metres east and north of its centroid) with its latitude and
 * longitude, plus the blocks around it for shadows.
 *
 * The index is static (public/blocks/, built by `npm run blocks`), one file
 * per two-digit postal sector, fetched on demand and kept in memory for the
 * visit. The browser's HTTP cache does the rest.
 */

import { getJson, untilAborted, unavailable } from './http';
import {
  centroidOf,
  decodeRow,
  footprintOf,
  isManifest,
  isShard,
  localFrame,
  shiftParts,
  type DecodedRow,
  type LocalFrame,
  type Manifest,
  type Shard
} from './shard';
import type { Block, Bounds, Neighbour, Part, Result, XY } from './types';

export interface LoadBlockOptions {
  signal?: AbortSignal;
  /** Neighbours whose footprints come within this many metres are returned. Default 150; 0 for none. */
  radius?: number;
}

let base: string | null = null;

/**
 * Where the index lives, if not `<BASE_URL>blocks/`. For tests, or a CDN later.
 * Must end with a slash.
 */
export function configureBlocks(options: { baseUrl?: string | null }): void {
  base = options.baseUrl ?? null;
  sectors.clear();
  manifestRequest = null;
}

function indexUrl(file: string): string {
  return `${base ?? `${import.meta.env.BASE_URL}blocks/`}${file}`;
}

interface LoadedSector {
  shard: Shard;
  frame: LocalFrame;
  rows: DecodedRow[];
  bounds: Bounds[];
}

const sectors = new Map<string, Promise<Result<LoadedSector>>>();
let manifestRequest: Promise<Result<Manifest>> | null = null;

function ringBounds(parts: Part[]): Bounds {
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of parts)
    for (const [x, y] of p.outer) {
      b.minX = Math.min(b.minX, x);
      b.minY = Math.min(b.minY, y);
      b.maxX = Math.max(b.maxX, x);
      b.maxY = Math.max(b.maxY, y);
    }
  return b;
}

/** The sector file, fetched once per visit and shared by every caller. Failures are not kept, so a retry can succeed. */
function loadSector(sector: string): Promise<Result<LoadedSector>> {
  let p = sectors.get(sector);
  if (!p) {
    p = getJson(indexUrl(`${sector}.json`), { service: 'blocks', sameOrigin: true, retries: 1 }).then((r): Result<LoadedSector> => {
      if (!r.ok) return r.result;
      if (!isShard(r.body)) return unavailable('blocks', 'bad-response', `${sector}.json is not a version 1 shard`);
      const shard = r.body;
      const rows: DecodedRow[] = [];
      for (const row of shard.blocks) {
        const d = Array.isArray(row) ? decodeRow(row, shard.unit) : null;
        if (d) rows.push(d);
      }
      return {
        status: 'ok',
        data: { shard, frame: localFrame(shard.origin[0], shard.origin[1]), rows, bounds: rows.map((d) => ringBounds(d.parts)) },
        fetchedAt: Date.now()
      };
    });
    sectors.set(sector, p);
    void p.then((r) => {
      if (r.status !== 'ok') sectors.delete(sector);
    });
  }
  return p;
}

/**
 * The index's manifest: build date, sources, and the attribution notice the
 * Singapore Open Data Licence asks for. `loadBlock` also uses it to tell a
 * postal code with no HDB blocks from an index that failed to load.
 */
export function loadBlockIndexInfo(signal?: AbortSignal): Promise<Result<Manifest>> {
  if (!manifestRequest) {
    manifestRequest = getJson(indexUrl('manifest.json'), { service: 'blocks', sameOrigin: true, retries: 1 }).then((r): Result<Manifest> => {
      if (!r.ok) return r.result;
      if (!isManifest(r.body)) return unavailable('blocks', 'bad-response', 'manifest.json is not a version 1 manifest');
      return { status: 'ok', data: r.body, fetchedAt: Date.now() };
    });
    const mine = manifestRequest;
    void mine.then((r) => {
      if (r.status !== 'ok' && manifestRequest === mine) manifestRequest = null;
    });
  }
  return untilAborted(manifestRequest, signal).then((r) => r ?? { status: 'aborted' });
}

/** Six digits, from "121440", "S121440", "Singapore 121440" or a number that lost its leading zero. */
export function cleanPostal(postal: string | number): string | null {
  const s = String(postal).trim();
  if (/^\d{5,6}$/.test(s)) return s.padStart(6, '0');
  const m = /(?:^|\D)(\d{6})(?:\D|$)/.exec(s);
  return m ? m[1] : null;
}

function distToSegment(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Shortest distance between two footprints' outlines, metres. Footprints never overlap, so vertex-to-edge both ways is exact. */
export function footprintGap(p: Part[], q: Part[]): number {
  let best = Infinity;
  for (const a of p)
    for (const b of q) {
      for (const [from, to] of [
        [a.outer, b.outer],
        [b.outer, a.outer]
      ]) {
        for (const v of from)
          for (let i = 0, n = to.length; i < n; i++) {
            const d = distToSegment(v, to[i], to[(i + 1) % n]);
            if (d < best) best = d;
          }
      }
    }
  return best;
}

function boundsGap(a: Bounds, b: Bounds): number {
  const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX);
  const dy = Math.max(0, a.minY - b.maxY, b.minY - a.maxY);
  return Math.hypot(dx, dy);
}

/**
 * Looks a block up by postal code.
 *
 * - `ok`: an HDB block, with footprint and neighbours.
 * - `not-found`: the index loaded and has no HDB block at this postal code
 *   (a condo, a shop, a typo), or the code is not a postal code at all.
 * - `unavailable`: the index could not be loaded (offline, preview, server).
 */
export async function loadBlock(postal: string, options: LoadBlockOptions = {}): Promise<Result<Block>> {
  const { signal, radius = 150 } = options;
  const code = cleanPostal(postal);
  if (!code) return { status: 'not-found' };
  if (signal?.aborted) return { status: 'aborted' };
  const sector = code.slice(0, 2);

  // Ask for the manifest alongside the shard, not after it: it settles whether
  // a failed shard means "no HDB blocks in this sector" or "something broke",
  // which a status code cannot (a dev server or captive portal answers 200 with HTML).
  const manifest = loadBlockIndexInfo();
  const loaded = await untilAborted(loadSector(sector), signal);
  if (!loaded) return { status: 'aborted' };
  if (loaded.status !== 'ok') {
    const m = await untilAborted(manifest, signal);
    if (!m) return { status: 'aborted' };
    if (m.status === 'ok' && !m.data.sectors[sector]) return { status: 'not-found' };
    return loaded.status === 'unavailable' ? loaded : unavailable('blocks', 'server');
  }

  const { rows, bounds, frame } = loaded.data;
  const i = rows.findIndex((r) => r.postal === code);
  if (i < 0) return { status: 'not-found' };
  const row = rows[i];

  const [cx, cy] = centroidOf(row.parts);
  const [lat, lng] = frame.toLatLng(cx, cy);
  const neighbours: Neighbour[] = [];
  if (radius > 0) {
    const mine = bounds[i];
    for (let j = 0; j < rows.length; j++) {
      if (j === i || boundsGap(mine, bounds[j]) > radius) continue;
      const gap = footprintGap(row.parts, rows[j].parts);
      if (gap <= radius) {
        neighbours.push({ postal: rows[j].postal, blk: rows[j].blk, footprint: footprintOf(shiftParts(rows[j].parts, cx, cy)), gap });
      }
    }
    neighbours.sort((a, b) => a.gap - b.gap);
  }

  return {
    status: 'ok',
    data: { postal: row.postal, blk: row.blk, lat, lng, footprint: footprintOf(shiftParts(row.parts, cx, cy)), neighbours },
    fetchedAt: loaded.fetchedAt
  };
}

/**
 * Where a latitude and longitude falls in a block's frame, metres east and
 * north of its centroid. For placing OneMap's point, or anything else with
 * coordinates, on the footprint drawing.
 */
export function toBlockFrame(block: Pick<Block, 'lat' | 'lng'>, lat: number, lng: number): XY {
  return localFrame(block.lat, block.lng).toLocal(lat, lng);
}

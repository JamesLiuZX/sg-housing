#!/usr/bin/env node
/**
 * Builds Blk's block index: HDB's building footprints, simplified and packed
 * into one small JSON file per two-digit postal sector, so the app can turn a
 * postal code into a footprint with one static fetch of a few kilobytes.
 *
 *   npm run blocks                      download the dataset and rebuild public/blocks/
 *   npm run blocks -- --input f.geojson  rebuild from a file already downloaded
 *   npm run blocks -- --out some/dir     write somewhere else
 *
 * Node 22, no dependencies. The pure functions are exported so the tests can
 * check that what this script packs is exactly what src/lib/data/shard.ts
 * unpacks; `main()` only runs when the file is executed directly.
 *
 * Shard format (version 1), public/blocks/<NN>.json:
 *
 *   { "v": 1, "sector": "12", "origin": [lat, lng], "unit": 0.1,
 *     "blocks": [["121440", "440A", "<ring>", "<ring>", ...], ...] }
 *
 * - `origin` is the latitude and longitude of a local east-north frame for the
 *   whole file; `unit` is metres per coordinate step (decimetres).
 * - Each block row is postal code, block number, then rings. Rings come part
 *   by part: an outer ring (counter-clockwise, seen from above with north up)
 *   followed by that part's holes (clockwise). The block's largest part is first.
 * - A ring is a string. Its vertices are integers in `unit`s east and north of
 *   `origin`: the first vertex as is, every later one as the difference from
 *   the previous one, x then y. Each integer is zigzag-encoded (0, -1, 1, -2,
 *   ... become 0, 1, 2, 3, ...) and written five bits at a time, least
 *   significant first, as characters of ALPHABET: indices 0 to 31 end a
 *   number, 32 to 63 mean "more to come". This is Google's polyline idea with
 *   an alphabet that never needs escaping in JSON or URLs. It is about half the
 *   size of the same integers written as JSON arrays.
 * - Rings are not closed: the first vertex is not repeated at the end.
 */

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

export const SHARD_VERSION = 1;
export const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';

/** data.gov.sg "HDB Existing Building": one footprint polygon per block. */
export const FOOTPRINT_DATASET = 'd_16b157c52ed637edd6ba1232e026258d';

export const DEFAULTS = Object.freeze({
  /** Douglas-Peucker tolerance, metres. Keeps every step a person would notice from the street. */
  tolerance: 0.3,
  /** Metres per stored coordinate step. */
  unit: 0.1,
  /** Holes smaller than this (m²) are air wells and light wells, not courtyards; they are dropped. */
  minHole: 50,
  /** Separate parts smaller than this (m²) are bin centres and lift shafts beside the block; dropped. */
  minPart: 25
});

// WGS84. The frame below must match src/lib/data/shard.ts exactly.
const WGS84_A = 6378137;
const WGS84_E2 = 0.00669437999014;
const RAD = Math.PI / 180;

/**
 * A local tangent-plane frame: metres east (x) and north (y) of an origin.
 * The scale factors are the ellipsoid's radii of curvature at the origin, so
 * distances and bearings are true at the origin and within a few parts per
 * million anywhere in a postal sector. A plain sphere would stretch
 * north-south distances against east-west ones by 0.7% at this latitude,
 * enough to turn a facade by a fifth of a degree.
 */
export function localFrame(lat0, lng0) {
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

export function signedArea(ring) {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % n];
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
}

function distToSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Douglas-Peucker on an open chain, iterative so a long ring cannot overflow the stack. */
function simplifyChain(pts, tol) {
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let worst = -1;
    let worstDist = tol;
    for (let k = i + 1; k < j; k++) {
      const d = distToSegment(pts[k], pts[i], pts[j]);
      if (d > worstDist) {
        worstDist = d;
        worst = k;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([i, worst], [worst, j]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}

/**
 * Douglas-Peucker on a closed ring. A ring has no natural ends, so it is split
 * at two vertices that are certainly corners: the one farthest from the
 * centre, and the one farthest from that. Both halves are then simplified.
 */
export function simplifyRing(ring, tol) {
  const n = ring.length;
  if (n <= 3 || tol <= 0) return ring.slice();
  let cx = 0;
  let cy = 0;
  for (const [x, y] of ring) {
    cx += x;
    cy += y;
  }
  cx /= n;
  cy /= n;
  const farthest = (from) => {
    let best = 0;
    let bestDist = -1;
    ring.forEach((p, i) => {
      const d = Math.hypot(p[0] - from[0], p[1] - from[1]);
      if (d > bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  };
  const a = farthest([cx, cy]);
  const b = farthest(ring[a]);
  const turned = ring.slice(a).concat(ring.slice(0, a));
  const split = (b - a + n) % n;
  const first = simplifyChain(turned.slice(0, split + 1), tol);
  const second = simplifyChain(turned.slice(split).concat([turned[0]]), tol);
  return first.concat(second.slice(1, -1));
}

/** Rounds to whole units and drops the repeated and perfectly straight-through vertices rounding leaves behind. */
export function quantizeRing(ring, unit) {
  let pts = ring.map(([x, y]) => [Math.round(x / unit), Math.round(y / unit)]);
  pts = pts.filter((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return p[0] !== q[0] || p[1] !== q[1];
  });
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const p = pts[(i + pts.length - 1) % pts.length];
      const q = pts[i];
      const r = pts[(i + 1) % pts.length];
      const cross = (q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]);
      // Zero cross product: either straight through (redundant) or a spike doubling back (degenerate).
      if (cross === 0) {
        pts.splice(i, 1);
        changed = true;
        i--;
      }
    }
  }
  return pts;
}

function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const o1 = o(a, b, c);
  const o2 = o(a, b, d);
  const o3 = o(c, d, a);
  const o4 = o(c, d, b);
  if (o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0) return true;
  const on = (p, q, r) =>
    Math.min(p[0], q[0]) <= r[0] && r[0] <= Math.max(p[0], q[0]) && Math.min(p[1], q[1]) <= r[1] && r[1] <= Math.max(p[1], q[1]);
  return (o1 === 0 && on(a, b, c)) || (o2 === 0 && on(a, b, d)) || (o3 === 0 && on(c, d, a)) || (o4 === 0 && on(c, d, b));
}

/** True when no two non-adjacent edges touch. Simplification can fold a thin ring over itself; this catches it. */
export function isSimpleRing(ring) {
  const n = ring.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(a, b, ring[j], ring[(j + 1) % n])) return false;
    }
  }
  return true;
}

/**
 * Simplifies and quantizes one ring, stepping the tolerance down if the result
 * folds over itself or loses more than 2% of its area. Returns integer units,
 * oriented counter-clockwise for an outer ring and clockwise for a hole.
 */
export function packRing(ring, { tolerance, unit, hole }) {
  const area0 = Math.abs(signedArea(ring));
  let pts = null;
  for (const tol of [tolerance, tolerance / 2, 0]) {
    const q = quantizeRing(simplifyRing(ring, tol), unit);
    if (q.length < 3) continue;
    const area = (Math.abs(signedArea(q)) * unit * unit);
    if (isSimpleRing(q) && Math.abs(area - area0) <= 0.02 * area0) {
      pts = q;
      break;
    }
    pts = q;
  }
  if (!pts || pts.length < 3) return null;
  const ccw = signedArea(pts) > 0;
  if (ccw === hole) pts.reverse();
  return pts;
}

export function encodeInt(v) {
  let z = v < 0 ? -2 * v - 1 : 2 * v;
  let s = '';
  while (z >= 32) {
    s += ALPHABET[32 + (z % 32)];
    z = Math.floor(z / 32);
  }
  return s + ALPHABET[z];
}

/** Integer-unit vertices to the ring string described at the top of this file. */
export function encodeRing(pts) {
  let s = '';
  let px = 0;
  let py = 0;
  for (const [x, y] of pts) {
    s += encodeInt(x - px) + encodeInt(y - py);
    px = x;
    py = y;
  }
  return s;
}

/** Postal codes are six digits; the dataset has carried them as numbers before, which drops a leading zero. */
export function normalisePostal(v) {
  const s = String(v ?? '').trim();
  return /^\d{1,6}$/.test(s) ? s.padStart(6, '0') : null;
}

function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

/** GeoJSON ring [[lng, lat], ...] to plain [lat, lng] pairs without the closing repeat. */
function openRing(coords) {
  const pts = coords.map(([lng, lat]) => [lat, lng]);
  const last = pts.length - 1;
  if (last > 0 && pts[0][0] === pts[last][0] && pts[0][1] === pts[last][1]) pts.pop();
  return pts;
}

/**
 * Turns the footprint FeatureCollection into shard objects, one per sector.
 * Pure: no I/O, so the tests can run it on a hand-made collection.
 */
export function buildShards(collection, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const stats = { features: 0, blocks: 0, skipped: { postal: 0, geometry: 0 }, droppedHoles: 0, droppedParts: 0, verticesIn: 0, verticesOut: 0, maxVertices: 0 };

  // Gather by postal code first: two features with one postal code are one block in two pieces.
  const byPostal = new Map();
  for (const f of collection.features ?? []) {
    stats.features++;
    const postal = normalisePostal(f?.properties?.POSTAL_COD);
    if (!postal) {
      stats.skipped.postal++;
      continue;
    }
    const polys = polygonsOf(f.geometry).map((p) => p.map(openRing)).filter((p) => p.length && p[0].length >= 3);
    if (!polys.length) {
      stats.skipped.geometry++;
      continue;
    }
    const blk = String(f.properties.BLK_NO ?? '').trim().toUpperCase();
    const entry = byPostal.get(postal) ?? { postal, blk, polys: [] };
    entry.polys.push(...polys);
    byPostal.set(postal, entry);
  }

  const bySector = new Map();
  for (const entry of byPostal.values()) {
    const sector = entry.postal.slice(0, 2);
    if (!bySector.has(sector)) bySector.set(sector, []);
    bySector.get(sector).push(entry);
  }

  const shards = new Map();
  for (const [sector, entries] of [...bySector].sort(([a], [b]) => a.localeCompare(b))) {
    // The frame's origin is the middle of the sector, rounded so that the
    // file states exactly the origin the coordinates were measured from.
    let s = Infinity;
    let w = Infinity;
    let n = -Infinity;
    let e = -Infinity;
    for (const { polys } of entries)
      for (const p of polys)
        for (const [lat, lng] of p[0]) {
          s = Math.min(s, lat);
          n = Math.max(n, lat);
          w = Math.min(w, lng);
          e = Math.max(e, lng);
        }
    const lat0 = Number(((s + n) / 2).toFixed(6));
    const lng0 = Number(((w + e) / 2).toFixed(6));
    const frame = localFrame(lat0, lng0);

    const rows = [];
    for (const entry of entries.sort((a, b) => a.postal.localeCompare(b.postal))) {
      const parts = [];
      for (const poly of entry.polys) {
        const [outer, ...holes] = poly.map((r) => r.map(([lat, lng]) => frame.toLocal(lat, lng)));
        const area = Math.abs(signedArea(outer));
        stats.verticesIn += poly.reduce((k, r) => k + r.length, 0);
        if (area < opts.minPart) {
          stats.droppedParts++;
          continue;
        }
        const packedOuter = packRing(outer, { ...opts, hole: false });
        if (!packedOuter) continue;
        const packedHoles = [];
        for (const h of holes) {
          if (Math.abs(signedArea(h)) < opts.minHole) {
            stats.droppedHoles++;
            continue;
          }
          const ph = packRing(h, { ...opts, hole: true });
          if (ph) packedHoles.push(ph);
        }
        parts.push({ area, rings: [packedOuter, ...packedHoles] });
      }
      if (!parts.length) {
        // Every part was too small to be a block, so keep the largest rather than lose the address.
        const biggest = entry.polys
          .map((p) => p[0].map(([lat, lng]) => frame.toLocal(lat, lng)))
          .sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)))[0];
        const packed = biggest && packRing(biggest, { ...opts, hole: false });
        if (!packed) {
          stats.skipped.geometry++;
          continue;
        }
        parts.push({ area: 0, rings: [packed] });
      }
      parts.sort((a, b) => b.area - a.area);
      const rings = parts.flatMap((p) => p.rings);
      const vertices = rings.reduce((k, r) => k + r.length, 0);
      stats.verticesOut += vertices;
      stats.maxVertices = Math.max(stats.maxVertices, vertices);
      stats.blocks++;
      rows.push([entry.postal, entry.blk, ...rings.map(encodeRing)]);
    }
    shards.set(sector, {
      shard: { v: SHARD_VERSION, sector, origin: [lat0, lng0], unit: opts.unit, blocks: rows },
      bbox: [s, w, n, e].map((v) => Number(v.toFixed(6)))
    });
  }
  return { shards, stats, options: opts };
}

// ---------------------------------------------------------------------------
// Network and files. Only main() touches these.

const API_OPEN = 'https://api-open.data.gov.sg/v1/public/api/datasets';
const API_PROD = 'https://api-production.data.gov.sg/v2/public/api/datasets';
const LICENCE_URL = 'https://data.gov.sg/open-data-licence';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET with polite retries: data.gov.sg allows two download calls per ten seconds without a key. */
async function getJson(url, tries = 4) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < tries) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 5000 * attempt;
      console.warn(`  ${res.status} from ${new URL(url).host}, waiting ${Math.round(wait / 1000)} s`);
      await sleep(wait);
      continue;
    }
    throw new Error(`${res.status} ${res.statusText} for ${url}`);
  }
}

async function datasetUrl(id) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const body = await getJson(`${API_OPEN}/${id}/poll-download`);
    if (body?.data?.url) return body.data.url;
    // Not prepared yet: ask for it once, then keep polling.
    if (attempt === 1) await getJson(`${API_OPEN}/${id}/initiate-download`).catch(() => null);
    await sleep(5000);
  }
  throw new Error(`data.gov.sg did not prepare a download for ${id}`);
}

async function datasetMeta(id) {
  const body = await getJson(`${API_PROD}/${id}/metadata`);
  const d = body?.data ?? {};
  return { id, name: d.name ?? 'HDB Existing Building', lastUpdatedAt: d.lastUpdatedAt ?? null, url: `https://data.gov.sg/datasets/${id}/view` };
}

function parseArgs(argv) {
  const args = { input: null, out: 'public/blocks' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input') args.input = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
    else throw new Error(`Unknown argument ${argv[i]}`);
  }
  return args;
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

export function attributionLine(datasetName, accessed) {
  const date = accessed.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Singapore' });
  return `Contains information from ${datasetName} accessed on ${date} from data.gov.sg which is made available under the terms of the Singapore Open Data Licence version 1.0 ${LICENCE_URL}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = resolve(args.out);
  const accessed = new Date();

  console.log('Fetching dataset details from data.gov.sg');
  const meta = await datasetMeta(FOOTPRINT_DATASET);
  let text;
  if (args.input) {
    console.log(`Reading ${args.input}`);
    text = await readFile(args.input, 'utf8');
  } else {
    const url = await datasetUrl(FOOTPRINT_DATASET);
    console.log(`Downloading ${meta.name} (updated ${meta.lastUpdatedAt})`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} downloading the footprints`);
    text = await res.text();
  }
  const collection = JSON.parse(text);
  const { shards, stats, options } = buildShards(collection);

  await mkdir(out, { recursive: true });
  // Clear old shards so a sector that loses its last block does not linger.
  for (const f of await readdir(out)) if (/^\d\d\.json$/.test(f)) await rm(join(out, f));

  const sectors = {};
  let total = 0;
  let largest = { sector: '', bytes: 0, gzip: 0 };
  for (const [sector, { shard, bbox }] of shards) {
    const body = JSON.stringify(shard);
    const bytes = Buffer.byteLength(body);
    const gzip = gzipSync(body, { level: 9 }).length;
    await writeFile(join(out, `${sector}.json`), body);
    sectors[sector] = { blocks: shard.blocks.length, bytes, bbox };
    total += bytes;
    if (bytes > largest.bytes) largest = { sector, bytes, gzip };
  }

  const manifest = {
    v: SHARD_VERSION,
    built: accessed.toISOString(),
    blocks: stats.blocks,
    sectors,
    simplify: { tolerance: options.tolerance, unit: options.unit, minHole: options.minHole, minPart: options.minPart },
    sources: [meta],
    licence: 'Singapore Open Data Licence version 1.0',
    licenceUrl: LICENCE_URL,
    attribution: attributionLine(meta.name, accessed)
  };
  // One line per sector keeps the monthly diff readable without spreading every bbox over six lines.
  const manifestBody = JSON.stringify(manifest, null, 1).replace(/\[\s+([^\]{}]*?)\s+\]/g, (_, inner) => `[${inner.replace(/\s+/g, ' ')}]`);
  await writeFile(join(out, 'manifest.json'), manifestBody + '\n');
  total += Buffer.byteLength(manifestBody);

  console.log(`\n${stats.blocks} blocks from ${stats.features} features in ${shards.size} sector files`);
  console.log(`  skipped: ${stats.skipped.postal} without a postal code, ${stats.skipped.geometry} without usable geometry`);
  console.log(`  dropped: ${stats.droppedHoles} air wells under ${options.minHole} m², ${stats.droppedParts} fragments under ${options.minPart} m²`);
  console.log(`  vertices: ${stats.verticesIn} in, ${stats.verticesOut} out (mean ${(stats.verticesOut / stats.blocks).toFixed(1)}, max ${stats.maxVertices})`);
  console.log(`  size: ${kb(total)} in all; largest ${largest.sector}.json ${kb(largest.bytes)} (${kb(largest.gzip)} gzipped)`);
  console.log(`Wrote ${out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}

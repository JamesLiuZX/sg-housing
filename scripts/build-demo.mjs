#!/usr/bin/env node
/**
 * Writes src/lib/data/demo-snapshot.ts: everything Blk shows for one real
 * block (440A Clementi Ave 3, postal 121440), so the app has a complete block
 * to show with no network at all, as in the single-file preview.
 *
 *   npm run demo        (run `npm run blocks` first if the index is stale)
 *
 * It asks the real services exactly as the app would: OneMap for the address,
 * data.gov.sg for the block's facts and resale records. The footprint and
 * neighbours come from the block index in public/blocks/, so the demo matches
 * what `loadBlock` serves. Each neighbour's height comes the way the app's
 * live lookup finds it: its street from OneMap by postal code, then its row
 * in HDB Property Information, all neighbours in one datastore search. The
 * snapshot keeps the services' raw answers (trimmed to the fields the app
 * reads) and the index's encoded rings; src/lib/data/demo.ts turns them into
 * typed results with the same parsers the live path uses.
 *
 * Needs Node 22.18 or later, which reads TypeScript without a build step: the
 * street spellings come from the app's own src/lib/data/street.ts, so the
 * script and the app cannot disagree about them.
 *
 * It also writes src/lib/data/demo-ground.ts, the block's bundled map: OneMap's
 * Grey and Night maps at zoom 18 round the block, as far as the block stage's
 * table reaches, stitched and kept as WebP, so the demo stands on its street
 * with no network. Node has no image encoder, so that one step runs
 * scripts/demo-ground.py (Python 3 with Pillow); without it the bundled map is
 * left as it was and the script says so. `npm run demo -- --ground` redoes
 * only the map.
 */

import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { hdbBlock, hdbStreet, streetKey } from '../src/lib/data/street.ts';
import { ALPHABET } from './build-blocks.mjs';

const POSTAL = '121440';
const QUERY = '440A Clementi Ave 3';
const BLK = '440A';
const STREET = 'CLEMENTI AVE 3';
const PROPERTY = 'd_17f5382f26140b1fdae0ba2ef6239d2f';
const RESALE = 'd_8b84c4ee58e3cfc0ece0d773c8ca6abc';
/**
 * Rows whose bounding boxes come within the app's neighbour radius go in. A
 * box gap is never more than the true gap, so every real neighbour is kept,
 * and the app's own 150 m test then picks them exactly.
 */
const MARGIN = 150;
const OUT = resolve('src/lib/data/demo-snapshot.ts');
/** The Property Information columns a neighbour's height and kind are read from: HEIGHT_FIELDS in src/lib/data/datagov.ts. */
const HEIGHT_FIELDS = ['blk_no', 'street', 'max_floor_lvl', 'residential', 'commercial', 'market_hawker', 'multistorey_carpark', 'precinct_pavilion'];
/** OneMap answers 429 to searches closer together than about a quarter of a second; a script nobody waits on goes far slower. */
const ONEMAP_GAP_MS = 1000;
/** No block number has more Property Information rows than this (Blk 1 has 36). */
const ROWS_PER_NUMBER = 50;
const GROUND_OUT = resolve('src/lib/data/demo-ground.ts');
/** The table under the demo block fades out 283 m from it (0.92 of its 307 m radius, in src/lib/engine/site.ts). */
const GROUND_HALF = 285;
/** The table's own zoom in src/lib/engine/ground.ts: 0.6 m to a pixel here. */
const GROUND_ZOOM = 18;
/** OneMap's drawn map by day and after dark, as the stage shows them. */
const GROUND_STYLES = ['Grey', 'Night'];
/** WebP quality: lines and lettering stay clean, and both pictures together come to about 95 KB. */
const GROUND_QUALITY = 45;
/** Between tile requests: a script nobody waits on asks gently. */
const TILE_GAP_MS = 120;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < 4) {
      await sleep(4000 * attempt);
      continue;
    }
    throw new Error(`${res.status} from ${new URL(url).host}`);
  }
}

function datastore(resource, params) {
  const q = new URLSearchParams({ resource_id: resource, ...params });
  return getJson(`https://data.gov.sg/api/action/datastore_search?${q}`).then((b) => {
    if (!b?.success || !Array.isArray(b.result?.records)) throw new Error('unexpected datastore answer');
    return b.result;
  });
}

/** Just enough of the ring decoder to find which rows lie near the block. */
function decodeRing(text) {
  const digit = new Map([...ALPHABET].map((c, i) => [c, i]));
  const ints = [];
  let z = 0;
  let scale = 1;
  for (const c of text) {
    const d = digit.get(c);
    if (d >= 32) {
      z += (d - 32) * scale;
      scale *= 32;
    } else {
      z += d * scale;
      ints.push(z % 2 === 0 ? z / 2 : -(z + 1) / 2);
      z = 0;
      scale = 1;
    }
  }
  const pts = [];
  for (let i = 0, x = 0, y = 0; i < ints.length; i += 2) pts.push([(x += ints[i]), (y += ints[i + 1])]);
  return pts;
}

function boxOf(row, unit) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of row.slice(2))
    for (const [x, y] of decodeRing(ring)) {
      b[0] = Math.min(b[0], x * unit);
      b[1] = Math.min(b[1], y * unit);
      b[2] = Math.max(b[2], x * unit);
      b[3] = Math.max(b[3], y * unit);
    }
  return b;
}

const gap = (a, b) => Math.hypot(Math.max(0, a[0] - b[2], b[0] - a[2]), Math.max(0, a[1] - b[3], b[1] - a[3]));

const oneMapSearch = (q) =>
  getJson(`https://www.onemap.gov.sg/api/common/elastic/search?${new URLSearchParams({ searchVal: q, returnGeom: 'Y', getAddrDetails: 'Y', pageNum: '1' })}`);

/** OneMap writes "NIL" where a field is empty. */
const given = (v) => (typeof v === 'string' && v.trim() !== 'NIL' ? v.trim() : '');

/**
 * Each neighbour's height, found as the app's live lookup finds it: its road
 * from OneMap by postal code, then its row in HDB Property Information, all
 * neighbours in one datastore search (every number on every street, exact
 * pairs kept), and a second by number alone only for a street HDB spells
 * some other way. One row per neighbour: postal code, road as OneMap names
 * it, then HEIGHT_FIELDS, empty where HDB has no row.
 */
async function neighbourHeights(neighbours) {
  const refs = [];
  for (const [postal, blk] of neighbours) {
    await sleep(ONEMAP_GAP_MS);
    const found = await oneMapSearch(postal);
    const hit = (found.results ?? []).find((r) => r.POSTAL === postal && given(r.BLK_NO) && given(r.ROAD_NAME));
    const road = hit ? given(hit.ROAD_NAME) : '';
    refs.push({ postal, road, blk: hdbBlock(blk), street: road ? hdbStreet(road) : '' });
  }
  const asked = refs.filter((r) => r.blk && r.street);
  const search = (filters, limit) => datastore(PROPERTY, { filters: JSON.stringify(filters), fields: HEIGHT_FIELDS.join(','), limit: String(limit) });
  const sameBlk = (row, ref) => String(row.blk_no).trim().toUpperCase() === ref.blk;
  const blks = [...new Set(asked.map((r) => r.blk))];
  const streets = [...new Set(asked.map((r) => r.street))];
  const exact = blks.length ? (await search({ blk_no: blks, street: streets }, blks.length * streets.length)).records : [];
  const rowOf = new Map(asked.map((ref) => [ref, exact.find((row) => sameBlk(row, ref) && String(row.street).trim().toUpperCase() === ref.street)]));
  const loose = asked.filter((ref) => !rowOf.get(ref));
  if (loose.length) {
    const numbers = [...new Set(loose.map((r) => r.blk))];
    const more = (await search({ blk_no: numbers }, numbers.length * ROWS_PER_NUMBER)).records;
    for (const ref of loose) rowOf.set(ref, more.find((row) => sameBlk(row, ref) && streetKey(String(row.street)) === streetKey(ref.street)));
  }
  return refs.map((ref) => {
    const row = rowOf.get(ref);
    if (row) {
      const uses = HEIGHT_FIELDS.slice(3).filter((c) => String(row[c]).trim().toUpperCase() === 'Y');
      const n = String(row.max_floor_lvl).trim();
      console.log(`  ${row.blk_no} ${row.street} (${ref.postal}): ${n} ${n === '1' ? 'storey' : 'storeys'}, ${uses.join(' and ') || 'no use flagged'}`);
    } else {
      console.warn(`  postal ${ref.postal} (${ref.blk} ${ref.street || 'street unknown'}): no Property Information row, so the app draws it at a typical height`);
    }
    return [ref.postal, ref.road, ...HEIGHT_FIELDS.map((c) => (row ? String(row[c] ?? '') : ''))];
  });
}

// ── The bundled map ──

const RAD = Math.PI / 180;
const WGS84_A = 6378137;
const WGS84_E2 = 0.00669437999014;

/** Where a latitude and longitude falls at zoom z, in world pixels from the north-west corner, as src/lib/data/tiles.ts has it. */
function worldPixel(lat, lng, z) {
  const n = 256 * 2 ** z;
  return [((lng + 180) / 360) * n, ((1 - Math.asinh(Math.tan(lat * RAD)) / Math.PI) / 2) * n];
}

/** Metres on the ground to a degree east and a degree north at a latitude: the ellipsoid's radii of curvature, as src/lib/data/shard.ts. */
function metresPerDegree(lat) {
  const s = Math.sin(lat * RAD);
  const w = 1 - WGS84_E2 * s * s;
  return [(WGS84_A / Math.sqrt(w)) * Math.cos(lat * RAD) * RAD, ((WGS84_A * (1 - WGS84_E2)) / (w * Math.sqrt(w))) * RAD];
}

/** A block's centroid, [lat, lng], as the app finds it (centroidOf and localFrame in src/lib/data/shard.ts). */
function centroidOf(shard, row) {
  let cx = 0;
  let cy = 0;
  let a = 0;
  // Holes run clockwise, so their area takes itself off.
  for (const text of row.slice(2)) {
    const r = decodeRing(text);
    for (let i = 0; i < r.length; i++) {
      const [x0, y0] = r[i];
      const [x1, y1] = r[(i + 1) % r.length];
      const k = x0 * y1 - x1 * y0;
      cx += (x0 + x1) * k;
      cy += (y0 + y1) * k;
      a += k;
    }
  }
  const [lat0, lng0] = shard.origin;
  const [kx, ky] = metresPerDegree(lat0);
  return [lat0 + ((cy / (3 * a)) * shard.unit) / ky, lng0 + ((cx / (3 * a)) * shard.unit) / kx];
}

/**
 * The world pixels GROUND_HALF metres round a point, out to whole pixels: what
 * the bundled picture shows. The app lays it on the ground from these pixels
 * alone, through the same projection as the footprints.
 */
function groundRect(lat, lng) {
  const [kx, ky] = metresPerDegree(lat);
  const [px0, py0] = worldPixel(lat + GROUND_HALF / ky, lng - GROUND_HALF / kx, GROUND_ZOOM);
  const [px1, py1] = worldPixel(lat - GROUND_HALF / ky, lng + GROUND_HALF / kx, GROUND_ZOOM);
  return { z: GROUND_ZOOM, px0: Math.floor(px0), py0: Math.floor(py0), px1: Math.ceil(px1), py1: Math.ceil(py1) };
}

async function getTile(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url);
    if (res.ok) {
      const body = Buffer.from(await res.arrayBuffer());
      // Past a style's highest zoom OneMap answers 200 with nothing in it.
      if (!body.length) throw new Error(`OneMap has no tile at ${url}`);
      return body;
    }
    if (attempt < 3 && (res.status === 429 || res.status >= 500)) {
      await sleep(2000 * attempt);
      continue;
    }
    throw new Error(`${res.status} from ${url}`);
  }
}

/**
 * Fetches, stitches and writes the demo block's bundled map round its
 * centroid. Leaves the bundled map as it was, and says why, if the pictures
 * cannot be made.
 */
async function buildGround(shard, row, taken) {
  const rect = groundRect(...centroidOf(shard, row));
  const [tx0, ty0, tx1, ty1] = [rect.px0, rect.py0, rect.px1 - 1, rect.py1 - 1].map((p) => Math.floor(p / 256));
  const dir = await mkdtemp(join(tmpdir(), 'blk-demo-ground-'));
  try {
    for (const style of GROUND_STYLES) {
      console.log(`OneMap: ${(tx1 - tx0 + 1) * (ty1 - ty0 + 1)} ${style} tiles at zoom ${GROUND_ZOOM}`);
      for (let x = tx0; x <= tx1; x++)
        for (let y = ty0; y <= ty1; y++) {
          await writeFile(join(dir, `${style}-${x}-${y}.png`), await getTile(`https://www.onemap.gov.sg/maps/tiles/${style}/${GROUND_ZOOM}/${x}/${y}.png`));
          await sleep(TILE_GAP_MS);
        }
    }
    const args = [rect.z, rect.px0, rect.py0, rect.px1, rect.py1, GROUND_QUALITY].map(String);
    const run = spawnSync('python3', ['-I', resolve('scripts/demo-ground.py'), dir, ...args, ...GROUND_STYLES], { encoding: 'utf8' });
    if (run.error || run.status !== 0) {
      console.warn(
        run.status === 2
          ? 'Left the bundled map as it was: making it needs Python 3 with Pillow built with WebP (pip install Pillow).'
          : `Left the bundled map as it was: scripts/demo-ground.py failed. ${run.error?.message ?? run.stderr.trim()}`
      );
      return;
    }
    const [day, night] = await Promise.all(GROUND_STYLES.map((s) => readFile(join(dir, `${s}.webp`))));
    const date = taken.toISOString().slice(0, 10);
    const text = [
      '/**',
      ` * The demo block's bundled map: OneMap's ${GROUND_STYLES.join(' and ')} maps at zoom ${GROUND_ZOOM}, ${GROUND_HALF} m round`,
      ` * Blk ${QUERY}, taken ${date}, stitched and kept as WebP. Written by scripts/build-demo.mjs;`,
      ' * do not edit by hand, run `npm run demo -- --ground`. bundledMap in src/lib/data/tiles.ts lays',
      ' * it on the ground where its pixels say, so the demo stands on its street with no network.',
      ' *',
      ' * Map: OneMap © contributors | Singapore Land Authority, shown under OneMap’s terms with its',
      ' * logo and attribution wherever it is on screen (https://www.onemap.gov.sg/docs/maps/).',
      ' */',
      '',
      "import type { PixelRect } from './tiles';",
      '',
      'export const DEMO_GROUND: { postal: string; taken: string; rect: PixelRect; type: string; day: string; night: string } = {',
      `  postal: ${JSON.stringify(POSTAL)},`,
      `  taken: ${JSON.stringify(date)},`,
      `  rect: ${JSON.stringify(rect).replace(/"(\w+)":/g, '$1: ').replace(/,/g, ', ').replace('{', '{ ').replace(/}$/, ' }')},`,
      `  type: ${JSON.stringify('image/webp')},`,
      `  day: ${JSON.stringify(day.toString('base64'))},`,
      `  night: ${JSON.stringify(night.toString('base64'))}`,
      '};',
      ''
    ].join('\n');
    await writeFile(GROUND_OUT, text);
    console.log(
      `Wrote ${GROUND_OUT}: ${rect.px1 - rect.px0} by ${rect.py1 - rect.py0} px, day ${(day.length / 1024).toFixed(1)} KB, night ${(night.length / 1024).toFixed(1)} KB, ${(Buffer.byteLength(text) / 1024).toFixed(1)} KB as text`
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main() {
  const taken = new Date();

  console.log('Block index: public/blocks/12.json');
  const shard = JSON.parse(await readFile(resolve('public/blocks/12.json'), 'utf8'));
  const mine = shard.blocks.find((r) => r[0] === POSTAL);
  if (!mine) throw new Error(`${POSTAL} is not in the block index`);
  if (process.argv.includes('--ground')) return buildGround(shard, mine, taken);

  console.log('OneMap: searching for', QUERY);
  const search = await oneMapSearch(QUERY);
  const raw = (search.results ?? []).find((r) => r.POSTAL === POSTAL);
  if (!raw) throw new Error(`OneMap did not return ${POSTAL} for "${QUERY}"`);
  const hit = Object.fromEntries(['BLK_NO', 'ROAD_NAME', 'BUILDING', 'ADDRESS', 'POSTAL', 'LATITUDE', 'LONGITUDE'].map((k) => [k, raw[k]]));

  console.log('data.gov.sg: HDB Property Information');
  const facts = await datastore(PROPERTY, { filters: JSON.stringify({ blk_no: BLK, street: STREET }), limit: '1' });
  if (!facts.records[0]) throw new Error('no Property Information row');
  const { _id, ...factRow } = facts.records[0];
  void _id;

  console.log('data.gov.sg: resale transactions');
  const resales = await datastore(RESALE, {
    filters: JSON.stringify({ block: BLK, street_name: STREET }),
    sort: 'month desc',
    limit: '500',
    fields: 'month,town,flat_type,storey_range,floor_area_sqm,flat_model,lease_commence_date,remaining_lease,resale_price'
  });
  const columns = ['month', 'flat_type', 'storey_range', 'floor_area_sqm', 'flat_model', 'lease_commence_date', 'remaining_lease', 'resale_price'];
  const rows = resales.records.map((r) => columns.map((c) => String(r[c] ?? '')));

  const box = boxOf(mine, shard.unit);
  const near = shard.blocks.filter((r) => r === mine || gap(box, boxOf(r, shard.unit)) <= MARGIN);

  const others = near.filter((r) => r !== mine);
  console.log(`OneMap and data.gov.sg: the heights of ${others.length} neighbours`);
  const heights = await neighbourHeights(others);

  const lines = [
    '/**',
    ` * Snapshot of Blk ${BLK} ${STREET} (postal ${POSTAL}), taken ${taken.toISOString().slice(0, 10)}.`,
    ' * Written by scripts/build-demo.mjs from OneMap, data.gov.sg and the block',
    ' * index; do not edit by hand, run `npm run demo`. src/lib/data/demo.ts turns',
    ' * it into the same typed results the live lookups return.',
    ' *',
    ' * Contains information from HDB Property Information, Resale flat prices based on',
    ` * registration date from Jan-2017 onwards and HDB Existing Building accessed on ${taken.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Singapore' })}`,
    ' * from data.gov.sg which is made available under the terms of the Singapore Open',
    ' * Data Licence version 1.0 https://data.gov.sg/open-data-licence. Addresses and',
    ' * streets from OneMap.',
    ' */',
    '',
    "import type { Shard } from './shard';",
    '',
    `export const SNAPSHOT_TAKEN = ${JSON.stringify(taken.toISOString())};`,
    '',
    '/** The OneMap result for the address, as OneMap returned it. */',
    `export const SNAPSHOT_HIT: Record<string, string> = ${JSON.stringify(hit)};`,
    '',
    "/** The block's row in HDB Property Information, as data.gov.sg returned it. */",
    `export const SNAPSHOT_FACTS: Record<string, string> = ${JSON.stringify(factRow)};`,
    '',
    `/** The block's resale records, newest first, as data.gov.sg returned them: one row per sale in \`columns\` order. */`,
    'export const SNAPSHOT_RESALES = {',
    `  block: ${JSON.stringify(BLK)},`,
    `  street: ${JSON.stringify(STREET)},`,
    `  town: ${JSON.stringify(String(resales.records[0]?.town ?? ''))},`,
    `  total: ${Number(resales.total) || rows.length},`,
    `  columns: ${JSON.stringify(columns)},`,
    '  rows: [',
    ...rows.map((r, i) => `    ${JSON.stringify(r)}${i < rows.length - 1 ? ',' : ''}`),
    '  ]',
    '};',
    '',
    `/** The block and every block within ${MARGIN} m of it, cut from public/blocks/12.json without re-encoding. */`,
    'export const SNAPSHOT_SHARD: Shard = {',
    `  v: ${shard.v},`,
    `  sector: ${JSON.stringify(shard.sector)},`,
    `  origin: ${JSON.stringify(shard.origin)},`,
    `  unit: ${shard.unit},`,
    '  blocks: [',
    ...near.map((r, i) => `    ${JSON.stringify(r)}${i < near.length - 1 ? ',' : ''}`),
    '  ]',
    '};',
    '',
    '/**',
    ' * How tall each of those neighbours is: its postal code, its road as OneMap',
    ' * names it, then its row in HDB Property Information as data.gov.sg returned',
    ' * it, in `columns` order; empty after the road where HDB has no row.',
    ' */',
    'export const SNAPSHOT_HEIGHTS = {',
    `  columns: ${JSON.stringify(['postal', 'road', ...HEIGHT_FIELDS])},`,
    '  rows: [',
    ...heights.map((r, i) => `    ${JSON.stringify(r)}${i < heights.length - 1 ? ',' : ''}`),
    '  ]',
    '};',
    ''
  ];
  const text = lines.join('\n');
  await writeFile(OUT, text);
  const known = heights.filter((r) => r[2]).length;
  console.log(`Wrote ${OUT}: ${near.length} blocks, ${known} of ${heights.length} neighbour heights, ${rows.length} sales, ${(Buffer.byteLength(text) / 1024).toFixed(1)} KB`);

  await buildGround(shard, mine, taken);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

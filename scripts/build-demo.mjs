#!/usr/bin/env node
/**
 * Writes src/lib/data/demo-snapshot.ts: everything Blk shows for one real
 * block (440A Clementi Ave 3, postal 121440), so the app has a complete block
 * to show with no network at all, as in the single-file preview.
 *
 *   npm run demo        (run `npm run blocks` first if the index is stale)
 *
 * It asks the real services once each, exactly as the app would: OneMap for
 * the address, data.gov.sg for the block's facts and resale records. The
 * footprint and neighbours come from the block index in public/blocks/, so the
 * demo matches what `loadBlock` serves. The snapshot keeps the services' raw
 * answers (trimmed to the fields the app reads) and the index's encoded
 * rings; src/lib/data/demo.ts turns them into typed results with the same
 * parsers the live path uses.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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

async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 4000 * attempt));
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

async function main() {
  const taken = new Date();

  console.log('OneMap: searching for', QUERY);
  const search = await getJson(
    `https://www.onemap.gov.sg/api/common/elastic/search?${new URLSearchParams({ searchVal: QUERY, returnGeom: 'Y', getAddrDetails: 'Y', pageNum: '1' })}`
  );
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

  console.log('Block index: public/blocks/12.json');
  const shard = JSON.parse(await readFile(resolve('public/blocks/12.json'), 'utf8'));
  const mine = shard.blocks.find((r) => r[0] === POSTAL);
  if (!mine) throw new Error(`${POSTAL} is not in the block index`);
  const box = boxOf(mine, shard.unit);
  const near = shard.blocks.filter((r) => r === mine || gap(box, boxOf(r, shard.unit)) <= MARGIN);

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
    ' * Data Licence version 1.0 https://data.gov.sg/open-data-licence. Address from OneMap.',
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
    ''
  ];
  const text = lines.join('\n');
  await writeFile(OUT, text);
  console.log(`Wrote ${OUT}: ${near.length} blocks, ${rows.length} sales, ${(Buffer.byteLength(text) / 1024).toFixed(1)} KB`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

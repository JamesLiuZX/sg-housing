/**
 * One real block, bundled: 440A Clementi Ave 3 (postal 121440), with its
 * footprint, neighbours, facts and resale history, for when there is no
 * network at all (the single-file preview blocks every request, including the
 * block index) and for a first visit that should show something real at once.
 *
 * The data is a snapshot (demo-snapshot.ts, refreshed with `npm run demo`) of
 * the services' own answers. This module runs it through the same parsers
 * and the same footprint code as the live lookups, so what comes out has
 * exactly the shapes and values `searchAddress` and `lookupBlock` would give
 * on the day it was taken. Nothing here touches the network.
 */

import { locateBlock, prepareSector } from './blocks';
import { summariseResales, toFacts } from './datagov';
import { SNAPSHOT_FACTS, SNAPSHOT_HIT, SNAPSHOT_RESALES, SNAPSHOT_SHARD, SNAPSHOT_TAKEN } from './demo-snapshot';
import { toHit } from './onemap';
import type { AddressHit, Block, BlockFacts, BlockLookup, Found, ResaleSummary } from './types';

export const DEMO_POSTAL = '121440';

/** When the snapshot was taken (ISO). Say so beside anything shown from it. */
export const DEMO_TAKEN: string = SNAPSHOT_TAKEN;

/** A lookup whose every part was found: what `lookupDemo` returns. */
export interface DemoLookup extends BlockLookup {
  block: Found<Block>;
  facts: Found<BlockFacts>;
  resales: Found<ResaleSummary>;
}

let built: DemoLookup | null = null;

function build(): DemoLookup {
  const fetchedAt = Date.parse(SNAPSHOT_TAKEN);
  const hit = toHit(SNAPSHOT_HIT);
  const block = locateBlock(prepareSector(SNAPSHOT_SHARD), DEMO_POSTAL);
  // The snapshot is generated and tested; a failure here is a broken build, not a runtime condition.
  if (!hit || !block) throw new Error('demo snapshot is incomplete; run `npm run demo`');
  const { block: blk, street, town, total, columns, rows } = SNAPSHOT_RESALES;
  const records = rows.map((r) => ({ ...Object.fromEntries(columns.map((c, i) => [c, r[i]])), block: blk, street_name: street, town }));
  return {
    hit,
    block: { status: 'ok', data: block, fetchedAt },
    facts: { status: 'ok', data: toFacts(SNAPSHOT_FACTS), fetchedAt },
    resales: { status: 'ok', data: summariseResales(blk, street, records, total), fetchedAt }
  };
}

/**
 * The bundled block, as a fresh copy each call so the caller may keep it in
 * state and change it freely. Same shape as `lookupBlock`'s answer, with
 * every part found.
 */
export function lookupDemo(): DemoLookup {
  built ??= build();
  return structuredClone(built);
}

/** The OneMap hit that leads to the bundled block, e.g. to show it as a suggestion before anything is typed. */
export function demoHit(): AddressHit {
  return lookupDemo().hit;
}

/** True when a hit is the bundled block, so the interface can use `lookupDemo` instead of the network. */
export function isDemoHit(hit: Pick<AddressHit, 'postal'>): boolean {
  return hit.postal === DEMO_POSTAL;
}

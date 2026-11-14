/**
 * The common case in one call: a OneMap hit in, everything Blk can learn
 * about that block out, each part fetched at the same time and each allowed
 * to fail on its own (the footprint can load while data.gov.sg is
 * rate-limited, and the other way round).
 */

import { loadBlock } from './blocks';
import { blockFacts, blockResales } from './datagov';
import type { AddressHit, Block, BlockFacts, BlockLookup, ResaleSummary, Result } from './types';

const NOT_FOUND = { status: 'not-found' } as const;

export async function lookupBlock(hit: AddressHit, options: { signal?: AbortSignal; radius?: number } = {}): Promise<BlockLookup> {
  const { signal } = options;
  // A road or landmark hit has no block number; there is nothing to ask HDB about.
  const asksHdb = hit.blk !== '' && hit.road !== '';
  const [block, facts, resales] = await Promise.all([
    hit.postal ? loadBlock(hit.postal, options) : Promise.resolve<Result<Block>>(NOT_FOUND),
    asksHdb ? blockFacts(hit.blk, hit.road, { signal }) : Promise.resolve<Result<BlockFacts>>(NOT_FOUND),
    asksHdb ? blockResales(hit.blk, hit.road, { signal }) : Promise.resolve<Result<ResaleSummary>>(NOT_FOUND)
  ]);
  return { hit, block, facts, resales };
}

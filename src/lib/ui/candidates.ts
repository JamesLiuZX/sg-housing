import { loadBlock, type AddressHit, type Block, type Result } from '../data';
import { titleCase } from './place';

/**
 * Which of the addresses OneMap finds are HDB blocks, settled before any is
 * offered, so a condo, a house or an office is never listed only to be
 * turned away once picked. The block index answers: one static file per
 * postal sector, fetched once a visit. Nothing here asks OneMap or
 * data.gov.sg anything.
 */

/** Asks the block index about a postal code: loadBlock, or a stand-in in tests. */
export type BlockCheck = (postal: string, options: { signal?: AbortSignal; radius?: number }) => Promise<Result<Block>>;

export interface Candidates {
  /** HDB blocks, in OneMap's order, and any address the index could not be asked about, so a pick can say why it fails. */
  blocks: AddressHit[];
  /** Addresses the index has no HDB block at: condos, landed homes, shops and offices. */
  others: AddressHit[];
}

/** Sorts addresses into HDB blocks and the rest. Null when `signal` fires first. */
export async function hdbCandidates(hits: AddressHit[], { signal, check = loadBlock }: { signal?: AbortSignal; check?: BlockCheck } = {}): Promise<Candidates | null> {
  // No neighbours are needed to answer "is this a block", so none are worked out.
  const found = await Promise.all(hits.map((h) => (h.postal ? check(h.postal, { signal, radius: 0 }) : null)));
  if (signal?.aborted || found.some((r) => r?.status === 'aborted')) return null;
  const out: Candidates = { blocks: [], others: [] };
  hits.forEach((h, i) => {
    const r = found[i];
    // With no postal code there is nothing to look up, and a not-found is the index saying "no HDB block here".
    (r && r.status !== 'not-found' ? out.blocks : out.others).push(h);
  });
  return out;
}

/**
 * What to call a place that is not a block: its building's name, else its
 * address with the road in full, since HDB's street abbreviations are for
 * HDB's addresses. "The Clement Canopy", "12 Jalan Bunga Rampai".
 */
export function placeName(hit: AddressHit): string {
  return hit.building ? titleCase(hit.building) : `${hit.blk} ${titleCase(hit.road)}`;
}

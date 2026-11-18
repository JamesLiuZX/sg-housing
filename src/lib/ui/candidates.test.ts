import { describe, expect, it } from 'vitest';
import { lookupDemo, type AddressHit, type Block, type Result } from '../data';
import { hdbCandidates, placeName, type BlockCheck } from './candidates';

const hit = (blk: string, road: string, postal: string, building = ''): AddressHit => ({ blk, road, building, postal, lat: 1.3, lng: 103.8, address: '' });

const BLOCK = hit('440A', 'CLEMENTI AVENUE 3', '121440', 'CLEMENTI CASCADIA');
const CONDO = hit('1', 'CLEMENTI AVENUE 1', '129957', 'THE CLEMENT CANOPY');
const HOUSE = hit('12', 'JALAN BUNGA RAMPAI', '538448');
const NO_POSTAL = hit('3', 'SOME ROAD', '');

/** An index that knows the bundled block, has no HDB block at the others, and cannot be reached for sector 53. */
const index: BlockCheck = async (postal): Promise<Result<Block>> => {
  if (postal === '121440') return lookupDemo().block;
  if (postal.startsWith('53')) return { status: 'unavailable', service: 'blocks', reason: 'network' };
  return { status: 'not-found' };
};

describe('which addresses are HDB blocks', () => {
  it('keeps the blocks and sets the rest aside, in the order OneMap gave them', async () => {
    const asked: string[] = [];
    const check: BlockCheck = (postal, options) => {
      asked.push(`${postal}:${options.radius}`);
      return index(postal, options);
    };
    const sorted = await hdbCandidates([CONDO, BLOCK, NO_POSTAL], { check });
    expect(sorted).toEqual({ blocks: [BLOCK], others: [CONDO, NO_POSTAL] });
    // Only the index is asked, once per postal code, and for no neighbours.
    expect(asked).toEqual(['129957:0', '121440:0']);
  });

  it('keeps an address the index could not be asked about, so picking it can say why', async () => {
    const sorted = await hdbCandidates([HOUSE], { check: index });
    expect(sorted).toEqual({ blocks: [HOUSE], others: [] });
  });

  it('gives up when a newer search has started', async () => {
    const ctl = new AbortController();
    const check: BlockCheck = async () => {
      ctl.abort();
      return { status: 'aborted' };
    };
    expect(await hdbCandidates([BLOCK], { signal: ctl.signal, check })).toBeNull();
  });

  it('has nothing to sort when nothing was found', async () => {
    expect(await hdbCandidates([], { check: index })).toEqual({ blocks: [], others: [] });
  });

  it('calls a place by its building, or else by its address', () => {
    expect(placeName(CONDO)).toBe('The Clement Canopy');
    expect(placeName(HOUSE)).toBe('12 Jalan Bunga Rampai');
  });
});

import { describe, expect, it } from 'vitest';
import { lookupDemo } from '../data';
import {
  candidateFor,
  factsLine,
  flatOptions,
  money,
  ok,
  roadName,
  saleWords,
  salesAt,
  storeyTag,
  storeysOf,
  typeWords,
  usualOption,
  usualStorey
} from './place';

describe('words for a place', () => {
  it('writes roads, storeys, prices and types the way they are written here', () => {
    expect(roadName('CLEMENTI AVENUE 3')).toBe('Clementi Ave 3');
    expect(roadName("SAINT GEORGE'S ROAD")).toBe("St. George's Rd");
    expect(storeyTag(7)).toBe('#07');
    expect(storeyTag(25)).toBe('#25');
    expect(money(890000)).toBe('$890,000');
    expect(money(1100000)).toBe('$1,100,000');
    expect(typeWords('4 ROOM')).toBe('4-room');
    expect(typeWords('EXECUTIVE')).toBe('Executive');
    expect(typeWords('MULTI-GENERATION')).toBe('Multi-generation');
  });

  it('states the demo block in one line, leaving out what is missing', () => {
    const d = lookupDemo();
    expect(factsLine(d.facts.data)).toEqual(['30 storeys', 'completed 2017', '208 flats']);
    expect(factsLine({ ...d.facts.data, yearCompleted: 0 })).toEqual(['30 storeys', '208 flats']);
    expect(factsLine(null)).toEqual([]);
    expect(storeysOf(d)).toBe(30);
  });

  it('finds the sales on a storey and says them plainly', () => {
    const d = lookupDemo();
    const sales = salesAt(ok(d.resales), 25);
    expect(sales.length).toBeGreaterThan(0);
    expect(saleWords(sales[0])).toEqual({ where: '#25 to #27 · 3-room · 69 m²', what: '$890,000 · Sep 2026' });
    expect(salesAt(ok(d.resales), 1)).toEqual([]);
    // The latest sale was on #25 to #27, so the stage opens in the middle of it.
    expect(usualStorey(d, 30)).toBe(26);
  });

  it('offers the flat types the block has, with fits that say how close they are', () => {
    const d = lookupDemo();
    const options = flatOptions(d);
    expect(options.map((o) => [o.flatType, o.areaSqm])).toEqual([
      ['2 ROOM', 47],
      ['3 ROOM', 69],
      ['4 ROOM', 87]
    ]);
    expect(usualOption(d, options).flatType).toBe('3 ROOM');
    expect(candidateFor(options[2], d)).toMatchObject({ fit: 'good', template: { id: 'bto-4room-93' } });
    expect(candidateFor(options[0], d).fit).toBe('loose');
    // With no records at all, every common type is offered.
    expect(flatOptions(null).map((o) => o.flatType)).toEqual(['2 ROOM', '3 ROOM', '4 ROOM', '5 ROOM', 'EXECUTIVE']);
  });
});

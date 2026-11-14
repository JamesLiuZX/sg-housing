import { describe, expect, it } from 'vitest';
import { HDB_STREETS } from './hdb-streets.fixture';
import { HDB_ABBREVIATIONS, hdbBlock, hdbStreet, streetKey } from './street';

/**
 * Road names exactly as OneMap returned them on 13 Nov 2026 for these blocks,
 * beside HDB's spelling of the same street in Property Information.
 */
const ONEMAP_TO_HDB: [onemap: string, hdb: string][] = [
  ['CLEMENTI AVENUE 3', 'CLEMENTI AVE 3'],
  ['COMMONWEALTH CRESCENT', "C'WEALTH CRES"],
  ["SAINT GEORGE'S ROAD", "ST. GEORGE'S RD"],
  ['UPPER BOON KENG ROAD', 'UPP BOON KENG RD'],
  ['JALAN BUKIT MERAH', 'JLN BT MERAH'],
  ['LORONG 7 TOA PAYOH', 'LOR 7 TOA PAYOH'],
  ['NORTH BRIDGE ROAD', 'NTH BRIDGE RD'],
  ['BEDOK SOUTH AVENUE 1', 'BEDOK STH AVE 1'],
  ['BUKIT BATOK CENTRAL', 'BT BATOK CTRL'],
  ['TANJONG PAGAR PLAZA', 'TG PAGAR PLAZA'],
  ['KAMPONG KAYU ROAD', 'KG KAYU RD'],
  ['TEBAN GARDENS ROAD', 'TEBAN GDNS RD'],
  ['TELOK BLANGAH HEIGHTS', 'TELOK BLANGAH HTS'],
  ['EVERTON PARK', 'EVERTON PK'],
  ['NEW MARKET ROAD', 'NEW MKT RD'],
  ['HOLLAND CLOSE', 'HOLLAND CL'],
  ['EUNOS CRESCENT', 'EUNOS CRES'],
  ['MARINE TERRACE', 'MARINE TER'],
  ['KIM TIAN PLACE', 'KIM TIAN PL'],
  ['WOODLANDS SQUARE', 'WOODLANDS SQ'],
  ['TENGAH GARDEN AVENUE', 'TENGAH GDN AVE'],
  ["KING GEORGE'S AVENUE", "KING GEORGE'S AVE"],
  ["QUEEN'S ROAD", "QUEEN'S RD"],
  ["JALAN MA'MOR", "JLN MA'MOR"],
  ['RACE COURSE ROAD', 'RACE COURSE RD'],
  ['MOUNT VERNON ROAD', 'MOUNT VERNON RD']
];

describe('hdbStreet', () => {
  it.each(ONEMAP_TO_HDB)('spells %s as HDB does', (onemap, hdb) => {
    expect(hdbStreet(onemap)).toBe(hdb);
  });

  it('leaves every street name in HDB Property Information exactly as it is', () => {
    const changed = HDB_STREETS.filter((s) => hdbStreet(s) !== s);
    expect(changed).toEqual([]);
  });

  it('brings every HDB street back from its words in full', () => {
    const full = Object.fromEntries(Object.entries(HDB_ABBREVIATIONS).map(([word, abbr]) => [abbr, word]));
    const spelledOut = (s: string) =>
      s
        .split(' ')
        .map((w, i) => (i === 0 && w === 'ST.' ? 'SAINT' : (full[w] ?? w)))
        .join(' ');
    expect(HDB_STREETS.filter((s) => hdbStreet(spelledOut(s)) !== s)).toEqual([]);
  });

  it('copes with how people type', () => {
    expect(hdbStreet('  clementi   avenue 3 ')).toBe('CLEMENTI AVE 3');
    expect(hdbStreet('King George’s Avenue')).toBe("KING GEORGE'S AVE");
    expect(hdbStreet('St Georges Rd')).toBe('ST. GEORGES RD');
    expect(hdbStreet('Bt. Batok West Ave. 6')).toBe('BT BATOK WEST AVE 6');
    expect(hdbStreet('Cwealth Ave West')).toBe("C'WEALTH AVE WEST");
  });

  it('tells Saint from Street by where it stands', () => {
    expect(hdbStreet('ANG MO KIO STREET 12')).toBe('ANG MO KIO ST 12');
    expect(hdbStreet("ST GEORGE'S LANE")).toBe("ST. GEORGE'S LANE");
    expect(hdbStreet('STIRLING ROAD')).toBe('STIRLING RD');
  });
});

describe('streetKey', () => {
  it('matches spellings that differ only in spacing and punctuation', () => {
    expect(streetKey('RACECOURSE ROAD')).toBe(streetKey('RACE COURSE RD'));
    expect(streetKey("St Georges Road")).toBe(streetKey("ST. GEORGE'S RD"));
    expect(streetKey('Commonwealth Close')).toBe(streetKey("C'WEALTH CL"));
  });

  it('keeps every HDB street distinct', () => {
    expect(new Set(HDB_STREETS.map(streetKey)).size).toBe(HDB_STREETS.length);
  });
});

describe('hdbBlock', () => {
  it('reads block numbers however they are written', () => {
    expect(hdbBlock('440A')).toBe('440A');
    expect(hdbBlock('blk 440a')).toBe('440A');
    expect(hdbBlock('Block 440 A')).toBe('440A');
    expect(hdbBlock('BLK. 9')).toBe('9');
  });
});

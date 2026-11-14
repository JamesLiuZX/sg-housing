/**
 * Street names as HDB writes them. OneMap spells roads out in full
 * ("CLEMENTI AVENUE 3", "SAINT GEORGE'S ROAD"); HDB's datasets abbreviate
 * ("CLEMENTI AVE 3", "ST. GEORGE'S RD"), and data.gov.sg filters match exact
 * strings only. These functions bridge the two.
 *
 * The word list is every abbreviation that occurs in HDB Property
 * Information's 657 street names (November 2026). Words HDB leaves in full
 * (LANE, WALK, WAY, LINK, VIEW, RISE, EAST, WEST, MOUNT, LOWER, NEW, ...) are
 * not listed and pass through unchanged.
 */

/** Full word to HDB's abbreviation. */
export const HDB_ABBREVIATIONS: Readonly<Record<string, string>> = Object.freeze({
  AVENUE: 'AVE',
  BUKIT: 'BT',
  CENTRAL: 'CTRL',
  CLOSE: 'CL',
  COMMONWEALTH: "C'WEALTH",
  CRESCENT: 'CRES',
  DRIVE: 'DR',
  GARDEN: 'GDN',
  GARDENS: 'GDNS',
  HEIGHTS: 'HTS',
  INDUSTRIAL: 'IND',
  JALAN: 'JLN',
  KAMPONG: 'KG',
  LORONG: 'LOR',
  MARKET: 'MKT',
  NORTH: 'NTH',
  PARK: 'PK',
  PLACE: 'PL',
  ROAD: 'RD',
  SOUTH: 'STH',
  SQUARE: 'SQ',
  STREET: 'ST',
  TANJONG: 'TG',
  TERRACE: 'TER',
  UPPER: 'UPP'
});

/**
 * Spellings people type that HDB writes another way. Kept short on purpose:
 * anything subtler is caught by comparing `streetKey`s instead.
 */
const VARIANTS: Readonly<Record<string, string>> = Object.freeze({
  CWEALTH: "C'WEALTH"
});

function words(name: string): string[] {
  return (
    name
      .normalize('NFKC')
      .toUpperCase()
      // Curly and back-tick apostrophes all become the straight one HDB uses.
      .replace(/[‘’ʼ`´]/g, "'")
      // Commas, brackets and the like separate words; apostrophes and full stops are handled per word.
      .replace(/[^A-Z0-9'. ]+/g, ' ')
      .split(' ')
      .map((w) => w.replace(/^'+|'+$/g, ''))
      .filter((w) => w && w !== '.')
  );
}

/**
 * A street name in HDB's spelling: "Clementi Avenue 3" becomes
 * "CLEMENTI AVE 3", "SAINT GEORGE'S ROAD" becomes "ST. GEORGE'S RD", and a
 * name already in HDB's spelling comes back unchanged.
 */
export function hdbStreet(name: string): string {
  const ws = words(name);
  return ws
    .map((raw, i) => {
      const w = raw.replace(/\.+$/, '');
      // Saint only ever leads a name (ST. GEORGE'S); Street only ever follows one (ANG MO KIO ST 12).
      if (i === 0 && ws.length > 1 && (w === 'SAINT' || w === 'ST') && !/^\d/.test(ws[1])) return 'ST.';
      return HDB_ABBREVIATIONS[w] ?? VARIANTS[w] ?? w;
    })
    .join(' ');
}

/**
 * A key for comparing street names from different sources: HDB's spelling
 * with spaces and punctuation removed, so "RACECOURSE ROAD", "Race Course Rd"
 * and "RACE COURSE RD" all agree, and so do "ST GEORGES RD" and "ST. GEORGE'S RD".
 */
export function streetKey(name: string): string {
  return hdbStreet(name).replace(/[^A-Z0-9]/g, '');
}

/** "blk 440a", "Block 440 A" and "440A" all become "440A". */
export function hdbBlock(blk: string): string {
  return blk
    .normalize('NFKC')
    .toUpperCase()
    .replace(/^\s*(?:BLK|BLOCK|BK)\.?\s*/, '')
    .replace(/[^A-Z0-9]/g, '');
}

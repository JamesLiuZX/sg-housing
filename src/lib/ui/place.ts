import { hdbStreet, type BlockFacts, type BlockLookup, type LayoutSeen, type Resale, type ResaleSummary, type Result, type Unavailable } from '../data';
import { pickTemplates, type Candidate } from '../plan/templates';
import { compassPoint } from '../sg/solar';

/**
 * What the interface says about a place: a block, its storeys and its flats.
 * Plain functions of the data layer's answers, kept out of the components so
 * every screen says the same thing the same way, and so it can be tested.
 * Facts only: no valuation, no adjectives.
 */

/** A found part of a lookup, or null. */
export function ok<T>(r: Result<T> | null | undefined): T | null {
  return r && r.status === 'ok' ? r.data : null;
}

/** "CLEMENTI AVENUE 3" as it reads on an envelope: "Clementi Ave 3". HDB's abbreviations, title case. */
export function roadName(road: string): string {
  return hdbStreet(road)
    .toLowerCase()
    .replace(/(^|[\s\-/(])([a-z])/g, (_, before: string, c: string) => before + c.toUpperCase());
}

/** Storeys as unit numbers write them: #07, #25. */
export function storeyTag(n: number): string {
  return `#${String(Math.max(0, Math.round(n))).padStart(2, '0')}`;
}

/** "$890,000". */
export function money(n: number): string {
  return `$${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09" to "Sep 2026". */
export function monthYear(month: string): string {
  const m = month.match(/^(\d{4})-(\d{2})/);
  return m ? `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}` : month;
}

/** "69 m²", "67.5 m²". */
export function sqmText(area: number): string {
  return `${Math.round(area * 10) / 10} m²`;
}

/** "4 ROOM" as it reads in a sentence: "4-room"; "EXECUTIVE": "Executive". */
export function typeWords(flatType: string): string {
  const t = flatType.trim().toUpperCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
  const n = t.match(/^(\d) ROOM$/);
  if (n) return `${n[1]}-room`;
  if (t === 'MULTI GENERATION') return 'Multi-generation';
  return t.charAt(0) + t.slice(1).toLowerCase();
}

/** One line of block facts, as parts to join with a middle dot: "30 storeys", "completed 2017", "208 flats". Missing facts are left out. */
export function factsLine(f: BlockFacts | null): string[] {
  if (!f) return [];
  const out: string[] = [];
  if (f.storeys > 0) out.push(`${f.storeys} ${f.storeys === 1 ? 'storey' : 'storeys'}`);
  if (f.yearCompleted > 0) out.push(`completed ${f.yearCompleted}`);
  if (f.dwellingUnits > 0) out.push(`${f.dwellingUnits} flats`);
  return out;
}

/** "25 TO 27" to [25, 27]. */
export function storeyRange(range: string): [number, number] | null {
  const m = range.match(/(\d+)\s*TO\s*(\d+)/i);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** The highest storey a block is known to have: its facts, or else the top of its highest resale range. */
export function storeysOf(lookup: BlockLookup | null): number | null {
  const facts = ok(lookup?.facts);
  if (facts && facts.storeys > 0) return facts.storeys;
  let top = 0;
  for (const s of ok(lookup?.resales)?.recent ?? []) top = Math.max(top, storeyRange(s.storeyRange)?.[1] ?? 0);
  return top || null;
}

/** Recent resales whose storey range contains this storey, newest first. */
export function salesAt(r: ResaleSummary | null, storey: number): Resale[] {
  if (!r) return [];
  return r.recent.filter((s) => {
    const g = storeyRange(s.storeyRange);
    return !!g && storey >= g[0] && storey <= g[1];
  });
}

/** Storey ranges with at least one recent sale, for marking the scale. */
export function soldRanges(r: ResaleSummary | null): [number, number][] {
  const seen = new Map<string, [number, number]>();
  for (const s of r?.recent ?? []) {
    const g = storeyRange(s.storeyRange);
    if (g) seen.set(`${g[0]}-${g[1]}`, g);
  }
  return [...seen.values()];
}

/** A sale in two plain lines: "#25 to #27 · 3-room · 69 m²" and "$890,000 · Sep 2026". */
export function saleWords(s: Resale): { where: string; what: string } {
  const g = storeyRange(s.storeyRange);
  const range = g ? `${storeyTag(g[0])} to ${storeyTag(g[1])}` : s.storeyRange.toLowerCase();
  return { where: `${range} · ${typeWords(s.flatType)} · ${sqmText(s.floorArea)}`, what: `${money(s.price)} · ${monthYear(s.month)}` };
}

/** "Faces WNW · 295°", as parts. */
export function facingWords(bearing: number): { point: string; deg: number } {
  const deg = ((Math.round(bearing) % 360) + 360) % 360;
  return { point: compassPoint(deg), deg };
}

// ── Flat types in a block ───────────────────────────────────────────────────

/** A kind of flat the block has, in the resale data's terms. */
export interface FlatOption {
  /** "4 ROOM". */
  flatType: string;
  /** This type's usual model in the block, when the records say: "Model A". */
  model?: string;
  /** This type's usual floor area in the block, m², when the records say. */
  areaSqm?: number;
}

const ORDER = ['1 ROOM', '2 ROOM', '3 ROOM', '4 ROOM', '5 ROOM', 'EXECUTIVE', 'MULTI-GENERATION', 'STUDIO'];
const ALL: FlatOption[] = ['2 ROOM', '3 ROOM', '4 ROOM', '5 ROOM', 'EXECUTIVE'].map((flatType) => ({ flatType }));

const rank = (t: string) => {
  const i = ORDER.indexOf(t);
  return i < 0 ? ORDER.length : i;
};

/** The floor area seen most often for a layout in the recent sales; else the middle of those on record. */
function usualArea(r: ResaleSummary, l: LayoutSeen): number | undefined {
  const counts = new Map<number, number>();
  for (const s of r.recent) {
    if (s.flatType === l.flatType && s.flatModel === l.flatModel && s.floorArea > 0) counts.set(s.floorArea, (counts.get(s.floorArea) ?? 0) + 1);
  }
  let best: number | undefined;
  let most = 0;
  for (const [area, n] of counts) if (n > most) [best, most] = [area, n];
  return best ?? l.floorAreas[Math.floor(l.floorAreas.length / 2)];
}

/**
 * The flat types to offer for a block, smallest first: those in its resale
 * records (with the usual model and area of each), else those in its unit
 * mix, else every common type.
 */
export function flatOptions(lookup: BlockLookup | null): FlatOption[] {
  const r = ok(lookup?.resales);
  if (r && r.layouts.length) {
    const byType = new Map<string, FlatOption>();
    // Layouts come most common first, so the first of each type is its usual model.
    for (const l of r.layouts) if (!byType.has(l.flatType)) byType.set(l.flatType, { flatType: l.flatType, model: l.flatModel, areaSqm: usualArea(r, l) });
    return [...byType.values()].sort((a, b) => rank(a.flatType) - rank(b.flatType));
  }
  const units = ok(lookup?.facts)?.units.filter((u) => u.type !== 'OTHER') ?? [];
  if (units.length) return units.map((u) => ({ flatType: u.type })).sort((a, b) => rank(a.flatType) - rank(b.flatType));
  return ALL;
}

/** The type a visitor most likely came for: the block's most resold, else its most built, else a 4-room. */
export function usualOption(lookup: BlockLookup | null, options: FlatOption[]): FlatOption {
  const common = ok(lookup?.resales)?.layouts[0]?.flatType;
  const units = ok(lookup?.facts)?.units ?? [];
  const most = [...units].sort((a, b) => b.sold + b.rental - (a.sold + a.rental))[0]?.type;
  return (
    options.find((o) => o.flatType === common) ??
    options.find((o) => o.flatType === most) ??
    options.find((o) => o.flatType === '4 ROOM') ??
    options[0] ?? { flatType: '4 ROOM' }
  );
}

/** The storey to start on: the middle of the block's latest sale, so its facts show at once; else about two-thirds up. Never the void deck. */
export function usualStorey(lookup: BlockLookup | null, storeys: number): number {
  const g = storeyRange(ok(lookup?.resales)?.recent[0]?.storeyRange ?? '');
  const n = g ? Math.round((g[0] + g[1]) / 2) : Math.round(storeys * 0.6);
  return Math.min(storeys, Math.max(Math.min(2, storeys), n));
}

/** The layout that stands in for a flat type in a block, with how well it fits and why. */
export function candidateFor(o: FlatOption, lookup: BlockLookup | null): Candidate {
  const lease = ok(lookup?.resales)?.leaseStart ?? (ok(lookup?.facts)?.yearCompleted || null);
  const [best] = pickTemplates({ flatType: o.flatType, model: o.model, areaSqm: o.areaSqm, leaseStart: lease ?? undefined });
  return best;
}

// ── When a service does not answer ──────────────────────────────────────────

/** Why a search could not be made, in a sentence that names the service. */
export function searchTrouble(u: Unavailable): string {
  switch (u.reason) {
    case 'network':
      return 'Address search needs a connection, and OneMap did not answer.';
    case 'timeout':
      return 'OneMap took too long to answer.';
    case 'rate-limited':
      return 'OneMap is busy. Try again in a minute.';
    case 'auth':
      return 'OneMap is turning searches away for now.';
    default:
      return 'OneMap is having trouble right now.';
  }
}

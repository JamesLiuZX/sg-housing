import { hero4room } from '../hero4room';
import type { Plan } from '../types';
import { bto3room68 } from './bto3room68';
import { bto5room113 } from './bto5room113';

/**
 * The template library: original drawings of the layouts most HDB flats
 * follow, each tagged in the resale dataset's own words with what it stands
 * for, so an address lookup can find the closest typical layout and say
 * honestly how close it is.
 *
 * The models, areas and lease years come from the resale records (data.gov.sg)
 * of the last 24 months for flats of the same type and era: the middle 90% of
 * floor areas, and the lease years in which this design was being built.
 */

/** `flat_type`, as the resale dataset writes it. */
export type FlatType = '2 ROOM' | '3 ROOM' | '4 ROOM' | '5 ROOM' | 'EXECUTIVE';

export interface Template {
  id: string;
  plan: Plan;
  flatType: FlatType;
  /** `flat_model` values, as the resale dataset writes them, that this layout stands for. */
  models: string[];
  /** Floor areas this layout stands for, m². */
  area: [number, number];
  /** Years of lease start this layout stands for. */
  lease: [number, number];
  /** One plain sentence on what the layout is. */
  blurb: string;
}

export const templates: Template[] = [
  {
    id: 'bto-4room-93',
    plan: hero4room,
    flatType: '4 ROOM',
    models: ['Model A', 'Premium Apartment', 'DBSS', 'Model A2', 'Type S1'],
    area: [86, 97],
    lease: [2003, 2026],
    blurb: 'A 4-room BTO flat of the current generation: three bedrooms on the main facade, household shelter by the door.'
  },
  {
    id: 'bto-3room-68',
    plan: bto3room68,
    flatType: '3 ROOM',
    models: ['Model A', 'Premium Apartment', 'DBSS'],
    area: [62, 71],
    lease: [2003, 2026],
    blurb: 'A 3-room BTO flat of the current generation: two bedrooms, an open kitchen joined to the dining area, household shelter by the door.'
  },
  {
    id: 'bto-5room-113',
    plan: bto5room113,
    flatType: '5 ROOM',
    models: ['Improved', 'Premium Apartment', 'DBSS'],
    area: [105, 120],
    lease: [2003, 2026],
    blurb: 'A 5-room BTO flat of the current generation: three bedrooms, a large living and dining room with a study nook, household shelter off the hallway.'
  }
];

export function templateById(id: string): Template | undefined {
  return templates.find((t) => t.id === id);
}

// ── Choosing a layout for a flat ────────────────────────────────────────────

/** What is known about a flat, in the resale dataset's terms. Everything but the type may be missing. */
export interface FlatFacts {
  /** "4 ROOM". Case and hyphens do not matter. */
  flatType: string;
  /** "Model A", "Improved". */
  model?: string;
  areaSqm?: number;
  /** The year the lease began. */
  leaseStart?: number;
}

/**
 * How much to make of a match. `good`: the typical layout for this flat.
 * `close`: the closest typical layout, with details that may differ.
 * `loose`: the nearest the library has, and the flat is probably arranged differently.
 */
export type Fit = 'good' | 'close' | 'loose';

export interface Candidate {
  template: Template;
  /** 0 to 1. */
  confidence: number;
  fit: Fit;
  /** What matches and what does not, in plain words, for the interface to show as it is. */
  reason: string;
}

/** Weight given to a fact that is not known: neither a match nor a miss. */
const UNKNOWN = 0.85;
/** Weight given to a model the layout was not drawn for: types share their arrangement more than their model. */
const OTHER_MODEL = 0.6;
/** Square metres outside a layout's range at which a match drops to about a third. */
const AREA_SLACK = 4;
/** Years outside a layout's range at which a match drops to about a third. */
const LEASE_SLACK = 6;
/** The most a layout of another flat type can score. */
const OTHER_TYPE = 0.2;

const norm = (s: string) => s.trim().toUpperCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
const known = (n: number | undefined): n is number => typeof n === 'number' && Number.isFinite(n);
const outside = (v: number, [lo, hi]: [number, number]) => Math.max(0, lo - v, v - hi);
const falloff = (d: number, slack: number) => Math.exp(-((d / slack) ** 2));

/** "4 ROOM" as it reads in a sentence: "4-room". */
function typeWords(flatType: string): string {
  const n = norm(flatType).match(/^(\d) ROOM$/);
  return n ? `${n[1]}-room` : norm(flatType).toLowerCase();
}

function joinAnd(parts: string[]): string {
  if (parts.length < 2) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** Clauses that carry commas of their own read better with one before the last "and". */
function joinClauses(parts: string[]): string {
  if (parts.length < 2) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

function fitOf(confidence: number): Fit {
  return confidence >= 0.75 ? 'good' : confidence >= 0.4 ? 'close' : 'loose';
}

function sameType(t: Template, f: FlatFacts): Candidate {
  const matched = ['flat type'];
  const misses: string[] = [];
  const missing: string[] = [];
  let confidence = 1;

  if (f.model) {
    const listed = t.models.some((m) => norm(m) === norm(f.model!));
    confidence *= listed ? 1 : OTHER_MODEL;
    if (listed) matched.push('model');
    else misses.push(`it is a ${f.model} flat, and this layout is drawn for ${joinAnd(t.models)}`);
  } else {
    confidence *= UNKNOWN;
    missing.push('model');
  }

  if (known(f.areaSqm)) {
    const d = outside(f.areaSqm, t.area);
    confidence *= falloff(d, AREA_SLACK);
    if (!d) matched.push('floor area');
    else misses.push(`it is ${f.areaSqm} m², ${f.areaSqm < t.area[0] ? 'smaller' : 'bigger'} than the ${t.area[0]} to ${t.area[1]} m² this layout covers`);
  } else {
    confidence *= UNKNOWN;
    missing.push('floor area');
  }

  if (known(f.leaseStart)) {
    const d = outside(f.leaseStart, t.lease);
    confidence *= falloff(d, LEASE_SLACK);
    if (!d) matched.push('lease start');
    else misses.push(`its lease began in ${f.leaseStart}, ${f.leaseStart < t.lease[0] ? 'earlier' : 'later'} than the ${t.lease[0]} to ${t.lease[1]} this layout covers`);
  } else {
    confidence *= UNKNOWN;
    missing.push('lease start');
  }

  const sentences = [`Matches on ${joinAnd(matched)}.`];
  if (misses.length) sentences.push(`But ${joinClauses(misses)}.`);
  if (missing.length) sentences.push(`The ${joinAnd(missing)} would make the match surer.`);
  return { template: t, confidence, fit: fitOf(confidence), reason: sentences.join(' ') };
}

function otherType(t: Template, f: FlatFacts): Candidate {
  // Nothing of this type yet: offer the nearest in size, and say plainly that it is a stand-in.
  const size = known(f.areaSqm) ? falloff(Math.abs(f.areaSqm - t.plan.areaSqm), 15) : 0.5;
  const confidence = OTHER_TYPE * size;
  const reason = `There is no ${typeWords(f.flatType)} layout yet. This ${typeWords(t.flatType)} layout of about ${t.plan.areaSqm} m² is the nearest we have, and your flat is probably arranged differently.`;
  return { template: t, confidence, fit: 'loose', reason };
}

/**
 * Layouts for a flat, best first. Layouts of the flat's own type are ranked
 * on model, floor area and lease start; layouts of other types appear only
 * when the library has none of its type, ranked by size. Every candidate
 * says why it was chosen, so the interface can call it "the typical layout"
 * or "the closest typical layout" as the confidence allows.
 */
export function pickTemplates(facts: FlatFacts, library: Template[] = templates): Candidate[] {
  const own = library.filter((t) => norm(t.flatType) === norm(facts.flatType));
  const out = own.length ? own.map((t) => sameType(t, facts)) : library.map((t) => otherType(t, facts));
  const area = facts.areaSqm;
  // Equal scores fall back to the nearer stated size, then to library order.
  return out
    .map((c, i) => ({ c, i, gap: known(area) ? Math.abs(area - c.template.plan.areaSqm) : 0 }))
    .sort((p, q) => q.c.confidence - p.c.confidence || p.gap - q.gap || p.i - q.i)
    .map((x) => x.c);
}

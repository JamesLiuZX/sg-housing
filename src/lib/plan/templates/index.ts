import { hero4room } from '../hero4room';
import { bto3room68 } from './bto3room68';
import { bto5room113 } from './bto5room113';
import type { Plan } from '../types';

/**
 * The template library: original drawings of the layouts most HDB flats
 * follow, each tagged with the resale dataset's own words for what it
 * covers, so an address lookup can find the closest typical layout.
 */

/** `flat_type` as the resale dataset writes it. */
export type FlatType = '2 ROOM' | '3 ROOM' | '4 ROOM' | '5 ROOM' | 'EXECUTIVE';

export interface Template {
  id: string;
  plan: Plan;
  flatType: FlatType;
  /** `flat_model` values, as the resale dataset writes them, that this layout stands for. */
  models: string[];
  /** Floor areas this layout stands for, m², from the resale records of its era. */
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
    models: ['Model A', 'Premium Apartment', 'Model A2', 'DBSS', 'Improved'],
    area: [88, 97],
    lease: [2003, 2026],
    blurb: 'A 4-room BTO flat of the current generation: three bedrooms on the main facade, household shelter by the door.'
  },
  {
    id: 'bto-3room-68',
    plan: bto3room68,
    flatType: '3 ROOM',
    models: ['Model A', 'Premium Apartment', 'Improved', 'Simplified'],
    area: [63, 72],
    lease: [2003, 2026],
    blurb: 'A 3-room BTO flat of the current generation: two bedrooms, an open kitchen joined to the dining area, household shelter by the door.'
  },
  {
    id: 'bto-5room-113',
    plan: bto5room113,
    flatType: '5 ROOM',
    models: ['Improved', 'Premium Apartment', 'Model A', 'DBSS'],
    area: [107, 118],
    lease: [2003, 2026],
    blurb: 'A 5-room BTO flat of the current generation: three bedrooms, a large living and dining room with a study nook, household shelter off the hallway.'
  }
];

export function templateById(id: string): Template | undefined {
  return templates.find((t) => t.id === id);
}

import { SQFT_PER_SQM } from '../plan/geometry';
import { clock } from '../sg/solar';

/** Floor area the way it is quoted here: one decimal in m², whole sq ft beside it. */
export function sqm(area: number): string {
  return area.toFixed(1);
}

export function sqft(area: number): string {
  return String(Math.round(area * SQFT_PER_SQM));
}

/** "3:40 – 6:50 pm", or "11:20 am – 1:05 pm" when the span crosses noon. */
export function clockRange(from: number, to: number): string {
  const a = clock(from);
  const b = clock(to);
  const sameHalf = a.slice(-2) === b.slice(-2);
  return `${sameHalf ? a.slice(0, -3) : a} – ${b}`;
}

/** "a", "a and b", "a, b and c". */
export function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** The names agents and floor plans use when a room is too small on screen for its full name. */
export function shortName(name: string): string {
  return name
    .replace(/^Master bedroom$/i, 'MBR')
    .replace(/^Bedroom (\d+)$/i, 'Bed $1')
    .replace(/^Master bath$/i, 'MBR bath')
    .replace(/^Household shelter$/i, 'Shelter')
    .replace(/^Service yard$/i, 'Yard');
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
export const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
] as const;

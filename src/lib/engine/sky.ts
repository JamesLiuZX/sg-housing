/**
 * The colour of the page behind the model at any hour: paper by day, warm
 * peach as the sun nears the horizon, deep ink at night. The interface paints
 * the page with these stops, and the engine hazes distant blocks and fills
 * the sky outside the windows with the same ones, so the scene and the page
 * never disagree.
 */

export type RGB = readonly [number, number, number];

/** Three stops of a soft vignette: centre, body, edge. 0 to 255, sRGB. */
export type SkyStops = readonly [RGB, RGB, RGB];

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const stops = (a: string, b: string, c: string): SkyStops => [hex(a), hex(b), hex(c)];

export const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const smooth = (t: number) => {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
};

const DAY = stops('#faf7f1', '#f1ede5', '#e3ddd0');
const GOLD = stops('#fce8d2', '#f5d2b1', '#e8b48e');
/** The few minutes around sunset. Without this stop, peach fades to ink through a muddy grey. */
const DUSK = stops('#a08078', '#84696b', '#5f4d58');
const NIGHT = stops('#1c2132', '#12151f', '#0a0c13');

/** day: 0 night to 1 full daylight. gold: 1 at the horizon, 0 with the sun high. */
export function skyStops(day: number, gold: number): SkyStops {
  const warm = Math.pow(Math.min(1, Math.max(0, gold)), 1.6);
  const one = (i: 0 | 1 | 2): RGB => {
    const lit = mixRGB(DAY[i], GOLD[i], warm);
    return day >= 0.5 ? mixRGB(DUSK[i], lit, smooth((day - 0.5) * 2)) : mixRGB(NIGHT[i], DUSK[i], smooth(day * 2));
  };
  return [one(0), one(1), one(2)];
}

import { describe, expect, it } from 'vitest';
import type { PathPoint, Sun } from '../sg/solar';
import { litAt, litShare } from './site';

describe('litShare', () => {
  it('lights four to six flats in ten at every hour', () => {
    for (let m = 0; m < 24 * 60; m += 15) {
      expect(litShare(m)).toBeGreaterThanOrEqual(0.4);
      expect(litShare(m)).toBeLessThanOrEqual(0.6);
    }
  });

  it('lights more flats at eight in the evening than after midnight', () => {
    expect(litShare(20 * 60)).toBeCloseTo(0.6, 5);
    expect(litShare(0)).toBeCloseTo(0.42, 5);
    expect(litShare(2 * 60)).toBeLessThan(litShare(20 * 60));
    expect(litShare(23 * 60)).toBeLessThan(litShare(21 * 60));
  });

  it('runs on round the clock', () => {
    expect(litShare(24 * 60 + 30)).toBeCloseTo(litShare(30), 10);
    expect(litShare(-60)).toBeCloseTo(litShare(23 * 60), 10);
  });
});

describe('litAt', () => {
  const sun = (altitude: number, azimuth: number): Sun => ({ altitude, azimuth });
  const at = (minutes: number, altitude: number, azimuth: number): PathPoint => ({ minutes, altitude, azimuth });

  it('takes the hour from the point of the day path nearest the sun', () => {
    const path = [at(19 * 60, -0.1, 4.6), at(21 * 60, -0.4, 4.9), at(1 * 60, -0.9, 0.2)];
    expect(litAt(sun(-0.42, 4.88), path)).toBeCloseTo(litShare(21 * 60), 10);
    expect(litAt(sun(-0.88, 0.25), path)).toBeCloseTo(litShare(60), 10);
  });

  it('falls back on the evening with no path', () => {
    expect(litAt(sun(-0.5, 1), [])).toBeCloseTo(litShare(20 * 60), 10);
  });
});

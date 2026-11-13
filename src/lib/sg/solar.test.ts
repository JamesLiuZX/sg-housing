import { describe, expect, it } from 'vitest';
import { sunAt, sunTimes } from './solar';

const DEG = 180 / Math.PI;

describe('sun over Singapore', () => {
  it('stands 67.9° high to the north at solar noon on the June solstice', () => {
    const date = { year: 2026, month: 5, day: 21 };
    const noon = sunAt(date, sunTimes(date).noon);
    expect(noon.altitude * DEG).toBeCloseTo(67.9, 0);
    // Due north is azimuth 0, which wraps; compare the cosine instead of the angle.
    expect(Math.cos(noon.azimuth)).toBeGreaterThan(0.99);
  });

  it('stands 65.2° high to the south at solar noon on the December solstice', () => {
    const date = { year: 2026, month: 11, day: 21 };
    const noon = sunAt(date, sunTimes(date).noon);
    expect(noon.altitude * DEG).toBeCloseTo(65.2, 0);
    expect(Math.cos(noon.azimuth)).toBeLessThan(-0.99);
  });

  it('sets toward the north-west in June and the south-west in December', () => {
    const june = { year: 2026, month: 5, day: 21 };
    const dec = { year: 2026, month: 11, day: 21 };
    expect(sunAt(june, sunTimes(june).set).azimuth * DEG).toBeCloseTo(293.5, 0);
    expect(sunAt(dec, sunTimes(dec).set).azimuth * DEG).toBeCloseTo(246.5, 0);
  });

  it('puts solar noon near 1 pm, because Singapore keeps UTC+8', () => {
    const noon = sunTimes({ year: 2026, month: 5, day: 21 }).noon;
    expect(noon).toBeGreaterThan(12 * 60 + 45);
    expect(noon).toBeLessThan(13 * 60 + 20);
  });
});

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DOME_CONE, SUN_DISC, domeSample, halton, jitterSample, sunSample } from './accumulate';

const DEG = Math.PI / 180;
const counts = [12, 16, 32, 48];

describe('settled samples', () => {
  it('keeps the Halton sequence in the unit interval and distinct', () => {
    const seen = new Set<number>();
    for (let k = 1; k <= 64; k++) {
      const h = halton(k, 2);
      expect(h).toBeGreaterThan(0);
      expect(h).toBeLessThan(1);
      seen.add(h);
    }
    expect(seen.size).toBe(64);
  });

  it('jitters the camera by less than a pixel, centred on the pixel, for any count', () => {
    for (const n of counts) {
      let sx = 0;
      let sy = 0;
      for (let k = 1; k <= n; k++) {
        const [x, y] = jitterSample(k);
        expect(Math.hypot(x, y)).toBeLessThanOrEqual(0.75 + 1e-9);
        sx += x;
        sy += y;
      }
      expect(Math.abs(sx / n)).toBeLessThan(0.08);
      expect(Math.abs(sy / n)).toBeLessThan(0.08);
    }
  });

  it('moves the sun within its disc, spread round its true direction', () => {
    const sun = new THREE.Vector3(Math.sin(1.9) * Math.cos(0.3), Math.sin(0.3), -Math.cos(1.9) * Math.cos(0.3));
    for (const n of counts) {
      const mean = new THREE.Vector3();
      let far = 0;
      for (let k = 1; k <= n; k++) {
        const d = sunSample(k, sun, new THREE.Vector3());
        expect(d.length()).toBeCloseTo(1, 9);
        const off = Math.acos(Math.min(1, d.dot(sun))) / DEG;
        expect(off).toBeLessThanOrEqual(SUN_DISC + 1e-6);
        far = Math.max(far, off);
        mean.add(d);
      }
      // Centred on the true sun, and reaching out across the disc rather than bunched at its middle.
      expect(Math.acos(Math.min(1, mean.normalize().dot(sun))) / DEG).toBeLessThan(SUN_DISC * 0.2);
      expect(far).toBeGreaterThan(SUN_DISC * 0.8);
    }
  });

  it('draws the dome from its cone round the zenith, cosine-weighted', () => {
    const a = DOME_CONE * DEG;
    // The mean cosine to the zenith of a cosine-weighted cone.
    const want = ((2 / 3) * (1 - Math.cos(a) ** 3)) / Math.sin(a) ** 2;
    for (const n of counts) {
      let cos = 0;
      const across = new THREE.Vector2();
      for (let k = 1; k <= n; k++) {
        const d = domeSample(k, new THREE.Vector3());
        expect(d.length()).toBeCloseTo(1, 9);
        expect(Math.acos(d.y) / DEG).toBeLessThanOrEqual(DOME_CONE + 1e-6);
        cos += d.y;
        across.x += d.x;
        across.y += d.z;
      }
      expect(cos / n).toBeCloseTo(want, 2);
      // No side of the softbox favoured.
      expect(across.length() / n).toBeLessThan(0.06);
    }
  });
});

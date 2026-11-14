import { describe, expect, it } from 'vitest';
import { polyArea } from '../geometry';
import { validatePlan } from '../validate';
import { templateById, templates } from './index';

describe('template library', () => {
  it('has one entry per id, and each entry is the plan it names', () => {
    const ids = templates.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of templates) {
      expect(t.plan.id).toBe(t.id);
      expect(templateById(t.id)).toBe(t);
    }
  });

  for (const t of templates) {
    describe(t.id, () => {
      it('validates with nothing to report', () => {
        expect(validatePlan(t.plan)).toEqual([]);
      });

      it('claims an area range and lease range that contain the drawing itself', () => {
        const drawn = t.plan.rooms.reduce((s, r) => s + polyArea(r.poly), 0) / 1e6;
        expect(t.area[0]).toBeLessThanOrEqual(t.plan.areaSqm);
        expect(t.area[1]).toBeGreaterThanOrEqual(t.plan.areaSqm);
        expect(Math.abs(drawn - t.plan.areaSqm) / t.plan.areaSqm).toBeLessThanOrEqual(0.03);
        expect(t.lease[0]).toBeLessThanOrEqual(t.lease[1]);
      });
    });
  }
});

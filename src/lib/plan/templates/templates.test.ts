import { describe, expect, it } from 'vitest';
import { polyArea } from '../geometry';
import { validatePlan } from '../validate';
import { pickTemplates, templateById, templates, type Template } from './index';

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

describe('pickTemplates', () => {
  const best = (...args: Parameters<typeof pickTemplates>) => pickTemplates(...args)[0];

  it('gives a 4-room Model A of 87 m² leased in 2018 the current BTO 4-room, as a good match', () => {
    const c = best({ flatType: '4 ROOM', model: 'Model A', areaSqm: 87, leaseStart: 2018 });
    expect(c.template.id).toBe('bto-4room-93');
    expect(c.fit).toBe('good');
    expect(c.confidence).toBeGreaterThan(0.9);
    expect(c.reason).toBe('Matches on flat type, model, floor area and lease start.');
  });

  it('says plainly that the BTO 4-room is a poor stand-in for a 104 m² Model A leased in 1990', () => {
    const c = best({ flatType: '4 ROOM', model: 'Model A', areaSqm: 104, leaseStart: 1990 });
    expect(c.template.id).toBe('bto-4room-93');
    expect(c.fit).toBe('loose');
    expect(c.confidence).toBeLessThan(0.1);
    expect(c.reason).toBe(
      'Matches on flat type and model. But it is 104 m², bigger than the 86 to 97 m² this layout covers, and its lease began in 1990, earlier than the 2003 to 2026 this layout covers.'
    );
  });

  it('ranks an older layout first for an older flat, once the library has one', () => {
    // A stand-in for the late-1980s 4-room Model A, so the ranking can be tested before that drawing exists.
    const older: Template = {
      ...templates[0],
      id: 'a-4room-104',
      models: ['Model A', 'Improved'],
      area: [100, 110],
      lease: [1985, 1997],
      blurb: 'A 4-room Model A of the late 1980s.'
    };
    const library = [...templates, older];
    expect(best({ flatType: '4 ROOM', model: 'Model A', areaSqm: 104, leaseStart: 1990 }, library).template.id).toBe('a-4room-104');
    expect(best({ flatType: '4 ROOM', model: 'Model A', areaSqm: 87, leaseStart: 2018 }, library).template.id).toBe('bto-4room-93');
    // The floor area alone is enough to tell them apart, and the lease alone too.
    expect(best({ flatType: '4 ROOM', areaSqm: 105 }, library).template.id).toBe('a-4room-104');
    expect(best({ flatType: '4 ROOM', leaseStart: 2016 }, library).template.id).toBe('bto-4room-93');
    // Both are offered, best first.
    expect(pickTemplates({ flatType: '4 ROOM', model: 'Model A', areaSqm: 104, leaseStart: 1990 }, library).map((c) => c.template.id)).toEqual(['a-4room-104', 'bto-4room-93']);
  });

  it('matches current 3-room and 5-room flats to their layouts', () => {
    expect(best({ flatType: '3 ROOM', model: 'Model A', areaSqm: 68, leaseStart: 2016 }).template.id).toBe('bto-3room-68');
    expect(best({ flatType: '3 ROOM', model: 'Model A', areaSqm: 68, leaseStart: 2016 }).fit).toBe('good');
    expect(best({ flatType: '5 ROOM', model: 'Improved', areaSqm: 113, leaseStart: 2019 }).template.id).toBe('bto-5room-113');
    expect(best({ flatType: '5 ROOM', model: 'Improved', areaSqm: 113, leaseStart: 2019 }).fit).toBe('good');
  });

  it('reads flat types and models however they are written', () => {
    const c = best({ flatType: '4-room', model: 'MODEL A', areaSqm: 93, leaseStart: 2020 });
    expect(c.template.id).toBe('bto-4room-93');
    expect(c.fit).toBe('good');
  });

  it('asks for more when only the flat type is known', () => {
    const c = best({ flatType: '3 ROOM' });
    expect(c.template.id).toBe('bto-3room-68');
    expect(c.fit).toBe('close');
    expect(c.reason).toBe('Matches on flat type. The model, floor area and lease start would make the match surer.');
  });

  it('marks a New Generation 3-room of 1980 as a loose match, naming the difference', () => {
    const c = best({ flatType: '3 ROOM', model: 'New Generation', areaSqm: 67, leaseStart: 1980 });
    expect(c.template.id).toBe('bto-3room-68');
    expect(c.fit).toBe('loose');
    expect(c.reason).toContain('it is a New Generation flat');
    expect(c.reason).toContain('1980');
  });

  it('offers the nearest size, marked loose, for a flat type the library does not have', () => {
    const list = pickTemplates({ flatType: 'EXECUTIVE', model: 'Apartment', areaSqm: 145, leaseStart: 1995 });
    expect(list[0].template.id).toBe('bto-5room-113');
    expect(list.every((c) => c.fit === 'loose' && c.confidence <= 0.2)).toBe(true);
    expect(list[0].reason).toContain('There is no executive layout yet.');
  });
});

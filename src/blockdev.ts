/**
 * Block stage harness. The block among its neighbours with no interface, so
 * the block stage and the push-in can be developed and screenshotted on
 * their own. Open /block.html.
 *
 * Query:
 *   ?postal=121440    the block (121440, 440A Clementi Ave 3, also works with no index from the bundled snapshot)
 *   ?storeys=30       its storeys (default: HDB's figure for the bundled block, else 12)
 *   ?storey=25        marks a storey
 *   ?facing=250       puts the flat on the side looking closest to this bearing; ?along=0.5 how far along it
 *   ?m=1020&month=5   minutes of the day and month (0 to 11): 5 pm in June by default
 *   ?plan=bto-3room-68&mirror=1   another layout, or its mirror
 *   ?push=1.8         holds the push-in at this many seconds (0 to 3.6)
 *   ?flat=1           lands in the flat, skipping the push-in (as reduced motion would)
 *   ?go=1             plays the push-in; ?skip=1 skips every animation (the same as ?flat=1 with ?go=1)
 *   ?inset=150        reserves room at the bottom, as the interface's controls do
 *   ?view=unit        turns the block to show the flat's side
 *
 * window.blk drives it from tests: setTime, storey, unit, push, enter, exit, jump, plan, verify, stats.
 */
import * as THREE from 'three';
import { DEMO_POSTAL, facadeFacing, loadBlock, lookupDemo, type Block } from './lib/data';
import { Viewer, type FacadePick } from './lib/engine/Viewer';
import { floorY } from './lib/engine/site';
import { mainFacade, northForFacing } from './lib/plan/facing';
import { boundsOf } from './lib/plan/geometry';
import { mirror } from './lib/plan/mirror';
import { templateById, templates } from './lib/plan/templates';
import type { Plan } from './lib/plan/types';
import { dayPath, sunAt, type SunDate } from './lib/sg/solar';
import { Atmosphere } from './lib/ui/atmosphere';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
const date: SunDate = { year: 2026, month: num('month', 5), day: 21 };
const minutes = num('m', 17 * 60);
const postal = q.get('postal') ?? DEMO_POSTAL;
const inset = num('inset', 0);
const skip = q.get('skip') === '1';

function planFor(id: string | null, flip: boolean): Plan {
  const t = (id && templateById(id)) || templates[0];
  return flip ? mirror(t.plan) : t.plan;
}
let plan = planFor(q.get('plan'), q.get('mirror') === '1');

async function block(): Promise<{ block: Block; storeys: number }> {
  const r = await loadBlock(postal);
  const demo = postal === DEMO_POSTAL ? lookupDemo() : null;
  const found = r.status === 'ok' ? r.data : demo?.block.data;
  if (!found) throw new Error(`No block for ${postal}: ${r.status}`);
  return { block: found, storeys: num('storeys', demo?.facts.data.storeys ?? 12) };
}

const atmosphere = new Atmosphere(document.documentElement, document.getElementById('sky')!);
const picks: FacadePick[] = [];
const scrubbed: number[] = [];
let marked = num('storey', 0);

const viewer = new Viewer(document.getElementById('c') as HTMLCanvasElement, plan, {
  atmosphere: (day, gold) => atmosphere.set(day, gold),
  storey(n) {
    marked = n;
    scrubbed.push(n);
  },
  facade(pick) {
    // What the interface does with a tap: turn the flat to face that side and stand it there.
    picks.push(pick);
    place(pick.facade.bearing, pick.along);
  }
});

function setTime(m: number, month = date.month): void {
  const d = { ...date, month };
  viewer.setDayPath(dayPath(d));
  viewer.setSun(sunAt(d, m));
}
setTime(minutes);

/** Stands the flat on the side looking closest to `bearing`, turning it to face that side. */
function place(bearing: number, along = 0.5): void {
  const facade = facadeFacing(viewer.blockFacades, bearing);
  if (!facade) return;
  viewer.setBearing(northForFacing(plan, facade.bearing));
  viewer.setUnit({ storey: marked || 2, facade, along });
}

/**
 * Checks the placement in the live scene: the flat's window normal, the
 * facade's normal and the compass for the facade's bearing must agree, the
 * window's outer face must lie on the facade's line at the unit's storey, and
 * the sun must reach block and flat from one true direction.
 */
function verify(storey: number, facadeIndex: number, along: number): Record<string, number> {
  const f = viewer.blockFacades[facadeIndex];
  const north = northForFacing(plan, f.bearing);
  viewer.setBearing(north);
  viewer.setUnit({ storey, facade: f, along });
  const DEG = Math.PI / 180;
  const up = new THREE.Vector3(0, 1, 0);
  const main = mainFacade({ ...plan, north })!;
  const win = new THREE.Vector3(main.out[0], 0, main.out[1]);
  const o = viewer.sitePoint(0, 0, 0);
  const facadeN = viewer.sitePoint(Math.sin(f.bearing * DEG), Math.cos(f.bearing * DEG), 0).sub(o);
  const compass = new THREE.Vector3(Math.sin(f.bearing * DEG), 0, -Math.cos(f.bearing * DEG)).applyAxisAngle(up, north * DEG);
  // The flat's own frame, as the scene builder draws it: plan millimetres about the middle of its bounds.
  const b = boundsOf(plan);
  const half = Math.max(...main.walls.map((id) => plan.walls.find((w) => w.id === id)!.t)) / 2;
  const px = ((main.a[0] + main.b[0]) / 2 + main.out[0] * half - (b.minX + b.maxX) / 2) / 1000;
  const pz = ((main.a[1] + main.b[1]) / 2 + main.out[1] * half - (b.minY + b.maxY) / 2) / 1000;
  const point = new THREE.Vector3(px, 0, pz);
  const a = viewer.sitePoint(f.a[0], f.a[1], floorY(storey));
  const ab = viewer.sitePoint(f.b[0], f.b[1], floorY(storey)).sub(a);
  const rel = point.clone().sub(a);
  const t = rel.dot(ab) / ab.lengthSq();
  const sunTrue = new THREE.Vector3(Math.sin(1.1) * Math.cos(0.3), Math.sin(0.3), -Math.cos(1.1) * Math.cos(0.3));
  const sunWorld = sunTrue.clone().applyAxisAngle(up, north * DEG);
  const sunSite = viewer.sitePoint(sunTrue.x, -sunTrue.z, sunTrue.y).sub(o);
  return {
    facadeBearing: f.bearing,
    north,
    windowBearing: main.bearing,
    windowVsFacade: win.dot(facadeN),
    windowVsCompass: win.dot(compass),
    offLine: rel.sub(ab.clone().multiplyScalar(t)).length(),
    floor: a.y,
    along: t,
    sunAgreement: sunWorld.dot(sunSite)
  };
}

const api = {
  viewer,
  get plan() {
    return plan;
  },
  picks,
  scrubbed,
  ready: false,
  setTime,
  storey(n: number) {
    marked = n;
    viewer.setStorey(n);
  },
  place,
  push: (t: number) => viewer.scrubPush(t, inset),
  enter: () => viewer.enterFlat(inset),
  exit: () => viewer.exitToBlock(inset),
  jump: () => viewer.jump(inset),
  setPlan(id: string, flip = false) {
    plan = planFor(id, flip);
    viewer.setPlan(plan);
  },
  verify,
  stats: () => viewer.renderStats()
};
(window as unknown as { blk: typeof api }).blk = api;

void (async () => {
  // The painted number wants the page's figures; offline it falls back after a moment.
  await Promise.race([document.fonts.load('700 150px "Barlow Condensed"'), new Promise((r) => setTimeout(r, 1500))]);
  const { block: b, storeys } = await block();
  viewer.showBlock({ block: b, storeys, label: b.blk }, inset);
  document.title = `Blk block stage: ${b.blk}`;
  if (marked) viewer.setStorey(marked);
  if (q.has('facing')) place(num('facing', 0), num('along', 0.5));
  if (q.get('view') === 'unit') await viewer.frameUnit();
  const hold = q.get('push');
  if (hold !== null) viewer.scrubPush(Number(hold), inset);
  else if (q.get('flat') === '1' || (skip && q.get('go') === '1')) viewer.jump(inset);
  else if (q.get('go') === '1') await viewer.enterFlat(inset);
  api.ready = true;
})();

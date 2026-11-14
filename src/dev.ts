/**
 * Engine harness. Loads the viewer with no interface so the 3D can be
 * developed and screenshotted on its own. Open /dev.html.
 *
 * Query: ?skip=1 jumps straight to the finished model (use this for
 * screenshots: software rendering is slow); ?auto=0 stays on the plan; ?m=990 sets minutes of the day;
 * ?month=5 sets the month (0 to 11); ?lens=sun|rules|space; ?inset=330 reserves that many pixels at
 * the bottom, as the interface's controls do (330 is the sun controls on a phone);
 * ?plan=bto-3room-68 shows another template from the library (the hero when left out).
 *
 * The plan is validated on load and every issue goes to the console, so a layout
 * being drawn shows its mistakes in the same place as its model.
 */
import { Viewer, type Lens } from './lib/engine/Viewer';
import { hero4room } from './lib/plan/hero4room';
import { templateById } from './lib/plan/templates';
import { validatePlan } from './lib/plan/validate';
import { dayPath, sunAt, type SunDate } from './lib/sg/solar';

const q = new URLSearchParams(location.search);
const date: SunDate = { year: 2026, month: Number(q.get('month') ?? 5), day: 21 };
const minutes = Number(q.get('m') ?? 16 * 60 + 30);

const wanted = q.get('plan');
const template = wanted ? templateById(wanted) : undefined;
if (wanted && !template) console.warn(`There is no template called ${wanted}; showing the hero flat.`);
const plan = template?.plan ?? hero4room;
const issues = validatePlan(plan);
for (const i of issues) console.warn(`[${i.level} ${i.code}] ${i.ref}: ${i.message}`);
document.title = `Blk harness: ${plan.id}`;

const viewer = new Viewer(document.getElementById('c') as HTMLCanvasElement, plan, {
  atmosphere(day) {
    const night = day < 0.4;
    document.body.style.background = night ? '#12151f' : '#f1ede5';
  }
});
viewer.setSun(sunAt(date, minutes));
viewer.setDayPath(dayPath(date));

const api = {
  viewer,
  plan,
  issues,
  ready: false,
  setTime(m: number, month = date.month) {
    const d = { ...date, month };
    viewer.setDayPath(dayPath(d));
    viewer.setSun(sunAt(d, m));
  }
};
(window as unknown as { blk: typeof api }).blk = api;

const inset = Number(q.get('inset') ?? 0);
if (inset > 0) {
  // Stands in for the interface's controls, so a screenshot shows what they would cover.
  const band = document.createElement('div');
  band.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:${inset}px;background:rgba(30,32,38,0.12);border-top:1px dashed rgba(30,32,38,0.4);pointer-events:none`;
  document.body.append(band);
}

void (async () => {
  if (q.get('skip') === '1') {
    viewer.jump(inset);
    const lens = q.get('lens') as Lens | null;
    if (lens) viewer.setLens(lens);
    api.ready = true;
    return;
  }
  viewer.setInsets(inset);
  if (q.get('auto') === '0') {
    // Ready at once: blk.viewer.scrubIntro(t) holds any moment of the opening for a screenshot.
    void viewer.showPlan();
    api.ready = true;
    return;
  }
  await viewer.showPlan();
  await viewer.intro(inset);
  const lens = q.get('lens') as Lens | null;
  if (lens) viewer.setLens(lens);
  api.ready = true;
})();

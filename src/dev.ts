/**
 * Engine harness. Loads the viewer with no interface so the 3D can be
 * developed and screenshotted on its own. Open /dev.html.
 *
 * Query: ?skip=1 jumps straight to the finished model (use this for
 * screenshots: software rendering is slow); ?auto=0 stays on the plan; ?m=990 sets minutes of the day;
 * ?month=5 sets the month (0 to 11); ?lens=sun|rules|space.
 */
import { Viewer, type Lens } from './lib/engine/Viewer';
import { hero4room } from './lib/plan/hero4room';
import { dayPath, sunAt, type SunDate } from './lib/sg/solar';

const q = new URLSearchParams(location.search);
const date: SunDate = { year: 2026, month: Number(q.get('month') ?? 5), day: 21 };
const minutes = Number(q.get('m') ?? 16 * 60 + 30);

const viewer = new Viewer(document.getElementById('c') as HTMLCanvasElement, hero4room, {
  atmosphere(day) {
    const night = day < 0.4;
    document.body.style.background = night ? '#12151f' : '#f1ede5';
  }
});
viewer.setSun(sunAt(date, minutes));
viewer.setDayPath(dayPath(date));

const api = {
  viewer,
  ready: false,
  setTime(m: number, month = date.month) {
    const d = { ...date, month };
    viewer.setDayPath(dayPath(d));
    viewer.setSun(sunAt(d, m));
  }
};
(window as unknown as { blk: typeof api }).blk = api;

void (async () => {
  if (q.get('skip') === '1') {
    viewer.jump(0);
    const lens = q.get('lens') as Lens | null;
    if (lens) viewer.setLens(lens);
    api.ready = true;
    return;
  }
  await viewer.showPlan();
  if (q.get('auto') === '0') return;
  await viewer.intro(0);
  const lens = q.get('lens') as Lens | null;
  if (lens) viewer.setLens(lens);
  api.ready = true;
})();

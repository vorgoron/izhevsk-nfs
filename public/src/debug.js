// Отладочная плашка для скриншотов: `?debug` в адресе, клавиша I или «Отладка» в меню (помнится).
// Где машина и камера, что под колёсами (земля, улица, трамвайный путь и его полотно) — чтобы по одному
// скриншоту встать в то же место: game.respawnAt(x, z) и game.camOverride = { pos, look } из строки «камера».
import * as THREE from 'three';
import { World } from './world.js';

const CAMERAS = ['за машиной', 'из салона', 'сверху', 'кино'];
const f1 = (v) => v.toFixed(1), f2 = (v) => v.toFixed(2);

export function createDebug({ world, car, camera, camMode, dayNight, fpsCap, on = false }) {
  const el = document.createElement('pre');
  el.id = 'debug';
  el.style.cssText = 'position:fixed;left:8px;top:64px;z-index:50;margin:0;padding:6px 8px;pointer-events:none;'
    + 'font:11px/1.35 ui-monospace,Menlo,monospace;color:#e8ecef;background:rgba(10,14,18,.72);border-radius:6px;white-space:pre';
  document.body.append(el);
  const dir = new THREE.Vector3();
  let next = 0;

  const set = (v) => {
    on = v;
    el.hidden = !on;
    try { localStorage.setItem('debug', on ? '1' : ''); } catch {}
  };
  set(on);

  function lines() {
    const x = car.pos.x, z = car.pos.y;
    const out = [];
    const deg = ((((car.heading * 180) / Math.PI) % 360) + 360) % 360;
    out.push(`машина  x ${f1(x)}  z ${f1(z)}  y ${f2(car.y)}  курс ${Math.round(deg)}°  ${Math.round(Math.abs(car.speed) * 3.6)} км/ч`);
    const [ci, cj] = world.chunkAt(x, z);
    out.push(`земля   ${f2(world.ground(x, z, car.y))}  рельеф ${f2(world.terrain(x, z))}  квадрат ${ci},${cj}`);
    const r = world.nearestRoad(x, z);
    if (r) {
      const road = r.seg.road;
      out.push(`улица   ${road.name || '—'} (${road.k}, ${f1(road.w)} м, +${f2(road.lift)}${road.br ? ', мост' : ''})  `
        + (r.d < 0 ? `на полотне, ${f1(-r.d)} м от края` : `в ${f1(r.d)} м`));
    }
    // Ближайший трамвайный путь и что о нём знает профиль высоты.
    let best = null;
    for (const q of world.railsNear(x, z)) {
      if (q.k !== 'tram') continue;
      const c = World.closest(q, x, z);
      if (!best || c.d < best.c.d) best = { q, c };
    }
    if (best && best.c.d < 8) {
      const { q, c } = best, L = Math.hypot(q.bx - q.ax, q.bz - q.az) || 1;
      const l = world.railLevel(x, z, (q.bx - q.ax) / L, (q.bz - q.az) / L, true);
      const kind = l.cross ? 'переезд' : l.bed ? 'полотно' : 'без полотна';
      out.push(`трамвай путь #${q.ri} в ${f1(c.d)} м, ${f1(q.s0 + q.len * c.t)} м от начала: ${kind}, y ${f2(l.y)}`
        + (l.wl !== undefined ? `, полуширина ${f1(l.wl)} / ${f1(l.wr)}` : ''));
    }
    camera.getWorldDirection(dir);
    const p = camera.position, look = p.clone().addScaledVector(dir, 20);
    out.push(`камера  ${CAMERAS[camMode()]}  fov ${Math.round(camera.fov)}`);
    out.push(`        pos [${f1(p.x)}, ${f1(p.y)}, ${f1(p.z)}]  look [${f1(look.x)}, ${f1(look.y)}, ${f1(look.z)}]`);
    out.push(`прочее  ${dayNight.label}  кадров ${fpsCap() || '∞'}  ${innerWidth}×${innerHeight}${location.search ? `  ${location.search}` : ''}`);
    return out;
  }

  return {
    get on() { return on; },
    toggle: () => set(!on),
    // Раз в 250 мс: текст в DOM каждый кадр — лишняя работа и мельтешение цифр.
    update(now) {
      if (!on || now < next) return;
      next = now + 250;
      el.textContent = lines().join('\n');
    },
  };
}

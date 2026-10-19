// Сборка public/models/moskvich.glb из модели «Car_ Moskvich 412i E» (87-Motors, Sketchfab, CC-BY-4.0).
// Исходник (~19 тыс. треугольников, миллиметры, перед — в −z) раскладывается на части игры: paint,
// detail, lights, wheel (переднее правое колесо с колпаком вокруг своего центра). Колёса в исходнике —
// не отдельные узлы, а общие материалы на все четыре, поэтому вырезаются по положению. Москвич берёт
// и «Комби» (kombi.mjs) — отсюда loadMoskvich / moskvichParts.
//
//   cd tools/models && npm install && node moskvich.mjs [3d-models/car__moskvich_412i_e/scene.gltf]
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bbox, hex, pick, readGltf, simplify, used, writeGlb } from './lib.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const MOSKVICH_SRC = `${root}/3d-models/car__moskvich_412i_e/scene.gltf`;
export const MOSKVICH_CREDIT = 'This work is based on "Car_ Moskvich 412i E" (https://sketchfab.com/3d-models/car--moskvich-412i-e-01dcdf62a2134abdbc76fb1183f728e5) by 87-Motors (https://sketchfab.com/87-Motors) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)';

// Модель крупнее настоящей (4,77 м с бамперами) — масштаб по паспортной длине.
const LENGTH = 4.2;

// Материал исходника → [часть, цвет, доля треугольников, которую оставить]. null — выбросить.
const ROLES = {
  Carpaint: ['paint', '#ffffff', 0.8],
  Chrome: ['detail', '#c8ccd0', 0.5], // бамперы, молдинги, ободки фар, зеркала
  Glass: ['detail', '#26333f', 1],
  Radiator: ['detail', '#3a3d42', 0.4], // решётка радиатора
  material_7: ['detail', '#1b1c1f', 0.3], // днище, уплотнители, щётки
  material: ['detail', '#151618', 0.5], // брызговики (то, что не в колёсах)
  Plst_blk: ['detail', '#1b1c1f', 1],
  Num_2: ['detail', '#f0f0ea', 1], // передний номер
  material_12: ['detail', '#f0f0ea', 1], // задний номер
  material_10: ['lights', '#ff2a1a', 1], // задние фонари
  Chair: null, // салон за непрозрачными стёклами не виден
};
// Light — стёкла фар, но тем же материалом сделаны щиты моторного отсека и багажника под капотом:
// берём только передний торец. Lgt_2 — поворотники, но им же — жабры на задних стойках и эмблема.
const HEAD = { color: '#fff6d8', zFront: 1.9 };
const AMBER = '#ffb030';
// Колесо: протектор (material_14), внутренняя сторона и барабан (material), наружная сторона (material_13 —
// и боковина шины, и колпак: колпак — внутри HUB × радиус).
const WHEEL = { material_14: ['#151618', 0.25], material: ['#151618', 0.25], material_13: ['#151618', 0.3] };
const HUB = { k: 0.66, color: '#b8bcc0', keep: 0.3 };

// ---------------------------------------------------------------- координаты игры

// Исходник в координатах игры: { prims, wheels (центры четырёх колёс), R, ref (переднее правое), length }.
export function loadMoskvich(src = MOSKVICH_SRC) {
  const prims = readGltf(src);
  const all = bbox(prims);
  const S = LENGTH / all.size[2];
  // Перед исходника — −z: поворот на 180° вокруг вертикали (x и z меняют знак), низ колёс — на земле.
  for (const p of prims) {
    for (let i = 0; i < p.pos.length; i += 3) {
      p.pos[i] = -(p.pos[i] - all.mid[0]) * S;
      p.pos[i + 1] = (p.pos[i + 1] - all.lo[1]) * S;
      p.pos[i + 2] = -(p.pos[i + 2] - all.mid[2]) * S;
    }
  }

  // Колёса: центры — по габаритам протектора в каждой четверти; радиус — высота оси (колесо стоит на земле).
  const tread = prims.filter((p) => p.mat === 'material_14');
  const wheels = [];
  for (const sz of [1, -1]) for (const sx of [1, -1]) {
    const b = bbox(tread.map((p) => used(pick(p, ([x, , z]) => sx * x > 0 && sz * z > 0))));
    wheels.push({ x: b.mid[0], y: b.mid[1], z: b.mid[2], half: b.size[0] / 2 });
  }
  const R = wheels.reduce((s, w) => s + w.y, 0) / 4;
  return { prims, wheels, R, ref: wheels[0], length: all.size[2] * S };
}

// ---------------------------------------------------------------- части

// Части игры. trim(примитив) → { pos, idx } — что оставить от кузова (колёса — всегда целиком).
// lockBorder — не трогать при упрощении открытые края (у обрезанного кузова — шов с пристроенными частями).
export function moskvichParts({ prims, wheels, R, ref }, { trim = (p) => p, lockBorder = false, parts = { paint: [], detail: [], lights: [], wheel: [] }, stat = {} } = {}) {
  const byMat = (mat) => prims.filter((p) => p.mat === mat);
  const inWheel = ([x, y, z]) => wheels.find((w) => Math.abs(x - w.x) < w.half + 0.06 && Math.hypot(y - w.y, z - w.z) < R + 0.02);
  const add = (part, color, list, keep, name) => {
    if (!list.some((p) => p.idx.length)) return;
    const g = simplify(list, keep, { lockBorder });
    parts[part].push({ ...g, color: hex(color) });
    stat[name] = `${list.reduce((s, p) => s + p.idx.length / 3, 0)} → ${g.idx.length / 3}`;
  };
  for (const [mat, role] of Object.entries(ROLES)) {
    if (!role) continue;
    const list = WHEEL[mat] ? byMat(mat).map((p) => pick(p, (c) => !inWheel(c))) : byMat(mat);
    add(role[0], role[1], list.map(trim), role[2], mat);
  }
  add('lights', HEAD.color, byMat('Light').map((p) => trim(pick(p, ([, , z]) => z > HEAD.zFront))), 1, 'Light (фары)');
  const vent = ([x, y]) => y > 1.15 || Math.abs(x) < 0.15; // жабры на стойках, эмблема на носу
  add('detail', '#c8ccd0', byMat('Lgt_2').map((p) => trim(pick(p, vent))), 1, 'Lgt_2 (хром)');
  add('lights', AMBER, byMat('Lgt_2').map((p) => trim(pick(p, (c) => !vent(c)))), 1, 'Lgt_2 (поворотники)');
  const isHub = (mat, [, y, z]) => mat === 'material_13' && Math.hypot(y - R, z - ref.z) < HUB.k * R;
  const wheelPart = (mat, keep) => byMat(mat).map((p) => {
    const { idx } = pick(p, (c) => inWheel(c) === ref && keep(c));
    const pos = Float32Array.from(p.pos, (v, i) => v - [ref.x, R, ref.z][i % 3]);
    return { pos, idx };
  });
  for (const [mat, [color, keep]] of Object.entries(WHEEL)) add('wheel', color, wheelPart(mat, (c) => !isHub(mat, c)), keep, 'колесо ' + mat);
  add('wheel', HUB.color, wheelPart('material_13', (c) => isHub('material_13', c)), HUB.keep, 'колпак');
  return { parts, stat };
}

// Размеры колёс для extras сцены.
export function wheelSpec({ wheels, R }) {
  const fr = wheels.filter((w) => w.z > 0), rr = wheels.filter((w) => w.z < 0);
  const avg = (l, f) => +(l.reduce((s, w) => s + f(w), 0) / l.length).toFixed(3);
  return { r: +R.toFixed(3), front: avg(fr, (w) => w.z), rear: avg(rr, (w) => w.z), track: avg(wheels, (w) => Math.abs(w.x)) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const model = loadMoskvich(resolve(process.argv[2] || MOSKVICH_SRC));
  const { parts, stat } = moskvichParts(model);
  console.table(stat);
  const wheels = wheelSpec(model);
  const body = bbox(model.prims.filter((p) => p.mat === 'Carpaint'));
  console.log('колёса', wheels, '| длина', model.length.toFixed(2), 'ширина кузова', body.size[0].toFixed(2), 'высота', body.hi[1].toFixed(2));
  // hub: колпак — в самой модели колеса (игра не дорисовывает свой диск).
  writeGlb(`${root}/public/models/moskvich.glb`, parts, { copyright: MOSKVICH_CREDIT, extras: { wheels, length: +model.length.toFixed(3), width: +body.size[0].toFixed(3), hub: true } });
}

// Сборка public/models/kabluk.glb — ИЖ-2715 «Каблучок»: перед, кабина и колёса — от пикапа (pickup.mjs),
// будка с задними дверями, задние крылья и фонари — от модели «АЗЛК+Пирожок» (экспорт SketchUp в COLLADA,
// переводится в glTF скриптом dae2gltf.py). Шов — плоскость сразу за кабиной пикапа; задняя часть
// «Пирожка» подогнана к пикапу: масштаб — по колёсной базе, ширина — по ширине кузова у шва, по длине
// поджата так, чтобы будка встала за кабиной, а машина не вышла заметно длиннее пикапа.
//
//   cd tools/models && npm install && node kabluk.mjs [IZH-2715.gltf] [АЗЛК+Пирожок.dae]
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bbox, center, clip, hex, readGltf, simplify, used, writeGlb } from './lib.mjs';
import { PICKUP_SRC, loadPickup, pickupParts, root, wheelSpec } from './pickup.mjs';

const pickupSrc = process.argv[2] || PICKUP_SRC;
const daeSrc = process.argv[3] || `${root}/3d-models/АЗЛК+Пирожок.zip`; // в архиве по ошибке не zip, а .dae

// Материал «Пирожка» → [часть, цвет, доля треугольников]. Не упомянутые — выбросить (салон, двигатель, бак,
// колёса — колёса у машины пикапа). Pneus1 (шины) в экспорте ещё и обратная сторона всех граней — тоже вон.
const ROLES = {
  Carrosserie1: ['paint', '#ffffff', 0.7],
  Chromes1: ['detail', '#c8ccd0', 0.6],
  Color_006: ['detail', '#3a3d42', 0.6],
  Color_005: ['detail', '#3a3d42', 1],
  Color_001: ['detail', '#d8dadc', 0.6],
  Chassis1: ['detail', '#1b1c1f', 0.4],
  Dessous1: ['detail', '#1b1c1f', 0.5],
  Metal_noir1: ['detail', '#1b1c1f', 0.4],
  Metal_gris1: ['detail', '#6b6e72', 0.5],
  Parties_noir1: ['detail', '#151618', 0.5],
  Plastique_noir1: ['detail', '#1b1c1f', 0.4],
  Joints_de_vitr1: ['detail', '#151618', 1],
  Vitres1: ['detail', '#26333f', 1],
  Feux_Orange_ar1: ['lights', '#ffb030', 1],
  Feux_Rouge_arr1: ['lights', '#ff2a1a', 1],
  Feux_Rouge2_ar1: ['lights', '#b81c12', 1],
  Feux_blanc_arr1: ['lights', '#f2f2ea', 0.5],
};

// ---------------------------------------------------------------- пикап: всё впереди шва

const pickup = loadPickup(pickupSrc);
// Задняя стенка кабины пикапа — самая задняя точка кузова выше 1,2 м.
let cabBack = Infinity;
for (const p of pickup.prims) if (p.mat === 'car_kuzov') for (let i = 0; i < p.pos.length; i += 3) if (p.pos[i + 1] > 1.2) cabBack = Math.min(cabBack, p.pos[i + 2]);
const SEAM = cabBack - 0.035; // будка — на 3,5 см позади кабины
const { parts, stat } = pickupParts(pickup, { trim: (p) => clip(p, 2, SEAM, 1) });

// ---------------------------------------------------------------- «Пирожок»: всё позади шва

const gltf = join(mkdtempSync(join(tmpdir(), 'kabluk-')), 'pirozhok.gltf');
execFileSync('python3', ['-I', join(root, 'tools/models/dae2gltf.py'), daeSrc, gltf], { stdio: 'inherit' });
const src = readGltf(gltf);
const all = bbox(src);
// Колёса — по шинам (Pneus1 без треугольников, совпадающих с гранями других материалов).
const key = (p, t) => [0, 1, 2].map((j) => { const i = p.idx[t + j] * 3; return [p.pos[i], p.pos[i + 1], p.pos[i + 2]].map((v) => Math.round(v * 1e5)).join(); }).sort().join('|');
const faces = new Set();
for (const p of src) if (p.mat !== 'Pneus1') for (let t = 0; t < p.idx.length; t += 3) faces.add(key(p, t));
const tires = src.filter((p) => p.mat === 'Pneus1').map((p) => {
  const idx = [];
  for (let t = 0; t < p.idx.length; t += 3) if (!faces.has(key(p, t))) idx.push(p.idx[t], p.idx[t + 1], p.idx[t + 2]);
  return { pos: p.pos, idx };
});
// Шины одной оси (sz — сторона от середины по z) → габариты.
const axle = (sz) => bbox(tires.map((p) => {
  const idx = [];
  for (let t = 0; t < p.idx.length; t += 3) if (Math.sign(center(p, t)[2] - all.mid[2]) === sz) idx.push(p.idx[t], p.idx[t + 1], p.idx[t + 2]);
  return used({ pos: p.pos, idx });
}));
const front = axle(-1), back = axle(1); // перед «Пирожка» — в −z
const K = (pickup.wheels[0].z - pickup.wheels[2].z) / (back.mid[2] - front.mid[2]); // по колёсной базе пикапа
const axleY = (front.mid[1] + back.mid[1]) / 2, midX = (front.mid[0] + back.mid[0]) / 2;
// Поворот на 180° (перед → +z), оси — на высоте осей пикапа, передняя ось — на передней оси пикапа.
const zf = pickup.wheels[0].z;
const toGame = (x, y, z) => [-(x - midX) * K, (y - axleY) * K + pickup.R, -(z - front.mid[2]) * K + zf];

// Привязка задней части: перед будки — на шов, зад машины — не дальше REAR от центра; ширина — как у пикапа.
const REAR = 2.12;
let boxFront = -Infinity, rearEnd = Infinity, wide = 0;
for (const p of src) {
  if (p.mat === 'Pneus1') continue;
  for (let i = 0; i < p.pos.length; i += 3) {
    const [x, y, z] = toGame(p.pos[i], p.pos[i + 1], p.pos[i + 2]);
    if (p.mat === 'Carrosserie1' && y > 1.7) boxFront = Math.max(boxFront, z);
    rearEnd = Math.min(rearEnd, z);
    if (p.mat === 'Carrosserie1' && y > 0.6 && y < 1.0 && z < -0.5 && z > -1.0) wide = Math.max(wide, Math.abs(x));
  }
}
let pickWide = 0;
for (const p of pickup.prims) if (p.mat === 'car_kuzov') for (let i = 0; i < p.pos.length; i += 3) {
  const y = p.pos[i + 1], z = p.pos[i + 2];
  if (y > 0.6 && y < 1.0 && z < cabBack + 0.4 && z > cabBack - 0.1) pickWide = Math.max(pickWide, Math.abs(p.pos[i]));
}
const SX = pickWide / wide, SZ = (REAR + SEAM) / (rearEnd - boxFront) * -1;
const place = ([x, y, z]) => [x * SX, y, SEAM + (z - boxFront) * SZ];
for (const p of src) {
  for (let i = 0; i < p.pos.length; i += 3) p.pos.set(place(toGame(p.pos[i], p.pos[i + 1], p.pos[i + 2])), i);
}

const add = (part, color, list, k, name) => {
  if (!list.some((p) => p.idx.length)) return;
  const g = simplify(list, k);
  parts[part].push({ ...g, color: hex(color) });
  stat['будка ' + name] = `${list.reduce((s, p) => s + p.idx.length / 3, 0)} → ${g.idx.length / 3}`;
};
for (const [mat, [part, color, k]] of Object.entries(ROLES)) {
  add(part, color, src.filter((p) => p.mat === mat).map((p) => clip(p, 2, SEAM + 0.003, -1)), k, mat);
}
console.table(stat);
// Место заднего номера — фонарь подсветки номера между задними фонарями (для meshPlates в vehicles.js).
const lamp = bbox(src.filter((p) => p.mat === 'Feux_blanc_arr1').map((p) => clip(p, 2, SEAM, -1)));
console.log('подсветка номера: центр', lamp.mid.map((v) => v.toFixed(3)).join(', '), 'размер', lamp.size.map((v) => v.toFixed(3)).join(' × '));

const wheels = wheelSpec(pickup);
const body = bbox([...parts.paint]);
const length = pickup.length / 2 + REAR; // пикап — от −length/2 до +length/2, перед у них общий
console.log('шов', SEAM.toFixed(3), '| масштаб', K.toFixed(2), 'ширина ×', SX.toFixed(3), 'длина ×', SZ.toFixed(3),
  '| колёса', wheels, '| длина', length.toFixed(2), 'ширина', body.size[0].toFixed(2), 'высота', body.hi[1].toFixed(2));

const credit = 'ИЖ-2715: перед — модель пикапа (Blender), будка — «АЗЛК+Пирожок» (SketchUp); источники уточняются';
writeGlb(`${root}/public/models/kabluk.glb`, parts, { cull: true, copyright: credit, extras: { wheels, length: +length.toFixed(3), width: +body.size[0].toFixed(3), hub: true } });

// Сборка public/models/vesta.glb из модели «Lada Vesta» (tiunov.se, Sketchfab, CC-BY-4.0).
// Исходник (~200 тыс. треугольников) сначала чистится в Blender от невидимых снаружи граней (салон, изнанка панелей —
// tools/models/blender/clean.py), потом упрощается до нескольких тысяч и раскладывается на части
// игры: paint (кузов — под цвет), detail (стекло, пластик, хром), lights (фары, фонари), wheel
// (одно колесо вокруг своего центра, ось — x). Координаты — как у процедурных машин: +z вперёд,
// y вверх от земли, x — поперёк. Размеры колёс пишутся в extras сцены.
//
//   Blender -b --factory-startup --python tools/models/blender/clean.py -- 3d-models/lada_vesta/scene.gltf \
//     3d-models/lada_vesta_clean/scene.gltf --drop '/(Kover|Material_1529)$|^(?!steklo_|door).*/steklo$'
//   cd tools/models && npm install && node vesta.mjs [исходник] [куда]
//
// --drop — то, что сборщик выбрасывает (ковёр, стёкла фар; см. ROLES и glass): оно не загораживает остальное.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bbox, hex, innerShell, pick, readGltf, simplify, writeGlb } from './lib.mjs';

const src = resolve(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '../../3d-models/lada_vesta_clean/scene.gltf'));
const out = resolve(process.argv[3] || join(dirname(fileURLToPath(import.meta.url)), '../../public/models/vesta.glb'));

// Материал исходника → [часть, цвет, доля треугольников, которую оставить]. null — выбросить.
const ROLES = {
  kuzov: ['paint', '#ffffff', 0.2],
  stekloton: ['detail', '#26333f', 1], // не упрощать: стекло стягивалось от стоек, в щель было видно насквозь
  plastic: ['detail', '#1b1c1f', 0.3], // после чистки — только видимый (решётка, бамперы, дворники): при 0,08 дворники — чёрточки
  hrom: ['detail', '#c8ccd0', 0.3], // решётка, «скобки» вокруг противотуманок
  chern: ['detail', '#111214', 1],
  SvetPlas: ['detail', '#2e3136', 0.3],
  PeredFar: ['detail', '#202226', 0.5],
  Zerkalo: ['detail', '#9aa3ab', 1],
  Fari: ['lights', '#e8fbff', 0.6],
  Material_1603: ['lights', '#fff6d8', 0.6],
  Material_1605: ['lights', '#ffb030', 0.6],
  povZer: ['lights', '#ffb030', 1],
  stopar: ['lights', '#ff2a1a', 0.6],
  material: ['lights', '#ff2a1a', 0.6],
  material_17: ['lights', '#ff2a1a', 0.6],
  Kover: null, // ковёр салона — не виден
  Material_1529: null,
};
// Колеса в модели нет — игра рисует его сама (wheelParts в vehicles.js), из исходника — только размеры. Диск исходника —
// сотни мелких несвязанных деталей (болты, отверстия), упрощению не поддаётся (28 тыс. → 1,9 тыс.); шина — с рисунком
// протектора, после упрощения он рваный (зубцы по боковине), а без упрощения — 5,9 тыс. треугольников.
// Зоны кузова плотнее остального (keep — доля треугольников): борта с «иксом» (косая выштамповка на дверях и крыльях) —
// иначе после упрощения выштамповка — один пологий перегиб, и сглаженное освещение игры его стирает; перед (капот,
// бампер, обрамление фар), зад (крышка багажника, бампер) и крыша — порог сглаживания Весты низкий (creaseAngle
// в vehicles.js), и на редкой сетке они гранёные.
// Остальной кузов — как в ROLES. Края кусков при упрощении не трогаем (lockBorder), иначе на стыках щели.
// SHELL — тёмная подложка под кузовом (innerShell в lib.mjs).
const SHELL = { mats: ['kuzov', 'steklo', 'stekloton', 'SvetPlas'], keep: 0.12, inset: 0.03, color: '#0e0f11',
  // Профиль — на 7 см ниже крыши и стёкол (замер лучами сверху при x = 0,5), низ — 0,4 м; ширина ±0,55 м — внутри
  // боковых стёкол (они с 0,59). Спереди уходит под капот — щель у основания лобового стекла.
  core: { x: 0.55, profile: [[1.3, 0.82], [1.1, 0.93], [0.8, 1.1], [0.6, 1.21], [0.4, 1.31], [0.2, 1.38], [0, 1.41], [-0.3, 1.43],
    [-0.6, 1.41], [-0.9, 1.38], [-1.1, 1.33], [-1.3, 1.25], [-1.5, 1.16], [-1.5, 0.4], [1.3, 0.4]] } };
// Наружу — от продольной оси кузова (отрезок x = 0, y = 0.75, |z| ≤ 1.5).
const outward = ([x, y, z], n) => n[0] * x + n[1] * (y - 0.75) + n[2] * (z - Math.max(-1.5, Math.min(1.5, z))) > 0;
const WINDOW_TRIM = { keep: 0.5, in: ([x, y]) => Math.abs(x) > 0.5 && y > 0.95 }; // чёрный пластик рамок окон
const ZONES = [
  { name: 'перед', keep: 0.5, in: ([, y, z]) => z > 1.0 && y > 0.3 },
  { name: 'зад', keep: 0.5, in: ([, y, z]) => z < -1.4 && y > 0.3 },
  { name: 'крыша', keep: 0.5, in: ([, y]) => y > 1.2 },
  { name: 'борта', keep: 0.7, in: ([x, y]) => Math.abs(x) > 0.6 && y > 0.3 && y < 0.95 },
];

const prims = readGltf(src);

// ---------------------------------------------------------------- оси игры

const all = bbox(prims), body = bbox(prims.filter((p) => !p.wheel));
// Вверх — самая короткая ось, вперёд — самая длинная, в сторону фар.
const axes = [0, 1, 2].sort((a, b) => all.size[a] - all.size[b]);
const up = axes[0], fwd = axes[2], side = axes[1];
const lamps = bbox(prims.filter((p) => p.mat === 'Fari'));
const fs = Math.sign(lamps.mid[fwd] - body.mid[fwd]);
const us = 1; // glTF — y вверх; проверено: крыша при +y
const toGame = (p) => [p[side] - body.mid[side], (p[up] - all.lo[up]) * us, (p[fwd] - body.mid[fwd]) * fs];
// Смена знака одной оси (fs < 0) зеркалит модель — тогда x тоже меняем, чтобы руль остался слева.
const xs = fs < 0 ? -1 : 1;
for (const p of prims) {
  for (let i = 0; i < p.pos.length; i += 3) {
    const [x, y, z] = toGame([p.pos[i], p.pos[i + 1], p.pos[i + 2]]);
    p.pos[i] = x * xs; p.pos[i + 1] = y; p.pos[i + 2] = z;
  }
}
console.log('оси: вверх', 'xyz'[up], 'вперёд', (fs > 0 ? '+' : '-') + 'xyz'[fwd], '| габариты (без колёс)', body.size.map((v) => v.toFixed(2)).join(' × '));

// Часть игры: набор цветных групп → одна геометрия (позиции, цвета, индексы).
const parts = { paint: [], detail: [], lights: [], wheel: [] };
const stat = {};
for (const [mat, role] of Object.entries(ROLES)) {
  if (!role) continue;
  // Лобовое и передние боковые стёкла в исходнике — светлым материалом фар (steklo); стёкла фар
  // (остальной steklo) выбрасываем, чтобы фары светили.
  const glass = (p) => p.mat === 'steklo' && /^(steklo_|door)/.test(p.node);
  const list = prims.filter((p) => !p.wheel && (p.mat === mat || (mat === 'stekloton' && glass(p))));
  if (!list.length) continue;
  if (mat === 'kuzov') {
    // Треугольник — в первую подходящую зону, иначе в остальное.
    const zoneOf = (c) => ZONES.findIndex((zn) => zn.in(c));
    const pieces = [...ZONES.map((zn, i) => [zn.name, zn.keep, (c) => zoneOf(c) === i]), ['остальное', role[2], (c) => zoneOf(c) < 0]];
    const out = [];
    for (const [name, keep, test] of pieces) {
      const g = simplify(list.map((p) => pick(p, test)), keep, { lockBorder: true });
      parts[role[0]].push({ ...g, color: hex(role[1]) });
      out.push(`${name} ${g.idx.length / 3}`);
    }
    stat[mat] = `${list.reduce((s, p) => s + p.idx.length / 3, 0)} → ${out.join(', ')}`;
    continue;
  }
  if (mat === 'plastic') {
    // Чёрные рамки окон и накладки стоек: при общей доле 0,08 от них оставались клочки, сквозь которые проступал белый
    // кузов. В зоне окон — плотнее и с нетронутыми краями, остальной пластик (бамперы, решётка, днище) — как был.
    const pieces = [[WINDOW_TRIM.keep, WINDOW_TRIM.in, true], [role[2], (c) => !WINDOW_TRIM.in(c), false]];
    const out = pieces.map(([keep, test, lockBorder]) => {
      const g = simplify(list.map((p) => pick(p, test)), keep, { lockBorder });
      parts[role[0]].push({ ...g, color: hex(role[1]) });
      return g.idx.length / 3;
    });
    stat[mat] = `${list.reduce((s, p) => s + p.idx.length / 3, 0)} → окна ${out[0]}, остальное ${out[1]}`;
    continue;
  }
  const g = simplify(list, role[2]);
  parts[role[0]].push({ ...g, color: hex(role[1]) });
  stat[mat] = `${list.reduce((s, p) => s + p.idx.length / 3, 0)} → ${g.idx.length / 3}`;
}
// Подложка: в зазорах между панелями — тёмный шов, а не просвет насквозь. Из кузова, всех стёкол (и фар с фонарями —
// их стёкла выброшены, под ними пустота) и корпусов фонарей: щель между крышей и задним стеклом есть в самом исходнике.
{
  const list = prims.filter((p) => !p.wheel && SHELL.mats.includes(p.mat));
  const shell = innerShell(list, SHELL.keep, SHELL.inset, outward);
  parts.detail.push({ ...shell, color: hex(SHELL.color) });
  stat['подложка'] = `${list.reduce((s, p) => s + p.idx.length / 3, 0)} → ${shell.idx.length / 3}`;

  // Тёмная вставка в форме салона вместо выброшенного салона: сквозь щель между крышей и рамкой двери (есть в
  // исходнике) взгляд уходил через пустой салон наружу. Призма по профилю core (сбоку, [z, y]; выпуклый), ширина ±x.
  const { x, profile } = SHELL.core, n = profile.length;
  const v = [...profile.map(([z, y]) => [-x, y, z]), ...profile.map(([z, y]) => [x, y, z])];
  const idx = [];
  for (let i = 1; i + 1 < n; i++) idx.push(0, i, i + 1, n, n + i + 1, n + i); // торцы веером
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; idx.push(i, j + n, j, i, i + n, j + n); } // борта
  // Обход торцов зависит от направления профиля — разворачиваем всё, если грани смотрят внутрь (проверка по торцу −x).
  const [a, b, c] = [idx[0], idx[1], idx[2]].map((k) => v[k]);
  const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
  if (nx > 0) for (let t = 0; t < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]];
  parts.detail.push({ pos: Float32Array.from(v.flat()), idx: Uint32Array.from(idx), color: hex(SHELL.color) });
}

// Размеры колёс — по колёсам исходника; переднее правое (+x) — для радиуса.
const wheelNames = [...new Set(prims.filter((p) => p.wheel).map((p) => p.wheel))];
const wheelBoxes = wheelNames.map((n) => ({ n, b: bbox(prims.filter((p) => p.wheel === n)) }));
const ref = wheelBoxes.find(({ b }) => b.mid[0] > 0 && b.mid[2] > 0);
delete parts.wheel;
const front = wheelBoxes.filter(({ b }) => b.mid[2] > 0), rear = wheelBoxes.filter(({ b }) => b.mid[2] < 0);
const avg = (l, k) => l.reduce((s, { b }) => s + b.mid[k], 0) / l.length;
const wheels = {
  r: +(ref.b.size[1] / 2).toFixed(3), front: +avg(front, 2).toFixed(3), rear: +avg(rear, 2).toFixed(3),
  track: +(wheelBoxes.reduce((s, { b }) => s + Math.abs(b.mid[0]), 0) / wheelBoxes.length).toFixed(3),
};
const dims = bbox(prims.filter((p) => !p.wheel));
console.table(stat);
console.log('колёса', wheels, '| длина', dims.size[2].toFixed(2), 'ширина', dims.size[0].toFixed(2), 'высота', dims.hi[1].toFixed(2));

const credit = 'This work is based on "Lada Vesta" (https://sketchfab.com/3d-models/lada-vesta-3c333139feb744ae9d36767c0e9cabfd) by tiunov.se (https://sketchfab.com/tiunov.se) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)';
writeGlb(out, parts, { cull: true, copyright: credit, extras: { wheels, length: +dims.size[2].toFixed(3), width: +dims.size[0].toFixed(3) } });

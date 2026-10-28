// Сборка public/models/largus.glb и elargus.glb — Ларгусы автора usolakolya (Sketchfab, CC-BY-4.0):
//   largus  — «Lada Largus», до рестайлинга (2012–2021);
//   elargus — «Lada Largus Cross Rest», рестайлинг 2021 г. («икс»-морда): e-Largus внешне — обычный рестайлинговый
//             Ларгус, поэтому пластик Cross (арки, пороги, задний бампер) — в цвет кузова, серебристые «иксы»
//             на бампере — синие, как у электрических Lada.
// В каждом исходнике две одинаковые машины рядом по x (вторая — с открытыми дверями и капотом) и бокс на крыше; берём
// закрытую, бокс, салон, моторный отсек и днище выбрасываем. Перед — уже +z, y вверх; масштаб — по паспортной базе.
// Имена узлов безликие (mesh_id…), роли — по материалам (определены по снимкам: материал за материалом).
// Исходник сначала чистится в Blender от невидимых снаружи граней (tools/models/blender/clean.py), как у Весты.
// Команды чистки печатает `node largus.mjs clean` — что выбрасывать (--drop) и где колёса (--wheels), берётся из CARS.
// Упрощение — не долей треугольников, а допустимой ошибкой в метрах (ERR): при доле кузова 0,055 упрощение, не дойдя до
// цели, поднимало ошибку до половины размера куска — кузов был мятым и гранёным, накладки рваными.
//
//   cd tools/models && npm install && node largus.mjs clean | sh && node largus.mjs [largus|elargus]
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bbox, hex, pick, readGltf, simplify, writeGlb } from './lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = 2.905; // колёсная база, м (паспорт, у обоих)
const AXIS = { y: 0.75, z: 1.4 }; // продольная ось кузова: отрезок x = 0, y = 0.75, |z| ≤ 1.4 (грани — наружу от неё)
const ERR = 0.003; // допустимая ошибка упрощения, м: при 4 мм уже гранёное переднее крыло Ларгуса
// Защёлка заднего бокового стекла (координаты игры, центр треугольника).
const latch = ([x, y, z]) => Math.abs(x) > 0.66 && Math.abs(x) < 0.73 && y > 1.17 && y < 1.29 && z > -1.8 && z < -1.73;
// Стёкла почти не упрощаем: отходя внутрь, упрощённое стекло открывало уплотнитель за ним — тёмные зубцы по краю.
const GLASS_ERR = 0.0002;
const GLASS = '#26333f', TRIM = '#1b1c1f', CHROME = '#c8ccd0', RED = '#ff2a1a', HEAD = '#e8fbff', FOG = '#fff6d8';

// roles: материал → [часть, цвет, ошибка упрощения, м (по умолчанию ERR)]; чего нет в списке — выбрасываем.
// wheel: шины, внутренняя часть и колпак/диск — у каждого колеса свои материалы, колесо выбирается по положению.
const CARS = {
  largus: {
    raw: '3d-models/lada_largus/scene.gltf', src: '3d-models/lada_largus_clean/scene.gltf',
    credit: 'This work is based on "Lada Largus" (https://sketchfab.com/3d-models/lada-largus-ef5fd62d01ca49f1bd70bb596456c144) by usolakolya (https://sketchfab.com/usolakolya) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
    pickX: 0, // закрытая машина — x центра куска меньше этого
    // С одного борта автор пропустил рамку окна с молдингом левой задней двери и полоску у кромки лобового — дополняем
    // зеркальной копией с другого борта.
    mirror: ['Material.001', 'Material.040'],
    // Защёлки откидных задних боковых стёкол — за стеклом, в игре оно непрозрачное: упрощённые торчали сквозь него точками.
    cut: { 'Material.020': latch },
    // Выброшено: салон (026–037), бокс и его крепления (038, 039), начинка фар и противотуманок (018, 024 — 180 тыс.
    // треугольников).
    roles: {
      1403: ['paint', '#ffffff'], // кузов, бамперы, зеркала
      'Material.040': ['paint', '#ffffff'], // полоска по кромке лобового
      'Material.006': ['detail', GLASS, GLASS_ERR], // лобовое, задние боковые, стекло двери багажника
      'Material.007': ['detail', GLASS], // стёкла дверей
      'Material.001': ['detail', TRIM], // рамки окон, молдинги дверей
      'Material.020': ['detail', '#111214', 0.006], // уплотнитель лобового, подкрылки, накладка двери багажника (подкрылков почти не видно — грубее)
      'Material.003': ['detail', CHROME], // хромовая рамка решётки
      'Material.019': ['detail', CHROME], // хромовая планка с ладьёй
      'Material.005': ['detail', '#17181b'], // соты решётки и нижний воздухозаборник
      'Material.017': ['detail', '#2e3136'], // рейлинги
      'Material.008': ['detail', '#9aa3ab'], // стёкла зеркал
      'Material.002': ['lights', HEAD], // фары
      'Material.004': ['lights', HEAD],
      'Material.016': ['lights', FOG], // противотуманки
      'Material.021': ['lights', RED], // фонари в задних стойках
      'Material.023': ['lights', RED],
      'Material.022': ['lights', RED], // катафоты в бампере
    },
    wheel: [
      [['Material.009'], '#151618', 1], // шины: не упрощаем — иначе колесо многоугольником
      [['Material.011', 'Material.012', 'Material.013', 'Material.015'], '#b8bcc0', 0.012], // колпаки
    ],
  },
  elargus: {
    raw: '3d-models/lada_largus_cross_rest/scene.gltf', src: '3d-models/lada_largus_cross_rest_clean/scene.gltf',
    credit: 'This work is based on "Lada Largus Cross Rest" (https://sketchfab.com/3d-models/lada-largus-cross-rest-fe54b2a96397452fb26af48db4696960) by usolakolya (https://sketchfab.com/usolakolya) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
    pickX: -1.5,
    // Хвост расширителя задней арки (006) в исходнике мятый и рваный, сверху на нём лежит острый кончик заднего бампера —
    // у Cross это чёрный пластик, в цвет кузова стык был складкой над аркой. Хвост убираем (пороги кончаются раньше),
    // стык закрывает кончик бампера. Резать плоскостью хуже: ступенька (хвост выше кончика) или та же складка.
    cut: { 'Material.016': latch, 'Material.006': ([, , z]) => z < -1.58 },
    // «Иксы» в исходнике вровень с бампером, нижние лучи даже под ним — синее проступало клочками: выдвигаем наружу на 5 мм
    // (на 1 см нижние лучи уходят под чёрную часть бампера) и убираем кузов под ними (cover: луч из центра треугольника
    // наружу упирается в накладку ближе 1,5 см) — в облегчённом наборе кузов упрощён с ошибкой до 8 мм и иначе протыкал
    // накладку. Чёрный низ бампера не трогаем — по краям накладки дыры; детали в облегчённом наборе не упрощаем — упрощённые
    // низ бампера и «иксы» тоже давали зубцы.
    push: { 'Material.030': 0.005 },
    cover: { 'Material.002': ['Material.030', 0.015] },
    lod: { detail: 1 },
    // Выброшено: бокс и крепления (001, 005), моторный отсек, днище и выхлоп (040–083 без перечисленных ниже —
    // 170 тыс. треугольников только в 073 и 078).
    roles: {
      'Material.002': ['paint', '#ffffff'], // кузов, зеркала
      'Material.006': ['paint', '#ffffff'], // пороги (у Cross — пластик)
      'Material.007': ['paint', '#ffffff'], // расширители арок
      'Material.008': ['paint', '#ffffff'],
      'Material.009': ['paint', '#ffffff'],
      'Material.010': ['paint', '#ffffff'], // задний бампер
      'Material.091': ['detail', GLASS, GLASS_ERR], // лобовое, задние боковые, стёкла задних дверей
      'Material.087': ['detail', GLASS], // стёкла дверей
      'Material.089': ['detail', GLASS],
      'Material.019': ['detail', GLASS],
      'Material.090': ['detail', GLASS],
      'Material.003': ['detail', TRIM], // рамки окон и молдинги, по двери на материал
      'Material.004': ['detail', TRIM],
      'Material.011': ['detail', TRIM],
      'Material.012': ['detail', TRIM],
      'Material.016': ['detail', '#111214', 0.006], // уплотнители, подкрылки
      'Material.013': ['detail', '#17181b'], // решётка и нижняя часть переднего бампера
      'Material.084': ['detail', '#3a3d42'], // накладка под задним бампером
      'Material.017': ['detail', '#2e3136'], // рейлинги
      'Material.030': ['detail', '#2f7fe0', 0.001], // «иксы» на бампере — синие
      'Material.035': ['lights', HEAD], // фары
      'Material.028': ['lights', HEAD], // ходовые огни
      'Material.072': ['lights', FOG], // противотуманки
      'Material.037': ['lights', RED], // фонари в задних стойках
      1141: ['lights', RED],
      'Material.036': ['lights', RED],
      'Material.085': ['lights', RED], // катафоты
      'Material.086': ['lights', RED], // верхний стоп-сигнал
      'Material.038': ['lights', FOG], // задний ход
      'Material.039': ['lights', FOG],
    },
    // Только шины: литой диск исходника — сотни несвязанных деталей (32 тыс. треугольников), упрощение упирается в ~800
    // на колесо; диск рисует игра (wheelParts, alloy), как у Весты.
    hub: false,
    tireHalf: 0.1, // полуширина шины, м (205 мм): у исходника 11,8 см — боковина закрывала диск игры (он выступает на 11,3 см)
    wheel: [[['Material.023', 'Material.024', 'Material.026', 'Material.027'], '#151618', 1]],
  },
};

function build(name) {
  const car = CARS[name];
  const prims = readGltf(resolve(root, car.src)).filter((p) => bbox([p]).mid[0] < car.pickX); // закрытая машина
  const tireMats = car.wheel[0][0];
  const tires = () => prims.filter((p) => tireMats.includes(p.mat)).map((p) => bbox([p]));
  const avg = (l, f) => l.reduce((s, b) => s + f(b), 0) / l.length;
  const zOf = (b) => b.mid[2];

  // ---- координаты игры: x — от оси колёс, y — от низа шин, z — от середины кузова; масштаб по базе
  {
    const t = tires(), fr = t.filter((b) => b.mid[2] > 0), rr = t.filter((b) => b.mid[2] < 0);
    const S = BASE / (avg(fr, zOf) - avg(rr, zOf));
    const cx = avg(t, (b) => b.mid[0]), ground = Math.min(...t.map((b) => b.lo[1]));
    const cz = bbox(prims.filter((p) => car.roles[p.mat]?.[0] === 'paint')).mid[2];
    for (const p of prims) {
      for (let i = 0; i < p.pos.length; i += 3) {
        p.pos[i] = (p.pos[i] - cx) * S;
        p.pos[i + 1] = (p.pos[i + 1] - ground) * S;
        p.pos[i + 2] = (p.pos[i + 2] - cz) * S;
      }
    }
  }

  // ---- пропущенное с одного борта: зеркальная копия куска, если на том же месте другого борта нет такого же
  for (const mat of car.mirror ?? []) {
    const list = prims.filter((p) => p.mat === mat), mids = list.map((p) => bbox([p]).mid);
    list.forEach((p, i) => {
      const [x, , z] = mids[i];
      if (mids.some(([x2, , z2]) => Math.abs(x2 + x) < 0.1 && Math.abs(z2 - z) < 0.1)) return;
      const idx = p.idx.map((_, k) => p.idx[k - (k % 3) + [0, 2, 1][k % 3]]); // отражение выворачивает грани
      prims.push({ ...p, node: p.node + ' (зеркало)', pos: Float32Array.from(p.pos, (v, k) => (k % 3 === 0 ? -v : v)), idx });
      console.log('дополнено зеркалом:', mat, p.node);
    });
  }

  // ---- грани наружу. Зеркальные узлы исходника непоследовательны: у одних (фара, правые двери) обход надо развернуть,
  // как велит glTF (readGltf так и делает), у других (колпак) он уже развёрнут. Поэтому каждый кусок проверяем по геометрии:
  // площадь граней, смотрящих от продольной оси машины, должна перевешивать; иначе обход куска разворачиваем.
  const flipped = [];
  for (const p of prims) {
    let out = 0;
    for (let t = 0; t < p.idx.length; t += 3) {
      const v = [0, 1, 2].map((j) => [0, 1, 2].map((k) => p.pos[p.idx[t + j] * 3 + k]));
      const e1 = v[1].map((c, k) => c - v[0][k]), e2 = v[2].map((c, k) => c - v[0][k]);
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const c = [0, 1, 2].map((k) => (v[0][k] + v[1][k] + v[2][k]) / 3);
      const d = [c[0], c[1] - AXIS.y, c[2] - Math.max(-AXIS.z, Math.min(AXIS.z, c[2]))]; // от ближайшей точки оси
      out += n[0] * d[0] + n[1] * d[1] + n[2] * d[2];
    }
    if (out < 0 && (car.roles[p.mat] || car.wheel.some(([mats]) => mats.includes(p.mat)))) {
      for (let t = 0; t < p.idx.length; t += 3) [p.idx[t + 1], p.idx[t + 2]] = [p.idx[t + 2], p.idx[t + 1]];
      flipped.push(p.mat);
    }
  }
  if (flipped.length) console.log('развёрнуты грани:', flipped.join(' '));

  // ---- части
  const parts = { paint: [], detail: [], lights: [], wheel: [] };
  const stat = {};
  const add = (part, color, list, keep, label, absError) => {
    if (!list.length) return;
    const g = simplify(list, keep, { absError });
    parts[part].push({ ...g, color: hex(color) });
    stat[label] = `${list.reduce((s, p) => s + p.idx.length / 3, 0)} → ${g.idx.length / 3}`;
  };
  // Доля 0,02 — заведомо недостижимая цель: упрощает, пока ошибка не дойдёт до err.
  for (const [mat, [part, color, err = ERR]] of Object.entries(car.roles)) {
    let list = prims.filter((p) => p.mat === mat).map((p) => (car.push?.[mat] ? pushOut(p, car.push[mat]) : p));
    const cut = car.cut?.[mat], cover = car.cover?.[mat];
    if (cover) {
      const [by, within] = cover, tris = triangles(prims.filter((p) => p.mat === by).map((p) => (car.push?.[by] ? pushOut(p, car.push[by]) : p)));
      list = list.map((p) => ({ ...p, ...pickTri(p, (c, n) => !hits(tris, c, n, within)) }));
    }
    add(part, color, cut ? list.map((p) => ({ ...p, ...pick(p, (c) => !cut(c)) })) : list, 0.02, mat, err);
  }

  // Колёса: центры — по шинам; в модель — переднее правое (+x) вокруг своего центра, остальные игра ставит сама.
  const wheels = tires();
  const ref = wheels.find((b) => b.mid[0] > 0 && b.mid[2] > 0);
  const near = (p) => { const b = bbox([p]); return Math.abs(b.mid[0] - ref.mid[0]) < 0.2 && Math.abs(b.mid[2] - ref.mid[2]) < 0.2; };
  for (const [mats, color, keep] of car.wheel) {
    const sx = car.tireHalf ? car.tireHalf / (ref.size[0] / 2) : 1; // ужать шину по ширине
    const list = prims.filter((p) => mats.includes(p.mat) && near(p)).map((p) => ({ ...p, pos: Float32Array.from(p.pos, (v, i) => (v - ref.mid[i % 3]) * (i % 3 === 0 ? sx : 1)) }));
    add('wheel', color, list, keep, 'колесо ' + list.map((p) => p.mat).join());
  }

  const all = bbox([...parts.paint, ...parts.detail, ...parts.lights]), paint = bbox(parts.paint);
  const spec = {
    r: +(ref.size[1] / 2).toFixed(3), front: +avg(wheels.filter((b) => b.mid[2] > 0), zOf).toFixed(3),
    rear: +avg(wheels.filter((b) => b.mid[2] < 0), zOf).toFixed(3), track: +avg(wheels, (b) => Math.abs(b.mid[0])).toFixed(3),
  };
  console.log(`\n${name}`);
  console.table(stat);
  console.log('колёса', spec, '| длина', all.size[2].toFixed(2), 'ширина', paint.size[0].toFixed(2), 'высота', all.hi[1].toFixed(2));
  // hub: диск или колпак — в самой модели колеса (игра не дорисовывает свой).
  const hub = car.hub ?? true;
  writeGlb(`${root}/public/models/${name}.glb`, parts, { lod: car.lod, cull: true, copyright: car.credit, extras: { wheels: spec, length: +all.size[2].toFixed(3), width: +paint.size[0].toFixed(3), ...(hub && { hub }) } });
}

// Треугольники кусков списком [a, b, c] — для лучей.
function triangles(list) {
  const out = [];
  for (const p of list) for (let t = 0; t < p.idx.length; t += 3) out.push([0, 1, 2].map((j) => [0, 1, 2].map((k) => p.pos[p.idx[t + j] * 3 + k])));
  return out;
}
// Как pick из lib.mjs, но фильтру — центр и единичная нормаль треугольника.
function pickTri(p, keep) {
  const idx = [];
  for (const [t, [a, b, c]] of triangles([p]).entries()) {
    const e1 = b.map((v, k) => v - a[k]), e2 = c.map((v, k) => v - a[k]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], l = Math.hypot(...n) || 1;
    if (keep([0, 1, 2].map((k) => (a[k] + b[k] + c[k]) / 3), n.map((v) => v / l))) idx.push(p.idx[t * 3], p.idx[t * 3 + 1], p.idx[t * 3 + 2]);
  }
  return { pos: p.pos, idx: Uint32Array.from(idx) };
}
// Луч из точки o по направлению d упирается в один из треугольников ближе within (Мёллер — Трумбор).
function hits(tris, o, d, within) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  for (const [a, b, c] of tris) {
    if (Math.abs(a[0] - o[0]) > 0.1 || Math.abs(a[1] - o[1]) > 0.1 || Math.abs(a[2] - o[2]) > 0.1) continue;
    const e1 = sub(b, a), e2 = sub(c, a), h = cross(d, e2), det = dot(e1, h);
    if (Math.abs(det) < 1e-12) continue;
    const s = sub(o, a), u = dot(s, h) / det;
    if (u < 0 || u > 1) continue;
    const q = cross(s, e1), v = dot(d, q) / det;
    if (v < 0 || u + v > 1) continue;
    const t = dot(e2, q) / det;
    if (t > -0.002 && t < within) return true;
  }
  return false;
}

// Сдвинуть вершины куска наружу по нормали (средней по граням вокруг точки, швы развёртки — по положению).
function pushOut(p, d) {
  const key = (i) => [0, 1, 2].map((k) => Math.round(p.pos[i * 3 + k] * 2000)).join(), acc = new Map();
  for (let t = 0; t < p.idx.length; t += 3) {
    const v = [0, 1, 2].map((j) => [0, 1, 2].map((k) => p.pos[p.idx[t + j] * 3 + k]));
    const e1 = v[1].map((c, k) => c - v[0][k]), e2 = v[2].map((c, k) => c - v[0][k]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (let j = 0; j < 3; j++) {
      const a = acc.get(key(p.idx[t + j])) ?? [0, 0, 0];
      acc.set(key(p.idx[t + j]), a.map((c, k) => c + n[k]));
    }
  }
  const pos = Float32Array.from(p.pos);
  for (let i = 0; i < pos.length / 3; i++) {
    const n = acc.get(key(i));
    if (!n) continue;
    const l = Math.hypot(...n) || 1;
    for (let k = 0; k < 3; k++) pos[i * 3 + k] += (n[k] / l) * d;
  }
  return { ...p, pos };
}

// Команда чистки исходника: --drop — всё, чего нет в roles и wheel (не загораживает), --pick — закрытая машина.
function cleanCmd(name) {
  const car = CARS[name], esc = (s) => s.replace(/\./g, '\\.'), tires = car.wheel.flatMap(([mats]) => mats);
  const keep = [...Object.keys(car.roles), ...tires].map(esc).join('|');
  const q = (s) => `'${s}'`;
  return ['/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python blender/clean.py --',
    resolve(root, car.raw), resolve(root, car.src), '--drop', q(`/(?!(${keep})$)[^/]*$`),
    '--wheels', q(`/(${tires.map(esc).join('|')})$`), '--pick', q(`x < ${car.pickX}`), '--orient'].join(' ');
}

if (process.argv[2] === 'clean') for (const name of process.argv[3] ? [process.argv[3]] : Object.keys(CARS)) console.log(cleanCmd(name));
else for (const name of process.argv[2] ? [process.argv[2]] : Object.keys(CARS)) build(name);

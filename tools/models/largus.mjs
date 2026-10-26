// Сборка public/models/largus.glb и elargus.glb — Ларгусы автора usolakolya (Sketchfab, CC-BY-4.0):
//   largus  — «Lada Largus», до рестайлинга (2012–2021);
//   elargus — «Lada Largus Cross Rest», рестайлинг 2021 г. («икс»-морда): e-Largus внешне — обычный рестайлинговый
//             Ларгус, поэтому пластик Cross (арки, пороги, задний бампер) — в цвет кузова, серебристые «иксы»
//             на бампере — синие, как у электрических Lada.
// В каждом исходнике две одинаковые машины рядом по x (вторая — с открытыми дверями и капотом) и бокс на крыше; берём
// закрытую, бокс, салон, моторный отсек и днище выбрасываем. Перед — уже +z, y вверх; масштаб — по паспортной базе.
// Имена узлов безликие (mesh_id…), роли — по материалам (определены по снимкам: материал за материалом).
//
//   cd tools/models && npm install && node largus.mjs [largus|elargus]
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bbox, hex, readGltf, simplify, writeGlb } from './lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = 2.905; // колёсная база, м (паспорт, у обоих)
const AXIS = { y: 0.75, z: 1.4 }; // продольная ось кузова: отрезок x = 0, y = 0.75, |z| ≤ 1.4 (грани — наружу от неё)
const GLASS = '#26333f', TRIM = '#1b1c1f', CHROME = '#c8ccd0', RED = '#ff2a1a', HEAD = '#e8fbff', FOG = '#fff6d8';

// roles: материал → [часть, цвет, доля треугольников, которую оставить]; чего нет в списке — выбрасываем.
// wheel: шины, внутренняя часть и колпак/диск — у каждого колеса свои материалы, колесо выбирается по положению.
const CARS = {
  largus: {
    src: '3d-models/lada_largus/scene.gltf',
    credit: 'This work is based on "Lada Largus" (https://sketchfab.com/3d-models/lada-largus-ef5fd62d01ca49f1bd70bb596456c144) by usolakolya (https://sketchfab.com/usolakolya) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
    pick: (b) => b.mid[0] < 0,
    // С одного борта автор пропустил рамку окна с молдингом левой задней двери и полоску у кромки лобового — дополняем
    // зеркальной копией с другого борта.
    mirror: ['Material.001', 'Material.040'],
    // Выброшено: салон (026–037), бокс и его крепления (038, 039), начинка фар и противотуманок (018, 024 — 180 тыс.
    // треугольников).
    roles: {
      1403: ['paint', '#ffffff', 0.1], // кузов, бамперы, зеркала
      'Material.040': ['paint', '#ffffff', 0.3], // полоска по кромке лобового
      'Material.006': ['detail', GLASS, 0.6], // лобовое, задние боковые, стекло двери багажника
      'Material.007': ['detail', GLASS, 1], // стёкла дверей
      'Material.001': ['detail', TRIM, 0.15], // рамки окон, молдинги дверей
      'Material.020': ['detail', '#111214', 0.1], // уплотнитель лобового, подкрылки, накладка двери багажника
      'Material.003': ['detail', CHROME, 0.2], // хромовая рамка решётки
      'Material.019': ['detail', CHROME, 0.4], // хромовая планка с ладьёй
      'Material.005': ['detail', '#17181b', 1], // соты решётки и нижний воздухозаборник
      'Material.017': ['detail', '#2e3136', 0.3], // рейлинги
      'Material.008': ['detail', '#9aa3ab', 0.3], // стёкла зеркал
      'Material.002': ['lights', HEAD, 1], // фары
      'Material.004': ['lights', HEAD, 1],
      'Material.016': ['lights', FOG, 1], // противотуманки
      'Material.021': ['lights', RED, 0.5], // фонари в задних стойках
      'Material.023': ['lights', RED, 0.3],
      'Material.022': ['lights', RED, 1], // катафоты в бампере
    },
    wheel: [
      [['Material.009'], '#151618', 0.6], // шины
      [['1223'], '#3a3d42', 0.02], // спицы под колпаком
      [['Material.011', 'Material.012', 'Material.013', 'Material.015'], '#b8bcc0', 0.025], // колпаки
    ],
  },
  elargus: {
    src: '3d-models/lada_largus_cross_rest/scene.gltf',
    credit: 'This work is based on "Lada Largus Cross Rest" (https://sketchfab.com/3d-models/lada-largus-cross-rest-fe54b2a96397452fb26af48db4696960) by usolakolya (https://sketchfab.com/usolakolya) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
    pick: (b) => b.mid[0] < -1.5,
    // Выброшено: бокс и крепления (001, 005), моторный отсек, днище и выхлоп (040–083 без перечисленных ниже —
    // 170 тыс. треугольников только в 073 и 078).
    roles: {
      'Material.002': ['paint', '#ffffff', 0.18], // кузов, зеркала
      'Material.006': ['paint', '#ffffff', 0.3], // пороги (у Cross — пластик)
      'Material.007': ['paint', '#ffffff', 0.3], // расширители арок
      'Material.008': ['paint', '#ffffff', 0.3],
      'Material.009': ['paint', '#ffffff', 0.3],
      'Material.010': ['paint', '#ffffff', 0.2], // задний бампер
      'Material.091': ['detail', GLASS, 0.6], // лобовое, задние боковые, стёкла задних дверей
      'Material.087': ['detail', GLASS, 1], // стёкла дверей
      'Material.089': ['detail', GLASS, 1],
      'Material.019': ['detail', GLASS, 1],
      'Material.090': ['detail', GLASS, 1],
      'Material.003': ['detail', TRIM, 0.2], // рамки окон и молдинги, по двери на материал
      'Material.004': ['detail', TRIM, 0.2],
      'Material.011': ['detail', TRIM, 0.2],
      'Material.012': ['detail', TRIM, 0.2],
      'Material.016': ['detail', '#111214', 0.06], // уплотнители, подкрылки
      'Material.013': ['detail', '#17181b', 0.15], // решётка и нижняя часть переднего бампера
      'Material.084': ['detail', '#3a3d42', 0.3], // накладка под задним бампером
      'Material.017': ['detail', '#2e3136', 0.3], // рейлинги
      'Material.030': ['detail', '#2f7fe0', 0.4], // «иксы» на бампере — синие
      'Material.035': ['lights', HEAD, 0.25], // фары
      'Material.028': ['lights', HEAD, 1], // ходовые огни
      'Material.072': ['lights', FOG, 1], // противотуманки
      'Material.037': ['lights', RED, 0.5], // фонари в задних стойках
      1141: ['lights', RED, 0.5],
      'Material.036': ['lights', RED, 1],
      'Material.085': ['lights', RED, 1], // катафоты
      'Material.086': ['lights', RED, 1], // верхний стоп-сигнал
      'Material.038': ['lights', FOG, 1], // задний ход
      'Material.039': ['lights', FOG, 1],
    },
    wheel: [
      [['Material.023', 'Material.024', 'Material.026', 'Material.027'], '#151618', 0.6], // шины
      [['Material.031', 'Material.032', 'Material.033', 'Material.034'], '#9a9ea3', 0.01], // литые диски
    ],
  },
};

function build(name) {
  const car = CARS[name];
  const prims = readGltf(resolve(root, car.src)).filter((p) => car.pick(bbox([p]))); // закрытая машина
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
  const add = (part, color, list, keep, label) => {
    if (!list.length) return;
    const g = simplify(list, keep);
    parts[part].push({ ...g, color: hex(color) });
    stat[label] = `${list.reduce((s, p) => s + p.idx.length / 3, 0)} → ${g.idx.length / 3}`;
  };
  for (const [mat, [part, color, keep]] of Object.entries(car.roles)) add(part, color, prims.filter((p) => p.mat === mat), keep, mat);

  // Колёса: центры — по шинам; в модель — переднее правое (+x) вокруг своего центра, остальные игра ставит сама.
  const wheels = tires();
  const ref = wheels.find((b) => b.mid[0] > 0 && b.mid[2] > 0);
  const near = (p) => { const b = bbox([p]); return Math.abs(b.mid[0] - ref.mid[0]) < 0.2 && Math.abs(b.mid[2] - ref.mid[2]) < 0.2; };
  for (const [mats, color, keep] of car.wheel) {
    const list = prims.filter((p) => mats.includes(p.mat) && near(p)).map((p) => ({ ...p, pos: Float32Array.from(p.pos, (v, i) => v - ref.mid[i % 3]) }));
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
  writeGlb(`${root}/public/models/${name}.glb`, parts, { copyright: car.credit, extras: { wheels: spec, length: +all.size[2].toFixed(3), width: +paint.size[0].toFixed(3), hub: true } });
}

for (const name of process.argv[2] ? [process.argv[2]] : Object.keys(CARS)) build(name);

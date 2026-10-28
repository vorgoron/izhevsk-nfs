// Сборка public/models/oda.glb из модели «izh2126_oda_rework_dcs» (87-Motors, Sketchfab, CC-BY-4.0).
// Исходник — мод для BeamNG: в одном файле все варианты деталей (капот с вырезом, четыре передних бампера,
// обвес, спойлер, шашка такси, V8, каркас, ковши) плюс салон и подвеска. Берём только стоковый кузов
// по именам узлов (детей «Collada visual scene group»), каждому узлу — свои материалы и роль. Колёс в
// исходнике нет — колесо с колпаком берётся из собранной модели Москвича (public/models/moskvich.glb).
// Варианты деталей (бамперы, фары, спойлер, обвес, шашка такси) — отдельными мешами «o-слот-вариант-часть»,
// игра собирает машину из выбранных в гараже (MODELS.oda.options в vehicles.js; первый вариант — по умолчанию).
//
//   cd tools/models && npm install && node oda.mjs путь/к/izh2126_oda_rework_dcs/scene.gltf
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bbox, hex, readGlbPart, readGltf, simplify, writeGlb } from './lib.mjs';

const src = resolve(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '../../3d-models/izh2126_oda_rework_dcs/scene.gltf'));
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/models/oda.glb');

// Модель длиннее настоящей (база 2,65 м против 2,47) и чуть шире — по длине и ширине кузова приводим к
// паспорту (4,068 × 1,65), высоту не трогаем: крыша и так на 1,35 м.
const LENGTH = 4.068, WIDTH = 1.65;
// Колёс нет: центры — по тормозным дискам спереди и мосту сзади, радиус — 165/70 R13. Колесо — Москвича
// (r 0,3), ужатое до нашего радиуса. LIFT — кузов выше над колёсами: у исходника посадка занижена.
const WHEEL = { r: 0.28, y: 0.28, front: 1.35, rear: -1.3, x: 0.7 }, LIFT = 0.05;
const wheelSrc = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/models/moskvich.glb'), WHEEL_SRC_R = 0.3;

const PAINT = '#ffffff', BLACK = '#1b1c1f', UNDER = '#151618', GLASS = '#26333f', CHROME = '#c8ccd0';
const HEAD = '#fff6d8', AMBER = '#ffb030', RED = '#ff2a1a', REVERSE = '#f4f2ea';

// Узел → { материал: [часть, цвет, доля треугольников] }; '*' — все остальные материалы узла.
// Материалов без записи (салонные обивки дверей и т. п.) в игре нет.
const body = { kuzov: ['paint', PAINT, 0.12] };
const door = { ...body, izh_plastic: ['detail', BLACK, 0.3], Matte__FF999999__spec: ['detail', '#2a2c30', 0.3] };
const NODES = {
  izh_kuzov: { kuzov: ['paint', PAINT, 0.07] },
  izh_bonnet: body, izh_wingl: body, izh_wingr: body,
  izh_trunk: { ...body, izh_plastic: ['detail', BLACK, 0.2], Matte__FF999999__spec: ['detail', CHROME, 0.5] },
  izh_door_lf: door, izh_door_rf: door, izh_door_lr: door, izh_door_rr: door,
  izh_door_lf_mirror: { '*': ['detail', BLACK, 0.08] }, izh_door_rf_mirror: { '*': ['detail', BLACK, 0.08] },
  izh_windscreen: { '*': ['detail', GLASS, 0.6] }, izh_glass_trunk: { '*': ['detail', GLASS, 1] },
  izh_door_lf_glass: { '*': ['detail', GLASS, 1] }, izh_door_rf_glass: { '*': ['detail', GLASS, 1] },
  izh_door_lr_glass: { '*': ['detail', GLASS, 1] }, izh_door_rr_glass: { '*': ['detail', GLASS, 1] },
  izh_sidel: { '*': ['detail', GLASS, 1] }, izh_sider: { '*': ['detail', GLASS, 1] },
  izh_rezinki_stekla: { '*': ['detail', BLACK, 0.12] }, // уплотнители стёкол
  izh_reshotka: { izh_plastic: ['detail', BLACK, 0.5], Matte__FFFFFFFF__spec: ['detail', CHROME, 1] }, // решётка и эмблема
  izh_dnishe: { under__spec: ['detail', UNDER, 0.06] }, izh_locker_l: { '*': ['detail', UNDER, 0.5] }, izh_locker_r: { '*': ['detail', UNDER, 0.5] },
  izh_blinker_l: { '*': ['lights', AMBER, 0.3] }, izh_blinker_r: { '*': ['lights', AMBER, 0.3] }, // повторители на крыльях
  // Фонари: стекло одно на всю секцию (цвета были в текстуре) — берём секции под ним.
  izh_taillight_l: { stopsignal: ['lights', RED, 0.3], gabarity: ['lights', RED, 0.3], signall: ['lights', AMBER, 0.3],
    reverse: ['lights', REVERSE, 0.3], optik_zad_oda__env_2_spec: ['lights', RED, 0.3], '*': ['detail', BLACK, 0.3] },
  izh_taillight_r: { stopsignal: ['lights', RED, 0.3], gabarity: ['lights', RED, 0.3], signalr: ['lights', AMBER, 0.3],
    reverse: ['lights', REVERSE, 0.3], optik_zad_oda__env_2_spec: ['lights', RED, 0.3], '*': ['detail', BLACK, 0.3] },
  izh_trunk_sig: { stopsignal: ['lights', RED, 1], izh_plastic: ['detail', BLACK, 0.3] }, // третий стоп-сигнал
};

// Слот → вариант → узлы, как в NODES. Порядок слотов и вариантов — как в MODELS.oda.options (vehicles.js).
// Фары: внутренности (отражатели, лампы) закрыты стеклом — берём стекло: сама фара, угловой поворотник, рамка.
const headGlass = { farast: ['lights', HEAD, 1], optik_oda__spec: ['lights', AMBER, 1], Matte__FF050505: ['detail', BLACK, 1] };
// Круглые фары: стекло двух фар, корпус, угловой поворотник (его части — разными материалами).
const round = { steklo06: ['lights', HEAD, 0.08], plastic06: ['detail', BLACK, 0.03], Matte__FFFFFFFF__spec: ['lights', AMBER, 1],
  Matte__FFCCCCCC__spec: ['lights', AMBER, 1], Matte__FF999999__spec: ['detail', BLACK, 1] };
const OPTIONS = {
  front: {
    stock: { izh_bump_front_ok: { '*': ['detail', BLACK, 0.25] } },
    paint: { izh_bump_front_cvet: { '*': ['paint', PAINT, 0.25] } },
    tune: { izh_bump_front_ok_tune: { '*': ['detail', BLACK, 0.25] } },
    bullbar: { izh_bump_front_ok_kengur: { izh_plastic: ['detail', BLACK, 0.25], izh_koleso2: ['detail', CHROME, 0.4] } },
  },
  rear: {
    stock: { izh_bumper_rear_ok: { '*': ['detail', BLACK, 0.25] } },
    paint: { izh_bumper_rear_cvet: { '*': ['paint', PAINT, 0.25] } },
  },
  lamps: {
    stock: { izh_headlightglass_l: headGlass, izh_headlightglass_r: headGlass },
    round: { izh_farst: round, izh_farstr: round },
  },
  spoiler: {
    lip: { izh_ducktail: { izh_plastic: ['paint', PAINT, 0.3] } }, // «утиный хвост» в цвет; второй материал — тысячи мелких болтов
    wing: { izh_spoiler: { '*': ['paint', PAINT, 0.5] } },
  },
  kit: { wide: { izh_obves: { '*': ['paint', PAINT, 0.3] } } }, // расширители арок и пороги
  // Шашка: сама табличка светится (lights), шашечки были в текстуре.
  taxi: { taxi: { izh_shashki: { izh_plastic: ['detail', BLACK, 1], izh_vehiclelights128: ['lights', '#f5c518', 1] } } },
};
// Узел → { roles, prefix }: prefix '' — кузов, 'o-слот-вариант-' — вариант; stock — входит в габариты (штатные детали).
const OWNER = {};
for (const [top, roles] of Object.entries(NODES)) OWNER[top] = { roles, prefix: '', stock: true };
for (const [slot, variants] of Object.entries(OPTIONS)) {
  for (const [variant, nodes] of Object.entries(variants)) {
    for (const [top, roles] of Object.entries(nodes)) OWNER[top] = { roles, prefix: `o-${slot}-${variant}-`, stock: variant === 'stock' };
  }
}
// Обвес в исходнике поднят над машиной (у узла свой сдвиг на 1,84 м). Шашка стоит сбоку крыши с креном по её
// скату (~4,2°): выравниваем крен вокруг её центра (x 0,405, y 1,36), ставим на середину крыши (верх там — 1,341).
const SHIFT = { izh_obves: [0, -1.838749, 0] };
const TAXI = { x: 0.405, y: 1.36, roll: Math.atan2(1.33 - 1.313, 0.506 - 0.276), roof: 1.341 };

// ---------------------------------------------------------------- чтение: узел верхнего уровня у каждого примитива

const gltf = JSON.parse(readFileSync(src, 'utf8'));
const parent = [];
gltf.nodes.forEach((n, i) => (n.children || []).forEach((c) => (parent[c] = i)));
const root = gltf.nodes.findIndex((n) => n.name === 'Collada visual scene group');
const order = []; // узел каждого примитива в порядке readGltf
(function walk(ids) {
  for (const id of ids) {
    const n = gltf.nodes[id];
    if (n.mesh != null) for (const p of gltf.meshes[n.mesh].primitives) order.push({ id, lines: (p.mode ?? 4) !== 4 });
    if (n.children) walk(n.children);
  }
})(gltf.scenes[0].nodes);
const top = (i) => { while (parent[i] !== root) i = parent[i]; return gltf.nodes[i].name; };
const prims = readGltf(src).map((p, k) => ({ ...p, top: top(order[k].id), lines: order[k].lines })).filter((p) => !p.lines && OWNER[p.top]);
for (const p of prims) {
  const d = SHIFT[p.top];
  if (d) for (let i = 0; i < p.pos.length; i += 3) for (let k = 0; k < 3; k++) p.pos[i + k] += d[k];
}
const taxi = prims.filter((p) => p.top === 'izh_shashki'), cos = Math.cos(TAXI.roll), sin = Math.sin(TAXI.roll);
for (const p of taxi) {
  for (let i = 0; i < p.pos.length; i += 3) {
    const x = p.pos[i] - TAXI.x, y = p.pos[i + 1] - TAXI.y;
    p.pos[i] = x * cos - y * sin;
    p.pos[i + 1] = TAXI.y + x * sin + y * cos;
  }
}
if (taxi.length) {
  const lift = TAXI.roof - bbox(taxi).lo[1] - 0.005; // основание чуть в крыше — без щели
  for (const p of taxi) for (let i = 1; i < p.pos.length; i += 3) p.pos[i] += lift;
}

// ---------------------------------------------------------------- координаты игры

// Перед исходника — +z, как в игре. Ноль по x и z — середина кузова, по y — земля (низ колеса).
const stock = prims.filter((p) => OWNER[p.top].stock);
const all = bbox(stock), shell = bbox(stock.filter((p) => p.mat === 'kuzov'));
const SZ = LENGTH / all.size[2], SX = WIDTH / shell.size[0];
const groundY = WHEEL.y - WHEEL.r - LIFT; // земля под низом колеса
for (const p of prims) {
  for (let i = 0; i < p.pos.length; i += 3) {
    p.pos[i] = (p.pos[i] - all.mid[0]) * SX;
    p.pos[i + 1] -= groundY;
    p.pos[i + 2] = (p.pos[i + 2] - all.mid[2]) * SZ;
  }
}

// ---------------------------------------------------------------- части

const groups = new Map(); // префикс|часть|цвет|доля → примитивы
for (const p of prims) {
  const { roles, prefix } = OWNER[p.top], role = roles[p.mat] || roles['*'];
  if (!role) continue;
  const key = [prefix, ...role].join('|');
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(p);
}
const parts = { paint: [], detail: [], lights: [], wheel: [] };
for (const g of readGlbPart(wheelSrc, 'wheel')) parts.wheel.push({ ...g, pos: g.pos.map((v) => (v * WHEEL.r) / WHEEL_SRC_R) });
const stat = {};
for (const [key, list] of groups) {
  const [prefix, part, color, keep] = key.split('|');
  const g = simplify(list, +keep);
  (parts[prefix + part] ||= []).push({ ...g, color: hex(color) });
  stat[`${prefix}${part} ${color} ×${keep}`] = `${list.reduce((s, p) => s + p.idx.length / 3, 0)} → ${g.idx.length / 3}`;
}
console.table(stat);

const wheels = {
  r: WHEEL.r, front: +((WHEEL.front - all.mid[2]) * SZ).toFixed(3), rear: +((WHEEL.rear - all.mid[2]) * SZ).toFixed(3),
  track: +(WHEEL.x * SX).toFixed(3),
};
const length = +(all.size[2] * SZ).toFixed(3), width = +(shell.size[0] * SX).toFixed(3);
console.log('колёса', wheels, '| длина', length, 'ширина', width, 'высота', (shell.hi[1] - groundY).toFixed(2), 'просвет', (shell.lo[1] - groundY).toFixed(2));

const credit = 'This work is based on "izh2126_oda_rework_dcs" (https://sketchfab.com/3d-models/izh2126-oda-rework-dcs-30a9c029e82f4b62bf97d136c58a7d9c) by 87-Motors (https://sketchfab.com/87-Motors) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)';
// hub: колпак — в самой модели колеса (игра не дорисовывает свой диск).
// Кузов в облегчённом наборе — полный: упрощение даже на 5 % рвёт порог и заднюю дверь (тонкие стенки, сваренные по краю).
writeGlb(out, parts, { cull: true, copyright: credit, extras: { wheels, length, width, hub: true }, lod: { paint: 1 } });

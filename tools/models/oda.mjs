// Сборка public/models/oda.glb из STL-модели ИЖ-2126 «Ода» (сплошная модель для печати: без цветов
// и частей, колёса срощены с кузовом). Части раскладываются по положению и наклону граней: стёкла —
// в силуэте салона, фары и фонари — по месту на носу и корме, бамперы и низ — чёрный пластик,
// колёса — внутри окружностей вокруг осей (вырезаются из кузова, одно колесо — отдельной частью).
// Границы сняты с ортогональных видов модели с сеткой 10 см.
//
//   cd tools/models && npm install && node oda.mjs путь/к/модели.stl
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bbox, hex, simplify, writeGlb } from './lib.mjs';

const src = resolve(process.argv[2] || `${process.env.HOME}/Downloads/0fae390382b029e3018a7625a8925c82.stl`);
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/models/oda.glb');

// Масштаб: длина по паспорту 4,068 м; модель шире настоящей (1,9 м против 1,65) — ширину ужимаем.
const LENGTH = 4.068, WIDTH_K = 0.86;

// Цвета и сколько треугольников оставить.
const LOOK = {
  paint: ['paint', '#ffffff', 4200],
  glass: ['detail', '#26333f', 500],
  black: ['detail', '#1b1c1f', 1300],
  plate: ['detail', '#f0f0ea', 60],
  head: ['lights', '#fff6d8', 150],
  amber: ['lights', '#ffb030', 60],
  tail: ['lights', '#ff2a1a', 120],
  tire: ['wheel', '#151618', 130],
  hub: ['wheel', '#9ea3a8', 50],
};
// Длинные треугольники исходника пересекают границы стёкол и фар; цвет берётся по центру треугольника,
// поэтому до раскраски их дробим — иначе края стёкол идут зубцами.
const MAX_EDGE = 0.06;

// ---------------------------------------------------------------- чтение STL → координаты игры

const buf = readFileSync(src);
const n = buf.readUInt32LE(80);
if (buf.length !== 84 + 50 * n) throw new Error('нужен двоичный STL');
const raw = new Float32Array(n * 9);
for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) raw[i * 9 + k] = buf.readFloatLE(84 + i * 50 + 12 + k * 4);
// STL: z вверх, перед — в сторону −y. Игра: y вверх, перед — +z.
const src3 = { pos: raw };
const b0 = bbox([src3]);
const S = LENGTH / b0.size[1];
const game = (i) => [(raw[i * 3] - b0.mid[0]) * S * WIDTH_K, (raw[i * 3 + 2] - b0.lo[2]) * S, -(raw[i * 3 + 1] - b0.mid[1]) * S];
// Деление пополам по длинной стороне, пока все стороны не короче MAX_EDGE.
const out9 = [];
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
function split(a, b, c) {
  const ab = d2(a, b), bc = d2(b, c), ca = d2(c, a), m = Math.max(ab, bc, ca);
  if (m <= MAX_EDGE * MAX_EDGE) { out9.push(...a, ...b, ...c); return; }
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
  if (m === ab) { const h = mid(a, b); split(a, h, c); split(h, b, c); }
  else if (m === bc) { const h = mid(b, c); split(a, b, h); split(a, h, c); }
  else { const h = mid(c, a); split(a, b, h); split(h, b, c); }
}
for (let i = 0; i < n; i++) split(game(i * 3), game(i * 3 + 1), game(i * 3 + 2));
const tri = new Float32Array(out9);
const nt = tri.length / 9;
console.log('треугольников', n, '→ после дробления', nt);

// Центр и нормаль треугольника.
function info(i) {
  const p = tri.subarray(i * 9, i * 9 + 9);
  const c = [(p[0] + p[3] + p[6]) / 3, (p[1] + p[4] + p[7]) / 3, (p[2] + p[5] + p[8]) / 3];
  const u = [p[3] - p[0], p[4] - p[1], p[5] - p[2]], v = [p[6] - p[0], p[7] - p[1], p[8] - p[2]];
  const nn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(...nn) || 1;
  return { c, nrm: nn.map((x) => x / l) };
}
const T = Array.from({ length: nt }, (_, i) => info(i));

// ---------------------------------------------------------------- колёса

// Начальная оценка (по точкам касания земли), затем уточнение по габаритам граней внутри круга.
const guess = [[1.18, 1], [-1.15, -1]];
const wheels = [];
for (const [zg] of guess) for (const s of [-1, 1]) {
  const near = T.filter(({ c }) => s * c[0] > 0.56 && Math.hypot(c[1] - 0.29, c[2] - zg) < 0.33);
  const ys = near.map(({ c }) => c[1]), zs = near.map(({ c }) => c[2]), xs = near.map(({ c }) => s * c[0]);
  const lo = Math.min(...ys), hi = Math.max(...ys), zlo = Math.min(...zs), zhi = Math.max(...zs);
  wheels.push({ x: s * (Math.min(...xs) + Math.max(...xs)) / 2, y: (lo + hi) / 2, z: (zlo + zhi) / 2, r: (hi - lo + zhi - zlo) / 4, s });
}
// Радиус — по высоте оси: колесо стоит на земле (габариты граней задевают арку и врут на пару см).
const R = wheels.reduce((a, w) => a + w.y, 0) / 4;
const inWheel = (c) => wheels.find((w) => w.s * c[0] > 0.56 && Math.hypot(c[1] - w.y, c[2] - w.z) < R + 0.015);

// ---------------------------------------------------------------- раскраска

const zA = (y) => 0.68 - ((y - 0.95) / 0.41) * 0.46;  // линия лобового стекла и передней стойки
const zR = (y) => -1.53 + ((y - 0.93) / 0.43) * 0.51; // задний край заднего бокового стекла
function look({ c, nrm }, w) {
  const [x, y, z] = c, ax = Math.abs(x), [nx, ny, nz] = nrm;
  if (w) return Math.hypot(y - w.y, z - w.z) < 0.58 * R && w.s * x > Math.abs(w.x) ? 'hub' : 'tire';
  if (y < 0.2) return 'black'; // днище, глушитель, брызговики
  if (ax > 0.8 && y > 0.88 && y < 1.15 && z > 0.35 && z < 0.8) return 'black'; // зеркала
  if (z > 1.8) {
    if (y > 0.62 && y < 0.77 && ax > 0.3 && ax < 0.62 && nz > 0.3) return 'head';
    if (y > 0.56 && y < 0.77 && ax >= 0.62 && ax < 0.76) return 'amber'; // поворотники на углах
    if (y > 0.56 && y < 0.74 && ax < 0.3) return 'black'; // решётка
    if (y > 0.37 && y < 0.5 && ax < 0.27 && nz > 0.5) return 'plate';
  }
  if (z < -1.85) {
    if (y > 0.69 && y < 0.83 && ax > 0.25 && ax < 0.8 && nz < -0.3) return 'tail';
    if (y > 0.7 && y < 0.81 && ax < 0.24 && nz < -0.3) return 'plate';
  }
  if ((z > 1.45 && y < 0.565) || (z < -1.42 && y < 0.585)) return 'black'; // бамперы
  // Стёкла: лобовое, заднее (двери багажника), боковые в силуэте салона (стойки — тоже тёмные, как у «Оды»).
  if (nz > 0.25 && ny > 0.25 && ny < 0.92 && y > 0.97 && y < 1.39 && z > 0.1 && z < 0.8 && ax < 0.66) return 'glass';
  if (nz < -0.25 && ny < 0.92 && y > 1.0 && z < -1.0 && ax < 0.68) return 'glass';
  if (Math.abs(nx) > 0.55 && y > 0.94 && y < 1.365 && z < zA(y) - 0.02 && z > zR(y) + 0.02) return 'glass';
  return 'paint';
}

const groups = {};
const ref = wheels.find((w) => w.s > 0 && w.z > 0); // колесо-образец: переднее правое
for (let i = 0; i < nt; i++) {
  const w = inWheel(T[i].c);
  if (w && w !== ref) continue; // остальные колёса игра ставит сама
  const key = look(T[i], w);
  const g = (groups[key] ??= []);
  const p = tri.slice(i * 9, i * 9 + 9);
  if (w) for (let k = 0; k < 9; k += 3) { p[k] -= w.x; p[k + 1] -= w.y; p[k + 2] -= w.z; } // колесо — вокруг своей оси
  g.push(p);
}

const parts = { paint: [], detail: [], lights: [], wheel: [] };
const stat = {};
for (const [key, [part, color, count]] of Object.entries(LOOK)) {
  const list = groups[key];
  if (!list) continue;
  const pos = new Float32Array(list.length * 9);
  list.forEach((p, i) => pos.set(p, i * 9));
  const g = simplify([{ pos, idx: Uint32Array.from({ length: list.length * 3 }, (_, i) => i) }], count / list.length, { lockBorder: true });
  parts[part].push({ ...g, color: hex(color) });
  stat[key] = `${list.length} → ${g.idx.length / 3}`;
}
console.table(stat);

const fr = wheels.filter((w) => w.z > 0), rr = wheels.filter((w) => w.z < 0);
const avg = (l, f) => +(l.reduce((s, w) => s + f(w), 0) / l.length).toFixed(3);
const wheelSpec = { r: +R.toFixed(3), front: avg(fr, (w) => w.z), rear: avg(rr, (w) => w.z), track: avg(wheels, (w) => Math.abs(w.x)) };
const body = bbox([{ pos: tri }]);
console.log('колёса', wheelSpec, 'центры по высоте', wheels.map((w) => w.y.toFixed(3)).join(' '), '| длина', body.size[2].toFixed(2), 'ширина', body.size[0].toFixed(2), 'высота', body.hi[1].toFixed(2));

// hub: диск — в самой модели колеса (игра не дорисовывает свой).
writeGlb(out, parts, { copyright: 'ИЖ-2126 «Ода» — STL-модель (источник уточняется)', extras: { wheels: wheelSpec, length: +body.size[2].toFixed(3), width: +body.size[0].toFixed(3), hub: true } });

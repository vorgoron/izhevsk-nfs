// Сборка public/models/vesta.glb из модели «Lada Vesta» (tiunov.se, Sketchfab, CC-BY-4.0).
// Исходник (~200 тыс. треугольников) упрощается до нескольких тысяч и раскладывается на части
// игры: paint (кузов — под цвет), detail (стекло, пластик, хром), lights (фары, фонари), wheel
// (одно колесо вокруг своего центра, ось — x). Координаты — как у процедурных машин: +z вперёд,
// y вверх от земли, x — поперёк. Размеры колёс пишутся в extras сцены.
//
//   cd tools/vesta && npm install && node build.mjs ~/Downloads/lada_vesta/scene.gltf
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeshoptSimplifier } from 'meshoptimizer';

const src = resolve(process.argv[2] || join(process.env.HOME, 'Downloads/lada_vesta/scene.gltf'));
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/models/vesta.glb');

// Материал исходника → [часть, цвет, доля треугольников, которую оставить]. null — выбросить.
const ROLES = {
  kuzov: ['paint', '#ffffff', 0.2],
  stekloton: ['detail', '#26333f', 0.5],
  plastic: ['detail', '#1b1c1f', 0.08],
  hrom: ['detail', '#c8ccd0', 0.12],
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
// Колесо: только шина. Диск исходника — сотни мелких несвязанных деталей (болты, отверстия), упрощению
// не поддаётся (28 тыс. → 1,9 тыс.); диск игра рисует сама (wheelParts в vehicles.js).
const WHEEL = { plastic: ['#151618', 0.04] };

// ---------------------------------------------------------------- чтение glTF

const gltf = JSON.parse(readFileSync(src, 'utf8'));
const bin = readFileSync(join(dirname(src), gltf.buffers[0].uri));
const COMP = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function accessor(i) {
  const a = gltf.accessors[i], v = gltf.bufferViews[a.bufferView], T = COMP[a.componentType], n = NUM[a.type];
  const stride = (v.byteStride || 0) / T.BYTES_PER_ELEMENT || n;
  const base = new T(bin.buffer, bin.byteOffset + (v.byteOffset || 0) + (a.byteOffset || 0), (a.count - 1) * stride + n);
  const outArr = new (T === Float32Array ? Float32Array : Uint32Array)(a.count * n);
  for (let k = 0; k < a.count; k++) for (let j = 0; j < n; j++) outArr[k * n + j] = base[k * stride + j];
  return outArr;
}
const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) { // столбцовые 4×4
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function local(n) {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1], [tx, ty, tz] = n.translation || [0, 0, 0];
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
}
const apply = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];

// Все примитивы в мировых координатах: { node, wheel (имя колеса или null), mat, pos, idx }.
const prims = [];
(function walk(ids, parent, wheel) {
  for (const id of ids) {
    const n = gltf.nodes[id], m = mul(parent, local(n)), w = wheel || (/^wheel/.test(n.name || '') ? n.name : null);
    if (n.mesh != null) {
      for (const p of gltf.meshes[n.mesh].primitives) {
        const raw = accessor(p.attributes.POSITION), pos = new Float32Array(raw.length);
        for (let i = 0; i < raw.length; i += 3) pos.set(apply(m, raw[i], raw[i + 1], raw[i + 2]), i);
        const idx = p.indices != null ? accessor(p.indices) : Uint32Array.from({ length: raw.length / 3 }, (_, i) => i);
        prims.push({ node: n.name, wheel: w, mat: gltf.materials[p.material].name, pos, idx });
      }
    }
    if (n.children) walk(n.children, m, w);
  }
})(gltf.scenes[0].nodes, I4, null);

// ---------------------------------------------------------------- оси игры

const bbox = (list) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const { pos } of list) for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], pos[i + k]); hi[k] = Math.max(hi[k], pos[i + k]);
  }
  return { lo, hi, size: hi.map((h, k) => h - lo[k]), mid: hi.map((h, k) => (h + lo[k]) / 2) };
};
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

// ---------------------------------------------------------------- упрощение

await MeshoptSimplifier.ready;
// Сварить вершины по положению (UV и нормали исходника не нужны — нормали плоские, считаются в игре).
function weld(list) {
  const map = new Map(), pos = [], idx = [];
  for (const p of list) {
    for (const i of p.idx) {
      const x = p.pos[i * 3], y = p.pos[i * 3 + 1], z = p.pos[i * 3 + 2];
      const key = `${Math.round(x * 2000)},${Math.round(y * 2000)},${Math.round(z * 2000)}`;
      let v = map.get(key);
      if (v === undefined) { v = pos.length / 3; map.set(key, v); pos.push(x, y, z); }
      idx.push(v);
    }
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}
function simplify(list, keep) {
  const { pos, idx } = weld(list);
  if (keep >= 1) return { pos, idx };
  const target = Math.max(12, Math.floor((idx.length / 3) * keep) * 3);
  // Допустимую ошибку поднимаем, пока не дойдём до цели (мелкие детали упираются в порог раньше).
  let res = idx;
  for (const err of [0.01, 0.03, 0.08, 0.2, 0.5]) {
    [res] = MeshoptSimplifier.simplify(idx, pos, 3, target, err);
    if (res.length <= target * 1.3) break;
  }
  return { pos, idx: res };
}

// Часть игры: набор цветных групп → одна геометрия (позиции, цвета, индексы).
const parts = { paint: [], detail: [], lights: [], wheel: [] };
const hex = (c) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16) / 255);
const stat = {};
for (const [mat, role] of Object.entries(ROLES)) {
  if (!role) continue;
  // Лобовое и передние боковые стёкла в исходнике — светлым материалом фар (steklo); стёкла фар
  // (остальной steklo) выбрасываем, чтобы фары светили.
  const glass = (p) => p.mat === 'steklo' && /^(steklo_|door)/.test(p.node);
  const list = prims.filter((p) => !p.wheel && (p.mat === mat || (mat === 'stekloton' && glass(p))));
  if (!list.length) continue;
  const g = simplify(list, role[2]);
  parts[role[0]].push({ ...g, color: hex(role[1]) });
  stat[mat] = `${list.reduce((s, p) => s + p.idx.length / 3, 0)} → ${g.idx.length / 3}`;
}
// Колесо: переднее с +x; ставим центр в 0.
const wheelNames = [...new Set(prims.filter((p) => p.wheel).map((p) => p.wheel))];
const wheelBoxes = wheelNames.map((n) => ({ n, b: bbox(prims.filter((p) => p.wheel === n)) }));
const ref = wheelBoxes.find(({ b }) => b.mid[0] > 0 && b.mid[2] > 0);
const c = ref.b.mid;
for (const [mat, [color, keep]] of Object.entries(WHEEL)) {
  const list = prims.filter((p) => p.wheel === ref.n && p.mat === mat).map((p) => {
    const pos = Float32Array.from(p.pos, (v, i) => v - c[i % 3]);
    return { ...p, pos };
  });
  const g = simplify(list, keep);
  parts.wheel.push({ ...g, color: hex(color) });
  stat['wheel ' + mat] = `${list.reduce((s, p) => s + p.idx.length / 3, 0)} → ${g.idx.length / 3}`;
}
const front = wheelBoxes.filter(({ b }) => b.mid[2] > 0), rear = wheelBoxes.filter(({ b }) => b.mid[2] < 0);
const avg = (l, k) => l.reduce((s, { b }) => s + b.mid[k], 0) / l.length;
const wheels = {
  r: +(ref.b.size[1] / 2).toFixed(3), front: +avg(front, 2).toFixed(3), rear: +avg(rear, 2).toFixed(3),
  track: +(wheelBoxes.reduce((s, { b }) => s + Math.abs(b.mid[0]), 0) / wheelBoxes.length).toFixed(3),
};
const dims = bbox(prims.filter((p) => !p.wheel));
console.table(stat);
console.log('колёса', wheels, '| длина', dims.size[2].toFixed(2), 'ширина', dims.size[0].toFixed(2), 'высота', dims.hi[1].toFixed(2));

// ---------------------------------------------------------------- запись GLB

// Вершины без общих индексов между группами: группа = свой цвет.
function pack(groups) {
  const pos = [], col = [], idx = [];
  for (const g of groups) {
    const used = new Map();
    for (const i of g.idx) {
      let v = used.get(i);
      if (v === undefined) {
        v = pos.length / 3; used.set(i, v);
        pos.push(g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2]); col.push(...g.color);
      }
      idx.push(v);
    }
  }
  return { pos: new Float32Array(pos), col: new Float32Array(col), idx: new Uint32Array(idx) };
}
const chunks = [], views = [], accessors = [], meshes = [], nodes = [];
let offset = 0;
function view(arr, target) {
  const bytes = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
  const pad = (4 - (bytes.length % 4)) % 4;
  chunks.push(bytes, Buffer.alloc(pad));
  views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
  offset += bytes.length + pad;
  return views.length - 1;
}
for (const [name, groups] of Object.entries(parts)) {
  const { pos, col, idx } = pack(groups);
  const lo = [0, 1, 2].map((k) => Math.min(...pos.filter((_, i) => i % 3 === k)));
  const hi = [0, 1, 2].map((k) => Math.max(...pos.filter((_, i) => i % 3 === k)));
  accessors.push({ bufferView: view(pos, 34962), componentType: 5126, count: pos.length / 3, type: 'VEC3', min: lo, max: hi });
  accessors.push({ bufferView: view(col, 34962), componentType: 5126, count: col.length / 3, type: 'VEC3' });
  accessors.push({ bufferView: view(idx, 34963), componentType: 5125, count: idx.length, type: 'SCALAR' });
  const a = accessors.length - 3;
  meshes.push({ name, primitives: [{ attributes: { POSITION: a, COLOR_0: a + 1 }, indices: a + 2 }] });
  nodes.push({ name, mesh: meshes.length - 1 });
  console.log(name.padEnd(7), (idx.length / 3).toString().padStart(6), 'треуг.');
}
const credit = 'This work is based on "Lada Vesta" (https://sketchfab.com/3d-models/lada-vesta-3c333139feb744ae9d36767c0e9cabfd) by tiunov.se (https://sketchfab.com/tiunov.se) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)';
const doc = {
  asset: { version: '2.0', generator: 'tools/vesta/build.mjs', copyright: credit },
  scene: 0, scenes: [{ nodes: nodes.map((_, i) => i), extras: { wheels, length: +dims.size[2].toFixed(3), width: +dims.size[0].toFixed(3) } }],
  nodes, meshes, accessors, bufferViews: views, buffers: [{ byteLength: offset }],
};
let json = Buffer.from(JSON.stringify(doc));
json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const binChunk = Buffer.concat(chunks);
const head = Buffer.alloc(12);
head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + json.length + 8 + binChunk.length, 8);
const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([head, ch(json.length, 0x4e4f534a), json, ch(binChunk.length, 0x004e4942), binChunk]));
console.log('→', out, (12 + 16 + json.length + binChunk.length) / 1024 | 0, 'КБ');

// Общее для сборщиков моделей машин (vesta.mjs, oda.mjs, moskvich.mjs): чтение glTF, упрощение и запись GLB в формате игры.
// Модель — части paint (кузов, под цвет), detail, lights, wheel; у каждой позиции, цвета вершин
// и индексы, нормали считаются в игре (плоские). Координаты: +z вперёд, y вверх от земли.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MeshoptSimplifier } from 'meshoptimizer';

await MeshoptSimplifier.ready;

// Габариты набора примитивов { pos }.
export const bbox = (list) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const { pos } of list) for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], pos[i + k]); hi[k] = Math.max(hi[k], pos[i + k]);
  }
  return { lo, hi, size: hi.map((h, k) => h - lo[k]), mid: hi.map((h, k) => (h + lo[k]) / 2) };
};

// ---------------------------------------------------------------- чтение glTF

const COMP = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function accessor(gltf, bin, i) {
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

// Все примитивы glTF (scene.gltf + один .bin) в мировых координатах: { node, wheel (имя узла-колеса
// /^wheel/ или null), mat (имя материала), pos, idx }.
export function readGltf(src) {
  const gltf = JSON.parse(readFileSync(src, 'utf8'));
  const bin = readFileSync(join(dirname(src), gltf.buffers[0].uri));
  const prims = [];
  (function walk(ids, parent, wheel) {
    for (const id of ids) {
      const n = gltf.nodes[id], m = mul(parent, local(n)), w = wheel || (/^wheel/.test(n.name || '') ? n.name : null);
      if (n.mesh != null) {
        for (const p of gltf.meshes[n.mesh].primitives) {
          const raw = accessor(gltf, bin, p.attributes.POSITION), pos = new Float32Array(raw.length);
          for (let i = 0; i < raw.length; i += 3) pos.set(apply(m, raw[i], raw[i + 1], raw[i + 2]), i);
          const idx = p.indices != null ? accessor(gltf, bin, p.indices) : Uint32Array.from({ length: raw.length / 3 }, (_, i) => i);
          prims.push({ node: n.name, wheel: w, mat: gltf.materials[p.material].name, pos, idx });
        }
      }
      if (n.children) walk(n.children, m, w);
    }
  })(gltf.scenes[0].nodes, I4, null);
  return prims;
}

export const hex = (c) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16) / 255);

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

// Список примитивов { pos, idx } → одна сваренная геометрия, в которой оставлена доля keep треугольников.
// lockBorder — не трогать открытые края: у цветных кусков одной сплошной поверхности (STL) это стыки
// между цветами, без него они расходятся зубцами и щелями.
export function simplify(list, keep, { lockBorder = false } = {}) {
  const { pos, idx } = weld(list);
  if (keep >= 1) return { pos, idx };
  const target = Math.max(12, Math.floor((idx.length / 3) * keep) * 3);
  // Допустимую ошибку поднимаем, пока не дойдём до цели (мелкие детали упираются в порог раньше).
  let res = idx;
  for (const err of [0.01, 0.03, 0.08, 0.2, 0.5]) {
    [res] = MeshoptSimplifier.simplify(idx, pos, 3, target, err, lockBorder ? ['LockBorder'] : []);
    if (res.length <= target * 1.3) break;
  }
  return { pos, idx: res };
}

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

// parts: { имя части: [{ pos, idx, color: [r, g, b] }, …] } → GLB; extras — в extras сцены.
export function writeGlb(out, parts, { copyright, extras }) {
  const chunks = [], views = [], accessors = [], meshes = [], nodes = [];
  let offset = 0;
  const view = (arr, target) => {
    const bytes = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    const pad = (4 - (bytes.length % 4)) % 4;
    chunks.push(bytes, Buffer.alloc(pad));
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    offset += bytes.length + pad;
    return views.length - 1;
  };
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
  const doc = {
    asset: { version: '2.0', generator: 'tools/models', copyright },
    scene: 0, scenes: [{ nodes: nodes.map((_, i) => i), extras }],
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
}

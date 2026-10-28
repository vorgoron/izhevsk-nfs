// Общее для сборщиков моделей машин (vesta.mjs, oda.mjs, moskvich.mjs, pickup.mjs, kabluk.mjs, largus.mjs): чтение glTF, упрощение и запись GLB в формате игры.
// Модель — части paint (кузов, под цвет), detail, lights, wheel; у каждой позиции, цвета вершин
// и индексы, нормали считаются в игре (сглаженные с порогом угла, CREASE в vehicles.js). Координаты: +z вперёд, y вверх от земли.
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
const det3 = (m) => m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
const apply = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];

// Все примитивы glTF (scene.gltf + один .bin или встроенный буфер) в мировых координатах: { node, wheel (имя узла-колеса
// /^wheel/ или null), mat (имя материала), pos, idx }. У зеркальных узлов (отрицательный масштаб — правая фара или двери как
// копия левых) обход треугольников разворачивается, как велит glTF: иначе их грани смотрят внутрь и в игре не видны.
export function readGltf(src) {
  const gltf = JSON.parse(readFileSync(src, 'utf8'));
  const uri = gltf.buffers[0].uri; // файл рядом или встроенный base64 (экспорт Blender «glTF Embedded»)
  const bin = uri.startsWith('data:') ? Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64') : readFileSync(join(dirname(src), uri));
  const prims = [];
  (function walk(ids, parent, wheel) {
    for (const id of ids) {
      const n = gltf.nodes[id], m = mul(parent, local(n)), w = wheel || (/^wheel/.test(n.name || '') ? n.name : null);
      if (n.mesh != null) {
        for (const p of gltf.meshes[n.mesh].primitives) {
          const raw = accessor(gltf, bin, p.attributes.POSITION), pos = new Float32Array(raw.length);
          for (let i = 0; i < raw.length; i += 3) pos.set(apply(m, raw[i], raw[i + 1], raw[i + 2]), i);
          const idx = p.indices != null ? accessor(gltf, bin, p.indices) : Uint32Array.from({ length: raw.length / 3 }, (_, i) => i);
          if (det3(m) < 0) for (let t = 0; t < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]];
          prims.push({ node: n.name, wheel: w, mat: gltf.materials[p.material].name, pos, idx });
        }
      }
      if (n.children) walk(n.children, m, w);
    }
  })(gltf.scenes[0].nodes, I4, null);
  return prims;
}

// Часть name готовой модели игры (GLB от writeGlb) — группами по цвету вершин: [{ pos, idx, color }].
export function readGlbPart(src, name) {
  const b = readFileSync(src), n = b.readUInt32LE(12);
  const gltf = JSON.parse(b.subarray(20, 20 + n).toString()), bin = b.subarray(28 + n);
  const prim = gltf.meshes.find((m) => m.name === name).primitives[0];
  const pos = accessor(gltf, bin, prim.attributes.POSITION), col = accessor(gltf, bin, prim.attributes.COLOR_0);
  const idx = accessor(gltf, bin, prim.indices), groups = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const key = [0, 1, 2].map((k) => col[idx[t] * 3 + k].toFixed(4)).join();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(idx[t], idx[t + 1], idx[t + 2]);
  }
  return [...groups].map(([key, tri]) => ({ pos, idx: Uint32Array.from(tri), color: key.split(',').map(Number) }));
}

// Центр треугольника t (индекс первой вершины в idx) примитива { pos, idx }.
export const center = (p, t) => [0, 1, 2].map((k) => (p.pos[p.idx[t] * 3 + k] + p.pos[p.idx[t + 1] * 3 + k] + p.pos[p.idx[t + 2] * 3 + k]) / 3);
// Часть примитива: треугольники, центр которых проходит фильтр (позиции общие с исходным).
export function pick(p, keep) {
  const idx = [];
  for (let t = 0; t < p.idx.length; t += 3) if (keep(center(p, t))) idx.push(p.idx[t], p.idx[t + 1], p.idx[t + 2]);
  return { pos: p.pos, idx: Uint32Array.from(idx) };
}
// Обрезка плоскостью: оставить часть примитива, где pos[axis] * side >= value * side (side = ±1).
// Треугольники на линии реза разрезаются, а не выбрасываются целиком — у крупных панелей кузова иначе
// на шве остаётся дыра. Вершины в ответе не общие (сварит simplify).
export function clip(p, axis, value, side) {
  const inside = (v) => v[axis] * side >= value * side;
  const out = [];
  const cut = (a, b) => { const t = (value - a[axis]) / (b[axis] - a[axis]); return a.map((v, k) => v + (b[k] - v) * t); };
  for (let t = 0; t < p.idx.length; t += 3) {
    const tri = [0, 1, 2].map((j) => [0, 1, 2].map((k) => p.pos[p.idx[t + j] * 3 + k]));
    const poly = [];
    for (let j = 0; j < 3; j++) {
      const a = tri[j], b = tri[(j + 1) % 3];
      if (inside(a)) poly.push(a);
      if (inside(a) !== inside(b)) poly.push(cut(a, b));
    }
    for (let j = 1; j + 1 < poly.length; j++) out.push(...poly[0], ...poly[j], ...poly[j + 1]);
  }
  return { pos: new Float32Array(out), idx: Uint32Array.from({ length: out.length / 3 }, (_, i) => i) };
}

// Только используемые вершины подряд (для bbox по выбранным треугольникам).
export const used = ({ pos, idx }) => ({ pos: Float32Array.from([...idx].flatMap((i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]])) });

export const hex = (c) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16) / 255);

// Сварить вершины по положению (UV и нормали исходника не нужны — нормали считает игра).
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
// absError — вместо подъёма ошибки (в долях размера куска) — одна попытка с ошибкой не больше absError, м: чего не
// упростить без порчи формы, то остаётся.
export function simplify(list, keep, { lockBorder = false, absError } = {}) {
  const { pos, idx } = weld(list);
  if (keep >= 1) return { pos, idx };
  const target = Math.max(12, Math.floor((idx.length / 3) * keep) * 3);
  // Допустимую ошибку поднимаем, пока не дойдём до цели (мелкие детали упираются в порог раньше).
  let res = idx;
  if (absError) return { pos, idx: MeshoptSimplifier.simplify(idx, pos, 3, target, absError, [...(lockBorder ? ['LockBorder'] : []), 'ErrorAbsolute'])[0] };
  for (const err of [0.01, 0.03, 0.08, 0.2, 0.5]) {
    [res] = MeshoptSimplifier.simplify(idx, pos, 3, target, err, lockBorder ? ['LockBorder'] : []);
    if (res.length <= target * 1.3) break;
  }
  return { pos, idx: res };
}

// Тёмная подложка под кузов: грубая копия (доля keep), утопленная внутрь на inset, м. Кузов готовых моделей собран из
// отдельных панелей с зазорами, а салон выброшен — сквозь зазоры видно насквозь. С подложкой в зазоре тёмный шов, как
// у настоящей машины; где кузов цел, её не видно. «Внутрь» — против нормалей вершин (обход граней — наружу; с гранями
// в обе стороны или внутрь пробовали — зазоров не меньше, треугольников вдвое больше). Берутся
// только грани, смотрящие от оси машины (outward(центр, нормаль)): у капота и крышки багажника есть внутренняя обшивка,
// и «внутрь» от неё — сквозь капот наружу.
export function innerShell(list, keep, inset, outward) {
  const facing = list.map((p) => {
    const idx = [];
    for (let t = 0; t < p.idx.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map((j) => [0, 1, 2].map((k) => p.pos[p.idx[t + j] * 3 + k]));
      const e1 = b.map((v, k) => v - a[k]), e2 = c.map((v, k) => v - a[k]);
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      if (outward(a.map((v, k) => (v + b[k] + c[k]) / 3), n)) idx.push(p.idx[t], p.idx[t + 1], p.idx[t + 2]);
    }
    return { pos: p.pos, idx: Uint32Array.from(idx) };
  });
  const { pos, idx } = simplify(facing, keep);
  const nrm = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]].map((i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
    const e1 = b.map((v, k) => v - a[k]), e2 = c.map((v, k) => v - a[k]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; // с площадью
    for (const i of [idx[t], idx[t + 1], idx[t + 2]]) for (let k = 0; k < 3; k++) nrm[i * 3 + k] += n[k];
  }
  const out = Float32Array.from(pos);
  for (let i = 0; i < pos.length; i += 3) {
    const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
    for (let k = 0; k < 3; k++) out[i + k] -= (nrm[i + k] / l) * inset;
  }
  return { pos: out, idx };
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
// К каждой части — облегчённая «lo-часть» для трафика, парковок и очередей (машин много, вблизи их видно редко; машина
// игрока — полная): каждая цветная группа упрощена до доли lod (число или { часть: доля }, по умолчанию 0,5), края групп
// не трогаем — иначе щели на стыках панелей.
// Ошибка — не больше 8 мм: при 4 см проваливались тонкие панели (капот Ларгуса — два слоя, сваренные по краю, верхний
// ложился на нижний изнанкой наружу; дверь «Оды»).
const LOD_ERROR = 0.008;
// Убрать грани, которых не видно снаружи: из центра грани и точек у её углов пускаем лучи в полусферу перед ней — если ни
// один не уходит наружу, грань не нужна. Как в игре, машина односторонняя: грань, повёрнутая к лучу изнанкой, его не
// задерживает. Колёса (wheel — одно колесо в своих координатах) и детали на выбор в гараже (o-… — в машине стоит один
// вариант из нескольких, все сразу загораживали бы лишнее) не загораживают и не чистятся. Это после упрощения и
// всех правок сборщика — чистка исходника в Blender (blender/clean.py) не видит, что станет с кузовом потом
// (у Ларгуса оставалось 22 % невидимых граней: дверные проёмы, моторный отсек, изнанка капота).
export function cullHidden(parts, rays = 256) {
  const names = Object.keys(parts).filter((n) => n !== 'wheel' && !n.startsWith('o-'));
  const tris = [];
  for (const n of names) for (const g of parts[n]) for (let t = 0; t < g.idx.length; t += 3)
    tris.push([0, 1, 2].map((j) => [g.pos[g.idx[t + j] * 3], g.pos[g.idx[t + j] * 3 + 1], g.pos[g.idx[t + j] * 3 + 2]]));
  const bvh = buildBvh(tris);
  const ga = Math.PI * (3 - Math.sqrt(5)), dirs = [];
  for (let i = 0; i < rays; i++) {
    const y = 1 - (2 * (i + 0.5)) / rays, r = Math.sqrt(1 - y * y);
    dirs.push([Math.cos(ga * i) * r, y, Math.sin(ga * i) * r]);
  }
  // Первый шаг — 1 мм: почти совпадающие слои (у «Оды» из STL панель под задним стеклом — два слоя) иначе загораживают
  // друг друга, и вырезались оба.
  const escapes = (o, d) => {
    for (let k = 0; k < 100; k++) {
      const hit = bvh.cast(o.map((v, i) => v + d[i] * (k ? 2e-4 : 1e-3)), d);
      if (!hit) return true;
      if (hit.facing > 0) return false; // лицом к смотрящему снаружи — загораживает
      o = hit.p; // изнанкой: в игре не рисуется, луч идёт дальше
    }
    return false;
  };
  let removed = 0, k = 0;
  for (const n of names) {
    parts[n] = parts[n].map((g) => {
      const idx = [];
      for (let t = 0; t < g.idx.length; t += 3, k++) {
        const [a, b, c] = tris[k], n3 = triNormal(a, b, c), l = Math.hypot(...n3);
        if (!l) continue;
        const nn = n3.map((v) => v / l), mid = [0, 1, 2].map((i) => (a[i] + b[i] + c[i]) / 3);
        // Точки: центр и сетка по грани с шагом ~4 см (сжатая к центру на 10 %) — у крупной грани закрытыми могут оказаться
        // центр и углы, а видна середина края (у «Оды» вырезалась так грань отделки под задним стеклом — сквозная щель).
        const m = Math.min(8, Math.max(1, Math.ceil(Math.max(...[[a, b], [b, c], [c, a]].map(([p, q]) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]))) / 0.04)));
        const pts = [mid];
        for (let i = 0; i <= m; i++) for (let j = 0; i + j <= m; j++) {
          const u = i / m, v = j / m, w = 1 - u - v;
          pts.push([0, 1, 2].map((q) => mid[q] + (a[q] * u + b[q] * v + c[q] * w - mid[q]) * 0.9));
        }
        if (pts.some((p) => dirs.some((d) => d[0] * nn[0] + d[1] * nn[1] + d[2] * nn[2] > 0.05 && escapes(p, d)))) idx.push(g.idx[t], g.idx[t + 1], g.idx[t + 2]);
        else removed++;
      }
      return { ...g, idx: Uint32Array.from(idx) };
    });
  }
  console.log('невидимых граней убрано:', removed, 'из', tris.length);
  return parts;
}
const triNormal = (a, b, c) => {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
};
// BVH по треугольникам: cast(o, d) — ближайшее попадание { p, facing: знак нормали по лучу }.
function buildBvh(tris) {
  const box = (ids) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const i of ids) for (const v of tris[i]) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); }
    return { lo, hi };
  };
  const cen = tris.map(([a, b, c]) => [0, 1, 2].map((k) => (a[k] + b[k] + c[k]) / 3));
  const build = (ids) => {
    const node = box(ids);
    if (ids.length <= 4) { node.ids = ids; return node; }
    const ext = [0, 1, 2].map((k) => node.hi[k] - node.lo[k]), ax = ext.indexOf(Math.max(...ext));
    ids.sort((i, j) => cen[i][ax] - cen[j][ax]);
    const h = ids.length >> 1;
    node.l = build(ids.slice(0, h)); node.r = build(ids.slice(h));
    return node;
  };
  const root = build(tris.map((_, i) => i));
  const hitBox = (n, o, inv, tmax) => {
    let t0 = 0, t1 = tmax;
    for (let k = 0; k < 3; k++) {
      let a = (n.lo[k] - o[k]) * inv[k], b = (n.hi[k] - o[k]) * inv[k];
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) return false;
    }
    return true;
  };
  const hitTri = ([a, b, c], o, d) => { // Мёллер — Трумбор, без отсечения изнанки
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const h = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
    if (Math.abs(det) < 1e-14) return -1;
    const s = [o[0] - a[0], o[1] - a[1], o[2] - a[2]], u = (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]) / det;
    if (u < 0 || u > 1) return -1;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det;
    if (v < 0 || u + v > 1) return -1;
    return (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
  };
  return {
    cast(o, d) {
      const inv = d.map((v) => 1 / v);
      let best = 20, bi = -1;
      const stack = [root];
      while (stack.length) {
        const n = stack.pop();
        if (!hitBox(n, o, inv, best)) continue;
        if (n.ids) for (const i of n.ids) { const t = hitTri(tris[i], o, d); if (t > 0 && t < best) { best = t; bi = i; } }
        else stack.push(n.l, n.r);
      }
      if (bi < 0) return null;
      const nrm = triNormal(...tris[bi]);
      return { p: o.map((v, k) => v + d[k] * best), facing: nrm[0] * d[0] + nrm[1] * d[1] + nrm[2] * d[2] };
    },
  };
}

// cull — убрать невидимые снаружи грани (cullHidden) до облегчённого набора.
export function writeGlb(out, parts, { copyright, extras, lod = {}, cull = false }) {
  if (typeof lod === 'number') lod = { '': lod };
  if (cull) parts = cullHidden({ ...parts });
  parts = { ...parts, ...Object.fromEntries(Object.entries(parts).map(([name, groups]) =>
    ['lo-' + name, groups.map((g) => g.idx.length <= 12 ? g : { ...simplify([g], lod[name] ?? lod[''] ?? 0.5, { lockBorder: true, absError: LOD_ERROR }), color: g.color })])) };
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
    if (!name.startsWith('lo-o-')) console.log(name.padEnd(10), (idx.length / 3).toString().padStart(6), 'треуг.');
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

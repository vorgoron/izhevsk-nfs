// Геометрия деревьев: кроны из «клочьев» листвы и стволы-трубки с ветками в крону.
// Перенесено из n4spb (github.com/averkij/n4spb, src/world/environment/treegeo.js и leafmat.js,
// © Sergei Averkiev, Apache License 2.0) и упрощено под квадраты города: у породы две детализации —
// near (крона из нескольких клочьев, ветки) и far (2–3 грубых клочка и ствол без веток).
// Крона: клочья — неровные икосферы, нормали смешаны с нормалью общей оболочки кроны (свет мягкий,
// крона читается одним объёмом), вершины, утонувшие в соседнем клочке, выброшены, у стыков — темнее.
// Цвет вершин — только светлота (снизу темнее и холоднее, сверху светлее); зелень даёт цвет экземпляра,
// и только там, где aTint = 1 (листва, хвоя). Ствол — свой цвет коры, aTint = 0.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const mix = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function hash2(ix, iz, seed = 0) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x85ebca6b);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, z, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const h = (a, b, c) => hash2(xi + a + zi * 31 + c * 7, yi + b + c * 13, s + c * 5);
  const L = (a, b, t) => a + (b - a) * t;
  return L(L(L(h(0, 0, 0), h(1, 0, 0), u), L(h(0, 1, 0), h(1, 1, 0), u), v), L(L(h(0, 0, 1), h(1, 0, 1), u), L(h(0, 1, 1), h(1, 1, 1), u), v), w);
}
function billow(x, y, z, s) {
  let a = 0, amp = 0.62, f = 1;
  for (let o = 0; o < 3; o++) { a += amp * (1 - Math.abs(vnoise(x * f, y * f, z * f, s + o * 17) * 2 - 1)); amp *= 0.45; f *= 2.03; }
  return a / 1.05;
}

const _ico = new Map();
function icoBase(detail) {
  let b = _ico.get(detail);
  if (!b) {
    let g = new THREE.IcosahedronGeometry(1, detail); g.deleteAttribute('uv'); g.deleteAttribute('normal'); g = mergeVertices(g, 1e-5);
    b = { pos: g.attributes.position.array, idx: g.index.array }; _ico.set(detail, b);
  }
  return b;
}

// Накопитель вершин: позиция, нормаль, цвет, aTint; треугольник разворачивается по нормалям вершин.
class Acc {
  constructor() { this.p = []; this.n = []; this.c = []; this.t = []; this.i = []; }
  get count() { return this.p.length / 3; }
  vert(x, y, z, nx, ny, nz, r, g, b, tint) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.c.push(r, g, b); this.t.push(tint); return this.p.length / 3 - 1;
  }
  tri(a, b, c) {
    const P = this.p, N = this.n;
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    const d = gx * (N[a * 3] + N[b * 3] + N[c * 3]) + gy * (N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1]) + gz * (N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2]);
    if (d >= 0) this.i.push(a, b, c); else this.i.push(a, c, b);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aTint', new THREE.Float32BufferAttribute(this.t, 1));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// Породы: H — высота, R — радиус кроны (м, при масштабе 1), bark — цвет коры (низ, верх), lump — бугристость
// клочьев, blend — насколько нормаль клочка тянется к оболочке кроны. Лиственная листва — клочья, хвоя ели — ярусы.
const BARK = { dark: ['#4a3c30', '#5c4c3e'], grey: ['#6a6058', '#7a7066'], pine: ['#4b3d31', '#b0663a'] };
export const SPECIES = {
  lime:   { H: 10.0, R: 3.2, bark: 'dark', kind: 'lobes', lump: 0.12, blend: 0.78 },   // липа: плотная округлая крона
  maple:  { H: 9.0, R: 3.0, bark: 'grey', kind: 'lobes', lump: 0.12, blend: 0.75 },    // клён: круглее, светлее
  poplar: { H: 13.0, R: 2.0, bark: 'grey', kind: 'lobes', lump: 0.11, blend: 0.7 },    // тополь: высокий и узкий
  birch:  { H: 10.0, R: 2.3, bark: 'birch', kind: 'lobes', lump: 0.12, blend: 0.82 },  // берёза: рыхлая крона, белые стволы
  pine:   { H: 11.5, R: 2.4, bark: 'pine', kind: 'lobes', lump: 0.14, blend: 0.6 },    // сосна: голый ствол, плоская крона наверху
  spruce: { H: 10.0, R: 2.4, bark: 'dark', kind: 'tiers', tiers: [7, 4], seg: [10, 7] }, // ель
};
// Зелень экземпляра (sRGB), выбирается случайно.
export const LEAF = {
  lime: ['#4f7a2e', '#5a8434', '#467028', '#62893a', '#3f6a2a'],
  maple: ['#5e9a35', '#6aa43c', '#548e2f', '#74a840', '#5a9234'],
  poplar: ['#3f6b2a', '#4a7633', '#365e24'],
  birch: ['#668f3a', '#5e9a35', '#729a42', '#628a38', '#6b9440'],
  pine: ['#3f6a3a', '#46703e', '#3a6034'],
  spruce: ['#3f6b66', '#46746e', '#386058', '#2d5a4a', '#355f50'],
};

// ---------------------------------------------------------------- раскладка клочьев кроны
// k самых крупных клочьев из списка (по высоте), повторяющих силуэт, — для far.
function cluster(L, k) {
  const sorted = L.slice().sort((p, q) => p.c[1] - q.c[1]), out = [], per = Math.ceil(sorted.length / k);
  for (let i = 0; i < sorted.length; i += per) {
    const g = sorted.slice(i, i + per); let cx = 0, cy = 0, cz = 0;
    for (const o of g) { cx += o.c[0]; cy += o.c[1]; cz += o.c[2]; }
    cx /= g.length; cy /= g.length; cz /= g.length;
    let rx = 0, ry = 0;
    for (const o of g) { rx = Math.max(rx, Math.hypot(o.c[0] - cx, o.c[2] - cz) + o.r[0]); ry = Math.max(ry, Math.abs(o.c[1] - cy) + o.r[1]); }
    out.push({ c: [cx, cy, cz], r: [rx * 0.88, ry * 0.9, rx * 0.88], tint: g[0].tint });
  }
  return out;
}
// n клочьев внутри оболочки кроны (случайно, с минимальным зазором); o: rx — радиус клочка, k — высота/ширина,
// sep — зазор, lean — снос кверху, minY — низ кроны не ниже.
function scatter(env, n, rnd, o) {
  const out = [];
  for (let tries = 0; tries < 900 && out.length < n; tries++) {
    const u = rnd() * 2 - 1, a = rnd() * 6.283, rad = Math.cbrt(rnd()), rh = Math.sqrt(1 - u * u) * rad;
    const dx = Math.cos(a) * rh, dz = Math.sin(a) * rh, dy = u * rad;
    const t = (dy + 1) / 2;
    const c = [env.c[0] + dx * env.r[0] + (o.lean ? o.lean[0] * t * t : 0), env.c[1] + dy * env.r[1], env.c[2] + dz * env.r[2] + (o.lean ? o.lean[1] * t * t : 0)];
    const rx = o.rx[0] + rnd() * (o.rx[1] - o.rx[0]), k = o.k[0] + rnd() * (o.k[1] - o.k[0]);
    if (o.minY !== undefined && c[1] - rx * k < o.minY) continue;
    if (out.some((p) => Math.hypot(p.c[0] - c[0], (p.c[1] - c[1]) * 0.7, p.c[2] - c[2]) < (p.r[0] + rx) * o.sep)) continue;
    out.push({ c, r: [rx, rx * k, rx], tint: o.tint() });
  }
  return out;
}
// { env — оболочка кроны, L — клочья near, L1 — клочья far }; детерминированно по породе.
function layout(fam) {
  let s = 0; for (const ch of fam) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const sunny = [1.0, 1.0, 0.88], neutral = [1, 1, 1], cool = [0.92, 1.0, 0.97], lime = [1.02, 1.0, 0.82];
  const T = () => [sunny, neutral, cool, lime][Math.floor(rnd() * 4)];
  const { H, R } = SPECIES[fam];
  const crown = (c, r, n, rx, k, sep, o = {}) => {
    const env = { c, r };
    const L = scatter(env, n, rnd, { rx, k, sep, tint: T, lean: o.lean, minY: o.minY });
    return { env, L, L1: cluster(L, o.l1 ?? 3) };
  };
  if (fam === 'lime') return crown([0, 0.6 * H, 0], [R, 0.38 * H, R], 6, [0.42 * R, 0.66 * R], [0.85, 1.15], 0.4, { minY: 0.25 * H, lean: [0.25, -0.2] });
  if (fam === 'maple') return crown([0, 0.6 * H, 0], [R, 0.4 * H, R], 6, [0.42 * R, 0.64 * R], [0.85, 1.1], 0.4, { minY: 0.24 * H });
  if (fam === 'birch') {
    const k = H / 7.5, env = { c: [0, 4.7 * k, 0], r: [1.9 * k, 2.7 * k, 1.9 * k] };
    const L = scatter(env, 6, rnd, { rx: [0.5 * k, 0.85 * k], k: [1.0, 1.45], sep: 0.6, tint: T, lean: [0.35 * k, 0.2 * k], minY: 2.3 * k });
    return { env, L, L1: cluster(L, 3) };
  }
  if (fam === 'poplar') {
    const kH = H / 11.5, kR = R / 2.0, env = { c: [0, 7.2 * kH, 0], r: [2.0 * kR, 5.2 * kH, 2.0 * kR] };
    const L = [], a0 = rnd() * 6.28, prof = [[3.8, 1.2], [5.9, 1.6], [8.0, 1.7], [10.1, 1.4], [11.6, 0.9]];
    prof.forEach(([y, w], k) => { const a = a0 + k * 2.4; L.push({ c: [Math.cos(a) * 0.35, y * kH, Math.sin(a) * 0.35], r: [w * kR, 1.9 * kH, w * kR], tint: T() }); });
    return { env, L, L1: [1, 3].map((i) => ({ ...L[i], r: [L[i].r[0], 2.6 * kH, L[i].r[2]] })) };
  }
  // pine: плоские клочья вокруг макушки
  const env = { c: [0, 0.86 * H, 0], r: [R, 0.14 * H, R] };
  const L = [{ c: [0.2, 0.9 * H, 0.1], r: [1.7, 0.95, 1.7], tint: neutral }];
  const a0 = rnd() * 6.28;
  for (let q = 0; q < 3; q++) {
    const a = a0 + q * 2.094 + (rnd() - 0.5) * 0.6, d = 1.2 + rnd() * 0.4;
    L.push({ c: [Math.cos(a) * d, (0.8 + 0.06 * (q % 2)) * H, Math.sin(a) * d], r: [1.2, 0.7, 1.2], tint: T() });
  }
  return { env, L, L1: [L[0], { c: [0.2, 0.84 * H, 0.1], r: [2.3, 0.9, 2.3], tint: neutral }] };
}
const _lay = new Map();
const layoutOf = (fam) => { let l = _lay.get(fam); if (!l) _lay.set(fam, (l = layout(fam))); return l; };

// ---------------------------------------------------------------- крона
// Светлота: тёмный холодный низ → светлый тёплый верх; ao — затенение у стыков клочьев.
function tone(t, tint, jitter, ao) {
  const lum = (0.58 + 0.42 * sstep(0.0, 0.8, t) + 0.14 * sstep(0.62, 1.0, t)) * ao;
  const cool = 1 - sstep(0.1, 0.62, t);
  return [lum * tint[0] * jitter * mix(1, 0.86, cool), lum * tint[1] * jitter * mix(1, 0.93, cool), lum * tint[2] * jitter * mix(1, 1.08, cool)];
}
function addLobes(acc, env, lobes, detail, lump, blend, seedBase = 0) {
  const ec = env.c, er = env.r, y0 = ec[1] - er[1], y1 = ec[1] + er[1];
  const base = icoBase(detail), n = base.pos.length / 3;
  const inside = (px, py, pz, o) => { const dx = (px - o.c[0]) / o.r[0], dy = (py - o.c[1]) / o.r[1], dz = (pz - o.c[2]) / o.r[2]; return Math.sqrt(dx * dx + dy * dy + dz * dz); };
  let li = 0;
  for (const Lb of lobes) {
    const first = acc.count, seed = 11 + li * 7 + seedBase; li++;
    const deep = new Uint8Array(n);
    for (let v = 0; v < n; v++) {
      const ux = base.pos[v * 3], uy = base.pos[v * 3 + 1], uz = base.pos[v * 3 + 2];
      let d = 1; if (lump > 0) d += lump * (billow(ux * 2.1 + seed, uy * 2.1, uz * 2.1 - seed, seed) - 0.55);
      let yy = uy; if (yy < -0.45) yy = -0.45 + (yy + 0.45) * 0.55; // низ клочка площе
      const px = Lb.c[0] + ux * Lb.r[0] * d, py = Lb.c[1] + yy * Lb.r[1] * d, pz = Lb.c[2] + uz * Lb.r[2] * d;
      let nlx = ux / Lb.r[0], nly = uy / Lb.r[1], nlz = uz / Lb.r[2]; const nl = Math.hypot(nlx, nly, nlz) || 1; nlx /= nl; nly /= nl; nlz /= nl;
      let nex = (px - ec[0]) / (er[0] * er[0]), ney = (py - ec[1]) / (er[1] * er[1]), nez = (pz - ec[2]) / (er[2] * er[2]); const ne = Math.hypot(nex, ney, nez) || 1; nex /= ne; ney /= ne; nez /= ne;
      let nx = mix(nlx, nex, blend), ny = mix(nly, ney, blend), nz = mix(nlz, nez, blend); const nn = Math.hypot(nx, ny, nz) || 1; nx /= nn; ny /= nn; nz /= nn;
      let ao = 1, buried = false;
      for (const O of lobes) { if (O === Lb) continue; const q = inside(px, py, pz, O); if (q < 0.9) buried = true; else if (q < 1.22) ao = Math.min(ao, mix(0.74, 1, sstep(0.9, 1.22, q))); }
      deep[v] = buried ? 1 : 0;
      const t = (py - y0) / (y1 - y0), jitter = 0.94 + 0.12 * vnoise(px * 0.9 + 3, py * 0.9, pz * 0.9 - 2, seed);
      const c = tone(t, Lb.tint || [1, 1, 1], jitter, ao);
      acc.vert(px, py, pz, nx, ny, nz, c[0], c[1], c[2], 1);
    }
    for (let f = 0; f < base.idx.length; f += 3) {
      const a = base.idx[f], b = base.idx[f + 1], c = base.idx[f + 2];
      if (deep[a] && deep[b] && deep[c]) continue;
      // Обход — как у икосферы (наружу клочка), а не по нормалям: они смешаны с оболочкой кроны, и на стороне
      // клочка, обращённой внутрь кроны, треугольник развернулся бы изнанкой — в редкой кроне видны дыры.
      acc.i.push(first + a, first + b, first + c);
    }
  }
}
// Ель: ярусы-конусы с зубчатым опущенным краем, светлые кончики, тёмная изнанка.
function addTiers(acc, F, lod) {
  const H = F.H, R = F.R, tiers = F.tiers[lod], seg = F.seg[lod];
  const y0 = 0.55, span = H - y0;
  for (let k = 0; k < tiers; k++) {
    const t0 = k / tiers, t1 = (k + 1.55) / tiers;
    const yb = y0 + span * t0 * 0.93, yt = Math.min(H, y0 + span * Math.min(1, t1));
    const rad = R * Math.pow(1 - t0, 0.92) * (0.88 + 0.12 * hash2(k, 1, 77)) + 0.08;
    const slope = rad / Math.max(0.5, yt - yb), ring = [];
    for (let s = 0; s < seg; s++) {
      const a = (s + (k % 2) * 0.5) / seg * 6.283, jag = lod === 0 ? (s % 2 ? 0.78 : 1.0) : 1.0, rr = rad * jag;
      let nx = Math.cos(a), nz = Math.sin(a), ny = slope * 0.55; const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
      const cn = Math.hypot(1, R / H * 1.3), gx = Math.cos(a) / cn, gy = (R / H * 1.3) / cn, gz = Math.sin(a) / cn;
      let mx = mix(nx, gx, 0.45), my = mix(ny, gy, 0.45), mz = mix(nz, gz, 0.45); const ml = Math.hypot(mx, my, mz); mx /= ml; my /= ml; mz /= ml;
      const t = (yb - y0) / span, lum = 0.55 + 0.45 * t, jit = 0.94 + 0.12 * hash2(s, k, 78);
      ring.push(acc.vert(Math.cos(a) * rr, yb - (lod === 0 ? 0.28 * (s % 2) : 0), Math.sin(a) * rr, mx, my, mz, lum * 0.8 * jit, lum * 0.9 * jit, lum * 1.0 * jit, 1));
    }
    const tip = acc.vert(0, yt, 0, 0, 1, 0, 1.05, 1.05, 0.98, 1);
    for (let s = 0; s < seg; s++) acc.tri(ring[s], ring[(s + 1) % seg], tip);
    const under = acc.vert(0, yb + 0.4, 0, 0, -1, 0, 0.42, 0.46, 0.55, 1), rr2 = [];
    for (let s = 0; s < seg; s++) { const p = ring[s]; rr2.push(acc.vert(acc.p[p * 3], acc.p[p * 3 + 1], acc.p[p * 3 + 2], 0, -1, 0, 0.42, 0.46, 0.55, 1)); }
    for (let s = 0; s < seg; s++) acc.tri(rr2[s], rr2[(s + 1) % seg], under);
  }
}

// ---------------------------------------------------------------- ствол
// Трубка по точкам пути { x, y, z, r }; col(доля длины, угол) → [r, g, b].
function addTube(acc, path, seg, col) {
  const rings = []; let len = 0, total = 0;
  for (let i = 1; i < path.length; i++) total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y, path[i].z - path[i - 1].z);
  for (let i = 0; i < path.length; i++) {
    const p = path[i], q = path[Math.min(path.length - 1, i + 1)], o = path[Math.max(0, i - 1)];
    let dx = q.x - o.x, dy = q.y - o.y, dz = q.z - o.z; const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
    const hx = Math.abs(dy) < 0.9 ? 0 : 1, hy = Math.abs(dy) < 0.9 ? 1 : 0;
    let ux = hy * dz, uy = -hx * dz, uz = hx * dy - hy * dx; const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
    const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
    if (i > 0) len += Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y, p.z - path[i - 1].z);
    const ring = [];
    for (let s = 0; s < seg; s++) {
      const a = s / seg * 6.283185, ca = Math.cos(a), sa = Math.sin(a), nx = ux * ca + vx * sa, ny = uy * ca + vy * sa, nz = uz * ca + vz * sa;
      const c = col(len / total, s, i);
      ring.push(acc.vert(p.x + nx * p.r, p.y + ny * p.r, p.z + nz * p.r, nx, ny, nz, c[0], c[1], c[2], 0));
    }
    rings.push(ring);
  }
  for (let i = 0; i + 1 < rings.length; i++) for (let s = 0; s < seg; s++) {
    const a = rings[i][s], b = rings[i][(s + 1) % seg], c = rings[i + 1][(s + 1) % seg], d = rings[i + 1][s];
    acc.tri(a, b, c); acc.tri(a, c, d);
  }
}
const TS = [0, 0.04, 0.2, 0.55, 1];
const stemPath = (x0, z0, lx, lz, h, r0, r1, flare = 0, ts = TS) => ts.map((t) => ({ x: x0 + lx * t * t, y: -0.15 + (h + 0.15) * t, z: z0 + lz * t * t, r: mix(r0, r1, t) * (1 + flare * Math.max(0, 1 - t / 0.07)) }));
const lin = (c) => new THREE.Color(c).toArray();
function barkCol(fam) {
  const F = SPECIES[fam];
  if (F.bark === 'birch') {
    const white = lin('#e6e2d6'), mark = lin('#2d2a26'), base = lin('#3e3024');
    return (t, s, i) => (t < 0.05 ? base : hash2(i, s >> 1, 3) < 0.28 ? mark : white);
  }
  const [lo, hi] = BARK[F.bark].map(lin);
  const cut = F.bark === 'pine' ? 0.45 : 0.12;
  return (t) => (t < cut ? lo : hi);
}

// Ствол: near — ствол и ветки в клочья кроны, far — один ствол.
function addTrunk(acc, fam, lod) {
  const F = SPECIES[fam], lay = F.kind === 'lobes' ? layoutOf(fam) : null, col = barkCol(fam);
  let s = 7919 + fam.charCodeAt(0) * 31 + fam.length; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const seg = lod === 0 ? 6 : 4, H = F.H;
  if (fam === 'lime' || fam === 'maple') {
    const stemH = H * 0.26, r0 = 0.28, a0 = rnd() * 6.28;
    addTube(acc, stemPath(Math.cos(a0) * 0.08, Math.sin(a0) * 0.08, Math.cos(a0) * 0.12, Math.sin(a0) * 0.12, stemH, r0, r0 * 0.5, 0.9), seg, col);
    const lobes = lay.L.filter((o) => o.c[1] > stemH * 0.9).sort((p, q) => p.c[1] - q.c[1]);
    const n = Math.min(lobes.length, lod === 0 ? 3 : 0);
    for (let k = 0; k < n; k++) {
      const Lb = lobes[Math.floor((k + 0.5) * lobes.length / n)], y0 = stemH * (0.78 + 0.2 * rnd()), t = y0 / stemH;
      addTube(acc, [{ x: Math.cos(a0) * 0.12 * t * t, y: y0, z: Math.sin(a0) * 0.12 * t * t, r: r0 * 0.5 }, { x: Lb.c[0] * 0.45, y: (y0 + Lb.c[1]) * 0.5 + 0.25, z: Lb.c[2] * 0.45, r: r0 * 0.3 },
        { x: Lb.c[0] * 0.9, y: Lb.c[1] - Lb.r[1] * 0.55, z: Lb.c[2] * 0.9, r: r0 * 0.14 }], 4, () => col(1));
    }
  } else if (fam === 'birch') {
    const k = H / 7.5, stems = lod === 0 ? 2 : 1, a0 = rnd() * 6.28, ts = [0, 0.04, 0.18, 0.34, 0.52, 0.72, 1];
    for (let q = 0; q < stems; q++) {
      const a = a0 + q * Math.PI, lean = (q === 0 ? 0.2 : 0.5) * k, top = (5.4 + rnd() * 0.6) * k;
      addTube(acc, stemPath(Math.cos(a) * 0.1, Math.sin(a) * 0.1, Math.cos(a) * lean, Math.sin(a) * lean, top, (0.12 - q * 0.03) * k, 0.04 * k, 0.5, ts), 5, col);
    }
  } else if (fam === 'poplar') {
    addTube(acc, stemPath(0, 0, 0.12, 0.05, H * 0.8, 0.3, 0.07, 1.0), seg, col);
  } else if (fam === 'pine') {
    addTube(acc, stemPath(0, 0, 0.25, 0.1, H * 0.9, 0.3, 0.1, 0.6), seg, col);
    if (lod === 0) for (const [x, z] of [[1.4, 0.4], [-1.0, -0.8], [-0.2, 1.3]]) {
      addTube(acc, [{ x: 0.2, y: H * 0.72, z: 0.08, r: 0.09 }, { x, y: H * 0.82, z, r: 0.05 }], 4, () => col(1));
    }
  } else {
    addTube(acc, stemPath(0, 0, 0, 0, 2.2, 0.2, 0.08, 0.6), seg, col); // ель: кусочек ствола под нижним ярусом
  }
}

// Дерево породы целиком: lod 0 — near, 1 — far.
export function treeGeometry(fam, lod) {
  const F = SPECIES[fam], acc = new Acc();
  addTrunk(acc, fam, lod);
  if (F.kind === 'tiers') addTiers(acc, F, lod);
  else {
    const lay = layoutOf(fam), seed = fam.length * 13 + fam.charCodeAt(0);
    if (lod === 0) addLobes(acc, lay.env, lay.L, 1, F.lump, F.blend, seed);
    else addLobes(acc, lay.env, lay.L1, 0, F.lump * 0.5, F.blend + 0.1, seed);
  }
  return acc.geometry();
}

// Блики и тени «гроздей листьев» (ячейки Уорли в мировых координатах, края резкие) — поверх освещения кроны.
export const LEAF_GLSL = /* glsl */`
vec3 fl_h3(vec3 p){ p = vec3(dot(p,vec3(127.1,311.7,74.7)), dot(p,vec3(269.5,183.3,246.1)), dot(p,vec3(113.5,271.9,124.6))); return fract(sin(p)*43758.5453123); }
vec2 fl_worley(vec3 p, out vec3 toF){
  vec3 ip = floor(p), fp = fract(p); float f1 = 8.0, f2 = 8.0; toF = vec3(0.0);
  for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec3 b = vec3(float(i), float(j), float(k)); vec3 r = b + fl_h3(ip + b) * 0.8 + 0.1 - fp; float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; toF = r; } else if (d < f2) f2 = d;
  }
  return vec2(sqrt(f1), sqrt(f2));
}
float fl_tone(vec3 pw, float scale, float amount){
  vec3 q = pw / scale;
  float fw = length(fwidth(q));
  float a = amount * (1.0 - smoothstep(0.3, 0.8, fw));
  if (a < 0.001) return 1.0;
  vec3 wq = q + vec3(sin(q.y * 1.7 + q.z * 1.3), sin(q.z * 1.9 + q.x * 1.1), sin(q.x * 1.5 + q.y * 1.2)) * 0.28;
  vec3 toF; vec2 w = fl_worley(wq, toF);
  vec3 cn = normalize(-toF + vec3(1e-4));
  float lit = dot(cn, normalize(vec3(-0.35, 1.0, 0.25)));
  float aa = clamp(fw * 1.2, 0.03, 0.3), r1 = w.x;
  float hl = smoothstep(0.28 - aa, 0.28 + aa, lit) * smoothstep(0.16 - aa, 0.16 + aa, r1) * (1.0 - smoothstep(0.5 - aa, 0.5 + aa, r1));
  float sh = (1.0 - smoothstep(-0.32 - aa, -0.32 + aa, lit)) * smoothstep(0.3 - aa, 0.3 + aa, r1);
  return mix(1.0, (1.0 + 0.16 * hl) * (1.0 - 0.18 * sh), a);
}`;

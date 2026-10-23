// Достопримечательности: процедурные модели «по мотивам», вписанные в контуры из OSM.
// Пропорции приблизительные — узнаваемый силуэт, а не обмер.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { World } from './world.js';
import { grandLayout } from './walks.js';
import { NIGHT, GlowBuilder, glowMaterial } from './night.js';

const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
// Стекло фонаря: днём чуть светится, ночью — в полную (NIGHT — общий uniform, смена дня и ночи без перекомпиляции).
function nightLit(color, emissive) {
  const m = lambert(color, { emissive });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = NIGHT;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 0.15 + 0.85 * uNight;');
  };
  return m;
}
const M = {
  brick: lambert('#a8452f'),
  white: lambert('#f2eee4'),
  cream: lambert('#ecd9a0'),
  stone: lambert('#b9b3a6'),
  granite: lambert('#5b4a46'),
  roof: lambert('#3e5f4c'),
  green: lambert('#3f8a66'),
  silver: lambert('#9fb0be'),
  concrete: lambert('#e4e1da'),
  dark: lambert('#2b2b2b'),
  blue: new THREE.MeshPhongMaterial({ color: '#3f78b5', specular: '#cfe3ff', shininess: 60 }),
  terra: lambert('#a9564a'),
  rose: lambert('#b98585'),
  pink: lambert('#e3a596'),
  ochre: lambert('#efc98a'),
  domeGreen: lambert('#4f8f73'),
  yellow: lambert('#efe3b0'),
  roofGreen: lambert('#2f8a50'),
  glass: lambert('#33424f'),
  tin: new THREE.MeshPhongMaterial({ color: '#c4cdd4', specular: '#ffffff', shininess: 40 }),
  icon: lambert('#4f6f9c'),
  band: lambert('#4766b0'),
  gold: new THREE.MeshPhongMaterial({ color: '#d2a53a', specular: '#fff1b8', shininess: 90, emissive: '#2a1d00' }),
  bronze: lambert('#6e5536'),
  mint: lambert('#9fd8c0'),
  beige: lambert('#e3cfa6'),
  redBrick: lambert('#b4492f'),
  churchGreen: lambert('#4fd68c'),
  bridgeGlass: new THREE.MeshPhongMaterial({ color: '#9db9b6', specular: '#ffffff', shininess: 70 }),
  teal: lambert('#23867f'),
  steelGreen: lambert('#2b8a63'),
  greenGlass: new THREE.MeshPhongMaterial({ color: '#8fcfa4', specular: '#ffffff', shininess: 70 }),
  blueGlass: new THREE.MeshPhongMaterial({ color: '#4a84c6', specular: '#e4f0ff', shininess: 80 }),
  slab: lambert('#d3d1c9'),
  limestone: lambert('#d9d3c7'),
  salmon: lambert('#e98c78'),
  darkBrick: lambert('#7a2e1e'),
  warmBrick: lambert('#c65d3c'),
  signalRed: lambert('#d23a2a'),
  marble: lambert('#f1e6da'),
  rust: lambert('#a35a3a'),
  peach: lambert('#e9c6b3'),
  slateDark: lambert('#5a5c60'),
  coral: lambert('#e7765c'),
  tuff: lambert('#cc9c95'),
  redGranite: lambert('#8c4a3e'),
  stair: lambert('#a89f95'),
  iron: lambert('#1e2325'),
  lantern: nightLit('#f1e2b0', '#ffd27a'),
  crane: lambert('#f0b400'),
  orange: lambert('#e8742a'),
  fin: lambert('#efe6d2'),
  mirror: new THREE.MeshPhongMaterial({ color: '#2b4a6a', specular: '#d8e8ff', shininess: 90 }),
  beacon: nightLit('#ff3b30', '#ff2a1a'),
};

// Цвета обычных коробок, которые только перекрашиваются: [стены, крыша].
export const RECOLOR = {
  government: ['#ecebe6', '#7d8084'],
};

// ---------------------------------------------------------------- примитивы

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
// Коробка, стоящая на y0.
const box = (w, h, d, mat, x, y0, z) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y0 + h / 2, z);
const cyl = (r, h, mat, x, y0, z, seg = 16, rTop = r) => mesh(new THREE.CylinderGeometry(rTop, r, h, seg), mat, x, y0 + h / 2, z);
const cone = (r, h, mat, x, y0, z, seg = 8) => mesh(new THREE.ConeGeometry(r, h, seg), mat, x, y0 + h / 2, z);

function dome(r, mat, x, y0, z, squash = 1) {
  const m = mesh(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat, x, y0, z);
  m.scale.y = squash;
  return m;
}

const ONION = [[0, 0], [0.62, 0], [0.86, 0.1], [1, 0.28], [0.98, 0.42], [0.82, 0.58], [0.52, 0.74], [0.24, 0.87], [0.1, 0.96], [0.05, 1.08]];
function onion(r, h, x, y0, z, withCross = true, mat = M.gold) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.LatheGeometry(ONION.map(([a, b]) => new THREE.Vector2(a * r, b * h)), 20), mat));
  if (withCross) g.add(cross(h * 0.5, 0, h * 1.05, 0));
  g.position.set(x, y0, z);
  return g;
}

function cross(size, x, y0, z) {
  const g = new THREE.Group();
  const t = Math.max(0.08, size * 0.07);
  g.add(box(t, size, t, M.gold, 0, 0, 0));
  g.add(box(size * 0.5, t, t, M.gold, 0, size * 0.62, 0));
  g.add(box(size * 0.32, t, t, M.gold, 0, size * 0.3, 0));
  g.position.set(x, y0, z);
  return g;
}

function colonnade(n, R, h, r, mat, x, y0, z, from = 0, to = Math.PI * 2) {
  const g = new THREE.Group();
  const full = to - from >= Math.PI * 2 - 1e-6;
  for (let i = 0; i < n; i++) {
    const a = from + ((to - from) * i) / (full ? n : n - 1);
    g.add(cyl(r, h, mat, x + Math.cos(a) * R, y0, z + Math.sin(a) * R, 10));
  }
  return g;
}

// Белые угловые лопатки на кирпичном объёме w×d, высотой h.
function pilasters(w, d, h, x, y0, z) {
  const g = new THREE.Group();
  for (const [dx, dz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) g.add(box(0.9, h, 0.9, M.white, x + dx * w / 2, y0, z + dz * d / 2));
  return g;
}

// Ряд арочных окон (белые обрамления) на гранях x = ±w/2.
function windowBand(n, w, d, y, x0, z0) {
  const g = new THREE.Group();
  for (const side of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const z = z0 - d / 2 + (d * (i + 0.5)) / n;
      g.add(box(0.3, 3.2, 1.3, M.white, x0 + side * (w / 2 + 0.05), y, z));
      g.add(box(0.35, 2.6, 0.8, M.dark, x0 + side * (w / 2 + 0.12), y + 0.3, z));
    }
  }
  return g;
}

// Треугольный фронтон шириной w, высотой h, глубиной d (по z), центр основания в (x, y0, z).
function pediment(w, h, d, x, y0, z) {
  const sh = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)]);
  const geo = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: false }).translate(0, 0, -d / 2);
  return mesh(geo, M.white, x, y0, z);
}

// Ряд колонн портика вдоль оси x (или z), от a до b.
function portico(n, a, b, fixed, along, h, r, y0) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const t = a + ((b - a) * i) / (n - 1);
    const [x, z] = along === 'x' ? [t, fixed] : [fixed, t];
    g.add(cyl(r, h, M.white, x, y0, z, 10));
  }
  return g;
}

// ---------------------------------------------------------------- вписывание в контур

function longestEdgeAngle(p) {
  let best = 0, ang = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, z1] = p[i], [x2, z2] = p[(i + 1) % p.length];
    const l = Math.hypot(x2 - x1, z2 - z1);
    if (l > best) { best = l; ang = Math.atan2(z2 - z1, x2 - x1); }
  }
  return ang;
}

// Прямоугольник контура в повёрнутой на angle системе: центр (мир), длина L по локальной x, ширина W.
function fit(p, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of p) {
    const lx = x * c + z * s, lz = -x * s + z * c;
    x0 = Math.min(x0, lx); x1 = Math.max(x1, lx);
    z0 = Math.min(z0, lz); z1 = Math.max(z1, lz);
  }
  const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
  return { cx: mx * c - mz * s, cz: mx * s + mz * c, L: x1 - x0, W: z1 - z0, angle };
}

function circleFit(p) {
  const cx = p.reduce((a, q) => a + q[0], 0) / p.length;
  const cz = p.reduce((a, q) => a + q[1], 0) / p.length;
  const R = p.reduce((a, q) => a + Math.hypot(q[0] - cx, q[1] - cz), 0) / p.length;
  return { cx, cz, R };
}

function baseY(world, p, x, z) {
  if (!p) return world.terrain(x, z);
  return Math.min(...p.map(([px, pz]) => world.terrain(px, pz)));
}

function place(group, x, y, z, angle = 0) {
  group.position.set(x, y, z);
  group.rotation.y = -angle; // локальная +x смотрит в мир по (cos a, sin a)
  return group;
}

// ---------------------------------------------------------------- модели

// Свято-Михайловский собор (по фото): на гранитном стилобате — восьмигранная галерея-аркада
// с серыми скатами и восемью шпилями по углам; над ней крестообразный объём, концы рукавов —
// щипцы-кокошники. В центре — высокий круглый барабан, корона кокошников с иконами и серебряный
// шатёр с золотыми рёбрами, глава с крестом (~67 м). По осям — четыре шатровые башенки
// (четверик, восьмерик со звоном, шатёр), по диагоналям — четыре золотые главы на барабанах.
// Всё в одной системе: +x — восток, вход с запада; построено под контур радиусом ~21 м.
function mikhailovsky({ L, W }) {
  const g = new THREE.Group();
  const C8 = Math.cos(Math.PI / 8);
  // Восьмигранная призма с гранями по осям: a0, a1 — апофемы низа и верха.
  const oct = (a0, a1, h, mat, y0) => mesh(new THREE.CylinderGeometry(a1 / C8, a0 / C8, h, 8).rotateY(Math.PI / 8), mat, 0, y0 + h / 2, 0);
  // Элемент фасада на радиусе r в направлении a (локальная +x элемента смотрит наружу).
  const out = (obj, a, r, y = 0, x0 = 0, z0 = 0) => {
    obj.position.set(x0 + Math.cos(a) * r, y, z0 + Math.sin(a) * r);
    obj.rotation.y = -a;
    return obj;
  };

  // --- стилобат, лестница с запада
  g.add(oct(21, 21, 4.5, M.granite, -3));
  for (let i = 0; i < 6; i++) g.add(box(0.6 + 0.6 * i, 1.5 - i * 0.6 + 3, 12, M.stone, -21 - 0.3 - 0.3 * i, -3, 0));

  // --- галерея-аркада
  const Ra = 18.5;
  g.add(oct(Ra, Ra, 6.5, M.brick, 1.5));
  g.add(oct(Ra + 0.35, Ra + 0.35, 0.6, M.white, 7.5));
  g.add(oct(Ra + 0.7, Ra - 4.5, 2.6, M.tin, 8.1));
  const face = 2 * Ra * Math.tan(Math.PI / 8);
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4, n = 4, w = face / n;
    for (let i = 0; i < n; i++) {
      const t = -face / 2 + w * (i + 0.5);
      const front = k === 4 && (i === 1 || i === 2);
      if (front && i === 2) continue;
      const ww = front ? w * 2 : w;
      const tt = front ? 0 : t;
      const arch = archOpening(ww - 1.1, front ? 4.6 : 3.6, front);
      arch.position.z = tt;
      const holder = out(new THREE.Group(), a, Ra + 0.02, 2.2);
      holder.add(arch);
      g.add(holder);
    }
    // Белые парные колонки между арками.
    for (let i = 0; i <= n; i++) {
      const t = -face / 2 + w * i;
      if (k === 4 && i === 2) continue;
      const holder = out(new THREE.Group(), a, Ra + 0.25, 1.5);
      for (const dz of [-0.32, 0.32]) holder.add(cyl(0.26, 6, M.white, 0, 0, t + dz, 8));
      g.add(holder);
    }
  }
  // Шпили по углам галереи.
  for (let k = 0; k < 8; k++) {
    const a = Math.PI / 8 + (k * Math.PI) / 4, r = Ra / C8 - 1.6;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    g.add(box(1.5, 1.6, 1.5, M.white, x, 9, z));
    g.add(cone(0.85, 5.5, M.tin, x, 10.6, z, 8));
    g.add(ribs(8, 0.85, 0.05, 10.6, 16.1, x, z, 0.12));
    g.add(onion(0.35, 0.9, x, 15.8, z, false));
  }

  // --- четверик и рукава креста
  const C = 12.5, A = 15, B = 7.5, Ht = 19;
  g.add(box(2 * C, 17.5, 2 * C, M.brick, 0, -1.5, 0));
  g.add(box(2 * C + 0.6, 0.6, 2 * C + 0.6, M.white, 0, 15.6, 0));
  g.add(box(2 * C, 0.6, 2 * C, M.tin, 0, 16.2, 0));
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const arm = out(new THREE.Group(), a, 0);
    arm.add(box(A, Ht - 1.5, 2 * B, M.brick, A / 2, 1.5, 0));
    arm.add(box(A + 0.3, 0.6, 2 * B + 0.6, M.white, A / 2 + 0.15, Ht - 0.6, 0));
    arm.add(gableRoof(A - 0.4, B + 0.4, 4.6, M.tin, 0, Ht));
    // Щипец-кокошник: белая кайма и кирпичное поле.
    arm.add(kokoshnik(2 * B + 0.8, 6.6, 0.5, M.white, A + 0.2, Ht - 0.4, 0));
    arm.add(kokoshnik(2 * B - 1.4, 5.2, 0.5, M.brick, A + 0.35, Ht - 0.4, 0));
    arm.add(archWindow(1.7, 3.2, A + 0.45, Ht + 0.4, 0));
    // Белые лопатки на углах рукава и окна фасада.
    for (const s of [-1, 1]) arm.add(box(0.6, Ht - 9.5, 0.9, M.white, A + 0.1, 9.5, s * (B - 0.3)));
    for (const z of [-4.2, 0, 4.2]) arm.add(archWindow(1.6, z ? 4 : 5, A + 0.05, 11.3, z));
    g.add(arm);
  }
  // Окна и лопатки на гранях четверика за рукавами.
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const side = out(new THREE.Group(), a, 0);
    for (const s of [-1, 1]) {
      side.add(archWindow(1.5, 3.4, C + 0.05, 11, s * 10));
      side.add(box(0.6, 6.6, 0.9, M.white, C + 0.1, 9.5, s * (C - 0.3)));
    }
    g.add(side);
  }

  // --- центральный барабан, корона кокошников, шатёр
  const Rd = 7.4;
  g.add(cyl(Rd, 21, M.brick, 0, 16, 0, 24));
  g.add(cyl(Rd + 0.3, 0.6, M.white, 0, 20.6, 0, 24));
  g.add(cyl(Rd + 0.3, 0.6, M.white, 0, 29.4, 0, 24));
  for (let i = 0; i < 12; i++) {
    const a = ((i + 0.5) * Math.PI * 2) / 12;
    g.add(out(archWindow(1.7, 5.4, 0, 0, 0), a, Rd + 0.02, 22.6));
    g.add(out(box(0.5, 8.8, 0.7, M.white, 0, 0, 0), a + Math.PI / 12, Rd + 0.1, 21.2));
  }
  for (let i = 0; i < 16; i++) g.add(out(kokoshnik(2.6, 2.4, 0.4, M.white, 0, 0, 0), (i * Math.PI * 2) / 16, Rd + 0.05, 30.4));
  g.add(cyl(Rd + 0.5, 0.7, M.white, 0, 35.6, 0, 24));
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI * 2) / 12;
    g.add(out(kokoshnik(3.6, 4.6, 0.5, M.white, 0, 0, 0), a, Rd + 0.45, 36.2));
    g.add(out(kokoshnik(2.2, 3.1, 0.5, M.icon, 0, 0, 0), a, Rd + 0.6, 36.6));
    g.add(out(cone(0.3, 2.2, M.white, 0, 0, 0, 6), a + Math.PI / 12, Rd + 0.4, 36.3));
  }
  const tY = 37.6, tH = 19.5, tr0 = Rd + 0.2, tr1 = 1.1;
  g.add(cyl(tr0, tH, M.tin, 0, tY, 0, 16, tr1));
  g.add(ribs(16, tr0, tr1, tY, tY + tH, 0, 0, 0.22));
  for (const [y, r] of [[tY + 0.1, tr0 + 0.15], [tY + tH * 0.5, (tr0 + tr1) / 2 + 0.1]]) g.add(cyl(r, 0.35, M.gold, 0, y, 0, 16, r - 0.05));
  const top = tY + tH;
  g.add(cyl(1.5, 0.5, M.gold, 0, top - 0.2, 0, 12));
  g.add(cyl(1.0, 2.2, M.tin, 0, top + 0.3, 0, 12));
  g.add(cyl(1.6, 0.7, M.gold, 0, top + 2.5, 0, 12));
  g.add(onion(2.3, 4.6, 0, top + 3.2, 0));

  // --- шатровые башенки по осям
  const Dt = 11.6, sq = 5.4;
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const x = Math.cos(a) * Dt, z = Math.sin(a) * Dt;
    g.add(box(sq, 27, sq, M.brick, x, 1.5, z));
    g.add(pilasters(sq, sq, 27, x, 1.5, z));
    g.add(box(sq + 0.5, 0.6, sq + 0.5, M.white, x, 28.2, z));
    for (let j = 0; j < 4; j++) g.add(out(archWindow(1.3, 2.8, 0, 0, 0), (j * Math.PI) / 2, sq / 2 + 0.02, 24.6, x, z));
    const r8 = sq / 2 * 0.95;
    g.add(cyl(r8, 7.4, M.brick, x, 28.8, z, 8));
    g.add(cyl(r8 + 0.3, 0.5, M.white, x, 36.2, z, 8));
    for (let j = 0; j < 8; j++) {
      const b = (j * Math.PI) / 4 + Math.PI / 8;
      g.add(out(archOpening(1.2, 3, false), b, r8 * Math.cos(Math.PI / 8) + 0.02, 30.6, x, z));
      g.add(out(kokoshnik(1.7, 1.6, 0.3, M.white, 0, 0, 0), b, r8 * Math.cos(Math.PI / 8) + 0.1, 36.6, x, z));
    }
    g.add(cyl(r8 * 0.9, 9.5, M.tin, x, 36.7, z, 8, 0.35));
    g.add(ribs(8, r8 * 0.9, 0.35, 36.7, 46.2, x, z, 0.16));
    g.add(cyl(0.55, 0.9, M.gold, x, 46.1, z, 8));
    g.add(onion(0.9, 2.1, x, 46.9, z));
  }

  // --- золотые главы по диагоналям
  const Dg = 12.6;
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const x = Math.cos(a) * Dg, z = Math.sin(a) * Dg, rd = 3.4;
    g.add(cyl(rd, 11.4, M.brick, x, 16, z, 16));
    g.add(cyl(rd + 0.25, 0.5, M.white, x, 18.4, z, 16));
    g.add(colonnade(8, rd + 0.1, 5.8, 0.2, M.white, x, 18.9, z));
    for (let j = 0; j < 8; j++) g.add(out(archWindow(0.9, 3, 0, 0, 0), (j + 0.5) * Math.PI / 4, rd + 0.02, 20, x, z));
    for (let j = 0; j < 12; j++) g.add(out(kokoshnik(1.7, 1.5, 0.3, M.white, 0, 0, 0), (j * Math.PI) / 6, rd + 0.05, 24.8, x, z));
    g.add(cyl(rd + 0.4, 0.6, M.white, x, 26.6, z, 16));
    g.add(onion(rd * 1.22, 7.4, x, 27.2, z));
  }

  const k = Math.min(L, W) / 2 / 21;
  g.scale.setScalar(k);
  return mergeByMaterial(g);
}

// Арочный проём (тёмный) в белой раме; фасад смотрит в +x, низ проёма на y = 0.
function archOpening(w, h, big) {
  const g = new THREE.Group();
  const r = w / 2;
  g.add(box(0.2, h - r + 0.3, w + 0.5, M.white, -0.05, 0, 0));
  g.add(mesh(new THREE.CylinderGeometry(r + 0.25, r + 0.25, 0.2, 14, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), M.white, -0.05, h - r, 0));
  g.add(box(0.3, h - r, w, M.dark, 0.02, 0, 0));
  g.add(mesh(new THREE.CylinderGeometry(r, r, 0.3, 14, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), M.dark, 0.02, h - r, 0));
  if (big) g.add(kokoshnik(w + 1.6, 2.6, 0.4, M.white, 0.95, h + 0.4, 0));
  return g;
}

// Арочное окно: белый наличник с «гирькой», тёмное стекло. Фасад в +x, низ окна на y.
function archWindow(w, h, x, y, z, seg = 12) {
  const g = new THREE.Group();
  const r = w / 2;
  g.add(box(0.2, h + 0.3, w + 0.6, M.white, 0, -0.3, 0));
  g.add(mesh(new THREE.CylinderGeometry(r + 0.3, r + 0.3, 0.2, seg, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), M.white, 0, h - r, 0));
  g.add(box(0.2, h - r, w, M.glass, 0.08, 0, 0));
  g.add(mesh(new THREE.CylinderGeometry(r, r, 0.2, seg, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), M.glass, 0.08, h - r, 0));
  g.add(box(0.35, 0.35, w + 0.9, M.white, 0.05, -0.55, 0));
  g.position.set(x, y, z);
  return g;
}

// Кокошник (килевидная арка) шириной w, высотой h, толщиной d; фасад в +x, основание на y.
function kokoshnik(w, h, d, mat, x, y, z) {
  const hw = w / 2, s = new THREE.Shape();
  s.moveTo(-hw, 0);
  s.lineTo(-hw, h * 0.3);
  s.bezierCurveTo(-hw, h * 0.78, -hw * 0.15, h * 0.62, 0, h);
  s.bezierCurveTo(hw * 0.15, h * 0.62, hw, h * 0.78, hw, h * 0.3);
  s.lineTo(hw, 0);
  const geo = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: 6 }).translate(0, 0, -d / 2).rotateY(Math.PI / 2);
  return mesh(geo, mat, x, y, z);
}

// Двускатная крыша над рукавом: от x0 на длину len, полуширина b, высота h, конёк вдоль x.
function gableRoof(len, b, h, mat, x0, y0) {
  const s = new THREE.Shape([new THREE.Vector2(-b, 0), new THREE.Vector2(b, 0), new THREE.Vector2(0, h)]);
  const geo = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false }).rotateY(Math.PI / 2);
  return mesh(geo, mat, x0, y0, 0);
}

// Золотые рёбра шатра: n рёбер по рёбрам CylinderGeometry(r1, r0, …, n) от (r0, y0) до (r1, y1).
function ribs(n, r0, r1, y0, y1, x, z, t) {
  const g = new THREE.Group();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const th = (i * Math.PI * 2) / n, sx = Math.sin(th), sz = Math.cos(th);
    const p0 = new THREE.Vector3(sx * (r0 + t * 0.4), y0, sz * (r0 + t * 0.4));
    const p1 = new THREE.Vector3(sx * (r1 + t * 0.4), y1, sz * (r1 + t * 0.4));
    const dir = p1.clone().sub(p0);
    const m = mesh(new THREE.BoxGeometry(t, dir.length(), t), M.gold);
    m.position.copy(p0).add(p1).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(up, dir.normalize());
    g.add(m);
  }
  g.position.set(x, 0, z);
  return g;
}

// Сотни деталей — в несколько мешей, по одному на материал (иначе сотни вызовов отрисовки).
function mergeByMaterial(root) {
  root.updateMatrixWorld(true);
  const byMat = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    let geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
    if (geo.index) geo = geo.toNonIndexed();
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal'].includes(k)) geo.deleteAttribute(k);
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(geo);
  });
  const g = new THREE.Group();
  for (const [mat, geos] of byMat) g.add(mesh(mergeGeometries(geos), mat));
  return g;
}

// Вся модель — по мешу на материал (у резиденции было 540 мешей, у Троицкого 350): на слабом телефоне
// каждый вызов отрисовки стоит дорого. Не трогаем анимированное (userData.update у меша или предка),
// прозрачное (порядок смешивания), инстансы и меши с несколькими материалами.
function flatten(obj) {
  obj.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
  const animated = (o) => { for (; o && o !== obj.parent; o = o.parent) if (o.userData.update) return true; return false; };
  const groups = new Map(), merged = [];
  obj.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || o.material.transparent || animated(o)) return;
    const keep = ['position', 'normal'];
    if (o.material.map) keep.push('uv');
    if (o.material.vertexColors) keep.push('color');
    if (!keep.every((k) => o.geometry.attributes[k])) return;
    const key = [o.material.id, o.castShadow, o.receiveShadow].join();
    if (!groups.has(key)) groups.set(key, { mat: o.material, cast: o.castShadow, receive: o.receiveShadow, keep, geos: [] });
    const mx = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    let geo = o.geometry.clone().applyMatrix4(mx);
    if (geo.index) geo = geo.toNonIndexed();
    for (const k of Object.keys(geo.attributes)) if (!keep.includes(k)) geo.deleteAttribute(k);
    // Зеркальная часть (масштаб −1): three.js переворачивал ей лицевую сторону сам, в общем меше — меняем
    // порядок вершин треугольников, иначе грани отсекутся как задние.
    if (mx.determinant() < 0) {
      for (const attr of Object.values(geo.attributes)) {
        const a = attr.array, n = attr.itemSize;
        for (let t = 0; t < attr.count; t += 3) {
          for (let k = 0; k < n; k++) {
            const i1 = (t + 1) * n + k, i2 = (t + 2) * n + k, v = a[i1];
            a[i1] = a[i2];
            a[i2] = v;
          }
        }
      }
    }
    groups.get(key).geos.push(geo);
    merged.push(o);
  });
  for (const o of merged) o.removeFromParent();
  for (const { mat, cast, receive, geos } of groups.values()) {
    const m = new THREE.Mesh(geos.length > 1 ? mergeGeometries(geos) : geos[0], mat);
    m.castShadow = cast;
    m.receiveShadow = receive;
    obj.add(m);
  }
  // Пустые группы — прочь, чтобы обход сцены каждый кадр был короче.
  const empty = [];
  obj.traverse((o) => { if (o !== obj && !o.isMesh && !o.children.length && !o.userData.update && o.type === 'Group') empty.push(o); });
  for (const o of empty) o.removeFromParent();
  return obj;
}

// ---------------------------------------------------------------- здания по контуру OSM

// Контур в системе fit(): начало в центре, +x вдоль angle.
function toLocal(p, { cx, cz, angle }) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return p.map(([x, z]) => [(x - cx) * c + (z - cz) * s, -(x - cx) * s + (z - cz) * c]);
}

// Призма по контуру от y0 высотой h; grow — выступ во все стороны (тяга, карниз).
function prism(p, y0, h, mat, grow = 0) {
  const sh = new THREE.Shape(p.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geo = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: grow > 0, bevelThickness: 0.01, bevelSize: grow, bevelSegments: 1 });
  geo.rotateX(-Math.PI / 2).translate(0, y0, 0);
  return mesh(geo, mat);
}

// Рёбра контура: начало (x, z), направление (ex, ez), наружная нормаль (ox, oz), длина;
// rot — поворот, при котором +z детали смотрит наружу.
function contourEdges(p, fn) {
  let area = 0;
  for (let i = 0; i < p.length; i++) area += p[i][0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * p[i][1];
  const out = area > 0 ? 1 : -1;
  for (let i = 0; i < p.length; i++) {
    const [x, z] = p[i], [x2, z2] = p[(i + 1) % p.length];
    const len = Math.hypot(x2 - x, z2 - z);
    if (len < 1e-6) continue;
    const ex = (x2 - x) / len, ez = (z2 - z) / len, ox = out * ez, oz = -out * ex;
    fn({ x, z, ex, ez, ox, oz, len, rot: Math.atan2(ox, oz) });
  }
}

// Деталь на ребре: t — метр от начала ребра, d — вынос наружу; +z детали смотрит наружу.
function onEdge(obj, e, t, d = 0) {
  obj.position.x += e.x + e.ex * t + e.ox * d;
  obj.position.z += e.z + e.ez * t + e.oz * d;
  obj.rotation.y = e.rot;
  return obj;
}

// Окна по всем рёбрам контура: rows — [[низ, высота], …]; make(h) — своё окно (+z наружу).
function contourWindows(g, p, rows, { step = 3.6, w = 1.1, frame = M.white, min = 3, skip, make } = {}) {
  contourEdges(p, (e) => {
    if (e.len < min || skip?.(e)) return;
    const n = Math.floor(e.len / step);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) * (e.len / n);
      for (const [y, h] of rows) {
        if (make) { g.add(onEdge(make(h).translateY(y), e, t, 0.02)); continue; }
        if (frame) g.add(onEdge(box(w + 0.4, h + 0.35, 0.12, frame, 0, y - 0.18, 0), e, t, 0.06));
        g.add(onEdge(box(w, h, 0.16, M.glass, 0, y, 0), e, t, 0.08));
      }
    }
  });
}

// Треугольник фронтона (основание 2b, высота h) лицом в +z: от z на depth вперёд.
function tri(b, h, depth, mat, y, z) {
  const s = new THREE.Shape([new THREE.Vector2(-b, 0), new THREE.Vector2(b, 0), new THREE.Vector2(0, h)]);
  return mesh(new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false }), mat, 0, y, z);
}

// Полукруг радиуса r толщиной d лицом в +z (щипец, тимпан арки), центр — середина основания.
const halfDisc = (r, d, mat) => mesh(new THREE.CylinderGeometry(r, r, d, 14, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(-Math.PI / 2), mat);

// Арочное окно лицом в +z (archWindow смотрит в +x).
// seg — сегментов в полукруге: на длинных фасадах с сотней окон хватает 5–6.
const archWindowZ = (w, h, seg) => {
  const o = new THREE.Group();
  o.add(archWindow(w, h, 0, 0, 0, seg).rotateY(-Math.PI / 2));
  return o;
};

// Скатная кровля по контуру любой формы: каждый скат — от ребра на inset внутрь и h вверх,
// сверху плоская площадка по сдвинутому контуру (у узких крыльев скаты почти сходятся в конёк).
const DOUBLE = new Map();
function doubleSided(mat) {
  if (!DOUBLE.has(mat)) DOUBLE.set(mat, Object.assign(mat.clone(), { side: THREE.DoubleSide }));
  return DOUBLE.get(mat);
}
// Контур, сдвинутый на d внутрь (d < 0 — наружу): вершина — на пересечении сдвинутых рёбер
// (у острых углов сдвиг ограничен).
function offsetContour(p, d) {
  let area = 0;
  const n = p.length;
  for (let i = 0; i < n; i++) area += p[i][0] * p[(i + 1) % n][1] - p[(i + 1) % n][0] * p[i][1];
  const s = area > 0 ? 1 : -1;
  const inward = (i) => {
    const [x1, z1] = p[i], [x2, z2] = p[(i + 1) % n], L = Math.hypot(x2 - x1, z2 - z1) || 1;
    return [-s * (z2 - z1) / L, s * (x2 - x1) / L];
  };
  return p.map(([x, z], i) => {
    const a = inward((i - 1 + n) % n), b = inward(i);
    const k = d / Math.max(0.25, 1 + a[0] * b[0] + a[1] * b[1]);
    return [x + (a[0] + b[0]) * k, z + (a[1] + b[1]) * k];
  });
}

// Наименьшее расстояние между встречными стенами контура (рёбра с почти противоположными направлениями) —
// ширина самого узкого крыла или прохода.
function narrowest(p) {
  const n = p.length, segDist = (px, pz, [ax, az], [bx, bz]) => {
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2));
    return Math.hypot(px - ax - t * dx, pz - az - t * dz);
  };
  const dir = (i) => { const a = p[i], b = p[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; };
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const di = dir(i), A = p[i], B = p[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if ((j + 1) % n === i) continue;
      const dj = dir(j);
      if (di[0] * dj[0] + di[1] * dj[1] > -0.3) continue; // не встречные
      const C = p[j], D = p[(j + 1) % n];
      best = Math.min(best, segDist(...A, C, D), segDist(...B, C, D), segDist(...C, A, B), segDist(...D, A, B));
    }
  }
  return best;
}

// Сдвиг ската ограничен узкими крыльями: иначе сдвинутые рёбра перехлёстываются, и крышка ложится
// поперёк двора (так было у Арсенала); высота уменьшается вместе со сдвигом — уклон тот же.
function insetRoof(p, inset0, h0, y0, mat) {
  const inset = Math.min(inset0, 0.45 * narrowest(p)), h = (h0 * inset) / inset0;
  const n = p.length, q = offsetContour(p, inset);
  const pos = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const P1 = [p[i][0], 0, p[i][1]], P2 = [p[j][0], 0, p[j][1]], Q1 = [q[i][0], h, q[i][1]], Q2 = [q[j][0], h, q[j][1]];
    pos.push(...P1, ...P2, ...Q2, ...P1, ...Q2, ...Q1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const cap = new THREE.ShapeGeometry(new THREE.Shape(q.map(([x, z]) => new THREE.Vector2(x, -z)))).rotateX(-Math.PI / 2).translate(0, h, 0);
  cap.deleteAttribute('uv');
  cap.deleteAttribute('normal');
  const all = mergeGeometries([geo, cap.toNonIndexed()]);
  all.computeVertexNormals();
  return mesh(all, doubleSided(mat), 0, y0, 0);
}

// Александро-Невский собор (ампир, С. Е. Дудин): крестообразный объём с портиками,
// ротонда с золотым куполом, ярусная колокольня со шпилем.
function nevsky({ L, W }) {
  const g = new THREE.Group();
  const s = Math.min(W * 0.9, L * 0.45);
  const cx = L * 0.15;
  g.add(box(s, 17, s, M.cream, cx, -3, 0));
  g.add(box(s * 1.45, 15, s * 0.5, M.cream, cx, -3, 0));
  g.add(box(s * 0.5, 15, Math.min(W, s * 1.45), M.cream, cx, -3, 0));
  g.add(box(s + 0.6, 0.8, s + 0.6, M.white, cx, 13.6, 0));
  // Портики с севера и юга.
  for (const side of [-1, 1]) {
    const z = side * (Math.min(W, s * 1.45) / 2 + 2);
    g.add(portico(6, cx - s * 0.22, cx + s * 0.22, z, 'x', 10, 0.45, 0));
    g.add(box(s * 0.55, 1.2, 4.6, M.white, cx, 10, side * (Math.min(W, s * 1.45) / 2 + 1.6)));
    g.add(pediment(s * 0.55, 2.6, 4.6, cx, 11.2, side * (Math.min(W, s * 1.45) / 2 + 1.6)));
  }
  // Ротонда и купол.
  const r = s * 0.3;
  g.add(cyl(r, 9, M.cream, cx, 14, 0, 24));
  g.add(colonnade(16, r + 1, 8, 0.35, M.white, cx, 14, 0));
  g.add(cyl(r + 1.6, 0.8, M.white, cx, 22, 0, 24));
  g.add(dome(r + 0.6, M.gold, cx, 22.6, 0, 0.9));
  g.add(cyl(1.4, 3, M.cream, cx, 22.6 + (r + 0.6) * 0.9 - 0.3, 0, 12));
  g.add(dome(1.6, M.gold, cx, 22.6 + (r + 0.6) * 0.9 + 2.7, 0));
  g.add(cross(3, cx, 22.6 + (r + 0.6) * 0.9 + 4.2, 0));
  // Колокольня: три яруса и шпиль.
  const t = Math.min(10, W * 0.5);
  const tx = -L / 2 + t / 2;
  const refStart = tx + t / 2, refEnd = cx - s * 0.72;
  if (refEnd > refStart) g.add(box(refEnd - refStart, 11, W * 0.55, M.cream, (refStart + refEnd) / 2, -3, 0));
  g.add(box(t, 19, t, M.cream, tx, -3, 0));
  g.add(box(t + 0.6, 0.7, t + 0.6, M.white, tx, 16, 0));
  g.add(box(t * 0.72, 8, t * 0.72, M.cream, tx, 16.7, 0));
  g.add(portico(4, -t * 0.3, t * 0.3, tx - t * 0.4, 'z', 7, 0.25, 16.7));
  g.add(cyl(t * 0.28, 6, M.white, tx, 24.7, 0, 16));
  g.add(dome(t * 0.3, M.gold, tx, 30.7, 0, 0.8));
  g.add(cone(t * 0.08, 14, M.gold, tx, 32.5, 0, 8));
  g.add(cross(2.6, tx, 46, 0));
  return g;
}

// Свято-Троицкий собор (Удмуртская, 222; по фото): ярко-зелёный с белыми лопатками и наличниками.
// Четверик с портиками, большой бирюзовый купол на барабане с золотой главкой, четыре малые
// золотые главы, трапезная и высокая ярусная колокольня с запада — четверик, два восьмерика
// со звоном, зелёный шатёр со слухами, золотая глава. Западный портал — белые колонны.
function troitsky({ L, W }) {
  const g = new THREE.Group();
  const G = M.churchGreen, Wt = M.white;
  const C8 = Math.cos(Math.PI / 8);
  const oct = (a0, a1, h, mat, x, y0) => mesh(new THREE.CylinderGeometry(a1 / C8, a0 / C8, h, 8).rotateY(Math.PI / 8), mat, x, y0 + h / 2, 0);
  const s = Math.min(W * 0.95, L * 0.5);
  const cx = L * 0.14;
  // Четверик: стены, лопатки, арочные окна в два света, карниз и бирюзовая кровля.
  g.add(box(s, 18, s, G, cx, -3, 0));
  g.add(pilasters(s, s, 18, cx, -3, 0));
  for (let k = 0; k < 4; k++) {
    const f = new THREE.Group();
    for (const dz of [-s * 0.28, 0, s * 0.28]) {
      f.add(archWindow(1.4, 3.6, s / 2 + 0.02, 2.2, dz));
      f.add(archWindow(1.1, 2.4, s / 2 + 0.02, 9.2, dz));
    }
    f.rotation.y = (k * Math.PI) / 2;
    f.position.x = cx;
    g.add(f);
  }
  g.add(box(s + 0.8, 0.8, s + 0.8, Wt, cx, 15, 0));
  g.add(hipRoof(s + 0.6, s + 0.6, 2.2, 15.8, M.teal).translateX(cx));
  // Портики с севера и юга.
  for (const side of [-1, 1]) {
    const z = side * (s / 2 + 2);
    g.add(portico(4, cx - s * 0.2, cx + s * 0.2, z, 'x', 9, 0.4, 0));
    g.add(box(s * 0.5, 1, 4.4, Wt, cx, 9, side * (s / 2 + 1.5)));
    g.add(pediment(s * 0.5, 2.4, 4.4, cx, 10, side * (s / 2 + 1.5)));
  }
  // Апсида на востоке.
  g.add(mesh(new THREE.CylinderGeometry(s * 0.3, s * 0.3, 12, 20, 1, false, 0, Math.PI), G, cx + s / 2, 3, 0));
  g.add(dome(s * 0.3 + 0.1, M.teal, cx + s / 2, 9, 0, 0.5));
  // Центральный барабан и большой бирюзовый купол с золотой главкой.
  const dr = s * 0.27;
  g.add(cyl(dr, 7.6, G, cx, 16.4, 0, 20)); // низ — в кровле: у края барабана скат ~16.8 м
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, wnd = archWindow(0.9, 2.4, 0, 0, 0);
    wnd.position.set(cx + Math.cos(a) * (dr + 0.02), 19, Math.sin(a) * (dr + 0.02));
    wnd.rotation.y = -a;
    g.add(wnd);
  }
  g.add(cyl(dr + 0.5, 0.7, Wt, cx, 23.6, 0, 20));
  g.add(dome(dr + 0.3, M.teal, cx, 24.2, 0, 0.95));
  g.add(cyl(0.9, 1.6, Wt, cx, 24 + (dr + 0.3) * 0.95, 0, 10));
  g.add(onion(1.1, 2.4, cx, 25.5 + (dr + 0.3) * 0.95, 0));
  // Малые главы по углам — золотые на зелёных барабанах.
  for (const [dx, dz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const x = cx + dx * s * 0.36, z = dz * s * 0.36;
    g.add(cyl(dr * 0.32, 5.2, G, x, 15.6, z, 12)); // от карниза: скат под главой ~16.1–16.5 м, с 17.4 висели
    g.add(cyl(dr * 0.32 + 0.2, 0.4, Wt, x, 20.6, z, 12));
    g.add(onion(dr * 0.36, dr * 0.8, x, 21, z));
  }
  // Трапезная.
  const t = Math.min(9, W * 0.45);
  const tx = -L / 2 + t / 2;
  const refStart = tx + t / 2, refEnd = cx - s / 2;
  if (refEnd > refStart) {
    const rl = refEnd - refStart, rx = (refStart + refEnd) / 2, rw = W * 0.7;
    g.add(box(rl, 11, rw, G, rx, -3, 0));
    g.add(box(rl + 0.4, 0.6, rw + 0.4, Wt, rx, 7.6, 0));
    g.add(hipRoof(rl + 0.4, rw + 0.4, 2.4, 8.2, M.teal).translateX(rx));
    for (const side of [-1, 1]) {
      for (let i = 0; i < Math.floor(rl / 3.4); i++) {
        const w = archWindow(1.2, 3, 0, 1.8, 0);
        w.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        w.position.set(refStart + 1.7 + i * 3.4, 1.8, side * (rw / 2 + 0.02));
        g.add(w);
      }
    }
  }
  // Колокольня: четверик с порталом, два восьмерика звона, шатёр со слухами, глава.
  g.add(box(t, 15, t, G, tx, -3, 0));
  g.add(pilasters(t, t, 15, tx, -3, 0));
  g.add(portico(4, -t * 0.42, t * 0.42, tx - t / 2 - 1.6, 'z', 7, 0.4, 0));
  g.add(box(2.8, 1, t, Wt, tx - t / 2 - 1.4, 7, 0));
  const ped = pediment(t, 2.2, 2.8, 0, 0, 0);
  ped.rotation.y = Math.PI / 2;
  ped.position.set(tx - t / 2 - 1.4, 8, 0);
  g.add(ped);
  g.add(archWindow(1.1, 1.5, tx - t / 2 - 0.02, 10.4, 0).rotateY(Math.PI));
  g.add(box(t + 0.6, 0.6, t + 0.6, Wt, tx, 12, 0));
  const tiers = [[t * 0.42, 12.6, 6.4], [t * 0.34, 19.6, 5.2]];
  for (const [a, y0, h] of tiers) {
    g.add(oct(a, a, h, G, tx, y0));
    for (let k = 0; k < 8; k++) {
      const ang = (k * Math.PI) / 4, op = archOpening(a * 0.55, h * 0.62, false);
      op.position.set(tx + Math.cos(ang) * (a + 0.02), y0 + h * 0.16, Math.sin(ang) * (a + 0.02));
      op.rotation.y = -ang;
      g.add(op);
    }
    g.add(oct(a + 0.35, a + 0.35, 0.5, Wt, tx, y0 + h));
  }
  const sY = 25.3, sH = 10;
  g.add(oct(t * 0.34, 0.2, sH, M.teal, tx, sY));
  for (let k = 0; k < 4; k++) { // слухи
    const a = (k * Math.PI) / 2, r = t * 0.34 * (1 - 2 / sH);
    const d = new THREE.Group();
    d.add(box(0.8, 1.2, 0.9, Wt, 0, 0, 0));
    d.add(archWindow(0.5, 0.8, 0.42, 0.2, 0));
    d.position.set(tx + Math.cos(a) * r, sY + 1.6, Math.sin(a) * r);
    d.rotation.y = -a;
    g.add(d);
  }
  g.add(onion(0.9, 2, tx, sY + sH - 0.4, 0));
  return g;
}

// Надземный переход УдГУ над Удмуртской (по фото): застеклённая галерея на зелёном стальном каркасе —
// внизу белые панели, над ними лента окон, зелёные стойки через 2,6 м. Локальная x — вдоль галереи с запада,
// галерея шириной gw по оси z = zc. Верхняя галерея (низ настила на D) идёт от запада до лестничной башни в
// (xT, zT), за башней к корпусу — нижняя (низ на 2.6). Опоры: зелёный П-образный портал в xP (столбы выше
// крыши, ригель поверх) и башня — два белых пилона с мятным низом, между ними полоса окон, плоский верх.
// Перед башней (в сторону sT) вдоль фасада — лестница в коробе из профлиста: нижняя площадка с окнами на
// двух пилонах, марш вверх к востоку, верхняя площадка. yP, yT — земля под порталом и башней от нуля модели.
function udsuBridge({ L, zc, gw, D, xP, yP, xT, zT, yT, sT }) {
  const g = new THREE.Group(), S = M.steelGreen;
  const tw = 5.2, tTop = D + 5.5, D2 = 2.6;
  const gallery = (xa, xb, d) => {
    const len = xb - xa, xm = (xa + xb) / 2;
    g.add(box(len, 0.5, gw + 0.3, S, xm, d, zc));
    for (const side of [-1, 1]) {
      const z = zc + side * (gw / 2);
      g.add(box(len, 1, 0.15, M.white, xm, d + 0.5, z));
      g.add(box(len, 1.45, 0.08, M.bridgeGlass, xm, d + 1.5, z));
    }
    for (let x = xa + 0.6; x < xb; x += 2.6) g.add(box(0.2, 2.5, gw + 0.12, S, x, d + 0.5, zc));
    g.add(box(len + 0.2, 0.35, gw + 0.35, S, xm, d + 2.95, zc));
    g.add(box(len, 0.2, gw + 0.1, M.slab, xm, d + 3.2, zc));
  };
  gallery(-L / 2, xT - tw / 2 + 0.2, D);
  if (L / 2 > xT + tw / 2 + 1) gallery(xT + tw / 2 - 0.2, L / 2, D2);
  // Портал: два столба по бокам галереи, ригель над крышей и консоль-«глаголь» сверху.
  const pz = gw / 2 + 0.7, top = D + 4.6;
  for (const side of [-1, 1]) g.add(box(0.55, top - yP + 0.5, 0.55, S, xP, yP - 0.5, zc + side * pz));
  g.add(box(0.6, 0.5, 2 * pz + 0.55, S, xP, top - 0.5, zc));
  g.add(box(1.8, 0.35, 0.4, S, xP + 0.6, top - 0.15, zc - pz));
  // Башня: пилоны по краям, между ними утопленная полоса окон с зелёными переплётами, на пилонах — рыжие плиты.
  const pw = 2;
  for (const side of [-1, 1]) {
    const x = xT + side * (tw / 2 - pw / 2);
    g.add(box(pw, tTop - yT + 0.5, tw, M.white, x, yT - 0.5, zT));
    g.add(box(pw + 0.04, yT + 2.8 - (yT - 0.5), tw + 0.04, M.mint, x, yT - 0.5, zT));
    g.add(box(pw + 0.3, 0.25, tw + 0.3, M.terra, x, tTop, zT));
  }
  g.add(box(tw - 2 * pw + 0.1, tTop - yT + 0.3, tw - 0.6, M.bridgeGlass, xT, yT - 0.5, zT));
  for (let y = yT + 1.2; y < tTop - 0.5; y += 1.6) g.add(box(tw - 2 * pw + 0.12, 0.12, tw - 0.5, S, xT, y, zT));
  g.add(box(0.1, tTop - yT, tw - 0.5, S, xT, yT, zT));
  g.add(box(tw - 2 * pw, 0.2, tw, M.slab, xT, tTop - 0.2, zT));
  // Лестница: профиль «нижняя площадка — марш — верхняя площадка» вдоль x, короб глубиной sd от фасада башни.
  const sd = 3, xa = xT - tw / 2 - 3.4, xb = xT - tw / 2 + 0.4, xc = xT + tw / 2 - 0.6, xd = xT + tw / 2 + 1.8;
  const y1 = yT + 3.7, y2 = yT + 5.9, h1 = 3.8, h2 = 2.6;
  const prof = new THREE.Shape([[xa, y1], [xb, y1], [xc, y2], [xd, y2], [xd, y2 + h2], [xc, y2 + h2], [xb, y1 + h1], [xa, y1 + h1]]
    .map(([x, y]) => new THREE.Vector2(x, y)));
  const z0 = sT > 0 ? zT + tw / 2 : zT - tw / 2 - sd, zf = sT > 0 ? z0 + sd : z0; // zf — наружная грань
  g.add(mesh(new THREE.ExtrudeGeometry(prof, { depth: sd, bevelEnabled: false }), M.tin, 0, 0, z0));
  // Профлист — светлые рёбра по наружной грани; окна нижней площадки.
  const rib = (x, y0, h) => g.add(box(0.06, h, 0.06, M.white, x, y0, zf + sT * 0.03));
  for (let x = xa + 0.3; x < xd - 0.2; x += 0.45) {
    const yb = x < xb ? y1 : x < xc ? y1 + ((x - xb) / (xc - xb)) * (y2 - y1) : y2;
    const yt = x < xb ? y1 + h1 : x < xc ? y1 + h1 + ((x - xb) / (xc - xb)) * (y2 + h2 - y1 - h1) : y2 + h2;
    if (x < xb - 0.2 && x > xa + 0.2) continue; // на площадке — окна
    rib(x, yb + 0.1, yt - yb - 0.2);
  }
  g.add(box(xb - xa - 0.6, 1.9, 0.08, M.bridgeGlass, (xa + xb) / 2, y1 + 0.9, zf + sT * 0.02));
  for (let x = xa + 0.3; x <= xb - 0.3 + 0.01; x += (xb - xa - 0.6) / 5) g.add(box(0.1, 1.9, 0.12, S, x, y1 + 0.9, zf + sT * 0.03));
  // Пилоны под нижней площадкой.
  for (const x of [xa + 0.9, xb - 0.6]) {
    g.add(box(1.3, y1 - yT + 0.5, 2.4, M.white, x, yT - 0.5, z0 + sd / 2));
    g.add(box(1.34, 3.3, 2.44, M.mint, x, yT - 0.5, z0 + sd / 2));
  }
  return g;
}

// Храм Казанской иконы Божией Матери (Карла Маркса, 220; по фото): красный кирпич в «русском стиле».
// Высокий цоколь-терраса с оградой и лестницей с запада; на нём двухэтажный объём — арочные окна
// в белых наличниках, парные окна под кокошником, квадратные ниши, синий пояс, ступенчатый карниз,
// щипцы над западным фасадом, низкая вальмовая крыша. Над входом с запада — колокольня: четверик,
// восьмерик звона, золотой шатёр со слухами и главкой. Над серединой — четверик-постамент,
// барабан с короной кокошников и большая золотая луковица. На востоке — апсида.
// +x — восток; построено под контур 28 × 15 м и растянуто под фактический.
function kazansky({ L, W }) {
  const g = new THREE.Group();
  const C8 = Math.cos(Math.PI / 8);
  const oct = (a0, a1, h, mat, x, y0) => mesh(new THREE.CylinderGeometry(a1 / C8, a0 / C8, h, 8).rotateY(Math.PI / 8), mat, x, y0 + h / 2, 0);
  const out = (obj, a, r, y = 0, x0 = 0, z0 = 0) => {
    obj.position.set(x0 + Math.cos(a) * r, y, z0 + Math.sin(a) * r);
    obj.rotation.y = -a;
    return obj;
  };
  // Квадратная ниша: белая рамка с кирпичным полем; фасад в +x.
  const niche = (s, y, z) => {
    const n = new THREE.Group();
    n.add(box(0.12, s, s, M.white, 0.02, y, z));
    n.add(box(0.14, s - 0.24, s - 0.24, M.brick, 0.05, y + 0.12, z));
    return n;
  };
  // Треугольный щипец шириной w, высотой h; фасад в +x, основание на y.
  const gable = (w, h, d, mat, x, y, z) => {
    const s = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)]);
    return mesh(new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false }).translate(0, 0, -d / 2).rotateY(Math.PI / 2), mat, x, y, z);
  };

  const P = 2.4; // верх цоколя-террасы
  const bx0 = -12.6, bx1 = 9.2, bz = 6.2, H = P + 11.2; // основной объём и его карниз
  const bcx = (bx0 + bx1) / 2, bl = bx1 - bx0;

  // --- цоколь-терраса, ограда, лестница с запада
  g.add(box(28, P + 3 - 0.1, 15, M.brick, 0, -3, 0)); // верх под плитой террасы, иначе мерцает
  g.add(box(28.2, 0.3, 15.2, M.white, 0, P - 0.3, 0));
  for (const [a, r, len] of [[Math.PI, 14, 15], [Math.PI / 2, 7.5, 28], [-Math.PI / 2, 7.5, 28]]) {
    const side = out(new THREE.Group(), a, r);
    for (let i = 0; i < Math.floor(len / 2.4); i++) side.add(box(0.15, 1.4, 1.1, M.dark, 0.05, -0.2, -len / 2 + 1.2 + i * 2.4));
    g.add(side);
  }
  for (const [a, r, len] of [[Math.PI, 13.9, 15], [Math.PI / 2, 7.4, 28], [-Math.PI / 2, 7.4, 28], [0, 13.9, 15]]) {
    const rail = out(new THREE.Group(), a, r, P);
    const gap = a === Math.PI ? 1.9 : 0; // проход к лестнице
    for (const [z0, z1] of gap ? [[-len / 2, -gap], [gap, len / 2]] : [[-len / 2, len / 2]]) {
      rail.add(box(0.07, 0.07, z1 - z0, M.dark, 0, 1.0, (z0 + z1) / 2));
      rail.add(box(0.05, 0.05, z1 - z0, M.dark, 0, 0.15, (z0 + z1) / 2));
      for (let z = z0; z <= z1 + 1e-6; z += 0.45) rail.add(box(0.05, 1.0, 0.05, M.dark, 0, 0.1, z));
    }
    g.add(rail);
  }
  const steps = 6;
  for (let i = 0; i < steps; i++) {
    const len = 0.55 * (steps - i);
    g.add(box(len, 3 + ((i + 1) * P) / steps - 0.02, 3.6, M.stone, -14 - len / 2, -3, 0));
  }
  for (const s of [-1, 1]) g.add(box(0.55 * steps, 3 + P + 0.4, 0.5, M.brick, -14 - (0.55 * steps) / 2, -3, s * 2.05));

  // --- основной объём: пояса и карниз
  g.add(box(bl, H - P, 2 * bz, M.brick, bcx, P, 0));
  g.add(box(bl + 0.2, 0.4, 2 * bz + 0.2, M.white, bcx, P, 0));
  g.add(box(bl + 0.15, 0.4, 2 * bz + 0.15, M.band, bcx, P + 5.3, 0));
  g.add(box(bl + 0.3, 0.45, 2 * bz + 0.3, M.white, bcx, H - 0.9, 0));
  g.add(box(bl + 0.7, 0.5, 2 * bz + 0.7, M.brick, bcx, H - 0.45, 0));
  g.add(box(bl + 0.9, 0.15, 2 * bz + 0.9, M.white, bcx, H + 0.08 - 0.15, 0)); // чуть выше кирпича — без мерцания
  const roof = hipRoof(bl + 0.6, 2 * bz + 0.6, 2.4, H, M.tin);
  roof.position.x = bcx;
  g.add(roof);

  // Фасад с окнами: bays — оси проёмов по фасаду (локальная z), фасад смотрит в +x.
  const facade = (len, bays, portal) => {
    const f = new THREE.Group();
    for (const t of bays) {
      if (portal && t === 0) {
        f.add(archOpening(2.6, 3.5, false).translateY(P + 0.3).translateZ(t));
        f.add(box(0.25, 0.8, 3.8, M.white, 0.1, P + 4.1, t)); // табличка над порталом
      } else {
        f.add(archWindow(1.2, 2.4, 0.02, P + 1.6, t));
      }
      for (const dz of [-0.8, 0.8]) f.add(archWindow(1.0, 2.4, 0.02, P + 6.3, t + dz));
      f.add(kokoshnik(3.6, 1.3, 0.2, M.white, 0.08, P + 8.95, t));
    }
    // Ниши между осями и у краёв.
    const edges = [-len / 2 + 0.9, ...bays.slice(1).map((t, i) => (t + bays[i]) / 2), len / 2 - 0.9]
      .filter((t) => Math.min(...bays.map((b) => Math.abs(t - b))) > 1.95);
    for (const t of edges) for (const y of [P + 1.3, P + 2.6, P + 3.9, P + 6.3, P + 7.6, P + 8.9]) f.add(niche(0.8, y, t));
    return f;
  };
  const xs = [-9.2, -3.6, 1.8, 6.2]; // оси боковых фасадов (по x)
  g.add(out(facade(bl, xs.map((x) => -(x - bcx))), Math.PI / 2, bz, 0, bcx, 0));
  g.add(out(facade(bl, xs.map((x) => x - bcx)), -Math.PI / 2, bz, 0, bcx, 0));
  g.add(out(facade(2 * bz, [-4, 0, 4], true), Math.PI, -bx0));
  // Щипцы над западным фасадом по сторонам колокольни и над западными осями боковых фасадов.
  for (const s of [-1, 1]) {
    g.add(gable(3.2, 2.2, 0.5, M.white, bx0 - 0.1, H, s * 4.6));
    g.add(gable(2.5, 1.6, 0.5, M.brick, bx0 - 0.3, H + 0.15, s * 4.6));
    const sideG = out(new THREE.Group(), (s * Math.PI) / 2, bz + 0.1, 0, -9.2, 0);
    sideG.add(gable(4.4, 2.4, 0.5, M.white, 0, H, 0));
    sideG.add(gable(3.6, 1.8, 0.5, M.brick, 0.2, H + 0.15, 0));
    g.add(sideG);
  }

  // --- апсида на востоке
  const ra = 4.4, ha = 8.6;
  g.add(mesh(new THREE.CylinderGeometry(ra, ra, ha, 20, 1, false, 0, Math.PI), M.brick, bx1, P + ha / 2, 0));
  g.add(mesh(new THREE.CylinderGeometry(ra + 0.2, ra + 0.2, 0.4, 20, 1, false, 0, Math.PI), M.band, bx1, P + 5.5, 0));
  g.add(mesh(new THREE.CylinderGeometry(ra + 0.35, ra + 0.35, 0.5, 20, 1, false, 0, Math.PI), M.white, bx1, P + ha - 0.25, 0));
  g.add(dome(ra + 0.3, M.tin, bx1, P + ha, 0, 0.5));
  for (const a of [-Math.PI / 4, 0, Math.PI / 4]) {
    g.add(out(archWindow(1.1, 2.4, 0, 0, 0), a, ra + 0.02, P + 1.6, bx1));
    g.add(out(archWindow(1.0, 2.2, 0, 0, 0), a, ra + 0.02, P + 6.0, bx1));
  }

  // --- колокольня над входом: четверик, восьмерик звона, шатёр
  const tx = -9.2, ts = 6, T1 = H + 6.2; // окна четверика — выше ската крыши
  g.add(box(ts, T1 - P, ts, M.brick, tx, P, 0));
  for (let k = 0; k < 4; k++) {
    const face = out(new THREE.Group(), (k * Math.PI) / 2, ts / 2, 0, tx, 0);
    for (const dz of [-0.75, 0.75]) face.add(archWindow(0.9, 2.3, 0.02, H + 2.0, dz));
    face.add(kokoshnik(3.0, 1.1, 0.2, M.white, 0.08, H + 4.45, 0));
    for (const s of [-1, 1]) face.add(box(0.2, T1 - H - 0.4, 0.6, M.white, 0.05, H + 0.4, s * (ts / 2 - 0.3)));
    g.add(face);
  }
  g.add(box(ts + 0.4, 0.4, ts + 0.4, M.white, tx, T1 - 0.6, 0));
  g.add(box(ts + 0.8, 0.5, ts + 0.8, M.brick, tx, T1 - 0.2, 0));
  const a8 = 2.6, B0 = T1 + 0.6, B1 = B0 + 5;
  g.add(oct(a8 + 0.3, a8 + 0.3, 0.3, M.white, tx, T1 + 0.3));
  g.add(oct(a8, a8, B1 - B0, M.brick, tx, B0));
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    g.add(out(archOpening(1.3, 3.2, false), a, a8 + 0.02, B0 + 0.8, tx));
    g.add(out(cyl(0.16, B1 - B0, M.white, 0, 0, 0, 6), a + Math.PI / 8, a8 / C8 - 0.05, B0, tx));
    g.add(out(kokoshnik(1.6, 1.0, 0.25, M.white, 0, 0, 0), a, a8 + 0.1, B1 + 0.3, tx));
  }
  g.add(oct(a8 + 0.3, a8 + 0.3, 0.4, M.white, tx, B1 - 0.1));
  const sY = B1 + 0.3, sH = 8.4;
  g.add(oct(a8 + 0.05, 0.25, sH, M.gold, tx, sY));
  for (let k = 0; k < 4; k++) { // слухи
    const a = (k * Math.PI) / 2, y = sY + 1.6, r = (a8 + 0.05) * (1 - 1.6 / sH) + 0.1;
    const d = out(new THREE.Group(), a, r, y, tx);
    d.add(box(0.7, 1.3, 0.9, M.gold, 0, 0, 0));
    d.add(archWindow(0.45, 0.8, 0.36, 0.25, 0));
    d.add(kokoshnik(1.0, 0.7, 0.75, M.gold, 0, 1.3, 0));
    g.add(d);
  }
  g.add(cyl(0.35, 0.8, M.gold, tx, sY + sH - 0.3, 0, 8));
  g.add(onion(0.85, 1.9, tx, sY + sH + 0.4, 0));

  // --- средний четверик, барабан с короной кокошников, большая глава
  const dx = 2.2, ps = 7.4, P1 = H + 3.2, rd = 3.0, D1 = P1 + 4; // постамент выше конька
  g.add(box(ps, P1 - H + 1, ps, M.brick, dx, H - 1, 0));
  g.add(box(ps + 0.4, 0.45, ps + 0.4, M.white, dx, P1 - 0.4, 0));
  for (let k = 0; k < 4; k++) g.add(out(kokoshnik(3.2, 1.4, 0.3, M.white, 0, 0, 0), (k * Math.PI) / 2, ps / 2 - 0.1, P1, dx));
  g.add(cyl(rd, D1 - P1, M.brick, dx, P1, 0, 16));
  g.add(cyl(rd + 0.2, 0.35, M.white, dx, P1 + 0.3, 0, 16));
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) * Math.PI) / 4;
    g.add(out(archWindow(0.9, 2.2, 0, 0, 0), a, rd + 0.02, P1 + 1.1, dx));
    g.add(out(cyl(0.14, D1 - P1 - 0.6, M.white, 0, 0, 0, 6), a + Math.PI / 8, rd + 0.1, P1 + 0.6, dx));
  }
  g.add(cyl(rd + 0.3, 0.4, M.white, dx, D1 - 0.2, 0, 16));
  for (let i = 0; i < 12; i++) g.add(out(kokoshnik(1.5, 1.2, 0.25, M.white, 0, 0, 0), (i * Math.PI) / 6, rd + 0.1, D1 + 0.2, dx));
  g.add(cyl(rd + 0.1, 1.2, M.brick, dx, D1 + 0.2, 0, 16));
  g.add(cyl(rd * 0.85, 0.6, M.white, dx, D1 + 1.4, 0, 16));
  g.add(onion(rd * 1.2, 6, dx, D1 + 1.9, 0));

  const merged = mergeByMaterial(g);
  merged.add(sign('Храм Казанской иконы', 3.4, 0.45, 0, P + 4.27, 0, 1).rotateY(-Math.PI / 2).translateZ(-bx0 + 0.3));
  merged.scale.set(L / 28, (L / 28 + W / 15) / 2, W / 15);
  return merged;
}

// Дом дружбы народов (улица Орджоникидзе): неоклассика — терракотовый нижний этаж, жёлтые верхние с
// белыми лопатками, центральный портик из парных колонн с балюстрадой, надписью и фронтоном,
// угловые колонны на торцах, зелёная вальмовая крыша с полукруглыми слуховыми окнами.
// front = ±1 — сторона фасада (к улице) по локальной оси z.
function ddn({ L, W }, front) {
  const g = new THREE.Group();
  const f = front, H0 = 4.6, H1 = 13.2; // верх нижнего этажа, карниз
  g.add(box(L, H0 + 3, W, M.terra, 0, -3, 0));
  g.add(box(L, H1 - H0, W, M.yellow, 0, H0, 0));
  g.add(box(L + 0.3, 0.45, W + 0.3, M.white, 0, H0 - 0.2, 0)); // тяга между этажами
  g.add(box(L + 0.9, 0.9, W + 0.9, M.white, 0, H1, 0));        // карниз
  // Окна: два верхних этажа и нижний, на все четыре стороны.
  const win = (x, y, z, alongX, h = 2.3) => {
    g.add(alongX ? box(1.6, h + 0.4, 0.2, M.white, x, y - 0.2, z) : box(0.2, h + 0.4, 1.6, M.white, x, y - 0.2, z));
    g.add(alongX ? box(1.2, h, 0.25, M.glass, x, y, z) : box(0.25, h, 1.2, M.glass, x, y, z));
  };
  const P = Math.min(L * 0.38, 26); // ширина портика
  for (const y of [5.6, 9.3, 0.8]) {
    for (let x = -L / 2 + 3; x <= L / 2 - 3; x += 4.2) {
      for (const side of [-1, 1]) win(x, y, side * (W / 2 + 0.05), true, y < H0 ? 2.4 : 2.3);
    }
    for (let z = -W / 2 + 3; z <= W / 2 - 3; z += 4.2) for (const side of [-1, 1]) win(side * (L / 2 + 0.05), y, z, false);
  }
  // Белые лопатки на верхних этажах.
  for (let x = -L / 2; x <= L / 2 + 0.01; x += L / 8) for (const side of [-1, 1]) g.add(box(0.9, H1 - H0, 0.3, M.white, x, H0, side * (W / 2 + 0.1)));
  // Центральный портик: подиум (терракота), балюстрада, парные колонны, антаблемент с надписью, фронтон.
  const zp = f * (W / 2 + 2.4);
  g.add(box(P + 1.2, H0 + 3, 4.8, M.terra, 0, -3, zp));
  g.add(box(P + 1.2, 0.25, 4.9, M.white, 0, H0, zp));
  for (let i = 0; i < 9; i++) g.add(box(0.25, 0.9, 0.25, M.white, -P / 2 + (P * i) / 8, H0 + 0.25, zp + f * 2.2)); // балясины
  g.add(box(P, 0.2, 0.3, M.white, 0, H0 + 1.15, zp + f * 2.2));
  for (const x of [-P / 2, -P / 6, P / 6, P / 2]) for (const dx of [-0.65, 0.65]) g.add(cyl(0.42, H1 - H0, M.white, x + dx, H0, zp + f * 1.6, 12));
  g.add(box(P + 1.4, 1.5, 5.2, M.white, 0, H1, zp));
  g.add(sign('ДОМ ДРУЖБЫ НАРОДОВ', P * 0.8, 1.1, 0, H1 + 0.2, zp + f * 2.65, f));
  g.add(pediment(P + 1.4, 3.6, 5.2, 0, H1 + 1.5, zp));
  // Угловые колонны на торцах (по две на фасаде и на боковой стороне).
  for (const sx of [-1, 1]) {
    for (const d of [1.2, 4]) {
      g.add(cyl(0.38, H1 - H0, M.white, sx * (L / 2 - d), H0, f * (W / 2 + 0.9), 10)); // на фасаде
      g.add(cyl(0.38, H1 - H0, M.white, sx * (L / 2 + 0.9), H0, f * (W / 2 - d), 10)); // на торце
    }
  }
  // Вальмовая крыша: прямоугольник по карнизу, конёк вдоль длины.
  g.add(hipRoof(L + 0.6, W + 0.6, 5, H1 + 0.9, M.roofGreen));
  // Полукруглые слуховые окна на скатах фасада и задней стороны.
  for (const side of [-1, 1]) {
    for (const x of [-L * 0.3, 0, L * 0.3]) {
      if (side === f && Math.abs(x) < P / 2) continue; // за фронтоном не видно
      const d = mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.6, 16, 1, false, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2), M.white, x, H1 + 1.7, side * (W / 2 - 1.6));
      g.add(d);
    }
  }
  return g;
}

function hipRoof(L, W, h, y0, mat) {
  const r = Math.max(0, (L - W) / 2), hw = L / 2, hd = W / 2;
  const v = [[-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd], [-r, h, 0], [r, h, 0]];
  const tris = [[0, 4, 5], [0, 5, 1], [3, 2, 5], [3, 5, 4], [0, 3, 4], [1, 5, 2]];
  const pos = [];
  for (const t of tris) for (const i of t) pos.push(...v[i]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat.clone());
  m.material.side = THREE.DoubleSide;
  m.position.y = y0;
  m.castShadow = true;
  return m;
}

// Надпись золотыми буквами на табличке; смотрит в сторону f по z.
function sign(text, w, h, x, y, z, f, bg = '#f2eee4') {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, 1024, 96);
  g.fillStyle = '#b8892a';
  g.font = 'bold 64px serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 512, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: t }));
  m.position.set(x, y + h / 2, z);
  if (f < 0) m.rotation.y = Math.PI;
  return m;
}

// Резиденция Главы Удмуртской Республики (Лихвинцева, 25): длинный корпус по контуру OSM —
// розовый рустованный цоколь, охристые верхние этажи с белыми лопатками и карнизом; в центре
// фасада — аркада, колонны и фронтон, над ними ротонда с зелёным куполом и шпилем; на обоих
// торцах — портики из четырёх колонн. ux, uz — ось корпуса, nx, nz — наружу к улице.
function residence(p, { ux, uz, nx, nz }) {
  const g = new THREE.Group();
  const H0 = 4.6, H1 = 15;
  const shape = (y0, h, mat, grow = 0) => {
    const sh = new THREE.Shape(p.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geo = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: grow > 0, bevelThickness: 0.01, bevelSize: grow, bevelSegments: 1 });
    geo.rotateX(-Math.PI / 2).translate(0, y0, 0);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = m.receiveShadow = true;
    return m;
  };
  g.add(shape(-3, H0 + 3, M.rose));
  g.add(shape(H0, H1 - H0, M.ochre));
  g.add(shape(H0 - 0.25, 0.4, M.white, 0.2));   // тяга
  g.add(shape(H1, 0.9, M.white, 0.45));          // карниз
  g.add(shape(H1 + 0.9, 1.4, M.domeGreen));      // кровля
  // Окна и лопатки по всем рёбрам контура: наружная нормаль — по обходу.
  let area = 0;
  for (let i = 0; i < p.length; i++) area += p[i][0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * p[i][1];
  const out = area > 0 ? 1 : -1;
  for (let i = 0; i < p.length; i++) {
    const [x1, z1] = p[i], [x2, z2] = p[(i + 1) % p.length];
    const L = Math.hypot(x2 - x1, z2 - z1);
    if (L < 3) continue;
    const ex = (x2 - x1) / L, ez = (z2 - z1) / L, ox = out * ez, oz = -out * ex; // наружу
    const rot = Math.atan2(ox, oz);
    const n = Math.floor(L / 3.6);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) * (L / n), x = x1 + ex * t + ox * 0.08, z = z1 + ez * t + oz * 0.08;
      for (const [y, h] of [[1.2, 2.2], [6, 2.4], [10.2, 2.4]]) {
        const fr = box(1.5, h + 0.35, 0.12, M.white, 0, y - 0.18, 0), gl = box(1.1, h, 0.16, M.glass, 0, y, 0);
        for (const o of [fr, gl]) { o.position.x += x; o.position.z += z; o.rotation.y = rot; g.add(o); }
      }
      if (k % 3 === 0) {
        const pl = box(1, H1 - H0, 0.25, M.white, x - ex * 1.8, H0, z - ez * 1.8);
        pl.rotation.y = rot;
        g.add(pl);
      }
    }
  }
  // Точка на фасаде: от оси корпуса в сторону улицы до контура.
  const xs = p.map(([x, z]) => x * ux + z * uz);
  const t0 = Math.min(...xs), t1 = Math.max(...xs);
  const cx = p.reduce((a, q) => a + q[0], 0) / p.length, cz = p.reduce((a, q) => a + q[1], 0) / p.length;
  const c0 = cx * ux + cz * uz;
  // Точка на контуре: от точки оси t по направлению (dx, dz) до последнего пересечения с контуром.
  const hit = (t, dx0, dz0) => {
    const ax = cx + ux * (t - c0), az = cz + uz * (t - c0);
    let best = 0;
    for (let i = 0; i < p.length; i++) {
      const [x1, z1] = p[i], [x2, z2] = p[(i + 1) % p.length];
      const dx = x2 - x1, dz = z2 - z1, den = dx0 * dz - dz0 * dx;
      if (Math.abs(den) < 1e-9) continue;
      const s = ((x1 - ax) * dz - (z1 - az) * dx) / den, u = ((x1 - ax) * dz0 - (z1 - az) * dx0) / den;
      if (u >= 0 && u <= 1 && s > best) best = s;
    }
    return [ax + dx0 * best, az + dz0 * best];
  };
  const facade = (t) => hit(t, nx, nz);
  const rotF = Math.atan2(nx, nz);
  const local = (grp, [x, z]) => { grp.position.set(x, 0, z); grp.rotation.y = rotF; g.add(grp); };
  // Торцевые портики: на обоих концах корпуса по 4 колонны во всю высоту верхних этажей, фронтон.
  for (const sgn of [-1, 1]) {
    const q = new THREE.Group(), w = 13;
    q.add(box(w + 1, H0 + 3, 3.4, M.white, 0, -3, 1.7));
    for (let i = 0; i < 4; i++) q.add(cyl(0.75, H1 - H0, M.white, -w / 2 + 1.5 + (i * (w - 3)) / 3, H0, 2.6, 14));
    q.add(box(w + 1, 1.4, 3.6, M.white, 0, H1, 1.8));
    q.add(pediment(w + 1, 4, 3.6, 0, H1 + 1.4, 1.8));
    const [x, z] = hit(c0, ux * sgn, uz * sgn);
    q.position.set(x, 0, z);
    q.rotation.y = Math.atan2(ux * sgn, uz * sgn);
    g.add(q);
  }
  // Центр фасада: аркада в цоколе, колонны, фронтон; над ней — ротонда с куполом.
  const tm = (t0 + t1) / 2;
  {
    const q = new THREE.Group(), w = 16;
    q.add(box(w + 1, H0 + 3, 3, M.rose, 0, -3, 1.5));
    for (let i = 0; i < 5; i++) q.add(box(2, 3.2, 0.4, M.dark, -w / 2 + 2 + (i * (w - 4)) / 4, 0, 3.05));
    for (let i = 0; i < 6; i++) q.add(cyl(0.6, H1 - H0, M.white, -w / 2 + 0.5 + (i * (w - 1)) / 5, H0, 2.3, 12));
    q.add(box(w + 1, 1.3, 3.2, M.white, 0, H1, 1.6));
    q.add(pediment(w + 1, 3.8, 3.2, 0, H1 + 1.3, 1.6));
    local(q, facade(tm));
    const [fx, fz] = facade(tm);
    // Ротонда с куполом позади аркады, над корпусом.
    const rx = fx - nx * 9, rz = fz - nz * 9, r = 6;
    g.add(cyl(r, 5, M.ochre, rx, H1 + 1.5, rz, 28));
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const wnd = box(0.8, 1.6, 0.3, M.glass, rx + Math.cos(a) * (r + 0.05), H1 + 2.8, rz + Math.sin(a) * (r + 0.05));
      wnd.rotation.y = -a + Math.PI / 2;
      g.add(wnd);
    }
    g.add(cyl(r + 0.5, 0.6, M.white, rx, H1 + 6.5, rz, 28));
    g.add(dome(r + 0.2, M.domeGreen, rx, H1 + 7.1, rz, 0.6));
    g.add(cyl(0.7, 1.4, M.white, rx, H1 + 7.1 + (r + 0.2) * 0.6 - 0.2, rz, 10));
    g.add(cone(0.18, 5, M.gold, rx, H1 + 8.3 + (r + 0.2) * 0.6, rz, 6));
  }
  return g;
}

// Монумент «Навеки с Россией» (по фото): одна высокая плита из двух лезвий, между ними сквозная
// прорезь. Внизу прорезь открыта (портал между «ногами»), выше — бронзовый рельеф с гербами,
// сверху лезвия срезаны клином к прорези. Широкой стороной — к пруду (на запад) и к аллее.
function friendship({ L, W }, h = 46) {
  const g = new THREE.Group();
  g.add(box(L + 2, 1.4, W + 2, M.granite, 0, -2, 0));
  g.add(box(L * 0.7, 1, W * 0.7, M.stone, 0, -0.6, 0));
  const t = 2.8, bw = 2.5, gap = 2.2, notch = 4; // толщина (по x), ширина лезвия и прорези (по z)
  for (const side of [-1, 1]) {
    // Профиль лезвия в плоскости (z, y): чуть сужается кверху, верх скошен к прорези.
    const zi = gap / 2, zo = gap / 2 + bw, zt = gap / 2 + bw * 0.86;
    let pts = [[zi, 0], [zo, 0], [zt, h], [zi, h - notch]].map(([z, y]) => new THREE.Vector2(-side * z, y));
    if (side < 0) pts = pts.reverse();
    const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: t, bevelEnabled: false })
      .translate(0, 0, -t / 2).rotateY(Math.PI / 2);
    g.add(mesh(geo, M.slab, 0, 0.4, 0));
    // Вертикальные борозды по лицевым граням лезвия.
    for (const x of [-t / 2 - 0.03, t / 2 + 0.03]) g.add(box(0.06, h * 0.9, 0.12, M.stone, x, 0.4 + h * 0.03, side * (zi + bw * 0.55)));
  }
  // Бронзовый рельеф в прорези: от верха портала до клина, по нему — выпуклые гербы и фигуры.
  const y0 = 0.4 + h * 0.17, y1 = 0.4 + h - notch - 0.6;
  g.add(box(t * 0.7, y1 - y0, gap + 0.1, M.bronze, 0, y0, 0));
  for (const x of [-1, 1]) {
    for (let y = y0 + 1.5; y < y1 - 2; y += 3.2) g.add(box(0.5, 1.8, gap * 0.8, M.bronze, x * t * 0.38, y, 0));
    const emblem = mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.3, 20).rotateZ(Math.PI / 2), M.gold, x * (t * 0.35 + 0.25), y1 - 3.2, 0);
    g.add(emblem);
  }
  return g;
}

function rotunda({ R }) {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) g.add(cyl(R + 1.2 - i * 0.6, 0.5, M.stone, 0, -1 + i * 0.5, 0, 32));
  const cr = R - 0.6;
  g.add(colonnade(8, cr, 6.5, 0.35, M.white, 0, 0.5, 0));
  g.add(cyl(cr + 0.5, 1, M.white, 0, 7, 0, 32));
  g.add(dome(cr + 0.4, M.green, 0, 8, 0, 0.7));
  g.add(cone(0.2, 2.5, M.gold, 0, 8 + (cr + 0.4) * 0.7 - 0.2, 0, 8));
  return g;
}

// Центральная мечеть (Карла Маркса; по фото): объём по контуру OSM — бежевый нижний этаж,
// красный кирпич с высокими арочными окнами, белый карниз с мятной полосой, тёмная плоская кровля.
// В центре — золотой купол на кирпичном барабане, по углам — малые золотые купола и четыре
// мятных минарета с золотыми шатрами; у угла к Карла Маркса (запад) — главный высокий минарет.
// pl — контур в системе fit (+x вдоль angle).
function mosque(pl, { L, W, angle }) {
  const g = new THREE.Group();
  const H0 = 4, H1 = 13;
  g.add(prism(pl, -3, H0 + 3, M.beige));
  g.add(prism(pl, H0, H1 - H0, M.redBrick));
  g.add(prism(pl, H0 - 0.15, 0.35, M.white, 0.15));
  g.add(prism(pl, H1 - 0.1, 0.6, M.mint, 0.25));
  g.add(prism(pl, H1 + 0.5, 0.6, M.white, 0.45));
  g.add(prism(pl, H1 + 0.5, 0.75, M.dark));
  contourWindows(g, pl, [[H0 + 1.4, 5.6]], { step: 4.6, make: (h) => archWindowZ(1.5, h) });
  contourWindows(g, pl, [[1.1, 1.8]], { step: 4.6, w: 1.4, frame: null });
  // Купол: восьмигранный кирпичный барабан, мятный пояс, золотой купол с полумесяцем.
  const r = Math.min(L, W) * 0.2, yd = H1 + 1.2;
  g.add(cyl(r, 3.6, M.redBrick, 0, yd, 0, 8));
  g.add(cyl(r + 0.3, 0.5, M.mint, 0, yd + 3.6, 0, 8));
  g.add(dome(r + 0.2, M.gold, 0, yd + 4.1, 0, 1.15));
  g.add(cyl(0.12, 2.4, M.gold, 0, yd + 4.1 + (r + 0.2) * 1.15 - 0.2, 0, 6));
  const crescent = (x, y, z) => {
    const c = mesh(new THREE.TorusGeometry(0.55, 0.1, 6, 16, Math.PI * 1.4), M.gold, x, y, z);
    c.rotation.z = Math.PI * 0.8;
    return c;
  };
  g.add(crescent(0, yd + 4.1 + (r + 0.2) * 1.15 + 2.6, 0));
  // Минарет: мятный ствол с белыми поясами, балкон, верхний ствол, золотой шатёр.
  const minaret = (x, z, y0, h, rr) => {
    const m = new THREE.Group();
    m.add(cyl(rr, h * 0.72, M.mint, 0, 0, 0, 8, rr * 0.85));
    for (let y = h * 0.12; y < h * 0.7; y += h * 0.15) m.add(cyl(rr * 0.95, 0.35, M.white, 0, y, 0, 8));
    m.add(cyl(rr * 1.5, 0.45, M.white, 0, h * 0.72, 0, 12));
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      m.add(box(0.08, 1, 0.08, M.white, Math.cos(a) * rr * 1.4, h * 0.72 + 0.45, Math.sin(a) * rr * 1.4));
    }
    m.add(cyl(rr * 0.75, h * 0.1, M.mint, 0, h * 0.72 + 0.45, 0, 8));
    m.add(cyl(rr * 0.95, 0.35, M.gold, 0, h * 0.82 + 0.45, 0, 8));
    m.add(cone(rr * 0.9, h * 0.17, M.gold, 0, h * 0.82 + 0.8, 0, 8));
    m.add(crescent(0, h + 1.6, 0));
    m.position.set(x, y0, z);
    return m;
  };
  // По углам: вершина контура, ближняя к углу описанного прямоугольника, сдвинутая к центру.
  const corner = (sx, sz, inset) => {
    let q = pl[0];
    for (const v of pl) if (v[0] * sx * W + v[1] * sz * L > q[0] * sx * W + q[1] * sz * L) q = v;
    const d = Math.hypot(q[0], q[1]) || 1;
    return [q[0] - (q[0] / d) * inset, q[1] - (q[1] / d) * inset];
  };
  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const [mx, mz] = corner(sx, sz, 2.2);
    g.add(minaret(mx, mz, H1 + 1.25, 14, 0.75));
    const dx = sx * L * 0.22, dz = sz * W * 0.22;
    g.add(cyl(1.3, 1.4, M.redBrick, dx, H1 + 1.25, dz, 8));
    g.add(dome(1.4, M.gold, dx, H1 + 2.65, dz, 1.2));
  }
  // Главный минарет — у западного угла (к Карла Маркса), с земли, вплотную к стене.
  const c = Math.cos(angle), s = Math.sin(angle);
  let west = pl[0];
  for (const v of pl) if (v[0] * c - v[1] * s < west[0] * c - west[1] * s) west = v;
  const d = Math.hypot(west[0], west[1]) || 1;
  const [wx, wz] = [west[0] + (west[0] / d) * 0.6, west[1] + (west[1] / d) * 0.6];
  g.add(cyl(2.4, 4, M.beige, wx, -3, wz, 8));
  g.add(minaret(wx, wz, 1, 36, 1.4));
  return mergeByMaterial(g);
}

// Государственный цирк Удмуртии (по фото): круглый объём из красного кирпича с белыми полосами,
// над ним — венец голубых стеклянных сводов, сходящихся к центру, со светлыми рёбрами; в центре —
// стеклянный фонарь. Вход — стеклянный тамбур к Красноармейской (юго-запад).
function circus({ R }) {
  const g = new THREE.Group();
  const H = 13;
  g.add(cyl(R, H + 3, M.redBrick, 0, -3, 0, 40));
  for (const y of [2.6, 5.4, 8.2, 11]) g.add(cyl(R + 0.06, 0.55, M.white, 0, y, 0, 40));
  g.add(cyl(R + 0.5, 0.8, M.white, 0, H, 0, 40));
  // Своды: полуцилиндры вдоль радиусов, внутренний конец выше.
  const N = 14, len = R * 0.72, rv = R * Math.sin(Math.PI / N) * 0.98, tilt = 0.22;
  const vaultGeo = new THREE.CylinderGeometry(rv, rv, len, 14, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2).rotateY(Math.PI / 2);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const arm = new THREE.Group();
    arm.rotation.y = -a;
    const v = mesh(vaultGeo, M.blueGlass, R - len / 2 - 0.4, H + 0.8 + Math.sin(tilt) * len / 2, 0);
    v.rotation.z = -tilt;
    arm.add(v);
    // Торец свода: белая арка по краю.
    const rim = mesh(new THREE.TorusGeometry(rv, 0.22, 4, 14, Math.PI).rotateY(Math.PI / 2), M.white, R - 0.4, H + 0.8, 0);
    arm.add(rim);
    // Ребро в ендове между сводами.
    const rib = box(len, 0.4, 0.5, M.white, 0, 0, 0);
    rib.position.set(R - len / 2 - 0.4, H + 0.9 + Math.sin(tilt) * len / 2, 0);
    rib.rotation.z = -tilt;
    const ribArm = new THREE.Group();
    ribArm.rotation.y = -a - Math.PI / N;
    ribArm.add(rib);
    g.add(arm, ribArm);
  }
  // Центральный фонарь.
  const rc = R - len - 0.2, yc = H + 0.8 + Math.sin(tilt) * len;
  g.add(cyl(rc + 0.6, yc - H + 0.6, M.white, 0, H, 0, 24));
  g.add(dome(rc + 0.3, M.blueGlass, 0, yc + 0.6, 0, 0.55));
  g.add(cyl(0.12, 4, M.dark, 0, yc + 0.6 + (rc + 0.3) * 0.55, 0, 6));
  // Входной тамбур к юго-западу.
  const ent = new THREE.Group();
  ent.rotation.y = -(3 * Math.PI) / 4;
  ent.add(box(5, 6, 12, M.blueGlass, R + 1.5, -3 + 3, 0));
  ent.add(box(5.6, 0.6, 12.6, M.white, R + 1.5, 6, 0));
  g.add(ent);
  return mergeByMaterial(g);
}

// Часть контура с z < zc (отсечение многоугольника полуплоскостью).
function clipZ(p, zc) {
  const out = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    if (a[1] < zc) out.push(a);
    if ((a[1] < zc) !== (b[1] < zc)) {
      const t = (zc - a[1]) / (b[1] - a[1]);
      out.push([a[0] + (b[0] - a[0]) * t, zc]);
    }
  }
  return out;
}

// Тёмная скульптура на пилоне: постамент, фигура, голова, поднятая рука.
function statue(s = 1) {
  const g = new THREE.Group();
  g.add(box(0.9, 0.4, 0.9, M.dark, 0, 0, 0));
  g.add(cyl(0.3, 1.5, M.dark, 0, 0.4, 0, 8, 0.22));
  g.add(mesh(new THREE.SphereGeometry(0.2, 8, 6), M.dark, 0, 2.1, 0));
  const arm = box(0.12, 0.9, 0.12, M.dark, 0, 0, 0);
  arm.position.set(0.3, 2.1, 0);
  arm.rotation.z = -0.5;
  g.add(arm);
  g.scale.setScalar(s);
  return g;
}

// Театр оперы и балета (по фото): белый модернизм 1970-х. Низкий стилобат по всему контуру
// (у фасада — терраса буквой П), на нём главный объём; фасад — ряд высоких пилонов-лопаток
// со стеклом между ними, на пилонах — тёмные скульптуры; над залом — глухая сценическая коробка.
// pl — контур в системе fit, фасад — к +z (в городе он смотрит на север, см. buildLandmarks).
function opera(pl) {
  const g = new THREE.Group();
  const H0 = 1.2, H = 15;
  const zs = pl.map((q) => q[1]), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const main = clipZ(pl, z0 + (z1 - z0) * 0.7);
  g.add(prism(pl, -3, H0 + 3, M.concrete));
  g.add(prism(pl, H0 - 0.1, 0.4, M.white, 0.2));
  g.add(prism(main, H0, H - H0, M.white));
  g.add(prism(main, H, 0.9, M.white, 0.35));
  g.add(prism(main, H + 0.9, 0.3, M.dark));
  // Сценическая коробка — над задней частью главного объёма.
  const xs = main.map((q) => q[0]), mx0 = Math.min(...xs), mx1 = Math.max(...xs);
  const mz0 = Math.min(...main.map((q) => q[1])), mz1 = Math.max(...main.map((q) => q[1]));
  g.add(box((mx1 - mx0) * 0.42, 28, (mz1 - mz0) * 0.36, M.concrete, (mx0 + mx1) / 2, H0, mz0 + (mz1 - mz0) * 0.38));
  // Фасад: пилоны, стекло между ними, скульптуры на каждом втором пилоне.
  const south = (e) => e.oz > 0.6 && e.len > 5;
  contourEdges(main, (e) => {
    if (!south(e)) return;
    g.add(onEdge(box(e.len - 0.4, H - H0 - 1.6, 0.2, M.glass, 0, H0 + 0.4, 0), e, e.len / 2, 0.1));
    const n = Math.max(2, Math.round(e.len / 3.4));
    for (let k = 0; k <= n; k++) {
      const t = (k * e.len) / n;
      g.add(onEdge(box(0.9, H - H0 + 3.2, 2.6, M.white, 0, H0, 0), e, t, 1.3));
      if (k % 2 === 0) g.add(onEdge(statue(1.8), e, t, 1.3).translateY(H + 3.2));
    }
  });
  // Остальные стены — узкие вертикальные окна.
  contourWindows(g, main, [[H0 + 1.5, H - H0 - 4]], { step: 7, w: 1.4, frame: null, skip: south, min: 6 });
  return mergeByMaterial(g);
}

// Арсенал — Национальный музей Удмуртии (по фото): ампир, корпус буквой П по контуру OSM —
// белый рустованный первый этаж, жёлтый второй, белые тяги и карниз, зелёная скатная кровля;
// в середине самого длинного северного фасада — белый портик из четырёх колонн с фронтоном.
function arsenal(pl) {
  const g = new THREE.Group();
  const H0 = 4.6, H1 = 10;
  g.add(prism(pl, -3, H0 + 3, M.white));
  g.add(prism(pl, H0, H1 - H0, M.cream));
  g.add(prism(pl, H0 - 0.25, 0.45, M.white, 0.15));
  g.add(prism(pl, H1, 0.8, M.white, 0.4));
  g.add(insetRoof(pl, 4, 2.4, H1 + 0.8, M.roofGreen));
  for (const y of [1.5, 3]) g.add(prism(pl, y, 0.12, M.stone, 0.04)); // руст
  contourWindows(g, pl, [[1.1, 2.3]], { step: 3.6, frame: null, min: 2.5 });
  contourWindows(g, pl, [[H0 + 1.1, 2.7]], { step: 3.6, min: 2.5 });
  let front = null;
  contourEdges(pl, (e) => { if (e.oz < -0.7 && (!front || e.len > front.len)) front = e; });
  if (front) {
    const q = new THREE.Group(), w = 14;
    q.add(box(w + 1, 1.2, 3.6, M.white, 0, -0.4, 1.8));
    for (let i = 0; i < 4; i++) q.add(cyl(0.6, H1 - 0.8, M.white, -w / 2 + 1.2 + (i * (w - 2.4)) / 3, 0.8, 2.8, 14));
    q.add(box(w + 1, 1.3, 3.8, M.white, 0, H1, 1.9));
    q.add(pediment(w + 1, 3.4, 3.8, 0, H1 + 1.3, 1.9));
    g.add(onEdge(q, front, front.len / 2));
  }
  return mergeByMaterial(g);
}

// Русский драматический театр (Ленина; по фото): неоклассика 1950-х, охристые стены. Главный
// фасад к улице Ленина — восемь колонн большого ордера во всю высоту, между ними высокие окна,
// антаблемент с надписью, аттик с белыми медальонами; по бокам — лопатки и окна в два ряда;
// над северной частью — сценическая коробка. pl — контур в системе fit(p, 0), +z — юг.
function drama(pl) {
  const g = new THREE.Group();
  const H = 15, A = 2.2; // карниз и высота аттика
  g.add(prism(pl, -3, 3.8, M.stone));
  g.add(prism(pl, 0.8, H - 0.8, M.ochre));
  g.add(prism(pl, H, 0.9, M.cream, 0.45));
  g.add(prism(pl, H + 0.9, A, M.ochre));
  g.add(prism(pl, H + 0.9 + A, 0.4, M.cream, 0.2));
  let front = null;
  contourEdges(pl, (e) => { if (e.oz > 0.7 && (!front || e.len > front.len)) front = e; });
  const isFront = (e) => e === front;
  contourWindows(g, pl, [[2, 3.2], [8.2, 3.2]], { step: 4.4, w: 1.6, skip: isFront });
  contourEdges(pl, (e) => {
    if (isFront(e) || e.len < 6) return;
    const n = Math.floor(e.len / 4.4);
    for (let k = 0; k <= n; k++) g.add(onEdge(box(0.9, H - 0.8, 0.3, M.cream, 0, 0.8, 0), e, (k * e.len) / n, 0.1));
  });
  // Сценическая коробка.
  const zs = pl.map((q) => q[1]), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const xs = pl.map((q) => q[0]), xm = (Math.min(...xs) + Math.max(...xs)) / 2;
  g.add(box((Math.max(...xs) - Math.min(...xs)) * 0.5, 9, (z1 - z0) * 0.28, M.ochre, xm, H, z0 + (z1 - z0) * 0.3));
  if (front) {
    const q = new THREE.Group(), w = Math.min(front.len - 2, 34), n = 8;
    q.add(box(w + 1, 0.8, 4.4, M.stone, 0, -0.1, 1.8));
    q.add(box(w, H - 1.6, 0.2, M.glass, 0, 1.6, 0.1));
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + 0.8 + (i * (w - 1.6)) / (n - 1);
      q.add(cyl(0.75, H - 1.3, M.cream, x, 0.7, 3, 14));
      q.add(box(1.8, 0.5, 1.8, M.cream, x, H - 0.6, 3));
    }
    for (let i = 0; i < n - 1; i++) { // проёмы между колоннами: рамы-импосты
      const x = -w / 2 + 0.8 + ((i + 0.5) * (w - 1.6)) / (n - 1);
      q.add(box(0.2, H - 1.6, 0.3, M.cream, x, 1.6, 0.2));
      for (const y of [4.6, 9.2]) q.add(box((w - 1.6) / (n - 1) - 0.4, 0.25, 0.3, M.cream, x, y, 0.2));
    }
    q.add(box(w + 1.2, 1.6, 4.2, M.cream, 0, H - 0.1, 2.1));
    q.add(box(w * 0.5, A + 1.2, 0.6, M.ochre, 0, H + 0.9, 0.3)); // повышенный аттик в центре
    for (let i = 0; i < 6; i++) q.add(mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.2, 16).rotateX(Math.PI / 2), M.white, -w / 2 + 2 + (i * (w - 4)) / 5, H + 2.1, 0.7));
    g.add(onEdge(q, front, front.len / 2));
  }
  const merged = mergeByMaterial(g);
  if (front) merged.add(onEdge(sign('РУССКИЙ ДРАМАТИЧЕСКИЙ ТЕАТР', 14, 0.9, 0, H + 0.25, 0, 1), front, front.len / 2, 4.25));
  return merged;
}

// Национальный театр Удмуртии (Горького, 73; по фото): светлый пятиэтажный корпус по контуру,
// на фасаде к улице — розовая середина с белыми лопатками, фронтоном с круглым окном и красной
// кровлей, по бокам две белые башни с вертикальными витражами (северная — шире и выше,
// с мачтой связи над корпусом), перед серединой — серый козырёк с закруглёнными краями и золотой
// надписью «УДМУРТ ТЕАТР». (fx, fz) — направление к улице.
function national(pl, fx, fz) {
  const g = new THREE.Group();
  const H = 18, wall = M.white;
  g.add(prism(pl, -3, 4, M.stone));
  g.add(prism(pl, 1, H - 1, wall));
  g.add(prism(pl, H, 0.7, M.stone, 0.35));
  let front = null;
  contourEdges(pl, (e) => { if (e.ox * fx + e.oz * fz > 0.6 && (!front || e.len > front.len)) front = e; });
  if (!front) contourEdges(pl, (e) => { if (!front || e.len > front.len) front = e; });
  const rows = [[1.6, 2], [5.2, 2], [8.6, 2], [12, 2], [15.2, 1.8]];
  contourWindows(g, pl, rows, { step: 3.4, w: 1.4, skip: (e) => e === front });
  // s — метр фасада от северного конца (север — меньший z).
  const L = front.len, at = (s) => (front.ez > 0 ? s : L - s);
  const piece = (obj, s, d = 0) => g.add(onEdge(obj, front, at(s), d));
  const T1 = Math.min(11, L * 0.2), C0 = T1, C1 = C0 + Math.min(20, L * 0.38), T2 = C1 + 6;
  for (let s = T2 + 1.7; s < L - 1; s += 3.4) {
    for (const [y, h] of rows) {
      piece(box(1.8, h + 0.35, 0.12, M.white, 0, y - 0.18, 0), s, 0.06);
      piece(box(1.4, h, 0.16, M.glass, 0, y, 0), s, 0.08);
    }
  }
  // Башни: белые объёмы чуть вперёд, с витражом во всю высоту и уступом наверху.
  const tower = (w, h, gw) => {
    const q = new THREE.Group();
    q.add(box(w, h + 3, 3, wall, 0, -3, -1));
    q.add(box(gw, h - 5, 0.2, M.glass, 0, 2.5, 0.55));
    for (let y = 2.5 + 1.6; y < h - 2.5; y += 1.6) q.add(box(gw, 0.12, 0.3, M.white, 0, y, 0.6));
    for (const x of [-gw / 6, gw / 6]) q.add(box(0.12, h - 5, 0.3, M.white, x, 2.5, 0.6));
    q.add(box(w + 0.6, 0.6, 3.6, M.stone, 0, h, -1));
    q.add(box(w - 2, 2.2, 2, wall, 0, h + 0.6, -1.4));
    q.add(box(w - 1.6, 0.3, 2.4, M.stone, 0, h + 2.8, -1.4));
    return q;
  };
  piece(tower(T1, H + 6, T1 * 0.55), T1 / 2, 1.5);
  piece(tower(6, H + 3, 2.2), (C1 + T2) / 2, 1.5);
  // Розовая середина.
  const cw = C1 - C0, c = new THREE.Group(), Hc = H + 1;
  c.add(box(cw, Hc + 3, 2, M.salmon, 0, -3, -0.6));
  for (let i = 0; i <= 6; i++) c.add(box(0.8, Hc - 5, 0.3, M.white, -cw / 2 + 1.5 + (i * (cw - 3)) / 6, 5, 0.5));
  for (let i = 0; i < 6; i++) {
    const x = -cw / 2 + 1.5 + ((i + 0.5) * (cw - 3)) / 6;
    for (const y of [5.6, 9, 12.4, 15.6]) {
      c.add(box(1.7, 2.3, 0.12, M.white, x, y - 0.15, 0.42));
      c.add(box(1.3, 2, 0.16, M.glass, x, y, 0.46));
    }
  }
  c.add(box(cw + 0.6, 0.7, 2.6, M.white, 0, Hc, -0.6));
  const pb = cw * 0.36;
  c.add(tri(cw / 2 + 0.3, 4.2, 14, M.terra, Hc + 0.6, -14));          // кровля в глубину
  c.add(tri(pb + 0.6, 3.6, 0.5, M.white, Hc + 0.7, 0.1));             // рама фронтона
  c.add(tri(pb - 0.4, 2.8, 0.2, M.salmon, Hc + 1.1, 0.55));             // тимпан
  c.add(mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.2, 16).rotateX(Math.PI / 2), M.white, 0, Hc + 2.2, 0.75));
  c.add(cyl(0.8, 10, M.tin, -cw * 0.25, Hc + 3, -8, 4, 0.15));      // мачта связи: решётчатая пирамидка
  for (let i = 0; i < 4; i++) { // панели антенн
    const a = (i * Math.PI) / 2, ant = box(0.5, 1.4, 0.15, M.white, -cw * 0.25 + Math.sin(a) * 0.35, Hc + 10.6, -8 + Math.cos(a) * 0.35);
    ant.rotation.y = a;
    c.add(ant);
  }
  // Козырёк: прямой фронт с надписью и закруглённые края, серая лента, под ней белые опоры.
  const cd = 6.5, half = cw / 2 - 3, Y = 4.6;
  c.add(box(2 * (half + cd), 1.4, 2.2, M.silver, 0, Y, 1.1));
  c.add(box(2 * half, 1.4, cd, M.silver, 0, Y, 2.2 + cd / 2));
  for (const sgn of [-1, 1]) {
    const geo = new THREE.CylinderGeometry(cd, cd, 1.4, 16, 1, false, sgn < 0 ? -Math.PI / 2 : 0, Math.PI / 2);
    c.add(mesh(geo, M.silver, sgn * half, Y + 0.7, 2.2));
  }
  for (const x of [-half - cd * 0.5, -half * 0.35, half * 0.35, half + cd * 0.5]) {
    const z = Math.abs(x) > half ? 2.2 + cd * 0.75 : 2.2 + cd - 0.6;
    c.add(box(0.9, 0.8, 0.9, M.terra, x, -0.2, z));
    c.add(box(0.8, Y, 0.8, M.white, x, 0, z));
  }
  c.add(box(cw - 2, Y - 0.6, 0.2, M.glass, 0, 0.6, 0.5));
  for (let i = 0; i < 4; i++) c.add(box(8, 0.25, 0.8, M.stone, 0, -0.25 + i * 0.25, 2.6 + 3 * 0.8 - i * 0.8)); // ступени
  piece(c, (C0 + C1) / 2, 1);
  const merged = mergeByMaterial(g);
  merged.add(onEdge(sign('УДМУРТ ТЕАТР', 2 * half - 2, 1.0, 0, Y + 0.2, 0, 1, '#9fa8ae'), front, at((C0 + C1) / 2), 1 + 2.2 + cd + 0.03));
  return merged;
}

// Музейно-выставочный комплекс Калашникова (по фото): объём по контуру — светлые каменные пилоны
// с тёмным стеклом между ними, плоская кровля с выносом, круглый стеклянный фонарь в центре.
// У угла к улице Бородина — высокий вход: зелёные стальные стойки, полуциркульный навес
// из зелёного стекла и бронзовая стена входа под ним. (fx, fz) — направление к улице.
function kalashnikov(pl, fx, fz) {
  const g = new THREE.Group();
  const H = 11, stone = M.limestone;
  g.add(prism(pl, -3, 3.4, M.stone));
  g.add(prism(pl, 0.4, H - 0.4, M.glass));
  contourEdges(pl, (e) => {
    if (e.len < 3) return;
    const n = Math.max(1, Math.round(e.len / 4.4));
    for (let k = 0; k <= n; k++) g.add(onEdge(box(1.3, H - 0.4, 1, stone, 0, 0.4, 0), e, (k * e.len) / n, 0.3));
  });
  g.add(prism(pl, H, 1.1, stone, 0.8));
  g.add(cyl(8, 2.2, M.white, 0, H + 1.1, 0, 32));
  g.add(cyl(7.6, 1.6, M.greenGlass, 0, H + 3.3, 0, 32));
  g.add(dome(7.8, M.white, 0, H + 4.9, 0, 0.18));
  // Вход: самая дальняя к улице точка контура.
  let best = pl[0];
  for (const q of pl) if (q[0] * fx + q[1] * fz > best[0] * fx + best[1] * fz) best = q;
  const e = new THREE.Group(), R = 4.4, Hp = 15, D = 9;
  e.position.set(best[0] - fx * 2, 0, best[1] - fz * 2);
  e.rotation.y = Math.atan2(fx, fz);
  e.add(box(7, Hp - 1, 3, M.bronze, 0, 0, -1));
  for (const x of [-R, R]) {
    for (const z of [0.5, D - 0.5]) e.add(cyl(0.32, Hp, M.steelGreen, x, 0, z, 10));
    e.add(box(0.5, 0.6, D, M.steelGreen, x, Hp - 0.6, D / 2));
  }
  e.add(box(2 * R + 0.8, 0.9, 0.6, M.yellow, 0, Hp - 0.9, D));
  const vault = mesh(new THREE.CylinderGeometry(R, R, D, 18, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2), M.greenGlass, 0, Hp, D / 2);
  e.add(vault);
  for (let z = 0.5; z <= D; z += 1.6) e.add(mesh(new THREE.TorusGeometry(R + 0.05, 0.08, 4, 18, Math.PI), M.steelGreen, 0, Hp, z));
  for (let i = 0; i < 4; i++) e.add(box(2.4, 0.25, 4, M.stone, 0, -0.2 - i * 0.25 + 0.75, D + 1.5 + i * 0.6)); // ступени
  g.add(e);
  return mergeByMaterial(g);
}

function column() {
  const g = new THREE.Group();
  g.add(box(4.5, 1.2, 4.5, M.granite, 0, -1, 0));
  g.add(box(3, 3.5, 3, M.granite, 0, 0.2, 0));
  g.add(cyl(0.75, 15, lambert('#d9c3b4'), 0, 3.7, 0, 16, 0.65));
  g.add(box(1.8, 0.7, 1.8, M.white, 0, 18.7, 0));
  // Архангел Михаил: фигура, крылья, копьё.
  g.add(cone(0.55, 2.4, M.gold, 0, 19.4, 0, 10));
  g.add(mesh(new THREE.SphereGeometry(0.3, 10, 8), M.gold, 0, 22.1, 0));
  for (const side of [-1, 1]) {
    const wing = box(0.12, 2.2, 1.0, M.gold, 0, 0, 0);
    wing.position.set(side * 0.55, 21.3, -0.3);
    wing.rotation.z = -side * 0.35;
    g.add(wing);
  }
  g.add(cyl(0.05, 3.6, M.gold, 0.7, 19.6, 0.3, 6));
  return g;
}

// Башня главного корпуса оружейного завода: ярусы, куранты, золотой шпиль.
// Башня Ижевского оружейного завода (по фото): над розовым корпусом с серой кровлей — круглый
// ярус с арками между розовыми пилонами, белые карнизы и два барабана (между ними розовый
// пологий выступ), золотой венец из военной арматуры, высокий столп, шар в клетке и игла.
// Главный корпус оружейного завода (Дудин, 1808–1815; по фото): длинный розовый трёхэтажный корпус
// по контуру, белые тяги и карниз (на высоте карниза под башней), внизу арочные окна. На фасаде к
// пруду (север) — колоннада под башней: белый рустованный низ, колонны на два верхних этажа,
// антаблемент с розовыми метопами; на концах фасада — павильоны с фронтонами и зелёной кровлей.
// (tx, tz) — башня в локальных координатах.
function plantMain(pl, tx, tz) {
  const g = new THREE.Group();
  const H = 11.4, pink = M.pink;
  g.add(prism(pl, -3, 3.5, M.stone));
  g.add(prism(pl, 0.5, H - 0.5, pink));
  g.add(prism(pl, 4.4, 0.4, M.white, 0.15));
  g.add(prism(pl, H, 0.6, M.white, 0.3));
  g.add(insetRoof(pl, 7, 2.2, H + 0.6, M.silver));
  let front = null;
  contourEdges(pl, (e) => { if (e.oz < -0.7 && (!front || e.len > front.len)) front = e; });
  const tc = (tx - front.x) * front.ex + (tz - front.z) * front.ez; // башня — метр фасада
  const busy = (e, t) => e === front && (Math.abs(t - tc) < 15.5 || t < 14 || t > e.len - 14);
  contourEdges(pl, (e) => {
    if (e.len < 6) return;
    const n = Math.floor(e.len / 4.2);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) * (e.len / n);
      if (busy(e, t)) continue;
      g.add(onEdge(box(0.7, H - 4.8, 0.25, M.white, 0, 4.8, 0), e, t + e.len / n / 2, 0.1)); // лопатки
      if (e.oz > 0.7) continue; // южный фасад — на закрытую территорию завода: без окон, вдвое легче
      g.add(onEdge(archWindowZ(1.5, 2.8, 5).translateY(1.1), e, t, 0.05));
      for (const y of [5.4, 8.4]) {
        g.add(onEdge(box(1.8, 2.25, 0.12, M.white, 0, y - 0.15, 0), e, t, 0.06));
        g.add(onEdge(box(1.4, 1.95, 0.16, M.glass, 0, y, 0), e, t, 0.08));
      }
    }
  });
  // Колоннада под башней (по фото с улицы): восемь колонн от земли во все этажи, между ними внизу
  // арочные окна и дверь, выше — два ряда окон; антаблемент с розовыми метопами, розовый фриз, карниз и
  // белый аттик с часами, на котором стоит башня. Стена колоннады вынесена на d — чуть впереди основания
  // башни (16 × 14 вокруг её точки), иначе оно проступало сквозь стену, закрывая средние пролёты.
  const out = (tx - front.x) * front.ox + (tz - front.z) * front.oz;
  const d = Math.max(0.9, 7.3 + out), zt = out - d; // zt — башня в системе колоннады
  const c = new THREE.Group(), cw = 28, n = 8, bay = (cw - 1.6) / (n - 1);
  c.add(box(cw, H + 3, d + 0.2, pink, 0, -3, -d / 2));
  c.add(box(cw, 0.3, 0.2, M.white, 0, 4.3, 0.1));
  for (let i = 0; i < n; i++) {
    const x = -cw / 2 + 0.8 + i * bay;
    c.add(box(1.5, 0.5, 1.5, M.white, x, -0.2, 0.9));
    c.add(cyl(0.55, H - 0.8, M.white, x, 0.3, 0.9, 12, 0.47));
    c.add(box(1.4, 0.4, 1.4, M.white, x, H - 0.5, 0.9));
    if (i === n - 1) continue;
    const xm = x + bay / 2;
    if (i === (n - 2) / 2) c.add(archWindowZ(1.6, 3.4, 6).translateX(xm).translateY(0.3)); // дверь
    else c.add(archWindowZ(1.7, 2.8, 6).translateX(xm).translateY(0.9));
    for (const y of [5, 8.1]) {
      c.add(box(1.8, 2.3, 0.12, M.white, xm, y - 0.15, 0.06));
      c.add(box(1.4, 2, 0.16, M.glass, xm, y, 0.1));
    }
  }
  c.add(box(cw + 1.2, 1.3, d + 1.9, M.white, 0, H - 0.1, (1.9 - d) / 2));
  for (let i = 0; i < 14; i++) c.add(box(0.8, 0.5, 0.1, pink, -cw / 2 + 1.2 + (i * (cw - 2.4)) / 13, H + 0.3, 1.92)); // метопы
  c.add(box(cw + 1, 1, d + 1.7, pink, 0, H + 1.2, (1.7 - d) / 2));
  c.add(box(cw + 1.6, 0.45, d + 2.1, M.white, 0, H + 2.2, (2.1 - d) / 2));
  // Аттик под башней: белый, с розовыми филёнками и часами.
  c.add(box(17, 1.6, 14.2, M.white, 0, H + 2.65, zt));
  for (const x of [-5.5, 5.5]) c.add(box(4, 0.6, 0.1, pink, x, H + 3.15, zt + 7.12));
  c.add(mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.12, 16).rotateX(Math.PI / 2), M.dark, 0, H + 3.45, zt + 7.12));
  c.add(mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.14, 16).rotateX(Math.PI / 2), M.white, 0, H + 3.45, zt + 7.14));
  g.add(onEdge(c, front, tc, d));
  // Концевые павильоны: выше корпуса, с фронтоном и зелёной кровлей.
  const Hp = H + 2.4;
  for (const t of [8, front.len - 8]) {
    const q = new THREE.Group(), w = 15;
    q.add(box(w, Hp + 3, 3, pink, 0, -3, -0.9));
    for (const x of [-w / 2 + 0.6, w / 2 - 0.6, -w / 6, w / 6]) q.add(box(0.9, Hp - 4.8, 0.3, M.white, x, 4.8, 0.65));
    for (const x of [-w / 3, 0, w / 3]) {
      q.add(archWindowZ(1.6, 3).translateX(x).translateY(1).translateZ(0.62));
      for (const y of [5.6, 9.2]) {
        q.add(box(1.8, 2.5, 0.12, M.white, x, y - 0.15, 0.6));
        q.add(box(1.4, 2.2, 0.16, M.glass, x, y, 0.64));
      }
    }
    q.add(box(w + 0.6, 0.6, 3.6, M.white, 0, Hp, -0.9));
    q.add(tri(w / 2 + 0.3, 3.4, 16, M.roofGreen, Hp + 0.6, -15.4));
    q.add(tri(w / 2, 3, 0.4, M.white, Hp + 0.6, 0.6));
    q.add(tri(w / 2 - 1, 2.2, 0.2, pink, Hp + 0.9, 0.95));
    g.add(onEdge(q, front, t, 1.4));
  }
  return mergeByMaterial(g);
}

// Водонапорная башня 1915 года (Бородина, 4; по фото): шестигранный ствол из красного кирпича, чуть
// сужается кверху; на гранях — тёмные кирпичные арки, узкие стрельчатые окна и круглые внизу; наверху —
// уширенный ярус на кирпичных напусках с окошками, зубчатый парапет и лёгкое ограждение.
// r — радиус по вершинам, a — поворот так, чтобы вершины легли на контур.
function waterTower(r, a) {
  const g = new THREE.Group(), H = 22, Ht = 4.5, rt = r * 0.9, brick = M.warmBrick;
  const hex = (r0, r1, y0, h, mat) => {
    const m = mesh(new THREE.CylinderGeometry(r1, r0, h, 6), mat, 0, y0 + h / 2, 0);
    m.rotation.y = a;
    return m;
  };
  g.add(hex(r + 0.3, r + 0.3, -3, 3.6, M.stone));
  g.add(hex(r, rt, 0.6, H, brick));
  g.add(hex(rt, rt + 0.6, H + 0.6, 0.9, M.darkBrick));               // напуски
  g.add(hex(rt + 0.6, rt + 0.6, H + 1.5, Ht, brick));
  g.add(hex(rt + 0.75, rt + 0.75, H + 1.5 + Ht, 0.4, M.darkBrick));
  for (let i = 0; i < 6; i++) {
    const th = a + Math.PI / 6 + (i * Math.PI) / 3, sx = Math.sin(th), sz = Math.cos(th);
    const face = (obj, ap, y) => { obj.position.set(sx * ap, y, sz * ap); obj.rotation.y = th; g.add(obj); return obj; };
    const ap = (rr) => rr * Math.cos(Math.PI / 6);
    const wf = r * 0.75; // ширина грани с запасом на сужение
    // Тёмные арки-пояски: внизу, посередине и под напусками.
    for (const [y, w] of [[4.6, wf], [12.5, wf * 0.95], [H - 2.2, wf * 0.9]]) {
      const rr = r + (rt - r) * (y / H) + 0.02;
      face(mesh(new THREE.TorusGeometry(w * 0.42, 0.18, 4, 12, Math.PI), M.darkBrick), ap(rr), y);
      face(box(w * 0.95, 0.25, 0.2, M.darkBrick, 0, 0, 0), ap(rr), y - 0.3);
    }
    const rr = (y) => r + (rt - r) * (y / H) + 0.05;
    if (i % 2 === 0) face(mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.2, 14).rotateX(Math.PI / 2), M.glass), ap(rr(2.5)), 2.5);
    for (const y of i % 2 ? [7, 15] : [10, 17.5]) {
      face(box(0.6, 2.2, 0.2, M.glass, 0, 0, 0), ap(rr(y)), y);
      face(mesh(new THREE.ConeGeometry(0.42, 0.8, 4).rotateY(Math.PI / 4).scale(1, 1, 0.3), M.glass), ap(rr(y)), y + 1.1 + 0.4);
    }
    face(box(0.9, 1.3, 0.2, M.glass, 0, 0, 0), ap(rt + 0.62), H + 2.8);
    // Зубцы парапета и стойки ограждения на вершинах.
    for (const k of [-0.3, 0, 0.3]) {
      const z = box(0.9, 0.9, 0.5, brick, 0, 0, 0);
      z.position.set(sx * ap(rt + 0.5) + Math.cos(th) * k * r, H + 1.9 + Ht, sz * ap(rt + 0.5) - Math.sin(th) * k * r);
      z.rotation.y = th;
      g.add(z);
    }
    const tv = a + (i * Math.PI) / 3;
    g.add(cyl(0.05, 1.1, M.dark, Math.sin(tv) * (rt + 0.2), H + 1.9 + Ht, Math.cos(tv) * (rt + 0.2), 4));
  }
  const rail = mesh(new THREE.CylinderGeometry(rt + 0.2, rt + 0.2, 0.06, 6, 1, true), doubleSided(M.dark), 0, H + 2.95 + Ht, 0);
  rail.rotation.y = a;
  g.add(rail);
  g.add(hex(rt + 0.4, rt + 0.4, H + 1.85 + Ht, 0.1, M.stone));         // кровля
  return mergeByMaterial(g);
}

// Центральный республиканский стадион (бывший «Зенит»; по фото): открытая чаша по контуру OSM —
// белая наружная стена с синей полосой, внутрь спускаются ряды трибун (белые с синими секторами),
// на восточной трибуне — «ЗЕНИТ» белым по синему; по диагоналям — четыре решётчатые мачты освещения
// в красно-белую полоску. Поле и беговая дорожка — уже земля из OSM (areas).
function stadium(pl) {
  const g = new THREE.Group();
  const W = 16, K = 12, rise = 0.55, H = 1.2 + K * rise, n = pl.length;
  const rings = new Map();
  const ring = (d) => rings.get(d) || rings.set(d, offsetContour(pl, d)).get(d);
  // Полоса между сдвигами dA и dB на высотах yA и yB — по рёбрам from..to.
  const band = (dA, dB, yA, yB, mat, from = 0, to = n) => {
    const A = ring(dA), B = ring(dB), pos = [];
    for (let i = from; i < to; i++) {
      const j = (i + 1) % n;
      pos.push(A[i][0], yA, A[i][1], A[j][0], yA, A[j][1], B[j][0], yB, B[j][1]);
      pos.push(A[i][0], yA, A[i][1], B[j][0], yB, B[j][1], B[i][0], yB, B[i][1]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    g.add(mesh(geo, doubleSided(mat)));
  };
  band(0, 0, -3, H + 1.2, M.white);
  band(-0.05, -0.05, H - 0.2, H + 0.5, M.band);
  band(0, 1.5, H + 1.2, H + 1.2, M.concrete);
  band(1.5, 1.5, H, H + 1.2, M.white);
  // Ряды: верхний — у стены, нижний — у дорожки; синие сектора через один в верхней половине.
  const sectors = 14, per = Math.ceil(n / sectors);
  for (let k = 0; k < K; k++) {
    const dOut = 1.5 + (k * (W - 1.5)) / K, dIn = 1.5 + ((k + 1) * (W - 1.5)) / K, y = H - k * rise;
    for (let sct = 0; sct < sectors; sct++) {
      const from = sct * per, to = Math.min(n, from + per);
      if (from >= to) continue;
      band(dOut, dIn, y, y, (k < K / 2 && sct % 2) || k === K - 1 ? M.blue : M.white, from, to);
    }
    band(dIn, dIn, y - rise, y, M.stone);
  }
  band(W, W, 0, 1.2, M.blue);
  // Мачты освещения — по диагоналям овала.
  const xs = pl.map((q) => q[0]), zs = pl.map((q) => q[1]);
  const hx = (Math.max(...xs) - Math.min(...xs)) / 2, hz = (Math.max(...zs) - Math.min(...zs)) / 2;
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    let best = pl[0];
    for (const q of pl) if (q[0] * sx / hx + q[1] * sz / hz > best[0] * sx / hx + best[1] * sz / hz) best = q;
    const d = Math.hypot(best[0], best[1]) || 1, ux = best[0] / d, uz = best[1] / d;
    const x = best[0] + ux * 4, z = best[1] + uz * 4, Hm = 42, seg = 7;
    for (let i = 0; i < seg; i++) {
      const r0 = 1.4 - (i * 1.0) / seg, r1 = 1.4 - ((i + 1) * 1.0) / seg;
      g.add(cyl(r0, Hm / seg, i % 2 ? M.white : M.signalRed, x, (i * Hm) / seg, z, 4, r1));
    }
    const lamp = new THREE.Group();
    lamp.add(box(6, 4, 0.6, M.signalRed, 0, 0, 0));
    lamp.add(box(5.4, 3.4, 0.2, M.white, 0, 0.3, 0.35));
    lamp.position.set(x, Hm - 1, z);
    lamp.rotation.y = Math.atan2(-ux, -uz);
    g.add(lamp);
  }
  const merged = mergeByMaterial(g);
  // «ЗЕНИТ» на восточной трибуне, по скату.
  let east = null;
  contourEdges(pl, (e) => { if (e.ox > 0.9 && (!east || e.len > east.len)) east = e; });
  const mx = east.x + east.ex * east.len / 2, mz = east.z + east.ez * east.len / 2;
  const A = [mx - east.ox * 1.5, mz - east.oz * 1.5], B = [mx - east.ox * W, mz - east.oz * W];
  const run = Math.hypot(A[0] - B[0], A[1] - B[1]), tilt = Math.atan2(H - 1.2, run);
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 160;
  const cx = c.getContext('2d');
  cx.fillStyle = '#3f78b5';
  cx.fillRect(0, 0, 1024, 160);
  cx.fillStyle = '#ffffff';
  cx.font = 'bold 130px sans-serif';
  cx.textAlign = 'center';
  cx.textBaseline = 'middle';
  cx.fillText('З Е Н И Т', 512, 86);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const len = Math.hypot(run, H - 1.2);
  const word = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(len * 6.4, east.len * 0.9), len * 0.92), new THREE.MeshLambertMaterial({ map: t }));
  word.rotation.order = 'YXZ';
  word.rotation.y = Math.atan2(B[0] - A[0], B[1] - A[1]);
  word.rotation.x = -(Math.PI / 2 - tilt);
  word.position.set((A[0] + B[0]) / 2, (H + 1.2) / 2 + rise + 0.1, (A[1] + B[1]) / 2); // над углами ступеней
  merged.add(word);
  return merged;
}

// Вокзал станции Ижевск (по фото): светлый камень с тёмно-красным цоколем, высокие арочные окна,
// над карнизом — волнистый аттик из полукруглых щипцов с круглыми окошками, красная кровля. Центральный
// объём выше и чуть смещён от середины: арочный витраж над входом, герб, барабан с красным куполом и
// шпилем; по концам — павильоны выше крыльев с полукруглыми щипцами. «ВОКЗАЛ» — к городу (f = ±1 по z),
// «ИЖЕВСК» — к путям. L × W — прямоугольник контура в системе fit.
function station(L, W, f) {
  const g = new THREE.Group();
  const H = 11, stone = M.marble, red = M.terra;
  g.add(box(L, 4.2, W, M.darkBrick, 0, -3, 0));
  g.add(box(L - 0.2, H - 1.2, W - 0.2, stone, 0, 1.2, 0));
  g.add(box(L + 0.4, 0.6, W + 0.4, M.white, 0, H, 0));
  g.add(box(L - 1, 2, W - 1, red, 0, H + 0.6, 0));
  g.add(box(L - 6, 1.4, W - 6, red, 0, H + 2.6, 0));
  const xc = -L * 0.08, cw = 13, Hc = 16.5, pw = 7;  // центр, его ширина и высота; ширина павильона
  const inWing = (x) => Math.abs(x - xc) > cw / 2 + 1.5 && Math.abs(x) < L / 2 - pw - 0.5;
  for (const s of [-1, 1]) {
    const z = s * (W / 2 - 0.08);
    const face = (obj) => { if (s < 0) obj.rotation.y = Math.PI; obj.position.z = z + s * obj.position.z; g.add(obj); return obj; };
    // Крылья: арочные окна, полукруглые щипцы аттика.
    for (let x = -L / 2 + pw + 2; x < L / 2 - pw - 1; x += 3.6) {
      if (!inWing(x)) continue;
      face(archWindowZ(1.6, 5).translateX(x).translateY(1.8));
      const q = halfDisc(1.6, 0.5, stone);
      q.position.set(x, H + 0.6, 0);
      face(q);
      face(mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.2, 12).rotateX(Math.PI / 2), M.glass, x, H + 1.3, 0.3));
      face(box(3.4, 1.6, 0.5, stone, x, H + 0.6 - 1.6 + 0.6, 0));
    }
    // Концевые павильоны: выше, по два яруса окон и большой щипец.
    for (const e of [-1, 1]) {
      const x = e * (L / 2 - pw / 2);
      face(box(pw, H + 2.6, 1.2, stone, x, -3, 0.3));
      for (const y of [2, 6.8]) face(box(1.4, 2.6, 0.2, M.glass, x, y, 0.95));
      const q = halfDisc(pw / 2, 0.6, stone);
      q.position.set(x, H - 0.4 + 0.4, 0.3);
      face(q);
      face(mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.2, 12).rotateX(Math.PI / 2), M.glass, x, H + 1.2, 0.7));
    }
    // Центральный объём: выступ, арочный витраж, герб, табличка.
    face(box(cw, Hc + 3, 1.6, stone, xc, -3, 0.5));
    face(box(cw + 0.5, 0.6, 2, M.white, xc, Hc, 0.5));
    face(archWindowZ(4, 6).translateX(xc).translateY(2.2).translateZ(1.32));
    for (const dx of [-4.5, 4.5]) for (const y of [2.5, 7.5, 11.5]) face(box(1.2, 2, 0.2, M.glass, xc + dx, y, 1.32));
    const q = halfDisc(3.2, 0.6, stone);
    q.position.set(xc, Hc + 0.6, 0.6);
    face(q);
    face(mesh(new THREE.CylinderGeometry(1, 1, 0.2, 16).rotateX(Math.PI / 2), M.white, xc, Hc + 1.8, 0.95));
  }
  g.add(box(cw - 1, 2.4, W - 3, red, xc, Hc + 0.6, 0));
  // Барабан, купол, шпиль.
  g.add(cyl(3.6, 0.5, M.white, xc, Hc + 3, 0, 24));
  g.add(cyl(3.3, 3.4, M.white, xc, Hc + 3.5, 0, 24));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, w = box(0.9, 1.6, 0.3, M.glass, xc + Math.sin(a) * 3.3, Hc + 4.3, Math.cos(a) * 3.3);
    w.rotation.y = a;
    g.add(w);
  }
  g.add(dome(3.6, red, xc, Hc + 6.9, 0, 0.55));
  g.add(cyl(0.25, 1.2, M.white, xc, Hc + 8.7, 0, 8));
  g.add(cone(0.18, 6, red, xc, Hc + 9.9, 0, 6));
  const merged = mergeByMaterial(g);
  merged.add(sign('ВОКЗАЛ', 6, 0.9, xc, Hc - 3.4, f * (W / 2 + 1.36), f, '#ebe5da'));
  merged.add(sign('ИЖЕВСК', 6, 0.9, xc, Hc - 3.4, -f * (W / 2 + 1.36), -f, '#ebe5da'));
  return merged;
}

// Генеральский дом (Милиционная, 4; по фото): двухэтажный охристый дом начала XIX века по контуру,
// белые тяги, карниз, лопатки на углах и наличники, рыжая скатная кровля; на фасаде к улице —
// чугунный балкон на кованых кронштейнах. (fx, fz) — направление к улице.
function general(pl, fx, fz) {
  const g = new THREE.Group(), H = 8.6;
  g.add(prism(pl, -3, 3.6, M.stone));
  g.add(prism(pl, 0.6, H - 0.6, M.ochre));
  g.add(prism(pl, 3.9, 0.35, M.white, 0.12));
  g.add(prism(pl, H, 0.5, M.white, 0.3));
  g.add(insetRoof(pl, 5, 2.4, H + 0.5, M.rust));
  contourWindows(g, pl, [[1.2, 1.8], [4.9, 2]], { step: 3.4, w: 1.3 });
  let front = null;
  contourEdges(pl, (e) => {
    if (e.ox * fx + e.oz * fz > 0.6 && (!front || e.len > front.len)) front = e;
    if (e.len < 2) return;
    for (const t of [0.4, e.len - 0.4]) g.add(onEdge(box(0.8, H - 0.6, 0.25, M.white, 0, 0.6, 0), e, t, 0.1));
  });
  if (front) {
    const b = new THREE.Group(), w = 7;
    b.add(box(w, 0.25, 1.5, M.stone, 0, 4.3, 0.75));
    b.add(box(w, 0.08, 0.08, M.dark, 0, 5.3, 1.45));
    for (let i = 0; i <= 14; i++) b.add(box(0.05, 1, 0.05, M.dark, -w / 2 + (i * w) / 14, 4.55, 1.45));
    for (const x of [-w / 2 + 0.6, -w / 6, w / 6, w / 2 - 0.6]) {
      const k = box(0.1, 1.2, 0.1, M.dark, 0, 0, 0);
      k.position.set(x, 3.75, 0.65);
      k.rotation.x = 0.85;
      b.add(k);
    }
    g.add(onEdge(b, front, front.len * 0.35));
  }
  return mergeByMaterial(g);
}

// Пригородный вокзал (по фото): розово-бежевый корпус с тёмно-красным цоколем, ряд высоких арочных
// окон с белыми лопатками, над карнизом — полукруглые щипцы с круглыми окошками; ближе к середине —
// высокий объём с полукруглым верхом и огромным арочным витражом. К площади (f = ±1 по z) — надпись
// «ПРИГОРОДНЫЙ ВОКЗАЛ» и козырёк на тёмно-красных столбах, к путям — «ИЖЕВСК».
function suburban(L, W, f) {
  const g = new THREE.Group(), H = 10, wall = M.peach;
  g.add(box(L, 4, W, M.darkBrick, 0, -3, 0));
  g.add(box(L - 0.2, H - 1, W - 0.2, wall, 0, 1, 0));
  g.add(box(L + 0.4, 0.5, W + 0.4, M.white, 0, H, 0));
  g.add(box(L - 0.6, 0.8, W - 0.6, M.silver, 0, H + 0.5, 0));
  const xc = -L * 0.12, cw = 9;
  for (const s of [-1, 1]) {
    const z = s * (W / 2 - 0.08);
    const face = (obj) => { if (s < 0) obj.rotation.y = Math.PI; obj.position.z = z + s * obj.position.z; g.add(obj); return obj; };
    let k = 0;
    for (let x = -L / 2 + 2.5; x < L / 2 - 2; x += 4.2, k++) {
      if (Math.abs(x - xc) < cw / 2 + 1.2) continue;
      face(archWindowZ(2.2, 6).translateX(x).translateY(1.6));
      face(box(0.7, H - 1, 0.25, M.white, x + 2.1, 1, 0.1));
      if (k % 2) continue;
      const q = halfDisc(1.3, 0.4, wall);
      q.position.set(x, H + 0.5, 0);
      face(q);
      face(mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.2, 12).rotateX(Math.PI / 2), M.glass, x, H + 1.1, 0.2));
    }
    face(box(cw, H + 5, 1, wall, xc, -3, 0.4));
    face(archWindowZ(4.4, 9).translateX(xc).translateY(1.6).translateZ(0.92));
    const rim = halfDisc(cw / 2 + 0.3, 0.4, M.white);
    rim.position.set(xc, H + 2, 0.5);
    face(rim);
    const top = halfDisc(cw / 2, 0.6, wall);
    top.position.set(xc, H + 2, 0.6);
    face(top);
  }
  // Козырёк входа со стороны площади.
  g.add(box(8, 0.5, 4.2, M.white, xc, 3.8, f * (W / 2 + 2.1)));
  g.add(box(8.1, 0.25, 4.3, M.terra, xc, 3.75, f * (W / 2 + 2.1)));
  for (const x of [-3.4, 3.4]) g.add(box(0.6, 3.8, 0.6, M.terra, xc + x, 0, f * (W / 2 + 3.7)));
  const merged = mergeByMaterial(g);
  merged.add(sign('ПРИГОРОДНЫЙ ВОКЗАЛ', 11, 0.9, xc, H - 2.4, f * (W / 2 + 1.06), f, '#e8c7b6'));
  merged.add(sign('ИЖЕВСК', 5, 0.9, xc, H - 2.4, -f * (W / 2 + 1.06), -f, '#e8c7b6'));
  return merged;
}

// Театр кукол (Ломоносова, 9; по фото): светлый корпус с тёмным каменным низом, белыми тягами,
// арочными окнами-витражами и рядом окошек с треугольными навершиями под карнизом. На фасаде к улице —
// сказочная краснокирпичная башня с белыми углами: арка входа, кованый балкон, три арочки, розетка,
// зубчатый парапет, зелёный шатёр с флюгером и две башенки. (fx, fz) — куда смотрит вход.
function puppets(pl, fx, fz) {
  const g = new THREE.Group(), H = 12;
  g.add(prism(pl, -3, 5, M.slateDark));
  g.add(prism(pl, 2, H - 2, M.beige));
  g.add(prism(pl, 2, 0.6, M.white, 0.35));
  g.add(prism(pl, H, 0.5, M.white, 0.2));
  const small = (h) => {
    const o = new THREE.Group();
    o.add(box(1.7, h + 0.4, 0.12, M.white, 0, -0.2, 0));
    o.add(box(1.3, h, 0.16, M.glass, 0, 0, 0.02));
    o.add(tri(1.05, 0.6, 0.15, M.white, h + 0.2, -0.05));
    return o;
  };
  contourWindows(g, pl, [[H - 2.8, 1.3]], { step: 3, make: small });
  contourWindows(g, pl, [[4.4, 3.2]], { step: 7, make: (h) => archWindowZ(1.3, h) });
  let front = null;
  contourEdges(pl, (e) => { if (e.ox * fx + e.oz * fz > 0.6 && (!front || e.len > front.len)) front = e; });
  if (!front) contourEdges(pl, (e) => { if (!front || e.len > front.len) front = e; });
  const t = new THREE.Group(), w = 6.5, Ht = 13;
  t.add(box(w, Ht + 3, w, M.warmBrick, 0, -3, -w / 2 + 2));
  for (const x of [-w / 2, w / 2]) t.add(box(0.8, Ht, 0.8, M.white, x, 0, 2));
  t.add(halfDisc(1.8, 0.2, M.white).translateY(3.2).translateZ(2.02));
  t.add(halfDisc(1.4, 0.2, M.darkBrick).translateY(3.2).translateZ(2.08));
  t.add(box(2.8, 3.2, 0.2, M.darkBrick, 0, 0, 2.08));
  t.add(box(w + 1, 0.35, 1.8, M.white, 0, 5.4, 2.9));
  t.add(box(w + 1, 0.9, 0.08, M.dark, 0, 5.75, 3.75));
  for (const x of [-1.6, 0, 1.6]) {
    t.add(box(0.9, 1.5, 0.2, M.dark, x, 6.4, 2.06));
    t.add(halfDisc(0.45, 0.2, M.dark).translateX(x).translateY(7.9).translateZ(2.06));
  }
  t.add(mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.2, 18).rotateX(Math.PI / 2), M.white, 0, 10.4, 2.06));
  t.add(mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.25, 8).rotateX(Math.PI / 2), M.signalRed, 0, 10.4, 2.12));
  t.add(box(w + 0.6, 0.6, w + 0.6, M.white, 0, Ht, -w / 2 + 2));
  for (let i = 0; i < 4; i++) for (const k of [-1, 1]) {
    const m = box(0.7, 0.7, 0.4, M.white, 0, Ht + 0.6, 0);
    const a = (i * Math.PI) / 2, r = w / 2 + 0.1, u = k * w * 0.25;
    m.position.set(Math.sin(a) * r + Math.cos(a) * u, Ht + 0.95, -w / 2 + 2 + Math.cos(a) * r - Math.sin(a) * u);
    m.rotation.y = a;
    t.add(m);
  }
  t.add(cone(w * 0.45, 8, M.teal, 0, Ht + 0.6, -w / 2 + 2, 8));
  t.add(cyl(0.05, 1.5, M.gold, 0, Ht + 8.6, -w / 2 + 2, 4));
  t.add(box(1, 0.6, 0.06, M.gold, 0.4, Ht + 9.5, -w / 2 + 2));
  for (const x of [-w / 2, w / 2]) {
    t.add(cyl(0.6, 1.6, M.white, x, Ht + 0.6, 2, 8));
    t.add(cone(0.8, 2.8, M.teal, x, Ht + 2.2, 2, 8));
  }
  for (let i = 0; i < 4; i++) t.add(box(16, 0.25, 1, M.stone, 0, -0.25 + i * 0.25, 7 - i * 1)); // ступени
  g.add(onEdge(t, front, front.len * 0.3, 0.5));
  return mergeByMaterial(g);
}

// Соборная мечеть (Азина, 238; по фото): краснокирпичный зал по контуру с арочными окнами в белых
// рамах и зелёной кровлей; на конце к улице — высокий кирпичный минарет с белыми поясами, балконом
// и золотым шпилем, на другом конце — две башни с серебристыми куполами. Контур в системе fit
// по длинному ребру; s = ±1 — конец к улице по локальной x.
function sobmech(pl, s) {
  const g = new THREE.Group(), H = 9;
  g.add(prism(pl, -3, H + 3, M.redBrick));
  g.add(prism(pl, H, 0.5, M.white, 0.25));
  g.add(insetRoof(pl, 5, 2.6, H + 0.5, M.domeGreen));
  contourWindows(g, pl, [[2.2, 4.2]], { step: 3.2, make: (h) => archWindowZ(1.4, h, 6) });
  const xs = pl.map((q) => q[0]);
  const end = (k) => pl.reduce((b, q) => (q[0] * k > b[0] * k ? q : b));
  const m = end(s), x0 = m[0] - s * 1.5, z0 = m[1];
  g.add(cyl(1.7, 25, M.redBrick, x0, -3, z0, 8));
  for (const y of [8, 14, 19]) g.add(cyl(1.85, 0.5, M.white, x0, y, z0, 8));
  g.add(cyl(2.5, 0.5, M.white, x0, 22, z0, 8));
  g.add(cyl(2.4, 1, M.dark, x0, 22.5, z0, 8, 2.4));
  g.add(cyl(1.3, 4.5, M.white, x0, 22, z0, 8));
  g.add(cyl(1.5, 0.4, M.white, x0, 26.5, z0, 8));
  g.add(cone(1.4, 8, M.gold, x0, 26.9, z0, 8));
  for (const k of [-1, 1]) {
    const far = s > 0 ? Math.min(...xs) : Math.max(...xs);
    const zz = pl.filter((q) => Math.abs(q[0] - far) < 4).map((q) => q[1]);
    const z = zz.length ? (k > 0 ? Math.max(...zz) : Math.min(...zz)) - k * 1.8 : k * 4;
    g.add(cyl(2, H + 3 + 2.5, M.stone, far + s * 1.8, -3, z, 12));
    g.add(dome(2.1, M.tin, far + s * 1.8, H + 2.5, z, 0.9));
    g.add(cone(0.12, 1.6, M.gold, far + s * 1.8, H + 4.3, z, 4));
  }
  return mergeByMaterial(g);
}

// Музей изобразительных искусств (Кирова, 128; по фото): двухэтажный коралловый дом с тёмным цоколем,
// широким белым карнизом и аттиком; на фасаде к улице — ряд серых полуколонн с капителями
// на оба этажа и лепные панели между окнами. (fx, fz) — направление к улице.
function izo(pl, fx, fz) {
  const g = new THREE.Group(), H = 10;
  g.add(prism(pl, -3, 4, M.slateDark));
  g.add(prism(pl, 1, H - 1, M.coral));
  g.add(prism(pl, H, 1.2, M.white, 0.45));
  g.add(insetRoof(pl, 4, 1.6, H + 1.2, M.silver));
  let front = null;
  contourEdges(pl, (e) => { if (e.ox * fx + e.oz * fz > 0.6 && (!front || e.len > front.len)) front = e; });
  if (!front) contourEdges(pl, (e) => { if (!front || e.len > front.len) front = e; });
  contourWindows(g, pl, [[1.8, 2.2], [5.8, 2.4]], { step: 2.8, w: 1.2, skip: (e) => e === front });
  const n = Math.max(4, Math.round(front.len / 2.8));
  for (let k = 0; k <= n; k++) {
    const t = 0.5 + (k * (front.len - 1)) / n;
    g.add(onEdge(cyl(0.45, H - 1.6, M.stone, 0, 1, 0.3, 12), front, t));
    g.add(onEdge(box(1.2, 0.6, 0.9, M.stone, 0, H - 0.6, 0.3), front, t));
    if (k === n) continue;
    const tm = t + (front.len - 1) / n / 2;
    if (Math.abs(tm - front.len / 2) < 1.5) {
      g.add(onEdge(box(1.6, 3.2, 0.2, M.bronze, 0, 1, 0), front, tm, 0.05)); // дверь
    } else {
      g.add(onEdge(box(1.2, 2.2, 0.16, M.glass, 0, 1.8, 0), front, tm, 0.08));
    }
    g.add(onEdge(box(1.2, 2.4, 0.16, M.glass, 0, 5.8, 0), front, tm, 0.08));
    g.add(onEdge(box(1.3, 0.9, 0.15, M.stone, 0, 4.4, 0), front, tm, 0.08));
  }
  g.add(onEdge(box(front.len * 0.4, 1.6, 0.6, M.white, 0, H + 1.2, -0.2), front, front.len / 2));
  return mergeByMaterial(g);
}

// Армянская церковь Святого Григория Просветителя (10 лет Октября, 59; по фото): крестово-купольный
// храм из розового туфа — крестом щипцовые кровли из красной черепицы, гранёный барабан с узкими окнами
// и конической кровлей, арочный портал на торце к улице; перед ним — отдельная звонница из двух столбов
// с арками и крестом. L × W — прямоугольник контура в системе fit, s = ±1 — торец к улице по x.
function armenian(L, W, s) {
  const g = new THREE.Group(), H = 9, tuff = M.tuff;
  g.add(box(L, H + 3, W * 0.6, tuff, 0, -3, 0));
  g.add(box(L * 0.55, H + 3, W, tuff, 0, -3, 0));
  const roof = (len, b, h, rotY) => {
    const sh = new THREE.Shape([new THREE.Vector2(-b, 0), new THREE.Vector2(b, 0), new THREE.Vector2(0, h)]);
    const geo = new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false }).translate(0, 0, -len / 2).rotateY(rotY);
    return mesh(geo, M.terra, 0, H, 0);
  };
  g.add(roof(L + 0.4, W * 0.3 + 0.3, 2.6, Math.PI / 2));
  g.add(roof(W + 0.4, L * 0.275 + 0.3, 2.6, 0));
  g.add(cyl(3.3, 6, tuff, 0, H + 1.5, 0, 12));
  for (let i = 0; i < 12; i += 2) {
    const a = (i / 12) * Math.PI * 2, w = box(0.5, 2, 0.3, M.glass, Math.sin(a) * 3.2, H + 3.6, Math.cos(a) * 3.2);
    w.rotation.y = a;
    g.add(w);
  }
  g.add(cone(3.7, 3.6, M.terra, 0, H + 7.5, 0, 12));
  const cross = (x, y, z) => { g.add(box(0.15, 1.6, 0.15, M.dark, x, y, z)); g.add(box(0.9, 0.15, 0.15, M.dark, x, y + 1, z)); };
  cross(0, H + 11.1, 0);
  // Портал на торце к улице.
  const p = new THREE.Group();
  p.add(box(3.6, 5.5, 0.8, tuff, 0, 0, 0));
  p.add(halfDisc(1.8, 0.8, tuff).translateY(5.5));
  p.add(box(2.2, 3.6, 0.2, M.dark, 0, 0, 0.35));
  p.add(halfDisc(1.1, 0.2, M.dark).translateY(3.6).translateZ(0.35));
  p.position.x = s * (L / 2 + 0.4);
  p.rotation.y = s * Math.PI / 2;
  g.add(p);
  for (const e of [s, -s]) for (const z of [-W * 0.3, W * 0.3]) for (const y of [2, 5.5]) g.add(box(0.2, 2, 0.6, M.glass, e * (L / 2 + 0.05), y, z * 0.6));
  // Звонница: два столба с перемычками и аркой, впереди слева от входа.
  const bx = s * (L / 2 + 12), bz = -W * 0.9;
  for (const z of [-1.3, 1.3]) g.add(box(1.4, 18, 1.4, tuff, bx, 0, bz + z));
  for (const y of [7, 12.5, 17.2]) g.add(box(1.6, 0.8, 4, tuff, bx, y, bz));
  cross(bx, 18, bz);
  return mergeByMaterial(g);
}

// Фигура человека ростом ~2 м (на постамент — масштабом): ноги, длинный сюртук, руки, голова;
// hat — цилиндр, seated — сидит на кубе, колени вперёд, armsUp — руки вскинуты вверх. Лицом в +z.
function figure(mat, { hat = false, seated = false, armsUp = false } = {}) {
  const g = new THREE.Group();
  // Высоты: низ сюртука, плечи (верх торса), центр головы; у сидящего — от сиденья высотой 0.55.
  const [coat, top, head] = seated ? [0.55, 1.45, 1.6] : [0.55, 1.9, 2.07];
  if (seated) {
    g.add(box(0.8, 0.55, 0.7, mat, 0, 0, -0.1));
    for (const x of [-0.14, 0.14]) {
      g.add(box(0.17, 0.17, 0.55, mat, x, 0.45, 0.3));
      g.add(box(0.15, 0.55, 0.16, mat, x, 0, 0.55));
    }
  } else {
    for (const x of [-0.13, 0.13]) g.add(cyl(0.09, 0.9, mat, x, 0, 0, 8));
  }
  g.add(cyl(seated ? 0.36 : 0.32, top - coat - 0.5, mat, 0, coat, 0, 10, 0.24)); // полы сюртука
  g.add(cyl(0.24, 0.5, mat, 0, top - 0.5, 0, 10, 0.22));
  g.add(mesh(new THREE.SphereGeometry(0.13, 10, 8), mat, 0, head, 0));
  for (const x of [-0.3, 0.3]) {
    const arm = box(0.11, 0.65, 0.11, mat, 0, 0, 0);
    arm.position.set(armsUp ? x * 1.3 : x, armsUp ? top + 0.29 : top - 0.35, seated ? 0.12 : 0); // вскинутая — от плеча вверх и в сторону
    arm.rotation.x = seated ? -0.6 : 0;
    arm.rotation.z = Math.sign(x) * (armsUp ? -0.45 : 0.12);
    g.add(arm);
  }
  if (hat) {
    g.add(cyl(0.2, 0.03, mat, 0, head + 0.1, 0, 12));
    g.add(cyl(0.13, 0.28, mat, 0, head + 0.13, 0, 12, 0.14));
  }
  return g;
}

// Памятник ижевским оружейникам (набережная пруда; по фото): две бронзовые фигуры в цилиндрах —
// стоящий мастер и сидящий рядом — на круглом ступенчатом постаменте из красного гранита с золотыми
// табличками и надписью «ИЖЕВСКИЕ ОРУЖЕЙНИКИ». Лицом в +z (от пруда).
function gunsmiths() {
  const g = new THREE.Group();
  g.add(cyl(5, 1.4, M.redGranite, 0, -1, 0, 32));
  g.add(cyl(3.9, 0.5, M.redGranite, 0, 0.4, 0, 32));
  g.add(mesh(new THREE.CylinderGeometry(3.92, 3.92, 0.3, 32, 1, true), doubleSided(M.gold), 0, 0.65, 0));
  g.add(cyl(2.7, 1.0, M.redGranite, 0, 0.9, 0, 32));
  const a = figure(M.bronze, { hat: true }), b = figure(M.bronze, { hat: true, seated: true });
  a.scale.setScalar(1.9);
  b.scale.setScalar(1.9);
  a.position.set(-0.9, 1.9, -0.3);
  b.position.set(0.8, 1.9, 0.1);
  g.add(a, b);
  const merged = mergeByMaterial(g);
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 96;
  const cx = c.getContext('2d');
  cx.fillStyle = '#8c4a3e';
  cx.fillRect(0, 0, 2048, 96);
  cx.fillStyle = '#f1ece2';
  cx.font = 'bold 64px serif';
  cx.textAlign = 'center';
  cx.textBaseline = 'middle';
  cx.fillText('ИЖЕВСКИЕ ОРУЖЕЙНИКИ', 1024, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  merged.add(mesh(new THREE.CylinderGeometry(2.72, 2.72, 0.6, 48, 1, true, Math.PI), new THREE.MeshLambertMaterial({ map: t }), 0, 1.4, 0)); // с π — середина текстуры на +z
  return merged;
}

// Памятник С. М. Кирову в аллее парка Кирова (по фото): серебристая фигура в длинной куртке, руки на поясе,
// на высоком сером прямоугольном постаменте с тёмной табличкой и клумбой вокруг. Лицом в +z.
function kirovStatue() {
  const g = new THREE.Group();
  g.add(box(6, 0.3, 6, M.stone, 0, -0.1, 0));
  g.add(box(5.4, 0.25, 5.4, M.green, 0, 0.2, 0));
  g.add(box(2.4, 1, 2.4, M.stone, 0, -1, 0));
  g.add(box(1.9, 4.6, 1.9, M.stone, 0, 0, 0));
  g.add(box(2.1, 0.3, 2.1, M.stone, 0, 4.6, 0));
  g.add(box(0.9, 0.5, 0.05, M.dark, 0, 3.4, 0.96));
  const f = figure(M.silver);
  f.scale.setScalar(2.1);
  f.position.y = 4.9;
  g.add(f);
  return mergeByMaterial(g);
}

// Памятник Ю. А. Гагарину у «Аксиона» (Горького; по фото): бронзовая фигура со вскинутыми руками
// на глобусе, опоясанном орбитой, на гранёной пирамиде из тёмного гранита. Лицом в +z.
function gagarinStatue() {
  const g = new THREE.Group();
  g.add(box(7, 0.3, 7, M.stone, 0, -0.1, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.7, 2.2, 3.4, 4).rotateY(Math.PI / 4), M.granite, 0, 1.9, 0));
  g.add(mesh(new THREE.SphereGeometry(1, 16, 12), M.bronze, 0, 4.4, 0));
  const orbit = mesh(new THREE.TorusGeometry(1.45, 0.07, 6, 28), M.bronze, 0, 4.4, 0);
  orbit.rotation.set(1.2, 0, 0.35);
  g.add(orbit);
  const f = figure(M.bronze, { armsUp: true });
  f.scale.setScalar(1.6);
  f.position.y = 5.3;
  g.add(f);
  return mergeByMaterial(g);
}

// Паровоз Эр 796-28 на постаменте (по фото): чёрный котёл с дымовой трубой и сухопарником, будка
// машиниста, тендер, красная рама и пять пар красных ведущих колёс, красный буферный брус; стоит
// на отрезке пути. Вдоль локальной x, дымовая труба — к +x.
function steamLoco() {
  const g = new THREE.Group(), L = 21;
  for (let x = -L / 2; x <= L / 2; x += 0.9) g.add(box(0.25, 0.2, 2.6, M.bronze, x, -0.2, 0)); // шпалы
  for (const z of [-0.76, 0.76]) g.add(box(L + 1, 0.15, 0.08, M.tin, 0, 0, z));
  g.add(box(13, 0.5, 2.2, M.signalRed, 2.5, 1.1, 0)); // рама
  for (let i = 0; i < 5; i++) for (const z of [-0.85, 0.85]) {
    g.add(mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.14, 16).rotateX(Math.PI / 2), M.signalRed, -0.6 + i * 1.6, 0.81, z));
  }
  const boiler = mesh(new THREE.CylinderGeometry(0.95, 0.95, 9.5, 20).rotateZ(Math.PI / 2), M.dark, 4.4, 2.6, 0);
  g.add(boiler);
  g.add(mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.4, 20).rotateZ(Math.PI / 2), M.dark, 9.1, 2.6, 0));
  g.add(cyl(0.32, 1.2, M.dark, 8.2, 3.4, 0, 12));
  g.add(cyl(0.45, 0.8, M.dark, 4.5, 3.4, 0, 12));
  g.add(cyl(0.35, 0.6, M.dark, 2.4, 3.4, 0, 12));
  g.add(box(0.3, 0.5, 2.6, M.signalRed, 9.55, 1.0, 0));
  g.add(box(3, 3, 2.9, M.dark, -1.8, 1.5, 0)); // будка
  g.add(box(3.4, 0.25, 3.1, M.dark, -1.8, 4.5, 0));
  for (const z of [-1.46, 1.46]) g.add(box(1, 0.9, 0.05, M.glass, -1.6, 3.2, z));
  g.add(box(7, 2.6, 2.8, M.dark, -7.2, 1.3, 0)); // тендер
  g.add(box(7.4, 0.35, 2.4, M.signalRed, -7.2, 0.95, 0));
  for (let i = 0; i < 4; i++) for (const z of [-0.85, 0.85]) {
    g.add(mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.14, 14).rotateX(Math.PI / 2), M.signalRed, -9.6 + i * 1.6, 0.6, z));
  }
  return mergeByMaterial(g);
}

// Памятник основателю завода А. Ф. Дерябину на набережной (по фото): бронзовый бюст на высоком белом
// постаменте с бронзовыми досками, под ним — три ступени чёрного гранита, по бокам — чугунные фонари
// на три плафона. Лицом в +z (от пруда).
function deryabinBust() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) g.add(box(4.6 - i * 0.9, 0.35, 4.6 - i * 0.9, M.dark, 0, -0.35 + i * 0.35, 0));
  g.add(box(1.7, 0.5, 1.7, M.white, 0, 0.7, 0));
  g.add(box(1.3, 2.4, 1.3, M.white, 0, 1.2, 0));
  g.add(box(1.55, 0.3, 1.55, M.white, 0, 3.6, 0));
  for (const [x, z, ry] of [[0, 0.66, 0], [0.66, 0, Math.PI / 2], [-0.66, 0, Math.PI / 2]]) {
    const d = box(0.6, 1.2, 0.04, M.bronze, x, 1.8, z);
    d.rotation.y = ry;
    g.add(d);
  }
  g.add(box(0.5, 0.35, 0.5, M.bronze, 0, 3.9, 0));
  g.add(cyl(0.45, 0.55, M.bronze, 0, 4.25, 0, 8, 0.3)); // плечи
  g.add(mesh(new THREE.SphereGeometry(0.26, 8, 6), M.bronze, 0, 5.05, 0));
  for (const x of [-3.2, 3.2]) {
    g.add(cyl(0.12, 4, M.dark, x, 0, 0.6, 6));
    g.add(box(1.4, 0.08, 0.08, M.dark, x, 3.6, 0.6)); // перекладина — вдоль берега, как ряд фонарей
    for (const dx of [-0.65, 0, 0.65]) g.add(box(0.28, 0.42, 0.28, M.cream, x + dx, dx ? 3.7 : 4, 0.6));
  }
  return mergeByMaterial(g);
}

// Памятник Кузебаю Герду у Коммунаров (по фото): тёмная бронзовая фигура поэта сидит на камне
// на низкой круглой белой площадке с полукруглыми ступенями. Лицом в +z.
function gerdStatue() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) g.add(cyl(4.6 - i * 0.5, 0.25, M.concrete, 0, -0.25 + i * 0.25, 0.6, 16));
  g.add(cyl(2.6, 0.9, M.white, 0, 0.5, 0, 16));
  g.add(box(1.6, 0.5, 0.05, M.dark, 0, 0.7, 2.6));
  g.add(box(0.8, 0.6, 0.7, M.redGranite, -0.7, 1.4, 0));
  const f = figure(M.slateDark, { seated: true });
  f.scale.setScalar(1.35);
  f.position.set(0.2, 1.4, 0);
  g.add(f);
  return mergeByMaterial(g);
}

function plantTower() {
  const g = new THREE.Group();
  const pink = M.pink, white = M.white;
  // Корпус завода под башней.
  g.add(box(16, 15, 14, pink, 0, -3, 0));
  g.add(box(16.6, 0.6, 14.6, white, 0, 11.4, 0));
  const roof = mesh(new THREE.CylinderGeometry(0.01, 10.6, 4, 4, 1).rotateY(Math.PI / 4).scale(1, 1, 0.88), M.silver, 0, 14, 0);
  roof.position.y = 12 + 2;
  g.add(roof);
  const y0 = 13.5, R = 4.2;
  // Ярус с арками: белый барабан, 8 розовых пилонов, тёмные арочные проёмы между ними.
  g.add(cyl(R + 0.3, 0.6, white, 0, y0 - 0.6, 0, 24));
  g.add(cyl(R, 7, white, 0, y0, 0, 24));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, ap = a + Math.PI / 8;
    const pil = box(1.3, 6.2, 0.5, pink, Math.cos(a) * (R + 0.1), y0, Math.sin(a) * (R + 0.1));
    pil.rotation.y = -a + Math.PI / 2;
    g.add(pil);
    const op = box(1.4, 3.6, 0.4, M.dark, Math.cos(ap) * (R + 0.05), y0 + 1.6, Math.sin(ap) * (R + 0.05));
    op.rotation.y = -ap + Math.PI / 2;
    g.add(op);
    const arch = mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.4, 12, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), M.dark, 0, 0, 0);
    arch.position.set(Math.cos(ap) * (R + 0.05), y0 + 5.2, Math.sin(ap) * (R + 0.05));
    arch.rotation.y = -ap + Math.PI / 2;
    g.add(arch);
  }
  // Карниз, первый барабан, розовый пологий выступ, второй барабан.
  g.add(cyl(R + 0.5, 0.7, white, 0, y0 + 7, 0, 24));
  g.add(cyl(R - 0.3, 3.4, white, 0, y0 + 7.7, 0, 24));
  g.add(mesh(new THREE.CylinderGeometry(R - 0.5, R + 0.3, 0.7, 24), pink, 0, y0 + 11.45, 0));
  g.add(cyl(R - 0.5, 3, white, 0, y0 + 11.8, 0, 24));
  g.add(cyl(R - 0.3, 0.4, M.stone, 0, y0 + 14.8, 0, 24));
  // Золотой венец: кольцо и зубцы-трофеи по кругу.
  const yc = y0 + 15.2;
  g.add(cyl(R - 0.4, 1.4, M.gold, 0, yc, 0, 24));
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2, h = i % 2 ? 1.4 : 2.4;
    const sp = mesh(new THREE.ConeGeometry(0.35, h, 4), M.gold, Math.cos(a) * (R - 0.4), yc + 1.4 + h / 2, Math.sin(a) * (R - 0.4));
    g.add(sp);
  }
  // Столп, капитель, шар в клетке, игла.
  const yp = yc + 1.4;
  g.add(mesh(new THREE.CylinderGeometry(0.85, 1.0, 10, 14), M.concrete, 0, yp + 5, 0));
  g.add(cyl(1.35, 0.7, M.dark, 0, yp + 10, 0, 16));
  const yb = yp + 10.7;
  g.add(mesh(new THREE.SphereGeometry(0.6, 14, 10), M.gold, 0, yb + 0.7, 0));
  for (const [dx, dz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) g.add(box(0.06, 1.6, 0.06, M.dark, dx * 0.9, yb, dz * 0.9));
  for (const y of [yb + 0.05, yb + 1.55]) {
    for (const [w, d] of [[1.86, 0.06], [0.06, 1.86]]) for (const o of [-0.9, 0.9]) g.add(box(w, 0.06, d, M.dark, w > 1 ? 0 : o, y, w > 1 ? o : 0));
  }
  g.add(mesh(new THREE.ConeGeometry(0.05, 5, 4), M.dark, 0, yb + 1.6 + 2.5, 0));
  return g;
}

// Вечный огонь: гранитная звезда и живое пламя.
function eternalFlame() {
  const g = new THREE.Group();
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? 1.6 : 3.8;
    star[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
  }
  const starGeo = new THREE.ExtrudeGeometry(star, { depth: 0.6, bevelEnabled: false }).rotateX(-Math.PI / 2);
  g.add(mesh(new THREE.CylinderGeometry(5, 5.4, 0.8, 32), M.granite, 0, -0.4, 0));
  g.add(mesh(starGeo, lambert('#7a2a24'), 0, 0.4, 0));
  const flameMat = new THREE.MeshBasicMaterial({ color: '#ffb02e', transparent: true, opacity: 0.85, depthWrite: false });
  const flames = [];
  for (let i = 0; i < 5; i++) {
    const f = mesh(new THREE.ConeGeometry(0.35 - i * 0.04, 1.6, 8), flameMat, (Math.random() - 0.5) * 0.4, 1.8, (Math.random() - 0.5) * 0.4);
    f.castShadow = false;
    flames.push(f);
    g.add(f);
  }
  g.userData.update = (t) => {
    flames.forEach((f, i) => {
      const k = 0.8 + 0.35 * Math.sin(t * (9 + i * 2.3) + i);
      f.scale.set(1, k, 1);
      f.position.y = 1.0 + 0.8 * k;
    });
  };
  return g;
}

// Колесо обозрения: А-образные опоры, два обода со спицами, кабинки, которые
// всегда висят вертикально. Плоскость колеса — локальная XY.
function ferrisWheel(h = 50) {
  const g = new THREE.Group();
  const R = h / 2 - 2.5, cy = R + 3.5;
  const steel = lambert('#e9ecef');
  const red = lambert('#d23c32');
  // Опоры: по две ноги с каждой стороны оси.
  for (const side of [-1, 1]) {
    for (const lean of [-1, 1]) {
      const len = Math.hypot(cy, R * 0.55);
      const leg = mesh(new THREE.CylinderGeometry(0.35, 0.5, len, 8), steel, lean * R * 0.275, cy / 2, side * 3.2);
      leg.rotation.z = lean * Math.atan2(R * 0.55, cy);
      g.add(leg);
    }
    g.add(box(R * 0.6, 0.5, 0.5, steel, 0, 6, side * 3.2));
  }
  const axle = mesh(new THREE.CylinderGeometry(0.6, 0.6, 7, 12).rotateX(Math.PI / 2), M.dark, 0, cy, 0);
  g.add(axle);
  g.add(box(4, 3, 4, lambert('#8b8f94'), 0, -0.5, 0)); // будка оператора/фундамент

  const rotor = new THREE.Group();
  rotor.position.set(0, cy, 0);
  g.add(rotor);
  for (const z of [-1.2, 1.2]) {
    rotor.add(mesh(new THREE.TorusGeometry(R, 0.22, 6, 72), red, 0, 0, z));
    rotor.add(mesh(new THREE.TorusGeometry(R * 0.55, 0.12, 6, 48), steel, 0, 0, z));
  }
  const N = 24;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    for (const z of [-1.2, 1.2]) {
      const spoke = mesh(new THREE.CylinderGeometry(0.07, 0.07, R, 4), steel, Math.cos(a) * R / 2, Math.sin(a) * R / 2, z);
      spoke.rotation.z = a - Math.PI / 2;
      rotor.add(spoke);
    }
  }
  flatten(rotor); // 52 меша — в два (по материалу), крутится целиком
  // Кабинки — не дети ротора: позицию считаем сами, чтобы они не переворачивались. Четыре части кабинки —
  // по InstancedMesh на все 24 (цвет кузова — у инстанса), иначе 96 вызовов отрисовки.
  const colors = ['#e6493c', '#f2b632', '#3b8fd9', '#45b36b', '#9b59b6', '#f07f2e'];
  const cabins = [
    [new THREE.BoxGeometry(0.12, 1.2, 0.12).translate(0, -1.2, 0), M.dark],
    [new THREE.BoxGeometry(1.8, 1.9, 1.8).translate(0, -3.1, 0), lambert('#ffffff')],
    [new THREE.BoxGeometry(1.82, 0.9, 1.82).translate(0, -2.1, 0), lambert('#bcd3e2')], // остекление
    [new THREE.BoxGeometry(2, 0.15, 2).translate(0, -1.25, 0), M.white],
  ].map(([geo, mat]) => {
    const m = new THREE.InstancedMesh(geo, mat, N);
    m.castShadow = m.receiveShadow = true;
    m.frustumCulled = false; // кабинки двигаются; дальние модели прячет buildLandmarks
    g.add(m);
    return m;
  });
  const c = new THREE.Color();
  for (let i = 0; i < N; i++) cabins[1].setColorAt(i, c.set(colors[i % colors.length]));
  const mx = new THREE.Matrix4();
  g.userData.update = (t) => {
    const phase = t * 0.06; // полный оборот примерно за 105 секунд
    rotor.rotation.z = phase;
    for (let i = 0; i < N; i++) {
      const a = phase + (i / N) * Math.PI * 2;
      mx.makeTranslation(Math.cos(a) * R, cy + Math.sin(a) * R, 0);
      for (const m of cabins) m.setMatrixAt(i, mx);
    }
    for (const m of cabins) m.instanceMatrix.needsUpdate = true;
  };
  g.userData.update(0);
  return g;
}

// Флаг Удмуртии: чёрный, белый, красный; в белой полосе красный солярный знак.
function udmurtFlag() {
  const c = document.createElement('canvas');
  c.width = 192; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#111'; g.fillRect(0, 0, 64, 128);
  g.fillStyle = '#fff'; g.fillRect(64, 0, 64, 128);
  g.fillStyle = '#d52b1e'; g.fillRect(128, 0, 64, 128);
  g.strokeStyle = '#d52b1e';
  g.lineWidth = 6;
  g.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 4;
    g.beginPath();
    g.moveTo(96 - Math.cos(a) * 24, 64 - Math.sin(a) * 24);
    g.lineTo(96 + Math.cos(a) * 24, 64 + Math.sin(a) * 24);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const grp = new THREE.Group();
  grp.add(cyl(0.12, 12, M.white, 0, 0, 0, 8));
  const flagGeo = new THREE.PlaneGeometry(4.5, 3, 12, 1).translate(2.25, 0, 0);
  const flag = mesh(flagGeo, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }), 0.12, 10.4, 0);
  grp.add(flag);
  const base = flagGeo.attributes.position.array.slice();
  grp.userData.update = (t) => {
    const pos = flagGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3];
      pos.setZ(i, Math.sin(x * 1.3 - t * 5) * 0.25 * (x / 4.5));
    }
    pos.needsUpdate = true;
  };
  return grp;
}

// ---------------------------------------------------------------- сборка

// Направление от достопримечательности на ближайшую точку улицы с именем re; нет улицы — (fx, fz).
// ---------------------------------------------------------------- парадная лестница

// Чугунное ограждение: решётка с розетками на прозрачном фоне, 1,2 м на текстуру (alphaTest — сливается в общий меш).
let railMat = null;
function railMaterial() {
  if (railMat) return railMat;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 96;
  const g = c.getContext('2d');
  g.strokeStyle = '#1e2325';
  g.lineWidth = 5;
  g.strokeRect(2.5, 2.5, 123, 91);
  g.lineWidth = 3;
  for (const x of [32, 96]) { g.beginPath(); g.arc(x, 48, 22, 0, Math.PI * 2); g.stroke(); }
  for (const x of [32, 96]) { g.beginPath(); g.arc(x, 48, 9, 0, Math.PI * 2); g.stroke(); }
  g.beginPath();
  for (const x of [0, 64, 128]) { g.moveTo(x, 4); g.lineTo(x, 92); }
  for (const x of [32, 96]) { g.moveTo(x, 4); g.lineTo(x, 26); g.moveTo(x, 70); g.lineTo(x, 92); }
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  railMat = new THREE.MeshLambertMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide });
  return railMat;
}

// Клумба-узор на газоне у лестницы (по фото): кайма из белого камня, по зелени — ромбы из красных цветов с жёлтой
// серединой, между ними круги из лиловых, вдоль — волна из белых. Текстура на всю клумбу (u — вдоль, LEN м).
let bedMat = null;
const BED_LEN = 36, BED_W = 4.5;
function flowerBedMaterial() {
  if (bedMat) return bedMat;
  const W = 1024, H = Math.round((W * BED_W) / BED_LEN), c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#4f7d34';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 3000; i++) { // трава неровная
    g.fillStyle = rnd() < 0.5 ? '#5a8a3b' : '#44702c';
    g.fillRect(rnd() * W, rnd() * H, 2, 2);
  }
  // Цветы — фигура path цветом colors[0] и мелкие точки остальных внутри (clip): издали узор, вблизи — цветник.
  const flowers = (path, colors, n) => {
    g.save();
    path();
    g.clip();
    g.fillStyle = colors[0];
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < n; i++) {
      g.fillStyle = colors[Math.floor(rnd() * colors.length)];
      g.beginPath();
      g.arc(rnd() * W, rnd() * H, 1.4 + rnd() * 1.2, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  };
  const step = W / 6, m = H / 2, r = H * 0.36;
  for (let i = 0; i < 6; i++) {
    const x = step * (i + 0.5);
    const diamond = (k) => () => { g.beginPath(); g.moveTo(x - r * 1.5 * k, m); g.lineTo(x, m - r * k); g.lineTo(x + r * 1.5 * k, m); g.lineTo(x, m + r * k); g.closePath(); };
    flowers(diamond(1), ['#c8202a', '#e0303a', '#a3151f'], 2600);
    flowers(diamond(0.4), ['#f4c430', '#ffd84a'], 600);
    for (const dx of [-step / 2, step / 2]) {
      if (x + dx < 0 || x + dx > W) continue;
      flowers(() => { g.beginPath(); g.arc(x + dx, m, r * 0.55, 0, Math.PI * 2); }, ['#8a4fc0', '#a56ad6', '#6f3aa0'], 700);
    }
  }
  flowers(() => {
    g.beginPath();
    for (let x = 0; x <= W; x += 4) g.lineTo(x, m + Math.sin((x / step) * Math.PI * 2) * r * 1.15 - 3);
    for (let x = W; x >= 0; x -= 4) g.lineTo(x, m + Math.sin((x / step) * Math.PI * 2) * r * 1.15 + 3);
    g.closePath();
  }, ['#f4f1e6', '#fff'], 1500);
  g.strokeStyle = '#e8e4d8';
  g.lineWidth = 5;
  g.strokeRect(2.5, 2.5, W - 5, H - 5);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  bedMat = new THREE.MeshLambertMaterial({ map: t, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  return bedMat;
}

// Клумба s0…s1 × v0…v1 в системе лестницы — сетка по рельефу через ~1 м, чуть над землёй.
function flowerBed(world, lay, s0, s1, v0, v1) {
  const ns = Math.max(2, Math.ceil(s1 - s0)), nv = 4, pos = [], uv = [], idx = [];
  for (let i = 0; i <= ns; i++) {
    for (let j = 0; j <= nv; j++) {
      const sv = s0 + ((s1 - s0) * i) / ns, vv = v0 + ((v1 - v0) * j) / nv;
      pos.push(sv, world.terrain(...lay.at(sv, vv)) + 0.06, vv);
      uv.push(((s1 - s0) * i) / ns / BED_LEN, j / nv);
    }
  }
  const row = nv + 1, flip = v1 < v0; // с другой стороны лестницы — обход наоборот, иначе грани вниз
  for (let i = 0; i < ns; i++) {
    for (let j = 0; j < nv; j++) {
      const a = i * row + j, b = a + row, c = b + 1, d = a + 1;
      idx.push(...(flip ? [a, b, c, a, c, d] : [a, c, b, a, d, c]));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = mesh(geo, flowerBedMaterial());
  m.castShadow = false;
  return m;
}

// Брусок в системе лестницы (x — вдоль оси s, z — поперёк v): s0…s1 × v0…v1, верх линейно от top0 до top1, низ —
// bot или [низ у s0, низ у s1] (поручень на марше — наклонный и снизу).
function slab(s0, s1, v0, v1, top0, top1, bot, mat) {
  const [b0, b1] = Array.isArray(bot) ? bot : [bot, bot];
  if (v0 > v1) [v0, v1] = [v1, v0]; // иначе брусок наизнанку: видна внутренняя грань, она мерцает со ступенями
  const P = [[s0, b0, v0], [s1, b1, v0], [s1, b1, v1], [s0, b0, v1], [s0, top0, v0], [s1, top1, v0], [s1, top1, v1], [s0, top0, v1]];
  const pos = [];
  for (const [a, b, c, d] of [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]]) {
    pos.push(...P[a], ...P[b], ...P[c], ...P[a], ...P[c], ...P[d]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return mesh(geo, mat);
}

// Парадная лестница к Свято-Михайловскому собору (по фото): внизу широкий марш между гранитными тумбами,
// площадка, выше — марши с площадками между гранитными бортами, на бортах чугунное ограждение с фонарями.
// Раскладка и плита, по которой едут, — walks.js (grandLayout); здесь меш и стенки ограждения. Ступени и борта
// уходят под землю до самой низкой точки рельефа под ними — на склоне не висят.
function grandStairs(world, lay) {
  const g = new THREE.Group(), { pieces, r, t } = lay;
  const low = (s0, s1, v0, v1) => Math.min(...[[s0, v0], [s1, v0], [s0, v1], [s1, v1]].map(([s, v]) => world.terrain(...lay.at(s, v)))) - 0.4;
  const CH = 0.45, CT = 0.3, RH = 0.95; // борт: толщина, выше ступеней; ограждение: высота
  // Фонарь на y; ночью — ореол у стекла и пятно света на ступенях (floor — их высота у фонаря).
  const glow = new GlowBuilder();
  const lantern = (s, v, y, floor = y) => {
    g.add(cyl(0.16, 0.45, M.iron, s, y, v, 8));
    g.add(cyl(0.06, 2.9, M.iron, s, y, v, 6));
    g.add(box(0.3, 0.42, 0.3, M.lantern, s, y + 2.9, v));
    g.add(cone(0.27, 0.22, M.iron, s, y + 3.32, v, 4));
    glow.halo(s, y + 3.11, v, 1.2, '#ffcf87');
    glow.pool(s, floor + 0.04, v, 4.5, '#8a6a3c');
  };
  const top = (pc, s) => (pc.n ? pc.y0 + r + ((pc.y1 - pc.y0 - r) * (s - pc.s0)) / (pc.s1 - pc.s0) : pc.y0) + CT;
  pieces.forEach((pc, k) => {
    const h = pc.w / 2;
    if (pc.n) {
      for (let i = 1; i <= pc.n; i++) {
        const a = pc.s0 + (i - 1) * t, b = i === pc.n ? pc.s1 : a + t;
        g.add(slab(a, b, -h, h, pc.y0 + i * r, pc.y0 + i * r, low(a, b, -h, h), M.stair));
      }
    } else g.add(slab(pc.s0, pc.s1, -h, h, pc.y0, pc.y0, low(pc.s0, pc.s1, -h, h), M.stair));
    if (k === 0) {
      // Нижний марш — между тумбами вровень с площадкой над ним, на тумбах — фонари.
      const y = pieces[1].y0 + 0.5;
      for (const sg of [-1, 1]) {
        const v0 = sg * h, v1 = sg * (h + 1.1);
        g.add(slab(pc.s0 - 0.4, pc.s1 + 0.6, v0, v1, y, y, low(pc.s0 - 0.4, pc.s1 + 0.6, v0, v1), M.redGranite));
        lantern(pc.s0 + 0.2, sg * (h + 0.55), y, pc.y0);
        const q = [[pc.s0 - 0.4, v0], [pc.s1 + 0.6, v0], [pc.s1 + 0.6, v1], [pc.s0 - 0.4, v1]].map(([s, v]) => lay.at(s, v));
        world.addCollider(q, [], y);
      }
      return;
    }
    // Борта — красный гранит; выше нижней площадки на них ограждение, у начала каждого куска — фонарь.
    for (const sg of [-1, 1]) {
      const v0 = sg * h, v1 = sg * (h + CH), vm = sg * (h + CH / 2);
      const t0 = top(pc, pc.s0), t1 = top(pc, pc.s1);
      g.add(slab(pc.s0, pc.s1, v0, v1, t0, t1, low(pc.s0, pc.s1, v0, v1), M.redGranite));
      if (k === 1) continue;
      const panel = new THREE.BufferGeometry(), len = pc.s1 - pc.s0, u1 = len / 1.2;
      panel.setAttribute('position', new THREE.Float32BufferAttribute([pc.s0, t0, vm, pc.s1, t1, vm, pc.s1, t1 + RH, vm, pc.s0, t0 + RH, vm], 3));
      panel.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, sg, 0, 0, sg, 0, 0, sg, 0, 0, sg], 3));
      panel.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, u1, 0, u1, 1, 0, 1], 2));
      panel.setIndex([0, 1, 2, 0, 2, 3]);
      const pm = mesh(panel, railMaterial());
      pm.castShadow = false; // тень решётки была бы сплошной плитой
      g.add(pm);
      g.add(slab(pc.s0, pc.s1, vm - 0.05, vm + 0.05, t0 + RH, t1 + RH, [t0 + RH - 0.06, t1 + RH - 0.06], M.iron)); // поручень
      const posts = Math.max(1, Math.round(len / 2.5));
      for (let j = 0; j < posts; j++) {
        const s = pc.s0 + (j * len) / posts;
        g.add(box(0.1, RH, 0.1, M.iron, s, top(pc, s), vm));
      }
      lantern(pc.s0, vm, t0, pc.y0);
      // Сквозь ограждение не проехать (сверху, в прыжке, — можно).
      const q = [[pc.s0, v0], [pc.s1, v0], [pc.s1, v1], [pc.s0, v1]].map(([s, v]) => lay.at(s, v));
      world.addCollider(q, [], Math.max(t0, t1) + RH);
    }
  });
  const last = pieces[pieces.length - 1];
  for (const sg of [-1, 1]) lantern(last.s1, sg * (last.w / 2 + CH / 2), top(last, last.s1), last.y1);
  const gm = new THREE.Mesh(glow.build(), glowMaterial());
  gm.geometry.boundingSphere.set(new THREE.Vector3(lay.L / 2, (lay.y0 + lay.y1) / 2, 0), lay.L / 2 + 10);
  gm.castShadow = gm.receiveShadow = false;
  g.add(gm);
  // Клумбы на газонах по бокам — от площадки над нижним маршем до верха.
  const b0 = pieces[1] ? pieces[1].s1 + 0.5 : 0, b1 = last.s1 - 1, in0 = lay.w / 2 + CH + 1.2;
  if (b1 - b0 > 6) for (const sg of [-1, 1]) g.add(flowerBed(world, lay, b0, b1, sg * in0, sg * (in0 + BED_W)));
  return place(g, lay.ax, 0, lay.az, Math.atan2(lay.uz, lay.ux));
}

// ---------------------------------------------------------------- ЖК «Республика»
// Карла Маркса, 259 (готовые башни) и 233 («Республика 2», стройка); по фото и рендерам застройщика.
// Окна — canvas-текстуры на развёртке стен: сотни окон геометрией дали бы десятки тысяч треугольников.

const FLOOR = 3.1, GROUND = 3.6; // типовой этаж и первый (магазины)

function seeded(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}
// data — карта блеска (числа, не цвет); repeat — плитка повторяется по стене.
function canvasTex(c, { data = false, repeat = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = 8; // three.js сам урежет до возможностей видеокарты
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const mixColor = (a, b, t) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), Math.max(0, Math.min(1, t))).getHexString();

// Стеклянный фасад: specularMap — где блестит, emissiveMap — окна, горящие ночью (днём не светятся).
function facadeMaterial(map, specularMap, glow, shininess = 80) {
  const m = new THREE.MeshPhongMaterial({ map, specularMap, specular: '#ffffff', shininess });
  if (!glow) return m;
  m.emissiveMap = glow;
  m.emissive = new THREE.Color('#ffffff');
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = NIGHT;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= uNight;');
  };
  return m;
}

// Обход контура, при котором грани wallGeo смотрят наружу (знак площади — как в contourEdges).
function outward(pl) {
  let a = 0;
  for (let i = 0; i < pl.length; i++) a += pl[i][0] * pl[(i + 1) % pl.length][1] - pl[(i + 1) % pl.length][0] * pl[i][1];
  return a > 0 ? [...pl].reverse() : pl;
}
const perim = (q) => q.reduce((s, p, i) => s + Math.hypot(q[(i + 1) % q.length][0] - p[0], q[(i + 1) % q.length][1] - p[1]), 0);

// Стены по контуру (обход — outward) с развёрткой: u = метры вдоль контура × su, v = метры вверх × sv.
// smooth — общая нормаль в вершине (круглая башня), иначе у каждой стены своя.
function wallGeo(q, h, su, sv, smooth = false) {
  const n = q.length, pos = [], nor = [], uv = [];
  const en = q.map((p, i) => {
    const r = q[(i + 1) % n], L = Math.hypot(r[0] - p[0], r[1] - p[1]) || 1;
    return [-(r[1] - p[1]) / L, (r[0] - p[0]) / L];
  });
  const vn = q.map((_, i) => {
    const a = en[(i - 1 + n) % n], b = en[i], L = Math.hypot(a[0] + b[0], a[1] + b[1]) || 1;
    return [(a[0] + b[0]) / L, (a[1] + b[1]) / L];
  });
  let s = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, [x1, z1] = q[i], [x2, z2] = q[j], L = Math.hypot(x2 - x1, z2 - z1);
    const n1 = smooth ? vn[i] : en[i], n2 = smooth ? vn[j] : en[i];
    const A = [x1, 0, z1, n1, s * su, 0], B = [x2, 0, z2, n2, (s + L) * su, 0];
    const C = [x2, h, z2, n2, (s + L) * su, h * sv], D = [x1, h, z1, n1, s * su, h * sv];
    for (const [x, y, z, nn, u, v] of [A, B, C, A, C, D]) {
      pos.push(x, y, z);
      nor.push(nn[0], 0, nn[1]);
      uv.push(u, v);
    }
    s += L;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return geo;
}

// Скруглённый контур через вершины OSM (у башен «Республики» в OSM восьмиугольник).
function smoothContour(pl, n = 56) {
  const curve = new THREE.CatmullRomCurve3(pl.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
  return curve.getSpacedPoints(n).slice(0, n).map((v) => [v.x, v.z]);
}

// Витрины первого этажа: простенок цвета stone, стекло с фрамугой. Плитка — пролёт 4 м × этаж GROUND.
const STORE = new Map();
function storeMat(stone) {
  if (STORE.has(stone)) return STORE.get(stone);
  const [c, g] = canvas2d(64, 58);
  g.fillStyle = stone;
  g.fillRect(0, 0, 64, 58);
  const grad = g.createLinearGradient(0, 4, 0, 54);
  grad.addColorStop(0, '#5b6f80');
  grad.addColorStop(1, '#27323b');
  g.fillStyle = grad;
  g.fillRect(9, 4, 46, 50);
  g.fillStyle = '#1c2125';
  g.fillRect(9, 16, 46, 2);
  g.fillRect(31, 4, 2, 50);
  const m = new THREE.MeshLambertMaterial({ map: canvasTex(c, { repeat: true }) });
  STORE.set(stone, m);
  return m;
}

// Зеркальное стекло башен «Республики»: P столбцов по кругу (~1,4 м), ряды — этажи снизу вверх. Низ на треть
// высоты — белая облицовка с квадратными окнами, её верх рваный: группы столбцов разной высоты, одиночные выше
// («пиксели», как на фото); белые междуэтажные пояса. Тёмную вертикаль лоджий убрали — в игре читалась чёрной полосой.
function respublikaGlass(F, seed) {
  const P = 64, pw = 16, fh = 32, W = P * pw, H = F * fh, rnd = seeded(seed);
  const [c, g] = canvas2d(W, H), [cs, gs] = canvas2d(W, H), [cg, gg] = canvas2d(W, H);
  gs.fillStyle = gg.fillStyle = '#000';
  gs.fillRect(0, 0, W, H);
  gg.fillRect(0, 0, W, H);
  const white = [];
  for (let k = 0; k < P;) {
    const n = 1 + Math.floor(rnd() * 4), top = Math.round(F * (0.34 + rnd() * 0.14)) + (n === 1 ? 2 : 0);
    for (let j = 0; j < n && k < P; j++) white[k++] = top;
  }
  for (let f = 0; f < F; f++) {
    const y = H - (f + 1) * fh;
    for (let k = 0; k < P; k++) {
      const x = k * pw, lit = rnd() < 0.22;
      if (f < white[k] || (f === white[k] && rnd() < 0.15)) {
        g.fillStyle = '#eef1f1';
        g.fillRect(x, y, pw, fh);
        g.fillStyle = mixColor('#2f5277', '#7d9fc0', rnd() * 0.5);
        g.fillRect(x + 4, y + 7, pw - 8, fh - 16);
        gs.fillStyle = '#ccc';
        gs.fillRect(x + 4, y + 7, pw - 8, fh - 16);
        if (lit) {
          gg.fillStyle = '#ffd08a';
          gg.fillRect(x + 4, y + 7, pw - 8, fh - 16);
        }
      } else {
        // Отражение неба: выше светлее, панели чуть разные.
        const t = (f / F) * 0.45 + rnd() * 0.3, grad = g.createLinearGradient(0, y, 0, y + fh);
        grad.addColorStop(0, mixColor('#2a4a6c', '#86a8c8', t + 0.12));
        grad.addColorStop(1, mixColor('#2a4a6c', '#86a8c8', t - 0.08));
        g.fillStyle = grad;
        g.fillRect(x, y, pw, fh);
        g.fillStyle = '#9fb2c2';
        g.fillRect(x, y, 1, fh);
        g.fillStyle = '#e9eef0';
        g.fillRect(x, y + fh - 3, pw, 3);
        gs.fillStyle = '#e6e6e6';
        gs.fillRect(x + 1, y, pw - 1, fh - 3);
        if (lit) {
          gg.fillStyle = '#ffcf87';
          gg.fillRect(x + 1, y + 2, pw - 1, fh - 6);
        }
      }
    }
  }
  return facadeMaterial(canvasTex(c), canvasTex(cs, { data: true }), canvasTex(cg));
}

// ЖК «Республика», башня (Карла Маркса, 259; по фото): скруглённая в плане, в зеркальном синем стекле, низ —
// белая «пиксельная» облицовка (respublikaGlass). Двухэтажный цоколь из тёмного камня с витринами под белым
// карнизом, сверху белый пояс, остеклённый верхний этаж с отступом и белый венец. pl — контур в системе fit.
function respublikaTower(pl, lv, seed) {
  const g = new THREE.Group(), q = outward(smoothContour(pl)), F = Math.max(6, lv - 3);
  const y1 = 2 * GROUND, body = F * FLOOR, top = y1 + body;
  const qb = outward(offsetContour(q, 0.6));
  g.add(mesh(wallGeo(qb, y1, 1 / 4, 1 / GROUND, true), storeMat('#4f4038')));
  g.add(prism(q, y1 - 0.45, 0.4, M.white, 0.25)); // карниз над цоколем
  g.add(mesh(wallGeo(q, body, 1 / perim(q), 1 / body, true), respublikaGlass(F, seed), 0, y1, 0));
  g.add(prism(q, top, 1.5, M.white, 0.2));
  const qp = outward(offsetContour(q, 0.9));
  g.add(mesh(wallGeo(qp, 3.4, 1, 1, true), M.mirror, 0, top + 1.5, 0));
  g.add(prism(q, top + 4.9, 1.1, M.white, 0.15));
  g.add(prism(offsetContour(q, 2), top + 5.95, 0.15, M.slab));
  g.add(box(5, 2.6, 4, M.slab, 0, top + 6, 0)); // машинное помещение лифтов
  return g;
}

// Стилобат «Республики» (в OSM — мультиполигон по Карла Маркса, 259, с дырой под башню): два этажа светлого
// камня с витринами, плоская кровля-терраса, на ней оранжевый корт (на фото). pl — контур в системе fit,
// towers — центры башен в той же системе: корт — в точке кровли подальше от башен и края.
function respublikaBase(pl, towers) {
  const g = new THREE.Group(), q = outward(pl), h = 2 * GROUND;
  g.add(mesh(wallGeo(q, h, 1 / 4, 1 / GROUND), storeMat('#cfc7b9')));
  g.add(prism(q, h, 0.5, M.stone, 0.15));
  const inside = (x, z) => {
    let r = false;
    for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
      const [xi, zi] = q[i], [xj, zj] = q[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) r = !r;
    }
    return r;
  };
  let best = null;
  const xs = q.map((p) => p[0]), zs = q.map((p) => p[1]);
  for (let x = Math.min(...xs); x < Math.max(...xs); x += 2) {
    for (let z = Math.min(...zs); z < Math.max(...zs); z += 2) {
      // Корт 12 × 7: все углы на кровле, до башен (радиус ~14) не меньше 22 м.
      if (![[-6, -3.5], [6, -3.5], [6, 3.5], [-6, 3.5]].every(([dx, dz]) => inside(x + dx, z + dz))) continue;
      const d = Math.min(...towers.map(([tx, tz]) => Math.hypot(x - tx, z - tz)));
      if (d > 22 && (!best || d < best.d)) best = { x, z, d };
    }
  }
  if (best) {
    g.add(box(12, 0.06, 7, M.orange, best.x, h + 0.5, best.z));
    g.add(box(11, 0.07, 0.12, M.white, best.x, h + 0.5, best.z));
  }
  return g;
}

// Фасад башен «Республики 2»: там, где он смонтирован (fin — этажей по стенам контура q), бирюзовое стекло
// с редкими оранжевыми и жёлтыми панелями (по рендеру); выше — голый каркас: тёмные этажи, серые торцы плит, колонны.
function respublika2Facade(q, F, fin, seed) {
  const P = 64, pw = 16, fh = 32, W = P * pw, H = F * fh, rnd = seeded(seed);
  const lens = q.map((p, i) => Math.hypot(q[(i + 1) % q.length][0] - p[0], q[(i + 1) % q.length][1] - p[1]));
  const per = lens.reduce((a, b) => a + b, 0);
  const face = (k) => {
    let s = ((k + 0.5) / P) * per, i = 0;
    while (i < lens.length - 1 && s > lens[i]) s -= lens[i++];
    return i;
  };
  const [c, g] = canvas2d(W, H), [cs, gs] = canvas2d(W, H);
  gs.fillStyle = '#000';
  gs.fillRect(0, 0, W, H);
  for (let k = 0; k < P; k++) {
    const done = fin[face(k)], x = k * pw;
    for (let f = 0; f < F; f++) {
      const y = H - (f + 1) * fh;
      if (f < done || (f === done && rnd() < 0.45)) {
        const panel = rnd();
        g.fillStyle = panel < 0.04 ? '#e88a2c' : panel < 0.07 ? '#f0c44c' : mixColor('#14465c', '#3f8aa8', 0.15 + (f / F) * 0.3 + rnd() * 0.25);
        g.fillRect(x, y, pw, fh);
        g.fillStyle = '#0e2a36';
        g.fillRect(x, y, 1, fh);
        g.fillRect(x, y + fh - 2, pw, 2);
        if (panel >= 0.07) {
          gs.fillStyle = '#e0e0e0';
          gs.fillRect(x + 1, y, pw - 1, fh - 2);
        }
      } else {
        g.fillStyle = mixColor('#4a4845', '#77736c', rnd() * 0.7);
        g.fillRect(x, y, pw, fh);
        g.fillStyle = '#b9b6ad';
        g.fillRect(x, y + fh - 5, pw, 5);
        if (k % 4 === 0) g.fillRect(x, y, 3, fh);
      }
    }
  }
  return facadeMaterial(canvasTex(c), canvasTex(cs, { data: true }), null, 60);
}

// «Республика 2», башня (Карла Маркса, 233; по рендеру, ещё строится): квадратная, каркас доведён до верха,
// фасад смонтирован примерно наполовину (fin — этажей по стенам). На готовой части — светлые вертикальные
// ламели, внизу сходящиеся в острия; сверху голая плита с лифтовой шахтой, на одной стене — мачта подъёмника.
// pl — контур в системе fit.
function respublika2Tower(pl, lv, fin, seed) {
  const g = new THREE.Group(), q = outward(pl), F = Math.max(6, lv - 2), y1 = 2 * GROUND, top = y1 + F * FLOOR;
  g.add(mesh(wallGeo(q, y1, 1 / 4, 1 / GROUND), storeMat('#3a3633')));
  g.add(mesh(wallGeo(q, F * FLOOR, 1 / perim(q), 1 / (F * FLOOR)), respublika2Facade(q, F, fin, seed), 0, y1, 0));
  const taper = 3 * FLOOR, fw = 0.45;
  const tip = new THREE.Shape([new THREE.Vector2(-fw / 2, 0), new THREE.Vector2(0, -taper), new THREE.Vector2(fw / 2, 0)]);
  const tipGeo = new THREE.ExtrudeGeometry(tip, { depth: 0.5, bevelEnabled: false });
  let i = 0;
  contourEdges(q, (e) => {
    const h = fin[i++] * FLOOR - taper;
    if (h < 2) return;
    const n = Math.floor(e.len / 3.2);
    for (let k = 0; k < n; k++) {
      const t = ((k + 0.5) * e.len) / n;
      g.add(onEdge(box(fw, h, 0.5, M.fin, 0, y1 + taper, 0), e, t, 0.25));
      g.add(onEdge(mesh(tipGeo, M.fin, 0, y1 + taper, 0), e, t));
    }
    if (i === 2) {
      // Мачта подъёмника и кабина на середине высоты.
      g.add(onEdge(box(1, top + 4, 1, M.slateDark, 0, 0, 0), e, e.len * 0.3, 1.3));
      g.add(onEdge(box(2.4, 2.6, 2, M.orange, 0, top * 0.55, 0), e, e.len * 0.3 + 1.8, 1.3));
    }
  });
  g.add(prism(q, top, 0.35, M.concrete));
  g.add(box(4, 4.5, 4, M.concrete, 0, top, 0));
  for (const [x, z] of [[-6, -5], [6, -5], [-6, 5], [6, 5]]) g.add(box(0.5, 2.5, 0.5, M.concrete, x, top, z)); // колонны следующего яруса
  return g;
}

// Кирпичный корпус «Республики 2» (по рендеру): тёмно-красный кирпич, сетка окон, витрины внизу.
let BRICK = null;
function respublikaBrick(pl, lv) {
  if (!BRICK) {
    const [c, g] = canvas2d(64, 66);
    g.fillStyle = '#7d3424';
    g.fillRect(0, 0, 64, 66);
    g.fillStyle = '#6a2a1c';
    for (let y = 0; y < 66; y += 4) g.fillRect(0, y, 64, 1);
    g.fillStyle = '#4d1d12';
    g.fillRect(13, 8, 38, 46);
    g.fillStyle = '#2b3138';
    g.fillRect(16, 11, 32, 40);
    g.fillStyle = '#4d1d12';
    g.fillRect(31, 11, 2, 40);
    BRICK = new THREE.MeshLambertMaterial({ map: canvasTex(c, { repeat: true }) });
  }
  const g = new THREE.Group(), q = outward(pl), H = GROUND + (Math.max(2, lv) - 1) * FLOOR;
  g.add(mesh(wallGeo(q, GROUND, 1 / 4, 1 / GROUND), storeMat('#3a3633')));
  g.add(mesh(wallGeo(q, H - GROUND, 1 / 3, 1 / FLOOR), BRICK, 0, GROUND, 0));
  g.add(prism(q, H, 0.7, M.darkBrick, 0.12));
  return g;
}

// Башенный кран (на стройке «Республики 2»): решётчатая мачта, поворотная часть — стрела с тележкой и грузом
// (стеклопакеты на крюке), противовесная консоль с бетонными блоками, оголовок с растяжками. Стрела медленно
// ходит туда-сюда вокруг направления a0 (угол от +x к +z, как у toStreet).
function towerCrane(H, jib, a0) {
  const g = new THREE.Group(), Y = M.crane, mast = new THREE.Group(), a = 1;
  const beam = (x1, y1, z1, x2, y2, z2, t, mat = Y) => {
    const p = new THREE.Vector3(x1, y1, z1), r = new THREE.Vector3(x2, y2, z2);
    const m = mesh(new THREE.BoxGeometry(t, t, p.distanceTo(r)), mat);
    m.position.copy(p).add(r).multiplyScalar(0.5);
    m.lookAt(r);
    return m;
  };
  mast.add(box(5, 1, 5, M.concrete, 0, -0.4, 0));
  const C = [[-a, -a], [a, -a], [a, a], [-a, a]];
  for (const [x, z] of C) mast.add(box(0.22, H, 0.22, Y, x, 0, z));
  for (let y = 0.6; y < H - 1; y += 2.5) {
    for (let k = 0; k < 4; k++) {
      const [x1, z1] = C[k], [x2, z2] = C[(k + 1) % 4];
      mast.add(beam(x1, y, z1, x2, y, z2, 0.1));
      mast.add(beam(x1, y, z1, x2, y + 2.5, z2, 0.08));
    }
  }
  g.add(mergeByMaterial(mast));

  const s = new THREE.Group();
  s.add(box(2.8, 1.2, 2.8, Y, 0, 0, 0));
  s.add(box(2, 2.4, 2, M.white, 1.2, -0.6, 2.2)); // кабина
  s.add(box(0.1, 1.2, 1.8, M.glass, 2.22, 0.3, 2.2));
  for (let x = 1.4; x < jib - 0.1; x += 2.5) {
    const x2 = Math.min(jib, x + 2.5), xm = (x + x2) / 2;
    for (const sz of [-1, 1]) {
      s.add(beam(x, 1.2, sz * 0.8, x2, 1.2, sz * 0.8, 0.16));
      s.add(beam(x, 1.2, sz * 0.8, xm, 2.8, 0, 0.08));
      s.add(beam(xm, 2.8, 0, x2, 1.2, sz * 0.8, 0.08));
    }
    s.add(beam(xm, 2.8, 0, Math.min(jib, xm + 2.5), 2.8, 0, 0.14));
    s.add(beam(x, 1.2, -0.8, x, 1.2, 0.8, 0.08));
  }
  for (const sz of [-1, 1]) s.add(beam(-1.4, 1.4, sz, -15, 1.4, sz, 0.22));
  for (let x = -3; x > -15; x -= 3) s.add(beam(x, 1.4, -1, x, 1.4, 1, 0.12));
  for (let k = 0; k < 3; k++) s.add(box(1.1, 2.6, 2.6, M.concrete, -13.9 + k * 1.15, -0.2, 0)); // противовес
  for (const [x, z] of C) s.add(beam(x, 1.2, z, 0, 9, 0, 0.18)); // оголовок
  s.add(beam(0, 9, 0, jib * 0.7, 2.8, 0, 0.06, M.iron));
  s.add(beam(0, 9, 0, -14, 1.4, 0, 0.06, M.iron));
  const xt = jib * 0.55, hook = H * 0.55; // тележка и высота груза над землёй
  s.add(box(1.6, 0.5, 1.8, Y, xt, 0.6, 0));
  s.add(box(0.06, H - hook - 1, 0.06, M.iron, xt, hook + 1.6 - H, 0));
  s.add(box(0.7, 1, 0.5, M.signalRed, xt, hook + 0.6 - H, 0));
  s.add(box(3.2, 1.6, 1.4, M.blueGlass, xt, hook - 1 - H, 0));
  s.add(box(3.4, 0.2, 1.6, M.iron, xt, hook - 1.2 - H, 0));
  s.add(box(0.4, 0.4, 0.4, M.beacon, jib, 1.2, 0));
  s.add(box(0.4, 0.4, 0.4, M.beacon, 0, 9, 0));
  const slew = mergeByMaterial(s);
  slew.position.y = H;
  slew.userData.update = (t) => { slew.rotation.y = -a0 + 0.7 * Math.sin(t * 0.045); };
  g.add(slew);
  return g;
}

function toStreet(world, lm, re, fx, fz) {
  let best = null;
  for (const s of world.segmentsNear(lm.x, lm.z, 200)) {
    if (!re.test(s.road.name)) continue;
    const c = World.closest(s, lm.x, lm.z);
    if (!best || c.d < best.d) best = c;
  }
  if (!best) return [fx, fz];
  const d = Math.hypot(best.px - lm.x, best.pz - lm.z) || 1;
  return [(best.px - lm.x) / d, (best.pz - lm.z) / d];
}

export function buildLandmarks(world) {
  const group = new THREE.Group();
  const animated = [];
  const markers = []; // { name, x, z, r } для HUD и миникарты
  const far = []; // { obj, x, z, r } — для отсечения по расстоянию
  const keep = (obj) => {
    group.add(flatten(obj));
    obj.traverse((o) => { if (o.userData.update) animated.push(o.userData.update); });
    const box = new THREE.Box3().setFromObject(obj), c = box.getCenter(new THREE.Vector3());
    far.push({ obj, x: c.x, z: c.z, r: box.getSize(new THREE.Vector3()).length() / 2 });
  };

  for (const lm of world.city.landmarks || []) {
    let obj = null;
    const p = lm.p;
    switch (lm.key) {
      case 'mikhailovsky':
      case 'nevsky':
      case 'troitsky': {
        const f = fit(p, 0); // храмы ориентированы алтарём на восток
        const model = { nevsky, mikhailovsky, troitsky }[lm.key];
        obj = place(model(f), f.cx, baseY(world, p), f.cz, 0);
        break;
      }
      case 'kazansky': {
        // Контур — повёрнутый прямоугольник: ось модели по длинной стороне, алтарём на восток.
        let a = longestEdgeAngle(p);
        if (Math.cos(a) < 0) a += Math.PI;
        const f = fit(p, a);
        obj = place(kazansky(f), f.cx, baseY(world, p), f.cz, a);
        break;
      }
      case 'residence': {
        const u = longestEdgeAngle(p), ux = Math.cos(u), uz = Math.sin(u);
        const cx = p.reduce((a, q) => a + q[0], 0) / p.length, cz = p.reduce((a, q) => a + q[1], 0) / p.length;
        // Фасад — к улице Лихвинцева (нормаль к оси в её сторону); запад — меньший t по оси на запад.
        let best = null;
        for (const sg of world.segmentsNear(cx, cz, 250)) {
          if (!/Лихвинцева/.test(sg.road.name)) continue;
          const c = World.closest(sg, cx, cz);
          if (!best || c.d < best.d) best = c;
        }
        let nx = -uz, nz = ux;
        if (best && (best.px - cx) * nx + (best.pz - cz) * nz < 0) { nx = -nx; nz = -nz; }
        const ax = ux < 0 ? -1 : 1; // ось с запада на восток
        obj = place(residence(p, { ux: ux * ax, uz: uz * ax, nx, nz }), 0, baseY(world, p), 0, 0);
        break;
      }
      case 'ddn': {
        // Фасад — на улицу Орджоникидзе: направление на ближайшую точку улицы, ось модели —
        // ближайшая к нему из осей контура (через 90°), локальная +z смотрит на улицу.
        let best = null;
        for (const s of world.segmentsNear(lm.x, lm.z, 200)) {
          if (!/Орджоникидзе/.test(s.road.name)) continue;
          const c = World.closest(s, lm.x, lm.z);
          if (!best || c.d < best.d) best = c;
        }
        const want = best ? Math.atan2(-(best.px - lm.x), best.pz - lm.z) : longestEdgeAngle(p);
        const base = longestEdgeAngle(p);
        let a = base;
        for (let k = 0; k < 4; k++) {
          const c = base + (k * Math.PI) / 2;
          if (Math.cos(c - want) > Math.cos(a - want)) a = c;
        }
        const f = fit(p, a);
        obj = place(ddn(f, 1), f.cx, baseY(world, p), f.cz, a);
        break;
      }
      case 'friendship': {
        // Широкой стороной плиты — к пруду на западе.
        const f = fit(p, 0);
        obj = place(friendship(f, lm.h || 46), f.cx, baseY(world, p), f.cz, 0);
        break;
      }
      case 'mosque': {
        const f = fit(p, longestEdgeAngle(p));
        obj = place(mosque(toLocal(p, f), f), f.cx, baseY(world, p), f.cz, f.angle);
        break;
      }
      case 'opera': {
        // Главный фасад с пилонами — на север (по отзыву из игры): модель строится лицом на юг по контуру,
        // повёрнутому на 180°, и ставится с поворотом на π.
        const f = fit(p, 0);
        obj = place(opera(toLocal(p, f).map(([x, z]) => [-x, -z])), f.cx, baseY(world, p), f.cz, Math.PI);
        break;
      }
      case 'arsenal':
      case 'drama': {
        const f = fit(p, 0);
        obj = place({ arsenal, drama }[lm.key](toLocal(p, f)), f.cx, baseY(world, p), f.cz, 0);
        break;
      }
      case 'kalashnikov':
      case 'national': {
        // Вход — к улице Бородина / фасад — к Горького.
        const [fx, fz] = lm.key === 'kalashnikov' ? toStreet(world, lm, /Бородина/, -0.6, 0.8) : toStreet(world, lm, /Горького/, 1, 0);
        const f = fit(p, 0);
        obj = place({ kalashnikov, national }[lm.key](toLocal(p, f), fx, fz), f.cx, baseY(world, p), f.cz, 0);
        break;
      }
      case 'rotunda':
      case 'circus': {
        const c = circleFit(p);
        obj = place(lm.key === 'rotunda' ? rotunda(c) : circus(c), c.cx, baseY(world, p), c.cz);
        break;
      }
      case 'column':
        obj = place(column(), lm.x, world.terrain(lm.x, lm.z), lm.z);
        world.addCollider(square(lm.x, lm.z, 2.2));
        break;
      case 'plant': {
        const f = fit(p, 0), t = world.city.landmarks.find((q) => q.key === 'plant_tower') || { x: f.cx, z: f.cz };
        obj = place(plantMain(toLocal(p, f), t.x - f.cx, t.z - f.cz), f.cx, baseY(world, p), f.cz, 0);
        break;
      }
      case 'station':
      case 'suburban': {
        // Надписи «ВОКЗАЛ» / «ПРИГОРОДНЫЙ ВОКЗАЛ» — к привокзальной площади на западе, «ИЖЕВСК» — к путям на востоке.
        const f = fit(p, longestEdgeAngle(p)), side = Math.sin(f.angle) > 0 ? 1 : -1; // знак (−1, 0)·(локальная z)
        obj = place({ station, suburban }[lm.key](f.L, f.W, side), f.cx, baseY(world, p), f.cz, f.angle);
        break;
      }
      case 'sobmech':
      case 'armenian': {
        // Минарет / портал — на конце длинной оси, обращённом к улице.
        const [fx, fz] = lm.key === 'sobmech' ? toStreet(world, lm, /Азина/, 1, 0) : toStreet(world, lm, /10 лет Октября/, 1, 0);
        const f = fit(p, longestEdgeAngle(p)), s = fx * Math.cos(f.angle) + fz * Math.sin(f.angle) >= 0 ? 1 : -1;
        const m = lm.key === 'sobmech' ? sobmech(toLocal(p, f), s) : armenian(f.L, f.W, s);
        obj = place(m, f.cx, baseY(world, p), f.cz, f.angle);
        break;
      }
      case 'izo': {
        const [fx, fz] = toStreet(world, lm, /Кирова/, 0, 1), f = fit(p, 0);
        obj = place(izo(toLocal(p, f), fx, fz), f.cx, baseY(world, p), f.cz, 0);
        break;
      }
      case 'general':
      case 'puppets': {
        // Вход театра кукол с башней — на западном фасаде, спиной к Ломоносова (проверено в игре по отзыву).
        const [fx, fz] = lm.key === 'general' ? toStreet(world, lm, /Милиционная/, -1, 0) : [-1, 0];
        const f = fit(p, 0);
        obj = place({ general, puppets }[lm.key](toLocal(p, f), fx, fz), f.cx, baseY(world, p), f.cz, 0);
        break;
      }
      case 'udsu_bridge': {
        // Ось — по длинной стороне, с запада на восток. Узкая западная часть контура — галерея, широкая восточная —
        // лестничная башня. Настил — на 6.3 м над самым высоким рельефом под осью (провода троллейбуса — 5.9 м).
        let a = longestEdgeAngle(p);
        if (Math.cos(a) < 0) a += Math.PI;
        const f = fit(p, a), q = toLocal(p, f), L = f.L;
        const c = Math.cos(a), sn = Math.sin(a), W = (x, z) => [f.cx + x * c - z * sn, f.cz + x * sn + z * c];
        const west = q.filter(([x]) => x < 0), east = q.filter(([x]) => x > L / 2 - 17);
        const wz = west.map(([, z]) => z), ez = east.map(([, z]) => z);
        const zc = (Math.min(...wz) + Math.max(...wz)) / 2, gw = Math.max(3, Math.max(...wz) - Math.min(...wz));
        const y0 = Math.max(...Array.from({ length: 13 }, (_, i) => world.terrain(...W(-L / 2 + (i * L) / 12, zc))));
        // Портал — у западного края проезжей части; башня — по середине широкой части.
        let xP = -L / 2 + 3;
        for (let x = -L / 2 + 2; x < L / 2; x += 0.5) {
          if (world.surfaceAt(...W(x, zc)) === 'road') break;
          xP = x - 2;
        }
        xP = Math.max(-L / 2 + 2, xP);
        const xT = L / 2 - 11, zT = (Math.min(...ez) + Math.max(...ez)) / 2, sT = Math.sign(zT - zc) || 1;
        obj = place(udsuBridge({ L, zc, gw, D: 6.3, xP, yP: world.terrain(...W(xP, zc)) - y0, xT, zT, yT: world.terrain(...W(xT, zT)) - y0, sT }),
          f.cx, y0, f.cz, a);
        world.addCollider(square(...W(xT, zT), 2.6));
        for (const side of [-1, 1]) world.addCollider(square(...W(xP, zc + side * (gw / 2 + 0.7)), 0.3));
        break;
      }
      case 'stadium': {
        // Коллайдер — только наружная стена: внутри поле.
        const f = fit(p, 0), q = offsetContour(p, 1.5);
        obj = place(stadium(toLocal(p, f)), f.cx, baseY(world, p), f.cz, 0);
        for (let i = 0; i < p.length; i++) {
          const j = (i + 1) % p.length;
          world.addCollider([p[i], p[j], q[j], q[i]]);
        }
        break;
      }
      case 'gagarin':
      case 'locomotive': {
        // Гагарин — лицом к улице Горького; паровоз — вдоль путей станции (они идут почти с севера на юг).
        const [fx, fz] = toStreet(world, lm, /Горького/, -0.55, 0.83);
        const m = lm.key === 'gagarin' ? gagarinStatue() : steamLoco();
        m.rotation.y = lm.key === 'gagarin' ? Math.atan2(fx, fz) : -(100 * Math.PI) / 180;
        obj = place(new THREE.Group().add(m), lm.x, world.terrain(lm.x, lm.z), lm.z);
        if (lm.key === 'gagarin') world.addCollider(square(lm.x, lm.z, 2.2));
        else {
          const c = Math.cos(m.rotation.y), sn = Math.sin(m.rotation.y);
          world.addCollider([[-10.5, -1.5], [10.5, -1.5], [10.5, 1.5], [-10.5, 1.5]].map(([x, z]) => [lm.x + x * c + z * sn, lm.z - x * sn + z * c]));
        }
        break;
      }
      case 'deryabin':
      case 'gerd': {
        // Дерябин — спиной к пруду: берег в 10 м к северу и идёт с востока на запад (ближайшая точка на рёбрах
        // воды, а не вершина — вершины берега редкие); Герд — лицом к улице Коммунаров.
        const [fx, fz] = lm.key === 'deryabin' ? [0, 1] : toStreet(world, lm, /Коммунаров/, 1, 0);
        const m = lm.key === 'deryabin' ? deryabinBust() : gerdStatue();
        m.rotation.y = Math.atan2(fx, fz);
        obj = place(new THREE.Group().add(m), lm.x, world.terrain(lm.x, lm.z), lm.z);
        world.addCollider(square(lm.x, lm.z, lm.key === 'deryabin' ? 2.3 : 3));
        break;
      }
      case 'gunsmiths':
      case 'kirov': {
        // Оружейники — спиной к пруду (берег на западе, идёт с севера на юг), Киров — лицом ко входу в парк с улицы Кирова (восток).
        const m = lm.key === 'gunsmiths' ? gunsmiths() : kirovStatue(), a = lm.key === 'gunsmiths' ? Math.atan2(1, -0.05) : Math.PI / 2;
        m.rotation.y = a;
        obj = place(new THREE.Group().add(m), lm.x, world.terrain(lm.x, lm.z), lm.z);
        world.addCollider(square(lm.x, lm.z, lm.key === 'gunsmiths' ? 4 : 1.5));
        break;
      }
      case 'water_tower': {
        const c = circleFit(p);
        obj = place(waterTower(c.R, Math.atan2(p[0][0] - c.cx, p[0][1] - c.cz)), c.cx, baseY(world, p), c.cz);
        break;
      }
      case 'plant_tower':
        obj = place(plantTower(), lm.x, world.terrain(lm.x, lm.z), lm.z);
        world.addCollider(square(lm.x, lm.z, 8));
        break;
      case 'flame':
        obj = place(eternalFlame(), lm.x, world.terrain(lm.x, lm.z), lm.z);
        world.addCollider(square(lm.x, lm.z, 3.5));
        break;
      case 'wheel':
        // Плоскостью к пруду (пруд к западу): ось колеса смотрит на восток-запад.
        obj = place(ferrisWheel(lm.h || 50), lm.x, world.terrain(lm.x, lm.z), lm.z, Math.PI / 2);
        world.addCollider(square(lm.x, lm.z, 4));
        break;
      case 'respublika':
      case 'respublika_b': {
        const f = fit(p, 0);
        obj = place(respublikaTower(toLocal(p, f), lm.lv || 22, lm.key === 'respublika' ? 7 : 11), f.cx, baseY(world, p), f.cz, 0);
        break;
      }
      case 'respublika_base': {
        const f = fit(p, 0), towers = world.city.landmarks.filter((q) => /^respublika(_b)?$/.test(q.key));
        obj = place(respublikaBase(toLocal(p, f), towers.map((t) => [t.x - f.cx, t.z - f.cz])), f.cx, baseY(world, p), f.cz, 0);
        break;
      }
      case 'respublika2':
      case 'respublika2_b': {
        // Фасад смонтирован наполовину — этажей готово по стенам контура, у башен по-разному.
        const f = fit(p, longestEdgeAngle(p)), main = lm.key === 'respublika2';
        obj = place(respublika2Tower(toLocal(p, f), lm.lv || 22, main ? [12, 10, 13, 9] : [9, 11, 8, 10], main ? 5 : 9), f.cx, baseY(world, p), f.cz, f.angle);
        const o = main && world.city.landmarks.find((q) => q.key === 'respublika2_b');
        if (o) {
          // Кран — на свободном месте стройки в 42 м к северу от середины между башнями, стрела к ним (на юг).
          const x = (lm.x + o.x) / 2, z = (lm.z + o.z) / 2 - 42, y = world.terrain(x, z);
          const H = Math.max(baseY(world, p) + 3 + (lm.lv || 22) * FLOOR + 12, y + 60) - y;
          keep(place(towerCrane(H, 50, Math.PI / 2), x, y, z));
          world.addCollider(square(x, z, 2.5));
        }
        break;
      }
      case 'respublika2_brick': {
        const f = fit(p, 0);
        obj = place(respublikaBrick(toLocal(p, f), lm.lv || 10), f.cx, baseY(world, p), f.cz, 0);
        break;
      }
      case 'government': {
        const b = world.city.buildings.find((q) => q.lm === 'government');
        if (b) {
          const top = Math.max(...b.p.map(([x, z]) => world.terrain(x, z))) + b.h;
          obj = place(udmurtFlag(), lm.x, top, lm.z);
        }
        break;
      }
      default:
        break; // только перекраска (в buildBuildings)
    }
    if (p && lm.mode === 'replace' && lm.key !== 'stadium') world.addCollider(p); // у стадиона внутри поле
    if (obj) keep(obj);
    // Корпус завода — под меткой башни; у «Республик» метка одна на очередь.
    // r — радиус контура: метка в HUD меряет расстояние до края, а не до центра.
    if (lm.key !== 'plant' && !/^respublika.*_/.test(lm.key)) {
      const r = p ? Math.max(...p.map(([x, z]) => Math.hypot(x - lm.x, z - lm.z))) : 0;
      markers.push({ name: lm.name, x: lm.x, z: lm.z, r });
    }
  }

  // Башенные краны на стройках из OSM (city.cranes, fetch_city.construction_cranes): каркас строится один на высоту
  // и стрелу (с шагом 5 м), дальше — копии с общей геометрией; стрела у каждого ходит в свою сторону и в своей фазе.
  const cranes = new Map();
  for (const [x, z, h, jib, a] of world.city.cranes || []) {
    const H = Math.round(h / 5) * 5, J = Math.round(jib / 5) * 5, k = `${H}/${J}`;
    if (!cranes.has(k)) cranes.set(k, towerCrane(H, J, 0));
    const c = cranes.get(k).clone(), slew = c.children[1];
    slew.userData.update = (t) => { slew.rotation.y = -a + 0.7 * Math.sin(t * 0.045 + x); };
    // Каркас уже слит по материалам — без keep (flatten и рамка на каждый кран — +2 с загрузки).
    group.add(place(c, x, world.terrain(x, z), z));
    animated.push(slew.userData.update);
    far.push({ obj: c, x, z, r: Math.max(H, J) });
    world.addCollider(square(x, z, 2.5));
  }

  // Парадные лестницы (walks.js, GRAND_STAIRS) — в координатах города, не в системе храма.
  for (const p of world.city.paths) if (p.grand) keep(grandStairs(world, grandLayout(world, p)));

  group.userData.update = (t) => animated.forEach((fn) => fn(t));
  // Дальше конца тумана модель не видна, но рисовалась бы: прячем по расстоянию до её края.
  group.userData.cull = (x, z, dist) => {
    for (const f of far) f.obj.visible = Math.hypot(f.x - x, f.z - z) - f.r < dist;
  };
  return { group, markers };
}

function square(x, z, h) {
  return [[x - h, z - h], [x + h, z - h], [x + h, z + h], [x - h, z + h]];
}

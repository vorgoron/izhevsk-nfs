// Достопримечательности: процедурные модели «по мотивам», вписанные в контуры из OSM.
// Пропорции приблизительные — узнаваемый силуэт, а не обмер.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { World } from './world.js';

const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
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
  gold: new THREE.MeshPhongMaterial({ color: '#d2a53a', specular: '#fff1b8', shininess: 90, emissive: '#2a1d00' }),
};

// Цвета обычных коробок, которые только перекрашиваются: [стены, крыша].
export const RECOLOR = {
  arsenal: ['#e8c766', '#5f8466'],
  government: ['#ecebe6', '#7d8084'],
  opera: ['#efece4', '#8a8f94'],
  kalashnikov: ['#d6cfc0', '#6d6f72'],
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
function archWindow(w, h, x, y, z) {
  const g = new THREE.Group();
  const r = w / 2;
  g.add(box(0.2, h + 0.3, w + 0.6, M.white, 0, -0.3, 0));
  g.add(mesh(new THREE.CylinderGeometry(r + 0.3, r + 0.3, 0.2, 12, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), M.white, 0, h - r, 0));
  g.add(box(0.2, h - r, w, M.glass, 0.08, 0, 0));
  g.add(mesh(new THREE.CylinderGeometry(r, r, 0.2, 12, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), M.glass, 0.08, h - r, 0));
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

// Свято-Троицкий собор (Советская / Удмуртская): белый пятиглавый храм — четверик с портиками,
// большой барабан с золотой главой, четыре малые синие главы, трапезная и ярусная колокольня.
function troitsky({ L, W }) {
  const g = new THREE.Group();
  const s = Math.min(W * 0.95, L * 0.5);
  const cx = L * 0.14;
  g.add(box(s, 18, s, M.white, cx, -3, 0));
  g.add(pilasters(s, s, 18, cx, -3, 0));
  g.add(windowBand(3, s, s, 5, cx, 0));
  const turned = windowBand(3, s, s, 5, 0, 0);
  turned.rotation.y = Math.PI / 2;
  turned.position.x = cx;
  g.add(turned);
  g.add(box(s + 0.8, 0.8, s + 0.8, M.cream, cx, 15, 0)); // карниз
  g.add(box(s + 0.2, 1.2, s + 0.2, M.silver, cx, 15.8, 0));
  // Портики с севера и юга.
  for (const side of [-1, 1]) {
    const z = side * (s / 2 + 2);
    g.add(portico(4, cx - s * 0.2, cx + s * 0.2, z, 'x', 9, 0.4, 0));
    g.add(box(s * 0.5, 1, 4.4, M.white, cx, 9, side * (s / 2 + 1.5)));
    g.add(pediment(s * 0.5, 2.4, 4.4, cx, 10, side * (s / 2 + 1.5)));
  }
  // Апсида на востоке.
  g.add(mesh(new THREE.CylinderGeometry(s * 0.3, s * 0.3, 12, 20, 1, false, 0, Math.PI), M.white, cx + s / 2, 3, 0));
  g.add(dome(s * 0.3, M.silver, cx + s / 2, 9, 0, 0.5));
  // Центральный барабан и большая золотая глава.
  const dr = s * 0.22;
  g.add(cyl(dr, 8, M.white, cx, 16.5, 0, 16));
  g.add(windowBand(4, dr * 1.4, dr * 1.4, 19, cx, 0));
  g.add(cyl(dr + 0.4, 0.6, M.cream, cx, 24.3, 0, 16));
  g.add(onion(dr * 1.05, dr * 2.2, cx, 24.8, 0));
  // Малые главы по углам — синие.
  for (const [dx, dz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const x = cx + dx * s * 0.33, z = dz * s * 0.33;
    g.add(cyl(dr * 0.45, 4, M.white, x, 16.5, z, 12));
    g.add(onion(dr * 0.5, dr * 1.1, x, 20.5, z, true, M.blue));
  }
  // Трапезная и колокольня на западе.
  const t = Math.min(9, W * 0.45);
  const tx = -L / 2 + t / 2;
  const refStart = tx + t / 2, refEnd = cx - s / 2;
  if (refEnd > refStart) {
    g.add(box(refEnd - refStart, 11, W * 0.6, M.white, (refStart + refEnd) / 2, -3, 0));
    g.add(box(refEnd - refStart + 0.4, 1, W * 0.6 + 0.4, M.silver, (refStart + refEnd) / 2, 8, 0));
  }
  g.add(box(t, 22, t, M.white, tx, -3, 0));
  g.add(pilasters(t, t, 22, tx, -3, 0));
  g.add(box(t + 0.6, 0.7, t + 0.6, M.cream, tx, 19, 0));
  g.add(box(t * 0.75, 7, t * 0.75, M.white, tx, 19.7, 0));
  g.add(colonnade(8, t * 0.38, 6, 0.22, M.cream, tx, 20.2, 0)); // ярус звона
  g.add(box(t * 0.8, 0.6, t * 0.8, M.cream, tx, 26.7, 0));
  g.add(cyl(t * 0.25, 4, M.white, tx, 27.3, 0, 12));
  g.add(onion(t * 0.24, t * 0.5, tx, 31.3, 0, false, M.blue));
  g.add(cone(t * 0.06, 9, M.gold, tx, 31.3 + t * 0.5, 0, 8));
  g.add(cross(2.4, tx, 40.5 + t * 0.5, 0));
  return g;
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
function sign(text, w, h, x, y, z, f) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#f2eee4';
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

// «Навеки с Россией»: две параллельные белые стелы на гранитном стилобате.
function friendship({ L, W }, h = 46) {
  const g = new THREE.Group();
  g.add(box(L, 1.4, W, M.granite, 0, -2, 0));
  g.add(box(L * 0.7, 1, W * 0.7, M.stone, 0, -0.6, 0));
  const steleW = 6, gap = 2.6;
  const steles = new THREE.Group();
  steles.rotation.y = Math.PI / 2; // плоскости стел поперёк длинной стороны стилобата
  g.add(steles);
  for (const side of [-1, 1]) {
    const geo = new THREE.BoxGeometry(steleW, h, 2.2, 1, 8, 1);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) + h / 2) / h; // 0 внизу, 1 вверху
      pos.setX(i, pos.getX(i) * (1 - 0.45 * t));
    }
    geo.computeVertexNormals();
    steles.add(mesh(geo, M.concrete, 0, 0.4 + h / 2, side * (gap / 2 + 1.1)));
  }
  // Венчающая перемычка.
  steles.add(box(steleW * 0.5, 1.2, gap + 4.4, M.concrete, 0, h - 1.5, 0));
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

function mosque({ L, W }) {
  const g = new THREE.Group();
  g.add(box(L * 0.8, 12, W * 0.9, M.white, 0, -3, 0));
  g.add(box(L * 0.8 + 0.6, 0.6, W * 0.9 + 0.6, M.green, 0, 9, 0));
  const r = Math.min(L, W) * 0.27;
  g.add(cyl(r, 4, M.white, 0, 9.6, 0, 24));
  g.add(dome(r + 0.3, M.green, 0, 13.6, 0, 1.05));
  g.add(cyl(0.12, 3, M.gold, 0, 13.6 + r * 1.05, 0, 6));
  for (const side of [-1, 1]) {
    const x = side * (L * 0.4 + 1.5);
    g.add(cyl(1.5, 30, M.white, x, -3, 0, 12, 1.2));
    g.add(cyl(2.1, 0.8, M.white, x, 22, 0, 12));
    g.add(cyl(1.15, 4, M.white, x, 22.8, 0, 12));
    g.add(cone(1.3, 5, M.green, x, 26.8, 0, 12));
    const crescent = mesh(new THREE.TorusGeometry(0.6, 0.1, 6, 16, Math.PI * 1.4), M.gold, x, 32.6, 0);
    crescent.rotation.z = Math.PI * 0.8;
    g.add(crescent);
  }
  return g;
}

function circus({ R }) {
  const g = new THREE.Group();
  g.add(cyl(R, 15, M.concrete, 0, -3, 0, 40));
  g.add(cyl(R + 0.4, 1, M.silver, 0, 7, 0, 40));
  g.add(cyl(R * 0.98, 3, lambert('#c0473a'), 0, 8, 0, 40)); // красный пояс
  g.add(dome(R * 0.97, M.silver, 0, 11, 0, 0.42));
  // Рёбра купола.
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const rib = mesh(new THREE.TorusGeometry(R * 0.97, 0.18, 4, 24, Math.PI / 2), M.white, 0, 11, 0);
    rib.scale.set(1, 0.42, 1);
    rib.rotation.set(0, a, 0);
    g.add(rib);
  }
  g.add(cyl(0.12, 6, M.dark, 0, 11 + R * 0.4, 0, 6));
  return g;
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
  // Кабинки — не дети ротора: позицию считаем сами, чтобы они не переворачивались.
  const colors = ['#e6493c', '#f2b632', '#3b8fd9', '#45b36b', '#9b59b6', '#f07f2e'];
  const cabins = [];
  for (let i = 0; i < N; i++) {
    const c = new THREE.Group();
    c.add(box(0.12, 1.2, 0.12, M.dark, 0, -1.2, 0));
    c.add(box(1.8, 1.9, 1.8, lambert(colors[i % colors.length]), 0, -3.1, 0));
    c.add(box(1.82, 0.9, 1.82, lambert('#bcd3e2'), 0, -2.1, 0)); // остекление
    c.add(box(2, 0.15, 2, M.white, 0, -1.25, 0));
    g.add(c);
    cabins.push(c);
  }
  g.userData.update = (t) => {
    const phase = t * 0.06; // полный оборот примерно за 105 секунд
    rotor.rotation.z = phase;
    cabins.forEach((c, i) => {
      const a = phase + (i / N) * Math.PI * 2;
      c.position.set(Math.cos(a) * R, cy + Math.sin(a) * R, 0);
    });
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

export function buildLandmarks(world) {
  const group = new THREE.Group();
  const animated = [];
  const markers = []; // { name, x, z } для HUD и миникарты

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
        const f = fit(p, longestEdgeAngle(p));
        obj = place(friendship(f, lm.h || 46), f.cx, baseY(world, p), f.cz, f.angle);
        break;
      }
      case 'mosque': {
        const f = fit(p, longestEdgeAngle(p));
        obj = place(mosque(f), f.cx, baseY(world, p), f.cz, f.angle);
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
    if (p && lm.mode === 'replace') world.addCollider(p);
    if (obj) {
      group.add(obj);
      obj.traverse((o) => { if (o.userData.update) animated.push(o.userData.update); });
    }
    markers.push({ name: lm.name, x: lm.x, z: lm.z });
  }

  group.userData.update = (t) => animated.forEach((fn) => fn(t));
  return { group, markers };
}

function square(x, z, h) {
  return [[x - h, z - h], [x + h, z - h], [x + h, z + h], [x - h, z + h]];
}

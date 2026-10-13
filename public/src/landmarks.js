// Достопримечательности: процедурные модели «по мотивам», вписанные в контуры из OSM.
// Пропорции приблизительные — узнаваемый силуэт, а не обмер.
import * as THREE from 'three';

const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
const M = {
  brick: lambert('#9a3f2c'),
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

// Свято-Михайловский собор: красный кирпич, белый декор, шатровая колокольня на западе,
// центральный шатёр с большой главой и четыре малые главы.
function mikhailovsky({ L, W }) {
  const g = new THREE.Group();
  const s = Math.min(W, L * 0.5) * 0.95; // основной четверик
  const cx = L * 0.12;
  g.add(box(s, 20, s, M.brick, cx, -3, 0));
  g.add(box(s + 0.8, 0.7, s + 0.8, M.white, cx, 16.5, 0)); // карниз
  g.add(box(s + 0.2, 1.5, s + 0.2, M.roof, cx, 17.2, 0));
  g.add(pilasters(s, s, 20, cx, -3, 0));
  g.add(windowBand(3, s, s, 6, cx, 0));
  const turned = windowBand(3, s, s, 6, 0, 0);
  turned.rotation.y = Math.PI / 2;
  turned.position.x = cx;
  g.add(turned);
  // Апсида на востоке.
  const apse = mesh(new THREE.CylinderGeometry(s * 0.3, s * 0.3, 14, 20, 1, false, 0, Math.PI), M.brick, cx + s / 2, 4, 0);
  g.add(apse);
  g.add(dome(s * 0.3, M.roof, cx + s / 2, 11, 0, 0.5));
  // Центральный барабан, шатёр и большая глава.
  const dr = s * 0.2;
  g.add(cyl(dr, 9, M.brick, cx, 18.5, 0, 8));
  g.add(cyl(dr + 0.4, 0.6, M.white, cx, 27.3, 0, 8));
  g.add(cone(dr * 1.05, 16, M.brick, cx, 27.8, 0, 8));
  g.add(onion(dr * 0.55, 5, cx, 42.5, 0));
  // Малые главы по углам.
  for (const [dx, dz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const x = cx + dx * s * 0.33, z = dz * s * 0.33;
    g.add(cyl(dr * 0.42, 5, M.brick, x, 18.5, z, 8));
    g.add(onion(dr * 0.45, 3.6, x, 23.5, z));
  }
  // Трапезная и колокольня.
  const t = Math.min(10, W * 0.42);
  const tx = -L / 2 + t / 2;
  const refStart = tx + t / 2, refEnd = cx - s / 2;
  if (refEnd > refStart) g.add(box(refEnd - refStart, 13, W * 0.62, M.brick, (refStart + refEnd) / 2, -3, 0));
  g.add(box(t, 29, t, M.brick, tx, -3, 0));
  g.add(pilasters(t, t, 29, tx, -3, 0));
  g.add(windowBand(2, t, t, 14, tx, 0));
  g.add(box(t + 0.6, 0.7, t + 0.6, M.white, tx, 24, 0));
  g.add(cyl(t * 0.42, 9, M.brick, tx, 26, 0, 8));
  g.add(colonnade(8, t * 0.42, 6, 0.25, M.white, tx, 27.5, 0)); // звон
  g.add(cone(t * 0.46, 19, M.brick, tx, 35, 0, 8));
  g.add(onion(t * 0.17, 3.5, tx, 54, 0));
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
function plantTower() {
  const g = new THREE.Group();
  const t = 9;
  g.add(box(t, 22, t, M.cream, 0, -3, 0));
  for (const [x, z] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) g.add(box(0.8, 22, 0.8, M.white, x * t / 2, -3, z * t / 2));
  g.add(box(t + 0.8, 0.8, t + 0.8, M.white, 0, 19, 0));
  // Куранты на четыре стороны.
  const faceGeo = new THREE.CircleGeometry(1.6, 24);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const face = mesh(faceGeo, M.white, Math.sin(a) * (t / 2 + 0.05), 15.5, Math.cos(a) * (t / 2 + 0.05));
    face.rotation.y = a;
    g.add(face);
    const hand = box(0.12, 1.2, 0.05, M.dark, 0, 0, 0);
    hand.position.set(Math.sin(a) * (t / 2 + 0.12), 15.9, Math.cos(a) * (t / 2 + 0.12));
    hand.rotation.y = a;
    g.add(hand);
  }
  g.add(box(t * 0.7, 6, t * 0.7, M.cream, 0, 19.8, 0));
  g.add(cyl(t * 0.3, 5, M.white, 0, 25.8, 0, 8));
  g.add(colonnade(8, t * 0.33, 4.4, 0.18, M.white, 0, 25.8, 0));
  g.add(dome(t * 0.32, M.gold, 0, 30.8, 0, 0.7));
  g.add(cone(0.6, 15, M.gold, 0, 32.4, 0, 8));
  g.add(mesh(new THREE.SphereGeometry(0.45, 10, 8), M.gold, 0, 47.6, 0));
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
        world.addCollider(square(lm.x, lm.z, 4.6));
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

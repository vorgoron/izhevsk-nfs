// Машины ижевского автопрома: процедурные модели по профилю сбоку (вытянутому на ширину)
// и характеристики для физики (eco — расход бензина относительно «Оды»). Размеры — по паспортным, силуэты упрощены.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Профили: [z, y] — z вперёд (перед машины при +len/2), y вверх, от земли.
// body — кузов, cabin — салон (оба под краску, cabin уже кузова и сужается к крыше).
// windows — боковые стёкла [z спереди, z сзади] внутри силуэта салона, frame — цвет рамок между
// ними (нет — стойки под краску); doors — швы дверей (z); trim — зеркала и ручки.
export const MODELS = {
  oda: {
    name: 'ИЖ-2126 «Ода»', years: '1990–2005',
    about: 'Пятидверный хэтчбек — первая собственная легковая модель Ижмаша.',
    glb: 'models/oda.glb', // tools/models/oda.mjs; не загрузилась — процедурная по полям ниже
    width: 1.65, cabinWidth: 1.42,
    body: [[-2.03, 0.3], [2.03, 0.3], [2.05, 0.56], [1.96, 0.78], [0.95, 0.9], [-1.9, 0.94], [-2.05, 0.62]],
    cabin: [[0.95, 0.88], [0.18, 1.39], [-1.22, 1.4], [-1.93, 0.96], [-1.9, 0.9]],
    windows: [[2, -0.1], [-0.24, -1.08]], frame: '#1a1b1d', doors: [0.9, -0.17, -1.15],
    wheels: { r: 0.29, front: 1.26, rear: -1.21, track: 0.7 },
    bumper: '#2b2d31', bumperH: 0.24, grille: '#17181b', grilleBars: '#b9bdc2', trim: '#1a1b1d',
    lights: 'rect', lamp: { w: 0.44, h: 0.19 }, tail: { w: 0.36, h: 0.17, y: 0.76 },
    colors: ['#7c1622', '#e9e9e6', '#1f5e6b', '#2c5aa0', '#8c9196', '#2f6b3a', '#d8641e', '#1e1f22'],
    stats: { kmh: 165, accel: 0.86, grip: 1.0, eco: 1.0 },
  },
  m412: {
    name: 'Москвич-412 (ИЖ-412)', years: '1967–1998',
    about: 'Седан, который Ижмаш выпускал три десятилетия; ралли «Лондон — Сидней» и экспорт.',
    width: 1.55, cabinWidth: 1.36,
    body: [[-2.06, 0.32], [2.06, 0.32], [2.08, 0.58], [2.02, 0.8], [0.85, 0.87], [-1.1, 0.9], [-2.0, 0.88], [-2.07, 0.62]],
    cabin: [[0.85, 0.86], [0.24, 1.44], [-0.72, 1.46], [-1.15, 0.9]],
    windows: [[2, -0.19], [-0.31, -0.98]], doors: [0.82, -0.25, -1.05],
    wheels: { r: 0.3, front: 1.2, rear: -1.2, track: 0.64 },
    bumper: '#c8ccd0', bumperH: 0.12, grille: '#c8ccd0', trim: '#c8ccd0', lights: 'rect',
    colors: ['#9fc2d6', '#e8e2c8', '#6b1420', '#3b6e4f', '#f0f0ec', '#c9a227', '#2b3a66', '#5a5f66'],
    stats: { kmh: 155, accel: 0.8, grip: 0.95, eco: 1.15 },
  },
  kombi: {
    name: 'ИЖ-2125 «Комби»', years: '1973–1997',
    about: 'Лифтбек на базе 412-го — один из первых советских хэтчбеков.',
    width: 1.55, cabinWidth: 1.36,
    body: [[-2.06, 0.32], [2.06, 0.32], [2.08, 0.58], [2.02, 0.8], [0.85, 0.87], [-1.95, 0.92], [-2.07, 0.62]],
    cabin: [[0.85, 0.86], [0.24, 1.44], [-0.95, 1.45], [-1.95, 0.94], [-1.95, 0.9]],
    windows: [[2, -0.24], [-0.36, -1.5]], doors: [0.82, -0.3, -1.2],
    wheels: { r: 0.3, front: 1.2, rear: -1.2, track: 0.64 },
    bumper: '#c8ccd0', bumperH: 0.12, grille: '#c8ccd0', trim: '#c8ccd0', lights: 'rect',
    colors: ['#c64a1e', '#e8e2c8', '#2e8b8b', '#f2c230', '#6b1420', '#4a6b2f', '#e9e9e6', '#3d4a5c'],
    stats: { kmh: 150, accel: 0.8, grip: 0.95, eco: 1.15 },
  },
  kabluk: {
    name: 'ИЖ-2715 «Каблучок»', years: '1972–2001',
    about: 'Пикап-фургон с высокой будкой — главная развозная машина 80-х.',
    width: 1.55, cabinWidth: 1.36,
    body: [[-2.04, 0.34], [2.06, 0.34], [2.08, 0.58], [2.02, 0.8], [0.85, 0.87], [-0.42, 0.9], [-2.04, 0.9]],
    cabin: [[0.85, 0.86], [0.24, 1.44], [-0.32, 1.44], [-0.4, 0.9]],
    windows: [[2, -2]], doors: [0.82, -0.38],
    box: { from: -0.45, to: -2.06, y0: 0.86, y1: 1.98, width: 1.6, color: 'paint' },
    wheels: { r: 0.3, front: 1.2, rear: -1.2, track: 0.64 },
    bumper: '#c8ccd0', bumperH: 0.12, grille: '#c8ccd0', trim: '#c8ccd0', lights: 'rect',
    colors: ['#3b6e4f', '#e9e9e6', '#2c5aa0', '#c9a227', '#7a2f2f', '#5a6e8c', '#8c9196', '#d8641e'],
    stats: { kmh: 135, accel: 0.7, grip: 0.9, eco: 1.25 },
  },
  odavan: {
    name: 'ИЖ-27175 (фургон «Ода»)', years: '1997–2012',
    about: '«Каблук» нового поколения: перед от «Оды» и пластиковая будка.',
    width: 1.65, cabinWidth: 1.42,
    body: [[-2.03, 0.32], [2.03, 0.32], [2.05, 0.56], [1.96, 0.78], [0.95, 0.9], [-0.5, 0.92], [-2.03, 0.92]],
    cabin: [[0.95, 0.88], [0.18, 1.39], [-0.42, 1.4], [-0.5, 0.92]],
    windows: [[2, -2]], doors: [0.9, -0.46],
    box: { from: -0.52, to: -2.1, y0: 0.88, y1: 1.92, width: 1.68, color: '#ecebe6' },
    wheels: { r: 0.29, front: 1.26, rear: -1.21, track: 0.7 },
    bumper: '#2b2d31', bumperH: 0.24, grille: '#17181b', grilleBars: '#b9bdc2', trim: '#1a1b1d',
    lights: 'rect', lamp: { w: 0.44, h: 0.19 },
    colors: ['#e9e9e6', '#7c1622', '#2c5aa0', '#2f6b3a', '#8c9196', '#1e1f22', '#c9a227', '#1f5e6b'],
    stats: { kmh: 140, accel: 0.72, grip: 0.9, eco: 1.2 },
  },
  vesta: {
    name: 'LADA Vesta', years: 'с 2015',
    about: 'Собирается на «ИжАвто» — главный ижевский автомобиль сегодня.',
    // Готовая модель (tools/models/vesta.mjs); не загрузилась — рисуется процедурная по полям ниже.
    glb: 'models/vesta.glb',
    credit: 'Модель: «Lada Vesta», tiunov.se (Sketchfab), CC BY 4.0',
    width: 1.76, cabinWidth: 1.5,
    // Бамперы в профиле кузова: низкий скруглённый нос, капот круто падает вперёд, короткий высокий багажник.
    body: [[-2.2, 0.32], [2.2, 0.32], [2.26, 0.46], [2.25, 0.6], [2.17, 0.73], [1.95, 0.83], [1.0, 1.0], [-1.66, 1.05],
      [-2.12, 1.04], [-2.22, 0.95], [-2.25, 0.62], [-2.23, 0.42]],
    cabin: [[1.0, 0.99], [0.0, 1.46], [-0.6, 1.5], [-1.12, 1.44], [-1.72, 1.05]],
    taper: 0.8, corner: 0.13, cornerR: 0.7, // покатая крыша, сильно скруглённые углы
    windows: [[2, -0.3], [-0.42, -1.2], [-1.28, -2]], frame: '#1a1b1d', doors: [1.0, -0.36, -1.4],
    crease: [[0.8, 0.46], [-1.68, 0.8]], // косая выштамповка на дверях — «икс» сбоку
    wheels: { r: 0.32, front: 1.38, rear: -1.25, track: 0.76, alloy: true },
    bumper: 'paint', bumperH: 0.26, grille: '#1b1c1f', trim: '#1a1b1d', lights: 'vesta',
    colors: ['#e9e9e6', '#c63a2a', '#1e1f22', '#8c9196', '#2c5aa0', '#e07a1f', '#5a3a6b', '#3b5f4a'],
    stats: { kmh: 190, accel: 1.0, grip: 1.06, eco: 0.85 },
  },
};
export const DEFAULT_MODEL = 'oda';

// ---------------------------------------------------------------- геометрия

// Профиль (z, y) → призма шириной w по x, по центру.
export function prism(profile, w) {
  const shape = new THREE.Shape(profile.map(([z, y]) => new THREE.Vector2(z, y)));
  return new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(w / 2, 0, 0);
}
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

// Части [геометрия, цвет, форма?]: form(x, y, z) → множитель x — скругляет кузов (см. bodyForm).
function merge(parts, form) {
  const pos = [], nor = [], col = [];
  const c = new THREE.Color();
  for (const [geo, color, shaped = true] of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (form && shaped) {
      const p = g.attributes.position;
      // Нормали остаются от прямоугольной формы: пересчитанные выдают диагонали на скрученных гранях.
      for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * form(p.getY(i), p.getZ(i)));
    }
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    c.set(color);
    for (let i = 0; i < g.attributes.position.count; i++) col.push(c.r, c.g, c.b);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

const clamp01 = (t) => Math.min(1, Math.max(0, t));
// Призма-выдавливание прямоугольное, у настоящих машин борта заваливаются внутрь: чуть ниже пояса,
// сильнее — стойки салона к крыше; углы спереди и сзади скруглены в плане.
function bodyForm(spec, front, rear) {
  const belt = spec.cabin[0][1], top = Math.max(...spec.cabin.map((p) => p[1]));
  const k = spec.taper ?? 0.85, R = spec.cornerR ?? 0.45, corner = spec.corner ?? 0.07;
  return (y, z) => {
    const side = y < belt ? 1 - 0.03 * clamp01((y - 0.45) / (belt - 0.45)) : 0.97 - (0.97 - k) * clamp01((y - belt) / (top - belt));
    const end = Math.max(clamp01((z - front + R) / R), clamp01((rear + R - z) / R));
    return side * (1 - corner * end);
  };
}

// Выпуклый многоугольник (z, y), сдвинутый внутрь на m.
function inset(poly, m) {
  const n = poly.length;
  let area = 0;
  for (let i = 0; i < n; i++) { const [a, b] = poly[i], [c, d] = poly[(i + 1) % n]; area += a * d - c * b; }
  const lines = poly.map(([z0, y0], i) => {
    const [z1, y1] = poly[(i + 1) % n], l = Math.hypot(z1 - z0, y1 - y0), dz = (z1 - z0) / l, dy = (y1 - y0) / l;
    const s = Math.sign(area) * m;
    return { z: z0 - dy * s, y: y0 + dz * s, dz, dy };
  });
  return lines.map((B, i) => {
    const A = lines[(i + n - 1) % n], den = A.dz * B.dy - A.dy * B.dz;
    const t = ((B.z - A.z) * B.dy - (B.y - A.y) * B.dz) / den;
    return [A.z + A.dz * t, A.y + A.dy * t];
  });
}
// Часть многоугольника между z = lo и z = hi.
function clipZ(poly, lo, hi) {
  let p = poly;
  for (const [s, c] of [[1, hi], [-1, lo]]) {
    const out = [];
    p.forEach((a, i) => {
      const b = p[(i + 1) % p.length], ia = s * a[0] <= s * c, ib = s * b[0] <= s * c;
      if (ia) out.push(a);
      if (ia !== ib) out.push([c, a[1] + ((c - a[0]) / (b[0] - a[0])) * (b[1] - a[1])]);
    });
    p = out;
  }
  return p;
}
// Пластина на обоих бортах по многоугольнику профиля: толщина по x от x0 до x1.
const plates = (poly, x0, x1) => [-1, 1].map((s) => prism(poly, x1 - x0).translate((s * (x0 + x1)) / 2, 0, 0));
// Пластина вдоль отрезка профиля a→b (лобовое, заднее стекло): отступ m с концов, ширина w, выступ t наружу.
function panel(a, b, w, m, t, cabin) {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]), dz = (b[0] - a[0]) / l, dy = (b[1] - a[1]) / l;
  const cz = cabin.reduce((s, p) => s + p[0], 0) / cabin.length, cy = cabin.reduce((s, p) => s + p[1], 0) / cabin.length;
  let nz = -dy, ny = dz; // нормаль наружу — от центра салона
  if (nz * (a[0] - cz) + ny * (a[1] - cy) < 0) { nz = -nz; ny = -ny; }
  const p = (q, s, o) => [q[0] + dz * s + nz * o, q[1] + dy * s + ny * o];
  return prism([p(a, m, -0.01), p(b, -m, -0.01), p(b, -m, t), p(a, m, t)], w);
}
// Верх/низ кромки многоугольника на данном z.
function spanAt(poly, z) {
  const ys = [];
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length];
    if ((a[0] - z) * (b[0] - z) <= 0 && a[0] !== b[0]) ys.push(a[1] + ((z - a[0]) / (b[0] - a[0])) * (b[1] - a[1]));
  });
  return [Math.min(...ys), Math.max(...ys)];
}

// Профиль кузова с вырезанными арками: нижняя кромка (первые две точки профиля — задний и
// передний низ) огибает дуги окружностей { z, y, R } — центр дуги и радиус.
export const ARCH_GAP = 0.06; // зазор арки над колесом
export function withArches(body, arches) {
  const [[z0, y0], [z1]] = body;
  const pts = [];
  for (const { z, y, R } of [...arches].sort((a, b) => a.z - b.z)) {
    const t0 = Math.asin(Math.min(1, Math.max(-1, (y0 - y) / R)));
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI - t0 - ((Math.PI - 2 * t0) * i) / 10;
      pts.push([z + R * Math.cos(a), Math.max(y0, y + R * Math.sin(a))]);
    }
  }
  return [[z0, y0], ...pts.filter(([z]) => z > z0 && z < z1), ...body.slice(1)];
}
// Арки под колёса: полукруг чуть больше колеса.
export const wheelArches = (r, zs) => zs.map((z) => ({ z, y: r, R: r + ARCH_GAP }));

// Части модели: paint — под цвет кузова (вершины белые), detail — стекло, бамперы, шины,
// lights — фары/фонари (рисуются без освещения). wheels — для вращения у машины игрока.
// ---------------------------------------------------------------- готовые модели

// Грузит модели с glb до постройки машин: части paint/detail/lights/wheel (вершинные цвета, плоские
// нормали), размеры колёс и длина — из extras сцены. Ошибка — модель остаётся процедурной.
export async function loadVehicleMeshes() {
  const loader = new GLTFLoader();
  await Promise.all(Object.values(MODELS).filter((m) => m.glb).map(async (spec) => {
    try {
      const gltf = await loader.loadAsync(spec.glb);
      const mesh = {};
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        const g = o.geometry.toNonIndexed();
        g.computeVertexNormals();
        mesh[o.name] = g;
      });
      const { wheels, length, hub } = gltf.scene.userData;
      Object.assign(spec.wheels, wheels);
      spec.mesh = { ...mesh, length, hub, wheelL: hub && mirrorX(mesh.wheel) };
    } catch (e) {
      console.warn(`Модель ${spec.name} не загрузилась, рисую процедурную`, e);
    }
  }));
}

// Зеркало по x (колесо левого борта): с переворотом обхода треугольников, иначе грани смотрят внутрь.
function mirrorX(geo) {
  const g = geo.clone().scale(-1, 1, 1);
  for (const a of Object.values(g.attributes)) {
    for (let i = 0; i < a.count; i += 3) {
      for (let k = 0; k < a.itemSize; k++) {
        const t = a.array[(i + 1) * a.itemSize + k];
        a.array[(i + 1) * a.itemSize + k] = a.array[(i + 2) * a.itemSize + k];
        a.array[(i + 2) * a.itemSize + k] = t;
      }
    }
  }
  g.computeVertexNormals();
  return g;
}

// Колесо вокруг своего центра одной геометрией с вершинными цветами. left — для левого борта (x < 0):
// у колеса с диском из модели (hub) диск снаружи, его отражаем.
function wheelGeometry(spec, seg, left = false) {
  const m = spec.mesh;
  if (!m) return merge(wheelParts(spec.wheels, seg));
  if (m.hub) return (left ? m.wheelL : m.wheel).clone();
  return mergeGeometries([m.wheel.clone(), merge(wheelParts(spec.wheels, seg).slice(1))]); // шина — своя
}

function meshParts(spec, wheelsInDetail, wheelsApart) {
  const { r, front: wf, rear: wr, track } = spec.wheels, m = spec.mesh;
  const wheels = [];
  for (const z of [wf, wr]) for (const x of [-track, track]) wheels.push({ x, y: r, z, r, front: z > 0 });
  let detail = m.detail.clone(), wheelGeo;
  if (wheelsInDetail || wheelsApart) {
    const all = wheels.map((p) => wheelGeometry(spec, 12, p.x < 0).translate(p.x, p.y, p.z));
    if (wheelsApart) wheelGeo = mergeGeometries(all);
    else detail = mergeGeometries([detail, ...all]);
  }
  return { paint: m.paint.clone(), detail, lights: m.lights.clone(), wheelGeo, wheels, length: m.length };
}

// wheelsInDetail — колёса в детали (стоящие машины); wheelsApart — колёса отдельной геометрией
// wheelGeo (трафик: кузов кренится, колёса нет).
export function vehicleParts(spec, { wheelsInDetail = false, wheelsApart = false } = {}) {
  if (spec.mesh) return meshParts(spec, wheelsInDetail, wheelsApart);
  const W = spec.width, CW = spec.cabinWidth, front = Math.max(...spec.body.map((p) => p[0])), rear = Math.min(...spec.body.map((p) => p[0]));
  const paint = [], detail = [], lights = [];
  const { r, front: wf, rear: wr, track } = spec.wheels, R = r + ARCH_GAP, y0 = spec.body[0][1];
  const body = withArches(spec.body, wheelArches(r, [wr, wf]));
  paint.push([prism(body, W), '#fff']);
  // Ниши колёс: тёмная вставка между колёсами, чтобы сквозь арки не просвечивала улица.
  for (const z of [wf, wr]) detail.push([box(2 * (track - 0.12), r + R - y0 + 0.01, 2 * R, 0, (y0 + r + R + 0.01) / 2, z), '#111214', false]);
  // Салон под краску, стёкла — пластинами поверх: стойки и рамки получаются сами.
  paint.push([prism(spec.cabin, CW), '#fff']);
  const glass = '#26333f', side = inset(spec.cabin, 0.06);
  const zs = spec.windows.flat();
  if (spec.frame) detail.push(...plates(clipZ(side, Math.min(...zs), Math.max(...zs)), CW / 2 - 0.01, CW / 2 + 0.008).map((g) => [g, spec.frame]));
  for (const [hi, lo] of spec.windows) detail.push(...plates(clipZ(side, lo, hi), CW / 2 - 0.01, CW / 2 + 0.014).map((g) => [g, glass]));
  const c = spec.cabin;
  detail.push([panel(c[0], c[1], CW - 0.1, 0.06, 0.012, c), glass]);
  if (!spec.box) detail.push([panel(c[2], c[3], CW - 0.12, 0.06, 0.012, c), glass]);
  if (spec.box) {
    const b = spec.box;
    const geo = box(b.width, b.y1 - b.y0, b.from - b.to, 0, (b.y0 + b.y1) / 2, (b.from + b.to) / 2);
    (b.color === 'paint' ? paint : detail).push([geo, b.color === 'paint' ? '#fff' : b.color, false]);
  }
  // Швы дверей и ручки, зеркала.
  const trim = spec.trim || '#1a1b1d', doors = [...(spec.doors || [])].sort((a, b) => b - a);
  doors.forEach((z, i) => {
    let bottom = y0;
    for (const w of [wf, wr]) if (Math.abs(z - w) < R) bottom = Math.max(bottom, r + Math.sqrt(R * R - (z - w) ** 2));
    const top = spanAt(body, z)[1];
    detail.push(...plates([[z - 0.006, bottom + 0.04], [z + 0.006, bottom + 0.04], [z + 0.006, top - 0.03], [z - 0.006, top - 0.03]], W / 2 - 0.01, W / 2 + 0.004).map((g) => [g, '#141518']));
    if (i > 0 && !spec.box) detail.push(...plates([[z + 0.1, top - 0.13], [z + 0.24, top - 0.13], [z + 0.24, top - 0.1], [z + 0.1, top - 0.1]], W / 2 - 0.01, W / 2 + 0.012).map((g) => [g, trim]));
  });
  if (spec.box && doors.length > 1) {
    const z = doors[1], top = spanAt(body, z)[1];
    detail.push(...plates([[z + 0.1, top - 0.13], [z + 0.24, top - 0.13], [z + 0.24, top - 0.1], [z + 0.1, top - 0.1]], W / 2 - 0.01, W / 2 + 0.012).map((g) => [g, trim]));
  }
  for (const s of [-1, 1]) {
    const [mz, my] = c[0];
    detail.push([box(0.06, 0.04, 0.05, s * (CW / 2 + 0.06), my + 0.06, mz - 0.14), trim]);
    detail.push([box(0.07, 0.11, 0.16, s * (CW / 2 + 0.13), my + 0.1, mz - 0.14), trim]);
  }
  // Бамперы с загибом на борта, решётка, номера.
  // bumper: 'paint' — бамперы в цвет кузова (снизу чёрная губа).
  const bh = spec.bumperH || 0.16, by = y0 + 0.02 + bh / 2;
  const [bumpers, bc] = spec.bumper === 'paint' ? [paint, '#fff'] : [detail, spec.bumper];
  for (const [z, s] of [[front, 1], [rear, -1]]) {
    if (spec.bumper === 'paint') { detail.push([box(W - 0.3, 0.05, 0.1, 0, y0 + 0.03, z + s * 0.02), '#1b1c1f']); continue; }
    bumpers.push([box(W + 0.04, bh, 0.14, 0, by, z + s * 0.02), bc]);
    for (const x of [-1, 1]) bumpers.push([box(0.05, bh, 0.34, x * (W / 2 + 0.01), by, z - s * 0.12), bc]);
    detail.push([box(0.52, 0.11, 0.02, 0, s > 0 ? by : Math.max(by + bh / 2 + 0.1, 0.6), z + s * (s > 0 ? 0.1 : 0.02)), '#f0f0ea']);
  }
  // Выштамповка на борту — полоса чуть темнее краски.
  if (spec.crease) {
    const [[za, ya], [zb, yb]] = spec.crease;
    // Выступ 2 см: борт после bodyForm прогибается между вершинами, тоньше — пластина тонет.
    const band = (d0, d1, c) => paint.push(...plates([[za, ya + d0], [za, ya + d1], [zb, yb + d1], [zb, yb + d0]], W / 2 - 0.01, W / 2 + 0.02).map((g) => [g, c]));
    band(-0.025, 0.012, '#9a9a9a'); // тень под острой кромкой
    band(-0.08, -0.025, '#c8c8c8'); // вогнутость ниже
  }
  // Фары и фонари.
  const fy = 0.66;
  if (spec.lights === 'vesta') {
    // Веста: фары на углах капота единым куском с заходом на крыло, ниже — решётка-трапеция
    // с эмблемой, большой воздухозаборник с номером, противотуманки; фонари тоже заходят на борта.
    const chrome = '#d4d7da', side = (poly, w, c, to) => to.push(...plates(poly, W / 2 - w, W / 2 + 0.006).map((g) => [g, c]));
    side([[2.262, 0.6], [2.185, 0.725], [1.95, 0.818], [1.76, 0.85], [1.84, 0.79], [2.0, 0.745], [2.2, 0.63]], 0.46, '#fff6d8', lights);
    const lean = (g) => g.rotateX(-0.12), trap = (top, bottom, h, d) => new THREE.ExtrudeGeometry(new THREE.Shape([[-bottom / 2, -h / 2], [bottom / 2, -h / 2], [top / 2, h / 2], [-top / 2, h / 2]].map(([x, y]) => new THREE.Vector2(x, y))), { depth: d, bevelEnabled: false }).translate(0, 0, -d / 2);
    detail.push([lean(trap(0.7, 0.58, 0.15, 0.05)).translate(0, 0.635, 2.25), chrome]);
    detail.push([lean(trap(0.64, 0.52, 0.11, 0.05)).translate(0, 0.635, 2.257), spec.grille]);
    detail.push([box(0.13, 0.065, 0.03, 0, 0.66, 2.275), chrome]);
    detail.push([box(1.0, 0.13, 0.04, 0, 0.47, 2.25), spec.grille], [box(0.52, 0.11, 0.02, 0, 0.47, 2.275), '#f0f0ea']);
    for (const s of [-1, 1]) {
      detail.push([box(0.14, 0.1, 0.04, s * (W / 2 - 0.2), 0.47, 2.245), spec.grille]);
      lights.push([box(0.08, 0.06, 0.03, s * (W / 2 - 0.2), 0.47, 2.26), '#fff6d8']);
    }
    side([[-2.24, 0.82], [-2.205, 0.958], [-2.12, 1.046], [-1.88, 1.056], [-1.9, 0.98], [-2.1, 0.94], [-2.2, 0.82]], 0.42, '#ff2a1a', lights);
    detail.push([box(0.52, 0.11, 0.02, 0, 0.68, rear - 0.025), '#f0f0ea']);
    paint.push([box(W - 0.4, 0.03, 0.08, 0, 1.055, -2.08), '#fff']); // спойлер на крышке багажника
  } else {
    const L = { w: 0.34, h: 0.15, ...spec.lamp }, T = { w: 0.3, h: 0.14, y: 0.72, ...spec.tail };
    const lx = W / 2 - 0.06 - L.w / 2, gw = 2 * (lx - L.w / 2) - 0.04;
    detail.push([box(gw, L.h, 0.04, 0, fy, front + 0.01), spec.grille]);
    if (spec.grilleBars) for (const dy of [-0.035, 0.035]) detail.push([box(gw - 0.04, 0.018, 0.05, 0, fy + dy, front + 0.012), spec.grilleBars]);
    for (const s of [-1, 1]) {
      detail.push([box(L.w + 0.03, L.h + 0.03, 0.04, s * lx, fy, front + 0.005), spec.grille]);
      lights.push([box(L.w, L.h, 0.04, s * lx, fy, front + 0.012), '#fff6d8']);
      lights.push([box(T.w, T.h, 0.04, s * (W / 2 - 0.06 - T.w / 2), T.y, rear - 0.01), '#ff2a1a']);
    }
  }
  // Колёса.
  const wheels = [];
  for (const z of [wf, wr]) for (const x of [-track, track]) wheels.push({ x, y: r, z, r, front: z > 0 });
  const wheelList = [];
  if (wheelsInDetail || wheelsApart) for (const w of wheels) for (const [g, c] of wheelParts(spec.wheels, 12)) (wheelsApart ? wheelList : detail).push([g.translate(w.x, w.y, w.z), c, false]);
  const form = bodyForm(spec, front, rear);
  return { paint: merge(paint, form), detail: merge(detail, form), lights: merge(lights, form), wheelGeo: wheelsApart ? merge(wheelList) : undefined, wheels, length: front - rear };
}

// Колесо вокруг своего центра: шина и штампованный диск с колпаком; alloy — литой диск со спицами.
function wheelParts({ r, alloy }, seg) {
  const disc = (k, w, n = 8) => new THREE.CylinderGeometry(r * k, r * k, w, n).rotateZ(Math.PI / 2);
  const parts = [[disc(1, 0.22, seg), '#151618']];
  if (!alloy) return [...parts, [disc(0.55, 0.23), '#9ea3a8']];
  parts.push([disc(0.8, 0.225, seg), '#c4c8cc'], [disc(0.68, 0.23, seg), '#2a2c30'], [disc(0.18, 0.24), '#c4c8cc']);
  for (let i = 0; i < 5; i++) parts.push([new THREE.BoxGeometry(0.235, 0.05, r * 1.4).rotateX((i * Math.PI) / 5), '#c4c8cc']);
  return parts;
}

// Модель для машины игрока: краска — материалом, колёса — отдельными узлами (крутятся, рулят).
const wheelMat = new THREE.MeshLambertMaterial({ vertexColors: true });
export function buildPlayerModel(key, color) {
  const spec = MODELS[key] || MODELS[DEFAULT_MODEL];
  const parts = vehicleParts(spec);
  const g = new THREE.Group();
  const paintMat = new THREE.MeshLambertMaterial({ color: color || spec.colors[0], vertexColors: true });
  const meshes = [
    new THREE.Mesh(parts.paint, paintMat),
    new THREE.Mesh(parts.detail, new THREE.MeshLambertMaterial({ vertexColors: true })),
    new THREE.Mesh(parts.lights, new THREE.MeshBasicMaterial({ vertexColors: true })),
  ];
  // Кузов — в своей группе с осью крена на высоте центра крена (колёса не кренятся, см. Car.bodyRoll).
  const body = new THREE.Group(), ROLL_CENTER = 0.45;
  body.position.y = ROLL_CENTER;
  for (const mesh of meshes) mesh.position.y = -ROLL_CENTER;
  body.add(...meshes);
  g.add(body);
  g.userData.body = body;
  g.userData.wheels = [];
  const wheelGeo = [wheelGeometry(spec, 14), wheelGeometry(spec, 14, true)];
  for (const w of parts.wheels) {
    const pivot = new THREE.Group();
    pivot.position.set(w.x, w.y, w.z);
    const wheel = new THREE.Group();
    wheel.add(new THREE.Mesh(wheelGeo[w.x < 0 ? 1 : 0], wheelMat));
    pivot.add(wheel);
    g.add(pivot);
    g.userData.wheels.push({ pivot, w: wheel, front: w.front });
  }
  g.userData.paint = paintMat;
  g.userData.length = parts.length;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

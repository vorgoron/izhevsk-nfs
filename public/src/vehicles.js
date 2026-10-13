// Машины ижевского автопрома: процедурные модели по профилю сбоку (вытянутому на ширину)
// и характеристики для физики. Размеры — по паспортным, силуэты упрощены.
import * as THREE from 'three';

// Профили: [z, y] — z вперёд (перед машины при +len/2), y вверх, от земли.
// body — кузов (краска), cabin — остекление, roof — крыша [z от, z до], pillars — стойки (z).
export const MODELS = {
  oda: {
    name: 'ИЖ-2126 «Ода»', years: '1990–2005',
    about: 'Пятидверный хэтчбек — первая собственная легковая модель Ижмаша.',
    width: 1.65, cabinWidth: 1.42,
    body: [[-2.03, 0.3], [2.03, 0.3], [2.05, 0.56], [1.96, 0.78], [0.95, 0.9], [-1.9, 0.94], [-2.05, 0.62]],
    cabin: [[0.95, 0.88], [0.18, 1.39], [-1.22, 1.4], [-1.93, 0.96], [-1.9, 0.9]],
    roof: [0.14, -1.24, 1.41], pillars: [-0.45],
    wheels: { r: 0.29, front: 1.26, rear: -1.21, track: 0.7 },
    bumper: '#3a3c40', grille: '#202225', lights: 'rect',
    colors: ['#7c1622', '#e9e9e6', '#1f5e6b', '#2c5aa0', '#8c9196', '#2f6b3a', '#d8641e', '#1e1f22'],
    stats: { kmh: 165, accel: 0.86, grip: 1.0 },
  },
  m412: {
    name: 'Москвич-412 (ИЖ-412)', years: '1967–1998',
    about: 'Седан, который Ижмаш выпускал три десятилетия; ралли «Лондон — Сидней» и экспорт.',
    width: 1.55, cabinWidth: 1.36,
    body: [[-2.06, 0.32], [2.06, 0.32], [2.08, 0.58], [2.02, 0.8], [0.85, 0.87], [-1.1, 0.9], [-2.0, 0.88], [-2.07, 0.62]],
    cabin: [[0.85, 0.86], [0.24, 1.44], [-0.72, 1.46], [-1.15, 0.9]],
    roof: [0.2, -0.76, 1.47], pillars: [-0.25],
    wheels: { r: 0.3, front: 1.2, rear: -1.2, track: 0.64 },
    bumper: '#c8ccd0', grille: '#c8ccd0', lights: 'rect',
    colors: ['#9fc2d6', '#e8e2c8', '#6b1420', '#3b6e4f', '#f0f0ec', '#c9a227', '#2b3a66', '#5a5f66'],
    stats: { kmh: 155, accel: 0.8, grip: 0.95 },
  },
  kombi: {
    name: 'ИЖ-2125 «Комби»', years: '1973–1997',
    about: 'Лифтбек на базе 412-го — один из первых советских хэтчбеков.',
    width: 1.55, cabinWidth: 1.36,
    body: [[-2.06, 0.32], [2.06, 0.32], [2.08, 0.58], [2.02, 0.8], [0.85, 0.87], [-1.95, 0.92], [-2.07, 0.62]],
    cabin: [[0.85, 0.86], [0.24, 1.44], [-0.95, 1.45], [-1.95, 0.94], [-1.95, 0.9]],
    roof: [0.2, -0.98, 1.46], pillars: [-0.3],
    wheels: { r: 0.3, front: 1.2, rear: -1.2, track: 0.64 },
    bumper: '#c8ccd0', grille: '#c8ccd0', lights: 'rect',
    colors: ['#c64a1e', '#e8e2c8', '#2e8b8b', '#f2c230', '#6b1420', '#4a6b2f', '#e9e9e6', '#3d4a5c'],
    stats: { kmh: 150, accel: 0.8, grip: 0.95 },
  },
  kabluk: {
    name: 'ИЖ-2715 «Каблучок»', years: '1972–2001',
    about: 'Пикап-фургон с высокой будкой — главная развозная машина 80-х.',
    width: 1.55, cabinWidth: 1.36,
    body: [[-2.04, 0.34], [2.06, 0.34], [2.08, 0.58], [2.02, 0.8], [0.85, 0.87], [-0.42, 0.9], [-2.04, 0.9]],
    cabin: [[0.85, 0.86], [0.24, 1.44], [-0.32, 1.44], [-0.4, 0.9]],
    roof: [0.2, -0.38, 1.45], pillars: [],
    box: { from: -0.45, to: -2.06, y0: 0.86, y1: 1.98, width: 1.6, color: 'paint' },
    wheels: { r: 0.3, front: 1.2, rear: -1.2, track: 0.64 },
    bumper: '#c8ccd0', grille: '#c8ccd0', lights: 'rect',
    colors: ['#3b6e4f', '#e9e9e6', '#2c5aa0', '#c9a227', '#7a2f2f', '#5a6e8c', '#8c9196', '#d8641e'],
    stats: { kmh: 135, accel: 0.7, grip: 0.9 },
  },
  odavan: {
    name: 'ИЖ-27175 (фургон «Ода»)', years: '1997–2012',
    about: '«Каблук» нового поколения: перед от «Оды» и пластиковая будка.',
    width: 1.65, cabinWidth: 1.42,
    body: [[-2.03, 0.32], [2.03, 0.32], [2.05, 0.56], [1.96, 0.78], [0.95, 0.9], [-0.5, 0.92], [-2.03, 0.92]],
    cabin: [[0.95, 0.88], [0.18, 1.39], [-0.42, 1.4], [-0.5, 0.92]],
    roof: [0.14, -0.46, 1.41], pillars: [],
    box: { from: -0.52, to: -2.1, y0: 0.88, y1: 1.92, width: 1.68, color: '#ecebe6' },
    wheels: { r: 0.29, front: 1.26, rear: -1.21, track: 0.7 },
    bumper: '#3a3c40', grille: '#202225', lights: 'rect',
    colors: ['#e9e9e6', '#7c1622', '#2c5aa0', '#2f6b3a', '#8c9196', '#1e1f22', '#c9a227', '#1f5e6b'],
    stats: { kmh: 140, accel: 0.72, grip: 0.9 },
  },
  vesta: {
    name: 'LADA Vesta', years: 'с 2015',
    about: 'Собирается на «ИжАвто» — главный ижевский автомобиль сегодня.',
    width: 1.76, cabinWidth: 1.5,
    body: [[-2.2, 0.34], [2.2, 0.34], [2.23, 0.6], [2.12, 0.84], [1.0, 0.99], [-1.62, 1.03], [-2.16, 1.0], [-2.23, 0.64]],
    cabin: [[1.0, 0.98], [0.12, 1.48], [-0.86, 1.5], [-1.66, 1.03]],
    roof: [0.08, -0.9, 1.51], pillars: [-0.38],
    wheels: { r: 0.32, front: 1.38, rear: -1.25, track: 0.76 },
    bumper: '#2a2c30', grille: '#1b1c1f', lights: 'xface',
    colors: ['#e9e9e6', '#c63a2a', '#1e1f22', '#8c9196', '#2c5aa0', '#e07a1f', '#5a3a6b', '#3b5f4a'],
    stats: { kmh: 190, accel: 1.0, grip: 1.06 },
  },
};
export const DEFAULT_MODEL = 'oda';

// ---------------------------------------------------------------- геометрия

// Профиль (z, y) → призма шириной w по x, по центру.
function prism(profile, w) {
  const shape = new THREE.Shape(profile.map(([z, y]) => new THREE.Vector2(z, y)));
  return new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(w / 2, 0, 0);
}
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

function merge(parts) {
  const pos = [], nor = [], col = [];
  const c = new THREE.Color();
  for (const [geo, color] of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo;
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

// Части модели: paint — под цвет кузова (вершины белые), detail — стекло, бамперы, шины,
// lights — фары/фонари (рисуются без освещения). wheels — для вращения у машины игрока.
export function vehicleParts(spec, { wheelsInDetail = false } = {}) {
  const W = spec.width, front = Math.max(...spec.body.map((p) => p[0])), rear = Math.min(...spec.body.map((p) => p[0]));
  const paint = [], detail = [], lights = [];
  paint.push([prism(spec.body, W), '#fff']);
  detail.push([prism(spec.cabin, spec.cabinWidth), '#26333f']);
  const [r0, r1, ry] = spec.roof;
  paint.push([box(spec.cabinWidth + 0.03, 0.07, r0 - r1, 0, ry, (r0 + r1) / 2), '#fff']);
  for (const z of spec.pillars) paint.push([box(spec.cabinWidth + 0.04, ry - 0.9, 0.12, 0, (ry + 0.9) / 2, z), '#fff']);
  if (spec.box) {
    const b = spec.box;
    const geo = box(b.width, b.y1 - b.y0, b.from - b.to, 0, (b.y0 + b.y1) / 2, (b.from + b.to) / 2);
    (b.color === 'paint' ? paint : detail).push([geo, b.color === 'paint' ? '#fff' : b.color]);
  }
  // Бамперы, решётка.
  detail.push([box(W + 0.04, 0.16, 0.14, 0, 0.42, front + 0.02), spec.bumper]);
  detail.push([box(W + 0.04, 0.16, 0.14, 0, 0.42, rear - 0.02), spec.bumper]);
  detail.push([box(W * 0.45, 0.16, 0.04, 0, 0.64, front + 0.02), spec.grille]);
  // Фары и фонари.
  const fy = 0.66;
  if (spec.lights === 'xface') {
    for (const s of [-1, 1]) {
      lights.push([box(0.42, 0.11, 0.04, s * (W / 2 - 0.3), fy + 0.08, front - 0.02), '#fff6d8']);
      detail.push([box(0.08, 0.36, 0.05, s * 0.32, fy - 0.05, front + 0.05).rotateZ(s * 0.5), '#c8ccd0']);
      lights.push([box(0.5, 0.1, 0.04, s * (W / 2 - 0.32), 0.86, rear + 0.04), '#ff2a1a']);
    }
  } else {
    for (const s of [-1, 1]) {
      lights.push([box(0.34, 0.15, 0.04, s * (W / 2 - 0.27), fy, front + 0.01), '#fff6d8']);
      lights.push([box(0.3, 0.14, 0.04, s * (W / 2 - 0.25), 0.72, rear - 0.01), '#ff2a1a']);
    }
  }
  // Колёса.
  const { r, front: wf, rear: wr, track } = spec.wheels;
  const wheels = [];
  for (const z of [wf, wr]) for (const x of [-track, track]) wheels.push({ x, y: r, z, r, front: z > 0 });
  if (wheelsInDetail) {
    for (const w of wheels) {
      detail.push([new THREE.CylinderGeometry(w.r, w.r, 0.22, 12).rotateZ(Math.PI / 2).translate(w.x, w.y, w.z), '#151618']);
    }
  }
  return { paint: merge(paint), detail: merge(detail), lights: merge(lights), wheels, length: front - rear };
}

// Модель для машины игрока: краска — материалом, колёса — отдельными узлами (крутятся, рулят).
const tireMat = new THREE.MeshLambertMaterial({ color: '#151618' });
const hubMat = new THREE.MeshLambertMaterial({ color: '#9ea3a8' });
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
  g.add(...meshes);
  g.userData.wheels = [];
  const tire = new THREE.CylinderGeometry(spec.wheels.r, spec.wheels.r, 0.22, 14).rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(spec.wheels.r * 0.55, spec.wheels.r * 0.55, 0.23, 8).rotateZ(Math.PI / 2);
  for (const w of parts.wheels) {
    const pivot = new THREE.Group();
    pivot.position.set(w.x, w.y, w.z);
    const wheel = new THREE.Group();
    wheel.add(new THREE.Mesh(tire, tireMat), new THREE.Mesh(hub, hubMat));
    pivot.add(wheel);
    g.add(pivot);
    g.userData.wheels.push({ pivot, w: wheel, front: w.front });
  }
  g.userData.paint = paintMat;
  g.userData.length = parts.length;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// Мелочи из OSM в квадрате (точки — World.#initPoints): разметка переходов и лежачих полицейских на полотне,
// дорожные знаки, шлагбаумы, столбики, детские площадки — их сносит машина (breakables.js); трубы, мачты,
// водонапорные башни, краны, опоры ЛЭП с проводами — стоят (стены у них — в World).
import * as THREE from 'three';
import { BUMP, BUMP_RAMP } from './world.js';
import { NIGHT } from './night.js';

// ---------------------------------------------------------------- геометрия

function paint(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo, c = new THREE.Color(color), n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function merge(geos, names = ['position', 'normal', 'color']) {
  const out = new THREE.BufferGeometry();
  for (const k of names) {
    const size = geos[0].attributes[k].itemSize, arr = [];
    for (const g of geos) arr.push(...g.attributes[k].array);
    out.setAttribute(k, new THREE.Float32BufferAttribute(arr, size));
  }
  return out;
}

const box = (w, h, d, x, y, z, color) => paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);
const cyl = (rTop, rBot, h, y, color, seg = 10) => paint(new THREE.CylinderGeometry(rTop, rBot, h, seg).translate(0, y + h / 2, 0), color);
const _up = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3(), _q = new THREE.Quaternion();
// Брус толщиной t от a до b ([x, y, z]).
function beam(a, b, t, color) {
  _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _d.length();
  const g = new THREE.BoxGeometry(t, len, t);
  g.applyQuaternion(_q.setFromUnitVectors(_up, _d.normalize()));
  return paint(g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), color);
}

// Решётчатая ферма: четыре ноги от полуширины w0 внизу до w1 вверху на высотах y0…y1, пояса и раскосы через step м.
function lattice(y0, y1, w0, w1, step, t, color) {
  const parts = [], n = Math.max(1, Math.round((y1 - y0) / step));
  const at = (k) => [y0 + ((y1 - y0) * k) / n, w0 + ((w1 - w0) * k) / n];
  const C = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [u, v] of C) parts.push(beam([u * w0, y0, v * w0], [u * w1, y1, v * w1], t * 1.4, color));
  for (let k = 0; k < n; k++) {
    const [ya, wa] = at(k), [yb, wb] = at(k + 1);
    for (let s = 0; s < 4; s++) {
      const [u0, v0] = C[s], [u1, v1] = C[(s + 1) % 4];
      parts.push(beam([u0 * wb, yb, v0 * wb], [u1 * wb, yb, v1 * wb], t, color));
      parts.push(beam([u0 * wa, ya, v0 * wa], [u1 * wb, yb, v1 * wb], t * 0.8, color));
    }
  }
  return parts;
}

// Высокое: модель высотой H (экземпляр масштабируется до своей высоты целиком), точки крепления проводов
// WIRE [x, y] — траверсы вдоль x (поперёк линии). Цвет ламп (#fff6c8) и огней (#ff2a1a) ночью светится.
const LAMP = '#fff6c8', RED = '#ff2a1a';
const STEEL = '#8e959b', CONCRETE = '#a9a59c', YELLOW = '#d9a91c';
const ZINC = '#b9bec2', PANEL = '#e6e7e3';
// Секторы сотовой связи: по три белые панели-антенны w × h на радиусе r вокруг оси, на высоте y (низ).
const sectors = (r, y, w, h, a0 = 0) => [0, 1, 2].map((i) =>
  paint(new THREE.BoxGeometry(w, h, 0.12).translate(0, y + h / 2, r).rotateY(a0 + (i * 2 * Math.PI) / 3), PANEL));
// Ограждение площадки: стойки и поручень по восьмиугольнику радиуса r на высоте y.
const railing = (r, y, color) => Array.from({ length: 8 }, (_, i) => {
  const a = (i * Math.PI) / 4, b = ((i + 1) * Math.PI) / 4;
  return [beam([r * Math.cos(a), y, r * Math.sin(a)], [r * Math.cos(a), y + 1, r * Math.sin(a)], 0.05, color),
    beam([r * Math.cos(a), y + 1, r * Math.sin(a)], [r * Math.cos(b), y + 1, r * Math.sin(b)], 0.05, color)];
}).flat();
const TOWERS = {
  ch: { H: 50, make: () => [cyl(1.3, 2.4, 44, 0, '#a7a198', 14), cyl(1.25, 1.3, 2, 44, '#b8382c', 14), cyl(1.22, 1.25, 2, 46, '#dcdcd6', 14),
    cyl(1.2, 1.22, 2, 48, '#b8382c', 14), box(0.3, 0.3, 0.3, 1.2, 49.6, 0, RED), box(0.3, 0.3, 0.3, -1.2, 49.6, 0, RED)] },
  ms: { H: 40, make: () => [...lattice(0, 32, 1.6, 0.45, 4, 0.1, STEEL), ...lattice(32, 38, 0.45, 0.3, 3, 0.08, STEEL),
    box(2.2, 0.15, 2.2, 0, 26, 0, STEEL), ...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([u, v]) => box(0.35, 1.6, 0.35, u * 0.7, 33, v * 0.7, '#e4e4e0')),
    cyl(0.04, 0.06, 2, 38, STEEL, 5), box(0.25, 0.25, 0.25, 0, 40, 0, RED)] },
  // Вышка сотового оператора (man_made=mast): оцинкованная труба-монополь с лестницей, площадка с ограждением,
  // над ней антенны секторами и тарелка радиорелейки, внизу шкафы оборудования.
  mm: { H: 30, make: () => [box(2.6, 0.3, 2.6, 0, 0.15, 0, CONCRETE), cyl(0.3, 0.5, 25, 0.3, ZINC, 12),
    beam([-0.17, 0.3, 0.56], [-0.17, 25, 0.36], 0.05, STEEL), beam([0.17, 0.3, 0.56], [0.17, 25, 0.36], 0.05, STEEL),
    box(1, 1.8, 0.7, 1.2, 1.2, 0.2, '#d4d6d2'), box(0.7, 1.3, 0.6, -1.1, 0.95, -0.5, '#c4c8c4'),
    cyl(1.4, 1.4, 0.15, 25.2, STEEL, 8), ...railing(1.4, 25.35, STEEL), cyl(0.14, 0.14, 4.4, 25.3, ZINC, 8),
    ...sectors(1.1, 26.2, 0.32, 1.7), ...sectors(0.45, 27.9, 0.26, 1.3, Math.PI / 3),
    paint(new THREE.CylinderGeometry(0.4, 0.4, 0.2, 12).rotateX(Math.PI / 2).translate(0, 23.6, 0.7), PANEL),
    box(0.25, 0.25, 0.25, 0, 29.85, 0, RED)] },
  // Мачта на крыше дома: труба на раме, антенны секторами.
  mr: { H: 7, make: () => [box(1.6, 0.25, 1.6, 0, 0.12, 0, STEEL), cyl(0.09, 0.11, 6.6, 0.25, ZINC, 8),
    ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([u, v]) => beam([u * 0.7, 0.25, v * 0.7], [0, 2.4, 0], 0.05, STEEL)),
    ...sectors(0.4, 4.6, 0.3, 1.6), box(0.6, 1, 0.45, 0.55, 0.75, -0.5, '#d4d6d2'), box(0.2, 0.2, 0.2, 0, 6.95, 0, RED)] },
  ml: { H: 25, make: () => [cyl(0.22, 0.4, 24, 0, '#9aa0a5', 8), box(3, 1.4, 0.3, 0, 24.4, 0.3, '#4b5054'), box(2.6, 1.1, 0.06, 0, 24.4, 0.47, LAMP)] },
  wt: { H: 26, make: () => [cyl(1.5, 1.9, 19, 0, '#9b5b43', 12), cyl(4, 3.2, 1.5, 19, '#8a8a84', 14), cyl(4, 4, 4, 20.5, '#c9c4b8', 14),
    cyl(0.4, 4.3, 1.5, 24.5, '#6b6e70', 14)] },
  tw: { H: 32, make: () => [cyl(1.4, 2.2, 27, 0, CONCRETE, 12), cyl(2.6, 2.6, 2.6, 27, '#7e8a90', 12), cyl(0.1, 0.2, 2.4, 29.6, STEEL, 6),
    box(0.25, 0.25, 0.25, 0, 32, 0, RED)] },
  cr: { H: 45, make: () => [...lattice(0, 40, 0.8, 0.8, 2.5, 0.12, YELLOW), box(2.2, 2, 2.2, 0, 41, 0, YELLOW), box(1.6, 1.6, 1.6, 1.4, 40.6, 1.2, '#e8e2c8'),
    beam([0, 42.3, 0], [0, 42.3, 40], 1.1, YELLOW), beam([0, 42.3, 0], [0, 42.3, -12], 1, YELLOW),
    box(2.4, 2.4, 3, 0, 41.5, -11, '#8f8c84'), beam([0, 45, 0], [0, 42.8, 30], 0.08, '#4a4a46'), beam([0, 45, 0], [0, 42.8, -11], 0.08, '#4a4a46'),
    beam([0, 42, 0], [0, 45, 0], 0.5, YELLOW), box(0.3, 0.3, 0.3, 0, 45.2, 0, RED)] },
  pt: { H: 27, make: () => [...lattice(0, 17, 2, 0.6, 3.4, 0.12, STEEL), ...lattice(17, 25, 0.6, 0.35, 2.7, 0.1, STEEL), cyl(0.05, 0.1, 2, 25, STEEL, 5),
    ...[[16.7, 4.5], [20.5, 6], [24.3, 4.5]].flatMap(([y, l]) => [beam([-l, y, 0], [l, y, 0], 0.22, STEEL), beam([-l, y, 0], [0, y + 1.6, 0], 0.08, STEEL),
      beam([l, y, 0], [0, y + 1.6, 0], 0.08, STEEL), box(0.16, 1.4, 0.16, -l + 0.2, y - 0.75, 0, '#c8d4c8'), box(0.16, 1.4, 0.16, l - 0.2, y - 0.75, 0, '#c8d4c8')])],
  WIRE: [[-4.3, 15.2], [4.3, 15.2], [-5.8, 19], [5.8, 19], [-4.3, 22.8], [4.3, 22.8]] },
  pp: { H: 10, make: () => [cyl(0.11, 0.17, 10, 0, '#9d9a91', 8), box(2, 0.12, 0.12, 0, 9.2, 0, '#5d6266'), box(0.08, 0.25, 0.08, -0.9, 9.35, 0, '#c8d4c8'),
    box(0.08, 0.25, 0.08, 0.9, 9.35, 0, '#c8d4c8')], WIRE: [[-0.9, 9.45], [0.9, 9.45], [0, 10]] },
};

// Знаки: атлас 128 px на знак, верхний ряд — лицевые стороны, нижний — серые изнанки той же формы.
const SIGNS = ['g', 's', 'z', 'b'];
const SIGN_SIZE = { g: 0.8, s: 0.7, z: 0.7, b: 0.7 }, SIGN_Y = 2.2;
function drawSign(g, s, face) {
  const red = face ? '#c8242a' : '#7c7f82', white = face ? '#f4f4ef' : '#8d9093', blue = face ? '#1e5aa8' : '#7c7f82', ink = face ? '#1b1b1b' : '#8d9093';
  const poly = (pts, fill) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fillStyle = fill; g.fill(); };
  if (s === 'g') { poly([[4, 10], [124, 10], [64, 118]], red); poly([[24, 22], [104, 22], [64, 94]], white); }
  if (s === 's') {
    const oct = (r) => Array.from({ length: 8 }, (_, i) => [64 + r * Math.cos(Math.PI / 8 + (i * Math.PI) / 4), 64 + r * Math.sin(Math.PI / 8 + (i * Math.PI) / 4)]);
    poly(oct(62), white); poly(oct(56), red);
    if (face) { g.fillStyle = white; g.font = 'bold 34px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('STOP', 64, 66); }
  }
  if (s === 'z' || s === 'b') {
    poly([[2, 2], [126, 2], [126, 126], [2, 126]], blue);
    poly([[64, 12], [116, 108], [12, 108]], white);
    if (face && s === 'z') {
      g.fillStyle = ink;
      g.beginPath(); g.arc(66, 46, 6, 0, 7); g.fill();
      g.lineWidth = 6; g.strokeStyle = ink; g.beginPath(); g.moveTo(64, 54); g.lineTo(60, 74); g.lineTo(50, 88); g.moveTo(60, 74); g.lineTo(72, 88);
      g.moveTo(52, 62); g.lineTo(74, 64); g.stroke();
      g.fillStyle = ink; for (let i = 0; i < 4; i++) g.fillRect(34 + i * 16, 92, 9, 10);
    }
    if (face && s === 'b') { g.fillStyle = ink; g.beginPath(); g.ellipse(64, 96, 30, 22, 0, Math.PI, 0); g.fill(); g.fillRect(24, 94, 80, 6); }
  }
}

function signAtlas(renderer) {
  const c = document.createElement('canvas');
  c.width = 128 * SIGNS.length; c.height = 256;
  const g = c.getContext('2d');
  SIGNS.forEach((s, i) => {
    for (const face of [true, false]) {
      g.save(); g.translate(i * 128, face ? 0 : 128); drawSign(g, s, face); g.restore();
    }
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

// Знак на стойке: лицом к +z, UV — в свою ячейку атласа; стойка — в серую середину изнанки знака «STOP».
function signGeometry(s) {
  const i = SIGNS.indexOf(s), n = SIGNS.length, size = SIGN_SIZE[s];
  const plate = (back) => {
    const g = new THREE.PlaneGeometry(size, size);
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, (i + (back ? 1 - uv.getX(k) : uv.getX(k))) / n, (back ? 0 : 0.5) + uv.getY(k) * 0.5);
    if (back) g.rotateY(Math.PI);
    return g.translate(0, SIGN_Y + size / 2, back ? -0.01 : 0.01).toNonIndexed();
  };
  const post = new THREE.CylinderGeometry(0.035, 0.035, SIGN_Y + size * 0.6, 6).translate(0, (SIGN_Y + size * 0.6) / 2, -0.04).toNonIndexed();
  const uv = post.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, (1 + 0.5) / n, 0.25);
  return merge([plate(false), plate(true), post], ['position', 'normal', 'uv']);
}

// Шлагбаум: стойка (основание в 0) и стрела вдоль +x длиной 1 (экземпляр растягивается по ширине дороги).
const GATE_Y = 1;
const gatePost = () => merge([box(0.3, 1.1, 0.3, 0, 0.55, 0, '#d8d4c8'), box(0.34, 0.25, 0.34, 0, 0.9, 0, '#c8242a')]);
const gateArm = () => merge(Array.from({ length: 8 }, (_, i) => box(1 / 8, 0.09, 0.06, (i + 0.5) / 8, GATE_Y, 0, i % 2 ? '#f2f2ec' : '#c8242a')));

// Детская площадка: горка и качели (из основания вдоль +x).
function playGeometry() {
  const P = [];
  P.push(box(0.9, 1.5, 0.9, -1.5, 0.75, 0, '#3f7fbf'), box(1.1, 0.12, 1.1, -1.5, 1.56, 0, '#d9a91c'), box(1, 0.9, 0.06, -1.5, 2.1, 0, '#c8242a'));
  P.push(beam([-1.05, 1.56, 0], [0.6, 0.15, 0], 0.7, '#d93a2a'));
  const sx = 1.8;
  for (const z of [-1.1, 1.1]) P.push(beam([sx - 0.7, 0, z], [sx, 2.3, z], 0.09, '#4d6b4f'), beam([sx + 0.7, 0, z], [sx, 2.3, z], 0.09, '#4d6b4f'));
  P.push(beam([sx, 2.3, -1.15], [sx, 2.3, 1.15], 0.1, '#4d6b4f'));
  for (const z of [-0.45, 0.45]) P.push(box(0.04, 1.8, 0.04, sx - 0.17, 1.4, z, '#5d6266'), box(0.04, 1.8, 0.04, sx + 0.17, 1.4, z, '#5d6266'), box(0.42, 0.05, 0.3, sx, 0.48, z, '#d9a91c'));
  return merge(P);
}
const bollardGeometry = () => merge([cyl(0.1, 0.12, 0.9, 0, '#4a4d50', 8), cyl(0.105, 0.105, 0.12, 0.65, '#e0b020', 8)]);
const blockGeometry = () => merge([box(1.2, 0.75, 0.6, 0, 0.375, 0, '#a9a59c')]);

export function propMaterials(renderer) {
  const atlas = signAtlas(renderer);
  const solid = new THREE.MeshLambertMaterial({ vertexColors: true });
  // Лампы мачт освещения и огни на трубах и вышках ночью горят.
  solid.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = NIGHT;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <emissivemap_fragment>', `float lampK = step(0.95, vColor.r) * step(0.9, vColor.g) * step(vColor.b, 0.85);
        float redK = step(0.95, vColor.r) * step(vColor.g, 0.3);
        totalEmissiveRadiance += (vec3(1.0, 0.9, 0.65) * 1.8 * lampK + vec3(1.0, 0.1, 0.05) * 2.0 * redK) * uNight;`);
  };
  const sign = new THREE.MeshLambertMaterial({ map: atlas, alphaTest: 0.5 });
  const mats = {
    solid, sign,
    // Разметка на полотне — поверх асфальта (у ленты дороги сдвиг −2).
    paint: new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }),
    wire: new THREE.LineBasicMaterial({ color: '#2b2e31' }),
    towers: Object.fromEntries(Object.entries(TOWERS).map(([k, t]) => [k, merge(t.make())])),
    signs: Object.fromEntries(SIGNS.map((s) => [s, signGeometry(s)])),
    gatePost: gatePost(), gateArm: gateArm(), play: playGeometry(), bollard: bollardGeometry(), block: blockGeometry(),
  };
  mats.owns = (m) => m === sign || m === solid || m === mats.paint || m === mats.wire;
  return mats;
}

// ---------------------------------------------------------------- квадрат

const ZEBRA_LEN = 4, ZEBRA_STRIPE = 0.5; // м: длина полос вдоль дороги, ширина полосы и промежутка
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _r = new THREE.Quaternion();

function instanced(geo, mat, spots, scale = () => 1) {
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
  spots.forEach((sp, i) => {
    const [x, y, z, a] = sp, k = scale(sp);
    mesh.setMatrixAt(i, _m.compose(_p.set(x, y, z), _r.setFromAxisAngle(_up, a), typeof k === 'number' ? _s.set(k, k, k) : k));
  });
  mesh.computeBoundingSphere();
  mesh.castShadow = true;
  mesh.userData.spots = spots;
  return mesh;
}

// Прямоугольник на полотне в осях точки p (s — вдоль дороги, l — поперёк вправо), разбитый вдоль на ns кусков:
// каждая вершина — по высоте поверхности (лежачий полицейский поднимает разметку горбом).
function decal(world, p, y0, s0, s1, l0, l1, color, ns, out) {
  const c = new THREE.Color(color), at = (s, l) => {
    const x = p.x + p.dx * s - p.dz * l, z = p.z + p.dz * s + p.dx * l;
    return [x, world.ground(x, z, y0) + 0.025, z];
  };
  for (let k = 0; k < ns; k++) {
    const a = s0 + ((s1 - s0) * k) / ns, b = s0 + ((s1 - s0) * (k + 1)) / ns;
    const q = [at(a, l0), at(b, l0), at(b, l1), at(a, l1)];
    for (const i of [0, 2, 1, 0, 3, 2]) { out.p.push(...q[i]); out.c.push(c.r, c.g, c.b); }
  }
}

export function buildPropChunk(world, info, mats) {
  const pts = info.data.pts;
  if (!pts.length) return null;
  const out = [];
  const paint = { p: [], c: [] };
  const signs = Object.fromEntries(SIGNS.map((s) => [s, []]));
  const towers = {}, gates = [], posts = { b: [], k: [] }, play = [], wires = [];
  for (const p of pts) {
    if (p.t === 'zebra' || p.t === 'bump') {
      const y0 = world.roadY(p.road, p.x, p.z) ?? world.terrain(p.x, p.z);
      const half = p.w / 2 - 0.3;
      if (p.t === 'zebra' || p.k === 2) {
        for (let l = -half; l + ZEBRA_STRIPE <= half; l += 2 * ZEBRA_STRIPE) {
          decal(world, p, y0, -ZEBRA_LEN / 2, ZEBRA_LEN / 2, l, l + ZEBRA_STRIPE, '#e9e9e2', p.k === 2 ? 3 : 1, paint);
        }
      }
      if (p.t === 'bump') {
        const L = BUMP[p.k][0];
        // Неровность — жёлто-чёрными клетками поперёк; у приподнятого перехода — пандусы с обеих сторон.
        for (const [a, b] of p.k === 2 ? [[-L / 2, BUMP_RAMP - L / 2], [L / 2 - BUMP_RAMP, L / 2]] : [[-L / 2, L / 2]]) {
          for (let l = -half, i = 0; l < half; l += 0.5, i++) decal(world, p, y0, a, b, l, Math.min(half, l + 0.5), i % 2 ? '#1f1f1f' : '#e3bd1c', 4, paint);
        }
      }
    } else if (p.t === 'sign') {
      if (world.isWater(p.x, p.z) || world.roofAt(p.x, p.z) !== null) continue;
      signs[p.s].push([p.x, world.terrain(p.x, p.z), p.z, p.a]);
    } else if (p.t === 'tower') {
      (towers[p.k] ??= []).push([p.x, p.y0 ?? world.terrain(p.x, p.z), p.z, p.a, p.h]);
    } else if (p.t === 'gate') {
      // Стойка справа по ходу линии, стрела — через всё полотно влево.
      const off = p.w / 2 + 0.5, x = p.x - p.dz * off, z = p.z + p.dx * off;
      gates.push([x, world.terrain(x, z), z, Math.atan2(p.dx, p.dz), p.w + 0.6]);
    } else if (p.t === 'post') {
      posts[p.k].push([p.x, world.ground(p.x, p.z), p.z, (p.x * 3.7) % 6.28]);
    } else if (p.t === 'play') {
      if (world.isWater(p.x, p.z) || world.roofAt(p.x, p.z) !== null) continue;
      play.push([p.x, world.terrain(p.x, p.z), p.z, p.a]);
    } else if (p.t === 'wire') {
      wires.push(p);
    }
  }
  if (paint.p.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(paint.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(paint.c, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mats.paint);
    m.receiveShadow = true;
    out.push(m);
  }
  for (const s of SIGNS) {
    if (!signs[s].length) continue;
    const m = instanced(mats.signs[s], mats.sign, signs[s]);
    m.userData.breakKind = 'sign';
    out.push(m);
  }
  for (const [k, list] of Object.entries(towers)) out.push(instanced(mats.towers[k], mats.solid, list, (sp) => sp[4] / TOWERS[k].H));
  if (gates.length) {
    const post = instanced(mats.gatePost, mats.solid, gates);
    const arm = instanced(mats.gateArm, mats.solid, gates, (sp) => _s.set(sp[4], 1, 1));
    post.userData.arms = arm;
    out.push(post, arm);
  }
  if (posts.b.length) { const m = instanced(mats.bollard, mats.solid, posts.b); m.userData.breakKind = 'bollard'; out.push(m); }
  if (posts.k.length) out.push(instanced(mats.block, mats.solid, posts.k));
  if (play.length) { const m = instanced(mats.play, mats.solid, play); m.userData.breakKind = 'play'; out.push(m); }
  if (wires.length) out.push(buildWires(world, wires, mats));
  return out;
}

// Провода пролётов: от точек крепления одной опоры к тем же точкам соседней, с провисом. Траверсы опор
// смотрят в разные стороны (направление линии в OSM) — сторона креплений берётся относительно пролёта.
const SAG = 0.035; // провис — доля пролёта
const WIRE_SEG = 10;
function buildWires(world, wires, mats) {
  const pos = [];
  const attach = (t, nx, nz) => {
    const T = TOWERS[t.k], s = t.h / T.H, ca = Math.cos(t.a), sa = Math.sin(t.a);
    const flip = ca * nx - sa * nz < 0 ? -1 : 1; // ось x опоры — (cos a, −sin a)
    const y = world.terrain(t.x, t.z);
    return (T.WIRE ?? [[0, T.H]]).map(([u, v]) => [t.x + u * flip * s * ca, y + v * s, t.z - u * flip * s * sa]);
  };
  for (const w of wires) {
    const L = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) || 1;
    const nx = -(w.b.z - w.a.z) / L, nz = (w.b.x - w.a.x) / L;
    const A = attach(w.a, nx, nz), B = attach(w.b, nx, nz);
    for (let i = 0; i < Math.min(A.length, B.length); i++) {
      const a = A[i], b = B[i];
      let prev = a;
      for (let k = 1; k <= WIRE_SEG; k++) {
        const t = k / WIRE_SEG;
        const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - SAG * L * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t];
        pos.push(...prev, ...q);
        prev = q;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return new THREE.LineSegments(g, mats.wire);
}

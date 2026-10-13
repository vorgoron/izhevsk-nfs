// Построение мешей города из World.
import * as THREE from 'three';
import { MARKED_CLASSES, World } from './world.js';
import { RECOLOR } from './landmarks.js';

const AREA_COLORS = {
  water: '#3d6f8e', park: '#4f6b3a', grass: '#6c8448', sand: '#cdbb8a', industrial: '#7a7670', paved: '#9a968e',
  track: '#a8503d',
};
const BASE_GROUND = '#77795f';

// ---------------------------------------------------------------- земля

// Квадрат земли: своя текстура-подложка (вода, парки, площади, тропинки, асфальт под дорогами)
// и меш ровно по узлам сетки рельефа — соседние квадраты стыкуются без щелей.
export function buildTerrainChunk(world, info, texSize, renderer) {
  const { x0, z0, x1, z1, i0, i1, j0, j1, data } = info;
  const W = x1 - x0, H = z1 - z0;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = texSize;
  const sx = texSize / W, sz = texSize / H;
  const g = canvas.getContext('2d');
  g.fillStyle = BASE_GROUND;
  g.fillRect(0, 0, texSize, texSize);
  // Немного шума, чтобы земля не была пластиковой (детерминированно по квадрату).
  let seed = (info.ci * 7919 + info.cj * 104729) % 2147483647 || 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < texSize * texSize / 90; i++) {
    g.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)';
    g.fillRect(rand() * texSize, rand() * texSize, 2, 2);
  }
  const tx = (x) => (x - x0) * sx, tz = (z) => (z - z0) * sz;
  const ring = (pts) => {
    g.moveTo(tx(pts[0][0]), tz(pts[0][1]));
    for (let i = 1; i < pts.length; i++) g.lineTo(tx(pts[i][0]), tz(pts[i][1]));
    g.closePath();
  };
  // Участки уже отсортированы по площади (fetch_city.py): большие (пруд, лес) снизу.
  for (const a of data.areas) {
    g.beginPath();
    ring(a.p);
    for (const h of a.holes || []) if (h.length > 2) ring(h);
    g.fillStyle = AREA_COLORS[a.k];
    g.fill('evenodd');
  }
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const stroke = (pts, width, color) => {
    g.beginPath();
    g.moveTo(tx(pts[0][0]), tz(pts[0][1]));
    for (let i = 1; i < pts.length; i++) g.lineTo(tx(pts[i][0]), tz(pts[i][1]));
    g.lineWidth = width * sx;
    g.strokeStyle = color;
    g.stroke();
  };
  for (const w of data.waterways) stroke(w.p, w.w, AREA_COLORS.water); // речки и ручьи
  for (const p of data.paths) stroke(p, 2.2, '#a7a196');
  for (const r of data.rails) stroke(r.p, r.k === 'tram' ? 2 : 3.2, '#4d4038');
  // Асфальт под дорожными мешами закрывает щели на перекрёстках.
  for (const r of data.lines) stroke(r.n.map((i) => world.nodes[i]), r.w + 0.6, '#3b3c3e');

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false;

  // Вершины — узлы сетки рельефа; нормали — по разностям высот всей сетки (одинаковые на стыках).
  const { nx, nz, dx, dz, h, xmin, zmin } = world.mesh;
  const H_ = (i, j) => h[Math.min(nz, Math.max(0, j)) * (nx + 1) + Math.min(nx, Math.max(0, i))];
  const cols = i1 - i0 + 1, rows = j1 - j0 + 1;
  const pos = new Float32Array(cols * rows * 3), nor = new Float32Array(cols * rows * 3), uv = new Float32Array(cols * rows * 2);
  for (let j = j0, k = 0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++, k++) {
      const x = xmin + i * dx, z = zmin + j * dz;
      pos.set([x, H_(i, j), z], k * 3);
      const gx = (H_(i + 1, j) - H_(i - 1, j)) / (2 * dx), gz = (H_(i, j + 1) - H_(i, j - 1)) / (2 * dz);
      const l = Math.hypot(gx, 1, gz);
      nor.set([-gx / l, 1 / l, -gz / l], k * 3);
      uv.set([(x - x0) / W, (z - z0) / H], k * 2); // flipY=false: v=0 — верх канваса = z0
    }
  }
  const idx = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      // Как PlaneGeometry (и World.meshTerrain): диагональ из (i, j+1) в (i+1, j).
      const a = j * cols + i, b = (j + 1) * cols + i, c = (j + 1) * cols + i + 1, d = j * cols + i + 1;
      idx.push(a, b, d, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
  mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------- дороги

// Разметка дороги (поперёк u = 0…1, u = 0 — левый край по ходу ребра):
// 'plain' — без разметки; иначе «полос слева/полос справа/односторонняя», например '2/2/0'.
// Края — сплошные; на двусторонней — осевая (на 4+ полосах двойная сплошная, иначе прерывистая);
// между полосами одного направления — прерывистые.
export function roadMarking(road) {
  if (!MARKED_CLASSES.has(road.k.replace('_link', ''))) return 'plain';
  const total = Math.max(1, road.ln ?? Math.round((road.w - 1) / 3.3));
  if (road.ow) return `${total}/0/1`;
  const right = road.lf ?? Math.max(1, Math.ceil(total / 2)), left = road.lb ?? Math.max(1, total - right);
  return `${left}/${right}/0`;
}

function asphaltTexture(key, renderer) {
  const W = 256, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#3a3b3d';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 5000; i++) {
    const v = 40 + Math.random() * 40;
    g.fillStyle = `rgba(${v},${v},${v},0.5)`;
    g.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5);
  }
  if (key !== 'plain') {
    const [left, right, ow] = key.split('/').map(Number);
    const n = left + right;
    g.fillStyle = '#d8d8d0';
    const line = (u, w = 4) => g.fillRect(u * W - w / 2, 0, w, H);
    const dash = (u, w = 4) => g.fillRect(u * W - w / 2, 0, w, H / 2);
    line(0.02); line(0.98); // края
    for (let i = 1; i < n; i++) {
      const u = 0.02 + (0.96 * i) / n;
      if (!ow && i === left) {
        if (n >= 4) { line(u - 0.012, 3); line(u + 0.012, 3); } // двойная сплошная
        else dash(u);
      } else dash(u, 3);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

// Материалы асфальта общие на все квадраты.
export function roadMaterials(renderer) {
  const cache = new Map();
  return {
    // Материал асфальта под вид разметки (roadMarking), создаётся при первой надобности.
    asphalt(key) {
      if (!cache.has(key)) {
        cache.set(key, new THREE.MeshLambertMaterial({
          map: asphaltTexture(key, renderer),
          side: THREE.DoubleSide,
          polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        }));
      }
      return cache.get(key);
    },
    owns: (m) => [...cache.values()].includes(m),
    // Мосты: плита, парапеты, опоры.
    concrete: new THREE.MeshLambertMaterial({ color: '#b7b3aa', side: THREE.DoubleSide }),
    rail: new THREE.MeshPhongMaterial({ color: '#8f9399', specular: '#e8edf2', shininess: 80, side: THREE.DoubleSide }),
    pillarGeo: new THREE.BoxGeometry(1.3, 1, 1.3).translate(0, 0.5, 0),
  };
}

const DECK = 1.2, PARAPET = 0.9, PILLAR_STEP = 20;

// Ленты дорог квадрата: каждый кусок (run) — отрезки одной дороги подряд.
export function buildRoadChunk(world, runs, mats) {
  const buckets = {};
  const bp = [], pillars = []; // мостовые плиты и парапеты (треугольники), опоры [x, z, низ, верх]

  for (const { road, from, to } of runs) {
    const mk = roadMarking(road);
    const b = (buckets[mk] ??= { p: [], uv: [], idx: [] });
    // Ресемплинг до 5 м, чтобы полотно повторяло рельеф.
    const src = road.n.slice(from, to + 1).map((i) => world.nodes[i]);
    const ysrc = road.y?.slice(from, to + 1);
    const pts = [], ys = [];
    for (let i = 0; i < src.length; i++) {
      if (i > 0) {
        const [ax, az] = src[i - 1], [bx, bz] = src[i];
        const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 5);
        for (let k = 1; k < n; k++) {
          const t = k / n;
          pts.push([ax + (bx - ax) * t, az + (bz - az) * t]);
          ys.push(ysrc ? ysrc[i - 1] + (ysrc[i] - ysrc[i - 1]) * t : null);
        }
      }
      pts.push(src[i]);
      ys.push(ysrc ? ysrc[i] : null);
    }
    const half = road.w / 2;
    const base = b.p.length / 3;
    // Продольная координата текстуры — от начала дороги, чтобы разметка не сбивалась на стыке квадратов.
    let bridgeEdge = null; // нормаль полотна в предыдущей точке (для бортов моста)
    let v = 0;
    for (let i = 1; i <= from; i++) {
      const [ax, az] = world.nodes[road.n[i - 1]], [bx, bz] = world.nodes[road.n[i]];
      v += Math.hypot(bx - ax, bz - az);
    }
    // Соседи за краем куска — для направления в концевых точках (стык без излома).
    const before = from > 0 ? world.nodes[road.n[from - 1]] : null;
    const after = to < road.n.length - 1 ? world.nodes[road.n[to + 1]] : null;
    for (let i = 0; i < pts.length; i++) {
      const prev = i > 0 ? pts[i - 1] : before || pts[0], next = i < pts.length - 1 ? pts[i + 1] : after || pts[pts.length - 1];
      let dx = next[0] - prev[0], dz = next[1] - prev[1];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      // Митра на изломе, с ограничением, чтобы острые углы не выстреливали.
      let m = 1;
      if (prev !== pts[i] && next !== pts[i]) {
        const ax = pts[i][0] - prev[0], az = pts[i][1] - prev[1];
        const al = Math.hypot(ax, az) || 1;
        m = Math.min(2, 1 / Math.max(0.3, (ax / al) * dx + (az / al) * dz));
      }
      const nx = -dz * half * m, nz = dx * half * m;
      if (i > 0) v += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const [x, z] = pts[i];
      const yl = ys[i] ?? world.terrain(x + nx, z + nz) + road.lift;
      const yr = ys[i] ?? world.terrain(x - nx, z - nz) + road.lift;
      b.p.push(x + nx, yl, z + nz, x - nx, yr, z - nz);
      b.uv.push(0, v / 12, 1, v / 12);
      // Мост: борта (фасция + парапет) по краям и плита снизу; опоры до земли через ~20 м.
      if (ys[i] != null && i > 0) {
        const [px, pz] = pts[i - 1], pl = bridgeEdge, y0 = ys[i - 1], y1 = ys[i];
        const o = 1 + 0.25 / half; // борт чуть снаружи полотна
        for (const sgn of [1, -1]) {
          const ax = px + sgn * pl.nx * o, az = pz + sgn * pl.nz * o, bx = x + sgn * nx * o, bz = z + sgn * nz * o;
          quad(bp, [ax, y0 - DECK, az], [bx, y1 - DECK, bz], [bx, y1 + PARAPET, bz], [ax, y0 + PARAPET, az]);
        }
        quad(bp, [px + pl.nx * o, y0 - DECK, pz + pl.nz * o], [x + nx * o, y1 - DECK, z + nz * o],
          [x - nx * o, y1 - DECK, z - nz * o], [px - pl.nx * o, y0 - DECK, pz - pl.nz * o]);
        if (Math.floor(v / PILLAR_STEP) !== Math.floor((v - Math.hypot(x - px, z - pz)) / PILLAR_STEP)) {
          for (const off of road.w > 12 ? [-0.5, 0.5] : [0]) {
            const qx = x + nx * off, qz = z + nz * off, g = world.terrain(qx, qz);
            const onRoad = world.nearbyRoadSegments(qx, qz).some((q) => q.ya === undefined && World.closest(q, qx, qz).d < q.w / 2 + 1);
            if (y1 - DECK - g > 2.5 && !onRoad) pillars.push([qx, qz, g - 0.5, y1 - DECK]); // не на дорогу под мостом
          }
        }
      }
      bridgeEdge = { nx, nz };
      if (i > 0) {
        const a = base + (i - 1) * 2;
        b.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }

  const group = new THREE.Group();
  for (const [name, b] of Object.entries(buckets)) {
    if (!b.idx.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    geo.setIndex(b.idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mats.asphalt(name));
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  if (bp.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mats.concrete);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  }
  if (pillars.length) {
    const im = new THREE.InstancedMesh(mats.pillarGeo, mats.concrete, pillars.length);
    const mt = new THREE.Matrix4();
    pillars.forEach(([x, z, y0, y1], i) => im.setMatrixAt(i, mt.makeScale(1, y1 - y0, 1).setPosition(x, y0, z)));
    im.castShadow = true;
    im.computeBoundingSphere();
    group.add(im);
    // Опоры твёрдые; квадрат строится заново при подгрузке — добавляем коллайдер один раз.
    world.pillarSet ??= new Set();
    for (const [x, z] of pillars) {
      const key = `${Math.round(x)},${Math.round(z)}`;
      if (world.pillarSet.has(key)) continue;
      world.pillarSet.add(key);
      world.addCollider([[x - 0.7, z - 0.7], [x + 0.7, z - 0.7], [x + 0.7, z + 0.7], [x - 0.7, z + 0.7]]);
    }
  }
  return group;
}

function quad(arr, a, b, c, d) {
  arr.push(...a, ...b, ...c, ...a, ...c, ...d);
}

// ---------------------------------------------------------------- рельсы

const GAUGE = 1.524; // м, русская колея

// Рельсы квадрата: две стальные полосы на каждом пути (трамвай и железная дорога), над землёй
// или полотном дороги. Отрезки, середина которых в квадрате.
export function buildRailChunk(world, info, mat) {
  const { x0, z0, x1, z1, data } = info;
  const pos = [];
  for (const r of data.rails) {
    const p = r.p;
    for (let i = 1; i < p.length; i++) {
      const [ax, az] = p[i - 1], [bx, bz] = p[i];
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (mx < x0 || mx >= x1 || mz < z0 || mz >= z1) continue;
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.05) continue;
      const n = Math.ceil(L / 4), dx = (bx - ax) / L, dz = (bz - az) / L;
      for (const side of [-1, 1]) {
        const ox = -dz * (GAUGE / 2) * side, oz = dx * (GAUGE / 2) * side;
        for (let k = 0; k < n; k++) {
          const t0 = (k / n) * L, t1 = ((k + 1) / n) * L;
          const sx = ax + dx * t0 + ox, sz = az + dz * t0 + oz, ex = ax + dx * t1 + ox, ez = az + dz * t1 + oz;
          const sy = world.ground(sx, sz) + 0.06, ey = world.ground(ex, ez) + 0.06;
          const wx = -dz * 0.045, wz = dx * 0.045;
          // Верх рельса и две боковины (низкий брусок).
          pos.push(sx - wx, sy, sz - wz, ex - wx, ey, ez - wz, ex + wx, ey, ez + wz, sx - wx, sy, sz - wz, ex + wx, ey, ez + wz, sx + wx, sy, sz + wz);
          for (const w of [-1, 1]) {
            const px = w * wx, pz = w * wz;
            pos.push(sx + px, sy, sz + pz, ex + px, ey, ez + pz, ex + px, ey - 0.12, ez + pz, sx + px, sy, sz + pz, ex + px, ey - 0.12, ez + pz, sx + px, sy - 0.12, sz + pz);
          }
        }
      }
    }
  }
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------- здания

// 0 панель, 1 кирпич, 2 штукатурка, 3 пром, 4 храм
const WALL = ['#c8c5bb', '#a2603f', '#d8b97f', '#8e8f8c', '#f1eee6', '#d4d1ca', '#b98a5a'];
const ROOF = ['#5d5d5d', '#4f4a47', '#6b5d4e', '#686a68', '#b89b4a', '#8d9096', '#8a3b2c'];
const SEATS = '#2f63a8'; // трибуны: сторона к полю — ряды сидений
// Частный сектор (стиль 6): стены — дерево, крашеные, белый кирпич; крыши — ржавое железо, зелёные, шифер.
const HOUSE_WALLS = ['#9c7350', '#b98a5a', '#7fa3b8', '#8fae8a', '#d9d4c5', '#c8b27a', '#a5664a', '#c9c3b4'];
const HOUSE_ROOFS = ['#8a3b2c', '#4d6b4f', '#7d8287', '#5a4636', '#9b5a36', '#6f7478'];

function windowTexture(renderer) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const x = i * 64, y = j * 64;
      g.fillStyle = 'rgba(0,0,0,0.06)';
      g.fillRect(x, y + 62, 64, 2); // межэтажный шов
      const lit = Math.random() < 0.12;
      const shade = 50 + Math.random() * 40;
      g.fillStyle = lit ? '#e8d9a0' : `rgb(${shade * 0.8},${shade},${shade * 1.15})`;
      g.fillRect(x + 16, y + 14, 32, 34);
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.fillRect(x + 31, y + 14, 2, 34); // переплёт
      g.fillRect(x + 14, y + 48, 36, 3); // подоконник
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

const ONION = [[0, 0], [0.62, 0], [0.86, 0.1], [1, 0.28], [0.98, 0.42], [0.82, 0.58], [0.52, 0.74], [0.24, 0.87], [0.1, 0.96], [0.05, 1.08]];

export function buildingMaterials(renderer) {
  return {
    walls: new THREE.MeshLambertMaterial({ vertexColors: true, map: windowTexture(renderer) }),
    roofs: new THREE.MeshLambertMaterial({ vertexColors: true }),
    // Главки храмов: барабан, луковица, крест (единичного размера, масштаб — в матрице).
    drumGeo: new THREE.CylinderGeometry(0.5, 0.5, 1.6, 12).translate(0, 0.8, 0),
    onionGeo: new THREE.LatheGeometry(ONION.map(([a, b]) => new THREE.Vector2(a * 0.62, b * 1.3)), 16).translate(0, 1.6, 0),
    crossGeo: new THREE.BoxGeometry(0.06, 0.9, 0.06).translate(0, 3.4, 0),
    drum: new THREE.MeshLambertMaterial({ color: '#f2eee4' }),
    gold: new THREE.MeshPhongMaterial({ color: '#d2a53a', specular: '#fff1b8', shininess: 90, emissive: '#2a1d00' }),
  };
}

// Двускатная крыша частного дома: по прямоугольнику наименьшей площади вокруг контура,
// конёк вдоль длинной стороны, свес, фронтоны на торцах (цвета стен).
function gableRoof(pts, top, wallCol, roofCol, rp, rc) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
    const L = Math.hypot(x2 - x1, z2 - z1);
    if (L < 0.5) continue;
    const ux = (x2 - x1) / L, uz = (z2 - z1) / L;
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (const [x, z] of pts) {
      const s = x * ux + z * uz, t = -x * uz + z * ux;
      s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t);
    }
    const area = (s1 - s0) * (t1 - t0);
    if (!best || area < best.area) best = { ux, uz, s0, s1, t0, t1, area };
  }
  if (!best) return;
  let { ux, uz, s0, s1, t0, t1 } = best;
  if (t1 - t0 > s1 - s0) { // конёк вдоль длинной стороны: поворачиваем оси на 90°
    [ux, uz] = [-uz, ux];
    [s0, s1, t0, t1] = [t0, t1, -s1, -s0];
  }
  const half = (t1 - t0) / 2, tm = (t0 + t1) / 2, H = Math.min(half * 0.8, 3.2), ov = 0.35;
  const P = (s, t, y) => [s * ux - t * uz, y, s * uz + t * ux];
  const cx = ((s0 + s1) / 2) * ux - tm * uz, cz = ((s0 + s1) / 2) * uz + tm * ux;
  const tri = (a, b, c, col) => {
    // Нормаль — наружу и вверх: иначе переставляем вершины.
    const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
    const mx = (a[0] + b[0] + c[0]) / 3 - cx, my = 1, mz = (a[2] + b[2] + c[2]) / 3 - cz;
    if (n[0] * mx + n[1] * my + n[2] * mz < 0) [b, c] = [c, b];
    for (const v of [a, b, c]) { rp.push(...v); rc.push(col.r, col.g, col.b); }
  };
  const yr = top + H, ye = top - ov * (H / half); // свес чуть ниже карниза
  for (const t of [t0 - ov, t1 + ov]) {
    const a = P(s0 - ov, t, ye), b = P(s1 + ov, t, ye), c = P(s1 + ov, tm, yr), d = P(s0 - ov, tm, yr);
    tri(a, b, c, roofCol);
    tri(a, c, d, roofCol);
  }
  for (const s of [s0, s1]) tri(P(s, t0, top), P(s, t1, top), P(s, tm, yr), wallCol);
}

function domeMeshes(domes, mats) {
  const out = [[mats.drumGeo, mats.drum], [mats.onionGeo, mats.gold], [mats.crossGeo, mats.gold]].map(([g, m]) => new THREE.InstancedMesh(g, m, domes.length));
  const m = new THREE.Matrix4();
  domes.forEach(([x, z, top, s], i) => {
    m.makeScale(s, s, s).setPosition(x, top, z);
    for (const im of out) im.setMatrixAt(i, m);
  });
  for (const im of out) { im.castShadow = true; im.computeBoundingSphere(); }
  return out;
}

// Куски одного дома, разрезанного аркой (общий g): индекс по g, чтобы уровень крыши был общим.
let pieceIndex = null;

export function buildBuildingChunk(world, list, mats) {
  const wp = [], wn = [], wc = [], wuv = [];
  const rp = [], rc = [];
  const domes = []; // [x, z, крыша, размер]
  const col = new THREE.Color();
  if (!pieceIndex) {
    pieceIndex = new Map();
    for (const q of world.city.buildings) if (q.g !== undefined) (pieceIndex.get(q.g) || pieceIndex.set(q.g, []).get(q.g)).push(q);
  }

  const groundRange = new Map();
  const range = (b) => {
    const key = b.g ?? b;
    let r = groundRange.get(key);
    if (!r) {
      r = [Infinity, -Infinity];
      for (const q of b.g === undefined ? [b] : pieceIndex.get(b.g)) {
        for (const [x, z] of q.p) {
          const y = world.terrain(x, z);
          r[0] = Math.min(r[0], y);
          r[1] = Math.max(r[1], y);
        }
      }
      groundRange.set(key, r);
    }
    return r;
  };

  for (const b of list) {
    let pts = b.p;
    let skip = new Set(b.x); // рёбра-склейки после разреза: без стен
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
      area += x1 * z2 - x2 * z1;
    }
    if (area < 0) {
      // CCW: наружная нормаль = (dz, -dx). Ребро i (pts[i]→pts[i+1]) после разворота — n-2-i.
      pts = [...pts].reverse();
      skip = new Set([...skip].map((i) => (2 * pts.length - 2 - i) % pts.length));
    }

    const [gmin, gmax] = range(b);
    // Переход/арка: низ над дорогой (дорога лежит на рельефе, отсчитываем от низшей точки).
    const base = b.mh ? gmin + b.mh : gmin - 1.5, top = gmax + b.h;

    // Лёгкий разброс оттенка, чтобы кварталы не были одинаковыми; частные дома — каждый в свой цвет.
    const hash = Math.abs(Math.round(pts[0][0] * 7.3 + pts[0][1] * 3.1));
    col.set(RECOLOR[b.lm]?.[0] ?? (b.r ? HOUSE_WALLS[hash % HOUSE_WALLS.length] : WALL[b.s]));
    const k = 0.9 + ((pts.length * 7919 + Math.round(b.h * 13)) % 20) / 100;
    col.multiplyScalar(k);

    // Дворы (дыры, например поле стадиона внутри трибун): обход по часовой — стены смотрят во двор.
    const holes = (b.holes || []).filter((h) => h.length > 2).map((h) => {
      let a = 0;
      for (let i = 0; i < h.length; i++) a += h[i][0] * h[(i + 1) % h.length][1] - h[(i + 1) % h.length][0] * h[i][1];
      return a > 0 ? [...h].reverse() : h;
    });

    // Трибуны (стиль 5): снаружи глухой бетон без окон, со стороны поля — сиденья.
    const stand = b.s === 5;
    const seats = new THREE.Color(SEATS);
    for (const ring of [pts, ...holes]) {
    const rc_ = stand && ring !== pts ? seats : col;
    let u = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % ring.length];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 0.01 || (ring === pts && skip.has(i))) continue;
      const nx = (z2 - z1) / len, nz = -(x2 - x1) / len;
      const u1 = u, u2 = u + len / 3.2 / 4;
      const vb = (base - gmax) / 3.1 / 4, vt = b.h / 3.1 / 4;
      // a=(p1,base) b=(p2,base) c=(p2,top) d=(p1,top); треугольники (a,c,b) и (a,d,c)
      const quad = [
        [x1, base, z1, u1, vb], [x2, top, z2, u2, vt], [x2, base, z2, u2, vb],
        [x1, base, z1, u1, vb], [x1, top, z1, u1, vt], [x2, top, z2, u2, vt],
      ];
      for (const [x, y, z, uu, vv] of quad) {
        wp.push(x, y, z);
        wn.push(nx, 0, nz);
        wc.push(rc_.r, rc_.g, rc_.b);
        // Без окон: все вершины в чистое место текстуры (простенок).
        if (stand) wuv.push(0.02, 0.1);
        else wuv.push(uu, vv);
      }
      u = u2;
    }
    }

    // Храм без своей модели: главка на барабане над серединой крыши.
    if (b.pw) {
      let ax = 0, az = 0;
      for (const [x, z] of pts) { ax += x; az += z; }
      domes.push([ax / pts.length, az / pts.length, top, Math.min(3.5, Math.max(1.2, Math.sqrt(Math.abs(area) / 2) * 0.14))]);
    }

    if (b.r) {
      gableRoof(pts, top, col, new THREE.Color(HOUSE_ROOFS[(hash >> 3) % HOUSE_ROOFS.length]).multiplyScalar(k), rp, rc);
      continue;
    }

    const contour = pts.map(([x, z]) => new THREE.Vector2(x, z));
    const tris = THREE.ShapeUtils.triangulateShape(contour, holes.map((h) => h.map(([x, z]) => new THREE.Vector2(x, z))));
    pts = [...pts, ...holes.flat()]; // индексы треугольников — по контуру и дырам подряд
    const rcol = new THREE.Color(RECOLOR[b.lm]?.[1] ?? ROOF[b.s]).multiplyScalar(k);
    for (let [a, c, d] of tris) {
      // Нормаль крыши должна смотреть вверх.
      const ux = pts[c][0] - pts[a][0], uz = pts[c][1] - pts[a][1];
      const vx = pts[d][0] - pts[a][0], vz = pts[d][1] - pts[a][1];
      if (uz * vx - ux * vz < 0) [c, d] = [d, c];
      for (const i of [a, c, d]) {
        rp.push(pts[i][0], top, pts[i][1]);
        rc.push(rcol.r, rcol.g, rcol.b);
      }
      // Потолок арки / днище перехода — видно снизу, нормаль вниз.
      if (b.mh) {
        for (const i of [a, d, c]) {
          rp.push(pts[i][0], base, pts[i][1]);
          rc.push(col.r * 0.55, col.g * 0.55, col.b * 0.55);
        }
      }
    }
  }

  const walls = new THREE.BufferGeometry();
  walls.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
  walls.setAttribute('normal', new THREE.Float32BufferAttribute(wn, 3));
  walls.setAttribute('color', new THREE.Float32BufferAttribute(wc, 3));
  walls.setAttribute('uv', new THREE.Float32BufferAttribute(wuv, 2));
  const roofs = new THREE.BufferGeometry();
  roofs.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
  roofs.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3));
  roofs.computeVertexNormals();

  const group = new THREE.Group();
  if (!wp.length) return group;
  const wm = new THREE.Mesh(walls, mats.walls);
  const rm = new THREE.Mesh(roofs, mats.roofs);
  for (const m of [wm, rm]) {
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  if (domes.length) group.add(...domeMeshes(domes, mats));
  return group;
}

// ---------------------------------------------------------------- деревья

function pointInPoly(x, z, p) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i], [xj, zj] = p[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function treeMaterials() {
  // Ель: три конуса друг над другом на коротком стволе.
  const cone = (r, h, y) => new THREE.ConeGeometry(r, h, 7).translate(0, y + h / 2, 0);
  const spruce = mergeGeos([cone(2.2, 3.6, 1.2), cone(1.7, 3.2, 3.4), cone(1.1, 2.8, 5.6)]);
  return {
    trunkGeo: new THREE.CylinderGeometry(0.18, 0.25, 3, 5).translate(0, 1.5, 0),
    crownGeo: new THREE.IcosahedronGeometry(2.4, 0).translate(0, 4.6, 0),
    spruceTrunkGeo: new THREE.CylinderGeometry(0.15, 0.22, 1.6, 5).translate(0, 0.8, 0),
    spruceGeo: spruce,
    trunk: new THREE.MeshLambertMaterial({ color: '#5a4632' }),
    crown: new THREE.MeshLambertMaterial({ color: '#ffffff' }),
  };
}

function mergeGeos(geos) {
  const pos = [], nor = [];
  for (const g of geos) {
    const n = g.index ? g.toNonIndexed() : g;
    pos.push(...n.attributes.position.array);
    nor.push(...n.attributes.normal.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}

const PARK_DENSITY = 1 / 110;   // деревьев на м² рамки парка/леса
const MAX_TREES = 1100;         // на квадрат
const STREET_STEP = [16, 30];   // м между деревьями вдоль улицы (случайно в диапазоне)
const STREET_KINDS = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street']);

// Деревья квадрата: из OSM, случайные в парках (лиственные) и лесах (в основном ели),
// и редкие деревья вдоль улиц в застройке. Детерминированно по квадрату.
export function buildTreeChunk(world, info, mats) {
  const { x0, z0, x1, z1, data } = info;
  // Возле достопримечательностей деревья не сажаем: они закрывают модели.
  const POINT_CLEAR = { wheel: 27 }; // колесо широкое: деревья врезались бы в нижние кабинки
  const clear = (world.city.landmarks || []).map((l) => [l.x, l.z, l.p
    ? Math.max(...l.p.map(([x, z]) => Math.hypot(x - l.x, z - l.z))) + 6 : POINT_CLEAR[l.key] ?? 12]);
  const free = (x, z) => clear.every(([cx, cz, r]) => Math.hypot(x - cx, z - cz) > r);
  const leafy = data.trees.filter(([x, z]) => free(x, z));
  const spruce = [];
  let rnd = (info.ci * 48271 + info.cj * 16807 + 12345) % 2147483647 || 1;
  const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  const count = () => leafy.length + spruce.length;
  for (const a of data.areas) {
    if (a.k !== 'park') continue;
    // Сажаем только в части рамки парка, попавшей в квадрат.
    let minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
    for (const [x, z] of a.p) {
      minx = Math.min(minx, x); maxx = Math.max(maxx, x);
      minz = Math.min(minz, z); maxz = Math.max(maxz, z);
    }
    minx = Math.max(minx, x0); maxx = Math.min(maxx, x1); minz = Math.max(minz, z0); maxz = Math.min(maxz, z1);
    if (minx >= maxx || minz >= maxz) continue;
    const n = ((maxx - minx) * (maxz - minz)) * PARK_DENSITY;
    for (let i = 0; i < n && count() < MAX_TREES; i++) {
      const x = minx + rand() * (maxx - minx), z = minz + rand() * (maxz - minz);
      if (!pointInPoly(x, z, a.p) || (a.holes || []).some((h) => pointInPoly(x, z, h)) || !free(x, z)) continue;
      const r = world.nearestRoad(x, z, 3);
      if (r && r.d < 1.5) continue;
      // Лес — в основном ели, парк — в основном лиственные.
      ((a.f ? rand() < 0.8 : rand() < 0.15) ? spruce : leafy).push([x, z]);
    }
  }
  // Вдоль улиц в застройке: по обе стороны, за краем полотна, не на домах, дорогах, воде.
  if (data.buildings.length >= 12) {
    const inBuilding = (x, z) => data.buildings.some((b) => {
      const p = b.p;
      if (Math.abs(p[0][0] - x) > 80 || Math.abs(p[0][1] - z) > 80) return false;
      return pointInPoly(x, z, p);
    });
    for (const { road, from, to } of data.runs) {
      if (!STREET_KINDS.has(road.k) || road.br || road.tu) continue;
      for (let i = from + 1; i <= to; i++) {
        const [ax, az] = world.nodes[road.n[i - 1]], [bx, bz] = world.nodes[road.n[i]];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 10) continue;
        const dx = (bx - ax) / L, dz = (bz - az) / L;
        for (const side of [-1, 1]) {
          for (let t = 6 + rand() * 10; t < L - 6; t += STREET_STEP[0] + rand() * (STREET_STEP[1] - STREET_STEP[0])) {
            if (rand() < 0.2 || count() >= MAX_TREES) continue; // с пропусками
            const off = road.w / 2 + 2.5 + rand() * 1.5;
            const x = ax + dx * t - dz * off * side, z = az + dz * t + dx * off * side;
            const nr = world.nearestRoad(x, z, 4);
            if ((nr && nr.d < 1.8) || world.isWater(x, z) || !free(x, z) || inBuilding(x, z)) continue;
            (rand() < 0.12 ? spruce : leafy).push([x, z]);
          }
        }
      }
    }
  }
  const out = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  const plant = (spots, trunkGeo, crownGeo, color) => {
    if (!spots.length) return;
    const trunks = new THREE.InstancedMesh(trunkGeo, mats.trunk, spots.length);
    const crowns = new THREE.InstancedMesh(crownGeo, mats.crown, spots.length);
    spots.forEach(([x, z], i) => {
      const k = 0.7 + rand() * 0.7;
      q.setFromAxisAngle(up, rand() * 6.28);
      m.compose(p.set(x, world.terrain(x, z) - 0.2, z), q, s.set(k, k * (0.85 + rand() * 0.4), k));
      trunks.setMatrixAt(i, m);
      crowns.setMatrixAt(i, m);
      crowns.setColorAt(i, color(c));
    });
    for (const t of [trunks, crowns]) t.computeBoundingSphere();
    crowns.castShadow = true;
    out.push(trunks, crowns);
  };
  // Берёзы, липы, тополя условно — разными оттенками зелёного; ели — тёмные сине-зелёные.
  plant(leafy, mats.trunkGeo, mats.crownGeo, (c) => c.setHSL(0.25 + rand() * 0.08, 0.35 + rand() * 0.2, 0.22 + rand() * 0.1));
  plant(spruce, mats.spruceTrunkGeo, mats.spruceGeo, (c) => c.setHSL(0.36 + rand() * 0.05, 0.35 + rand() * 0.15, 0.15 + rand() * 0.06));
  return out;
}

// ---------------------------------------------------------------- миникарта

export const MINIMAP_SCALE = 0.5; // пикселей на метр (1 px = 2 м)

// Тайл миникарты на квадрат: вода и парки, дома (свои и соседей — что заходит за край), дороги.
export function drawMinimapTile(world, info) {
  const { x0, z0, x1, z1, data } = info;
  const S = MINIMAP_SCALE;
  const c = document.createElement('canvas');
  c.width = Math.ceil((x1 - x0) * S);
  c.height = Math.ceil((z1 - z0) * S);
  const g = c.getContext('2d');
  g.fillStyle = '#1d2124';
  g.fillRect(0, 0, c.width, c.height);
  const tx = (x) => (x - x0) * S, tz = (z) => (z - z0) * S;
  for (const a of data.areas) {
    if (a.k !== 'water' && a.k !== 'park') continue;
    g.beginPath();
    g.moveTo(tx(a.p[0][0]), tz(a.p[0][1]));
    for (const [x, z] of a.p) g.lineTo(tx(x), tz(z));
    g.fillStyle = a.k === 'water' ? '#24465c' : '#25331f';
    g.fill();
  }
  g.lineCap = g.lineJoin = 'round';
  g.strokeStyle = '#24465c';
  for (const w of data.waterways) {
    g.beginPath();
    w.p.forEach(([x, z], i) => g[i ? 'lineTo' : 'moveTo'](tx(x), tz(z)));
    g.lineWidth = Math.max(1, w.w * S);
    g.stroke();
  }
  g.fillStyle = '#34373a';
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      for (const b of world.chunkInfo(info.ci + di, info.cj + dj).data.buildings) {
        g.beginPath();
        for (const ring of [b.p, ...(b.holes || [])]) {
          g.moveTo(tx(ring[0][0]), tz(ring[0][1]));
          for (const [x, z] of ring) g.lineTo(tx(x), tz(z));
          g.closePath();
        }
        g.fill('evenodd');
      }
    }
  }
  g.lineCap = g.lineJoin = 'round';
  for (const r of data.lines) {
    g.beginPath();
    const p = r.n.map((i) => world.nodes[i]);
    g.moveTo(tx(p[0][0]), tz(p[0][1]));
    for (const [x, z] of p) g.lineTo(tx(x), tz(z));
    g.lineWidth = Math.max(1.2, r.w * S);
    g.strokeStyle = MARKED_CLASSES.has(r.k) ? '#c9c4b5' : '#7c7a74';
    g.stroke();
  }
  return c;
}

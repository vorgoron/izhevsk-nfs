// Построение мешей города из World.
import * as THREE from 'three';
import { MARKED_CLASSES } from './world.js';
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

function asphaltTexture(marked, renderer) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#3a3b3d';
  g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 2500; i++) {
    const v = 40 + Math.random() * 40;
    g.fillStyle = `rgba(${v},${v},${v},0.5)`;
    g.fillRect(Math.random() * 128, Math.random() * 256, 1.5, 1.5);
  }
  if (marked) {
    g.fillStyle = '#d8d8d0';
    g.fillRect(3, 0, 3, 256);
    g.fillRect(122, 0, 3, 256);
    g.fillRect(62, 0, 4, 128); // прерывистая осевая
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
  const mat = (marked) => new THREE.MeshLambertMaterial({
    map: asphaltTexture(marked, renderer),
    side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  return { marked: mat(true), plain: mat(false) };
}

// Ленты дорог квадрата: каждый кусок (run) — отрезки одной дороги подряд.
export function buildRoadChunk(world, runs, mats) {
  const buckets = { marked: { p: [], uv: [], idx: [] }, plain: { p: [], uv: [], idx: [] } };

  for (const { road, from, to } of runs) {
    const b = buckets[MARKED_CLASSES.has(road.k.replace('_link', '')) ? 'marked' : 'plain'];
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
    const mesh = new THREE.Mesh(geo, mats[name]);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

// ---------------------------------------------------------------- здания

// 0 панель, 1 кирпич, 2 штукатурка, 3 пром, 4 храм
const WALL = ['#c8c5bb', '#a2603f', '#d8b97f', '#8e8f8c', '#f1eee6', '#d4d1ca'];
const ROOF = ['#5d5d5d', '#4f4a47', '#6b5d4e', '#686a68', '#b89b4a', '#8d9096'];
const SEATS = '#2f63a8'; // трибуны: сторона к полю — ряды сидений

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

export function buildingMaterials(renderer) {
  return {
    walls: new THREE.MeshLambertMaterial({ vertexColors: true, map: windowTexture(renderer) }),
    roofs: new THREE.MeshLambertMaterial({ vertexColors: true }),
  };
}

// Куски одного дома, разрезанного аркой (общий g): индекс по g, чтобы уровень крыши был общим.
let pieceIndex = null;

export function buildBuildingChunk(world, list, mats) {
  const wp = [], wn = [], wc = [], wuv = [];
  const rp = [], rc = [];
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

    // Лёгкий разброс оттенка, чтобы кварталы не были одинаковыми.
    col.set(RECOLOR[b.lm]?.[0] ?? WALL[b.s]);
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
  return {
    trunkGeo: new THREE.CylinderGeometry(0.18, 0.25, 3, 5).translate(0, 1.5, 0),
    crownGeo: new THREE.IcosahedronGeometry(2.4, 0).translate(0, 4.6, 0),
    trunk: new THREE.MeshLambertMaterial({ color: '#5a4632' }),
    crown: new THREE.MeshLambertMaterial({ color: '#ffffff' }),
  };
}

const PARK_DENSITY = 1 / 110;   // деревьев на м² рамки парка/леса
const MAX_TREES = 900;          // на квадрат

// Деревья квадрата: из OSM и случайные в парках/лесах (детерминированно по квадрату).
export function buildTreeChunk(world, info, mats) {
  const { x0, z0, x1, z1, data } = info;
  // Возле достопримечательностей деревья не сажаем: они закрывают модели.
  const POINT_CLEAR = { wheel: 27 }; // колесо широкое: деревья врезались бы в нижние кабинки
  const clear = (world.city.landmarks || []).map((l) => [l.x, l.z, l.p
    ? Math.max(...l.p.map(([x, z]) => Math.hypot(x - l.x, z - l.z))) + 6 : POINT_CLEAR[l.key] ?? 12]);
  const free = (x, z) => clear.every(([cx, cz, r]) => Math.hypot(x - cx, z - cz) > r);
  const spots = data.trees.filter(([x, z]) => free(x, z));
  let rnd = (info.ci * 48271 + info.cj * 16807 + 12345) % 2147483647 || 1;
  const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
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
    for (let i = 0; i < n && spots.length < MAX_TREES; i++) {
      const x = minx + rand() * (maxx - minx), z = minz + rand() * (maxz - minz);
      if (!pointInPoly(x, z, a.p) || (a.holes || []).some((h) => pointInPoly(x, z, h)) || !free(x, z)) continue;
      const r = world.nearestRoad(x, z, 3);
      if (r && r.d < 1.5) continue;
      spots.push([x, z]);
    }
  }
  if (!spots.length) return [];
  const trunks = new THREE.InstancedMesh(mats.trunkGeo, mats.trunk, spots.length);
  const crowns = new THREE.InstancedMesh(mats.crownGeo, mats.crown, spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  spots.forEach(([x, z], i) => {
    const k = 0.7 + rand() * 0.7;
    q.setFromAxisAngle(up, rand() * 6.28);
    m.compose(p.set(x, world.terrain(x, z) - 0.2, z), q, s.set(k, k * (0.85 + rand() * 0.4), k));
    trunks.setMatrixAt(i, m);
    crowns.setMatrixAt(i, m);
    // Ели и берёзы условно — разными оттенками зелёного.
    crowns.setColorAt(i, c.setHSL(0.25 + rand() * 0.08, 0.35 + rand() * 0.2, 0.22 + rand() * 0.1));
  });
  for (const t of [trunks, crowns]) t.computeBoundingSphere();
  crowns.castShadow = true;
  return [trunks, crowns];
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

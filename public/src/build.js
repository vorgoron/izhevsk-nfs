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
  // Асфальт под дорожными мешами закрывает щели на перекрёстках; пути — поверх него.
  for (const r of data.lines) stroke(r.n.map((i) => world.nodes[i]), r.w + 0.6, '#3b3c3e');
  for (const r of data.rails) stroke(r.p, r.k === 'tram' ? 2.4 : 3.2, '#4d4038');

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
    embank: new THREE.MeshLambertMaterial({ color: '#6f7d4f', side: THREE.DoubleSide }),
    rail: new THREE.MeshPhongMaterial({ color: '#8f9399', specular: '#e8edf2', shininess: 80, side: THREE.DoubleSide }),
    pillarGeo: new THREE.BoxGeometry(1.3, 1, 1.3).translate(0, 0.5, 0),
  };
}

const DECK = 1.2, PARAPET = 0.9, PILLAR_STEP = 20;
const MEDIAN_REACH = 25; // м: дальше парный мост не соединяется общим настилом (как MEDIAN_MAX в world.js)

// Ленты дорог квадрата: каждый кусок (run) — отрезки одной дороги подряд.
export function buildRoadChunk(world, runs, mats) {
  const buckets = {};
  const bp = [], pillars = [], abutments = [], emb = []; // плиты и парапеты (треугольники), опоры, устои

  for (const { road, from, to } of runs) {
    const mk = roadMarking(road);
    const b = (buckets[mk] ??= { p: [], uv: [], idx: [] });
    // Ресемплинг до 5 м, чтобы полотно повторяло рельеф.
    const src = road.n.slice(from, to + 1).map((i) => world.nodes[i]);
    const ysrc = road.y?.slice(from, to + 1);
    // Расстояние от начала дороги до узла from + k (для подъездов к мостам).
    const sAcc = [0];
    for (let k = 1; k < road.n.length; k++) {
      const [ax, az] = world.nodes[road.n[k - 1]], [bx, bz] = world.nodes[road.n[k]];
      sAcc.push(sAcc[k - 1] + Math.hypot(bx - ax, bz - az));
    }
    const sOf = (k) => sAcc[from + k];
    const pts = [], ys = [];
    for (let i = 0; i < src.length; i++) {
      if (i > 0) {
        const [ax, az] = src[i - 1], [bx, bz] = src[i];
        const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 5);
        for (let k = 1; k < n; k++) {
          const t = k / n;
          pts.push([ax + (bx - ax) * t, az + (bz - az) * t]);
          const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
          ys.push(ysrc ? ysrc[i - 1] + (ysrc[i] - ysrc[i - 1]) * t : world.rampAt(road, sOf(i - 1) + Math.hypot(bx - ax, bz - az) * t, px, pz));
        }
      }
      pts.push(src[i]);
      ys.push(ysrc ? ysrc[i] : world.rampAt(road, sOf(i), src[i][0], src[i][1]));
    }
    const half = road.w / 2;
    const base = b.p.length / 3;
    // Продольная координата текстуры — от начала дороги, чтобы разметка не сбивалась на стыке квадратов.
    let bridgeEdge = null; // нормаль полотна в предыдущей точке (для бортов моста)
    let prevMedian = null; // края общего настила с парным мостом в предыдущей точке
    let prevEdge = null;   // края полотна в предыдущей точке (для откосов насыпи подъезда)
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
      // Полотно не заходит на трамвайные пути рядом (в OSM ось дороги часто ближе к путям, чем
      // половина её ширины): край с той стороны отступает до 2 м от оси пути.
      let hl = half, hr = half;
      if (!road.br) {
        const [x0, z0] = pts[i];
        for (const sg of world.railsNear(x0, z0)) {
          if (sg.k !== 'tram') continue;
          const ex = sg.bx - sg.ax, ez = sg.bz - sg.az, el = Math.hypot(ex, ez) || 1;
          if (Math.abs((ex * dx + ez * dz) / el) < 0.9) continue; // пересечение, а не вдоль
          const c = World.closest(sg, x0, z0);
          const lat = (c.px - x0) * -dz + (c.pz - z0) * dx; // >0 — слева (сторона +n)
          if (Math.abs(lat) > half + 2.2) continue;
          if (lat > 0) hl = Math.min(hl, Math.max(2.4, lat - 2));
          else hr = Math.min(hr, Math.max(2.4, -lat - 2));
        }
      }
      const nx = -dz * hl * m, nz = dx * hl * m, rnx = -dz * hr * m, rnz = dx * hr * m;
      if (i > 0) v += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const [x, z] = pts[i];
      const yl = ys[i] ?? world.terrain(x + nx, z + nz) + road.lift;
      const yr = ys[i] ?? world.terrain(x - rnx, z - rnz) + road.lift;
      b.p.push(x + nx, yl, z + nz, x - rnx, yr, z - rnz);
      // Подъезд к мосту выше земли — насыпь: откосы от краёв полотна вниз до рельефа.
      const L_ = [x + nx, yl, z + nz], R_ = [x - rnx, yr, z - rnz];
      if (!road.br && ys[i] != null && prevEdge) {
        for (const [p0, p1, sg] of [[prevEdge.L, L_, 1], [prevEdge.R, R_, -1]]) {
          const o = 2.5; // откос в сторону
          const q0 = [p0[0] + (sg > 0 ? nx : -rnx) / (sg > 0 ? hl : hr) * o, 0, p0[2] + (sg > 0 ? nz : -rnz) / (sg > 0 ? hl : hr) * o];
          const q1 = [p1[0] + (sg > 0 ? nx : -rnx) / (sg > 0 ? hl : hr) * o, 0, p1[2] + (sg > 0 ? nz : -rnz) / (sg > 0 ? hl : hr) * o];
          q0[1] = world.terrain(q0[0], q0[2]) - 0.3;
          q1[1] = world.terrain(q1[0], q1[2]) - 0.3;
          if (p0[1] - q0[1] > 0.4 || p1[1] - q1[1] > 0.4) quad(emb, [p0[0], p0[1] - 0.05, p0[2]], [p1[0], p1[1] - 0.05, p1[2]], q1, q0);
        }
      }
      prevEdge = ys[i] != null ? { L: L_, R: R_ } : null;
      b.uv.push(0, v / 12, 1, v / 12);
      // Мост: борта (фасция + парапет) по краям и плита снизу; опоры до земли через ~20 м.
      if (road.br && ys[i] != null && i > 0) {
        const [px, pz] = pts[i - 1], pl = bridgeEdge, y0 = ys[i - 1], y1 = ys[i];
        const o = 1 + 0.25 / half; // борт чуть снаружи полотна
        for (const sgn of [1, -1]) {
          if (road.twin && sgn === road.twinSide) continue; // к парному мосту — общий настил, без борта
          const ax = px + sgn * pl.nx * o, az = pz + sgn * pl.nz * o, bx = x + sgn * nx * o, bz = z + sgn * nz * o;
          quad(bp, [ax, y0 - DECK, az], [bx, y1 - DECK, bz], [bx, y1 + PARAPET, bz], [ax, y0 + PARAPET, az]);
        }
        quad(bp, [px + pl.nx * o, y0 - DECK, pz + pl.nz * o], [x + nx * o, y1 - DECK, z + nz * o],
          [x - nx * o, y1 - DECK, z - nz * o], [px - pl.nx * o, y0 - DECK, pz - pl.nz * o]);
        if (Math.floor(v / PILLAR_STEP) !== Math.floor((v - Math.hypot(x - px, z - pz)) / PILLAR_STEP)) {
          for (const off of road.w > 12 ? [-0.5, 0.5] : [0]) {
            const qx = x + nx * off, qz = z + nz * off, g = world.terrain(qx, qz);
            const onRoad = world.nearbyRoadSegments(qx, qz).some((q) => q.ya === undefined && World.closest(q, qx, qz).d < q.w / 2 + 1)
              || world.railsNear(qx, qz).some((q) => World.closest(q, qx, qz).d < 3);
            if (y1 - DECK - g > 2.5 && !onRoad) pillars.push([qx, qz, g - 0.5, y1 - DECK]); // не на дорогу под мостом
          }
        }
      }
      // Общий настил до парного моста: от своего края до края соседа, плита толщиной DECK.
      if (road.medianDraw && ys[i] != null) {
        const tw = medianEdge(world, road, x, z, nx, nz, half, ys[i]);
        if (tw && prevMedian) {
          quad(bp, prevMedian[0], tw[0], tw[1], prevMedian[1]);
          const dn = (p) => [p[0], p[1] - DECK, p[2]];
          quad(bp, dn(prevMedian[1]), dn(tw[1]), dn(tw[0]), dn(prevMedian[0]));
        }
        prevMedian = tw;
      }
      bridgeEdge = { nx, nz };
      // Береговой устой на концах моста: стенка от настила до земли (и ниже), перекрывает
      // ступеньку между мостом и берегом.
      if (road.br && ys[i] != null && ((from === 0 && i === 0) || (to === road.n.length - 1 && i === pts.length - 1))) {
        // Под настилом, чуть внутрь пролёта: сверху не выступает, перекрывает щель до земли.
        const inward = i === 0 ? 1.6 : -1.6;
        const g = Math.min(world.terrain(x + nx, z + nz), world.terrain(x - rnx, z - rnz), world.terrain(x, z));
        abutments.push([x + dx * inward, z + dz * inward, Math.atan2(dx, dz), road.w + 1.2, g - 3, ys[i] - DECK]);
      }
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
  if (emb.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(emb, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mats.embank);
    m.receiveShadow = true;
    group.add(m);
  }
  if (abutments.length) {
    const im = new THREE.InstancedMesh(mats.pillarGeo, mats.concrete, abutments.length);
    const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    abutments.forEach(([x, z, a, w, y0, y1], i) => {
      q.setFromAxisAngle(up, a);
      im.setMatrixAt(i, mt.compose(new THREE.Vector3(x, y0, z), q, new THREE.Vector3(w / 1.3, y1 - y0, 3 / 1.3)));
    });
    im.castShadow = im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  }
  if (pillars.length) {
    const im = new THREE.InstancedMesh(mats.pillarGeo, mats.concrete, pillars.length);
    const mt = new THREE.Matrix4();
    pillars.forEach(([x, z, y0, y1], i) => im.setMatrixAt(i, mt.makeScale(1, y1 - y0, 1).setPosition(x, y0, z)));
    im.castShadow = true;
    im.computeBoundingSphere();
    group.add(im);
    // Без коллайдеров: столкновения плоские (2D), и опора под мостом стала бы невидимой стеной
    // для машины на самом мосту.
  }
  return group;
}

// Края общего настила в точке моста: [свой край, край парного моста] или null (за его концами).
function medianEdge(world, road, x, z, nx, nz, half, y) {
  const l = Math.hypot(nx, nz) || 1, ux = (nx / l) * road.twinSide, uz = (nz / l) * road.twinSide;
  let best = null;
  for (const s of world.segmentsNear(x, z, MEDIAN_REACH)) {
    if (s.road !== road.twin) continue;
    const c = World.closest(s, x, z);
    if (!best || c.d < best.c.d) best = { s, c };
  }
  if (!best || best.c.t === 0 && best.s.s0 === 0 || best.c.t === 1 && best.s.s0 + best.s.len >= road.twin.len - 0.01) return null;
  const { s, c } = best, w2 = s.w / 2;
  if (c.d - half - w2 > MEDIAN_REACH) return null;
  const yb = s.ya + (s.yb - s.ya) * c.t;
  // Край соседа — со стороны нашего моста.
  return [[x + ux * half, y, z + uz * half], [c.px - ux * w2, yb, c.pz - uz * w2]];
}

function quad(arr, a, b, c, d) {
  arr.push(...a, ...b, ...c, ...a, ...c, ...d);
}

// ---------------------------------------------------------------- рельсы

const GAUGE = 1.524; // м, русская колея
const RAIL_DECK = 4.4; // м: ширина плиты под путём, поднятым вдоль путепровода

// Рельсы квадрата: две стальные полосы на каждом пути (трамвай и железная дорога), над землёй
// или полотном дороги. Отрезки, середина которых в квадрате.
export function buildRailChunk(world, info, mat, deckMat) {
  const { x0, z0, x1, z1, data } = info;
  const pos = [], deck = [];
  for (const r of data.rails) {
    const p = r.p;
    for (let i = 1; i < p.length; i++) {
      const [ax, az] = p[i - 1], [bx, bz] = p[i];
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (mx < x0 || mx >= x1 || mz < z0 || mz >= z1) continue;
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.05) continue;
      const n = Math.ceil(L / 4), dx = (bx - ax) / L, dz = (bz - az) / L;
      // Путь поднят вдоль путепровода — под ним плита на ширину пути (соседние пути смыкаются),
      // на насыпи подъезда плита уходит в рельеф.
      for (let k = 0; k < n; k++) {
        const sx = ax + ((bx - ax) * k) / n, sz = az + ((bz - az) * k) / n, ex = ax + ((bx - ax) * (k + 1)) / n, ez = az + ((bz - az) * (k + 1)) / n;
        const sy = world.railGround(sx, sz, dx, dz), ey = world.railGround(ex, ez, dx, dz);
        if (sy - world.terrain(sx, sz) < 1 && ey - world.terrain(ex, ez) < 1) continue;
        const onMedian = (px, pz, py) => { const m = world.medianY(px, pz); return m !== null && Math.abs(m - py) < 0.01; };
        if (onMedian(sx, sz, sy) && onMedian(ex, ez, ey)) continue; // лежит на общем настиле
        const hx = -dz * RAIL_DECK / 2, hz = dx * RAIL_DECK / 2;
        quad(deck, [sx + hx, sy, sz + hz], [ex + hx, ey, ez + hz], [ex - hx, ey, ez - hz], [sx - hx, sy, sz - hz]);
        for (const sg of [1, -1]) quad(deck, [sx + hx * sg, sy, sz + hz * sg], [ex + hx * sg, ey, ez + hz * sg], [ex + hx * sg, ey - DECK, ez + hz * sg], [sx + hx * sg, sy - DECK, sz + hz * sg]);
        quad(deck, [sx + hx, sy - DECK, sz + hz], [ex + hx, ey - DECK, ez + hz], [ex - hx, ey - DECK, ez - hz], [sx - hx, sy - DECK, sz - hz]);
      }
      for (const side of [-1, 1]) {
        const ox = -dz * (GAUGE / 2) * side, oz = dx * (GAUGE / 2) * side;
        for (let k = 0; k < n; k++) {
          const t0 = (k / n) * L, t1 = ((k + 1) / n) * L;
          const sx = ax + dx * t0 + ox, sz = az + dz * t0 + oz, ex = ax + dx * t1 + ox, ez = az + dz * t1 + oz;
          const sy = world.railGround(sx, sz, dx, dz) + 0.06, ey = world.railGround(ex, ez, dx, dz) + 0.06;
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
  if (!deck.length || !deckMat) return m;
  const g = new THREE.Group();
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.Float32BufferAttribute(deck, 3));
  dg.computeVertexNormals();
  const dm = new THREE.Mesh(dg, deckMat);
  dm.castShadow = dm.receiveShadow = true;
  g.add(m, dm);
  return g;
}

// ---------------------------------------------------------------- здания

// 0 панель, 1 кирпич, 2 штукатурка, 3 пром, 4 храм
// Палитры по серии (стиль дома из city.json, см. building_style в fetch_city.py): стена, крыша.
const WALLS = [
  ['#d9d6cf', '#cfd3d4', '#d8cfc0', '#c9c6be'],             // 0 панельная пятиэтажка
  ['#e3dfd6', '#d9d5cb', '#a2603f', '#9a5a3c', '#c9a676'], // 1 хрущёвка: силикатный белый, красный, жёлтый кирпич
  ['#d8b97f', '#e0c9a0', '#d4aaa0', '#e8e2d0', '#c4cfb4'], // 2 штукатурка: охра, розовый, белый, салатовый
  ['#8e8f8c', '#a3a29c', '#9aa3a6'],                       // 3 пром
  ['#f1eee6'],                                              // 4 храм
  ['#d4d1ca'],                                              // 5 трибуны, навесы
  ['#b98a5a'],                                              // 6 частный (свои цвета — HOUSE_WALLS)
  ['#e6e4de', '#d6d8d6', '#e0dccf', '#dcdfe2'],             // 7 панельная девятиэтажка
  ['#a2603f', '#e3dfd6', '#b5714a', '#d9d5cb'],             // 8 кирпичный многоэтажный
  ['#ece8e0', '#d9cdb8', '#c8ccd0', '#e8dccd', '#d6c3b0'],  // 9 новостройка
  ['#e6e1d6', '#d8c39a', '#c4cfd6', '#d6d0c4'],             // 10 общественное
  ['#d9a19a', '#e0b0a8', '#a9c49c', '#b5cfa6', '#d8b45c', '#cfa64e'], // 11 малоэтажный послевоенный: розовый, зелёный, горчичный
];
const ROOFS = ['#686a68', '#5d5d5d', '#6b5d4e', '#686a68', '#b89b4a', '#8d9096', '#8a3b2c',
  '#5f6163', '#5d5a57', '#55585c', '#626466'];
// Скатные крыши малоэтажных послевоенных домов: шифер, зелёное и коричневое железо.
const LOWRISE_ROOFS = ['#70757a', '#7d8287', '#4d6b4f', '#5a6e5c', '#6e4a3c'];
const SEATS = '#2f63a8'; // трибуны: сторона к полю — ряды сидений
// Частный сектор (стиль 6): стены — дерево, крашеные, белый кирпич; крыши — ржавое железо, зелёные, шифер.
const HOUSE_WALLS = ['#9c7350', '#b98a5a', '#7fa3b8', '#8fae8a', '#d9d4c5', '#c8b27a', '#a5664a', '#c9c3b4'];
const HOUSE_ROOFS = ['#8a3b2c', '#4d6b4f', '#7d8287', '#5a4636', '#9b5a36', '#6f7478'];

// ---------------------------------------------------------------- фасады

// Атлас фасадов: полоса на серию, в полосе два ряда по этажу — типовой этаж (верх) и первый (низ).
// Ширина полосы — w метров стены (повторяется по горизонтали), высота ряда — один этаж.
// Рисунок светлый и умножается на цвет стены; акценты новостроек — отдельным цветом.
const FA = { W: 512, R: 128 }; // px: ширина полосы, высота ряда (этажа)
const FACADES = [
  { w: 6.4, draw: panel5 },     // 0
  { w: 6.0, draw: brick5 },     // 1
  { w: 3.6, draw: stalin },     // 2
  { w: 6.0, draw: industrial }, // 3
  { w: 3.2, draw: generic },    // 4 храм
  { w: 3.2, draw: generic },    // 5 (окон нет — см. buildBuildingChunk)
  { w: 3.2, draw: generic },    // 6 частный
  { w: 6.6, draw: panel9 },     // 7
  { w: 6.0, draw: brick9 },     // 8
  { w: 6.0, draw: newBuild },   // 9
  { w: 6.0, draw: publicB },    // 10
  { w: 3.6, draw: stalin },     // 11 малоэтажный послевоенный
  { w: 3.2, draw: panelEnd },   // 12 глухой торец панельного дома
];
const END_WALL = 12;

// Маска «не красить в цвет стены» (стекло, рамы, вставки): рисуется параллельно атласу, потом
// уходит в альфу атласа (0.5 — свой цвет, 1 — умножить на цвет стены).
let rawMask = null;
const raw = (x, y, w, h) => rawMask.fillRect(x, y, w, h);

// Стекло: тёмное с разбросом; переплёт и подоконник светлые. Светящихся окон нет: ночи в игре нет,
// а окно атласа повторяется на каждом этаже — горел бы целый столбец.
function glass(g, x, y, w, h, rnd, { mull = true, sill = true, frame = '#f4f4f0' } = {}) {
  const sh = 45 + rnd() * 40;
  raw(x - 3, y - 3, w + 6, h + 6);
  g.fillStyle = frame;
  g.fillRect(x - 3, y - 3, w + 6, h + 6);
  g.fillStyle = `rgb(${sh * 0.8},${sh},${sh * 1.15})`;
  g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(255,255,255,0.18)'; // блик сверху
  g.fillRect(x, y, w, h * 0.3);
  g.fillStyle = frame;
  if (mull) {
    g.fillRect(x + w * 0.5 - 2, y, 4, h);
    g.fillRect(x, y + h * 0.3, w, 3);
  }
  if (sill) {
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fillRect(x - 6, y + h + 3, w + 12, 4);
  }
}
const shade = (g, a, x, y, w, h) => { g.fillStyle = `rgba(0,0,0,${a})`; g.fillRect(x, y, w, h); };
function seams(g, step) { // швы панелей: вертикальные через step px и межэтажный
  for (let x = 0; x <= FA.W; x += step) shade(g, 0.13, x - 1, 0, 2, FA.R);
  shade(g, 0.13, 0, FA.R - 2, FA.W, 2);
}
function bricks(g) {
  for (let y = 2; y < FA.R; y += 5) shade(g, 0.05, 0, y, FA.W, 1);
  for (let i = 0; i < 900; i++) shade(g, 0.04, (i * 977) % FA.W, (i * 131) % FA.R, 3, 2);
}
const plinth = (g) => shade(g, 0.22, 0, FA.R - 22, FA.W, 22);

function panel5(g, ground, rnd) {
  seams(g, 256);
  glass(g, 68, 30, 120, 58, rnd);
  if (ground) glass(g, 324, 30, 120, 58, rnd);
  else { // окно и балконная дверь, перед ними балкон: плита и ограждение во всю ширину
    glass(g, 290, 30, 104, 58, rnd);
    glass(g, 412, 22, 52, 96, rnd, { sill: false, mull: false });
    g.fillStyle = '#c7cac6';
    g.fillRect(276, 84, 202, 34);
    raw(276, 84, 202, 34);
    shade(g, 0.15, 276, 84, 202, 3);
    for (let x = 300; x < 470; x += 24) shade(g, 0.08, x, 87, 2, 31);
    g.fillStyle = '#9fa29e';
    g.fillRect(272, 118, 210, 8);
    raw(272, 118, 210, 8);
  }
  if (ground) plinth(g);
}
function brick5(g, ground, rnd) {
  bricks(g);
  for (const x of [52, 308]) {
    shade(g, 0.12, x - 8, 22, 152, 6); // перемычка
    glass(g, x, 30, 136, 60, rnd);
  }
  if (ground) plinth(g);
}
function stalin(g, ground, rnd) {
  if (ground) {
    for (let y = 8; y < FA.R; y += 14) shade(g, 0.12, 0, y, FA.W, 2); // руст
    glass(g, 120, 22, 272, 86, rnd, { sill: false });
    shade(g, 0.2, 0, FA.R - 14, FA.W, 14);
    return;
  }
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.fillRect(0, 0, FA.W, 7); // карниз-тяга
  shade(g, 0.1, 0, 7, FA.W, 2);
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.fillRect(150, 14, 212, 8); // сандрик
  shade(g, 0.12, 150, 22, 212, 2);
  glass(g, 170, 26, 172, 82, rnd);
}
function industrial(g, ground, rnd) {
  shade(g, 0.08, 0, FA.R - 3, FA.W, 3);
  if (ground) { shade(g, 0.12, 0, 60, FA.W, FA.R - 60); return; }
  g.fillStyle = '#e8e8e4';
  g.fillRect(0, 22, FA.W, 54);
  raw(0, 22, FA.W, 54);
  for (let x = 0; x < FA.W; x += 85) {
    const sh = 70 + rnd() * 30;
    g.fillStyle = `rgb(${sh * 0.85},${sh},${sh * 1.05})`;
    g.fillRect(x + 4, 26, 77, 46);
  }
}
function generic(g, ground, rnd) {
  shade(g, 0.06, 0, FA.R - 2, FA.W, 2);
  glass(g, 128, 28, 256, 66, rnd);
}
function panel9(g, ground, rnd) {
  seams(g, 256);
  glass(g, 68, 30, 120, 58, rnd);
  if (ground) { glass(g, 324, 30, 120, 58, rnd); plinth(g); return; }
  // Лоджия во всю панель: тёмная ниша, остекление внутри, сплошное ограждение снизу.
  shade(g, 0.55, 276, 10, 216, 108);
  glass(g, 290, 22, 188, 50, rnd, { sill: false, frame: '#9a9c9a' });
  g.fillStyle = '#d4d6d2';
  g.fillRect(272, 72, 224, 46);
  shade(g, 0.1, 272, 72, 224, 3);
}
function brick9(g, ground, rnd) {
  bricks(g);
  shade(g, 0.12, 44, 22, 152, 6);
  glass(g, 52, 30, 136, 60, rnd);
  if (ground) { glass(g, 316, 30, 136, 60, rnd); plinth(g); return; }
  shade(g, 0.62, 290, 8, 200, 110); // лоджия: ниша и кирпичное ограждение
  glass(g, 304, 18, 172, 54, rnd, { sill: false, frame: '#9a9c9a' });
  g.save();
  g.beginPath(); g.rect(286, 74, 208, 44); g.clip();
  g.fillStyle = '#ffffff'; g.fillRect(286, 74, 208, 44);
  bricks(g);
  g.restore();
  shade(g, 0.3, 286, 74, 208, 4);
  shade(g, 0.15, 286, 114, 208, 4);
}
function newBuild(g, ground, rnd) {
  if (ground) { // витрины первого этажа
    g.fillStyle = '#3a3f45';
    g.fillRect(0, 10, FA.W, 108);
    raw(0, 10, FA.W, 108);
    for (let x = 0; x < FA.W; x += 128) glass(g, x + 6, 16, 116, 96, rnd, { sill: false, mull: false, frame: '#3a3f45' });
    shade(g, 0.3, 0, 0, FA.W, 10);
    return;
  }
  g.fillStyle = '#c96a3c'; // цветные вставки между окнами
  g.fillRect(0, 0, 40, FA.R);
  g.fillRect(256, 0, 40, FA.R);
  g.fillStyle = '#7d8288';
  g.fillRect(216, 0, 40, FA.R);
  g.fillRect(472, 0, 40, FA.R);
  for (const x of [0, 216, 256, 472]) raw(x, 0, 40, FA.R);
  glass(g, 58, 14, 140, 92, rnd, { frame: '#e6e6e2' });
  glass(g, 314, 14, 140, 92, rnd, { frame: '#e6e6e2' });
  shade(g, 0.18, 0, FA.R - 6, FA.W, 6); // торец перекрытия
}
function publicB(g, ground, rnd) {
  shade(g, 0.08, 0, FA.R - 4, FA.W, 4);
  if (ground) {
    glass(g, 30, 18, 452, 92, rnd, { sill: false });
    for (let x = 30 + 113; x < 480; x += 113) { g.fillStyle = '#f4f4f0'; g.fillRect(x - 2, 18, 4, 92); }
    return;
  }
  glass(g, 20, 30, 220, 64, rnd);
  glass(g, 272, 30, 220, 64, rnd);
}
function panelEnd(g) {
  seams(g, 256);
}

function facadeAtlas(renderer) {
  const c = document.createElement('canvas');
  c.width = FA.W;
  c.height = FA.R * 2 * FACADES.length;
  const g = c.getContext('2d', { willReadFrequently: true });
  const mc = document.createElement('canvas');
  mc.width = c.width;
  mc.height = c.height;
  rawMask = mc.getContext('2d', { willReadFrequently: true });
  rawMask.fillStyle = '#fff';
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  FACADES.forEach((f, k) => {
    for (const ground of [false, true]) {
      for (const x of [g, rawMask]) {
        x.save();
        x.translate(0, (2 * k + (ground ? 1 : 0)) * FA.R);
        x.beginPath(); x.rect(0, 0, FA.W, FA.R); x.clip();
      }
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, FA.W, FA.R);
      f.draw(g, ground, rnd);
      g.restore();
      rawMask.restore();
    }
  });
  const img = g.getImageData(0, 0, c.width, c.height), mask = rawMask.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < mask.length; i += 4) if (mask[i] > 127) img.data[i] = 128;
  g.putImageData(img, 0, 0);
  rawMask = null;
  const t = new THREE.CanvasTexture(c);
  t.premultiplyAlpha = false;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

// Стены: uv = (метры вдоль стены / w полосы, этажи от уровня земли); атрибут aFac = (полоса, число этажей).
// Ниже земли (цоколь на склоне) и выше последнего этажа (парапет) — гладкая стена. Повтор — fract в
// шейдере, выборка через textureGrad по непрерывным uv: иначе на стыке плиток мип-уровень скачет (шов).
function facadeMaterial(renderer) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, map: facadeAtlas(renderer) });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aFac;\nvarying vec2 vFac;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFac = aFac;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFac;')
      .replace('#include <map_fragment>', `
        float tintMask = 1.0;
        vec2 fu = vMapUv;
        float nb = ${2 * FACADES.length}.0;
        vec4 sampledDiffuseColor = vec4(fu.y < 0.0 ? 0.85 : 1.0);
        if (fu.y >= 0.0 && fu.y < vFac.y) {
          float row = fu.y < 1.0 ? 1.0 : 0.0;
          vec2 t = vec2(fract(fu.x), 1.0 - (2.0 * vFac.x + 1.0 + row - fract(fu.y)) / nb);
          vec2 sc = vec2(1.0, 1.0 / nb);
          sampledDiffuseColor = textureGrad(map, t, dFdx(fu) * sc, dFdy(fu) * sc);
          tintMask = smoothstep(0.6, 0.9, sampledDiffuseColor.a);
          sampledDiffuseColor.a = 1.0;
        }
        diffuseColor *= sampledDiffuseColor;`)
      .replace('#include <color_fragment>', 'diffuseColor.rgb *= mix(vec3(1.0), vColor, tintMask);');
  };
  return m;
}

const ONION = [[0, 0], [0.62, 0], [0.86, 0.1], [1, 0.28], [0.98, 0.42], [0.82, 0.58], [0.52, 0.74], [0.24, 0.87], [0.1, 0.96], [0.05, 1.08]];

export function buildingMaterials(renderer) {
  return {
    walls: facadeMaterial(renderer),
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

// Доля прямоугольника наименьшей площади вокруг контура, занятая самим контуром (1 — прямоугольник).
function rectFill(pts) {
  let area = 0, best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
    area += x1 * z2 - x2 * z1;
    const L = Math.hypot(x2 - x1, z2 - z1);
    if (L < 0.5) continue;
    const ux = (x2 - x1) / L, uz = (z2 - z1) / L;
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (const [x, z] of pts) {
      const s = x * ux + z * uz, t = -x * uz + z * ux;
      s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t);
    }
    best = Math.min(best, (s1 - s0) * (t1 - t0));
  }
  return Math.abs(area / 2) / best;
}

// Вальмовая крыша по любому контуру (CCW): верхний контур — исходный, сдвинутый внутрь на d (ширина
// крыла ≈ 2·площадь/периметр), между ними — скаты, сверху — узкая плоская полоса. Сдвиг не удался (крыло
// схлопнулось, ребро развернулось) — меньше d, совсем не вышло — false (будет плоская).
function hipRoof(pts, top, roofCol, rp, rc) {
  const n = pts.length;
  let area = 0, per = 0;
  for (let i = 0; i < n; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % n];
    area += x1 * z2 - x2 * z1;
    per += Math.hypot(x2 - x1, z2 - z1);
  }
  const wing = Math.abs(area) / per; // половина ширины крыла
  for (const d of [0.85, 0.65, 0.45].map((f) => Math.min(6, f * wing))) {
    const q = [];
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i + n - 1) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
      const l1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1, l2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) || 1;
      // Внутренние нормали рёбер (CCW: наружу — (dz, -dx)).
      const n1 = [-(p1[1] - p0[1]) / l1, (p1[0] - p0[0]) / l1], n2 = [-(p2[1] - p1[1]) / l2, (p2[0] - p1[0]) / l2];
      const bx = n1[0] + n2[0], bz = n1[1] + n2[1], c = bx * n2[0] + bz * n2[1];
      if (c < 0.3) { q.length = 0; break; } // острый угол — сдвиг улетает
      q.push([p1[0] + (bx / c) * d, p1[1] + (bz / c) * d]);
    }
    if (q.length !== n) continue;
    // Каждое сдвинутое ребро смотрит туда же, куда исходное, — иначе крыло схлопнулось.
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      const a = pts[i], b = pts[(i + 1) % n], qa = q[i], qb = q[(i + 1) % n];
      ok = (b[0] - a[0]) * (qb[0] - qa[0]) + (b[1] - a[1]) * (qb[1] - qa[1]) > 0;
    }
    if (!ok) continue;
    const H = top + d * 0.55; // уклон ~29°
    const up = (a, b, c) => { // треугольник нормалью вверх
      const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      for (const v of ny > 0 ? [a, b, c] : [a, c, b]) { rp.push(...v); rc.push(roofCol.r, roofCol.g, roofCol.b); }
    };
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, a = [pts[i][0], top, pts[i][1]], b = [pts[j][0], top, pts[j][1]];
      const c = [q[j][0], H, q[j][1]], e = [q[i][0], H, q[i][1]];
      up(a, b, c);
      up(a, c, e);
    }
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(q.map(([x, z]) => new THREE.Vector2(x, z)), [])) {
      up([q[a][0], H, q[a][1]], [q[b][0], H, q[b][1]], [q[c][0], H, q[c][1]]);
    }
    return true;
  }
  return false;
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
  const wp = [], wn = [], wc = [], wuv = [], wf = [];
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
    const pal = WALLS[b.s] ?? WALLS[2];
    col.set(RECOLOR[b.lm]?.[0] ?? (b.r ? HOUSE_WALLS[hash % HOUSE_WALLS.length] : pal[(hash >> 2) % pal.length]));
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
    // Этажи: в данных высота = этажи × 3.1 + 1 м парапета (частный дом — × 2.9 + 0.3), окна — по этажам
    // от высшей точки земли под домом. Трибуны и навесы — без окон (этажей 0).
    const [step, para] = b.r ? [2.9, 0.3] : [3.1, 1];
    const floors = stand ? 0 : Math.max(1, Math.round((b.h - para) / step)), fh = Math.max(2.4, (b.h - para) / floors);
    // На склоне этажи считаются от высшей точки земли; под ней, со стороны склона, — ещё этаж (его ряд —
    // как первый этаж: витрины, цоколь), если перепад больше ~2/3 этажа. Сверху склона он в земле.
    const extra = stand || b.mh ? 0 : Math.floor((gmax - gmin) / fh + 0.35);
    const fac = FACADES[b.s] ? b.s : 2;
    // Панельные дома: короткие стены длинного дома — глухие торцы.
    let longest = 0;
    for (let i = 0; i < pts.length; i++) longest = Math.max(longest, Math.hypot(pts[(i + 1) % pts.length][0] - pts[i][0], pts[(i + 1) % pts.length][1] - pts[i][1]));
    for (const ring of [pts, ...holes]) {
    const rc_ = stand && ring !== pts ? seats : col;
    let u = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % ring.length];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 0.01 || (ring === pts && skip.has(i))) continue;
      const nx = (z2 - z1) / len, nz = -(x2 - x1) / len;
      const band = (fac === 0 || fac === 7) && len < 16 && len < longest * 0.4 ? END_WALL : fac;
      const u1 = u, u2 = u + len / FACADES[band].w;
      const vb = (base - gmax) / fh + extra, vt = b.h / fh + extra;
      // a=(p1,base) b=(p2,base) c=(p2,top) d=(p1,top); треугольники (a,c,b) и (a,d,c)
      const quad = [
        [x1, base, z1, u1, vb], [x2, top, z2, u2, vt], [x2, base, z2, u2, vb],
        [x1, base, z1, u1, vb], [x1, top, z1, u1, vt], [x2, top, z2, u2, vt],
      ];
      for (const [x, y, z, uu, vv] of quad) {
        wp.push(x, y, z);
        wn.push(nx, 0, nz);
        wc.push(rc_.r, rc_.g, rc_.b);
        wuv.push(uu, vv);
        wf.push(band, floors && floors + extra);
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
    // Малоэтажный послевоенный: прямоугольный — двускатная крыша, Г/П-образный — вальмовая (скаты от
    // каждой стены), иначе ниже — плоская.
    if (b.s === 11 && !holes.length) {
      const roofCol = new THREE.Color(LOWRISE_ROOFS[(hash >> 3) % LOWRISE_ROOFS.length]).multiplyScalar(k);
      if (rectFill(pts) > 0.85) { gableRoof(pts, top, col, roofCol, rp, rc); continue; }
      if (hipRoof(pts, top, roofCol, rp, rc)) continue;
    }

    const contour = pts.map(([x, z]) => new THREE.Vector2(x, z));
    const tris = THREE.ShapeUtils.triangulateShape(contour, holes.map((h) => h.map(([x, z]) => new THREE.Vector2(x, z))));
    pts = [...pts, ...holes.flat()]; // индексы треугольников — по контуру и дырам подряд
    const rcol = new THREE.Color(RECOLOR[b.lm]?.[1] ?? ROOFS[b.s] ?? ROOFS[2]).multiplyScalar(k);
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
  walls.setAttribute('aFac', new THREE.Float32BufferAttribute(wf, 2));
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

function mergeGeos(geos, extra = []) {
  const names = ['position', 'normal', ...extra], arrs = names.map(() => []);
  for (const g of geos) {
    const n = g.index ? g.toNonIndexed() : g;
    names.forEach((k, i) => arrs[i].push(...n.attributes[k].array));
  }
  const out = new THREE.BufferGeometry();
  names.forEach((k, i) => out.setAttribute(k, new THREE.Float32BufferAttribute(arrs[i], 3)));
  return out;
}

const PARK_DENSITY = 1 / 150;   // деревьев на м² рамки парка/леса
const MAX_TREES = 1100;         // на квадрат
const STREET_STEP = [26, 44];   // м между деревьями вдоль улицы (случайно в диапазоне)
const STREET_KINDS = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street']);

// Деревья квадрата: из OSM, случайные в парках (лиственные) и лесах (в основном ели),
// и редкие деревья вдоль улиц в застройке. Детерминированно по квадрату.
// Проверки места для дерева или столба в квадрате: free — не у достопримечательности и не на
// рельсах, inBuilding — внутри дома квадрата.
function spotChecks(world, data) {
  // Возле достопримечательностей ничего не ставим: закрывает модели.
  const POINT_CLEAR = { wheel: 27 }; // колесо широкое: деревья врезались бы в нижние кабинки
  const clear = (world.city.landmarks || []).map((l) => [l.x, l.z, l.p
    ? Math.max(...l.p.map(([x, z]) => Math.hypot(x - l.x, z - l.z))) + 6 : POINT_CLEAR[l.key] ?? 12]);
  // Не на рельсах: трамвайные и железнодорожные пути квадрата ± 3.5 м от оси.
  const railSegs = [];
  for (const r of data.rails) for (let i = 1; i < r.p.length; i++) railSegs.push({ ax: r.p[i - 1][0], az: r.p[i - 1][1], bx: r.p[i][0], bz: r.p[i][1] });
  const offRails = (x, z) => railSegs.every((sg) => World.closest(sg, x, z).d > 3.5);
  const free = (x, z) => clear.every(([cx, cz, r]) => Math.hypot(x - cx, z - cz) > r) && offRails(x, z);
  const inBuilding = (x, z) => data.buildings.some((b) => {
    const p = b.p;
    if (Math.abs(p[0][0] - x) > 80 || Math.abs(p[0][1] - z) > 80) return false;
    return pointInPoly(x, z, p);
  });
  return { free, inBuilding };
}

export function buildTreeChunk(world, info, mats) {
  const { x0, z0, x1, z1, data } = info;
  const { free, inBuilding } = spotChecks(world, data);
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
    for (const { road, from, to } of data.runs) {
      if (!STREET_KINDS.has(road.k) || road.br || road.tu) continue;
      for (let i = from + 1; i <= to; i++) {
        const [ax, az] = world.nodes[road.n[i - 1]], [bx, bz] = world.nodes[road.n[i]];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 10) continue;
        const dx = (bx - ax) / L, dz = (bz - az) / L;
        for (const side of [-1, 1]) {
          for (let t = 6 + rand() * 10; t < L - 6; t += STREET_STEP[0] + rand() * (STREET_STEP[1] - STREET_STEP[0])) {
            if (rand() < 0.3 || count() >= MAX_TREES) continue; // с пропусками
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
    const solid = []; // для breakables.js: ствол — препятствие [x, y, z, масштаб]
    spots.forEach(([x, z], i) => {
      const k = 0.7 + rand() * 0.7, y = world.terrain(x, z) - 0.2;
      q.setFromAxisAngle(up, rand() * 6.28);
      m.compose(p.set(x, y, z), q, s.set(k, k * (0.85 + rand() * 0.4), k));
      solid.push([x, y, z, k]);
      trunks.setMatrixAt(i, m);
      crowns.setMatrixAt(i, m);
      crowns.setColorAt(i, color(c));
    });
    for (const t of [trunks, crowns]) t.computeBoundingSphere();
    crowns.castShadow = true;
    trunks.userData.spots = solid;
    out.push(trunks, crowns);
  };
  // Берёзы, липы, тополя условно — разными оттенками зелёного; ели — тёмные сине-зелёные.
  plant(leafy, mats.trunkGeo, mats.crownGeo, (c) => c.setHSL(0.25 + rand() * 0.08, 0.35 + rand() * 0.2, 0.22 + rand() * 0.1));
  plant(spruce, mats.spruceTrunkGeo, mats.spruceGeo, (c) => c.setHSL(0.36 + rand() * 0.05, 0.35 + rand() * 0.15, 0.15 + rand() * 0.06));
  return out;
}

// ---------------------------------------------------------------- фонарные столбы

// Деталь одного цвета для слияния с другими (цвет — вершинный).
function part(geo, color) {
  const g = geo.toNonIndexed(), c = new THREE.Color(color), n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// Бетонный столб с консолью и светильником над краем дороги; консоль — вдоль +x.
export function poleMaterials() {
  const T = 0.26; // наклон консоли вверх, рад
  const arm = new THREE.CylinderGeometry(0.045, 0.05, 2, 5)
    .rotateZ(-(Math.PI / 2 - T)).translate(0.05 + Math.cos(T), 8.6 + Math.sin(T), 0);
  const ex = 0.05 + 2 * Math.cos(T), ey = 8.6 + 2 * Math.sin(T); // конец консоли
  const geo = mergeGeos([
    part(new THREE.CylinderGeometry(0.09, 0.16, 9.3, 8).translate(0, 4.65 - 0.3, 0), '#9d9a91'),
    part(new THREE.CylinderGeometry(0.11, 0.11, 0.12, 8).translate(0, 8.95, 0), '#77756f'), // оголовок
    part(arm, '#5d6266'),
    part(new THREE.BoxGeometry(0.75, 0.17, 0.32).rotateZ(-0.1).translate(ex + 0.22, ey - 0.02, 0), '#4b5054'),
    part(new THREE.BoxGeometry(0.52, 0.05, 0.24).rotateZ(-0.1).translate(ex + 0.25, ey - 0.12, 0), '#f2ead0'),
  ], ['color']);
  return { geo, mat: new THREE.MeshLambertMaterial({ vertexColors: true }) };
}

const POLE_STEP = { primary: 32, secondary: 34, tertiary: 36, residential: 42, unclassified: 42 }; // м вдоль улицы
const POLE_OFF = 1.0;   // м от края полотна
const POLE_END = 7;     // м: у концов улицы (перекрёстки) не ставим
const roadPrefix = new WeakMap(); // улица → длина от начала до каждого узла

function prefixOf(world, road) {
  let pre = roadPrefix.get(road);
  if (!pre) {
    pre = [0];
    for (let i = 1; i < road.n.length; i++) {
      const [ax, az] = world.nodes[road.n[i - 1]], [bx, bz] = world.nodes[road.n[i]];
      pre.push(pre[i - 1] + Math.hypot(bx - ax, bz - az));
    }
    roadPrefix.set(road, pre);
  }
  return pre;
}

// Столбы квадрата: вдоль улиц с шагом от начала всей улицы, поэтому на стыке квадратов ряд не
// сбивается. Односторонняя — справа по ходу, широкая двусторонняя — с обеих сторон,
// остальные — с одной стороны (какой — по улице). Не на мостах, в тоннелях, воде, домах, рельсах.
export function buildPoleChunk(world, info, mats) {
  const { data } = info;
  const { free, inBuilding } = spotChecks(world, data);
  const spots = [];
  for (const { road, from, to } of data.runs) {
    const step = POLE_STEP[road.k];
    if (!step || road.br || road.tu) continue;
    const pre = prefixOf(world, road);
    const total = pre[pre.length - 1], h = road.n[0] * 2654435761 >>> 0;
    const sides = road.ow ? [1] : road.w >= 14 ? [1, -1] : [h & 1 ? 1 : -1];
    const phase = (h % 1000) / 1000 * step;
    for (let i = from + 1; i <= to; i++) {
      const [ax, az] = world.nodes[road.n[i - 1]], [bx, bz] = world.nodes[road.n[i]];
      const s0 = pre[i - 1], L = pre[i] - s0;
      if (L < 0.5) continue;
      const dx = (bx - ax) / L, dz = (bz - az) / L;
      for (let s = phase + Math.ceil((s0 - phase) / step) * step; s < s0 + L; s += step) {
        if (s < POLE_END || s > total - POLE_END) continue;
        const t = s - s0, off = road.w / 2 + POLE_OFF;
        for (const side of sides) {
          // Справа от направления (dx, dz) — (−dz, dx), как полосы в traffic.js.
          const x = ax + dx * t - dz * off * side, z = az + dz * t + dx * off * side;
          const nr = world.nearestRoad(x, z, 4);
          if ((nr && nr.d < 0.6) || world.isWater(x, z) || !free(x, z) || inBuilding(x, z)) continue;
          const y = world.terrain(x, z);
          if (world.ground(x, z) > y + 2) continue; // под настилом путепровода
          spots.push([x, y, z, Math.atan2(dx * side, dz * side)]); // консоль — к дороге
        }
      }
    }
  }
  if (!spots.length) return null;
  const mesh = new THREE.InstancedMesh(mats.geo, mats.mat, spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  spots.forEach(([x, y, z, a], i) => mesh.setMatrixAt(i, m.compose(p.set(x, y, z), q.setFromAxisAngle(up, a), one)));
  mesh.computeBoundingSphere();
  mesh.castShadow = true;
  mesh.userData.spots = spots; // для breakables.js
  return mesh;
}

// ---------------------------------------------------------------- рекламные щиты

// Реклама — одна текстура-лента из ADS.length плакатов друг под другом. Плакат каждой стороны щита
// задан полосой UV, а смена — сдвигом offset.y общей текстуры: все щиты разом прокручивают плакат
// на следующий, как роллерный щит.
const ADS = [izhCarAd, daurAd, izhCarFriendsAd, daurFmAd];
const AD_W = 1024, AD_H = 512;
const AD_SHOW = 8, AD_ROLL = 0.9; // с: плакат стоит, затем прокрутка

const adFont = (px, weight = 800) => `${weight} ${px}px "Arial Black", Arial, Helvetica, sans-serif`;
const AD_PAD = 70; // поля плаката, px

// Строка плаката размером px, но не шире maxW: ширина шрифта зависит от системы, поэтому
// не влезает — шрифт уменьшается.
function adText(g, s, x, y, px, weight = 800, maxW = AD_W - 2 * AD_PAD) {
  g.font = adFont(px, weight);
  const w = g.measureText(s).width;
  if (w > maxW) g.font = adFont(Math.floor(px * maxW / w), weight);
  g.fillText(s, x, y);
}

function izhCarAd(g, logo) {
  g.fillStyle = '#121212';
  g.fillRect(0, 0, AD_W, AD_H);
  g.fillStyle = '#ffd23f';
  for (let x = -AD_H; x < AD_W; x += 90) { // косые полосы по низу
    g.beginPath();
    g.moveTo(x, AD_H); g.lineTo(x + 40, AD_H); g.lineTo(x + 80, AD_H - 40); g.lineTo(x + 40, AD_H - 40);
    g.fill();
  }
  if (logo) g.drawImage(logo, (AD_W - 760) / 2, 40, 760, 204);
  else {
    g.font = `italic ${adFont(150)}`;
    g.textAlign = 'center';
    g.fillText('IZH CAR', AD_W / 2, 200, AD_W - 2 * AD_PAD);
  }
  g.textAlign = 'center';
  g.fillStyle = '#fff';
  adText(g, 'УЛИЧНЫЕ ГОНКИ ПО ИЖЕВСКУ', AD_W / 2, 330, 58);
  g.fillStyle = '#ffd23f';
  adText(g, 'vorgoron.ru/izhevsk-nfs', AD_W / 2, 415, 52, 700);
}

function izhCarFriendsAd(g, logo) {
  g.fillStyle = '#ffd23f';
  g.fillRect(0, 0, AD_W, AD_H);
  g.fillStyle = '#121212';
  g.textAlign = 'left';
  const left = AD_W - AD_PAD - 60;
  adText(g, 'ГОНЯЙ', 60, 165, 96, 800, left);
  adText(g, 'С ДРУЗЬЯМИ', 60, 275, 96, 800, left);
  adText(g, 'Меню → «Позвать друзей»', 60, 355, 54, 700, left);
  if (logo) g.drawImage(logo, AD_W - 490, AD_H - 128, 440, 118);
  else {
    g.font = `italic ${adFont(70)}`;
    g.textAlign = 'right';
    g.fillText('IZH CAR', AD_W - 50, AD_H - 50, 420);
  }
}

// Даур — в цветах удмуртского флага: чёрный, белый, красный.
function daurAd(g) {
  g.fillStyle = '#111';
  g.fillRect(0, 0, AD_W, AD_H);
  g.fillStyle = '#d42a2a';
  g.fillRect(0, AD_H - 70, AD_W, 70);
  g.textAlign = 'center';
  g.fillStyle = '#fff';
  adText(g, 'ДАУР', AD_W / 2, 230, 190);
  g.fillStyle = '#d42a2a';
  g.beginPath();
  g.roundRect(AD_W / 2 - 230, 270, 460, 110, 55);
  g.fill();
  g.fillStyle = '#fff';
  adText(g, 'ТВ + FM', AD_W / 2, 352, 78, 800, 400);
  adText(g, 'daur.media', AD_W / 2, AD_H - 17, 50, 700);
}

function daurFmAd(g) {
  g.fillStyle = '#f4f1ea';
  g.fillRect(0, 0, AD_W, AD_H);
  g.fillStyle = '#d42a2a';
  g.fillRect(0, 0, 36, AD_H);
  g.fillStyle = '#111';
  g.fillRect(36, 0, 18, AD_H);
  g.textAlign = 'left';
  const left = AD_W - AD_PAD - 110;
  adText(g, 'ДАУР FM', 110, 200, 150, 800, left);
  g.fillStyle = '#d42a2a';
  adText(g, 'слушай за рулём', 110, 310, 76, 800, left);
  g.fillStyle = '#111';
  adText(g, 'радио — в меню игры', 110, 420, 54, 700, left);
}

// Щит 6 × 3 м на одной стойке, плакаты с двух сторон; щит — вдоль локальной x, лицевые стороны ±z.
const BB = { w: 6, h: 3, y: 6.9, t: 0.5 }; // размер плаката, высота его центра, толщина короба

export function billboardMaterials(renderer) {
  const c = document.createElement('canvas');
  c.width = AD_W;
  c.height = AD_H * ADS.length;
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const draw = (logo) => {
    ADS.forEach((ad, k) => {
      g.save();
      g.translate(0, k * AD_H);
      g.beginPath();
      g.rect(0, 0, AD_W, AD_H);
      g.clip();
      ad(g, logo);
      g.restore();
    });
    tex.needsUpdate = true;
  };
  draw(null);
  const logo = new Image();
  logo.onload = () => draw(logo);
  logo.src = 'logo.svg';

  const bottom = BB.y - BB.h / 2 - 0.15;
  const geo = mergeGeos([
    part(new THREE.CylinderGeometry(0.45, 0.55, 0.5, 10), '#8f8c85'), // фундамент
    part(new THREE.CylinderGeometry(0.26, 0.3, bottom + 0.6, 10).translate(0, (bottom + 0.6) / 2 - 0.3, 0), '#6b7075'),
    part(new THREE.BoxGeometry(BB.w + 0.3, BB.h + 0.3, BB.t).translate(0, BB.y, 0), '#3f4448'),     // короб
    part(new THREE.BoxGeometry(BB.w + 0.3, 0.06, 1.6).translate(0, bottom - 0.05, 0), '#55595d'),   // мостки
    ...[-2, 0, 2].flatMap((x) => [-1, 1].map((s) => // светильники над плакатом
      part(new THREE.BoxGeometry(0.3, 0.12, 0.5).translate(x, BB.y + BB.h / 2 + 0.3, s * 0.55), '#2d3135'))),
  ], ['color']);
  const face = new THREE.MeshLambertMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.35 });
  let t0 = null;
  return {
    geo, face,
    frame: new THREE.MeshLambertMaterial({ vertexColors: true }),
    // Каждый кадр: смена плаката раз в AD_SHOW с, прокрутка за AD_ROLL с.
    tick(now) {
      t0 ??= now;
      const t = (now - t0) / 1000, period = AD_SHOW + AD_ROLL, n = Math.floor(t / period);
      const r = Math.max(0, (t - n * period - AD_SHOW) / AD_ROLL);
      const e = r * r * (3 - 2 * r);
      tex.offset.y = -((n + e) % ADS.length) / ADS.length;
    },
  };
}

const BB_STEP = { primary: 420, secondary: 480, tertiary: 560 }; // м вдоль улицы: место под щит
const BB_KEEP = 0.5;   // доля мест, где щит действительно стоит
const BB_SET = 4.2;    // м от края полотна до стойки
const BB_END = 30;     // м: у концов улицы не ставим

// Щиты квадрата: редкие, у крупных улиц, поперёк дороги — плакаты видно в обе стороны движения.
// Места — с шагом от начала всей улицы (как у столбов), часть мест пустует (по хешу).
export function buildBillboardChunk(world, info, mats) {
  const { data } = info;
  const { free, inBuilding } = spotChecks(world, data);
  const spots = [];
  for (const { road, from, to } of data.runs) {
    const step = BB_STEP[road.k];
    if (!step || road.br || road.tu) continue;
    const pre = prefixOf(world, road);
    const total = pre[pre.length - 1], h = (road.n[0] * 2246822519) >>> 0;
    const phase = (h % 997) / 997 * step;
    for (let i = from + 1; i <= to; i++) {
      const [ax, az] = world.nodes[road.n[i - 1]], [bx, bz] = world.nodes[road.n[i]];
      const s0 = pre[i - 1], L = pre[i] - s0;
      if (L < 0.5) continue;
      const dx = (bx - ax) / L, dz = (bz - az) / L;
      for (let s = phase + Math.ceil((s0 - phase) / step) * step; s < s0 + L; s += step) {
        if (s < BB_END || s > total - BB_END) continue;
        const k = Math.round((s - phase) / step), hk = Math.imul(h ^ k, 2654435761) >>> 0;
        if ((hk % 1000) / 1000 >= BB_KEEP) continue;
        const side = hk & 1024 ? 1 : -1, off = road.w / 2 + BB_SET, t = s - s0;
        const x = ax + dx * t - dz * off * side, z = az + dz * t + dx * off * side;
        // Края щита: стойка — на земле, не у дороги; щит не в доме и не под путепроводом.
        const ex = -dz * side * (BB.w / 2 + 0.2), ez = dx * side * (BB.w / 2 + 0.2);
        const nr = world.nearestRoad(x, z, 4);
        if ((nr && nr.d < 2) || world.isWater(x, z) || !free(x, z)) continue;
        const y = world.terrain(x, z);
        const ok = [[x, z], [x + ex, z + ez], [x - ex, z - ez]]
          .every(([px, pz]) => !inBuilding(px, pz) && world.ground(px, pz) < world.terrain(px, pz) + 2);
        if (!ok) continue;
        spots.push({ x, y, z, dx, dz, slot: hk >>> 12 });
      }
    }
  }
  if (!spots.length) return null;
  const frames = new THREE.InstancedMesh(mats.geo, mats.frame, spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  // Плакаты квадрата — одна геометрия: две стороны на щит, у каждой своя полоса ленты.
  const pos = [], nor = [], uv = [], idx = [];
  const n = ADS.length, pad = 3 / (AD_H * n);
  const quad = (cx, cy, cz, nx, nz, slot) => {
    const rx = nz, rz = -nx; // вправо для смотрящего на лицо
    const v0 = 1 - (slot + 1) / n + pad, v1 = 1 - slot / n - pad, b = pos.length / 3;
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      pos.push(cx + rx * (u - 0.5) * BB.w, cy + (v - 0.5) * BB.h, cz + rz * (u - 0.5) * BB.w);
      nor.push(nx, 0, nz);
      uv.push(u, v ? v1 : v0);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const lift = BB.t / 2 + 0.01;
  spots.forEach(({ x, y, z, dx, dz, slot }, i) => {
    frames.setMatrixAt(i, m.compose(p.set(x, y, z), q.setFromAxisAngle(up, Math.atan2(dx, dz)), one));
    // Сзади — плакат через один (другой бренд), чтобы в разные стороны висело разное.
    quad(x + dx * lift, y + BB.y, z + dz * lift, dx, dz, slot % n);
    quad(x - dx * lift, y + BB.y, z - dz * lift, -dx, -dz, (slot + 1) % n);
  });
  frames.computeBoundingSphere();
  frames.castShadow = true;
  frames.userData.spots = spots; // для breakables.js: плакаты щита i — вершины 8i…8i+7
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  fg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  fg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  fg.setIndex(idx);
  fg.computeBoundingSphere();
  const faces = new THREE.Mesh(fg, mats.face);
  return [frames, faces];
}

// ---------------------------------------------------------------- остановки

// Знак 5.16: белая кайма, синий квадрат, белое поле, чёрный автобус сбоку (передом вправо).
function stopSignTexture(renderer) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f4f0';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#1f5fb4';
  g.beginPath();
  g.roundRect(9, 9, 238, 238, 16);
  g.fill();
  g.fillStyle = '#f4f4f0';
  g.fillRect(44, 44, 168, 168);
  g.fillStyle = '#16181a';
  g.beginPath();
  g.roundRect(56, 90, 144, 76, [10, 18, 8, 8]);
  g.fill();
  g.fillStyle = '#f4f4f0';
  for (let x = 64; x < 160; x += 24) g.fillRect(x, 100, 19, 28); // боковые окна
  g.fillRect(162, 100, 26, 42); // дверь со стеклом
  for (const x of [88, 168]) { g.beginPath(); g.arc(x, 166, 18, 0, 7); g.fill(); } // вырезы арок
  g.fillStyle = '#16181a';
  for (const x of [88, 168]) { g.beginPath(); g.arc(x, 166, 13, 0, 7); g.fill(); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

// Павильон 4 × 1.6 м: каркас, крыша, скамья, стёкла сзади и по бокам; открытая сторона — +z (к дороге).
// Знак — отдельно, лицом вдоль x (навстречу движению в обе стороны).
const PAV = { curb: 1.1, front: 0.8, back: -0.75, h: 2.5 };
const SIGN = { s: 0.7, y: 2.4 }; // сторона щитка, высота его центра
export function stopMaterials(renderer) {
  const posts = [-1.95, 1.95].flatMap((x) => [PAV.back, 0.7].map((z) =>
    part(new THREE.BoxGeometry(0.08, PAV.h, 0.08).translate(x, 0.12 + PAV.h / 2, z), '#3f6e8c')));
  const frame = mergeGeos([
    part(new THREE.BoxGeometry(4.6, 0.5, 2.4).translate(0, -0.13, 0.15), '#a19d93'), // площадка, низ — в склон
    ...posts,
    part(new THREE.BoxGeometry(4.3, 0.12, 1.95).translate(0, 2.68, 0.05), '#2e3840'), // крыша
    part(new THREE.BoxGeometry(4.3, 0.26, 0.05).translate(0, 2.6, 1.04), '#2c5d8f'),  // синий козырёк
    ...[0.35, 2.52].map((y) => part(new THREE.BoxGeometry(3.9, 0.06, 0.05).translate(0, y, PAV.back), '#3f6e8c')),
    part(new THREE.BoxGeometry(2.6, 0.05, 0.38).translate(0, 0.55, -0.5), '#8a5a35'), // скамья
    ...[-1.1, 1.1].map((x) => part(new THREE.BoxGeometry(0.06, 0.43, 0.3).translate(x, 0.335, -0.5), '#3a3f44')),
  ], ['color']);
  const glass = mergeGeos([
    new THREE.BoxGeometry(3.84, 2.1, 0.02).translate(0, 1.43, PAV.back),
    ...[-1.95, 1.95].map((x) => new THREE.BoxGeometry(0.02, 2.1, 1.35).translate(x, 1.43, -0.06)),
  ]);
  return {
    frame, glass,
    // Стойка с заглушкой и щиток-пластина (кромка серая), лицо — отдельной плоскостью с каждой стороны.
    post: mergeGeos([
      part(new THREE.CylinderGeometry(0.04, 0.045, 2.9, 8).translate(0, 1.35, 0), '#8d9196'),
      part(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 8).translate(0, 2.82, 0), '#6e7276'),
      part(new THREE.BoxGeometry(0.03, SIGN.s, SIGN.s).translate(0.06, SIGN.y, 0), '#b9bcbf'),
      ...[SIGN.y - 0.22, SIGN.y + 0.22].map((y) => part(new THREE.BoxGeometry(0.05, 0.05, 0.06).translate(0.03, y, 0), '#6e7276')), // хомуты
    ], ['color']),
    faces: [[Math.PI / 2, 0.077], [-Math.PI / 2, 0.043]].map(([r, x]) =>
      new THREE.PlaneGeometry(SIGN.s - 0.02, SIGN.s - 0.02).rotateY(r).translate(x, SIGN.y, 0)),
    frameMat: new THREE.MeshLambertMaterial({ vertexColors: true }),
    glassMat: new THREE.MeshLambertMaterial({ color: '#a9cfdc', transparent: true, opacity: 0.3, depthWrite: false }),
    sign: new THREE.MeshLambertMaterial({ map: stopSignTexture(renderer) }),
  };
}

const STOP_SHELTER = 0.6; // доля павильонов там, где навес в OSM не размечен

// Автобусные остановки квадрата из OSM (точки у тротуара). Павильон — лицом к ближайшей дороге,
// в PAV.curb от края (точка OSM бывает за тротуаром — так павильон стоял далеко), знак — у бордюра. Навес — по тегу
// shelter; не влез (дом, вода, другая дорога, под путепроводом) — остаётся только знак.
export function buildStopChunk(world, info, mats) {
  const { data } = info;
  if (!data.stops.length) return null;
  const { free, inBuilding } = spotChecks(world, data);
  const clearAt = (x, z) => {
    const nr = world.nearestRoad(x, z, 4);
    return !(nr && nr.d < 0.3) && !world.isWater(x, z) && !inBuilding(x, z) && free(x, z)
      && world.ground(x, z) < world.terrain(x, z) + 2;
  };
  const pavs = [], signs = [];
  for (const [x, z, sh] of data.stops) {
    const r = world.nearestRoad(x, z, 50); // ≤ 30 м ищет только в одной клетке индекса
    if (!r) continue;
    const s = r.seg, half = s.w / 2, d = r.d + half;
    const L = Math.hypot(s.bx - s.ax, s.bz - s.az) || 1, dx = (s.bx - s.ax) / L, dz = (s.bz - s.az) / L;
    // Нормаль от оси дороги к остановке; точка на самой оси — справа по ходу.
    let nx = -dz, nz = dx;
    if (d > 0.3) { nx = (x - r.px) / d; nz = (z - r.pz) / d; }
    const ang = Math.atan2(dx, dz) + Math.PI / 2; // лицо знака — вдоль дороги
    const curb = (u) => [r.px + nx * (half + 0.6) + dx * u, r.pz + nz * (half + 0.6) + dz * u];
    let sign = curb(0);
    const hash = Math.imul(Math.round(x * 10) ^ Math.round(z * 10) * 7919, 2654435761) >>> 0;
    if (sh === 1 || (sh === 2 && (hash % 1000) / 1000 < STOP_SHELTER)) {
      const off = half + PAV.curb + PAV.front;
      const px = r.px + nx * off, pz = r.pz + nz * off;
      const corners = [[-2.3, -1.05], [2.3, -1.05], [2.3, 1.35], [-2.3, 1.35], [0, 0]].map(([u, v]) =>
        [px - nz * u - nx * v, pz + nx * u - nz * v]);
      if (corners.every(([qx, qz]) => clearAt(qx, qz))) {
        pavs.push([px, world.terrain(px, pz), pz, Math.atan2(-nx, -nz)]); // +z модели — к дороге
        // Знак — за торцом павильона по ходу движения ближней полосы (правостороннее).
        sign = curb((nx * -dz + nz * dx >= 0 ? 1 : -1) * 2.7);
      }
    }
    if (clearAt(...sign)) signs.push([sign[0], world.terrain(...sign), sign[1], ang]);
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  const inst = (geo, mat, spots, shadow) => {
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
    spots.forEach(([x, y, z, a], i) => mesh.setMatrixAt(i, m.compose(p.set(x, y, z), q.setFromAxisAngle(up, a), one)));
    mesh.computeBoundingSphere();
    mesh.castShadow = shadow;
    return mesh;
  };
  const out = [];
  if (pavs.length) out.push(inst(mats.frame, mats.frameMat, pavs, true), inst(mats.glass, mats.glassMat, pavs, false));
  if (signs.length) out.push(inst(mats.post, mats.frameMat, signs, true), ...mats.faces.map((f) => inst(f, mats.sign, signs, false)));
  return out.length ? out : null;
}

// ---------------------------------------------------------------- заборы

// Вид забора: t — толщина (0 — одна плоскость с прозрачностью), len — метров на повтор текстуры вдоль,
// vm — метров на повтор по высоте (null — текстура на всю высоту), tint — оттенки (по забору).
const FENCE = {
  bars: { t: 0, len: 2.5, vm: null, tint: ['#2f3a30', '#2a2b2c', '#3b4756', '#585d58', '#24452f'] },
  mesh: { t: 0, len: 2.5, vm: null, tint: ['#a5a9aa', '#8c968a'] },
  wood: { t: 0.06, len: 2, vm: null, tint: ['#ffffff', '#e2d6c4', '#cbbda6', '#f0e2c8'] },
  prof: { t: 0.04, len: 1.15, vm: null, tint: ['#3f7050', '#7b3a2e', '#3c5f82', '#93989b', '#6b5440', '#9a8b4f'] },
  panel: { t: 0.16, len: 4, vm: null, tint: ['#ffffff', '#ece8e0', '#dcd8cf'] },
  brick: { t: 0.4, len: 2, vm: 1, tint: ['#ffffff', '#e9dcd2', '#d8c9be'] },
  hedge: { t: 0.9, len: 2, vm: 1, tint: ['#ffffff', '#dce8d2'] },
  jersey: { t: 0.6, len: 2, vm: null, tint: ['#ffffff'] },
};
const FENCE_PIECE = 5;  // м: забор дробится, чтобы идти по рельефу (меш рельефа — треугольники 15 м)
const FENCE_SINK = 0.3; // м: низ уходит в землю — на склоне не висит

function fenceTexture(kind, renderer) {
  const W = 256, H = kind === 'brick' || kind === 'hedge' ? 128 : 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const rnd = mulberry(kind.length * 977);
  if (kind === 'bars') { // решётка: столб у края, две поперечины, прутья через ~12 см
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 10, H);
    g.fillRect(0, 22, W, 9);
    g.fillRect(0, H - 34, W, 9);
    for (let x = 16; x < W; x += 12) g.fillRect(x, 14, 4, H - 22);
    for (let x = 16; x < W; x += 12) g.fillRect(x - 1, 8, 6, 8); // пики
  } else if (kind === 'mesh') { // рабица на столбах
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    for (let k = -H; k < W + H; k += 14) {
      g.beginPath(); g.moveTo(k, 6); g.lineTo(k + H, H + 6 - 6); g.stroke();
      g.beginPath(); g.moveTo(k, H); g.lineTo(k + H, 6); g.stroke();
    }
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 9, H);
    g.fillRect(0, 4, W, 4);
  } else if (kind === 'wood') { // доски с зазорами и две прожилины
    g.fillStyle = '#4a3a2a';
    g.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += 16) {
      const v = 120 + rnd() * 40 | 0;
      g.fillStyle = `rgb(${v},${v * 0.78 | 0},${v * 0.55 | 0})`;
      g.fillRect(x + 1, 4 + rnd() * 6, 13, H);
      g.fillStyle = 'rgba(40,30,20,0.25)';
      for (let k = 0; k < 3; k++) g.fillRect(x + 2 + rnd() * 10, 0, 1, H);
    }
    g.fillStyle = 'rgba(60,45,30,0.5)';
    g.fillRect(0, 50, W, 8);
    g.fillRect(0, H - 60, W, 8);
  } else if (kind === 'prof') { // гофр трапецией: полка, наклон, впадина
    const grd = g.createLinearGradient(0, 0, W, 0);
    [[0, '#d8d8d8'], [0.15, '#f2f2f2'], [0.3, '#d0d0d0'], [0.38, '#a8a8a8'], [0.62, '#b4b4b4'], [0.7, '#e2e2e2'], [1, '#d8d8d8']]
      .forEach(([o, col]) => grd.addColorStop(o, col));
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
  } else if (kind === 'panel') { // плита ПО-2: ромбы рельефа, рамка, столб у края
    g.fillStyle = '#bdb9b0';
    g.fillRect(0, 0, W, H);
    const top = 34, bot = H - 14;
    g.fillStyle = '#c9c5bc';
    g.fillRect(8, top, W - 8, bot - top);
    const nx = 8, ny = 4, cw = (W - 16) / nx, ch = (bot - top - 8) / ny;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const cx = 12 + cw * (i + 0.5), cy = top + 4 + ch * (j + 0.5);
        g.beginPath();
        g.moveTo(cx, cy - ch / 2 + 3); g.lineTo(cx + cw / 2 - 3, cy); g.lineTo(cx, cy + ch / 2 - 3); g.lineTo(cx - cw / 2 + 3, cy);
        g.closePath();
        g.fillStyle = '#d7d3ca';
        g.fill();
        g.strokeStyle = '#9f9b93';
        g.lineWidth = 2;
        g.stroke();
      }
    }
    g.fillStyle = '#a9a59d';
    g.fillRect(0, 0, 8, H);
    g.fillRect(0, top - 6, W, 6);
    for (let k = 0; k < 400; k++) { // пятна и потёки
      g.fillStyle = `rgba(${rnd() < 0.5 ? '90,85,75' : '230,226,218'},${0.08 + rnd() * 0.1})`;
      g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 4, 1 + rnd() * 12);
    }
  } else if (kind === 'brick') { // кирпич на 1 м высоты: 13 рядов
    g.fillStyle = '#8f8a82';
    g.fillRect(0, 0, W, H);
    const rh = H / 13, bw = W / 8;
    for (let j = 0; j < 13; j++) {
      for (let i = -1; i < 9; i++) {
        const r = 150 + rnd() * 35 | 0;
        g.fillStyle = `rgb(${r},${r * 0.45 | 0},${r * 0.33 | 0})`;
        g.fillRect(i * bw + (j % 2) * bw / 2 + 1, j * rh + 1, bw - 2, rh - 2);
      }
    }
  } else if (kind === 'hedge') { // листва
    g.fillStyle = '#34502a';
    g.fillRect(0, 0, W, H);
    for (let k = 0; k < 2500; k++) {
      const v = rnd();
      g.fillStyle = `rgb(${40 + v * 50 | 0},${70 + v * 60 | 0},${30 + v * 30 | 0})`;
      g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 3, 2 + rnd() * 3);
    }
  } else { // jersey: бетонные блоки со швом, красно-белая полоса поверху
    g.fillStyle = '#b8b4ac';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#d8d4cc';
    g.fillRect(0, 0, W, 50);
    for (let x = 0; x < W; x += 64) { g.fillStyle = (x / 64) % 2 ? '#c8352c' : '#efefea'; g.fillRect(x, 0, 64, 26); }
    g.fillStyle = '#86827b';
    g.fillRect(0, 0, 3, H);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  if (FENCE[kind].vm) tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

function mulberry(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function fenceMaterials(renderer) {
  const mats = {};
  for (const [k, f] of Object.entries(FENCE)) {
    const map = fenceTexture(k, renderer);
    mats[k] = new THREE.MeshLambertMaterial(f.t
      ? { map, vertexColors: true }
      : { map, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide });
  }
  const all = new Set(Object.values(mats));
  return { ...mats, owns: (m) => all.has(m) };
}

// Заборы квадрата (из OSM, проёмы под ворота и дороги вырезаны при сборке): каждый кусок — свой
// квадрат по середине куска. Тонкие (решётка, сетка) — одна плоскость, остальные — с толщиной:
// две стороны, верх и торцы. Не рисуем куски в домах и в воде.
export function buildFenceChunk(world, info, mats) {
  const { x0, z0, x1, z1, data } = info;
  if (!data.fences.length) return null;
  const { inBuilding } = spotChecks(world, data);
  const geo = {};
  const put = (k) => (geo[k] ??= { pos: [], nor: [], uv: [], col: [] });
  const c = new THREE.Color();
  for (const f of data.fences) {
    const F = FENCE[f.k], g = put(f.k), t = F.t / 2, h = f.h;
    const p0 = f.p[0];
    const hash = Math.imul(Math.round(p0[0] * 10) ^ Math.round(p0[1] * 10) * 7919, 2654435761) >>> 0;
    c.set(F.tint[hash % F.tint.length]);
    const vTop = F.vm ? (h + FENCE_SINK) / F.vm : 1, vBot = F.vm ? 0 : -FENCE_SINK / h;
    // Четырёхугольник a-b-c-d (против часовой снаружи), нормаль n, uv по углам.
    const quad = (a, b, cc, d, n, uvs) => {
      for (const i of [0, 1, 2, 0, 2, 3]) {
        g.pos.push(...[a, b, cc, d][i]);
        g.nor.push(...n);
        g.uv.push(...uvs[i]);
        g.col.push(c.r, c.g, c.b);
      }
    };
    let s = 0;
    for (let i = 1; i < f.p.length; i++) {
      const [ax, az] = f.p[i - 1], [bx, bz] = f.p[i];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.05) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz, nz = ux;
      const n = Math.ceil(L / FENCE_PIECE);
      // На изломах толстые продлеваются на полтолщины — без щели на углу.
      const ext0 = i > 1 ? t : 0, ext1 = i < f.p.length - 1 ? t : 0;
      for (let k = 0; k < n; k++) {
        const ta = k ? (L * k) / n : -ext0, tb = k < n - 1 ? (L * (k + 1)) / n : L + ext1;
        const mx = ax + ux * (ta + tb) / 2, mz = az + uz * (ta + tb) / 2;
        if (mx < x0 || mx >= x1 || mz < z0 || mz >= z1) continue;
        if (inBuilding(mx, mz) || world.isWater(mx, mz)) continue;
        const pax = ax + ux * ta, paz = az + uz * ta, pbx = ax + ux * tb, pbz = az + uz * tb;
        const ya = world.terrain(pax, paz), yb = world.terrain(pbx, pbz);
        const ua = (s + ta) / F.len, ub = (s + tb) / F.len;
        const uvs = [[ua, vBot], [ub, vBot], [ub, vTop], [ua, vTop]];
        if (!t) {
          quad([pax, ya - FENCE_SINK, paz], [pbx, yb - FENCE_SINK, pbz], [pbx, yb + h, pbz], [pax, ya + h, paz], [nx, 0, nz], uvs);
          continue;
        }
        const side = (sg) => {
          const ox = nx * t * sg, oz = nz * t * sg;
          const A = [pax + ox, ya - FENCE_SINK, paz + oz], B = [pbx + ox, yb - FENCE_SINK, pbz + oz];
          const C = [pbx + ox, yb + h, pbz + oz], D = [pax + ox, ya + h, paz + oz];
          // Снаружи против часовой: со стороны +n идём A→B, со стороны −n — B→A.
          if (sg > 0) quad(A, B, C, D, [nx, 0, nz], uvs);
          else quad(B, A, D, C, [-nx, 0, -nz], [uvs[1], uvs[0], uvs[3], uvs[2]]);
        };
        side(1);
        side(-1);
        const tv = F.vm ? 2 * t / F.vm : 0.02;
        quad([pax + nx * t, ya + h, paz + nz * t], [pbx + nx * t, yb + h, pbz + nz * t], [pbx - nx * t, yb + h, pbz - nz * t],
          [pax - nx * t, ya + h, paz - nz * t], [0, 1, 0], [[ua, vTop - tv], [ub, vTop - tv], [ub, vTop], [ua, vTop]]);
        // Торцы — у концов забора.
        const cap = (x, y, z, sg) => {
          const L0 = [x - nx * t, y - FENCE_SINK, z - nz * t], R0 = [x + nx * t, y - FENCE_SINK, z + nz * t];
          const R1 = [x + nx * t, y + h, z + nz * t], L1 = [x - nx * t, y + h, z - nz * t];
          const cu = [[0, vBot], [2 * t / F.len, vBot], [2 * t / F.len, vTop], [0, vTop]];
          if (sg > 0) quad(R0, L0, L1, R1, [ux, 0, uz], cu);
          else quad(L0, R0, R1, L1, [-ux, 0, -uz], cu);
        };
        if (i === 1 && k === 0) cap(pax, ya, paz, -1);
        if (i === f.p.length - 1 && k === n - 1) cap(pbx, yb, pbz, 1);
      }
      s += L;
    }
  }
  const out = [];
  for (const [k, g] of Object.entries(geo)) {
    if (!g.pos.length) continue;
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
    bg.setAttribute('normal', new THREE.Float32BufferAttribute(g.nor, 3));
    bg.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
    bg.setAttribute('color', new THREE.Float32BufferAttribute(g.col, 3));
    const m = new THREE.Mesh(bg, mats[k]);
    m.castShadow = FENCE[k].t > 0;
    m.receiveShadow = true;
    out.push(m);
  }
  return out.length ? out : null;
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

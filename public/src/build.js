// Построение мешей города из World.
import * as THREE from 'three';
import { MARKED_CLASSES, SIDEWALK, SOFT_FENCES, TRAM_BED, TRAM_DROP, TRAM_GRASS, TRAM_TUCK, World } from './world.js';
import { RECOLOR } from './landmarks.js';
import { NIGHT, glowMaterial, poleGlowGeometry, POLE_POOL_X } from './night.js';
import { SPECIES, LEAF, treeGeometry, LEAF_GLSL } from './trees.js';
import { shopColors, shopLine } from './shops.js';
import { CURB_H, CURB_W } from './walks.js';

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
  // Газон между проезжей частью и тротуаром (SIDEWALK, world.js) на крупных улицах.
  for (const r of data.lines) {
    const sw = !r.br && !r.tu && SIDEWALK[r.k];
    if (sw?.[0]) stroke(r.n.map((i) => world.nodes[i]), r.w + 2 * sw[0], '#62793f');
  }
  // Тропы — на текстуре; плитка и тротуары — геометрией (buildWalkChunk), здесь под ней узкая полоса тем же
  // цветом: видна только издали, где меш дорожек уже спрятан.
  for (const p of data.paths) if (p.k === 't') stroke(p.p, p.w, '#a39b88');
  for (const s of world.walks.chunk(info.ci, info.cj)) stroke([[s.ax, s.az], [s.bx, s.bz]], Math.max(0.6, 2 * s.h - 1), s.strip.k === 'c' ? '#46484b' : '#a9a59c');
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
  if (road.sf) return 'dirt'; // грунтовка (surface=unpaved… в OSM)
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
  const dirt = key === 'dirt';
  g.fillStyle = dirt ? '#7a6a52' : '#3a3b3d';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 5000; i++) {
    const v = 40 + Math.random() * 40;
    g.fillStyle = dirt ? `rgba(${v + 70},${v + 55},${v + 30},0.55)` : `rgba(${v},${v},${v},0.5)`;
    g.fillRect(Math.random() * W, Math.random() * H, dirt ? 2.5 : 1.5, dirt ? 2.5 : 1.5);
  }
  if (dirt) { // колеи
    g.fillStyle = 'rgba(70,58,42,0.35)';
    for (const u of [0.28, 0.72]) g.fillRect(u * W - 14, 0, 28, H);
  }
  if (key !== 'plain' && !dirt) {
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
    trackbed: new THREE.MeshLambertMaterial({ map: trackbedTexture(renderer), side: THREE.DoubleSide }),
    // Асфальт переезда под рельсами: отодвинут от камеры, чтобы настоящая лента дороги, где она есть, была поверх.
    crossing: new THREE.MeshLambertMaterial({ color: '#3d3e41', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }),
    // Рельсы лежат на 6 см выше расчётной высоты дороги, а лента асфальта между краями идёт по
    // прямой, а не по рельефу, и сама сдвинута к камере: без сдвига сильнее асфальта рельсы на
    // перекрёстке местами уходили под него.
    rail: new THREE.MeshPhongMaterial({ vertexColors: true, specular: '#e8edf2', shininess: 80, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    pillarGeo: new THREE.BoxGeometry(1.3, 1, 1.3).translate(0, 0.5, 0),
  };
}

const DECK = 1.2, PARAPET = 0.9, PILLAR_STEP = 20;
const TAPER = 0.3; // м сужения полотна на метр длины у трамвайных путей
const MEDIAN_REACH = 25; // м: дальше парный мост не соединяется общим настилом (как MEDIAN_MAX в world.js)

// Ленты дорог квадрата: каждый кусок (run) — отрезки одной дороги подряд.
// Улица из двух линий OSM (проезжие части в разные стороны), оси ближе суммы полуширин, как на
// Удмуртской: ленты шли внахлёст, и разметка одной ложилась на другую. Для каждой стороны дороги —
// линия, где она встречается с соседней параллельной лентой: середина нахлёста, сглаженная по
// положению (±TWIN_SMOOTH м), чтобы двойная сплошная шла ровно, даже когда оси в OSM виляют.
// Считается по всей дороге сразу (а не по куску квадрата), иначе на стыке квадратов ступенька.
const TWIN_STEP = 2.5, TWIN_SMOOTH = 15;
const twinCache = new WeakMap();
function twinEdges(world, road) {
  if (twinCache.has(road)) return twinCache.get(road);
  const half = road.w / 2;
  const S = [], side = { L: [], R: [] };
  // Точки линии стыка слева и справа от точки (x0, z0) дороги с направлением (dx, dz).
  const sample = (s, x0, z0, dx, dz) => {
    let l = half, r = half;
    const seen = new Set();
    for (const o of [0, half, -half]) {
      for (const q of world.nearbyRoadSegments(x0 - dz * o, z0 + dx * o)) {
        if (q.road === road || q.road.br || seen.has(q)) continue;
        seen.add(q);
        if (roadMarking(q.road) === 'plain') continue;
        const ex = q.bx - q.ax, ez = q.bz - q.az, el = Math.hypot(ex, ez) || 1;
        if (Math.abs((ex * dx + ez * dz) / el) < 0.9) continue;
        const c = World.closest(q, x0, z0);
        const lat = (c.px - x0) * -dz + (c.pz - z0) * dx; // >0 — слева
        const sum = half + q.w / 2, over = sum - Math.abs(lat);
        if (over <= 0 || Math.abs(lat) < sum / 2) continue; // почти на оси — съезд или продолжение
        if (lat > 0) l = Math.min(l, half - over / 2);
        else r = Math.min(r, half - over / 2);
      }
    }
    S.push(s);
    side.L.push(l < half ? [x0 - dz * l, z0 + dx * l] : null);
    side.R.push(r < half ? [x0 + dz * r, z0 - dx * r] : null);
  };
  // Продолжение улицы за концом дороги (следующая линия OSM той же улицы почти по прямой): точки
  // до TWIN_SMOOTH м от узла наружу [x, z, направление по ходу дороги]. Без них окно сглаживания
  // у конца одностороннее, и на стыке двух линий OSM двойная сплошная шла ступенькой.
  const beyond = (end) => {
    const k = end ? road.n.length - 1 : 0, node = road.n[k];
    const [ax, az] = world.nodes[road.n[end ? k - 1 : 1]], [bx, bz] = world.nodes[node];
    const ol = Math.hypot(bx - ax, bz - az) || 1, ox = (bx - ax) / ol, oz = (bz - az) / ol; // наружу
    const next = world.nearbyRoadSegments(bx, bz).map((q) => q.road).find((o) => o !== road && o.name === road.name &&
      roadMarking(o) !== 'plain' && (o.n[0] === node || o.n[o.n.length - 1] === node));
    if (!next) return [];
    const seq = next.n[0] === node ? next.n : [...next.n].reverse();
    const out = [];
    let d = 0;
    for (let i = 1; i < seq.length && d < TWIN_SMOOTH; i++) {
      const [px, pz] = world.nodes[seq[i - 1]], [qx, qz] = world.nodes[seq[i]];
      const L = Math.hypot(qx - px, qz - pz);
      if (L < 0.01) continue;
      const ux = (qx - px) / L, uz = (qz - pz) / L;
      if (i === 1 && ux * ox + uz * oz < 0.9) return []; // не продолжение, а поворот
      for (let D = (Math.floor(d / TWIN_STEP) + 1) * TWIN_STEP; D <= d + L && D <= TWIN_SMOOTH; D += TWIN_STEP) {
        out.push([px + ux * (D - d), pz + uz * (D - d), end ? ux : -ux, end ? uz : -uz, D]);
      }
      d += L;
    }
    return out;
  };
  for (const [x, z, dx, dz, d] of beyond(0).reverse()) sample(-d, x, z, dx, dz);
  let s0 = 0;
  for (let k = 1; k < road.n.length; k++) {
    const [ax, az] = world.nodes[road.n[k - 1]], [bx, bz] = world.nodes[road.n[k]];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) continue;
    const dx = (bx - ax) / len, dz = (bz - az) / len;
    for (let t = Math.ceil(s0 / TWIN_STEP) * TWIN_STEP - s0; t <= len; t += TWIN_STEP) {
      if (S.length && s0 + t <= S[S.length - 1] + 0.01) continue;
      sample(s0 + t, ax + dx * t, az + dz * t, dx, dz);
    }
    s0 += len;
  }
  for (const [x, z, dx, dz, d] of beyond(1)) sample(s0 + d, x, z, dx, dz);
  // Сглаживание по положению: среднее точек в окне в пределах сплошного участка с соседом.
  const W = Math.round(TWIN_SMOOTH / TWIN_STEP);
  const smooth = {};
  for (const key of ['L', 'R']) {
    const raw = side[key];
    smooth[key] = raw.map((p, i) => {
      if (!p) return null;
      let sx = 0, sz = 0, n = 0;
      for (let d = -W; d <= W; d++) {
        const j = i + d;
        if (j < 0 || j >= raw.length || !raw[j]) continue;
        const wgt = W + 1 - Math.abs(d);
        sx += raw[j][0] * wgt; sz += raw[j][1] * wgt; n += wgt;
      }
      return [sx / n, sz / n];
    });
  }
  const res = {
    // Линия стыка у точки дороги на расстоянии s от начала: [x, z, касательная x, z] (null — соседа нет).
    at(key, s) {
      const arr = smooth[key];
      if (!arr.length) return null;
      let lo = 0, hi = S.length - 1; // последний S[i] <= s
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (S[mid] <= s) lo = mid; else hi = mid - 1;
      }
      const i = lo;
      const a = arr[i], b = arr[Math.min(i + 1, arr.length - 1)];
      if (!a || !b) return null;
      const t = i + 1 < S.length ? Math.max(0, Math.min(1, (s - S[i]) / (S[i + 1] - S[i] || 1))) : 0;
      const p0 = arr[Math.max(0, i - 1)] || a, p1 = arr[Math.min(arr.length - 1, i + 2)] || b;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, p1[0] - p0[0], p1[1] - p0[1]];
    },
  };
  twinCache.set(road, res);
  return res;
}

export function buildRoadChunk(world, runs, mats) {
  const buckets = {};
  const bp = [], pillars = [], abutments = [], emb = []; // плиты и парапеты (треугольники), опоры, устои

  for (const { road, from, to } of runs) {
    const mk = roadMarking(road);
    const zones = road.plain ?? []; // перекрёстки: там асфальт без разметки (World.#initJunctions)
    const inZone = (s) => zones.some(([a, b]) => s >= a && s <= b);
    // Строго внутри: на самой границе полотно ещё как до перекрёстка, иначе разметка у въезда изломана.
    const inside = (s) => zones.some(([a, b]) => s > a + 0.01 && s < b - 0.01);
    // Ресемплинг до 5 м, чтобы полотно повторяло рельеф, плюс точки на границах перекрёстков.
    const src = road.n.slice(from, to + 1).map((i) => world.nodes[i]);
    const ysrc = road.y?.slice(from, to + 1);
    // Расстояние от начала дороги до узла from + k (для подъездов к мостам).
    const sAcc = [0];
    for (let k = 1; k < road.n.length; k++) {
      const [ax, az] = world.nodes[road.n[k - 1]], [bx, bz] = world.nodes[road.n[k]];
      sAcc.push(sAcc[k - 1] + Math.hypot(bx - ax, bz - az));
    }
    const sOf = (k) => sAcc[from + k];
    const pts = [], ys = [], ss = []; // ss — расстояние от начала дороги
    for (let i = 0; i < src.length; i++) {
      if (i > 0) {
        const [ax, az] = src[i - 1], [bx, bz] = src[i];
        const len = Math.hypot(bx - ax, bz - az), s0 = sOf(i - 1);
        const n = Math.ceil(len / 5);
        const ts = [];
        for (let k = 1; k < n; k++) ts.push(k / n);
        for (const z of zones) for (const e of z) if (e > s0 && e < s0 + len) ts.push((e - s0) / len);
        ts.sort((p, q) => p - q);
        let tPrev = 0;
        for (const t of ts) {
          if ((t - tPrev) * len < 0.3 || (1 - t) * len < 0.3) continue;
          tPrev = t;
          const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
          pts.push([px, pz]);
          ys.push(ysrc ? ysrc[i - 1] + (ysrc[i] - ysrc[i - 1]) * t : world.rampAt(road, s0 + len * t, px, pz));
          ss.push(s0 + len * t);
        }
      }
      pts.push(src[i]);
      ys.push(ysrc ? ysrc[i] : world.rampAt(road, sOf(i), src[i][0], src[i][1]));
      ss.push(sOf(i));
    }
    const half = road.w / 2;
    // Соседи за краем куска — для направления в концевых точках (стык без излома).
    const before = from > 0 ? world.nodes[road.n[from - 1]] : null;
    const after = to < road.n.length - 1 ? world.nodes[road.n[to + 1]] : null;
    const frame = pts.map((p, i) => {
      const prev = i > 0 ? pts[i - 1] : before || pts[0], next = i < pts.length - 1 ? pts[i + 1] : after || pts[pts.length - 1];
      let dx = next[0] - prev[0], dz = next[1] - prev[1];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      // Митра на изломе, с ограничением, чтобы острые углы не выстреливали.
      let m = 1;
      if (prev !== p && next !== p) {
        const ax = p[0] - prev[0], az = p[1] - prev[1];
        const al = Math.hypot(ax, az) || 1;
        m = Math.min(2, 1 / Math.max(0.3, (ax / al) * dx + (az / al) * dz));
      }
      // Полотно не заходит на трамвайные пути рядом (в OSM ось дороги часто ближе к путям, чем
      // половина её ширины): край с той стороны отступает за полотно пути и газон. На перекрёстке
      // тоже — иначе полная лента ложилась на газон уступами; пути поворота (не вдоль) не обрезают,
      // дыры под ними закрывает асфальт переезда (buildRailChunk).
      const [x0, z0] = p;
      // Соседняя проезжая часть (twinEdges): внутренний край — ровно на общей линии посередине,
      // разметка (края sl, sr) ужимается до неё.
      let sl = half, sr = half, Lp = null, Rp = null;
      if (mk !== 'plain' && !road.br && !inside(ss[i])) {
        const tw = twinEdges(world, road);
        // Край — где нормаль из точки оси пересекает линию стыка (сглаженная точка линии может
        // стоять на метры впереди или позади), плюс 5 см внахлёст: щель показала бы траву.
        const cut = (q, sg) => {
          if (!q) return null;
          const nx = -dz * sg, nz = dx * sg, den = nx * q[3] - nz * q[2];
          if (Math.abs(den) < 1e-6) return null;
          const t = ((q[0] - x0) * q[3] - (q[1] - z0) * q[2]) / den + 0.05;
          return t > 1 && t < half ? t : null;
        };
        const tl = cut(tw.at('L', ss[i]), 1), tr = cut(tw.at('R', ss[i]), -1);
        if (tl) { sl = tl; Lp = [x0 - dz * tl, z0 + dx * tl]; }
        if (tr) { sr = tr; Rp = [x0 + dz * tr, z0 - dx * tr]; }
      }
      let hl = sl, hr = sr;
      if (!road.br) {
        for (const sg of world.railsNear(x0, z0)) {
          if (sg.k !== 'tram') continue;
          const ex = sg.bx - sg.ax, ez = sg.bz - sg.az, el = Math.hypot(ex, ez) || 1;
          if (Math.abs((ex * dx + ez * dz) / el) < 0.9) continue; // пересечение, а не вдоль
          const c = World.closest(sg, x0, z0);
          const lat = (c.px - x0) * -dz + (c.pz - z0) * dx; // >0 — слева (сторона +n)
          // Край — за полотном пути и газоном (TRAM_GRASS) между ним и дорогой.
          const gap = TRAM_BED / 2 + TRAM_GRASS;
          if (Math.abs(lat) > half + gap + 0.2) continue;
          if (lat > 0) hl = Math.min(hl, Math.max(2.4, lat - gap));
          else hr = Math.min(hr, Math.max(2.4, -lat - gap));
        }
      }
      return { dx, dz, m, sl, sr, hl, hr, Lp, Rp };
    });
    // Край у путей сужается плавно в обе стороны: иначе от точки к точке он прыгал.
    for (const key of ['hl', 'hr']) {
      for (let i = 1; i < pts.length; i++) frame[i][key] = Math.min(frame[i][key], frame[i - 1][key] + TAPER * (ss[i] - ss[i - 1]));
      for (let i = pts.length - 2; i >= 0; i--) frame[i][key] = Math.min(frame[i][key], frame[i + 1][key] + TAPER * (ss[i + 1] - ss[i]));
    }
    let last = null; // вершины предыдущей точки и куда они уже записаны
    const emit = (i, vert, uv) => {
      if (i > 0) {
        // Материал отрезка: на перекрёстке — без разметки. Сменился — лента начинается заново.
        const key = inZone((ss[i - 1] + ss[i]) / 2) ? 'plain' : mk;
        const b = (buckets[key] ??= { p: [], uv: [], idx: [] });
        if (last.key !== key) {
          last.at = b.p.length / 3;
          b.p.push(...last.vert);
          b.uv.push(...last.uv);
          last.key = key;
        }
        const a = last.at, c = b.p.length / 3;
        b.p.push(...vert);
        b.uv.push(...uv);
        b.idx.push(a, a + 1, c, a + 1, c + 1, c);
        last.at = c;
      }
      last = { key: last?.key, at: last?.at, vert, uv };
    };
    // Продольная координата текстуры — от начала дороги, чтобы разметка не сбивалась на стыке квадратов.
    let bridgeEdge = null; // нормаль полотна в предыдущей точке (для бортов моста)
    let prevMedian = null; // края общего настила с парным мостом в предыдущей точке
    let prevEdge = null;   // края полотна в предыдущей точке (для откосов насыпи подъезда)
    let v = 0;
    for (let i = 1; i <= from; i++) {
      const [ax, az] = world.nodes[road.n[i - 1]], [bx, bz] = world.nodes[road.n[i]];
      v += Math.hypot(bx - ax, bz - az);
    }
    for (let i = 0; i < pts.length; i++) {
      const { dx, dz, m, sl, sr, Lp, Rp } = frame[i];
      const hl = Math.min(frame[i].hl, sl), hr = Math.min(frame[i].hr, sr);
      const [x, z] = pts[i];
      // Край на общей линии с соседней проезжей частью — точно в её точке (без митры), иначе
      // края двух лент расходились бы на изломах осей.
      let nx = -dz * hl * m, nz = dx * hl * m, rnx = -dz * hr * m, rnz = dx * hr * m;
      if (Lp && hl === sl) { nx = Lp[0] - x; nz = Lp[1] - z; }
      if (Rp && hr === sr) { rnx = x - Rp[0]; rnz = z - Rp[1]; }
      if (i > 0) v += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const yl = ys[i] ?? world.terrain(x + nx, z + nz) + road.lift;
      const yr = ys[i] ?? world.terrain(x - rnx, z - rnz) + road.lift;
      // Разметка — от краёв sl…sr: у путей край обрезается, а полосы остаются на своих местах.
      emit(i, [x + nx, yl, z + nz, x - rnx, yr, z - rnz], [(sl - hl) / (sl + sr), v / 12, (sl + hr) / (sl + sr), v / 12]);
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

// Трамвайное полотно поперёк пути (u: 0…1 на BED_TEX м, ось пути — 0,5) и вдоль (v: SLEEPER_TILE м):
// посередине щебень с бетонными шпалами, по краям трава — между путями и до дороги, как на Карла Маркса.
const SLEEPER_TILE = 1.4; // м: две шпалы на повтор текстуры
const BED_TEX = TRAM_BED + 2 * (TRAM_GRASS + TRAM_TUCK); // м: ширина текстуры — полотно с газоном до дороги и под её край
function trackbedTexture(renderer) {
  const PX = 80, W = Math.round(BED_TEX * PX), H = Math.round(SLEEPER_TILE * PX);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const X = (m) => W / 2 + m * PX; // метры от оси пути → пиксели
  const greens = ['#5f7440', '#6c8048', '#53683a', '#778a4f'];
  g.fillStyle = '#5d6e3d';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 1000; i++) { // трава
    g.fillStyle = greens[i % 4];
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 2 + rnd() * 3);
  }
  // Щебень.
  g.fillStyle = '#57544f';
  g.fillRect(X(-1.35), 0, X(1.35) - X(-1.35), H);
  for (let i = 0; i < 1400; i++) {
    const v = 55 + rnd() * 60 | 0;
    g.fillStyle = `rgb(${v},${v - 3},${v - 8})`;
    g.fillRect(X(-1.35) + rnd() * (X(1.35) - X(-1.35)), rnd() * H, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  // Шпалы: 2,6 м поперёк, 0,25 м вдоль, через 0,7 м; край чуть темнее.
  for (const v0 of [0.22, 0.92]) {
    const y = v0 * PX, h = 0.25 * PX;
    g.fillStyle = '#a9a69f';
    g.fillRect(X(-1.25), y, X(1.25) - X(-1.25), h);
    g.fillStyle = '#8f8c86';
    g.fillRect(X(-1.25), y + h - 2, X(1.25) - X(-1.25), 2);
  }
  // Трава прорастает в щебень и по краям шпал.
  for (let i = 0; i < 260; i++) {
    const side = rnd() < 0.5 ? -1 : 1, m = side * (0.95 + rnd() * 0.45);
    g.fillStyle = greens[i % 4];
    g.globalAlpha = 0.6 + rnd() * 0.4;
    g.fillRect(X(m), rnd() * H, 2 + rnd() * 3, 2 + rnd() * 3);
  }
  for (let i = 0; i < 70; i++) {
    g.fillStyle = greens[i % 4];
    g.globalAlpha = 0.5;
    g.fillRect(X((rnd() - 0.5) * 2.4), rnd() * H, 2 + rnd() * 3, 2 + rnd() * 2);
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

function quad(arr, a, b, c, d) {
  arr.push(...a, ...b, ...c, ...a, ...c, ...d);
}

// ---------------------------------------------------------------- рельсы

const GAUGE = 1.524; // м, русская колея
const RAIL_DECK = 4.4; // м: ширина плиты под путём, поднятым вдоль путепровода

// Рельсы квадрата: две стальные полосы на каждом пути (трамвай и железная дорога), над землёй
// или полотном дороги. Отрезки, середина которых в квадрате.
export function buildRailChunk(world, info, mat, deckMat, bedMat, crossMat) {
  const { x0, z0, x1, z1, data } = info;
  const pos = [], col = [], deck = [], bed = [], bedUv = [], curb = [], cross = [];
  // Верх полотна с текстурой (v — метры вдоль пути, шпалы не прыгают на стыках кусков). P, Q — ось
  // [x, y, z, gx, gz]: края — по наклону полотна поперёк, вровень с асфальтом по обе стороны.
  // P[5], P[6] — полуширина влево/вправо (с газоном до дороги), bx, bz — половина TRAM_BED влево.
  // Точка поперёк полотна в m м от оси (m > 0 — влево): ровно по наклону полотна до края щебня (TRAM_BED / 2),
  // дальше газон уходит вниз — на TRAM_DROP к краю газона и ещё на TRAM_TUCK под край асфальта. Газон и
  // асфальт на одной высоте мерцали при движении; ниже асфальта лента дороги всегда поверх.
  const W = TRAM_BED / 2;
  const off = (P, m, bx, bz) => {
    const k = m / W, w = m > 0 ? P[5] : P[6], a = Math.abs(m);
    const drop = a > W ? (TRAM_DROP * (a - W)) / (w + TRAM_TUCK - W) : 0;
    return [P[0] + bx * k, P[1] + (P[3] * bx + P[4] * bz) * k - drop, P[2] + bz * k];
  };
  const outer = (P, sg) => (sg > 0 ? P[5] : P[6]) > W + 0.01; // с этой стороны газон до дороги
  const edge = (P, sg, bx, bz) => off(P, sg * (outer(P, sg) ? (sg > 0 ? P[5] : P[6]) + TRAM_TUCK : W), bx, bz);
  const u = (m) => 0.5 - m / BED_TEX;
  const bedQuad = (P, Q, mP0, mQ0, mQ1, mP1, sP, sQ, bx, bz) => {
    quad(bed, off(P, mP0, bx, bz), off(Q, mQ0, bx, bz), off(Q, mQ1, bx, bz), off(P, mP1, bx, bz));
    const a = [u(mP0), sP / SLEEPER_TILE], b = [u(mQ0), sQ / SLEEPER_TILE], c = [u(mQ1), sQ / SLEEPER_TILE], d = [u(mP1), sP / SLEEPER_TILE];
    bedUv.push(...a, ...b, ...c, ...a, ...c, ...d);
  };
  const bedTop = (P, Q, sP, sQ, bx, bz) => {
    bedQuad(P, Q, W, W, -W, -W, sP, sQ, bx, bz); // щебень и шпалы
    for (const sg of [1, -1]) { // газон с наклоном вниз
      if (!outer(P, sg) && !outer(Q, sg)) continue;
      const ep = sg * ((sg > 0 ? P[5] : P[6]) + (outer(P, sg) ? TRAM_TUCK : 0)), eq = sg * ((sg > 0 ? Q[5] : Q[6]) + (outer(Q, sg) ? TRAM_TUCK : 0));
      bedQuad(P, Q, sg * W, sg * W, eq, ep, sP, sQ, bx, bz);
    }
  };
  const steel = new THREE.Color('#c3c7cc'), rust = new THREE.Color('#6b4a36');
  for (const r of data.rails) {
    const p = r.p, tram = r.k === 'tram';
    let s0 = 0;
    for (let i = 1; i < p.length; i++) {
      const [ax, az] = p[i - 1], [bx, bz] = p[i];
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const L = Math.hypot(bx - ax, bz - az);
      const sa = s0;
      s0 += L;
      if (mx < x0 || mx >= x1 || mz < z0 || mz >= z1) continue;
      if (L < 0.05) continue;
      const n = Math.ceil(L / 4), dx = (bx - ax) / L, dz = (bz - az) / L;
      // Путь поднят вдоль путепровода — под ним плита на ширину пути (соседние пути смыкаются),
      // на насыпи подъезда плита уходит в рельеф.
      for (let k = 0; k < n; k++) {
        const sx = ax + ((bx - ax) * k) / n, sz = az + ((bz - az) * k) / n, ex = ax + ((bx - ax) * (k + 1)) / n, ez = az + ((bz - az) * (k + 1)) / n;
        const s = world.railLevel(sx, sz, dx, dz, tram), e = world.railLevel(ex, ez, dx, dz, tram);
        const sy = s.y, ey = e.y, st = world.terrain(sx, sz), et = world.terrain(ex, ez);
        if (sy - st < 1 && ey - et < 1) {
          // Трамвайное полотно вровень с краями дорог; на переезде через дорогу его нет — рельсы в асфальте.
          const W = TRAM_BED / 2, at = (l, x, y, z) => [x, y, z, l.gx ?? 0, l.gz ?? 0, l.wl ?? W, l.wr ?? W];
          let P = at(s, sx, sy, sz), Q = at(e, ex, ey, ez), pt = st, qt = et;
          let sP = sa + (L * k) / n, sQ = sa + (L * (k + 1)) / n;
          const bx = -dz * TRAM_BED / 2, bz = dx * TRAM_BED / 2;
          // Переезд: под рельсами асфальт по ширине полотна (лента улицы у путей обрезана, а поворотный
          // путь пересекает её наискось — иначе дыра до земли).
          const patch = (A, B) => quad(cross, [A[0] + bx, A[1], A[2] + bz], [B[0] + bx, B[1], B[2] + bz], [B[0] - bx, B[1], B[2] - bz], [A[0] - bx, A[1], A[2] - bz]);
          if (!s.bed && !e.bed) {
            if (tram && (s.cross || e.cross)) patch(P, Q);
            continue;
          }
          if (s.bed !== e.bed) {
            // Край переезда — делением отрезка пополам, полотно до него и торец.
            let lo = 0, hi = 1;
            for (let it = 0; it < 6; it++) {
              const f = (lo + hi) / 2;
              if (world.railLevel(sx + (ex - sx) * f, sz + (ez - sz) * f, dx, dz, tram).bed === s.bed) lo = f; else hi = f;
            }
            const f = s.bed ? lo : hi, cx = sx + (ex - sx) * f, cz = sz + (ez - sz) * f;
            const cl = world.railLevel(cx, cz, dx, dz, tram), ct = world.terrain(cx, cz);
            const C = at(cl, cx, cl.y, cz), sC = sP + (sQ - sP) * f;
            if (s.bed) { patch(C, Q); [Q, qt, sQ] = [C, ct, sC]; } else { patch(P, C); [P, pt, sP] = [C, ct, sC]; }
            // Торец по профилю полотна: газон слева, щебень, газон справа.
            const line = [edge(C, 1, bx, bz), off(C, W, bx, bz), off(C, -W, bx, bz), edge(C, -1, bx, bz)];
            for (let j = 1; j < line.length; j++) {
              const a = line[j - 1], b = line[j];
              quad(curb, a, b, [b[0], ct - 0.1, b[2]], [a[0], ct - 0.1, a[2]]);
            }
          }
          bedTop(P, Q, sP, sQ, bx, bz);
          // Бок полотна — бетонный бордюр (виден только там, где рядом не асфальт).
          for (const sg of [1, -1]) {
            const a = edge(P, sg, bx, bz), b = edge(Q, sg, bx, bz);
            quad(curb, a, b, [b[0], qt - 0.1, b[2]], [a[0], pt - 0.1, a[2]]);
          }
          continue;
        }
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
          // На переезде рельс утоплен в асфальт — торчит на 1,5 см.
          const top = (l) => l.y + (l.cross ? 0.015 : 0.06);
          const sy = top(world.railLevel(sx, sz, dx, dz, tram)), ey = top(world.railLevel(ex, ez, dx, dz, tram));
          const wx = -dz * 0.045, wz = dx * 0.045;
          // Верх рельса (накатанный, светлый) и две боковины (ржавые) — низкий брусок.
          pos.push(sx - wx, sy, sz - wz, ex - wx, ey, ez - wz, ex + wx, ey, ez + wz, sx - wx, sy, sz - wz, ex + wx, ey, ez + wz, sx + wx, sy, sz + wz);
          for (let v = 0; v < 6; v++) col.push(steel.r, steel.g, steel.b);
          for (const w of [-1, 1]) {
            const px = w * wx, pz = w * wz;
            pos.push(sx + px, sy, sz + pz, ex + px, ey, ez + pz, ex + px, ey - 0.12, ez + pz, sx + px, sy, sz + pz, ex + px, ey - 0.12, ez + pz, sx + px, sy - 0.12, sz + pz);
            for (let v = 0; v < 6; v++) col.push(rust.r, rust.g, rust.b);
          }
        }
      }
    }
  }
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  const extra = [[deck, deckMat, true], [curb, deckMat, false], [bed, bedMat, false, bedUv], [cross, crossMat, false]].filter(([v, mt]) => v.length && mt);
  if (!extra.length) return m;
  const g = new THREE.Group();
  g.add(m);
  for (const [v, mt, shadow, uv] of extra) {
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    if (uv) dg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    dg.computeVertexNormals();
    const dm = new THREE.Mesh(dg, mt);
    dm.castShadow = shadow;
    dm.receiveShadow = true;
    g.add(dm);
  }
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
  { w: 3.0, draw: vitrine },    // 13 витрина магазина под вывеской (только низ стены)
];
const END_WALL = 12, VITRINE = 13;

// Маска «не красить в цвет стены» (стекло, рамы, вставки): рисуется параллельно атласу, потом
// уходит в альфу атласа (0.5 — свой цвет, 1 — умножить на цвет стены, 0.25 — стекло: свой цвет,
// ночью может светиться). Маска стекла — тоже параллельно: прямоугольники стёкол, а стеклом
// считаются только тёмные пиксели в них (переплёт и ограждения балконов поверх — не стекло).
let rawMask = null, glassMask = null;
const raw = (x, y, w, h) => rawMask.fillRect(x, y, w, h);

// Стекло: тёмное с разбросом; переплёт и подоконник светлые. Ночью окна светятся каждое по-своему
// (facadeMaterial): какое горит — решает хеш окна, а не атлас, иначе горел бы целый столбец.
function glass(g, x, y, w, h, rnd, { mull = true, sill = true, frame = '#f4f4f0' } = {}) {
  const sh = 45 + rnd() * 40;
  raw(x - 3, y - 3, w + 6, h + 6);
  g.fillStyle = frame;
  g.fillRect(x - 3, y - 3, w + 6, h + 6);
  g.fillStyle = `rgb(${sh * 0.8},${sh},${sh * 1.15})`;
  g.fillRect(x, y, w, h);
  glassMask.fillRect(x, y, w, h);
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
// Витрина магазина: сверху облицовка под вывеску (≈0.8 м, красится вершинным цветом — по вывеске), ниже стекло
// во всю ширину в тёмной раме и цоколь. Оба ряда одинаковые: на склоне витрина бывает в два ряда.
function vitrine(g, ground, rnd) {
  shade(g, 0.15, 0, 32, FA.W, 4);
  g.fillStyle = '#34383c';
  g.fillRect(0, 36, FA.W, 92);
  raw(0, 36, FA.W, 92);
  for (const x of [14, 268]) glass(g, x, 44, 230, 70, rnd, { sill: false, mull: false, frame: '#34383c' });
  g.fillStyle = '#5a5e62';
  g.fillRect(0, 116, FA.W, 12);
  raw(0, 116, FA.W, 12);
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
  const gc = document.createElement('canvas');
  gc.width = c.width;
  gc.height = c.height;
  glassMask = gc.getContext('2d', { willReadFrequently: true });
  glassMask.fillStyle = '#fff';
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  FACADES.forEach((f, k) => {
    for (const ground of [false, true]) {
      for (const x of [g, rawMask, glassMask]) {
        x.save();
        x.translate(0, (2 * k + (ground ? 1 : 0)) * FA.R);
        x.beginPath(); x.rect(0, 0, FA.W, FA.R); x.clip();
      }
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, FA.W, FA.R);
      f.draw(g, ground, rnd);
      g.restore();
      rawMask.restore();
      glassMask.restore();
    }
  });
  const img = g.getImageData(0, 0, c.width, c.height), mask = rawMask.getImageData(0, 0, c.width, c.height).data;
  const gm = glassMask.getImageData(0, 0, c.width, c.height).data, d = img.data;
  for (let i = 3; i < mask.length; i += 4) {
    if (mask[i] > 127) d[i] = 128;
    if (gm[i] > 127 && Math.max(d[i - 3], d[i - 2], d[i - 1]) < 150 && d[i - 1] >= d[i - 3]) d[i] = 64;
  }
  g.putImageData(img, 0, 0);
  rawMask = glassMask = null;
  const t = new THREE.CanvasTexture(c);
  t.premultiplyAlpha = false;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

// Стены: uv = (метры вдоль стены / w полосы, этажи от уровня земли); атрибут aFac = (полоса + доля-зерно
// дома < 0.5, число этажей). Зерно — чтобы у одинаковых домов горели разные окна.
// Ниже земли (цоколь на склоне) и выше последнего этажа (парапет) — гладкая стена. Повтор — fract в
// шейдере, выборка через textureGrad по непрерывным uv: иначе на стыке плиток мип-уровень скачет (шов).
function facadeMaterial(renderer) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, map: facadeAtlas(renderer) });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aFac;\nvarying vec2 vFac;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFac = aFac;');
    sh.uniforms.uNight = NIGHT;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFac;\nuniform float uNight;')
      .replace('#include <map_fragment>', `
        float tintMask = 1.0, glassMask = 0.0;
        vec2 fu = vMapUv;
        float nb = ${2 * FACADES.length}.0, stripe = floor(vFac.x);
        vec4 sampledDiffuseColor = vec4(fu.y < 0.0 ? 0.85 : 1.0);
        if (fu.y >= 0.0 && fu.y < vFac.y) {
          float row = fu.y < 1.0 ? 1.0 : 0.0;
          vec2 t = vec2(fract(fu.x), 1.0 - (2.0 * stripe + 1.0 + row - fract(fu.y)) / nb);
          vec2 sc = vec2(1.0, 1.0 / nb);
          sampledDiffuseColor = textureGrad(map, t, dFdx(fu) * sc, dFdy(fu) * sc);
          tintMask = smoothstep(0.6, 0.9, sampledDiffuseColor.a);
          glassMask = 1.0 - smoothstep(0.3, 0.42, sampledDiffuseColor.a);
          sampledDiffuseColor.a = 1.0;
        }
        diffuseColor *= sampledDiffuseColor;`)
      .replace('#include <color_fragment>', 'diffuseColor.rgb *= mix(vec3(1.0), vColor, tintMask);')
      // Ночью горит часть окон (плитками атласа); первый этаж — чаще, витрины магазинов — все.
      // Тёплые и холодные, разной яркости; горящее окно не освещается, а светится само.
      .replace('#include <emissivemap_fragment>', `
        if (uNight > 0.0 && glassMask > 0.0) {
          // Всё в хеше — целые: дробная часть vFac.x после интерполяции дрожит, и окно рябило бы.
          vec2 win = floor(fu); // окно — плитка этажа: в одних сериях в плитке два окна, в других одно посередине
          float seed = floor(fract(vFac.x) * 2100.0 + 0.5);
          float h = fract(sin(dot(win, vec2(12.9898, 78.233)) + seed * 0.917 + stripe * 3.7) * 43758.5453);
          float h2 = fract(h * 157.31);
          float on = stripe == ${VITRINE}.0 ? 1.0 : step(fu.y < 1.0 ? 0.45 : 0.68, h);
          vec3 lamp = mix(vec3(1.0, 0.72, 0.38), vec3(0.85, 0.9, 1.0), step(0.8, h2)) * (0.55 + 0.6 * fract(h2 * 31.7));
          float lit = on * glassMask * uNight;
          diffuseColor.rgb *= 1.0 - lit;
          totalEmissiveRadiance += lamp * lit;
        }`);
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
// конёк вдоль длинной стороны, свес, фронтоны на торцах (цвета стен). hip — вальмовая (четырёхскатная): конёк
// короче на полширины с каждого конца, на торцах вместо фронтонов — треугольные скаты.
function gableRoof(pts, top, wallCol, roofCol, rp, rc, hip = false) {
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
  // Концы конька: у вальмовой — на полширины внутрь (скат торца с тем же уклоном), не дальше середины.
  const sm = (s0 + s1) / 2, r0 = hip ? Math.min(sm, s0 + half) : s0 - ov, r1 = hip ? Math.max(sm, s1 - half) : s1 + ov;
  for (const t of [t0 - ov, t1 + ov]) {
    const a = P(s0 - ov, t, ye), b = P(s1 + ov, t, ye), c = P(r1, tm, yr), d = P(r0, tm, yr);
    tri(a, b, c, roofCol);
    tri(a, c, d, roofCol);
  }
  if (hip) {
    tri(P(s0 - ov, t0 - ov, ye), P(s0 - ov, t1 + ov, ye), P(r0, tm, yr), roofCol);
    tri(P(s1 + ov, t0 - ov, ye), P(s1 + ov, t1 + ov, ye), P(r1, tm, yr), roofCol);
  } else {
    for (const s of [s0, s1]) tri(P(s, t0, top), P(s, t1, top), P(s, tm, yr), wallCol);
  }
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

// Вывески дома (city.shops → [x, z, угол, ширина, дом, вид, текст]): по объекту дома, строится один раз.
let shopIndex = null;
function shopsOf(world, b) {
  if (!shopIndex) {
    shopIndex = new Map();
    for (const s of world.city.shops || []) {
      const q = world.city.buildings[s[4]];
      (shopIndex.get(q) || shopIndex.set(q, []).get(q)).push(s);
    }
  }
  return shopIndex.get(b);
}

// Витрины на ребре стены: участки [a, b] м вдоль ребра под вывесками этого ребра (вывеска ± 0.6 м; участки ближе
// 2.5 м друг к другу и к углу сливаются), линия верха — межэтажная над вывеской (shopLine), цвет облицовки — по
// вывеске, приглушённый серым; у слитых вывесок разного цвета — тёмно-серый.
const FRONT_PAD = 0.6, FRONT_JOIN = 2.5;
const FRONT_GREY = new THREE.Color('#c9cac6'), FRONT_MIXED = new THREE.Color('#5d6165');
function shopfronts(world, signs, x1, z1, x2, z2, len, nx, nz, gmax, fh, extra, top) {
  const dx = (x2 - x1) / len, dz = (z2 - z1) / len;
  const out = [];
  for (const [x, z, a, w, , k, text] of signs) {
    if (nx * Math.sin(a) + nz * Math.cos(a) < 0.95) continue;
    const t = (x - x1) * dx + (z - z1) * dz, off = (x - x1) * nx + (z - z1) * nz;
    if (Math.abs(off) > 0.3 || t < -0.5 || t > len + 0.5) continue;
    const line = Math.min(shopLine(world.terrain(x, z), gmax, fh, extra), top - 0.15);
    const color = new THREE.Color(shopColors(k, text)[0]).lerp(FRONT_GREY, 0.4);
    out.push({ a: Math.max(0, t - w / 2 - FRONT_PAD), b: Math.min(len, t + w / 2 + FRONT_PAD), line, color });
  }
  if (!out.length) return null;
  out.sort((p, q) => p.a - q.a);
  const merged = [out[0]];
  for (const f of out.slice(1)) {
    const m = merged[merged.length - 1];
    if (f.a - m.b >= FRONT_JOIN) { merged.push(f); continue; }
    m.b = Math.max(m.b, f.b);
    m.line = Math.max(m.line, f.line);
    if (!m.color.equals(f.color)) m.color = FRONT_MIXED; // у вывесок разный цвет — облицовка нейтральная
  }
  if (merged[0].a < FRONT_JOIN) merged[0].a = 0;
  if (len - merged[merged.length - 1].b < FRONT_JOIN) merged[merged.length - 1].b = len;
  return merged;
}

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
    col.set(RECOLOR[b.lm]?.[0] ?? b.bc ?? (b.r ? HOUSE_WALLS[hash % HOUSE_WALLS.length] : pal[(hash >> 2) % pal.length]));
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
    const signs = shopsOf(world, b);
    for (const ring of [pts, ...holes]) {
    const rc_ = stand && ring !== pts ? seats : col;
    let u = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % ring.length];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 0.01 || (ring === pts && skip.has(i))) continue;
      const nx = (z2 - z1) / len, nz = -(x2 - x1) / len;
      const band = (fac === 0 || fac === 7) && len < 16 && len < longest * 0.4 ? END_WALL : fac;
      // Кусок стены от s0 до s1 м вдоль ребра, по высоте y0…y1; v — этажи от gmax (как у всей стены),
      // u — непрерывно по ребру для своей полосы.
      const piece = (s0, s1, y0, y1, bd, c) => {
        const w = FACADES[bd].w, ua = bd === band ? u + s0 / w : s0 / w, ub = bd === band ? u + s1 / w : s1 / w;
        const ax = x1 + (x2 - x1) * s0 / len, az = z1 + (z2 - z1) * s0 / len;
        const bx = x1 + (x2 - x1) * s1 / len, bz = z1 + (z2 - z1) * s1 / len;
        const va = (y0 - gmax) / fh + extra, vb = (y1 - gmax) / fh + extra;
        // a=(p1,низ) b=(p2,низ) c=(p2,верх) d=(p1,верх); треугольники (a,c,b) и (a,d,c)
        const quad = [
          [ax, y0, az, ua, va], [bx, y1, bz, ub, vb], [bx, y0, bz, ub, va],
          [ax, y0, az, ua, va], [ax, y1, az, ua, vb], [bx, y1, bz, ub, vb],
        ];
        for (const [x, y, z, uu, vv] of quad) {
          wp.push(x, y, z);
          wn.push(nx, 0, nz);
          wc.push(c.r, c.g, c.b);
          wuv.push(uu, vv);
          wf.push(bd + 0.01 + (hash % 997) / 2100, floors && floors + extra);
        }
      };
      // Под вывесками — витрины: низ стены до линии вывески другой полосой, выше — как было.
      const fronts = ring === pts && signs && floors ? shopfronts(world, signs, x1, z1, x2, z2, len, nx, nz, gmax, fh, extra, top) : null;
      let s = 0;
      for (const f of fronts || []) {
        if (f.a > s) piece(s, f.a, base, top, band, rc_);
        piece(f.a, f.b, f.line, top, band, rc_);
        // Витрина — один этаж под вывеской; ниже (цоколь, на склоне — нижние ряды) — обычный фасад.
        const row0 = Math.max(base, gmax - extra * fh, f.line - fh);
        if (row0 > base) piece(f.a, f.b, base, row0, band, rc_);
        piece(f.a, f.b, row0, f.line, VITRINE, f.color);
        s = f.b;
      }
      if (s < len) piece(s, len, base, top, band, rc_);
      u += len / FACADES[band].w;
    }
    }

    // Храм без своей модели: главка на барабане над серединой крыши.
    if (b.pw) {
      let ax = 0, az = 0;
      for (const [x, z] of pts) { ax += x; az += z; }
      domes.push([ax / pts.length, az / pts.length, top, Math.min(3.5, Math.max(1.2, Math.sqrt(Math.abs(area) / 2) * 0.14))]);
    }

    if (b.r) {
      gableRoof(pts, top, col, new THREE.Color(b.rc ?? HOUSE_ROOFS[(hash >> 3) % HOUSE_ROOFS.length]).multiplyScalar(k), rp, rc);
      continue;
    }
    // Малоэтажный послевоенный (как на Орджоникидзе) — крыша вальмовая, четырёхскатная: прямоугольный — по
    // прямоугольнику с коньком, Г/П-образный — скаты от каждой стены; не вышло — ниже плоская.
    if (b.s === 11 && !holes.length) {
      const roofCol = new THREE.Color(b.rc ?? LOWRISE_ROOFS[(hash >> 3) % LOWRISE_ROOFS.length]).multiplyScalar(k);
      if (rectFill(pts) > 0.85) { gableRoof(pts, top, col, roofCol, rp, rc, true); continue; }
      if (hipRoof(pts, top, roofCol, rp, rc)) continue;
    }

    const contour = pts.map(([x, z]) => new THREE.Vector2(x, z));
    const tris = THREE.ShapeUtils.triangulateShape(contour, holes.map((h) => h.map(([x, z]) => new THREE.Vector2(x, z))));
    pts = [...pts, ...holes.flat()]; // индексы треугольников — по контуру и дырам подряд
    const rcol = new THREE.Color(RECOLOR[b.lm]?.[1] ?? b.rc ?? ROOFS[b.s] ?? ROOFS[2]).multiplyScalar(k);
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

// Ветер: верхушки чуть качаются, у каждого дерева своя фаза (по месту экземпляра).
const TREE_WIND = { value: 0 };

// Деревья — trees.js. Один материал на все породы: цвет вершин × цвет экземпляра (только там, где aTint = 1 —
// листва и хвоя), ветер, на листве — блики и тени гроздей листьев (LEAF_GLSL).
export function treeMaterials() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = TREE_WIND;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aTint;\nuniform float uWind;\nvarying float vTint;\nvarying vec3 vLeafW;')
      .replace('#include <color_vertex>', `vColor = color;
        vTint = aTint;
        #ifdef USE_INSTANCING_COLOR
          vColor *= mix(vec3(1.0), instanceColor.xyz, aTint);
        #endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float ph = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.17;
        float bend = pow(max(position.y - 1.0, 0.0) / 10.0, 2.0) * 0.14;
        transformed.x += bend * sin(uWind * 1.3 + ph);
        transformed.z += bend * 0.6 * sin(uWind * 0.9 + ph * 1.7);`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vLeafW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vTint;\nvarying vec3 vLeafW;\n' + LEAF_GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (vTint > 0.5) diffuseColor.rgb *= fl_tone(vLeafW, 0.3, 1.0);`);
  };
  const geos = {};
  for (const k of Object.keys(SPECIES)) geos[k] = [treeGeometry(k, 0), treeGeometry(k, 1)];
  return { mat, geos, tick: (now) => { TREE_WIND.value = now / 1000; } };
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
const JUNCTION_CLEAR = 25;      // м: уличные деревья не ближе к перекрёстку (на островках, между путями, перекрывали обзор)

// Перекрёстки — узлы, где сходятся три и больше концов дорог (середина дороги — два конца). Один раз на весь город.
function junctions(world) {
  if (world.junctionNodes) return world.junctionNodes;
  const ends = new Map();
  for (const r of world.roads) r.n.forEach((id, i) => ends.set(id, (ends.get(id) || 0) + (i === 0 || i === r.n.length - 1 ? 1 : 2)));
  const out = [];
  for (const [id, k] of ends) if (k >= 3) out.push(world.nodes[id]);
  return (world.junctionNodes = out);
}

// Деревья квадрата: из OSM, случайные в парках (лиственные) и лесах (ели, сосны, берёзы — выше городских),
// и редкие деревья вдоль улиц в застройке. Детерминированно по квадрату.
// Проверки места для дерева или столба в квадрате: free — не у достопримечательности и не на
// рельсах, inBuilding — внутри дома квадрата.
function spotChecks(world, data) {
  // Возле достопримечательностей ничего не ставим: закрывает модели.
  const POINT_CLEAR = { wheel: 27 }; // колесо широкое: деревья врезались бы в нижние кабинки
  // У здания с контуром — 6 м от самого контура (круг по дальней вершине у длинного корпуса завода
  // вычищал всё в 180 м вокруг), у точечной — радиус.
  const CONTOUR_CLEAR = 6;
  const clear = (world.city.landmarks || []).map((l) => {
    if (!l.p) return { x: l.x, z: l.z, r: POINT_CLEAR[l.key] ?? 12 };
    const xs = l.p.map((q) => q[0]), zs = l.p.map((q) => q[1]);
    return { p: l.p, bb: [Math.min(...xs) - CONTOUR_CLEAR, Math.min(...zs) - CONTOUR_CLEAR, Math.max(...xs) + CONTOUR_CLEAR, Math.max(...zs) + CONTOUR_CLEAR] };
  });
  const nearLandmark = (x, z, c) => {
    if (!c.p) return Math.hypot(x - c.x, z - c.z) <= c.r;
    if (x < c.bb[0] || x > c.bb[2] || z < c.bb[1] || z > c.bb[3]) return false;
    if (pointInPoly(x, z, c.p)) return true;
    for (let i = 0, j = c.p.length - 1; i < c.p.length; j = i++) {
      if (World.closest({ ax: c.p[j][0], az: c.p[j][1], bx: c.p[i][0], bz: c.p[i][1] }, x, z).d < CONTOUR_CLEAR) return true;
    }
    return false;
  };
  // Не на рельсах: трамвайные и железнодорожные пути квадрата ± 3.5 м от оси.
  const railSegs = [];
  for (const r of data.rails) for (let i = 1; i < r.p.length; i++) railSegs.push({ ax: r.p[i - 1][0], az: r.p[i - 1][1], bx: r.p[i][0], bz: r.p[i][1] });
  const offRails = (x, z) => railSegs.every((sg) => World.closest(sg, x, z).d > 3.5);
  // Не под пешеходными мостами и не вплотную к ним: крона проросла бы сквозь настил.
  const BRIDGE_CLEAR = 4;
  const offBridges = (x, z) => (world.footbridgeItems || []).every(({ o: { poly }, bb }) => {
    if (x < bb[0] - BRIDGE_CLEAR || x > bb[2] + BRIDGE_CLEAR || z < bb[1] - BRIDGE_CLEAR || z > bb[3] + BRIDGE_CLEAR) return true;
    if (pointInPoly(x, z, poly)) return false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const sg = { ax: poly[j][0], az: poly[j][1], bx: poly[i][0], bz: poly[i][1] };
      if (World.closest(sg, x, z).d < BRIDGE_CLEAR) return false;
    }
    return true;
  });
  const free = (x, z) => !clear.some((c) => nearLandmark(x, z, c)) && offRails(x, z) && offBridges(x, z);
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
  let rnd = (info.ci * 48271 + info.cj * 16807 + 12345) % 2147483647 || 1;
  const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  const spots = Object.fromEntries(Object.keys(SPECIES).map((k) => [k, []])); // порода → [x, z, лес?]
  let count = 0;
  const put = (kind, x, z, forest = false) => { spots[kind].push([x, z, forest]); count++; };
  // Городские лиственные: липа, клён, тополь, берёза.
  const leafy = () => { const u = rand(); return u < 0.3 ? 'birch' : u < 0.6 ? 'lime' : u < 0.82 ? 'maple' : 'poplar'; };
  // Деревья из OSM (и ряды natural=tree_row) — не на полотне: ряд в OSM бывает нарисован по оси или разделительной.
  // И не на тротуарах (walks.js).
  const offRoad = (x, z) => !(world.nearestRoad(x, z, 3)?.d < 1.5) && !world.walks.near(x, z, TREE_WALK);
  for (const [x, z] of data.trees) if (free(x, z) && offRoad(x, z)) put(leafy(), x, z);
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
    for (let i = 0; i < n && count < MAX_TREES; i++) {
      const x = minx + rand() * (maxx - minx), z = minz + rand() * (maxz - minz);
      if (!pointInPoly(x, z, a.p) || (a.holes || []).some((h) => pointInPoly(x, z, h)) || !free(x, z)) continue;
      if (!offRoad(x, z)) continue;
      // Лес — ели, сосны и берёзы, парк — в основном лиственные.
      const u = rand();
      if (a.f) put(u < 0.45 ? 'spruce' : u < 0.75 ? 'pine' : 'birch', x, z, true);
      else put(u < 0.15 ? 'spruce' : leafy(), x, z);
    }
  }
  // Вдоль улиц в застройке: по обе стороны, за краем полотна, не на домах, дорогах, воде.
  if (data.buildings.length >= 12) {
    const J = JUNCTION_CLEAR, near = junctions(world).filter(([x, z]) => x > x0 - J && x < x1 + J && z > z0 - J && z < z1 + J);
    const offJunctions = (x, z) => near.every(([jx, jz]) => Math.hypot(x - jx, z - jz) > J);
    for (const { road, from, to } of data.runs) {
      if (!STREET_KINDS.has(road.k) || road.br || road.tu) continue;
      for (let i = from + 1; i <= to; i++) {
        const [ax, az] = world.nodes[road.n[i - 1]], [bx, bz] = world.nodes[road.n[i]];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 10) continue;
        const dx = (bx - ax) / L, dz = (bz - az) / L;
        for (const side of [-1, 1]) {
          for (let t = 6 + rand() * 10; t < L - 6; t += STREET_STEP[0] + rand() * (STREET_STEP[1] - STREET_STEP[0])) {
            if (rand() < 0.3 || count >= MAX_TREES) continue; // с пропусками
            const off = road.w / 2 + 2.5 + rand() * 1.5;
            const x = ax + dx * t - dz * off * side, z = az + dz * t + dx * off * side;
            const nr = world.nearestRoad(x, z, 4);
            if ((nr && nr.d < 1.8) || world.isWater(x, z) || !free(x, z) || inBuilding(x, z) || !offJunctions(x, z)) continue;
            if (world.walks.near(x, z, TREE_WALK)) continue;
            put(rand() < 0.12 ? 'spruce' : leafy(), x, z);
          }
        }
      }
    }
  }
  const out = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  // Цвет листвы экземпляра — из палитры породы (вершинный цвет его ещё затеняет).
  const pal = Object.fromEntries(Object.entries(LEAF).map(([k, l]) => [k, l.map((h) => new THREE.Color(h))]));
  const color = (kind) => c.copy(pal[kind][Math.floor(rand() * pal[kind].length)]).multiplyScalar(0.92 + rand() * 0.16);
  for (const [kind, list] of Object.entries(spots)) {
    if (!list.length) continue;
    const [near, far] = mats.geos[kind];
    const mesh = new THREE.InstancedMesh(near, mats.mat, list.length);
    const solid = []; // для breakables.js: ствол — препятствие [x, y, z, масштаб]
    list.forEach(([x, z, forest], i) => {
      // В лесу деревья выше и стройнее: ели 13–19 м, сосны 14–21 м; крону лиственных не вытягиваем сильно.
      const k = forest ? 0.85 + rand() * 0.4 : 0.6 + rand() * 0.55;
      const h = forest ? (kind === 'spruce' ? 1.35 + rand() * 0.55 : 1.1 + rand() * 0.35) : 0.9 + rand() * 0.25;
      const y = world.terrain(x, z) - 0.2;
      q.setFromAxisAngle(up, rand() * 6.28);
      m.compose(p.set(x, y, z), q, s.set(k, k * h, k));
      solid.push([x, y, z, k]);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, color(kind));
    });
    mesh.computeBoundingSphere();
    mesh.castShadow = true;
    mesh.userData.spots = solid;
    mesh.userData.lod = [near, far]; // ChunkManager меняет по расстоянию до квадрата
    out.push(mesh);
  }
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
  // Стекло светильника (самое светлое в вершинных цветах) ночью светится.
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = NIGHT;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance += vec3(1.0, 0.85, 0.6) * 1.6 * uNight * step(0.7, vColor.r);');
  };
  return { geo, mat, glowGeo: poleGlowGeometry() };
}

const POLE_STEP = { primary: 32, secondary: 34, tertiary: 36, residential: 42, unclassified: 42 }; // м вдоль улицы
const POLE_OFF = 1.0;   // м от края полотна
const POLE_PUSH = 6;    // м: настолько дальше можно отодвинуть столб с тротуара
const TREE_WALK = 0.8;  // м: дерево не ближе к краю тротуара
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
        const t = s - s0;
        for (const side of sides) {
          // Справа от направления (dx, dz) — (−dz, dx), как полосы в traffic.js. На тротуаре (walks.js) не ставим —
          // отодвигаем за него, но не дальше POLE_PUSH.
          let off = road.w / 2 + POLE_OFF;
          const at = (o) => [ax + dx * t - dz * o * side, az + dz * t + dx * o * side];
          while (off < road.w / 2 + POLE_OFF + POLE_PUSH && world.walks.near(...at(off), 0.3)) off += 0.5;
          const [x, z] = at(off);
          if (world.walks.near(x, z, 0.3)) continue;
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
  // Свет фонарей ночью. Ореолы — те же экземпляры, что столбы (снесённый гаснет вместе со своим);
  // пятна — свои, на высоте земли под светильником, их прячет и возвращает breakables.js.
  const glow = new THREE.InstancedMesh(mats.glowGeo.halo, glowMaterial(), spots.length);
  glow.instanceMatrix = mesh.instanceMatrix;
  const pool = new THREE.InstancedMesh(mats.glowGeo.pool, glowMaterial(), spots.length);
  spots.forEach(([x, y, z, a], i) => {
    const px = x + Math.cos(a) * POLE_POOL_X, pz = z - Math.sin(a) * POLE_POOL_X;
    pool.setMatrixAt(i, m.makeTranslation(px, world.ground(px, pz, y + 2) + 0.3, pz));
  });
  glow.frustumCulled = pool.frustumCulled = false;
  mesh.userData.glow = [glow, pool];
  return mesh;
}

// ---------------------------------------------------------------- рекламные щиты

// Реклама — по рекламодателям (темам): у каждого щита свой, плакаты сменяются только его. У рекламодателя —
// текстура-лента из его плакатов друг под другом и ещё двух первых (лента крутится по кругу без шва: лицевая
// сторона показывает строки 0…P, обратная 1…P+1), смена — сдвигом offset.y, у всех щитов разом, как роллерный
// щит. Нажатие на плакат — ссылка рекламодателя (url), приложение по диплинку (app; не открылось — сообщение с
// запасной ссылкой fallback) или действие игры (act, main.js). share — доля щитов.
export const ADVERTISERS = [
  { key: 'daur', name: 'Даур', url: 'https://daur.media', posters: [daurAd, daurFmAd], share: 0.3 },
  { key: 'izhcar', name: 'Izh Car', act: 'invite', posters: [izhCarAd, izhCarFriendsAd], share: 0.2 },
  { key: 'tg', name: 'Telegram-канал', app: 'tg://resolve?domain=izh_car', fallback: 'https://t.me/izh_car', posters: [tgNewsAd, tgChannelAd], share: 0.2 },
  { key: 'tips', name: 'подсказки', act: 'tricks', posters: [tipsTricksAd, tipsDriftAd], share: 0.18 },
  // «Место свободно» — заявка на рекламу (меню → «Реклама на щитах», adrequest.js).
  { key: 'free', name: 'место свободно', act: 'ads', posters: [freeAd, freeYoursAd], share: 0.12 },
];
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
  adText(g, 'izh-car.web.app', AD_W / 2, 415, 52, 700);
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

// Telegram-канал игры @izh_car: голубой «телеграмный» и тёмный с логотипом. Значок — бумажный самолётик в круге.
const TG_BLUE = '#229ed9';

function tgPlane(g, cx, cy, r, bg, fg) {
  g.fillStyle = bg;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = fg;
  g.beginPath();
  g.moveTo(cx - 0.52 * r, cy + 0.02 * r);
  g.lineTo(cx + 0.5 * r, cy - 0.42 * r);
  g.lineTo(cx + 0.32 * r, cy + 0.5 * r);
  g.lineTo(cx + 0.02 * r, cy + 0.26 * r);
  g.lineTo(cx - 0.14 * r, cy + 0.44 * r);
  g.lineTo(cx - 0.16 * r, cy + 0.16 * r);
  g.closePath();
  g.fill();
}

function tgNewsAd(g) {
  g.fillStyle = TG_BLUE;
  g.fillRect(0, 0, AD_W, AD_H);
  tgPlane(g, AD_W - 190, 180, 120, '#fff', TG_BLUE);
  g.textAlign = 'left';
  g.fillStyle = '#fff';
  const left = AD_W - 2 * AD_PAD - 260;
  adText(g, 'НОВОСТИ', 70, 165, 110, 800, left);
  adText(g, 'ИГРЫ', 70, 275, 110, 800, left);
  g.fillStyle = '#0b2a3d';
  adText(g, '@izh_car', 70, 375, 72);
  g.fillStyle = '#fff';
  adText(g, 'нажми на щит — подпишись', 70, 450, 46, 700);
}

function tgChannelAd(g, logo) {
  g.fillStyle = '#121212';
  g.fillRect(0, 0, AD_W, AD_H);
  g.fillStyle = TG_BLUE;
  g.fillRect(0, AD_H - 90, AD_W, 90);
  if (logo) g.drawImage(logo, 70, 50, 560, 150);
  else {
    g.font = `italic ${adFont(120)}`;
    g.textAlign = 'left';
    g.fillStyle = '#ffd23f';
    g.fillText('IZH CAR', 70, 170, 560);
  }
  tgPlane(g, AD_W - 180, 140, 100, TG_BLUE, '#fff');
  g.textAlign = 'left';
  g.fillStyle = '#fff';
  adText(g, 'В TELEGRAM: @izh_car', 70, 300, 76);
  g.fillStyle = '#9fb3bf';
  adText(g, 'обновления · скриншоты · гонки', 70, 375, 52, 700);
  g.fillStyle = '#fff';
  adText(g, 'нажми на щит, чтобы открыть канал', 70, AD_H - 30, 46, 800);
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

// Подсказки игры: трюки и дрифт — тёмно-синие с жёлтым.
function tipsTricksAd(g) {
  g.fillStyle = '#16305a';
  g.fillRect(0, 0, AD_W, AD_H);
  g.fillStyle = '#ffd23f';
  g.textAlign = 'left';
  adText(g, 'ТРЮК НА КРЫШУ', 70, 170, 104);
  g.fillStyle = '#fff';
  adText(g, 'пробел · пробел · вперёд', 70, 280, 66, 700);
  adText(g, 'сядь на автобус — +1 200 ₽', 70, 380, 58, 700);
}

function tipsDriftAd(g) {
  g.fillStyle = '#ffd23f';
  g.fillRect(0, 0, AD_W, AD_H);
  g.fillStyle = '#16305a';
  g.textAlign = 'left';
  adText(g, 'ДРИФТ — ЭТО ДЕНЬГИ', 70, 170, 96);
  adText(g, 'ручник в повороте, потом газ', 70, 280, 62, 700);
  adText(g, 'дольше занос — больше множитель', 70, 370, 54, 700);
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

// Свободное место: белый щит с пунктирной рамкой, как настоящий «Аренда» — и тёмный «Ваша реклама».
function freeAd(g) {
  g.fillStyle = '#f4f1ea';
  g.fillRect(0, 0, AD_W, AD_H);
  g.strokeStyle = '#2c5d8f';
  g.lineWidth = 10;
  g.setLineDash([36, 20]);
  g.strokeRect(30, 30, AD_W - 60, AD_H - 60);
  g.setLineDash([]);
  g.textAlign = 'center';
  g.fillStyle = '#15181b';
  adText(g, 'РЕКЛАМНОЕ МЕСТО', AD_W / 2, 175, 92);
  g.fillStyle = '#2c5d8f';
  adText(g, 'СВОБОДНО', AD_W / 2, 300, 128);
  g.fillStyle = '#15181b';
  adText(g, 'нажмите на щит — оставьте заявку', AD_W / 2, 400, 48, 700);
}

function freeYoursAd(g) {
  g.fillStyle = '#2c5d8f';
  g.fillRect(0, 0, AD_W, AD_H);
  g.fillStyle = '#ffd23f';
  g.fillRect(0, AD_H - 90, AD_W, 90);
  g.textAlign = 'left';
  g.fillStyle = '#fff';
  adText(g, 'ВАША РЕКЛАМА', 70, 175, 112);
  adText(g, 'на щитах по всему Ижевску', 70, 275, 62, 700);
  g.fillStyle = '#15181b';
  adText(g, 'нажмите, чтобы разместить', 70, AD_H - 28, 52, 800);
}

// Щит 6 × 3 м на одной стойке, плакаты с двух сторон; щит — вдоль локальной x, лицевые стороны ±z.
const BB = { w: 6, h: 3, y: 6.9, t: 0.5 }; // размер плаката, высота его центра, толщина короба

export function billboardMaterials(renderer) {
  // Текстура и материал плакатов каждого рекламодателя.
  const sheets = ADVERTISERS.map((ad) => {
    const rows = [...ad.posters, ad.posters[0], ad.posters[1 % ad.posters.length]];
    const c = document.createElement('canvas');
    c.width = AD_W;
    c.height = AD_H * rows.length;
    const g = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const draw = (logo) => {
      rows.forEach((poster, k) => {
        g.save();
        g.translate(0, k * AD_H);
        g.beginPath();
        g.rect(0, 0, AD_W, AD_H);
        g.clip();
        poster(g, logo);
        g.restore();
      });
      tex.needsUpdate = true;
    };
    return { ad, rows: rows.length, tex, draw, poster: 0 };
  });
  for (const sh of sheets) sh.draw(null);
  const logo = new Image();
  logo.onload = () => sheets.forEach((sh) => sh.draw(logo));
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
  const faces = sheets.map(({ tex }) => new THREE.MeshLambertMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.35 }));
  let t0 = null;
  return {
    geo, faces, sheets,
    frame: new THREE.MeshLambertMaterial({ vertexColors: true }),
    meshes: new Set(), // плакаты загруженных квадратов — для нажатия по ним (main.js); ведёт chunks.js
    // Каждый кадр: смена плаката раз в AD_SHOW с, прокрутка за AD_ROLL с.
    tick(now) {
      t0 ??= now;
      const t = (now - t0) / 1000, period = AD_SHOW + AD_ROLL, n = Math.floor(t / period);
      const r = Math.max(0, (t - n * period - AD_SHOW) / AD_ROLL);
      const e = r * r * (3 - 2 * r);
      for (const sh of sheets) {
        const k = n % sh.ad.posters.length;
        sh.tex.offset.y = -(k + e) / sh.rows;
        sh.poster = (k + (e > 0.5)) % sh.ad.posters.length; // плакат на лицевой стороне — для аналитики нажатий
      }
    },
  };
}

const BB_STEP = { primary: 420, secondary: 480, tertiary: 560 }; // м вдоль улицы: место под щит
const BB_KEEP = 0.7;   // доля мест, где щит действительно стоит
const BB_SET = 4.2;    // м от края полотна до стойки
const BB_END = 30;     // м: у концов улицы не ставим
const BB_OSM_CLEAR = 120; // м: возле настоящего щита (OSM) щиты по шагу не ставим
const BB_OSM_ROAD = 25;   // м: щит из OSM — поперёк крупной улицы, если она не дальше, иначе поперёк ближайшей
const BB_MAJOR = /^(trunk|primary|secondary|tertiary)/;

// Щиты квадрата, поперёк дороги — плакаты видно в обе стороны движения. Настоящие — из OSM (`billboards`, точки,
// разворот по ближайшей улице); остальные редкие, у крупных улиц: места с шагом от начала всей улицы
// (как у столбов), часть мест пустует (по хешу), возле настоящих щитов мест нет.
export function buildBillboardChunk(world, info, mats) {
  const { data } = info;
  const { free, inBuilding } = spotChecks(world, data);
  const spots = [];
  // (dx, dz) — вдоль дороги: лица щита смотрят вдоль неё, края — к дороге и от неё.
  const place = (x, z, dx, dz, hk) => {
    // Края щита: стойка — на земле, не у дороги; щит не в доме и не под путепроводом.
    const ex = -dz * (BB.w / 2 + 0.2), ez = dx * (BB.w / 2 + 0.2);
    const nr = world.nearestRoad(x, z, 4);
    if ((nr && nr.d < 2) || world.isWater(x, z) || !free(x, z) || world.walks.near(x, z, 0.3)) return;
    const ok = [[x, z], [x + ex, z + ez], [x - ex, z - ez]]
      .every(([px, pz]) => !inBuilding(px, pz) && world.ground(px, pz) < world.terrain(px, pz) + 2);
    if (!ok) return;
    // Рекламодатель щита — по хешу места, в долях share.
    let u = ((hk >>> 12) % 1000) / 1000, adv = 0;
    while (adv < ADVERTISERS.length - 1 && u >= ADVERTISERS[adv].share) u -= ADVERTISERS[adv++].share;
    spots.push({ x, y: world.terrain(x, z), z, dx, dz, adv });
  };
  for (const [ox, oz] of data.billboards) {
    let near = null, major = null;
    for (const sg of world.segmentsNear(ox, oz, 50)) {
      const c = World.closest(sg, ox, oz), d = c.d - sg.w / 2;
      if (!near || d < near.d) near = { ...c, a: c.d, d, sg };
      if (BB_MAJOR.test(sg.road.k) && d < BB_OSM_ROAD && (!major || d < major.d)) major = { ...c, a: c.d, d, sg };
    }
    const hk = Math.imul(Math.round(ox * 10) ^ Math.round(oz * 10) * 7919, 2654435761) >>> 0;
    const r = major ?? near;
    if (!r) { place(ox, oz, 1, 0, hk); continue; }
    const { sg } = r, L = Math.hypot(sg.bx - sg.ax, sg.bz - sg.az) || 1, dx = (sg.bx - sg.ax) / L, dz = (sg.bz - sg.az) / L;
    // Точка из OSM ближе BB_SET к краю (часто — на тротуаре или на самом полотне) — отодвигаем от дороги.
    if (r.d >= BB_SET) { place(ox, oz, dx, dz, hk); continue; }
    let nx = -dz, nz = dx;
    if (r.a > 0.3) { nx = (ox - r.px) / r.a; nz = (oz - r.pz) / r.a; } else if (hk & 1024) { nx = -nx; nz = -nz; }
    const off = sg.w / 2 + BB_SET;
    place(r.px + nx * off, r.pz + nz * off, dx, dz, hk);
  }
  const osm = world.city.billboards || [];
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
        if (osm.some(([qx, qz]) => (qx - x) ** 2 + (qz - z) ** 2 < BB_OSM_CLEAR ** 2)) continue;
        place(x, z, dx, dz, hk);
      }
    }
  }
  if (!spots.length) return null;
  const frames = new THREE.InstancedMesh(mats.geo, mats.frame, spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  // Плакаты квадрата — по геометрии на рекламодателя: две стороны на щит, у каждой своя полоса его ленты.
  const geos = ADVERTISERS.map(() => ({ pos: [], nor: [], uv: [], idx: [], n: 0 }));
  const quad = (G, rows, cx, cy, cz, nx, nz, row) => {
    const rx = nz, rz = -nx; // вправо для смотрящего на лицо
    const pad = 3 / (AD_H * rows), v0 = 1 - (row + 1) / rows + pad, v1 = 1 - row / rows - pad, b = G.pos.length / 3;
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      G.pos.push(cx + rx * (u - 0.5) * BB.w, cy + (v - 0.5) * BB.h, cz + rz * (u - 0.5) * BB.w);
      G.nor.push(nx, 0, nz);
      G.uv.push(u, v ? v1 : v0);
    }
    G.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const lift = BB.t / 2 + 0.01;
  spots.forEach((sp, i) => {
    const { x, y, z, dx, dz, adv } = sp;
    frames.setMatrixAt(i, m.compose(p.set(x, y, z), q.setFromAxisAngle(up, Math.atan2(dx, dz)), one));
    // Сзади — другой плакат того же рекламодателя.
    const G = geos[adv], rows = mats.sheets[adv].rows;
    sp.k = G.n++;
    quad(G, rows, x + dx * lift, y + BB.y, z + dz * lift, dx, dz, 0);
    quad(G, rows, x - dx * lift, y + BB.y, z - dz * lift, -dx, -dz, 1);
  });
  frames.computeBoundingSphere();
  frames.castShadow = true;
  frames.userData.spots = spots; // для breakables.js: плакаты щита — вершины 8k…8k+7 в плакатах его рекламодателя (adv)
  const faces = geos.map((G, adv) => {
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(G.pos, 3));
    fg.setAttribute('normal', new THREE.Float32BufferAttribute(G.nor, 3));
    fg.setAttribute('uv', new THREE.Float32BufferAttribute(G.uv, 2));
    fg.setIndex(G.idx);
    fg.computeBoundingSphere();
    const mesh = new THREE.Mesh(fg, mats.faces[adv]);
    mesh.userData.adv = ADVERTISERS[adv];
    return mesh;
  });
  return [frames, ...faces];
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
  // Площадка — отдельно: снесённый павильон падает, а она остаётся.
  const base = part(new THREE.BoxGeometry(4.6, 0.5, 2.4).translate(0, -0.13, 0.15), '#a19d93'); // низ — в склон
  const frame = mergeGeos([
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
    base: mergeGeos([base], ['color']), frame, glass,
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
  // Павильоны и знаки сносятся (breakables.js: addStops) — места и меши с той же матрицей лежат у каркаса и стойки.
  const out = [];
  if (pavs.length) {
    const frame = inst(mats.frame, mats.frameMat, pavs, true), glass = inst(mats.glass, mats.glassMat, pavs, false);
    Object.assign(frame.userData, { spots: pavs, stop: 'pavilion', parts: [glass] });
    out.push(inst(mats.base, mats.frameMat, pavs, false), frame, glass);
  }
  if (signs.length) {
    const post = inst(mats.post, mats.frameMat, signs, true), faces = mats.faces.map((f) => inst(f, mats.sign, signs, false));
    Object.assign(post.userData, { spots: signs, stop: 'stopSign', parts: faces });
    out.push(post, ...faces);
  }
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
  stucco: { t: 0.6, len: 3, vm: null, tint: ['#ffffff', '#f4f2ec'] }, // белая оштукатуренная стена с филёнками (у завода)
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
  } else if (kind === 'stucco') { // штукатурка: светлый верх-поребрик, ниже — прорезь филёнки, тени потёков
    g.fillStyle = '#e9e7e1';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#f7f6f2';
    g.fillRect(0, 0, W, 34);
    g.fillStyle = '#c9c6be';
    g.fillRect(0, 34, W, 4);
    g.strokeStyle = '#cfccc4';
    g.lineWidth = 4;
    g.strokeRect(24, 70, W - 48, H - 120);
    for (let k = 0; k < 200; k++) {
      g.fillStyle = `rgba(150,145,135,${0.04 + rnd() * 0.06})`;
      g.fillRect(rnd() * W, 40 + rnd() * (H - 40), 1 + rnd() * 3, 2 + rnd() * 14);
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
  const put = (k) => (geo[k] ??= { pos: [], nor: [], uv: [], col: [], pieces: [] });
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
        // Лёгкий забор сносится кусками: вершины куска v0…v1 (для breakables.js).
        const piece = SOFT_FENCES.has(f.k) ? { x: mx, z: mz, y: (ya + yb) / 2, y0: Math.min(ya, yb), top: Math.max(ya, yb) + h,
          h, a: Math.atan2(ux, uz), ax: pax, az: paz, bx: pbx, bz: pbz, v0: g.pos.length / 3, v1: 0 } : null;
        if (piece) g.pieces.push(piece);
        if (!t) {
          quad([pax, ya - FENCE_SINK, paz], [pbx, yb - FENCE_SINK, pbz], [pbx, yb + h, pbz], [pax, ya + h, paz], [nx, 0, nz], uvs);
          if (piece) piece.v1 = g.pos.length / 3;
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
        if (piece) piece.v1 = g.pos.length / 3;
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
    if (g.pieces.length) m.userData.pieces = g.pieces;
    out.push(m);
  }
  return out.length ? out : null;
}

// ---------------------------------------------------------------- миникарта

export const MINIMAP_SCALE = 0.5; // пикселей на метр (1 px = 2 м)

// Тайл миникарты на квадрат: вода и парки, дома (свои и соседей — что заходит за край), дороги.
// S — пикселей плитки на метр (под экран: на retina и большой миникарте — крупнее MINIMAP_SCALE); тонкие линии —
// не тоньше, чем были при MINIMAP_SCALE.
export function drawMinimapTile(world, info, S = MINIMAP_SCALE) {
  const { x0, z0, x1, z1, data } = info;
  const k = S / MINIMAP_SCALE;
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
    g.lineWidth = Math.max(k, w.w * S);
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
    g.lineWidth = Math.max(1.2 * k, r.w * S);
    g.strokeStyle = MARKED_CLASSES.has(r.k) ? '#c9c4b5' : '#7c7a74';
    g.stroke();
  }
  return c;
}

// ---------------------------------------------------------------- тротуары и дорожки (walks.js)

function walkTileTexture(renderer, steps) {
  const S = 128, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = steps ? '#a19d95' : '#aaa69d';
  g.fillRect(0, 0, S, S);
  let seed = steps ? 7 : 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)';
    g.fillRect(rnd() * S, rnd() * S, 2, 2);
  }
  if (steps) {
    // Ступени по 0,32 м (текстура — 1 м вдоль, повтор ×3,125 задаётся в uv): тёмная тень под кромкой.
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.fillRect(0, S - 18, S, 18);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(0, 0, S, 6);
  } else {
    // Плитка 0,5 × 0,25 м вперевязку.
    g.fillStyle = 'rgba(60,58,54,0.35)';
    for (let r = 0; r < 4; r++) {
      g.fillRect(0, r * 32, S, 2);
      for (let c = 0; c < 2; c++) g.fillRect(((c * 64 + (r % 2) * 32) % S), r * 32, 2, 32);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

// Велодорожка: асфальт, белые линии по краям и значок велосипеда раз в CYCLE_TILE м. Текстура — вся ширина
// дорожки (u 0…1) на CYCLE_TILE м вдоль; пиксели квадратные при ширине 2,5 м, у других значок чуть сжат.
const CYCLE_TILE = 40;
function cycleTexture(renderer) {
  const W = 128, H = 2048, ppm = W / 2.5, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#46484b';
  g.fillRect(0, 0, W, H);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 6000; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)';
    g.fillRect(rnd() * W, rnd() * H, 2, 2);
  }
  g.fillStyle = '#d9d9d2';
  g.fillRect(0.12 * ppm, 0, 0.08 * ppm, H);
  g.fillRect(W - 0.2 * ppm, 0, 0.08 * ppm, H);
  // Значок: велосипед боком, колёсами поперёк дорожки — стоит прямо для того, кто едет навстречу оси v.
  g.save();
  g.translate(W / 2, H / 2);
  g.scale(ppm, ppm);
  g.strokeStyle = '#e6e6df';
  g.lineWidth = 0.07;
  g.lineCap = g.lineJoin = 'round';
  g.beginPath();
  for (const cx of [-0.5, 0.5]) { g.moveTo(cx + 0.32, 0.12); g.arc(cx, 0.12, 0.32, 0, Math.PI * 2); }
  // Рама: заднее колесо — каретка — руль — переднее; седло и руль.
  g.moveTo(-0.5, 0.12); g.lineTo(-0.05, 0.12); g.lineTo(0.3, -0.28); g.lineTo(-0.2, -0.28); g.lineTo(-0.05, 0.12);
  g.moveTo(0.3, -0.28); g.lineTo(0.5, 0.12);
  g.moveTo(-0.2, -0.28); g.lineTo(-0.26, -0.4); g.moveTo(-0.36, -0.4); g.lineTo(-0.14, -0.4);
  g.moveTo(0.3, -0.28); g.lineTo(0.26, -0.44); g.lineTo(0.38, -0.46);
  g.stroke();
  g.restore();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

export function walkMaterials(renderer) {
  return [
    new THREE.MeshLambertMaterial({ map: walkTileTexture(renderer, false) }),
    new THREE.MeshLambertMaterial({ map: walkTileTexture(renderer, true) }),
    new THREE.MeshLambertMaterial({ color: '#c4c0b8', side: THREE.DoubleSide }), // бордюр, бока, торцы
    new THREE.MeshLambertMaterial({ map: cycleTexture(renderer) }),
  ];
}

// Меш дорожек квадрата: плитка, лестницы, бордюры, велодорожки — одна геометрия с группами материалов.
// Ширина по сторонам своя в каждой точке (hl, hr): слитые тротуары шире, у велодорожки тротуар уже.
export function buildWalkChunk(world, info, mats) {
  const segs = world.walks.chunk(info.ci, info.cj);
  if (!segs.length) return null;
  const parts = [{ p: [], uv: [] }, { p: [], uv: [] }, { p: [], uv: [] }, { p: [], uv: [] }];
  const tri = (part, a, b, c, ua, ub, uc) => {
    part.p.push(...a, ...b, ...c);
    part.uv.push(...(ua || [0, 0]), ...(ub || [0, 0]), ...(uc || [0, 0]));
  };
  const quad = (part, a, b, c, d, ua, ub, uc, ud) => { tri(part, a, b, c, ua, ub, uc); tri(part, a, c, d, ua, uc, ud); };
  const T = (x, z) => world.terrain(x, z) - 0.05;
  for (const sg of segs) {
    const { strip, i } = sg, P = strip.pts, a = P[i - 1], b = P[i], k = strip.k;
    if (strip.grand) continue; // парадная лестница — своей моделью (landmarks.js)
    const top = parts[k === 's' ? 1 : k === 'c' ? 3 : 0], curb = parts[2];
    const vs = k === 's' ? 1 / 0.32 : k === 'c' ? 1 / CYCLE_TILE : 1;
    // Поперечные точки: край, внутренний край бордюра — слева и справа.
    const cross = (p) => {
      const nx = -p.dz * p.m, nz = p.dx * p.m, ch = p.curb ? CURB_H : 0, il = p.hl - CURB_W, ir = p.hr - CURB_W;
      return {
        L: [p.x + nx * p.hl, p.y + ch, p.z + nz * p.hl], Li: [p.x + nx * il, p.y + ch, p.z + nz * il],
        Ri: [p.x - nx * ir, p.y + ch, p.z - nz * ir], R: [p.x - nx * p.hr, p.y + ch, p.z - nz * p.hr],
        Lt: [p.x + nx * il, p.y, p.z + nz * il], Rt: [p.x - nx * ir, p.y, p.z - nz * ir],
      };
    };
    const A = cross(a), B = cross(b);
    // Плитка — по сетке города (u, v — метры x, z): на пересечении две дорожки лежат одной площадкой без шва.
    // Ступени — вдоль, велодорожка — доля ширины поперёк (значок посередине).
    const u = (p, q, left) => {
      if (k === 'f') return [q[0], q[2]];
      const o = left ? -(p.hl - CURB_W) : p.hr - CURB_W;
      return [k === 'c' ? (o + p.hl) / (p.hl + p.hr) : o, p.s * vs];
    };
    // Внутри пересечения (оба конца) — плитка на всю ширину, без бордюров и боков: края лежат на другой дорожке.
    if (a.jn && b.jn) {
      quad(top, A.L, B.L, B.R, A.R, u(a, A.L, true), u(b, B.L, true), u(b, B.R, false), u(a, A.R, false));
      continue;
    }
    // Покрытие между бордюрами.
    quad(top, A.Lt, B.Lt, B.Rt, A.Rt, u(a, A.Lt, true), u(b, B.Lt, true), u(b, B.Rt, false), u(a, A.Rt, false));
    // Бордюры — верх (на CURB_H выше плитки, где бордюр есть). Внутренняя грань в 5 см не видна — без неё
    // треугольников на треть меньше.
    quad(curb, A.L, B.L, B.Li, A.Li);
    quad(curb, A.Ri, B.Ri, B.R, A.R);
    // Бока до земли.
    const dn = (q) => [q[0], T(q[0], q[2]), q[2]];
    quad(curb, A.L, dn(A.L), dn(B.L), B.L);
    quad(curb, A.R, B.R, dn(B.R), dn(A.R));
    // Торцы там, где плита обрывается (не внутри другой дорожки).
    if ((i === 1 || !P[i - 2].on) && !a.jn) quad(curb, A.L, A.R, dn(A.R), dn(A.L));
    if ((i === P.length - 1 || !P[i + 1].on) && !b.jn) quad(curb, B.L, dn(B.L), dn(B.R), B.R);
  }
  const n = parts.reduce((t, pt) => t + pt.p.length / 3, 0);
  const geo = new THREE.BufferGeometry(), pos = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let at = 0;
  parts.forEach((pt, gi) => {
    if (!pt.p.length) return;
    geo.addGroup(at, pt.p.length / 3, gi);
    pos.set(pt.p, at * 3);
    uv.set(pt.uv, at * 2);
    at += pt.p.length / 3;
  });
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mats);
  mesh.receiveShadow = true;
  return mesh;
}

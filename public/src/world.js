// Данные города: рельеф, пространственные индексы дорог и зданий.

export const ROAD_CLASSES = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
  'living_street', 'service', 'road',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
]);
export const MARKED_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
// Чем важнее дорога, тем выше её полотно — так она перекрывает второстепенные на перекрёстках.
const LIFT = { motorway: 0.40, trunk: 0.40, primary: 0.38, secondary: 0.35, tertiary: 0.32, service: 0.24 };
export const roadLift = (k) => LIFT[k.replace('_link', '')] ?? 0.28;
export const TERRAIN_SEG = 15; // м: шаг сетки меша рельефа
export const CHUNK_CELLS = 34; // квадрат подгрузки = 34 клетки сетки рельефа (~510 м)

export class World {
  constructor(city) {
    this.city = city;
    this.bounds = city.bounds;
    this.nodes = city.roadNodes;
    this.roads = city.roads.filter((r) => ROAD_CLASSES.has(r.k) && !r.tu);
    this.patches = [];
    this.#initDem(city.dem);
    this.#initMeshGrid();
    this.#initRoadIndex();
    this.#initBuildingIndex();
    this.#initChunks();
  }

  // ---------------------------------------------------------------- квадраты подгрузки

  // Город делится на квадраты по сетке рельефа; для каждого — что в нём рисовать.
  // Дома и деревья — по центру, дороги для мешей — отрезками по середине (runs), участки,
  // тропинки и дороги для подложки и миникарты — всем квадратам, которых касается рамка.
  #initChunks() {
    const { nx, nz, dx, dz, xmin, zmin } = this.mesh;
    const C = CHUNK_CELLS;
    this.chunk = { nci: Math.ceil(nx / C), ncj: Math.ceil(nz / C), sx: dx * C, sz: dz * C, xmin, zmin };
    this.chunkData = new Map();
    const at = (ci, cj) => {
      const k = ci * 10000 + cj;
      let d = this.chunkData.get(k);
      if (!d) this.chunkData.set(k, (d = { ci, cj, areas: [], paths: [], rails: [], lines: [], runs: [], buildings: [], trees: [], water: null }));
      return d;
    };
    const cell = (x, z) => [Math.floor((x - xmin) / this.chunk.sx), Math.floor((z - zmin) / this.chunk.sz)];
    const overlap = (pts, pad, fn) => {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      const [a, b] = cell(x0 - pad, z0 - pad), [c, d] = cell(x1 + pad, z1 + pad);
      for (let i = Math.max(0, a); i <= Math.min(this.chunk.nci - 1, c); i++) {
        for (let j = Math.max(0, b); j <= Math.min(this.chunk.ncj - 1, d); j++) fn(at(i, j));
      }
    };
    const c = this.city;
    for (const a of c.areas) overlap(a.p, 0, (d) => d.areas.push(a));
    for (const p of c.paths) overlap(p, 2, (d) => d.paths.push(p));
    for (const r of c.rails) overlap(r.p, 2, (d) => d.rails.push(r));
    for (const b of c.buildings) {
      let sx = 0, sz = 0;
      for (const [x, z] of b.p) { sx += x; sz += z; }
      at(...cell(sx / b.p.length, sz / b.p.length)).buildings.push(b);
    }
    for (const t of c.trees) at(...cell(t[0], t[1])).trees.push(t);
    for (const r of this.roads) {
      const pts = r.n.map((i) => this.nodes[i]);
      overlap(pts, r.w, (d) => d.lines.push(r));
      // Отрезки подряд в одном квадрате — один кусок ленты.
      let run = null;
      for (let i = 1; i < pts.length; i++) {
        const [ci, cj] = cell((pts[i - 1][0] + pts[i][0]) / 2, (pts[i - 1][1] + pts[i][1]) / 2);
        if (run && run.ci === ci && run.cj === cj) { run.to = i; continue; }
        run = { road: r, from: i - 1, to: i, ci, cj };
        at(ci, cj).runs.push(run);
      }
    }
  }

  chunkAt(x, z) {
    const { xmin, zmin, sx, sz } = this.chunk;
    return [Math.floor((x - xmin) / sx), Math.floor((z - zmin) / sz)];
  }

  chunkInfo(ci, cj) {
    const C = CHUNK_CELLS, { nx, nz, dx, dz, xmin, zmin } = this.mesh;
    const i0 = ci * C, j0 = cj * C, i1 = Math.min(nx, i0 + C), j1 = Math.min(nz, j0 + C);
    const empty = { areas: [], paths: [], rails: [], lines: [], runs: [], buildings: [], trees: [] };
    return { ci, cj, i0, j0, i1, j1, x0: xmin + i0 * dx, z0: zmin + j0 * dz, x1: xmin + i1 * dx, z1: zmin + j1 * dz,
      data: this.chunkData.get(ci * 10000 + cj) || empty };
  }

  // ---------------------------------------------------------------- вода

  // Вода: растр 2 м на квадрат, строится при первом обращении. Вода из OSM минус коридоры
  // дорог (мост и плотина — не вода, там не тонем).
  isWater(x, z) {
    const [ci, cj] = this.chunkAt(x, z);
    if (ci < 0 || cj < 0 || ci >= this.chunk.nci || cj >= this.chunk.ncj) return false;
    const info = this.chunkInfo(ci, cj), d = info.data;
    if (!d.areas.some((a) => a.k === 'water')) return false;
    if (!d.water) d.water = this.#waterMask(info);
    const S = 0.5, i = Math.floor((x - info.x0) * S), j = Math.floor((z - info.z0) * S);
    return d.water.mask[j * d.water.w + i] === 1;
  }

  #waterMask(info) {
    const S = 0.5; // пикселей на метр
    const w = Math.ceil((info.x1 - info.x0) * S) + 1, h = Math.ceil((info.z1 - info.z0) * S) + 1;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    const tx = (x) => (x - info.x0) * S, tz = (z) => (z - info.z0) * S;
    const ring = (pts) => {
      g.moveTo(tx(pts[0][0]), tz(pts[0][1]));
      for (let i = 1; i < pts.length; i++) g.lineTo(tx(pts[i][0]), tz(pts[i][1]));
      g.closePath();
    };
    g.fillStyle = '#fff';
    for (const a of info.data.areas) {
      if (a.k !== 'water') continue;
      g.beginPath();
      ring(a.p);
      for (const hole of a.holes || []) if (hole.length > 2) ring(hole);
      g.fill('evenodd');
    }
    g.strokeStyle = '#000';
    g.lineCap = g.lineJoin = 'round';
    for (const r of info.data.lines) {
      g.beginPath();
      r.n.forEach((i, k) => g[k ? 'lineTo' : 'moveTo'](tx(this.nodes[i][0]), tz(this.nodes[i][1])));
      g.lineWidth = (r.w + 1) * S;
      g.stroke();
    }
    const px = g.getImageData(0, 0, w, h).data;
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) mask[i] = px[i * 4] > 127 ? 1 : 0;
    return { mask, w };
  }


  // ---------------------------------------------------------------- рельеф

  #initDem(dem) {
    const { nx, nz } = dem;
    // Одно сглаживание 3x3: исходный DEM шумит на метр-два, машинку трясёт.
    const src = dem.h;
    const h = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        let s = 0, n = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const ii = i + di, jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
            s += src[jj * nx + ii]; n++;
          }
        }
        h[j * nx + i] = s / n;
      }
    }
    this.dem = { ...dem, h };
  }

  // Рельеф с поправками (насыпи у мостов): по нему стоят дома, дороги, машины.
  // Высота берётся с той же треугольной сетки, что и меш рельефа, — иначе машина то висит,
  // то проваливается (DEM билинейный, а меш — треугольники 15 м).
  terrain(x, z) {
    const base = this.baseTerrain(x, z);
    let y = this.meshTerrain(x, z);
    for (const patch of this.patches) y += patch(x, z, base);
    return y;
  }

  // Сетка меша рельефа (build.js строит PlaneGeometry ровно по ней).
  #initMeshGrid() {
    const [xmin, zmin, xmax, zmax] = this.bounds;
    const W = xmax - xmin, H = zmax - zmin;
    const nx = Math.ceil(W / TERRAIN_SEG), nz = Math.ceil(H / TERRAIN_SEG);
    const h = new Float32Array((nx + 1) * (nz + 1));
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) h[j * (nx + 1) + i] = this.baseTerrain(xmin + (i * W) / nx, zmin + (j * H) / nz);
    }
    this.mesh = { xmin, zmin, W, H, nx, nz, dx: W / nx, dz: H / nz, h };
  }

  // Как PlaneGeometry режет клетку: диагональ из (i, j+1) в (i+1, j).
  meshTerrain(x, z) {
    const { xmin, zmin, nx, nz, dx, dz, h } = this.mesh;
    let fx = (x - xmin) / dx, fz = (z - zmin) / dz;
    fx = Math.min(Math.max(fx, 0), nx - 1e-6);
    fz = Math.min(Math.max(fz, 0), nz - 1e-6);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const a = h[j * (nx + 1) + i], d = h[j * (nx + 1) + i + 1];
    const b = h[(j + 1) * (nx + 1) + i], c = h[(j + 1) * (nx + 1) + i + 1];
    return u + v <= 1 ? a + (d - a) * u + (b - a) * v : c + (b - c) * (1 - u) + (d - c) * (1 - v);
  }

  // Поправка к рельефу: fn(x, z, base) → прибавка в метрах.
  addTerrainPatch(fn) { this.patches.push(fn); }

  // Исходный DEM (сетка 75 м, билинейно) — из него строится меш рельефа.
  baseTerrain(x, z) {
    const { x0, z0, step, nx, nz, h } = this.dem;
    let fx = (x - x0) / step, fz = (z - z0) / step;
    fx = Math.min(Math.max(fx, 0), nx - 1.001);
    fz = Math.min(Math.max(fz, 0), nz - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const a = h[j * nx + i], b = h[j * nx + i + 1];
    const c = h[(j + 1) * nx + i], d = h[(j + 1) * nx + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  // ---------------------------------------------------------------- дороги

  #initRoadIndex() {
    this.roadCell = 25;
    this.roadGrid = new Map();
    this.segments = [];
    for (const road of this.roads) {
      const pts = road.n.map((i) => this.nodes[i]);
      const lift = roadLift(road.k);
      // Мост: высота линейно между концами, а не по рельефу (иначе ныряет в пруд/овраг).
      let ys;
      if (road.br) {
        let len = 0;
        const acc = [0];
        for (let i = 1; i < pts.length; i++) acc.push((len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])));
        const y0 = this.terrain(...pts[0]), y1 = this.terrain(...pts[pts.length - 1]);
        ys = acc.map((d) => y0 + (y1 - y0) * (len ? d / len : 0) + lift);
      }
      road.y = ys; // undefined для обычных дорог
      road.lift = lift;
      for (let i = 1; i < pts.length; i++) {
        const seg = {
          ax: pts[i - 1][0], az: pts[i - 1][1], bx: pts[i][0], bz: pts[i][1],
          ya: ys?.[i - 1], yb: ys?.[i], w: road.w, road,
        };
        this.segments.push(seg);
        this.#insert(this.roadGrid, this.roadCell, seg, seg.w / 2 + 2);
      }
    }
  }

  #insert(grid, cell, s, pad) {
    const x0 = Math.floor((Math.min(s.ax, s.bx) - pad) / cell), x1 = Math.floor((Math.max(s.ax, s.bx) + pad) / cell);
    const z0 = Math.floor((Math.min(s.az, s.bz) - pad) / cell), z1 = Math.floor((Math.max(s.az, s.bz) + pad) / cell);
    for (let i = x0; i <= x1; i++) {
      for (let j = z0; j <= z1; j++) {
        const key = i * 100003 + j;
        let arr = grid.get(key);
        if (!arr) grid.set(key, (arr = []));
        arr.push(s);
      }
    }
  }

  static closest(s, x, z) {
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.min(1, Math.max(0, ((x - s.ax) * dx + (z - s.az) * dz) / l2));
    const px = s.ax + dx * t, pz = s.az + dz * t;
    return { t, px, pz, d: Math.hypot(x - px, z - pz) };
  }

  nearbyRoadSegments(x, z) {
    return this.roadGrid.get(Math.floor(x / this.roadCell) * 100003 + Math.floor(z / this.roadCell)) || [];
  }

  // Отрезки дорог в радиусе r (по сетке индекса, без перебора всего города).
  segmentsNear(x, z, r) {
    const c = this.roadCell, out = new Set();
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++) {
      for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c); j++) {
        for (const s of this.roadGrid.get(i * 100003 + j) || []) out.add(s);
      }
    }
    return out;
  }

  // Высота поверхности, по которой едет машина: рельеф, на дороге — её полотно (оно чуть
  // приподнято над рельефом), на мосту — настил моста.
  ground(x, z) {
    const t = this.terrain(x, z);
    let y = t;
    for (const s of this.nearbyRoadSegments(x, z)) {
      const c = World.closest(s, x, z);
      if (c.d > s.w / 2 + 0.3) continue;
      y = Math.max(y, s.ya === undefined ? t + s.road.lift : s.ya + (s.yb - s.ya) * c.t);
    }
    return y;
  }

  // Ближайшая дорога (для названия улицы на HUD и респауна).
  nearestRoad(x, z, maxD = 30) {
    let best = null;
    for (const s of this.nearbyRoadSegments(x, z)) {
      const c = World.closest(s, x, z);
      const d = c.d - s.w / 2;
      if (d < maxD && (!best || d < best.d)) best = { ...c, d, seg: s };
    }
    return best;
  }

  // ---------------------------------------------------------------- здания

  #initBuildingIndex() {
    this.bCell = 20;
    this.bGrid = new Map();
    for (const b of this.city.buildings) {
      if ((b.mh ?? 0) < 2.5) { // под переходом и аркой проезжаем
        this.addCollider(b.p, b.x);
        for (const h of b.holes || []) this.addCollider(h); // двор/поле внутри — тоже стены
      }
    }
  }

  // Замкнутый контур, сквозь который нельзя проехать. skip — индексы рёбер без стены.
  addCollider(p, skip = []) {
    for (let i = 0; i < p.length; i++) {
      if (skip.includes(i)) continue;
      const a = p[i], c = p[(i + 1) % p.length];
      this.#insert(this.bGrid, this.bCell, { ax: a[0], az: a[1], bx: c[0], bz: c[1] }, 0);
    }
  }

  // Выталкивает круг (x, z, r) из стен. Возвращает нормаль удара или null.
  collide(pos, r) {
    let hit = null;
    for (let iter = 0; iter < 3; iter++) {
      const key = Math.floor(pos.x / this.bCell) * 100003 + Math.floor(pos.y / this.bCell);
      const seen = new Set();
      let moved = false;
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          for (const s of this.bGrid.get(key + di * 100003 + dj) || []) {
            if (seen.has(s)) continue;
            seen.add(s);
            const c = World.closest(s, pos.x, pos.y);
            if (c.d < r && c.d > 1e-6) {
              const nx = (pos.x - c.px) / c.d, nz = (pos.y - c.pz) / c.d;
              pos.x += nx * (r - c.d);
              pos.y += nz * (r - c.d);
              hit = { x: nx, z: nz };
              moved = true;
            }
          }
        }
      }
      if (!moved) break;
    }
    return hit;
  }

  // ---------------------------------------------------------------- граф для гонок

  buildGraph() {
    const adj = new Map();
    const raceClasses = new Set(['primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'trunk',
      'primary_link', 'secondary_link', 'tertiary_link', 'living_street']);
    for (const r of this.roads) {
      if (!raceClasses.has(r.k)) continue;
      for (let i = 1; i < r.n.length; i++) {
        const a = r.n[i - 1], b = r.n[i];
        const pa = this.nodes[a], pb = this.nodes[b];
        // Главные улицы «дешевле» — маршрут тянется по проспектам, а не по дворам.
        const cost = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) * (MARKED_CLASSES.has(r.k) ? 1 : 1.6);
        if (!adj.has(a)) adj.set(a, []);
        if (!adj.has(b)) adj.set(b, []);
        adj.get(a).push([b, cost]);
        adj.get(b).push([a, cost]);
      }
    }
    this.graph = adj;
    return adj;
  }

  nearestGraphNode(x, z) {
    let best = -1, bd = Infinity;
    for (const id of this.graph.keys()) {
      const p = this.nodes[id];
      const d = (p[0] - x) ** 2 + (p[1] - z) ** 2;
      if (d < bd) { bd = d; best = id; }
    }
    return best;
  }

  shortestPath(from, to) {
    const dist = new Map([[from, 0]]);
    const prev = new Map();
    // Бинарная куча на массиве.
    const heap = [[0, from]];
    const push = (it) => {
      heap.push(it);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    while (heap.length) {
      const [d, u] = pop();
      if (u === to) break;
      if (d > dist.get(u)) continue;
      for (const [v, w] of this.graph.get(u) || []) {
        const nd = d + w;
        if (nd < (dist.get(v) ?? Infinity)) {
          dist.set(v, nd);
          prev.set(v, u);
          push([nd, v]);
        }
      }
    }
    if (!prev.has(to)) return null;
    const path = [to];
    while (path[path.length - 1] !== from) path.push(prev.get(path[path.length - 1]));
    return path.reverse();
  }
}

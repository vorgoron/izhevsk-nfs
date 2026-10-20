// Данные города: рельеф, пространственные индексы дорог и зданий.

export const ROAD_CLASSES = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
  'living_street', 'service', 'road',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
]);
export const MARKED_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
// Заборы, которые машина сносит (решётка, рабица, доски, профлист); плиты, кирпич, кусты и блоки — стены.
export const SOFT_FENCES = new Set(['bars', 'mesh', 'wood', 'prof']);
// Чем важнее дорога, тем выше её полотно — так она перекрывает второстепенные на перекрёстках.
const LIFT = { motorway: 0.40, trunk: 0.40, primary: 0.38, secondary: 0.35, tertiary: 0.32, service: 0.24 };
export const roadLift = (k) => LIFT[k.replace('_link', '')] ?? 0.28;
const RAMP = 40; // м: подъезд к ровному мосту
// Путепровод (мост над дорогой/рельсами): настил над нижней землёй на CLEAR м, уклон до GRADE,
// концы приподнимаются не выше END_MAX м (дальше — подъезды насыпью).
const CLEAR = 6.5, GRADE = 0.07, END_MAX = 6;
const GRADE_MAX = 0.12; // подъезд короче нужного (дальше перекрёсток) — сжимается до такого уклона
const MEDIAN_GAP = 6; // м: шире промежуток без трамвая между парными мостами — не заполняется
const MEDIAN_MAX = 25; // м: шире промежуток между парными мостами — общего настила нет
const RAIL_ALONG = 9; // м от края полотна путепровода: пути вдоль него идут на его уровне
// Трамвайное полотно — на TRAM_ABOVE выше среднего края соседних проезжих частей в TRAM_REACH м
// (обе колеи вровень), без дорог — на TRAM_LIFT над рельефом. Поперёк дороги (переезд) — прямая
// между полотном до и после, не ниже асфальта; край переезда ищется не дальше TRAM_SPAN м.
const TRAM_ABOVE = 0.02, TRAM_REACH = 8, TRAM_LIFT = 0.1, TRAM_SPAN = 60, TRAM_STEP = 2, TRAM_EASE = 20;
export const TRAM_BED = 3.2; // м: ширина трамвайного полотна на путь (= междупутье, соседние смыкаются)
export const TRAM_GRASS = 1; // м: газон между полотном и дорогой (лента дороги обрезается за ним, build.js)
// Газон снаружи пути уходит вниз от края щебня: на TRAM_DROP м к краю газона плюс TRAM_TUCK м под асфальт.
export const TRAM_DROP = 0.35, TRAM_TUCK = 0.5;
const TRAM_GRASS_WIN = 8; // м: газон только где соседнего пути с этой стороны нет на столько вперёд и назад
const WALL_CLEAR = 0.5; // м: забор ниже машины на столько не замечаем (низкий забор у дороги на подъёме — держит)
const STEP = 2; // м: на сколько выше машины поверхность ещё «под колёсами» (ground)
export const TERRAIN_SEG = 15; // м: шаг сетки меша рельефа
export const CHUNK_CELLS = 34; // квадрат подгрузки = 34 клетки сетки рельефа (~510 м)

function pointInRing(x, z, p) {
  let ins = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) ins = !ins;
  }
  return ins;
}

const ROOF_CELL = 40; // м: клетка сетки зданий для roofAt
const UTURN = 60;     // м: во столько обходится разворот в начале маршрута навигатора
const NAV_STREET = 120; // м: улица из адреса дома не дальше — маршрут к дому подъезжает по ней
const UTURN_R = 4;    // м: радиус дуги разворота, если улица позволяет (не меньше четверти ширины)
// Тротуары вдоль городских улиц (в OSM их редко рисуют отдельно): [газон между проезжей частью и тротуаром,
// ширина тротуара], м. Рисуются на земле (build.js), по ним едут как по асфальту (surfaceAt). На мостах и в тоннелях — нет.
export const SIDEWALK = { primary: [2, 3], secondary: [1.5, 3], tertiary: [1, 2.5], residential: [0, 2], unclassified: [0, 2] };

export class World {
  constructor(city) {
    this.city = city;
    this.bounds = city.bounds;
    this.nodes = city.roadNodes;
    this.roads = city.roads.filter((r) => ROAD_CLASSES.has(r.k) && !r.tu);
    this.patches = [];
    this.#initDem(city.dem);
    this.#initMeshGrid();
    this.#levelUnderBuildings();
    this.#planOverpasses();
    this.#carveUnderBridges();
    this.levelEnds = [];
    this.#initJunctions();
    this.#initRoadIndex();
    this.#initBuildingIndex();
    this.#initRailIndex();
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
      if (!d) this.chunkData.set(k, (d = { ci, cj, areas: [], paths: [], rails: [], waterways: [], lines: [], runs: [], buildings: [], trees: [], stops: [], fences: [], water: null }));
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
    for (const r of c.rails) overlap(r.p, 5, (d) => d.rails.push(r)); // запас: деревья не ближе 3.5 м к путям
    for (const w of c.waterways || []) overlap(w.p, w.w, (d) => d.waterways.push(w));
    for (const b of c.buildings) {
      let sx = 0, sz = 0;
      for (const [x, z] of b.p) { sx += x; sz += z; }
      at(...cell(sx / b.p.length, sz / b.p.length)).buildings.push(b);
    }
    for (const t of c.trees) at(...cell(t[0], t[1])).trees.push(t);
    for (const t of c.stops || []) at(...cell(t[0], t[1])).stops.push(t);
    for (const f of c.fences || []) overlap(f.p, 0, (d) => d.fences.push(f)); // рисует квадрат середины куска
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
    const empty = { areas: [], paths: [], rails: [], waterways: [], lines: [], runs: [], buildings: [], trees: [], stops: [], fences: [] };
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

  // Площадки под домами: узлы сетки рельефа внутри дома и в LEVEL_PAD м вокруг подтягиваются на долю
  // LEVEL_K к средней высоте земли под контуром — на склоне дом стоит на подрезанном уступе, но склон
  // остаётся (выровнять совсем — сетка 15 м дала бы террасы через весь квартал). Узел под несколькими
  // домами — к среднему их высот. Достопримечательности не трогаем: их модели подогнаны под рельеф.
  #levelUnderBuildings() {
    const LEVEL_PAD = 3, LEVEL_K = 0.5;
    const { h, nx, nz, dx, dz, xmin, zmin } = this.mesh;
    const sum = new Map();
    for (const b of this.city.buildings) {
      if (b.lm || b.mh) continue;
      const p = b.p;
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, t = 0;
      for (const [x, z] of p) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
        t += this.meshTerrain(x, z);
      }
      t /= p.length;
      const i0 = Math.max(0, Math.ceil((x0 - LEVEL_PAD - xmin) / dx)), i1 = Math.min(nx, Math.floor((x1 + LEVEL_PAD - xmin) / dx));
      const j0 = Math.max(0, Math.ceil((z0 - LEVEL_PAD - zmin) / dz)), j1 = Math.min(nz, Math.floor((z1 + LEVEL_PAD - zmin) / dz));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = xmin + i * dx, z = zmin + j * dz;
          if (!pointInRing(x, z, p) && !p.some((q, k) => World.closest({ ax: q[0], az: q[1], bx: p[(k + 1) % p.length][0],
            bz: p[(k + 1) % p.length][1] }, x, z).d < LEVEL_PAD)) continue;
          const n = j * (nx + 1) + i, e = sum.get(n);
          if (e) { e[0] += t; e[1]++; } else sum.set(n, [t, 1]);
        }
      }
    }
    for (const [n, [t, c]] of sum) h[n] += (t / c - h[n]) * LEVEL_K;
  }

  // Путепроводы: мост только над дорогами/рельсами идёт горбом — нижняя дорога остаётся на земле,
  // настил поднимается синусом на высоту проезда. Если пересечение близко к концу моста и горбу
  // не хватает высоты с уклоном до GRADE, концы моста приподняты на E, а подъезды заходят на них
  // насыпью (ramp в #initRoadIndex). Чего не хватило и так — добирается выемкой в #carveUnderBridges.
  // Полотно дробится узлами через ~10 м, чтобы отрезки (машины, ленты) повторяли горб.
  #planOverpasses() {
    const c = this.city, nodes = c.roadNodes;
    const at = this.#endsMap();
    const lenOf = (r) => this.#roadLen(r);
    // Длина подъезда от конца моста: дорога и её продолжение через узлы без развилок
    // (улица в OSM часто порезана на короткие куски).
    const appLen = (node, bridge) => Math.max(0, ...(at.get(node) || []).filter((q) => q !== bridge && !q.br).map((q) => {
      let L = 0;
      for (const step of this.#chain(q, node, at)) L += lenOf(step.road);
      return L;
    }));
    const plans = [];
    for (const r of this.roads) {
      if (!r.br || !r.cx?.length || r.cx.some((x) => x[2] === 'w')) continue;
      const n = [r.n[0]];
      for (let i = 1; i < r.n.length; i++) {
        const [ax, az] = nodes[r.n[i - 1]], [bx, bz] = nodes[r.n[i]], k = Math.ceil(Math.hypot(bx - ax, bz - az) / 10);
        for (let j = 1; j < k; j++) n.push(nodes.push([ax + ((bx - ax) * j) / k, az + ((bz - az) * j) / k]) - 1);
        n.push(r.n[i]);
      }
      r.n = n;
      const pts = n.map((i) => nodes[i]), acc = [0];
      for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const L = acc[acc.length - 1];
      const y0 = this.meshTerrain(...pts[0]), y1 = this.meshTerrain(...pts[pts.length - 1]);
      const sAt = (x, z) => { // расстояние вдоль моста до проекции точки
        let best = { d: Infinity, s: 0 };
        for (let i = 1; i < pts.length; i++) {
          const q = World.closest({ ax: pts[i - 1][0], az: pts[i - 1][1], bx: pts[i][0], bz: pts[i][1] }, x, z);
          if (q.d < best.d) best = { d: q.d, s: acc[i - 1] + (acc[i] - acc[i - 1]) * q.t };
        }
        return best.s;
      };
      const lin = (s) => y0 + ((y1 - y0) * s) / L;
      // Сколько не хватает настилу (без горба) до высоты проезда над точкой пересечения.
      const need = r.cx.map(([x, z]) => { const s = sAt(x, z); return { s, sin: Math.sin((Math.PI * s) / L), v: CLEAR + this.meshTerrain(x, z) - lin(s) }; });
      const Rmax = (GRADE * L) / Math.PI;
      // Подъезд насыпью (2E/GRADE, в тесноте — до уклона GRADE_MAX) должен уместиться с обеих сторон.
      const Ecap = Math.min(END_MAX, ...[r.n[0], r.n[r.n.length - 1]].map((e) => (GRADE_MAX * appLen(e, r)) / 2));
      const E = Math.min(Ecap, Math.max(0, ...need.map((q) => q.v - Rmax * q.sin)));
      plans.push({ r, pts, acc, L, sAt, lin, need, Rmax, Ecap, E });
    }
    // Парные путепроводы (две проезжие части рядом, концы рядом) — одной высоты: между ними трамвайные
    // пути и полоса, которые идут вровень с дорогой (общий настил — #pairTwins).
    const ends = (p) => [p.pts[0], p.pts[p.pts.length - 1]];
    for (const a of plans) {
      for (const b of plans) {
        if (a === b || !ends(a).every(([x, z]) => ends(b).some(([u, v]) => Math.hypot(u - x, v - z) < 40))) continue;
        a.E = b.E = Math.min(Math.max(a.E, b.E), a.Ecap, b.Ecap);
      }
    }
    for (const { r, acc, L, sAt, lin, need, Rmax, E: e } of plans) {
      const E = e < 0.3 ? 0 : e;
      const R = E > 0 ? Rmax : Math.min(Rmax, Math.max(0, ...need.map((q) => q.v / q.sin)));
      const hump = (s) => E + R * Math.sin((Math.PI * s) / L);
      r.hump = { E, ramp: (2 * E) / GRADE, y: acc.map((s) => lin(s) + hump(s)), short: (x, z) => { const s = sAt(x, z); return CLEAR + this.meshTerrain(x, z) - lin(s) - hump(s); } };
    }
  }

  // Парные мосты (две проезжие части рядом, концы попарно в 40 м) — и путепроводы, и через реку:
  // промежуток между ними (с трамваем или узкий) — общий настил (medianY, рисует один из пары, борт со стороны соседа
  // не рисуется). Иначе в щель между настилами и трамвайными путями видно землю и можно провалиться.
  #pairTwins() {
    const br = this.roads.filter((r) => r.br && r.y);
    const ends = (r) => [this.nodes[r.n[0]], this.nodes[r.n[r.n.length - 1]]];
    for (const a of br) {
      for (const b of br) {
        if (a === b || a.twin || !ends(a).every(([x, z]) => ends(b).some(([u, v]) => Math.hypot(u - x, v - z) < 40))) continue;
        const [a0, a1] = ends(a), [b0, b1] = ends(b), la = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]), lb = Math.hypot(b1[0] - b0[0], b1[1] - b0[1]);
        if (Math.abs((a1[0] - a0[0]) * (b1[0] - b0[0]) + (a1[1] - a0[1]) * (b1[1] - b0[1])) < 0.95 * la * lb) continue; // не параллельны
        const pa = a.n.map((i) => this.nodes[i]), k = Math.max(1, pa.length >> 1);
        const [p, q] = [pa[k], pa[k - 1]], pb = b.n.map((i) => this.nodes[i]), m = pb[pb.length >> 1];
        const mb = pb.length > 1 ? [(pb[0][0] + pb[pb.length - 1][0]) / 2, (pb[0][1] + pb[pb.length - 1][1]) / 2] : m;
        const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
        // Настил нужен, если между мостами трамвай или узкая щель; широкий промежуток без путей
        // (два отдельных моста через ручей) остаётся пустым.
        let near = null;
        for (let i = 1; i < pb.length; i++) {
          const c = World.closest({ ax: pb[i - 1][0], az: pb[i - 1][1], bx: pb[i][0], bz: pb[i][1] }, mx, mz);
          if (!near || c.d < near.d) near = c;
        }
        const gap = near.d - a.w / 2 - b.w / 2, cx = (mx + near.px) / 2, cz = (mz + near.pz) / 2;
        const tram = this.city.rails.some((r) => r.k === 'tram' && r.p.some((_, i) => i > 0 &&
          World.closest({ ax: r.p[i - 1][0], az: r.p[i - 1][1], bx: r.p[i][0], bz: r.p[i][1] }, cx, cz).d < gap / 2 + 1));
        if (gap > MEDIAN_GAP && !tram) continue;
        a.twin = b;
        a.twinSide = Math.sign((mb[0] - mx) * -(p[1] - q[1]) + (mb[1] - mz) * (p[0] - q[0])) || 1;
        a.medianDraw = !b.twin; // рисует тот, кто первым нашёл пару
      }
    }
  }

  #roadLen(r) {
    let L = 0;
    for (let i = 1; i < r.n.length; i++) L += Math.hypot(this.nodes[r.n[i]][0] - this.nodes[r.n[i - 1]][0], this.nodes[r.n[i]][1] - this.nodes[r.n[i - 1]][1]);
    return L;
  }

  // Узел → дороги, которые в нём начинаются или кончаются.
  #endsMap() {
    const at = new Map();
    for (const r of this.roads) {
      for (const n of [r.n[0], r.n[r.n.length - 1]]) {
        if (!at.has(n)) at.set(n, []);
        at.get(n).push(r);
      }
    }
    return at;
  }

  // Дорога road от узла node и её продолжение дальше через узлы, где сходятся ровно две дороги
  // (не мосты). [{ road, from: 0|1 — каким концом к началу цепочки, off — длина до неё }].
  #chain(road, node, at, maxLen = 400) {
    const out = [];
    let off = 0;
    for (;;) {
      const from = road.n[0] === node ? 0 : 1;
      out.push({ road, from, off });
      off += this.#roadLen(road);
      node = from === 0 ? road.n[road.n.length - 1] : road.n[0];
      const next = (at.get(node) || []).filter((q) => q !== road);
      if (off >= maxLen || next.length !== 1 || next[0].br || out.some((o) => o.road === next[0])) return out;
      road = next[0];
    }
  }

  // Под мостами — то, что они пересекают (сетка рельефа 30 м и сглаживание овраги съедают):
  // над водотоком — овраг вдоль русла, над дорогой/рельсами — нижняя дорога уходит в выемку.
  // Правится сетка меша, так что рельеф, дороги, дома и машины видят одно и то же.
  #carveUnderBridges() {
    const c = this.city, { h, nx, nz, dx, dz, xmin, zmin } = this.mesh;
    const depth = new Float32Array(h.length);
    const lines = [
      ...(c.waterways || []).map((w) => ({ k: 'w', p: w.p, w: w.w })),
      ...c.rails.map((r) => ({ k: 'o', p: r.p, w: 4 })),
      ...c.roads.filter((r) => !r.br && !r.tu && ROAD_CLASSES.has(r.k)).map((r) => ({ k: 'o', p: r.n.map((i) => c.roadNodes[i]), w: r.w })),
    ];
    const segDist = (x, z, a, b) => World.closest({ ax: a[0], az: a[1], bx: b[0], bz: b[1] }, x, z);
    for (const r of c.roads) {
      if (!r.br || !r.cx) continue;
      const pts = r.n.map((i) => c.roadNodes[i]);
      let L = 0;
      for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      for (const [cx, cz, k] of r.cx) {
        // Пересечённая линия: водоток или нижняя дорога, проходящая через точку пересечения.
        const segs = [];
        for (const ln of lines) {
          if (ln.k !== k) continue;
          for (let i = 1; i < ln.p.length; i++) {
            if (segDist(cx, cz, ln.p[i - 1], ln.p[i]).d < 2) {
              for (let j = 1; j < ln.p.length; j++) {
                if (segDist(cx, cz, ln.p[j - 1], ln.p[j]).d < 450) segs.push([ln.p[j - 1], ln.p[j], ln.w]); // только рядом с пересечением
              }
              break;
            }
          }
        }
        if (!segs.length) continue;
        // Над путепроводом с горбом — выемка только на то, чего горбу не хватило.
        const D = k === 'w' ? Math.min(12, Math.max(3, L * 0.15)) : r.hump ? r.hump.short(cx, cz) : 6.5;
        if (D < 0.3) continue;
        const along = k === 'w' ? Math.max(60, L) : 90;
        const halfW = (w) => (k === 'w' ? Math.max(8, L / 2 - 3) : w / 2 + 10);
        const R = along + 40;
        const i0 = Math.max(0, Math.floor((cx - R - xmin) / dx)), i1 = Math.min(nx, Math.ceil((cx + R - xmin) / dx));
        const j0 = Math.max(0, Math.floor((cz - R - zmin) / dz)), j1 = Math.min(nz, Math.ceil((cz + R - zmin) / dz));
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const x = xmin + i * dx, z = zmin + j * dz;
            let best = 0;
            for (const [a, b, w] of segs) {
              const q = segDist(x, z, a, b), W = halfW(w);
              if (q.d >= W) continue;
              const s = Math.hypot(q.px - cx, q.pz - cz); // вдоль линии от пересечения
              if (s >= along) continue;
              const across = 1 - (q.d / W) ** 2;
              const lengthwise = k === 'w' ? 1 - (s / along) ** 2 : Math.min(1, (along - s) / (along * 0.6)); // выемка — плавные спуски
              best = Math.max(best, D * across * lengthwise);
            }
            const n = j * (nx + 1) + i;
            depth[n] = Math.max(depth[n], best);
          }
        }
      }
    }
    for (let n = 0; n < h.length; n++) h[n] -= depth[n];
  }

  // Берега у ровного моста: сетку рельефа в 45 м от концов плавно подводим к высоте настила,
  // чтобы подъезд не был горкой или ямой (рельеф 30 м у воды шумный).
  #levelBridgeEnds() {
    const { h, nx, nz, dx, dz, xmin, zmin } = this.mesh, R = 45;
    for (const { pts, y } of this.levelEnds) {
      for (const [k, [ex, ez]] of pts.entries()) {
        // Ось моста от этого конца к другому: узлы «под мостом» (t > 1) не трогаем — там русло.
        const [ox, oz] = pts[1 - k], L = Math.hypot(ox - ex, oz - ez) || 1, ux = (ox - ex) / L, uz = (oz - ez) / L;
        const i0 = Math.max(0, Math.floor((ex - R - xmin) / dx)), i1 = Math.min(nx, Math.ceil((ex + R - xmin) / dx));
        const j0 = Math.max(0, Math.floor((ez - R - zmin) / dz)), j1 = Math.min(nz, Math.ceil((ez + R - zmin) / dz));
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const d = Math.hypot(xmin + i * dx - ex, zmin + j * dz - ez);
            if (d >= R) continue;
            const t = (xmin + i * dx - ex) * ux + (zmin + j * dz - ez) * uz;
            if (t > 1) continue;
            const w = 0.5 + 0.5 * Math.cos((Math.PI * d) / R), n = j * (nx + 1) + i;
            h[n] += (y - h[n]) * w;
          }
        }
      }
    }
  }

  // Как PlaneGeometry режет клетку: диагональ из (i, j+1) в (i+1, j).
  meshTerrain(x, z, h = this.mesh.h) {
    const { xmin, zmin, nx, nz, dx, dz } = this.mesh;
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

  // Перекрёстки улиц с разметкой: участки дороги (по длине от её начала), где разметки нет.
  // Ленты улиц в узле перекрываются, и разметка одной ложилась поверх другой. Продолжение
  // той же улицы и съезд под острым углом перекрёстком не считаются. Соседние участки ближе
  // JUNCTION_GAP сливаются — середина перекрёстка с двумя проезжими частями тоже без разметки.
  #initJunctions() {
    const JUNCTION_GAP = 15, COS_MIN = 0.87; // м; |cos| угла между ветками, выше — почти по прямой
    const marked = (r) => MARKED_CLASSES.has(r.k.replace('_link', ''));
    const at = new Map(); // узел → [[дорога, индекс в road.n]]
    for (const r of this.roads) {
      if (!marked(r)) continue;
      r.n.forEach((n, k) => {
        if (!at.has(n)) at.set(n, []);
        at.get(n).push([r, k]);
      });
    }
    const dir = (r, k, step) => {
      const [ax, az] = this.nodes[r.n[k]], [bx, bz] = this.nodes[r.n[k + step]];
      const l = Math.hypot(bx - ax, bz - az) || 1;
      return [(bx - ax) / l, (bz - az) / l];
    };
    // Ветки дороги из узла k: к предыдущему и к следующему узлу.
    const branches = (r, k) => [k > 0 && dir(r, k, -1), k < r.n.length - 1 && dir(r, k, 1)].filter(Boolean);
    for (const r of this.roads) {
      if (!marked(r)) continue;
      const zones = [];
      let s = 0;
      for (let k = 0; k < r.n.length; k++) {
        if (k > 0) {
          const [ax, az] = this.nodes[r.n[k - 1]], [bx, bz] = this.nodes[r.n[k]];
          s += Math.hypot(bx - ax, bz - az);
        }
        const own = branches(r, k);
        let R = 0;
        for (const [o, j] of at.get(r.n[k])) {
          if (o === r) continue;
          for (const [bx, bz] of branches(o, j)) {
            const c = Math.max(...own.map(([dx, dz]) => Math.abs(dx * bx + dz * bz)));
            if (c >= COS_MIN) continue;
            // Вдоль нашей дороги поперечная занимает w / sin угла (на косом перекрёстке длиннее).
            R = Math.max(R, Math.min(o.w, o.w / 2 / Math.sqrt(1 - c * c)) + 2);
          }
        }
        if (!R) continue;
        const last = zones[zones.length - 1];
        if (last && s - R - last[1] < JUNCTION_GAP) last[1] = Math.max(last[1], s + R);
        else zones.push([s - R, s + R]);
      }
      if (zones.length) r.plain = zones;
    }
  }

  #initRoadIndex() {
    this.roadCell = 25;
    this.roadGrid = new Map();
    this.segments = [];
    const deckAt = new Map(); // узел конца моста → { y: высота настила (без lift), len: длина подъезда, quad }
    // Проход 1: мосты. Высота линейно между концами, а не по рельефу (иначе ныряет в пруд/овраг).
    for (const road of this.roads) {
      road.lift = roadLift(road.k);
      if (!road.br) continue;
      const pts = road.n.map((i) => this.nodes[i]);
      let len = 0;
      const acc = [0];
      for (let i = 1; i < pts.length; i++) acc.push((len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])));
      let y0 = this.terrain(...pts[0]), y1 = this.terrain(...pts[pts.length - 1]);
      // Мост через реку — ровный: настил на средней высоте берегов (по исходному рельефу,
      // без прорезанного оврага); берега и подъезды подводятся к нему.
      if (road.cx?.some((c) => c[2] === 'w')) {
        y0 = y1 = (this.baseTerrain(...pts[0]) + this.baseTerrain(...pts[pts.length - 1])) / 2;
        this.levelEnds.push({ pts: [pts[0], pts[pts.length - 1]], y: y0, w: road.w });
        deckAt.set(road.n[0], { y: y0, len: RAMP });
        deckAt.set(road.n[road.n.length - 1], { y: y0, len: RAMP });
      }
      if (road.hump) {
        const { y, E, ramp } = road.hump;
        road.y = y.map((v) => v + road.lift);
        // Приподнятые концы: подъезд продолжает уклон настила и сходит на нет к земле.
        if (E > 0) {
          deckAt.set(road.n[0], { y: y[0], len: ramp, quad: true });
          deckAt.set(road.n[road.n.length - 1], { y: y[y.length - 1], len: ramp, quad: true });
        }
        continue;
      }
      road.y = acc.map((d) => y0 + (y1 - y0) * (len ? d / len : 0) + road.lift);
    }
    this.#levelBridgeEnds();
    this.#pairTwins();
    // Проход 2: подъезды к ровным мостам и приподнятым путепроводам — дорога плавно поднимается
    // к настилу, продолжая его, а не упирается в устой. ramp: [{ from: 0|1 (начало/конец), y, len, quad }].
    // Подъезд к путепроводу продолжается по цепочке кусков улицы (off — длина до куска), пока не
    // сойдёт к земле.
    const at = this.#endsMap();
    for (const [n, deck] of deckAt) {
      for (const road of at.get(n) || []) {
        if (road.br) continue;
        const steps = deck.quad ? this.#chain(road, n, at, deck.len) : [{ road, from: road.n[0] === n ? 0 : 1, off: 0 }];
        // Цепочка короче нужного (перекрёсток) — подъезд сжимается до её длины, круче.
        const last = steps[steps.length - 1], total = last.off + this.#roadLen(last.road);
        const len = deck.quad ? Math.min(deck.len, total) : deck.len;
        for (const { road: q, from, off } of steps) (q.ramp ??= []).push({ ...deck, len, from, off });
      }
    }
    for (const road of this.roads) {
      const pts = road.n.map((i) => this.nodes[i]);
      let acc = 0;
      road.len = 0;
      for (let i = 1; i < pts.length; i++) road.len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      for (let i = 1; i < pts.length; i++) {
        const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        const seg = {
          ax: pts[i - 1][0], az: pts[i - 1][1], bx: pts[i][0], bz: pts[i][1],
          ya: road.y?.[i - 1], yb: road.y?.[i], w: road.w, road, i, s0: acc, len: L,
        };
        acc += L;
        this.segments.push(seg);
        this.#insert(this.roadGrid, this.roadCell, seg, seg.w / 2 + 2 + (road.twin ? MEDIAN_MAX : 0));
      }
    }
    this.#raiseRampEmbankments();
  }

  // Насыпь под подъездами к путепроводам — настоящий рельеф, а не только откосы-картинка: между
  // проезжими частями двухпутной улицы иначе остаётся яма до земли, и машина в неё падает.
  // Узлы сетки в EMB_FLAT м от края полотна поднимаются под самое полотно (полоса и трамвайные пути
  // между проезжими частями — вровень), дальше — откос до EMB_FALL.
  #raiseRampEmbankments() {
    const EMB_FLAT = 7, EMB_FALL = 19;
    const { h, nx, nz, dx, dz, xmin, zmin } = this.mesh;
    const h0 = (this.mesh.h0 = h.slice());
    for (const road of this.roads) {
      if (!road.ramp?.some((r) => r.quad)) continue;
      const pts = road.n.map((i) => this.nodes[i]), acc = [0];
      // Концы, которыми дорога примыкает к мосту: за них (под пролёт) насыпь не заходит — там
      // нижняя дорога или рельсы.
      const stops = road.ramp.filter((r) => r.quad && !r.off).map(({ from }) => {
        const [a, b] = from === 0 ? [pts[0], pts[1]] : [pts[pts.length - 1], pts[pts.length - 2]];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        return { x: a[0], z: a[1], ux: (b[0] - a[0]) / l, uz: (b[1] - a[1]) / l };
      });
      for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const R = road.w / 2 + EMB_FALL;
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      const i0 = Math.max(0, Math.floor((x0 - R - xmin) / dx)), i1 = Math.min(nx, Math.ceil((x1 + R - xmin) / dx));
      const j0 = Math.max(0, Math.floor((z0 - R - zmin) / dz)), j1 = Math.min(nz, Math.ceil((z1 + R - zmin) / dz));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = xmin + i * dx, z = zmin + j * dz;
          if (stops.some((e) => (x - e.x) * e.ux + (z - e.z) * e.uz < 0)) continue;
          let best = null;
          for (let k = 1; k < pts.length; k++) {
            const q = World.closest({ ax: pts[k - 1][0], az: pts[k - 1][1], bx: pts[k][0], bz: pts[k][1] }, x, z);
            if (!best || q.d < best.d) best = { ...q, s: acc[k - 1] + (acc[k] - acc[k - 1]) * q.t };
          }
          const lat = best.d - road.w / 2;
          if (lat >= EMB_FALL) continue;
          const y = this.rampAt(road, best.s, best.px, best.pz);
          if (y === null) continue;
          // Высота насыпи над исходной землёй у оси (на 0.3 м ниже полотна, чтобы не проступала).
          const rise = y - road.lift - 0.3 - this.meshTerrain(best.px, best.pz, h0);
          if (rise <= 0) continue;
          const wt = lat <= EMB_FLAT ? 1 : 1 - (lat - EMB_FLAT) / (EMB_FALL - EMB_FLAT);
          const n = j * (nx + 1) + i;
          h[n] = Math.max(h[n], h0[n] + rise * wt);
        }
      }
    }
    this.embDone = true;
  }

  // Высота полотна подъезда к мосту в точке (x, z) на расстоянии s от начала дороги, или null.
  rampAt(road, s, x, z) {
    if (!road.ramp) return null;
    let y = null;
    for (const { from, y: deck, len: Lr, quad, off = 0 } of road.ramp) {
      const d = off + (from === 0 ? s : road.len - s);
      // Подъезд к путепроводу: парабола, у моста её уклон равен уклону настила (без излома).
      if (d >= Lr) continue;
      // Подъезд к путепроводу считается от рельефа до насыпи (h0), иначе насыпь поднимала бы сама себя.
      const g = quad && this.mesh.h0 ? this.terrain(x, z) - this.meshTerrain(x, z) + this.meshTerrain(x, z, this.mesh.h0) : this.terrain(x, z);
      const t = g + road.lift, w = quad ? (1 - d / Lr) ** 2 : 0.5 + 0.5 * Math.cos((Math.PI * d) / Lr);
      let v = t + (deck + road.lift - t) * w;
      // Насыпь соседней дороги (парный мост с другой высотой, примыкание) может быть выше —
      // полотно не уходит под неё.
      if (quad && this.embDone) v = Math.max(v, this.terrain(x, z) + road.lift);
      y = y === null ? v : Math.max(y, v);
    }
    return y;
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

  // Покрытие под точкой: 'road' — полотно дороги, 'paved' — площадь, парковка, промзона,
  // беговая дорожка; иначе 'ground' (трава, парк, лес, пустырь) — там едется тяжело.
  surfaceAt(x, z) {
    let walk = false;
    for (const s of this.nearbyRoadSegments(x, z)) {
      const d = World.closest(s, x, z).d;
      if (d < s.w / 2 + 0.4) return 'road';
      const sw = !s.road.br && !s.road.tu && SIDEWALK[s.road.k];
      if (sw && d > s.w / 2 + sw[0] && d < s.w / 2 + sw[0] + sw[1]) walk = true;
    }
    if (walk) return 'paved';
    const [ci, cj] = this.chunkAt(x, z);
    const d = this.chunkData.get(ci * 10000 + cj);
    if (!d) return 'ground';
    // Участки отсортированы от больших к мелким: верхний (последний подходящий) — видимый.
    let kind = null;
    for (const a of d.areas) if (pointInRing(x, z, a.p) && !(a.holes || []).some((h) => pointInRing(x, z, h))) kind = a.k;
    return kind === 'paved' || kind === 'industrial' || kind === 'track' ? 'paved' : 'ground';
  }

  // Трамвайные и железнодорожные пути: индекс отрезков (дороги их не перекрывают, опоры не ставятся).
  #initRailIndex() {
    this.railCell = 25;
    this.railGrid = new Map();
    this.city.rails.forEach((r, ri) => {
      let s0 = 0;
      for (let i = 1; i < r.p.length; i++) {
        const [ax, az] = r.p[i - 1], [bx, bz] = r.p[i];
        this.#insert(this.railGrid, this.railCell, { ax, az, bx, bz, k: r.k, ri, s0, len: Math.hypot(bx - ax, bz - az) }, 6);
        s0 += Math.hypot(bx - ax, bz - az);
      }
    });
  }

  railsNear(x, z) {
    return this.railGrid.get(Math.floor(x / this.railCell) * 100003 + Math.floor(z / this.railCell)) || [];
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
  // приподнято над рельефом), на мосту — настил моста. ref — текущая высота машины: поверхности
  // выше неё больше чем на STEP (настил над головой) не считаются, иначе под мостом машину
  // выбрасывает наверх. Без ref — самая высокая поверхность.
  ground(x, z, ref = Infinity) {
    const t = this.terrain(x, z), lim = ref + STEP;
    let y = t;
    for (const s of this.nearbyRoadSegments(x, z)) {
      const c = World.closest(s, x, z);
      if (c.d > s.w / 2 + 0.3) continue;
      const v = this.#segY(s, c, x, z, t);
      if (v <= lim) y = Math.max(y, v);
    }
    const m = this.medianY(x, z);
    if (m !== null && m <= lim) y = Math.max(y, m);
    // Трамвайное полотно — по нему едут, а не проваливаются в плиту.
    for (const q of this.railsNear(x, z)) {
      if (q.k !== 'tram') continue;
      const c = World.closest(q, x, z);
      if (c.d > TRAM_BED / 2 + TRAM_GRASS) continue;
      const L = Math.hypot(q.bx - q.ax, q.bz - q.az) || 1;
      const l = this.railLevel(x, z, (q.bx - q.ax) / L, (q.bz - q.az) / L, true);
      if (l.o > l.wl || -l.o > l.wr) continue; // за газоном
      // На газоне — по его наклону вниз (как в buildRailChunk).
      const a = Math.abs(l.o), w = l.o > 0 ? l.wl : l.wr, W = TRAM_BED / 2;
      const ly = a > W ? l.y - (TRAM_DROP * (a - W)) / (w + TRAM_TUCK - W) : l.y;
      if (l.bed && ly <= lim) y = Math.max(y, ly);
    }
    return y;
  }

  // Высота общего настила между парными мостами в точке или null (точка не между ними).
  // Настил ровный поперёк: от края одного моста к краю другого.
  medianY(x, z) {
    return this.#median(x, z)?.y ?? null;
  }

  // { y, s } — высота общего настила и ближайший отрезок моста (для направления) или null.
  #median(x, z) {
    const near = new Map(); // мост → ближайший его отрезок
    for (const s of this.nearbyRoadSegments(x, z)) {
      if (!s.road.twin) continue;
      const c = World.closest(s, x, z), r = s.road;
      // За концами моста настила нет.
      if ((s.s0 === 0 && c.t === 0) || (s.s0 + s.len >= r.len - 0.01 && c.t === 1)) continue;
      if (!near.has(r) || c.d < near.get(r).c.d) near.set(r, { s, c });
    }
    let a = null, b = null;
    for (const [r, k] of near) if (near.has(r.twin) && (!a || k.c.d < a.c.d)) [a, b] = [k, near.get(r.twin)];
    if (!a) return null;
    const ga = a.c.d - a.s.w / 2, gb = b.c.d - b.s.w / 2;
    // Между ними: точка лежит на отрезке между ближайшими точками двух мостов.
    if (ga < -0.3 || gb < -0.3 || ga + gb > MEDIAN_MAX || a.c.d + b.c.d > Math.hypot(a.c.px - b.c.px, a.c.pz - b.c.pz) + 1) return null;
    const ya = a.s.ya + (a.s.yb - a.s.ya) * a.c.t, yb = b.s.ya + (b.s.yb - b.s.ya) * b.c.t;
    const f = Math.min(1, Math.max(0, ga / (ga + gb || 1)));
    return { y: ya + (yb - ya) * f, s: a.s };
  }

  // Высота под рельсами: как ground, но путепроводы (мосты над дорогами/рельсами) пропускаются —
  // пути идут под ними. По мосту через реку рельсы идут по настилу.
  // Пути вдоль путепровода (dx, dz — направление пути), между его проезжими частями или рядом,
  // идут вровень с ближайшим полотном моста или подъезда: в OSM у трамвая свой мост, а флага
  // «мост» у рельсов в данных нет.
  railGround(x, z, dx = 0, dz = 0, tram = false) {
    return this.railLevel(x, z, dx, dz, tram).y;
  }

  // { y, bed }: bed — под трамвайными рельсами своё полотно (не асфальт, не мост). У трамвая — из
  // профиля пути (#tramProfile), у железной дороги — в точке.
  railLevel(x, z, dx = 0, dz = 0, tram = false) {
    if (!tram) return this.#railLevel(x, z, dx, dz, false);
    let best = null;
    for (const q of this.railsNear(x, z)) {
      if (q.k !== 'tram') continue;
      const c = World.closest(q, x, z);
      if (!best || c.d < best.c.d) best = { q, c };
    }
    if (!best || best.c.d > 4) return this.#pairLevel(x, z, dx, dz, this.#railLevel(x, z, dx, dz, true));
    const { q, c } = best, P = this.#tramProfile(q.ri), s = q.s0 + q.len * c.t;
    const k = Math.min(P.length - 2, Math.max(0, Math.floor(s / TRAM_STEP)));
    const a = P[k], b = P[k + 1], f = Math.min(1, Math.max(0, (s - a.s) / (b.s - a.s || 1)));
    const n = f < 0.5 ? a : b;
    // Наклон полотна поперёк (gx, gz) — высота в точке сбоку от оси пути.
    const gx = a.gx + (b.gx - a.gx) * f, gz = a.gz + (b.gz - a.gz) * f;
    const y = a.y + (b.y - a.y) * f + gx * (x - c.px) + gz * (z - c.pz);
    // wl, wr — полуширина полотна влево/вправо по ходу пути (rdx, rdz), o — смещение точки влево от оси.
    const rdx = (q.bx - q.ax) / (q.len || 1), rdz = (q.bz - q.az) / (q.len || 1);
    return { y, bed: n.bed, cross: n.cross, gx, gz, wl: a.wl + (b.wl - a.wl) * f, wr: a.wr + (b.wr - a.wr) * f,
      rdx, rdz, o: (x - c.px) * -rdz + (z - c.pz) * rdx };
  }

  // Профиль высоты трамвайного пути ri: точки через TRAM_STEP м — высота на оси и наклон поперёк (gx, gz).
  // Между проезжими частями — плоскость от края до края (#railLevel); без дорог — посередине между путём
  // и соседним параллельным (обе колеи на одной высоте).
  // Переезд и полотно без дорог рядом (у перекрёстка отрезки дорог расходятся) — по прямой между
  // надёжными точками до и после вдоль самого пути, с заходом в соседний кусок пути за стыком: без
  // впадины на асфальт и без ступеньки до рельефа.
  #tramProfile(ri) {
    this.tramProfiles ??= new Map();
    let P = this.tramProfiles.get(ri);
    if (P) return P;
    const raw = this.#tramRaw(ri), lim = TRAM_SPAN;
    // Ближайшая надёжная точка в сторону sg: сначала в своём пути, потом в продолжении за концом.
    const find = (i, sg) => {
      for (let j = i + sg; j >= 0 && j < raw.length; j += sg) {
        const d = Math.abs(raw[j].s - raw[i].s);
        if (d > lim) return null;
        if (raw[j].ok) return { d, ...raw[j] };
      }
      const end = sg < 0 ? raw[0] : raw[raw.length - 1], d0 = Math.abs(end.s - raw[i].s);
      const cont = this.#tramNext(ri, sg < 0 ? 0 : 1);
      if (!cont) return null;
      const R = this.#tramRaw(cont.ri);
      for (let n = 0; n < R.length; n++) {
        const p = cont.end === 0 ? R[n] : R[R.length - 1 - n], d = d0 + Math.abs(p.s - (cont.end === 0 ? 0 : R[R.length - 1].s));
        if (d > lim) return null;
        if (p.ok) return { d, ...p };
      }
      return null;
    };
    P = raw.map((p, i) => {
      if (p.ok) return { s: p.s, y: p.y, bed: p.bed, cross: false, gx: p.gx, gz: p.gz };
      const a = find(i, -1), b = find(i, 1);
      // Надёжная точка только с одной стороны (пути уходят с улицы) — от неё к своему уровню за TRAM_EASE м.
      const o = a || b;
      const w = a && b ? a.d / (a.d + b.d) : o ? Math.min(1, o.d / TRAM_EASE) : 1;
      const A = a && b ? a : o ?? p, B = a && b ? b : p;
      const y = A.y + (B.y - A.y) * w, gx = A.gx + (B.gx - A.gx) * w, gz = A.gz + (B.gz - A.gz) * w;
      return p.cross ? { s: p.s, y: Math.max(p.y, y), bed: false, cross: true, gx: 0, gz: 0 } : { s: p.s, y, bed: p.bed, cross: false, gx, gz };
    });
    // Полуширина полотна влево/вправо (по ходу пути): снаружи пары — с газоном до дороги. Газон — только
    // где соседа с этой стороны нет на ±TRAM_GRASS_WIN м, и ширина меняется плавно (TRAM_GRASS за 5 м):
    // сосед на изгибе находится через раз, и край полотна шёл ступеньками.
    const W = TRAM_BED / 2, win = Math.round(TRAM_GRASS_WIN / TRAM_STEP), rate = (TRAM_GRASS / 5) * TRAM_STEP;
    for (const [key, nb] of [['wl', 'nl'], ['wr', 'nr']]) {
      const w = raw.map((_, i) => (raw.slice(Math.max(0, i - win), i + win + 1).some((q) => q[nb]) ? W : W + TRAM_GRASS));
      for (let i = 1; i < w.length; i++) w[i] = Math.min(w[i], w[i - 1] + rate);
      for (let i = w.length - 2; i >= 0; i--) w[i] = Math.min(w[i], w[i + 1] + rate);
      w.forEach((v, i) => (P[i][key] = v));
    }
    this.tramProfiles.set(ri, P);
    return P;
  }

  // Высоты в точках пути без сглаживания: ok — точка надёжная (не переезд, рядом есть дороги).
  #tramRaw(ri) {
    this.tramRaws ??= new Map();
    let R = this.tramRaws.get(ri);
    if (R) return R;
    const p = this.city.rails[ri].p;
    // Соседний путь сбоку (sg: 1 — слева): рельс другого пути в метре от точки на междупутье от оси.
    const nbAt = (x, z, dx, dz, sg) => {
      const px = x - dz * TRAM_BED * sg, pz = z + dx * TRAM_BED * sg;
      return this.railsNear(px, pz).some((q) => q.k === 'tram' && q.ri !== ri && World.closest(q, px, pz).d < 1);
    };
    const grass = (x, z, dx, dz) => ({ nl: nbAt(x, z, dx, dz, 1), nr: nbAt(x, z, dx, dz, -1) });
    R = [];
    let s0 = 0;
    for (let i = 1; i < p.length; i++) {
      const [ax, az] = p[i - 1], [bx, bz] = p[i], L = Math.hypot(bx - ax, bz - az);
      if (L < 1e-6) continue;
      const dx = (bx - ax) / L, dz = (bz - az) / L;
      // Точки ровно через TRAM_STEP по длине всего пути (railLevel ищет их делением).
      for (let s = Math.ceil(s0 / TRAM_STEP) * TRAM_STEP; s < s0 + L; s += TRAM_STEP) {
        const x = ax + dx * (s - s0), z = az + dz * (s - s0);
        let l = this.#railLevel(x, z, dx, dz, true);
        if (!l.cross) l = this.#pairLevel(x, z, dx, dz, l);
        R.push({ s, y: l.y, bed: l.bed, cross: !!l.cross, ok: !l.cross && l.anchored !== false, gx: l.gx ?? 0, gz: l.gz ?? 0, ...grass(x, z, dx, dz) });
      }
      s0 += L;
    }
    const [x, z] = p[p.length - 1], [px, pz] = p[p.length - 2];
    const L = Math.hypot(x - px, z - pz) || 1;
    let l = this.#railLevel(x, z, (x - px) / L, (z - pz) / L, true);
    if (!l.cross) l = this.#pairLevel(x, z, (x - px) / L, (z - pz) / L, l);
    R.push({ s: s0, y: l.y, bed: l.bed, cross: !!l.cross, ok: !l.cross && l.anchored !== false, gx: l.gx ?? 0, gz: l.gz ?? 0, ...grass(x, z, (x - px) / L, (z - pz) / L) });
    this.tramRaws.set(ri, R);
    return R;
  }

  // Продолжение трамвайного пути ri за концом end (0 — начало, 1 — конец): путь с тем же концом,
  // самый прямой (на стрелке — тот, что идёт дальше по прямой). { ri, end } или null.
  #tramNext(ri, end) {
    if (!this.tramEnds) {
      this.tramEnds = new Map();
      this.city.rails.forEach((r, i) => {
        if (r.k !== 'tram' || r.p.length < 2) return;
        for (const e of [0, 1]) {
          const q = e ? r.p[r.p.length - 1] : r.p[0], key = `${q[0].toFixed(1)},${q[1].toFixed(1)}`;
          if (!this.tramEnds.has(key)) this.tramEnds.set(key, []);
          this.tramEnds.get(key).push({ ri: i, end: e });
        }
      });
    }
    const p = this.city.rails[ri].p, q = end ? p[p.length - 1] : p[0], q2 = end ? p[p.length - 2] : p[1];
    const ox = q[0] - q2[0], oz = q[1] - q2[1], oL = Math.hypot(ox, oz) || 1; // направление наружу
    let best = null;
    for (const o of this.tramEnds.get(`${q[0].toFixed(1)},${q[1].toFixed(1)}`) || []) {
      if (o.ri === ri) continue;
      const r = this.city.rails[o.ri].p, a = o.end ? r[r.length - 1] : r[0], b = o.end ? r[r.length - 2] : r[1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, cos = ((b[0] - a[0]) * ox + (b[1] - a[1]) * oz) / L / oL;
      if (cos > 0.7 && (!best || cos > best.cos)) best = { ...o, cos };
    }
    return best;
  }

  // Уровень полотна в паре путей считается посередине между ними (края дорог ищутся оттуда — иначе
  // дальняя проезжая часть на границе радиуса видна одному пути и не видна другому, и в стыке полотен
  // ступенька); высота пути — по плоскости полотна в его точке.
  #pairLevel(x, z, dx, dz, own) {
    let best = null;
    for (const q of this.railsNear(x, z)) {
      if (q.k !== 'tram') continue;
      const c = World.closest(q, x, z), L = Math.hypot(q.bx - q.ax, q.bz - q.az) || 1;
      if (c.d < 2.5 || c.d > 4 || Math.abs(((q.bx - q.ax) * dx + (q.bz - q.az) * dz) / L) < 0.97) continue;
      if (!best || c.d < best.d) best = c;
    }
    if (!best) return own;
    const mx = (x + best.px) / 2, mz = (z + best.pz) / 2, mid = this.#railLevel(mx, mz, dx, dz, true);
    if (mid.cross || mid.bed !== own.bed || (mid.anchored === false && own.anchored !== false)) return own;
    return { ...mid, y: mid.y + (mid.gx ?? 0) * (x - mx) + (mid.gz ?? 0) * (z - mz) };
  }

  #railLevel(x, z, dx, dz, tram) {
    const along = (s) => Math.abs(((s.bx - s.ax) * dx + (s.bz - s.az) * dz) / (s.len || 1)) > 0.9;
    const m = this.#median(x, z);
    if (m && along(m.s)) return { y: m.y, bed: false }; // вдоль парных мостов — по их общему настилу; поперёк — под ним
    const t = this.terrain(x, z);
    let y = t, near = null, cross = false;
    const edges = new Map(); // дорога → край ближайшего её отрезка
    for (const s of this.segmentsNear(x, z, RAIL_ALONG + 15)) {
      const c = World.closest(s, x, z);
      // Вдоль любого моста или подъезда — на уровне полотна (у трамвая в OSM свой мост рядом).
      const lifted = s.road.hump || s.road.ramp?.some((r) => r.quad);
      if ((lifted || s.road.br || s.road.ramp) && c.d <= s.w / 2 + RAIL_ALONG && along(s)) {
        if (!near || c.d < near.d) near = { d: c.d, y: this.#segY(s, c, x, z, t) };
        continue;
      }
      if (lifted) continue; // поперёк путепровода или его подъезда — пути под ним
      if (c.d <= s.w / 2 + 0.3) {
        y = Math.max(y, this.#segY(s, c, x, z, t));
        if (!along(s)) cross = true;
      }
      // Только отрезки напротив точки (до 1 м за концом — стыки отрезков): конец соседнего отрезка
      // впереди на подъёме выше на полметра.
      const over = (c.t === 0 || c.t === 1) ? Math.hypot(c.px - x, c.pz - z) ** 2 - this.#perp(s, x, z) ** 2 : 0;
      if (tram && c.d <= s.w / 2 + TRAM_REACH && along(s) && over < 1 && !(edges.get(s.road)?.d <= c.d)) {
        edges.set(s.road, { d: c.d, ...this.#edgeY(s, c, x, z, dx, dz) });
      }
    }
    if (near) return { y: Math.max(y, near.y), bed: false };
    if (!tram || cross) return { y, bed: false, cross };
    if (!edges.size) return { y: t + TRAM_LIFT, bed: true, anchored: false, gx: 0, gz: 0 };
    // Полотно — наклонная плоскость от края ближней проезжей части слева до края справа: на улице с
    // уклоном поперёк оба края вровень с асфальтом (ровное поперёк вставало над нижней стороной).
    let L = null, R = null, inside = null;
    for (const e of edges.values()) {
      if (e.inside) inside = e;
      else if (e.o > 0 && (!L || e.o < L.o)) L = e;
      else if (e.o < 0 && (!R || e.o > R.o)) R = e;
    }
    const nx = -dz, nz = dx; // влево от направления пути
    if (inside) return { y: inside.y + TRAM_ABOVE, bed: true, gx: inside.g * nx, gz: inside.g * nz };
    if (!L || !R) return { y: (L || R).y + TRAM_ABOVE, bed: true, gx: 0, gz: 0 };
    const g = (L.y - R.y) / (L.o - R.o);
    return { y: R.y + g * -R.o + TRAM_ABOVE, bed: true, gx: g * nx, gz: g * nz };
  }

  // Расстояние от точки до прямой отрезка (не до самого отрезка).
  #perp(s, x, z) {
    return Math.abs((x - s.ax) * (s.bz - s.az) - (z - s.az) * (s.bx - s.ax)) / (s.len || 1);
  }

  // Край ленты асфальта напротив точки: { y, o } — высота и смещение края влево от пути (dx, dz).
  // Точка на самой ленте — { y, g, inside }: высота ленты в точке и её уклон влево от пути
  // (лента идёт краями по рельефу, на склоне поперёк улицы края на разной высоте).
  #edgeY(s, c, x, z, dx, dz) {
    const L = s.len || 1, nx = -(s.bz - s.az) / L, nz = (s.bx - s.ax) / L, h = s.w / 2;
    const side = (x - c.px) * nx + (z - c.pz) * nz;
    const flat = s.ya !== undefined ? s.ya + (s.yb - s.ya) * c.t : null;
    const at = (k) => flat ?? this.#segY(s, c, c.px + nx * h * k, c.pz + nz * h * k, this.terrain(c.px + nx * h * k, c.pz + nz * h * k));
    const sg = (nx * -dz + nz * dx) >= 0 ? 1 : -1; // нормаль отрезка смотрит влево от пути?
    if (c.d >= h) {
      const k = Math.sign(side) || 1;
      return { y: at(k), o: ((c.px + nx * h * k - x) * -dz + (c.pz + nz * h * k - z) * dx) };
    }
    const f = (side / h + 1) / 2;
    return { y: at(-1) + (at(1) - at(-1)) * f, g: ((at(1) - at(-1)) / (2 * h)) * sg, inside: true };
  }

  // Высота полотна дороги road в точке (ближайший её отрезок рядом) или null.
  roadY(road, x, z) {
    let best = null;
    for (const s of this.nearbyRoadSegments(x, z)) {
      if (s.road !== road) continue;
      const c = World.closest(s, x, z);
      if (!best || c.d < best.c.d) best = { s, c };
    }
    return best && this.#segY(best.s, best.c, x, z, this.terrain(x, z));
  }

  #segY(s, c, x, z, t) {
    if (s.ya !== undefined) return s.ya + (s.yb - s.ya) * c.t;
    return (s.road.ramp ? this.rampAt(s.road, s.s0 + s.len * c.t, x, z) : null) ?? t + s.road.lift;
  }

  // Ближайшая дорога (для названия улицы на HUD и респауна).
  nearestRoad(x, z, maxD = 30) {
    let best = null;
    // Рядом — одна клетка индекса; дальше (респаун из леса) — расширяющийся поиск.
    if (maxD > 30) {
      for (let r = 50; r <= maxD && !best; r *= 2) best = this.#nearestIn(this.segmentsNear(x, z, Math.min(r, maxD)), x, z, maxD);
      return best;
    }
    return this.#nearestIn(this.nearbyRoadSegments(x, z), x, z, maxD);
  }

  #nearestIn(segs, x, z, maxD) {
    let best = null;
    for (const s of segs) {
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
    this.roofGrid = new Map(); // клетка → здания, для roofAt
    for (const b of this.city.buildings) {
      if ((b.mh ?? 0) < 2.5) { // под переходом и аркой проезжаем
        // Верх стен — по самой низкой точке рельефа под домом: выше — уже над крышей, стена не держит.
        const top = Math.min(...b.p.map(([x, z]) => this.terrain(x, z))) + b.h;
        this.addCollider(b.p, b.x, top);
        for (const h of b.holes || []) this.addCollider(h, [], top); // двор/поле внутри — тоже стены
        const xs = b.p.map((q) => q[0]), zs = b.p.map((q) => q[1]);
        const rb = { p: b.p, holes: b.holes, top, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
        for (let i = Math.floor(rb.x0 / ROOF_CELL); i <= Math.floor(rb.x1 / ROOF_CELL); i++) {
          for (let j = Math.floor(rb.z0 / ROOF_CELL); j <= Math.floor(rb.z1 / ROOF_CELL); j++) {
            const k = i * 100003 + j;
            (this.roofGrid.get(k) || this.roofGrid.set(k, []).get(k)).push(rb);
          }
        }
      }
    }
    // Заборы — тоже стены (проёмы под ворота и дороги вырезаны при сборке). Лёгкие (SOFT_FENCES) машину
    // не держат — их сносит breakables.js, здесь они только для расстановки (soft в collide).
    for (const f of this.city.fences || []) {
      const soft = SOFT_FENCES.has(f.k);
      for (let i = 1; i < f.p.length; i++) {
        const a = f.p[i - 1], c = f.p[i];
        const top = Math.max(this.terrain(a[0], a[1]), this.terrain(c[0], c[1])) + f.h;
        this.#insert(this.bGrid, this.bCell, { ax: a[0], az: a[1], bx: c[0], bz: c[1], soft, top, fence: true }, 0);
      }
    }
  }

  // Замкнутый контур, сквозь который нельзя проехать. skip — индексы рёбер без стены; top — высота верха стен
  // (над ним — проезжаем: машина на крыше), без неё — стена бесконечная.
  addCollider(p, skip = [], top = Infinity) {
    for (let i = 0; i < p.length; i++) {
      if (skip.includes(i)) continue;
      const a = p[i], c = p[(i + 1) % p.length];
      this.#insert(this.bGrid, this.bCell, { ax: a[0], az: a[1], bx: c[0], bz: c[1], top }, 0);
    }
  }

  // Крыша здания под точкой: высота её верха или null. Не выше y (снизу на крышу не попасть).
  roofAt(x, z, y = Infinity) {
    let best = null;
    for (const b of this.roofGrid.get(Math.floor(x / ROOF_CELL) * 100003 + Math.floor(z / ROOF_CELL)) || []) {
      if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1 || b.top > y || (best !== null && b.top <= best)) continue;
      if (pointInRing(x, z, b.p) && !(b.holes || []).some((h) => pointInRing(x, z, h))) best = b.top;
    }
    return best;
  }

  // Выталкивает круг (x, z, r) из стен. Возвращает нормаль удара или null. soft — и из лёгких заборов.
  // y — высота низа машины: в прыжке и на крыше (ground = false) стены ниже неё не мешают; на земле — держат
  // все, кроме заборов ниже машины больше чем на WALL_CLEAR (забор под мостом, по которому едем).
  collide(pos, r, soft = false, y = -Infinity, ground = false) {
    let hit = null;
    for (let iter = 0; iter < 3; iter++) {
      const key = Math.floor(pos.x / this.bCell) * 100003 + Math.floor(pos.y / this.bCell);
      const seen = new Set();
      let moved = false;
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          for (const s of this.bGrid.get(key + di * 100003 + dj) || []) {
            if (seen.has(s) || (s.soft && !soft)) continue;
            if (ground ? s.fence && y > s.top + WALL_CLEAR : y > (s.top ?? Infinity) - 0.5) continue;
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

  // graph — для гонок, в обе стороны по любой улице; nav — для навигатора по карте, направленный:
  // односторонняя улица (и каждая половина проспекта с разделителем) — только по ходу движения.
  // Ребро — [узел, цена, улица].
  buildGraph() {
    const adj = new Map(), nav = new Map();
    const link = (m, a, b, cost, r) => (m.get(a) || m.set(a, []).get(a)).push([b, cost, r]);
    const raceClasses = new Set(['primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'trunk',
      'primary_link', 'secondary_link', 'tertiary_link', 'living_street']);
    for (const r of this.roads) {
      if (!raceClasses.has(r.k)) continue;
      for (let i = 1; i < r.n.length; i++) {
        const a = r.n[i - 1], b = r.n[i];
        const pa = this.nodes[a], pb = this.nodes[b];
        // Главные улицы «дешевле» — маршрут тянется по проспектам, а не по дворам.
        const cost = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) * (MARKED_CLASSES.has(r.k) ? 1 : 1.6);
        link(adj, a, b, cost, r);
        link(adj, b, a, cost, r);
        link(nav, a, b, cost, r);
        if (r.ow) { if (!nav.has(b)) nav.set(b, []); } else link(nav, b, a, cost, r);
      }
    }
    this.graph = adj;
    this.nav = nav;
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

  // Куда навигатору подъехать к точке (дом, место на карте): ближайшее к ней место на улице из графа
  // навигатора, не дальше maxD; улица адреса street (если есть рядом) — предпочтительнее. null — нет улиц.
  navEnd(x, z, street = null, maxD = 300) {
    let best = null, named = null;
    for (const s of this.segmentsNear(x, z, maxD)) {
      if (!this.nav.get(s.road.n[s.i - 1])?.some((e) => e[2] === s.road)) continue;
      const c = World.closest(s, x, z);
      if (c.d > maxD) continue;
      const end = { ...c, seg: s };
      if (!best || c.d < best.d) best = end;
      if (street && s.road.name === street && c.d < NAV_STREET && (!named || c.d < named.d)) named = end;
    }
    return named ?? best;
  }

  // Маршрут навигатора от машины (x, z, курс heading) до узла to — точки [x, z], первая — где машина.
  // to — номер узла или место на улице из navEnd: тогда маршрут кончается в нём, на своей полосе.
  // Едет по своей стороне, посередине крайней правой полосы (не по пунктиру между полосами).
  // Старт — концы ближайшего к машине отрезка улицы, куда по нему можно ехать; назад — через разворот
  // (дуга налево), он дороже на UTURN. Против односторонней — только если иначе туда не попасть
  // (OSM: тупик односторонних). null — не доехать.
  navRoute(x, z, heading, to) {
    if (typeof to !== 'object') return this.#navRoute(x, z, heading, to);
    // Место на отрезке a–b — временный узел V: в него заезжают с концов отрезка, куда по нему можно ехать.
    const { seg: s, t } = to, r = s.road, a = r.n[s.i - 1], b = r.n[s.i], V = this.nodes.length;
    const f = MARKED_CLASSES.has(r.k) ? 1 : 1.6, links = [[this.nav, a, t], [this.graph, a, t], [this.graph, b, 1 - t]];
    if (!r.ow) links.push([this.nav, b, 1 - t]);
    this.nodes.push([to.px, to.pz]);
    for (const [g, n, k] of links) g.get(n).push([V, k * s.len * f, r]);
    try {
      return this.#navRoute(x, z, heading, V, to);
    } finally {
      for (const [g, n] of links) g.get(n).pop();
      this.nodes.pop();
    }
  }

  #navRoute(x, z, heading, to, end = null) {
    const nav = this.nav, fx = Math.sin(heading), fz = Math.cos(heading);
    // Сдвиг вправо от оси — до середины крайней правой полосы (полосы — как у трафика: из OSM или по ширине).
    const side = (r) => {
      const total = r.ln ?? Math.max(1, Math.round((r.w - 1) / 3.3));
      const lanes = r.ow ? total : Math.max(1, Math.floor(total / 2));
      return r.w / 2 - (r.ow ? r.w : r.w / 2) / lanes / 2;
    };
    let seg = null, c = null;
    for (const s of this.segmentsNear(x, z, 60)) {
      if (!nav.get(s.road.n[s.i - 1])?.some((e) => e[2] === s.road)) continue; // двор, проезд — не в графе
      const k = World.closest(s, x, z);
      if (!c || k.d < c.d) { seg = s; c = k; }
    }
    let starts, path;
    if (seg) {
      const r = seg.road, a = r.n[seg.i - 1], b = r.n[seg.i];
      const ahead = (seg.bx - seg.ax) * fx + (seg.bz - seg.az) * fz >= 0; // машина смотрит от a к b
      starts = [[b, (1 - c.t) * seg.len + (ahead ? 0 : UTURN)]];
      if (!r.ow) starts.push([a, c.t * seg.len + (ahead ? UTURN : 0)]);
      if (end?.seg.road === r && end.seg.i === seg.i) { // место на том же отрезке, что и машина — прямо к нему
        if (end.t >= c.t) starts.push([to, (end.t - c.t) * seg.len + (ahead ? 0 : UTURN)]);
        else if (!r.ow) starts.push([to, (c.t - end.t) * seg.len + (ahead ? UTURN : 0)]);
      }
      path = to === a || to === b ? [to] : this.shortestPath(starts, to, nav) ?? this.shortestPath(starts, to);
    } else {
      const from = this.nearestGraphNode(x, z);
      path = from === to ? [to] : this.shortestPath(from, to, nav) ?? this.shortestPath(from, to);
    }
    if (!path) return null;

    // Рёбра маршрута: направление и сдвиг вправо. Первое — от машины по её отрезку до первого узла.
    const road = (u, v) => nav.get(u)?.find((e) => e[0] === v)?.[2];
    const edges = [];
    const edge = (ax, az, bx, bz, off) => {
      const L = Math.hypot(bx - ax, bz - az);
      if (L > 0.5) edges.push({ ax, az, bx, bz, dx: (bx - ax) / L, dz: (bz - az) / L, off });
    };
    const out = [[x, z]];
    if (seg) {
      const [nx, nz] = this.nodes[path[0]];
      let dx = nx - c.px, dz = nz - c.pz, sx = c.px, sz = c.pz, off = side(seg.road);
      const L = Math.hypot(dx, dz) || 1;
      dx /= L; dz /= L;
      if (dx * fx + dz * fz < 0) { // узел позади — разворот: дуга налево вокруг точки чуть впереди, обратно — от неё
        // Правая сторона по ходу машины — (dz, −dx); дуга начинается сбоку там же, где машина, но
        // не выходит за края полотна (на 0,5 м). q — сдвиг центра дуги вправо от оси.
        const h = seg.w / 2 - 0.5, R = Math.max(seg.w / 4, Math.min(UTURN_R, h));
        const q = Math.max(R - h, Math.min(h - R, (x - c.px) * dz - (z - c.pz) * dx - R));
        sx -= dx * 3; sz -= dz * 3;
        for (let k = 0; k <= 8; k++) {
          const a = (k / 8) * Math.PI, u = q + R * Math.cos(a); // от правой стороны через перёд к левой
          out.push([sx + dz * u - dx * R * Math.sin(a), sz - dx * u - dz * R * Math.sin(a)]);
        }
        off = R - q; // обратно — от конца дуги параллельно оси
      }
      edge(sx, sz, nx, nz, off);
    }
    for (let i = 1; i < path.length; i++) {
      const [ax, az] = this.nodes[path[i - 1]], [bx, bz] = this.nodes[path[i]];
      const r = road(path[i - 1], path[i]);
      edge(ax, az, bx, bz, r ? side(r) : 0);
    }
    if (!edges.length) return [...out, this.nodes[to]];

    // Ломаная со сдвигом: в узле — пересечение сдвинутых линий соседних рёбер; почти прямо, слишком
    // далеко (острый угол) — концы обоих рёбер.
    const right = (e, t) => [e.ax + (e.bx - e.ax) * t - e.dz * e.off, e.az + (e.bz - e.az) * t + e.dx * e.off];
    out.push(right(edges[0], 0));
    for (let i = 1; i < edges.length; i++) {
      const e = edges[i - 1], f = edges[i];
      const [px, pz] = right(e, 1), [qx, qz] = right(f, 0);
      const cr = e.dx * f.dz - e.dz * f.dx;
      if (Math.abs(cr) < 0.05) { out.push([(px + qx) / 2, (pz + qz) / 2]); continue; }
      const t = ((qx - px) * f.dz - (qz - pz) * f.dx) / cr; // вдоль e от её сдвинутого конца
      const mx = px + e.dx * t, mz = pz + e.dz * t;
      if (Math.hypot(mx - e.bx, mz - e.bz) < 3 * Math.max(e.off, f.off, 1)) out.push([mx, mz]);
      else out.push([px, pz], [qx, qz]);
    }
    out.push(right(edges[edges.length - 1], 1));
    return out;
  }

  // Путь по графу (по умолчанию гоночному) — узлы от from до to, null — не доехать.
  // from — узел или несколько стартов [[узел, начальная цена], …]: путь начнётся с выгодного.
  shortestPath(from, to, graph = this.graph) {
    const starts = Array.isArray(from) ? from : [[from, 0]];
    const dist = new Map(starts.map(([n, d]) => [n, d]));
    const prev = new Map();
    // Бинарная куча на массиве.
    const heap = starts.map(([n, d]) => [d, n]).sort((a, b) => a[0] - b[0]);
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
      for (const [v, w] of graph.get(u) || []) {
        const nd = d + w;
        if (nd < (dist.get(v) ?? Infinity)) {
          dist.set(v, nd);
          prev.set(v, u);
          push([nd, v]);
        }
      }
    }
    if (!dist.has(to)) return null;
    const path = [to];
    while (prev.has(path[path.length - 1])) path.push(prev.get(path[path.length - 1]));
    return path.reverse();
  }
}

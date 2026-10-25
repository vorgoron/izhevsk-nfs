// Данные города: рельеф, пространственные индексы дорог и зданий.
import { Walks } from './walks.js';

export const ROAD_CLASSES = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
  'living_street', 'service', 'road',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
]);
export const MARKED_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
// Заборы, которые машина сносит (решётка, рабица, доски, профлист); плиты, кирпич и блоки — стены.
export const SOFT_FENCES = new Set(['bars', 'mesh', 'wood', 'prof']);
// Живая изгородь машину не держит и не ломается — проезжается насквозь (для расстановки — как лёгкий забор).
const PASS_FENCES = new Set(['hedge']);
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
const TRAM_ABOVE = 0.02, TRAM_REACH = 8, TRAM_LIFT = 0.1, TRAM_SPAN = 60, TRAM_STEP = 2, TRAM_EASE = 20, TRAM_XEASE = 8, TRAM_EDGE_WIN = 2;
export const TRAM_BED = 3.2; // м: ширина трамвайного полотна на путь (= междупутье, соседние смыкаются)
export const TRAM_GRASS = 1; // м: газон между полотном и дорогой (лента дороги обрезается за ним, build.js)
// Газон снаружи пути уходит вниз от края щебня: на TRAM_DROP м к краю газона плюс TRAM_TUCK м под асфальт.
export const TRAM_DROP = 0.35, TRAM_TUCK = 0.5;
const TRAM_GRASS_WIN = 8; // м: газон только где соседнего пути с этой стороны нет на столько вперёд и назад
const WALL_CLEAR = 0.5; // м: забор ниже машины на столько не замечаем (низкий забор у дороги на подъёме — держит)
const STEP = 2; // м: на сколько выше машины поверхность ещё «под колёсами» (ground)
export const TERRAIN_SEG = 15; // м: шаг сетки меша рельефа
// м: край карты — забор (boundary.js) на столько внутрь от bounds, дальше не проехать: за ним кончается рельеф.
export const EDGE_INSET = 20;
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
// Тротуары вдоль городских улиц, где в OSM своего нет (walks.js): [газон между проезжей частью и тротуаром,
// ширина тротуара], м. По ним едут как по асфальту (surfaceAt). На мостах и в тоннелях — нет.
export const SIDEWALK = { primary: [2, 3], secondary: [1.5, 3], tertiary: [1, 2.5], residential: [0, 2], unclassified: [0, 2] };
// Лежачие полицейские (bumps в city.json): вид → [длина вдоль дороги, высота], м. В Ижевске обычный лежачий —
// широкий пологий асфальтовый горб (~3 м), не узкий резиновый. Приподнятый переход (2) — ровная площадка с пандусами BUMP_RAMP м.
export const BUMP = [[3, 0.08], [4, 0.11], [7, 0.12]];
export const BUMP_RAMP = 1.5;
const BUMP_CELL = 25;
// Где ставить знаки у точек на дорогах: м до точки по ходу и от края полотна.
const SIGN_BACK = { z: 1.5, b: 2, g: 0.5, s: 0.5 }, SIGN_SIDE = 0.8;
// Стены у высокого (towers): полуширина основания по виду, м (у ЛЭП и мачт — по высоте).
const TOWER_BASE = { ch: 2.6, ms: 1.6, mm: 0.6, mr: 0.6, ml: 0.5, wt: 2, tw: 2.2, cr: 1, pt: 0.09, pp: 0.18 };

export class World {
  constructor(city) {
    this.city = city;
    this.bounds = city.bounds;
    const [bx0, bz0, bx1, bz1] = city.bounds;
    this.edge = [bx0 + EDGE_INSET, bz0 + EDGE_INSET, bx1 - EDGE_INSET, bz1 - EDGE_INSET];
    this.nodes = city.roadNodes;
    this.roads = city.roads.filter((r) => ROAD_CLASSES.has(r.k) && !r.tu);
    this.patches = [];
    this.#initDem(city.dem);
    this.#initMeshGrid();
    this.#levelUnderBuildings();
    this.#gradeRoads();
    this.#planOverpasses();
    this.#carveUnderBridges();
    this.levelEnds = [];
    this.#initJunctions();
    this.#initRoadIndex();
    this.#initBuildingIndex();
    this.#initGuardrails();
    this.#initRailIndex();
    this.#initPoints();
    this.#initChunks();
    this.walks = new Walks(this);
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
      if (!d) this.chunkData.set(k, (d = { ci, cj, areas: [], paths: [], rails: [], waterways: [], lines: [], runs: [], buildings: [], trees: [], stops: [], billboards: [], shops: [], fences: [], pts: [], water: null }));
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
    for (const p of c.paths) overlap(p.p, p.w, (d) => d.paths.push(p));
    for (const r of c.rails) overlap(r.p, 5, (d) => d.rails.push(r)); // запас: деревья не ближе 3.5 м к путям
    for (const w of c.waterways || []) overlap(w.p, w.w, (d) => d.waterways.push(w));
    for (const b of c.buildings) {
      let sx = 0, sz = 0;
      for (const [x, z] of b.p) { sx += x; sz += z; }
      at(...cell(sx / b.p.length, sz / b.p.length)).buildings.push(b);
    }
    for (const t of c.trees) at(...cell(t[0], t[1])).trees.push(t);
    for (const t of c.stops || []) at(...cell(t[0], t[1])).stops.push(t);
    for (const t of c.billboards || []) at(...cell(t[0], t[1])).billboards.push(t);
    for (const t of c.shops || []) at(...cell(t[0], t[1])).shops.push(t);
    for (const f of c.fences || []) overlap(f.p, 0, (d) => d.fences.push(f)); // рисует квадрат середины куска
    for (const p of this.points) at(...cell(p.x, p.z)).pts.push(p); // мелочи из OSM (#initPoints) — по своей точке
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
    const empty = { areas: [], paths: [], rails: [], waterways: [], lines: [], runs: [], buildings: [], trees: [], stops: [], billboards: [], shops: [], fences: [], pts: [] };
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

  // Полотно улиц: узлы сетки рельефа у дороги ставятся на её продольный профиль — исходный рельеф по
  // оси, сглаженный вдоль дороги на ±GRADE_SMOOTH м. Поперёк дорога ровная, а площадки под домами
  // (#levelUnderBuildings) не задирают её горбом: узел сетки 15 м тянет за собой треугольники и под
  // улицей. До GRADE_PAD м от края — ровно по профилю, дальше за GRADE_FALL м — к своему рельефу.
  // Узел у нескольких дорог — к средней их высоте с весом по близости. Мосты не трогаем.
  #gradeRoads() {
    const GRADE_SMOOTH = 40, GRADE_STEP = 5, GRADE_FALL = 15;
    const PIN_FLAT = 7.5, PIN_BEND = 15, PIN_EASE = 40; // м: примыкание (см. ниже)
    const GRADE_PAD = { service: 6, living_street: 6 };
    const { h, nx, nz, dx, dz, xmin, zmin } = this.mesh;
    const sumK = new Float32Array(h.length), sumH = new Float32Array(h.length), maxW = new Float32Array(h.length);
    const graded = [], atNode = new Map(); // узел OSM → [{ g, s }]
    for (const road of this.roads) {
      if (road.br) continue;
      const pts = road.n.map((i) => this.nodes[i]), acc = [0];
      for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const L = acc[acc.length - 1];
      if (!(L > 0)) continue;
      // Профиль: рельеф через GRADE_STEP м по оси и скользящее среднее.
      const N = Math.ceil(L / GRADE_STEP) + 1, st = L / (N - 1), raw = new Float64Array(N), xz = new Float64Array(N * 4);
      for (let k = 0, i = 1; k < N; k++) {
        const s = k * st;
        while (i < pts.length - 1 && acc[i] < s) i++;
        const l = acc[i] - acc[i - 1] || 1, t = (s - acc[i - 1]) / l;
        const x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, z = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t;
        xz.set([x, z, (pts[i][0] - pts[i - 1][0]) / l, (pts[i][1] - pts[i - 1][1]) / l], k * 4);
        raw[k] = this.baseTerrain(x, z);
      }
      // Окно симметричное и к концам сужается: на конце профиль — рельеф в точке (продолжение той же
      // улицы стыкуется без ступеньки).
      const m = Math.round(GRADE_SMOOTH / st), pre = new Float64Array(N + 1), prof = new Float64Array(N);
      for (let k = 0; k < N; k++) pre[k + 1] = pre[k] + raw[k];
      for (let k = 0; k < N; k++) {
        const r = Math.min(m, k, N - 1 - k), a = k - r, b = k + r;
        prof[k] = (pre[b + 1] - pre[a]) / (b - a + 1);
      }
      const profAt = (s) => {
        const f = Math.min(Math.max(s / st, 0), N - 1), k = Math.min(Math.floor(f), N - 2);
        return N < 2 ? prof[0] : prof[k] + (prof[k + 1] - prof[k]) * (f - k);
      };
      const g = { road, pts, acc, st, xz, prof, profAt, rank: roadLift(road.k), pad: road.w / 2 + (GRADE_PAD[road.k.replace('_link', '')] ?? TERRAIN_SEG) };
      graded.push(g);
      road.n.forEach((id, i) => {
        const e = atNode.get(id);
        if (e) e.push({ g, s: acc[i] }); else atNode.set(id, [{ g, s: acc[i] }]);
      });
    }
    // Две проезжие части одной улицы (встречные, параллельно, той же важности, между краями не больше
    // TWIN_GAP м) — общий профиль, средний из двух: иначе на склоне рельеф между ними тянул каждую к
    // соседке, и обе кренились внутрь. Чем шире зазор (больше TWIN_FULL м), тем слабее: разнесённые
    // (трамвай посередине) на склоне и правда на разной высоте, и полное среднее сдвигало каждую на метр.
    // Попутная — это продолжение той же проезжей части, не пара. Точки профилей — в сетке CELL м.
    // Проезжие части в OSM — односторонние линии, среди них и ищем.
    const TWIN_GAP = 16, TWIN_FULL = 4, CELL = 40, grid = new Map(), key = (x, z) => Math.floor(x / CELL) * 65536 + Math.floor(z / CELL);
    const oneway = graded.filter((g) => g.road.ow);
    for (const g of oneway) {
      for (let k = 0; k < g.prof.length; k++) {
        const c = key(g.xz[k * 4], g.xz[k * 4 + 1]), e = grid.get(c);
        if (e) e.push(g, k); else grid.set(c, [g, k]);
      }
    }
    // Сдвиг к среднему сглаживается вдоль дороги (±TWIN_EASE м): где пара начинается и кончается — без ступеньки.
    const TWIN_EASE = 25;
    const twinFix = oneway.map((g) => {
      const N = g.prof.length, xz = g.xz, fix = new Float64Array(N), lim0 = (g.road.w / 2 + TWIN_GAP) ** 2;
      for (let k = 0; k < N; k++) {
        const x = xz[k * 4], z = xz[k * 4 + 1], ux = xz[k * 4 + 2], uz = xz[k * 4 + 3];
        let best = null, bd = Infinity, bw = 0;
        for (let a = -1; a <= 1; a++) {
          for (let b = -1; b <= 1; b++) {
            const e = grid.get(key(x + a * CELL, z + b * CELL));
            for (let q = 0; e && q < e.length; q += 2) {
              const o = e[q];
              if (o === g || o.rank !== g.rank) continue;
              const j = e[q + 1] * 4, ox = o.xz[j] - x, oz = o.xz[j + 1] - z, d2 = ox * ox + oz * oz;
              const lim = (Math.sqrt(lim0) + o.road.w / 2) ** 2;
              if (d2 >= bd || d2 >= lim) continue;
              const dot = ux * o.xz[j + 2] + uz * o.xz[j + 3], along = ox * ux + oz * uz;
              if (dot > -0.9 || along * along > d2 * 0.25) continue;
              if (g.road.name && o.road.name && g.road.name !== o.road.name) continue;
              // Высота соседки точно напротив, а не в её ближайшей точке: та бывает впереди на полшага, на уклоне — дециметры.
              bd = d2; best = o.profAt(e[q + 1] * o.st + along);
              bw = Math.min(1, Math.max(0, 1 - (Math.sqrt(d2) - (g.road.w + o.road.w) / 2 - TWIN_FULL) / (TWIN_GAP - TWIN_FULL)));
            }
          }
        }
        if (best !== null) fix[k] = ((best - g.prof[k]) / 2) * bw;
      }
      const m = Math.round(TWIN_EASE / g.st), pre = new Float64Array(N + 1), out = new Float64Array(N);
      for (let k = 0; k < N; k++) pre[k + 1] = pre[k] + fix[k];
      for (let k = 0; k < N; k++) {
        const a = Math.max(0, k - m), b = Math.min(N - 1, k + m);
        out[k] = (pre[b + 1] - pre[a]) / (b - a + 1);
      }
      return out;
    });
    oneway.forEach((g, i) => { for (let k = 0; k < g.prof.length; k++) g.prof[k] += twinFix[i][k]; });
    // Примыкание к более важной улице: второстепенная у её края (полуширина + PIN_FLAT) идёт вровень
    // с ней, за PIN_BEND м плавно выходит на свой уклон, а разница высот с главной сходит за PIN_EASE м.
    // Иначе на склоне главная перекашивалась поперёк (узлы под ней тянула примыкающая), а отдать узлы
    // главной — ступенька на второстепенной; ровно на всю клетку сетки — излом, где она догоняет свой уклон.
    // Важные первыми: их профиль к этому времени окончательный.
    graded.sort((a, b) => b.rank - a.rank);
    for (const g of graded) {
      // Для каждой точки — ближайшее примыкание: [расстояние, высота главной, сдвиг своего профиля].
      const join = new Array(g.prof.length).fill(null);
      g.road.n.forEach((id, i) => {
        for (const o of atNode.get(id)) {
          if (o.g.rank <= g.rank + 1e-3) continue;
          const y = o.g.profAt(o.s), d0 = o.g.road.w / 2 + PIN_FLAT;
          for (let k = 0; k < g.prof.length; k++) {
            const d = Math.abs(k * g.st - g.acc[i]) - d0;
            if (d < PIN_EASE && (!join[k] || d < join[k][0])) join[k] = [d, y, y - g.profAt(g.acc[i])];
          }
        }
      });
      const ss = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
      for (let k = 0; k < g.prof.length; k++) {
        if (!join[k]) continue;
        const [d, y, shift] = join[k], own = g.prof[k] + shift * (1 - ss(d / PIN_EASE));
        g.prof[k] = y + (own - y) * ss(d / PIN_BEND);
      }
    }
    // Узлы сетки в R м от отрезков дороги: fn(n, d, s) — номер узла, расстояние до оси, метр профиля.
    const near = ({ pts, acc }, R, fn) => {
      for (let k = 1; k < pts.length; k++) {
        const [ax, az] = pts[k - 1], [bx, bz] = pts[k], sx = bx - ax, sz = bz - az, l2 = sx * sx + sz * sz || 1;
        const i0 = Math.max(0, Math.ceil((Math.min(ax, bx) - R - xmin) / dx)), i1 = Math.min(nx, Math.floor((Math.max(ax, bx) + R - xmin) / dx));
        const j0 = Math.max(0, Math.ceil((Math.min(az, bz) - R - zmin) / dz)), j1 = Math.min(nz, Math.floor((Math.max(az, bz) + R - zmin) / dz));
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const x = xmin + i * dx - ax, z = zmin + j * dz - az; // как World.closest, без объекта на узел
            const t = Math.min(1, Math.max(0, (x * sx + z * sz) / l2)), ex = x - sx * t, ez = z - sz * t, d2 = ex * ex + ez * ez;
            if (d2 < R * R) fn(j * (nx + 1) + i, Math.sqrt(d2), acc[k - 1] + (acc[k] - acc[k - 1]) * t);
          }
        }
      }
    };
    // Узлы у самого полотна важной улицы держит она (второстепенная там с ней вровень, см. выше): в PIN_FLAT м
    // от края — от всех, кто ниже её, на всю клетку сетки — от дворовых проездов. Узел за 7,5 м ещё тянет
    // треугольники под проезжей частью, и проезд на склоне в 15 м от неё задирал её край на полметра; на
    // проезде ступенька не так заметна, а улице рядом широкая зона дала бы ступеньку (Профсоюзный у Совхозной).
    const own = new Float32Array(h.length), ownYard = new Float32Array(h.length);
    for (const g of graded) {
      near(g, g.road.w / 2 + PIN_FLAT, (n) => { if (g.rank > own[n]) own[n] = g.rank; });
      near(g, g.road.w / 2 + TERRAIN_SEG, (n) => { if (g.rank > ownYard[n]) ownYard[n] = g.rank; });
    }
    for (const g of graded) {
      const yard = GRADE_PAD[g.road.k.replace('_link', '')] !== undefined;
      near(g, g.pad + GRADE_FALL, (n, d, s) => {
        if (g.rank < (yard ? ownYard[n] : own[n]) - 1e-3) return;
        // Важная улица весит больше: соседняя улица ниже рангом в 15 м сбоку не прогибает её край.
        const wt = d <= g.pad ? 1 : 1 - (d - g.pad) / GRADE_FALL, kk = ((wt * wt) / (1 + d) ** 3) * Math.exp(20 * g.rank);
        sumK[n] += kk;
        sumH[n] += kk * g.profAt(s);
        if (wt > maxW[n]) maxW[n] = wt;
      });
    }
    for (let n = 0; n < h.length; n++) if (maxW[n] > 0) h[n] += (sumH[n] / sumK[n] - h[n]) * maxW[n];
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

  // Точка на оси дороги r в s м от её начала.
  #pointAt(r, s) {
    const p = r.n.map((i) => this.nodes[i]);
    for (let i = 1; i < p.length; i++) {
      const L = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
      if (s <= L || i === p.length - 1) {
        const t = L ? Math.min(1, s / L) : 0;
        return [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t];
      }
      s -= L;
    }
    return p[0];
  }

  // Рельеф без насыпей подъездов (h0).
  #bare(x, z) {
    return this.mesh.h0 ? this.terrain(x, z) - this.meshTerrain(x, z) + this.meshTerrain(x, z, this.mesh.h0) : this.terrain(x, z);
  }

  // Длина подъезда r к ровному мосту (fit) и земля в его конце (end): если за RAMP м от моста
  // ложбина (рельеф ниже и настила, и земли дальше по улице), подъезд тянется через неё до бровки.
  #fitLevelRamp(road, r) {
    const STEP = 2, MAX = 100, DIP = 0.15, DEEP = 3;
    const L = road.len ?? this.#roadLen(road), D = Math.min(MAX, L - (r.off ?? 0));
    const at = (d) => this.#pointAt(road, r.from === 0 ? d : L - d);
    const t = [];
    for (let d = 0; d <= D; d += STEP) t.push(this.#bare(...at(d)));
    let fit = r.len, top = -Infinity, last = -1, deep = 0;
    for (let i = t.length - 1; i >= 0; i--) {
      top = Math.max(top, t[i]);
      const fill = Math.min(r.y, top) - t[i];
      if (fill > DIP && last < 0) last = i;
      if (last >= 0) deep = Math.max(deep, fill);
    }
    // Глубокий овраг — не засыпается (там мост длиннее, чем в OSM, или настоящий спуск).
    if (last >= 0 && deep <= DEEP) fit = Math.max(fit, Math.min(D, (last + 1) * STEP));
    r.fit = fit;
    r.end = this.#bare(...at(fit)) + road.lift;
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
    // Ровные мосты через реку вплотную друг к другу (две проезжие части, концы разные — не парные) — одной высоты,
    // по верхнему: иначе между ними ступенька (север плотины у Новоажимова: 91,36 и 91,62).
    const river = this.roads.filter((r) => r.br && r.cx?.some((c) => c[2] === 'w'));
    const level = new Map(river.map((r) => {
      const a = this.nodes[r.n[0]], b = this.nodes[r.n[r.n.length - 1]];
      return [r, (this.baseTerrain(...a) + this.baseTerrain(...b)) / 2];
    }));
    for (const a of river) {
      for (const b of river) {
        if (a !== b && this.#alongside(a.n.map((i) => this.nodes[i]), a.w, b)) level.set(a, level.set(b, Math.max(level.get(a), level.get(b))).get(b));
      }
    }
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
        y0 = y1 = level.get(road);
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
    this.#raiseAlongDecks();
  }

  // Ломаная p шириной w идёт вплотную вдоль дороги road (параллельно, щель между краями до 3 м) хоть где-то.
  #alongside(p, w, road) {
    const q = road.n.map((i) => this.nodes[i]);
    for (let k = 1; k < p.length; k++) {
      const [ax, az] = p[k - 1], [bx, bz] = p[k], L = Math.hypot(bx - ax, bz - az);
      if (L < 0.5) continue;
      for (let d = 0; d <= L; d += 4) {
        const x = ax + ((bx - ax) * d) / L, z = az + ((bz - az) * d) / L;
        for (let m = 1; m < q.length; m++) {
          const s = { ax: q[m - 1][0], az: q[m - 1][1], bx: q[m][0], bz: q[m][1] }, ex = s.bx - s.ax, ez = s.bz - s.az, l = Math.hypot(ex, ez);
          if (l < 0.5 || Math.abs((bx - ax) * ex + (bz - az) * ez) / (L * l) < 0.9) continue;
          const u = ((x - s.ax) * ex + (z - s.az) * ez) / (l * l);
          if (u < 0 || u > 1) continue;
          const gap = Math.abs((x - s.ax) * ez - (z - s.az) * ex) / l - road.w / 2 - w / 2;
          if (gap >= -1 && gap <= 3) return true;
        }
      }
    }
    return false;
  }

  // Дорога или тротуар вплотную вдоль ровного моста (не сами мосты): в OSM мост одной проезжей части бывает длиннее
  // моста соседней — на севере плотины у Новоажимова восточная часть мостом до самого конца, западная за своим мостом
  // идёт по рельефу, а он там (DEM без насыпи плотины) — овраг: дорога ныряла на 1,5 м ниже соседней, тротуар — на 3.
  // На деле это один слой асфальта. Узлы сетки под ними и между ними и мостом подводятся под настил (рельеф + lift =
  // настил; и вверх, и вниз — конец ровного моста бывает зарыт в склон); ровно — на клетку сетки за край (иначе
  // треугольник с неподнятым узлом провисает), дальше откос. Разница больше LIM м — дорога внизу у опоры, не трогаем.
  #raiseAlongDecks() {
    const FLAT = TERRAIN_SEG, FALL = TERRAIN_SEG, GAP = 3, LIM = 3.5;
    const { h, nx, nz, dx, dz, xmin, zmin } = this.mesh;
    const decks = this.segments.filter((s) => s.road.br && s.ya !== undefined && s.road.cx?.some((c) => c[2] === 'w'));
    if (!decks.length) return;
    // Два моста вплотную друг к другу — стороны друг к другу открыты (общий асфальт, без борта и ограждения).
    for (const s of decks) {
      const ex = s.bx - s.ax, ez = s.bz - s.az;
      for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        const x = s.ax + ex * f, z = s.az + ez * f;
        const t = decks.find((t) => {
          if (t.road === s.road) return false;
          const fx = t.bx - t.ax, fz = t.bz - t.az;
          if (Math.abs(ex * fx + ez * fz) / (s.len * t.len) < 0.9) return false;
          const u = ((x - t.ax) * fx + (z - t.az) * fz) / (t.len * t.len), gap = this.#perp(t, x, z) - t.w / 2 - s.w / 2;
          return u >= 0 && u <= 1 && gap >= -1 && gap <= GAP;
        });
        if (!t) continue;
        const c = World.closest(t, x, z);
        s.open = Math.sign((c.px - s.ax) * -ez + (c.pz - s.az) * ex) || 1;
        break;
      }
    }
    const inside = (x, z, p) => {
      let ins = false;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) ins = !ins;
      }
      return ins;
    };
    const water = (this.city.areas || []).filter((a) => a.k === 'water').map((a) => {
      const xs = a.p.map((q) => q[0]), zs = a.p.map((q) => q[1]);
      return { ...a, bb: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] };
    });
    const wet = (x, z) => water.some((a) => x >= a.bb[0] && x <= a.bb[2] && z >= a.bb[1] && z <= a.bb[3]
      && inside(x, z, a.p) && !(a.holes || []).some((hp) => inside(x, z, hp)));
    const lines = [
      ...this.roads.filter((r) => !r.br).map((r) => ({ p: r.n.map((i) => this.nodes[i]), w: r.w, road: true })),
      ...(this.city.paths || []).filter((p) => !p.br).map((p) => ({ p: p.p, w: p.w })),
    ];
    for (const { p, w, road } of lines) {
      // Точки линии через 2 м; у идущих вдоль настила — высота настила напротив.
      const pts = [];
      for (let k = 1; k < p.length; k++) {
        const [ax, az] = p[k - 1], [bx, bz] = p[k], L = Math.hypot(bx - ax, bz - az);
        if (L < 0.5) continue;
        const tx = (bx - ax) / L, tz = (bz - az) / L;
        for (let d = 0; d < L; d += 2) {
          const x = ax + tx * d, z = az + tz * d;
          let y = null, ext = false;
          for (const s of decks) {
            if (Math.abs(x - s.ax) > 60 && Math.abs(x - s.bx) > 60) continue;
            const ex = s.bx - s.ax, ez = s.bz - s.az;
            if (Math.abs(tx * ex + tz * ez) / s.len < 0.9) continue;
            // За концом моста (не к соседнему отрезку) — ещё клетка сетки на высоте конца: иначе у конца ступенька.
            const u = ((x - s.ax) * ex + (z - s.az) * ez) / (s.len * s.len), e = FLAT / s.len;
            if (u < (s.i === 1 ? -e : 0) || u > (s.i === s.road.n.length - 1 ? 1 + e : 1)) continue;
            const gap = this.#perp(s, x, z) - s.w / 2 - w / 2;
            if (gap < -1 || gap > GAP) continue;
            const v = s.ya + (s.yb - s.ya) * Math.min(1, Math.max(0, u)) - s.road.lift;
            if (Math.abs(v - this.meshTerrain(x, z)) < LIM) {
              y = v; ext = u < 0 || u > 1;
              // Сторона моста к примыкающей проезжей части — без борта и ограждения (deckOpen).
              if (road && !ext) s.open = Math.sign((x - s.ax) * -ez + (z - s.az) * ex) || 1;
            }
            break;
          }
          pts.push({ x, z, y, ext });
        }
      }
      // Только у торца моста — не вдоль него: не трогаем.
      if (!pts.some((q) => q.y !== null && !q.ext)) continue;
      const on = pts.filter((q) => q.y !== null);
      const R = w / 2 + FLAT + FALL;
      const xs = on.map((q) => q.x), zs = on.map((q) => q.z);
      const i0 = Math.max(0, Math.floor((Math.min(...xs) - R - xmin) / dx)), i1 = Math.min(nx, Math.ceil((Math.max(...xs) + R - xmin) / dx));
      const j0 = Math.max(0, Math.floor((Math.min(...zs) - R - zmin) / dz)), j1 = Math.min(nz, Math.ceil((Math.max(...zs) + R - zmin) / dz));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = xmin + i * dx, z = zmin + j * dz;
          // Ближайшая точка всей линии должна быть из участка вдоль моста: за его концами — пролёт соседнего моста над
          // оврагом, его не засыпаем.
          let best = null;
          for (const q of pts) { const d = Math.hypot(x - q.x, z - q.z); if (!best || d < best.d) best = { d, q }; }
          if (best.q.y === null) continue;
          // За концом самой линии (ближайшая — крайняя точка, проекция наружу) — тоже нет.
          const e = best.q === pts[0] ? [pts[0], pts[1]] : best.q === pts[pts.length - 1] ? [pts[pts.length - 1], pts[pts.length - 2]] : null;
          if (e && e[1] && (x - e[0].x) * (e[0].x - e[1].x) + (z - e[0].z) * (e[0].z - e[1].z) > 0) continue;
          const lat = best.d - w / 2;
          if (lat >= FLAT + FALL || wet(x, z)) continue; // русло под мостом не засыпаем
          const wt = lat <= FLAT ? 1 : 0.5 + 0.5 * Math.cos((Math.PI * (lat - FLAT)) / FALL), n = j * (nx + 1) + i;
          h[n] += (best.q.y - h[n]) * wt;
        }
      }
    }
  }

  // Насыпь под подъездами к путепроводам и ровным мостам — настоящий рельеф, а не только откосы-картинка: между
  // проезжими частями двухпутной улицы иначе остаётся яма до земли, и машина в неё падает.
  // Узлы сетки в EMB_FLAT м от края полотна поднимаются под самое полотно (полоса и трамвайные пути
  // между проезжими частями — вровень), дальше — откос до EMB_FALL.
  #raiseRampEmbankments() {
    const EMB_FLAT = 7, EMB_FALL = 19;
    const { h, nx, nz, dx, dz, xmin, zmin } = this.mesh;
    const h0 = (this.mesh.h0 = h.slice());
    for (const road of this.roads) {
      if (!road.ramp) continue;
      const quad = road.ramp.some((r) => r.quad);
      const pts = road.n.map((i) => this.nodes[i]), acc = [0];
      // Концы, которыми дорога примыкает к мосту: за них (под пролёт) насыпь не заходит — там
      // нижняя дорога или рельсы.
      const stops = road.ramp.filter((r) => !r.off).map(({ from }) => {
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
          // Высота насыпи над исходной землёй у оси (у путепровода на 0.3 м ниже полотна, чтобы не
          // проступала; у ровного моста — вровень, как земля у обычной улицы).
          const rise = y - road.lift - (quad ? 0.3 : 0) - this.meshTerrain(best.px, best.pz, h0);
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
    for (let k = 0; k < road.ramp.length; k++) {
      const r = road.ramp[k], { from, y: deck, quad, off = 0 } = r;
      if (!quad && r.end === undefined) this.#fitLevelRamp(road, r);
      const Lr = quad ? r.len : r.fit, d = off + (from === 0 ? s : road.len - s);
      // Подъезд к путепроводу: парабола, у моста её уклон равен уклону настила (без излома).
      if (d >= Lr) continue;
      // Подъезд считается от рельефа до насыпи (h0), иначе насыпь поднимала бы сама себя.
      const t = this.#bare(x, z) + road.lift, w = quad ? (1 - d / Lr) ** 2 : 0.5 + 0.5 * Math.cos((Math.PI * d) / Lr);
      let v = t + (deck + road.lift - t) * w;
      // Подъезд к ровному мосту не ныряет в ложбину у берега: не ниже прямой от настила до земли
      // в конце подъезда (под ним — насыпь, #raiseRampEmbankments).
      if (!quad) v = Math.max(v, deck + road.lift + (r.end - deck - road.lift) * (d / Lr));
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

  // Покрытие под точкой: 'road' — полотно дороги, 'dirt' — грунтовка (surface=unpaved… в OSM, sf у дороги),
  // 'paved' — площадь, парковка, промзона, беговая дорожка; иначе 'ground' (трава, парк, лес, пустырь) — там едется тяжело.
  surfaceAt(x, z) {
    let dirt = false;
    for (const s of this.nearbyRoadSegments(x, z)) {
      const d = World.closest(s, x, z).d;
      if (d < s.w / 2 + 0.4) {
        if (!s.road.sf) return 'road';
        dirt = true; // грунтовка; асфальт поверх (перекрёсток с улицей) — всё же дорога
        continue;
      }
    }
    if (dirt) return 'dirt';
    if (this.walks.at(x, z) > -Infinity) return 'paved';
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
    // У одной дороги — ближайший отрезок, как в roadY: у соседнего ближайшая точка прижата к его концу, и на уклоне
    // (горб путепровода, подъезд) колесо полширины дороги ехало по высоте узла, а потом обрывалось — лестница.
    // Торец чужой дороги (за концом моста — над подъездом) не в счёт, если точку накрывает дорога вдоль себя.
    const own = new Map();
    for (const s of this.nearbyRoadSegments(x, z)) {
      const c = World.closest(s, x, z);
      if (c.d > s.w / 2 + 0.3) continue;
      const v = this.#segY(s, c, x, z, t);
      if (v > lim) continue;
      const o = own.get(s.road);
      if (!o || c.d < o.d) own.set(s.road, { d: c.d, v, cap: (c.t === 0 || c.t === 1) && c.d > this.#perp(s, x, z) + 0.05 });
    }
    const inside = [...own.values()].some((o) => !o.cap);
    for (const o of own.values()) if (!inside || !o.cap) y = Math.max(y, o.v);
    const m = this.medianY(x, z);
    if (m !== null && m <= lim) y = Math.max(y, m);
    y = Math.max(y, this.walks.at(x, z, lim)); // тротуары и дорожки (walks.js)
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
    return y > t ? y + this.bumpAt(x, z) : y;
  }

  // Лежачие полицейские рядом: клетка сетки BUMP_CELL.
  #bumpsNear(x, z) {
    return this.bumpGrid.get(Math.floor(x / BUMP_CELL) * 100003 + Math.floor(z / BUMP_CELL)) || [];
  }

  // Высота лежачего полицейского над полотном в точке (0 — не на нём). Профиль — полусинус, у площадки — пандусы.
  bumpAt(x, z) {
    let best = 0;
    for (const b of this.#bumpsNear(x, z)) {
      const rx = x - b.x, rz = z - b.z, s = Math.abs(rx * b.dx + rz * b.dz), lat = Math.abs(rx * b.dz - rz * b.dx);
      const [L, h] = BUMP[b.k];
      if (s >= L / 2 || lat > b.w / 2) continue;
      const v = b.k === 2 ? h * Math.min(1, (L / 2 - s) / BUMP_RAMP) : h * Math.cos((Math.PI * s) / L);
      best = Math.max(best, v);
    }
    return best;
  }

  // Переехал ли отрезок (x0, z0) → (x1, z1) лежачий полицейский: вид или -1.
  bumpCross(x0, z0, x1, z1) {
    for (const b of this.#bumpsNear(x1, z1)) {
      const s0 = (x0 - b.x) * b.dx + (z0 - b.z) * b.dz, s1 = (x1 - b.x) * b.dx + (z1 - b.z) * b.dz;
      if (Math.sign(s0) === Math.sign(s1) || Math.abs(s0 - s1) > 5) continue;
      if (Math.abs((x1 - b.x) * b.dz - (z1 - b.z) * b.dx) <= b.w / 2 + 0.5) return b.k;
    }
    return -1;
  }

  // Расстояние до лежачего полицейского впереди по курсу (dx, dz) не дальше look м, иначе Infinity (для трафика).
  bumpAhead(x, z, dx, dz, look) {
    let best = Infinity;
    for (const [px, pz] of [[x, z], [x + dx * look, z + dz * look]]) {
      for (const b of this.#bumpsNear(px, pz)) {
        const rx = b.x - x, rz = b.z - z, ahead = rx * dx + rz * dz;
        if (ahead > -1 && ahead < look && Math.abs(rx * dz - rz * dx) < b.w / 2 + 1) best = Math.min(best, Math.max(0, ahead));
      }
    }
    return best;
  }

  // Знак «Уступи дорогу»/STOP впереди по курсу в пределах look м: { y, d } — знак и расстояние до его линии, или null.
  // Знак — для едущих в его сторону (курс вдоль ux, uz) и в пределах полотна.
  yieldAhead(x, z, dx, dz, look) {
    let best = null;
    for (const y of this.yields) {
      const rx = y.x - x, rz = y.z - z;
      if (Math.abs(rx) > look + 5 || Math.abs(rz) > look + 5 || dx * y.ux + dz * y.uz < 0.7) continue;
      const ahead = rx * y.ux + rz * y.uz;
      if (ahead > -1 && ahead < look && Math.abs(rx * y.uz - rz * y.ux) < y.w / 2 + 1 && (!best || ahead < best.d)) best = { y, d: ahead };
    }
    return best;
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
      return p.cross ? { s: p.s, y: Math.max(p.y, y), road: p.y, bed: false, cross: true, gx: 0, gz: 0 } : { s: p.s, y, bed: p.bed, cross: false, gx, gz };
    });
    // На переезде рельсы — в асфальте: от края полотна за TRAM_XEASE м опускаются с прямой на асфальт
    // (прямая над серединой перекрёстка на склоне висела над дорогой на полметра).
    for (let i = 0; i < P.length; i++) {
      if (!P[i].cross) continue;
      let dc = Infinity;
      for (let j = i - 1; j >= 0 && dc === Infinity; j--) if (!P[j].cross) dc = P[i].s - P[j].s;
      for (let j = i + 1; j < P.length; j++) if (!P[j].cross) { dc = Math.min(dc, P[j].s - P[i].s); break; }
      P[i].y = P[i].road + (P[i].y - P[i].road) * Math.max(0, 1 - dc / TRAM_XEASE);
    }
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
    // Край полотна не выше асфальта сразу за ним: у перекрёстка рядом с полотном асфальт другой улицы,
    // а плоскость считается по параллельным проезжим частям — на склоне полотно вставало над ним бортом.
    // Сдвиг края сглажен вдоль пути (±TRAM_EDGE_WIN точек), чтобы не было ступеньки.
    const rp = this.city.rails[ri].p, at = [];
    for (let i = 1, s0 = 0; i < rp.length; i++) {
      const L = Math.hypot(rp[i][0] - rp[i - 1][0], rp[i][1] - rp[i - 1][1]);
      at.push([s0, L, rp[i - 1], rp[i]]); s0 += L;
    }
    const asph = (x, z) => {
      let y = null;
      for (const q of this.nearbyRoadSegments(x, z)) {
        if (q.ya !== undefined || q.road.ramp || q.road.hump) continue;
        const c = World.closest(q, x, z);
        if (c.d <= q.w / 2) y = Math.max(y ?? -Infinity, this.#segY(q, c, x, z, this.terrain(x, z)));
      }
      return y;
    };
    const cut = P.map((p) => {
      if (!p.bed) return null;
      const e = at.find(([s0, L]) => p.s <= s0 + L) ?? at[at.length - 1], [s0, L, [ax, az], [bx, bz]] = e;
      if (!(L > 0)) return null;
      const dx = (bx - ax) / L, dz = (bz - az) / L, t = p.s - s0, x = ax + dx * t, z = az + dz * t, nx = -dz, nz = dx;
      const side = (w) => {
        const ey = p.y + (p.gx * nx + p.gz * nz) * w, a = asph(x + nx * (w + 0.6), z + nz * (w + 0.6));
        return a === null ? 0 : Math.min(0, a + TRAM_ABOVE - ey);
      };
      return [side(p.wl), side(-p.wr)];
    });
    const sm = (k, i) => {
      let v = 0;
      for (let j = Math.max(0, i - TRAM_EDGE_WIN); j <= Math.min(P.length - 1, i + TRAM_EDGE_WIN); j++) if (cut[j]) v = Math.min(v, cut[j][k]);
      return v;
    };
    const dl = P.map((_, i) => sm(0, i)), dr = P.map((_, i) => sm(1, i));
    P.forEach((p, i) => {
      if (!p.bed || (!dl[i] && !dr[i])) return;
      const e = at.find(([s0, L]) => p.s <= s0 + L) ?? at[at.length - 1], [, L, [ax, az], [bx, bz]] = e;
      const nx = -(bz - az) / (L || 1), nz = (bx - ax) / (L || 1), g0 = p.gx * nx + p.gz * nz;
      const yl = p.y + g0 * p.wl + dl[i], yr = p.y - g0 * p.wr + dr[i], g = (yl - yr) / (p.wl + p.wr);
      p.y = yr + g * p.wr; p.gx = g * nx; p.gz = g * nz;
    });
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

  // Высота полотна отрезка дороги s в точке (c — World.closest(s, x, z)).
  segY(s, c, x, z) { return this.#segY(s, c, x, z, this.terrain(x, z)); }

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
        const vtop = Math.max(...b.p.map(([x, z]) => this.terrain(x, z))) + b.h; // так крышу рисует build.js
        const rb = { p: b.p, holes: b.holes, top, vtop, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
        for (let i = Math.floor(rb.x0 / ROOF_CELL); i <= Math.floor(rb.x1 / ROOF_CELL); i++) {
          for (let j = Math.floor(rb.z0 / ROOF_CELL); j <= Math.floor(rb.z1 / ROOF_CELL); j++) {
            const k = i * 100003 + j;
            (this.roofGrid.get(k) || this.roofGrid.set(k, []).get(k)).push(rb);
          }
        }
      }
    }
    // Заборы — тоже стены (проёмы под ворота и дороги вырезаны при сборке). Лёгкие (SOFT_FENCES) машину
    // не держат — их сносит breakables.js, здесь они только для расстановки (soft в collide); кусты — так же, без сноса.
    for (const f of this.city.fences || []) {
      const soft = SOFT_FENCES.has(f.k) || PASS_FENCES.has(f.k);
      for (let i = 1; i < f.p.length; i++) {
        const a = f.p[i - 1], c = f.p[i];
        const top = Math.max(this.terrain(a[0], a[1]), this.terrain(c[0], c[1])) + f.h;
        this.#insert(this.bGrid, this.bCell, { ax: a[0], az: a[1], bx: c[0], bz: c[1], soft, top, fence: true }, 0);
      }
    }
  }

  // Мелочи из OSM на дорогах и рядом — точки для квадратов (props.js): лежачие полицейские, переходы, знаки,
  // шлагбаумы; высокое (трубы, мачты, опоры ЛЭП, краны), провода, столбики, детские площадки.
  // Точку на дороге (индекс узла) — на самую широкую дорогу через узел: направление — по соседним узлам.
  #initPoints() {
    const c = this.city, at = new Map(); // узел → [[дорога, номер узла в ней]]
    for (const r of this.roads) r.n.forEach((n, i) => (at.get(n) || at.set(n, []).get(n)).push([r, i]));
    const degree = (n) => (at.get(n) || []).reduce((k, [r, i]) => k + (i === 0 || i === r.n.length - 1 ? 1 : 2), 0);
    const onRoad = (n) => {
      const list = at.get(n);
      if (!list) return null;
      const [r, i] = list.reduce((a, b) => (b[0].w > a[0].w ? b : a));
      const [ax, az] = this.nodes[r.n[Math.max(0, i - 1)]], [bx, bz] = this.nodes[r.n[Math.min(r.n.length - 1, i + 1)]];
      const L = Math.hypot(bx - ax, bz - az) || 1;
      const [x, z] = this.nodes[n];
      return { x, z, dx: (bx - ax) / L, dz: (bz - az) / L, w: r.w, road: r, i };
    };
    // Знак справа по ходу (dir — вдоль линии или против), за back м до точки, лицом к едущему.
    const signs = [];
    const sign = (p, s, dir) => {
      const ux = p.dx * dir, uz = p.dz * dir, back = SIGN_BACK[s], off = p.w / 2 + SIGN_SIDE;
      signs.push({ t: 'sign', s, x: p.x - ux * back - uz * off, z: p.z - uz * back + ux * off, a: Math.atan2(-ux, -uz) });
    };
    const both = (p, s) => { sign(p, s, 1); if (!p.road.ow) sign(p, s, -1); };
    // До ближайшего перекрёстка вдоль дороги в сторону dir, м (дальше 300 — не ищем).
    const toJunction = (p, dir) => {
      const r = p.road;
      let d = 0;
      for (let i = p.i + dir; i >= 0 && i < r.n.length && d < 300; i += dir) {
        const [ax, az] = this.nodes[r.n[i - dir]], [bx, bz] = this.nodes[r.n[i]];
        d += Math.hypot(bx - ax, bz - az);
        if (degree(r.n[i]) >= 3) return d;
      }
      return Infinity;
    };
    this.points = [];
    this.bumpGrid = new Map();
    for (const [n, k] of c.bumps || []) {
      const p = onRoad(n);
      if (!p) continue;
      const b = { t: 'bump', k, ...p };
      this.points.push(b);
      both(p, 'b');
      const pad = BUMP[k][0] / 2 + b.w / 2;
      for (let i = Math.floor((b.x - pad) / BUMP_CELL); i <= Math.floor((b.x + pad) / BUMP_CELL); i++) {
        for (let j = Math.floor((b.z - pad) / BUMP_CELL); j <= Math.floor((b.z + pad) / BUMP_CELL); j++) {
          const key = i * 100003 + j;
          (this.bumpGrid.get(key) || this.bumpGrid.set(key, []).get(key)).push(b);
        }
      }
    }
    for (const n of c.zebras || []) {
      const p = onRoad(n);
      if (!p || p.road.br) continue;
      this.points.push({ t: 'zebra', ...p });
      both(p, 'z');
    }
    // «Уступи дорогу» (g) и STOP (s) — ещё и правило для трафика и игрока (yieldAhead, yields.js): линия у точки
    // знака поперёк дороги, для едущих по ux, uz.
    this.yields = [];
    for (const [n, s, dir] of c.signs || []) {
      const p = onRoad(n);
      if (!p) continue;
      // Направление не размечено — знак для тех, кто едет к ближайшему перекрёстку.
      const d = dir || (toJunction(p, 1) <= toJunction(p, -1) ? 1 : -1);
      sign(p, s, d);
      if (!p.road.br) this.yields.push({ s, x: p.x, z: p.z, ux: p.dx * d, uz: p.dz * d, w: p.w, ow: p.road.ow });
    }
    for (const n of c.gates || []) {
      const p = onRoad(n);
      if (p && !p.road.br) this.points.push({ t: 'gate', ...p });
    }
    this.points.push(...signs);
    const towerAt = new Map();
    for (const [x, z, k, a, h] of c.towers || []) {
      const t = { t: 'tower', x, z, k, a, h };
      // Мачта связи в OSM внутри дома — она на крыше: короткая мачта (mr) от крыши, а не 30 м сквозь дом.
      const roof = k === 'mm' || k === 'ms' ? this.roofTopAt(x, z) : null;
      if (roof !== null) Object.assign(t, { k: 'mr', y0: roof, h: 5 + (Math.abs(x * 7.3 + z * 3.1) % 3) });
      else this.#offRoad(t, (k === 'pt' ? h * 0.11 : TOWER_BASE[k] ?? 1) + 1);
      this.points.push(t);
      towerAt.set(`${x},${z}`, t);
    }
    // Провода: пролёт между соседними опорами линии — точка в середине пролёта, концы — опоры (если они в данных).
    for (const [pts, kv] of c.power || []) {
      for (let i = 1; i < pts.length; i++) {
        const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
        if (Math.hypot(bx - ax, bz - az) > 600) continue;
        this.points.push({ t: 'wire', x: (ax + bx) / 2, z: (az + bz) / 2, kv,
          a: towerAt.get(`${ax},${az}`) ?? { x: ax, z: az, k: kv > 20 ? 'pt' : 'pp', a: Math.atan2(bx - ax, bz - az), h: kv > 20 ? 26 : 10 },
          b: towerAt.get(`${bx},${bz}`) ?? { x: bx, z: bz, k: kv > 20 ? 'pt' : 'pp', a: Math.atan2(bx - ax, bz - az), h: kv > 20 ? 26 : 10 } });
      }
    }
    for (const [x, z, k] of c.posts || []) this.points.push({ t: 'post', x, z, k });
    for (const [x, z] of c.play || []) this.points.push({ t: 'play', x, z, a: ((x * 7.1 + z * 3.3) % 6.28 + 6.28) % 6.28 });
    // Стены у высокого: трубы, башни, ноги опор ЛЭП и кранов; бетонные блоки. Верх — по высоте.
    for (const p of this.points) {
      if (p.t !== 'tower' && !(p.t === 'post' && p.k === 'k')) continue;
      const top = (p.y0 ?? this.terrain(p.x, p.z)) + (p.h ?? 0.8);
      const legs = p.k === 'pt' ? [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [u * p.h * 0.075, v * p.h * 0.075]) : [[0, 0]];
      const r = p.t === 'post' ? 0.35 : TOWER_BASE[p.k] * (p.k === 'ms' ? p.h / 40 : 1);
      const ca = Math.cos(p.a ?? 0), sa = Math.sin(p.a ?? 0);
      for (const [u, v] of legs) {
        const cx = p.x + u * ca + v * sa, cz = p.z - u * sa + v * ca;
        this.addCollider([[cx - r, cz - r], [cx + r, cz - r], [cx + r, cz + r], [cx - r, cz + r]], [], top);
      }
    }
  }

  // Точка в OSM на проезжей части (вышки ставят у самого края, а полотно у нас шире) — за край полотна
  // на r по нормали от ближайшей оси; мосты и тоннели не мешают.
  #offRoad(p, r) {
    for (let iter = 0; iter < 3; iter++) {
      let best = null;
      for (const s of this.segmentsNear(p.x, p.z, 30)) {
        if (s.road.br || s.road.tu) continue;
        const c = World.closest(s, p.x, p.z), need = s.w / 2 + r - c.d;
        if (need > 0 && (!best || need > best.need)) best = { ...c, need };
      }
      if (!best) return;
      const nx = p.x - best.px, nz = p.z - best.pz;
      const L = Math.hypot(nx, nz);
      if (L < 0.01) return; // ровно на оси — сторону не выбрать
      p.x += (nx / L) * best.need;
      p.z += (nz / L) * best.need;
    }
  }

  // Замкнутый контур, сквозь который нельзя проехать. skip — индексы рёбер без стены; top — высота верха стен
  // (над ним — проезжаем: машина на крыше), без неё — стена бесконечная.
  // Барьерное ограждение мостов (рисует buildRoadChunk) — стена в GUARD_IN от края полотна, кроме стороны парного
  // моста; низ и верх — по настилу, под мостом не мешает. Один раз на город: квадраты дорог перестраиваются.
  #initGuardrails() {
    const IN = 0.4;
    for (const s of this.segments) {
      if (!s.road.br || s.ya === undefined || s.len < 0.05) continue;
      const dx = (s.bx - s.ax) / s.len, dz = (s.bz - s.az) / s.len, o = s.w / 2 - IN;
      for (const sgn of [1, -1]) {
        if ((s.road.twin && sgn === s.road.twinSide) || s.open === sgn) continue;
        const nx = -dz * o * sgn, nz = dx * o * sgn;
        this.addCollider([[s.ax + nx, s.az + nz], [s.bx + nx, s.bz + nz]], [1], Math.max(s.ya, s.yb) + 0.9, Math.min(s.ya, s.yb) - 0.3);
      }
    }
  }

  // Сторона моста road у точки, к которой вплотную примыкает проезжая часть (#raiseAlongDecks): 1, -1 или 0.
  deckOpen(road, x, z) {
    let best = null;
    for (const s of this.nearbyRoadSegments(x, z)) {
      if (s.road !== road) continue;
      const c = World.closest(s, x, z);
      if (!best || c.d < best.d) best = { d: c.d, s };
    }
    return best?.s.open ?? 0;
  }

  // low — низ стены: машина ниже него больше чем на 1,5 м её не замечает (бортик тротуара на мосту над улицей).
  addCollider(p, skip = [], top = Infinity, low = -Infinity) {
    for (let i = 0; i < p.length; i++) {
      if (skip.includes(i)) continue;
      const a = p[i], c = p[(i + 1) % p.length];
      this.#insert(this.bGrid, this.bCell, { ax: a[0], az: a[1], bx: c[0], bz: c[1], top, low }, 0);
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

  // Видимый верх крыши под точкой (дом рисуется от самой высокой точки рельефа под ним) или null.
  roofTopAt(x, z) {
    let best = null;
    for (const b of this.roofGrid.get(Math.floor(x / ROOF_CELL) * 100003 + Math.floor(z / ROOF_CELL)) || []) {
      if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1 || (best !== null && b.vtop <= best)) continue;
      if (pointInRing(x, z, b.p) && !(b.holes || []).some((h) => pointInRing(x, z, h))) best = b.vtop;
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
            if (s.low > -Infinity && y < s.low - 1.5) continue; // под мостом
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
    // Забор по краю карты держит всегда — и в прыжке, и с крыши.
    const [x0, z0, x1, z1] = this.edge;
    if (pos.x < x0 + r) { pos.x = x0 + r; hit = { x: 1, z: 0 }; }
    if (pos.x > x1 - r) { pos.x = x1 - r; hit = { x: -1, z: 0 }; }
    if (pos.y < z0 + r) { pos.y = z0 + r; hit = { x: 0, z: 1 }; }
    if (pos.y > z1 - r) { pos.y = z1 - r; hit = { x: 0, z: -1 }; }
    return hit;
  }

  // ---------------------------------------------------------------- граф для гонок

  // graph — для гонок, в обе стороны по любой улице; nav — для навигатора по карте, направленный:
  // односторонняя улица (и каждая половина проспекта с разделителем) — только по ходу движения.
  // Ребро — [узел, цена, улица].
  buildGraph() {
    const adj = new Map(), nav = new Map();
    const [x0, z0, x1, z1] = this.edge, inside = ([x, z]) => x > x0 && x < x1 && z > z0 && z < z1;
    const link = (m, a, b, cost, r) => (m.get(a) || m.set(a, []).get(a)).push([b, cost, r]);
    const raceClasses = new Set(['primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'trunk',
      'primary_link', 'secondary_link', 'tertiary_link', 'living_street']);
    for (const r of this.roads) {
      if (!raceClasses.has(r.k)) continue;
      for (let i = 1; i < r.n.length; i++) {
        const a = r.n[i - 1], b = r.n[i];
        const pa = this.nodes[a], pb = this.nodes[b];
        if (!inside(pa) || !inside(pb)) continue; // за забором по краю карты маршрутов нет
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
    // Куски графа: окраины (СНТ, посёлки у края области) связаны с городом дорогами за краем выгрузки OSM —
    // в игре это острова. part — номер куска у узла; навигатор ведёт только в свой кусок (navEnd).
    this.part = new Map();
    let n = 0;
    for (const start of adj.keys()) {
      if (this.part.has(start)) continue;
      const stack = [start];
      this.part.set(start, n);
      while (stack.length) for (const [b] of adj.get(stack.pop())) if (!this.part.has(b)) { this.part.set(b, n); stack.push(b); }
      n++;
    }
    return adj;
  }

  // Кусок графа, в котором машина: улица под ней (до 60 м), иначе ближайший узел.
  partAt(x, z) {
    const end = this.navEnd(x, z, null, 60);
    return this.part.get(end ? end.seg.road.n[end.seg.i - 1] : this.nearestGraphNode(x, z));
  }

  // Ближайший к точке узел куска part (или -1).
  nearestInPart(x, z, part) {
    let best = -1, bd = Infinity;
    for (const [id, p] of this.part) {
      if (p !== part) continue;
      const [nx, nz] = this.nodes[id], d = (nx - x) ** 2 + (nz - z) ** 2;
      if (d < bd) { bd = d; best = id; }
    }
    return best;
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
  // навигатора, не дальше maxD; улица адреса street (если есть рядом) — предпочтительнее. part — только из этого
  // куска графа (partAt). null — нет улиц.
  navEnd(x, z, street = null, maxD = 300, part = null) {
    let best = null, named = null;
    for (const s of this.segmentsNear(x, z, maxD)) {
      if (!this.nav.get(s.road.n[s.i - 1])?.some((e) => e[2] === s.road)) continue;
      if (!this.graph.get(s.road.n[s.i - 1])?.some((e) => e[0] === s.road.n[s.i])) continue; // отрезок за забором
      if (part != null && this.part.get(s.road.n[s.i - 1]) !== part) continue;
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

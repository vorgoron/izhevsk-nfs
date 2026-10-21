// Тротуары и пешеходные дорожки — геометрией, а не мазком по текстуре земли (там 0,5–4 м на пиксель,
// края мыльные и плитка ложится по сетке рельефа 15 м). Плита ровная поперёк, по длине — по рельефу,
// с невысоким бордюром по краям; бока до земли закрывают щель на склоне.
// Дорожки — из OSM (footway, cycleway, steps; тропы path/track остаются на текстуре). Вдоль улиц, где
// в OSM своего тротуара нет, — придуманный (SIDEWALK, world.js) на той же сборке. Несколько тротуаров OSM
// впритык вдоль — один, пошире; велодорожка — отдельно, асфальт со значком велосипеда (build.js).
import { SIDEWALK, TRAM_BED, World } from './world.js';

export const WALK_LIFT = 0.1; // м: плита над рельефом (над самой высокой точкой поперёк)
export const CURB_W = 0.15, CURB_H = 0.05; // бордюр: ширина и сколько выше плитки
const STEP_MAX = 12;          // м: длиннее отрезок делится (поперечные пробы дорог и рельефа)
const FLAT_TOL = 0.06;        // м: середина отрезка отходит от прямой больше — делим (рельеф ломается на сетке)
const MEDIAN_REACH = 25;      // м: та же улица параллельно ближе — тротуар с этой стороны на разделительной
const CELL = 10;              // м: клетка индекса для ground
const MERGE_GAP = 1;          // м: тротуары OSM вдоль друг друга ближе (между краями) — сливаются в один
const WIDTH_TAPER = 0.3;      // м ширины на метр длины: расширение и сужение плавно
// Обрезки у перекрёстков (дороги режут тротуар на островки; улица в OSM там — много коротких линий):
// кусок короче — не строится. Придуманный: между дорогами / любой; OSM: любой.
const SYNTH_ISLAND = 25, SYNTH_MIN = 15, OSM_MIN = 8;
const MIN_HALF = 0.5;         // м: уже полуширины тротуар у велодорожки не сужается
const THIN_Y = 0.04, THIN_MAX = 20; // прореживание: точка на прямой ближе (м) — лишняя, но отрезок не длиннее
const JOIN_R = 1.5;           // м: на пересечении дорожек высота — общая, по рельефу в этом радиусе

// Парадные лестницы (по фото): в OSM — только ось (highway=steps, ширины нет), остальное задано здесь. Лестница —
// линия steps, у которой конец ближе всего к точке в R м от достопримечательности lm в сторону dir (к входу).
// w — ширина маршей, w0 — нижнего марша и площадки над ним (шире, с гранитными тумбами). Меш — в landmarks.js
// (grandStairs), здесь — раскладка маршей и площадок и плита, по которой едут (пандус по кромкам ступеней).
export const GRAND_STAIRS = [{ lm: 'mikhailovsky', dir: [-1, 0], R: 30, w: 11, w0: 15 }];
const RISER = 0.15, TREAD = 0.5; // м: высота и глубина ступени
const FIRST = 6;                 // ступеней в нижнем марше
const LANDING = 8;               // м: примерная длина площадки между маршами (рельеф пологий — площадок несколько)
const GRAND_EDGE = 0.5;          // м: от концов оси OSM до первой и последней ступени

export class Walks {
  constructor(world) {
    this.world = world;
    this.grid = new Map();    // клетка → отрезки плиты { ax, az, bx, bz, ya, yb, h }
    this.done = new Map();    // дорожка OSM или «дорога:сторона» → посчитано
    this.byChunk = new Map(); // ключ квадрата → отрезки для меша
    this.ready = new Set();   // квадраты, у которых посчитаны все свои дорожки
    this.id = 0;
    for (const g of GRAND_STAIRS) {
      const lm = (world.city.landmarks || []).find((q) => q.key === g.lm);
      if (!lm) continue;
      const ex = lm.x + g.dir[0] * g.R, ez = lm.z + g.dir[1] * g.R;
      let best = null, bd = 15;
      for (const p of world.city.paths) {
        if (p.k !== 's') continue;
        for (const [x, z] of [p.p[0], p.p[p.p.length - 1]]) {
          const d = Math.hypot(x - ex, z - ez);
          if (d < bd) { bd = d; best = p; }
        }
      }
      if (best) best.grand = g;
    }
    // Отрезки дорожек OSM (кроме троп): придуманный тротуар не ставим, где свой есть; тротуары впритык вдоль
    // (в OSM часто две-три линии рядом) — один: старший (rank: шире, при равной — раньше в city.json) расширяется
    // на соседние, младшие там не строятся; тротуар рядом с велодорожкой сужается до неё.
    this.osm = new Map();
    world.city.paths.forEach((p, pi) => {
      if (p.k === 't' || p.x) return;
      p.rank = p.w * 1e6 - pi;
      for (let i = 1; i < p.p.length; i++) {
        const [ax, az] = p.p[i - 1], [bx, bz] = p.p[i], L = Math.hypot(bx - ax, bz - az);
        if (L < 0.1) continue;
        const q = { ax, az, bx, bz, dx: (bx - ax) / L, dz: (bz - az) / L, h: p.w / 2, k: p.k, rank: p.rank, first: i === 1, last: i === p.p.length - 1 };
        for (let gi = Math.floor(Math.min(ax, bx) / CELL); gi <= Math.floor(Math.max(ax, bx) / CELL); gi++) {
          for (let gj = Math.floor(Math.min(az, bz) / CELL); gj <= Math.floor(Math.max(az, bz) / CELL); gj++) {
            const key = gi * 100003 + gj;
            (this.osm.get(key) || this.osm.set(key, []).get(key)).push(q);
          }
        }
      }
    });
    // Оси всех дорожек, которые могут строиться (OSM и придуманные), — для пересечений: где точка дорожки внутри
    // другой, идущей поперёк, там одна площадка (#joins).
    this.axes = new Map();
    const addAxis = (pts, h, owner) => {
      for (let i = 1; i < pts.length; i++) {
        const [ax, az] = pts[i - 1], [bx, bz] = pts[i], L = Math.hypot(bx - ax, bz - az);
        if (L < 0.1) continue;
        const q = { ax, az, bx, bz, dx: (bx - ax) / L, dz: (bz - az) / L, h, owner };
        for (let gi = Math.floor((Math.min(ax, bx) - h) / CELL); gi <= Math.floor((Math.max(ax, bx) + h) / CELL); gi++) {
          for (let gj = Math.floor((Math.min(az, bz) - h) / CELL); gj <= Math.floor((Math.max(az, bz) + h) / CELL); gj++) {
            const key = gi * 100003 + gj;
            (this.axes.get(key) || this.axes.set(key, []).get(key)).push(q);
          }
        }
      }
    };
    for (const p of world.city.paths) if (p.k !== 't' && !p.x) addAxis(p.p, p.w / 2, p);
    this.sides = new Map(); // дорога → [слева, справа]: линия придуманного тротуара и её «хозяин» для #joins
    for (const r of world.roads) {
      const sw = !r.br && !r.tu && SIDEWALK[r.k];
      if (!sw) continue;
      const pts = r.n.map((i) => world.nodes[i]), sides = [1, -1].map((sg) => ({ sg, pts: offsetLine(pts, sg * (r.w / 2 + sw[0] + sw[1] / 2)) }));
      this.sides.set(r, sides);
      for (const sd of sides) addAxis(sd.pts, sw[1] / 2, sd);
    }
  }

  // Точка внутри другой дорожки (не своей owner), идущей поперёк (|cos| < 0,8; вдоль — это слияние, #neighbours).
  #joins(x, z, dx, dz, owner) {
    for (const q of this.axes.get(this.#key(x, z)) || []) {
      if (q.owner === owner || Math.abs(q.dx * dx + q.dz * dz) >= 0.8) continue;
      if (World.closest(q, x, z).d < q.h) return true;
    }
    return false;
  }

  // Высота площадки на пересечении: одна и та же для всех дорожек в точке.
  joinY(x, z) {
    const T = (a, b) => this.world.terrain(a, b), r = JOIN_R;
    return Math.max(T(x, z), T(x + r, z), T(x - r, z), T(x, z + r), T(x, z - r)) + WALK_LIFT;
  }

  // Соседние дорожки OSM вдоль (cos > 0,8; продолжение за концом дорожки не считается). Придуманный тротуар
  // (rank undefined) — снят, если любая ближе h + 2,5 м. Дорожка OSM вида k — снята, если старшая того же вида
  // впритык; иначе младшие того же вида впритык расширяют её (wl, wr — до дальнего края соседки слева/справа),
  // а велодорожка рядом сужает тротуар (cl, cr).
  #neighbours(x, z, dx, dz, h, k, rank) {
    const nx = -dz, nz = dx, r = { off: false, wl: h, wr: h, cl: Infinity, cr: Infinity };
    const i0 = Math.floor(x / CELL), j0 = Math.floor(z / CELL), seen = new Set();
    for (let i = i0 - 1; i <= i0 + 1; i++) {
      for (let j = j0 - 1; j <= j0 + 1; j++) {
        for (const q of this.osm.get(i * 100003 + j) || []) {
          if (seen.has(q) || q.rank === rank || Math.abs(q.dx * dx + q.dz * dz) < 0.8) continue;
          seen.add(q);
          const c = World.closest(q, x, z);
          if ((c.t === 0 && q.first) || (c.t === 1 && q.last)) continue;
          if (rank === undefined) {
            if (c.d < h + 2.5) r.off = true;
            continue;
          }
          const o = (c.px - x) * nx + (c.pz - z) * nz;
          if (q.k === k && k !== 's' && c.d < h + q.h + MERGE_GAP) {
            if (q.rank > rank) r.off = true;
            else if (o > 0) r.wl = Math.max(r.wl, o + q.h);
            else r.wr = Math.max(r.wr, -o + q.h);
          } else if (k === 'f' && q.k === 'c' && c.d < h + q.h) {
            if (o > 0) r.cl = Math.min(r.cl, o - q.h);
            else r.cr = Math.min(r.cr, -o - q.h);
          }
        }
      }
    }
    return r;
  }

  #key(x, z) { return Math.floor(x / CELL) * 100003 + Math.floor(z / CELL); }

  // Все дорожки квадрата посчитаны (и разложены по квадратам и сетке ground).
  ensure(ci, cj) {
    const ck = ci * 10000 + cj;
    if (this.ready.has(ck)) return;
    this.ready.add(ck);
    const data = this.world.chunkInfo(ci, cj).data;
    for (const p of data.paths) {
      if (p.k === 't' || p.x || this.done.has(p)) continue; // переход — на дороге «зебра», не тротуар
      this.done.set(p, true);
      this.#add(p.grand ? grandStrip(this.world, p) : this.#strip(p.p, p.w, p.k, null, p.rank, 0, p));
    }
    for (const r of data.lines) {
      const sw = !r.br && !r.tu && SIDEWALK[r.k];
      if (!sw || this.done.has(r)) continue;
      this.done.set(r, true);
      for (const sd of this.sides.get(r) || []) this.#add(this.#strip(sd.pts, sw[1], 'f', r, undefined, sd.sg, sd));
    }
  }

  // Отрезки плиты квадрата для меша (build).
  chunk(ci, cj) {
    this.ensure(ci, cj);
    return this.byChunk.get(ci * 10000 + cj) || [];
  }

  // Высота плиты под точкой или -Infinity. ref — как у World.ground: выше ref + lim не считаем.
  at(x, z, lim = Infinity) {
    const [ci, cj] = this.world.chunkAt(x, z);
    this.ensure(ci, cj);
    let y = -Infinity;
    for (const s of this.grid.get(this.#key(x, z)) || []) {
      const c = World.closest(s, x, z);
      if (c.d > s.h || (s.sq && (c.t === 0 || c.t === 1))) continue;
      const v = s.ya + (s.yb - s.ya) * c.t;
      if (v <= lim) y = Math.max(y, v);
    }
    return y;
  }

  // Точка на плите или ближе pad к её краю (деревья, столбы и щиты на тротуар не ставим).
  near(x, z, pad = 0) {
    const [ci, cj] = this.world.chunkAt(x, z);
    this.ensure(ci, cj);
    const i0 = Math.floor(x / CELL), j0 = Math.floor(z / CELL), r = Math.ceil(pad / CELL);
    for (let i = i0 - r; i <= i0 + r; i++) {
      for (let j = j0 - r; j <= j0 + r; j++) {
        for (const s of this.grid.get(i * 100003 + j) || []) if (World.closest(s, x, z).d < s.h + pad) return true;
      }
    }
    return false;
  }

  // Точки плиты вдоль линии: высота, направление, на месте ли (не на проезжей части, путях, в доме).
  // road — придуманный тротуар этой улицы (её саму не обходим, а свой тротуар OSM рядом — снимает).
  // side — куда от улицы придуманный тротуар (1 — влево по ходу линии OSM).
  // owner — сама дорожка (запись city.paths или сторона улицы из this.sides): на пересечениях её не считаем.
  #strip(pts, w, k, road, rank, side, owner) {
    const W = this.world, h = w / 2, out = [];
    const probe = (x, z, dx, dz) => {
      const nx = -dz, nz = dx;
      // К дороге не поднимаемся: она на ~0,35 м над рельефом, и подъём на её уровень у каждого перехода давал горбы.
      const y = Math.max(W.terrain(x, z), W.terrain(x + nx * h, z + nz * h), W.terrain(x - nx * h, z - nz * h)) + WALK_LIFT;
      let on = true, curb = true;
      for (const s of W.nearbyRoadSegments(x, z)) {
        if (s.road.br) continue;
        const c = World.closest(s, x, z), e = c.d - s.w / 2;
        if (e > 2) continue;
        const ry = W.segY(s, c, x, z);
        if (ry - W.terrain(x, z) > 1) continue; // подъезд к путепроводу над нами
        if (s.road !== road) {
          // Плита заходит под кромку (асфальт выше): между ними нет щели с травой.
          if (e < -0.3) on = false;
          // Придуманный тротуар заходит на тротуар поперечной улицы — бордюр поперёк не нужен.
          const sw = road && SIDEWALK[s.road.k];
          if (sw && e < sw[0] + sw[1]) curb = false;
        }
      }
      for (const q of W.railsNear(x, z)) if (World.closest(q, x, z).d < (q.k === 'tram' ? TRAM_BED / 2 + 0.3 : 2)) on = false;
      if (on && W.roofAt(x, z) !== null) on = false;
      // Улица из двух проезжих частей (две линии OSM с одним именем): между ними — разделительная, не тротуар.
      if (on && road?.name) {
        const ox = nx * side, oz = nz * side;
        for (const s of W.segmentsNear(x, z, MEDIAN_REACH)) {
          if (s.road === road || s.road.name !== road.name || s.road.br) continue;
          const L = s.len || 1;
          if (Math.abs(((s.bx - s.ax) * dx + (s.bz - s.az) * dz) / L) < 0.9) continue;
          const c = World.closest(s, x, z);
          if (c.d < MEDIAN_REACH && (c.px - x) * ox + (c.pz - z) * oz > 0) { on = false; break; }
        }
      }
      // Свой тротуар OSM рядом — придуманный не нужен; тротуары OSM впритык — один, пошире.
      const nb = this.#neighbours(x, z, dx, dz, h, k, road ? undefined : rank);
      if (nb.off) on = false;
      // Пересечение с дорожкой поперёк (точка оси или края внутри неё): одна площадка — без бордюра, боков и торцов,
      // высота общая (joinY).
      // Пересечение с дорожкой поперёк (точка оси или края внутри неё): одна площадка — без бордюра, боков и торцов,
      // высота общая (joinY).
      const jn = k !== 'c' && [0, h, -h].some((o) => this.#joins(x + nx * o, z + nz * o, dx, dz, owner));
      return { y: jn ? this.joinY(x, z) : y, on, curb: curb && !jn, jn, wl: nb.wl, wr: nb.wr, cl: nb.cl, cr: nb.cr };
    };
    const push = (x, z, dx, dz, m) => out.push({ x, z, dx, dz, m, ...probe(x, z, dx, dz) });
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i], L = Math.hypot(bx - ax, bz - az);
      if (L < 0.05) continue;
      const dx = (bx - ax) / L, dz = (bz - az) / L;
      // Узел: направление — среднее соседних отрезков, митра с ограничением (как у дорог).
      const node = (j) => {
        const p = pts[j - 1] || null, n = pts[j + 1] || null, c = pts[j];
        let ux = dx, uz = dz, m = 1;
        if (p && n) {
          const l1 = Math.hypot(c[0] - p[0], c[1] - p[1]) || 1, l2 = Math.hypot(n[0] - c[0], n[1] - c[1]) || 1;
          const ax_ = (c[0] - p[0]) / l1, az_ = (c[1] - p[1]) / l1, bx_ = (n[0] - c[0]) / l2, bz_ = (n[1] - c[1]) / l2;
          ux = ax_ + bx_; uz = az_ + bz_;
          const l = Math.hypot(ux, uz) || 1;
          ux /= l; uz /= l;
          m = Math.min(2, 1 / Math.max(0.5, ax_ * ux + az_ * uz));
        }
        return [ux, uz, m];
      };
      if (!out.length) push(ax, az, ...node(i - 1));
      const a = out[out.length - 1];
      const b = { x: bx, z: bz, ...(([ux, uz, m]) => ({ dx: ux, dz: uz, m }))(node(i)) };
      Object.assign(b, probe(bx, bz, b.dx, b.dz));
      // Между узлами: не реже STEP_MAX, чаще — где рельеф ломается или плита обрывается (до 0,5 м).
      const fill = (p, q, t0, t1, depth) => {
        const len = L * (t1 - t0);
        if (depth > 8 || len < 0.5) return;
        const t = (t0 + t1) / 2, x = ax + (bx - ax) * t, z = az + (bz - az) * t, mid = { x, z, dx, dz, m: 1, ...probe(x, z, dx, dz) };
        const split = len > STEP_MAX || (p.on !== q.on) || (p.jn !== q.jn && len > 1.5) || (len > 2 && Math.abs(mid.y - (p.y + q.y) / 2) > FLAT_TOL);
        if (!split) return;
        fill(p, mid, t0, t, depth + 1);
        out.push(mid);
        fill(mid, q, t, t1, depth + 1);
      };
      fill(a, b, 0, 1, 0);
      out.push(b);
    }
    // Расстояние вдоль — для текстуры; лёгкий сдвиг по высоте у каждой дорожки — на стыках не мерцают.
    let s = 0;
    const dy = 0.004 * (this.id++ % 4);
    out.forEach((p, i) => {
      if (i) s += Math.hypot(p.x - out[i - 1].x, p.z - out[i - 1].z);
      p.s = s;
    });
    // Обрезки: куски подряд стоящих точек короче порога снимаются.
    for (let i = 0; i < out.length;) {
      if (!out[i].on) { i++; continue; }
      let j = i;
      while (j + 1 < out.length && out[j + 1].on) j++;
      const len = out[j].s - out[i].s, cut = i > 0 && j < out.length - 1;
      if (road ? len < SYNTH_MIN || (cut && len < SYNTH_ISLAND) : len < OSM_MIN) for (let q = i; q <= j; q++) out[q].on = false;
      i = j + 1;
    }
    // Ширина по сторонам: расширение и сужение плавно (WIDTH_TAPER), иначе от точки к точке край прыгал бы.
    const ease = (key, sg) => {
      for (let i = 1; i < out.length; i++) out[i][key] = sg * Math.max(sg * out[i][key], sg * out[i - 1][key] - WIDTH_TAPER * (out[i].s - out[i - 1].s));
      for (let i = out.length - 2; i >= 0; i--) out[i][key] = sg * Math.max(sg * out[i][key], sg * out[i + 1][key] - WIDTH_TAPER * (out[i + 1].s - out[i].s));
    };
    ease('wl', 1); ease('wr', 1); ease('cl', -1); ease('cr', -1);
    let hmax = h;
    for (const p of out) {
      p.hl = Math.max(MIN_HALF, Math.min(p.wl, p.cl));
      p.hr = Math.max(MIN_HALF, Math.min(p.wr, p.cr));
      hmax = Math.max(hmax, p.hl, p.hr);
      // Расширенная плита — над рельефом и по новым краям.
      if (!p.jn && (p.hl > h || p.hr > h)) p.y = Math.max(p.y, W.terrain(p.x - p.dz * p.hl, p.z + p.dx * p.hl) + WALK_LIFT, W.terrain(p.x + p.dz * p.hr, p.z - p.dx * p.hr) + WALK_LIFT);
      if (!p.jn) p.y += dy;
    }
    // Прореживание: точка посреди прямого ровного куска с теми же признаками (на месте, пересечение, бордюр) и
    // шириной — лишняя; треугольников меньше на треть, вид тот же.
    const thin = [out[0]];
    for (let i = 1; i < out.length - 1; i++) {
      const a = thin[thin.length - 1], p = out[i], b = out[i + 1], L = b.s - a.s || 1, t = (p.s - a.s) / L;
      const lerp = (key) => Math.abs(p[key] - (a[key] + (b[key] - a[key]) * t));
      const ex = (b.x - a.x) / L, ez = (b.z - a.z) / L;
      const keep = a.on !== p.on || p.on !== b.on || a.jn !== p.jn || p.jn !== b.jn || a.curb !== p.curb || p.curb !== b.curb
        || b.s - a.s > THIN_MAX || lerp('y') > THIN_Y || lerp('hl') > 0.05 || lerp('hr') > 0.05
        || Math.abs((p.x - a.x) * -ez + (p.z - a.z) * ex) > 0.05 || p.dx * ex + p.dz * ez < 0.999;
      if (keep) thin.push(p);
    }
    if (out.length > 1) thin.push(out[out.length - 1]);
    return { pts: thin, k, h: hmax, road };
  }

  // Отрезки полосы — в квадрат своей середины (меш) и в сетку ground.
  #add(strip) {
    const P = strip.pts;
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i];
      if (!a.on || !b.on) continue;
      const seg = { strip, i, ax: a.x, az: a.z, bx: b.x, bz: b.z, ya: a.y, yb: b.y, h: b.hw ?? strip.h };
      // У парадной лестницы концы отрезков ровные: полукруг радиусом в полширины (7,5 м) у площадки над нижним
      // маршем лежал на её высоте поверх марша и края проезжей части — машины перед лестницей ехали накренившись.
      if (strip.grand) seg.sq = true;
      const [ci, cj] = this.world.chunkAt((a.x + b.x) / 2, (a.z + b.z) / 2), ck = ci * 10000 + cj;
      (this.byChunk.get(ck) || this.byChunk.set(ck, []).get(ck)).push(seg);
      const pad = strip.h;
      for (let gi = Math.floor((Math.min(a.x, b.x) - pad) / CELL); gi <= Math.floor((Math.max(a.x, b.x) + pad) / CELL); gi++) {
        for (let gj = Math.floor((Math.min(a.z, b.z) - pad) / CELL); gj <= Math.floor((Math.max(a.z, b.z) + pad) / CELL); gj++) {
          const key = gi * 100003 + gj;
          (this.grid.get(key) || this.grid.set(key, []).get(key)).push(seg);
        }
      }
    }
  }
}

// Раскладка парадной лестницы (считается один раз): ось снизу вверх, высоты концов — как у плиты (по рельефу
// поперёк всей ширины). Ступеней — по перепаду высот; нижний марш — FIRST ступеней, остальные — поровну на
// несколько маршей. Площадка тянется, пока рельеф не догонит её уровень, — тогда следующий марш (поровну
// расставленные площадки ниже склона у вершины, ступени там тонули в земле). Куски { s0, s1, y0, y1, n, w }:
// n ступеней (0 — площадка), s — вдоль оси от нижнего конца.
export function grandLayout(world, p) {
  if (p.layout) return p.layout;
  const g = p.grand, T = (x, z) => world.terrain(x, z);
  let [a, b] = [p.p[0], p.p[p.p.length - 1]];
  if (T(...a) > T(...b)) [a, b] = [b, a];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
  const at = (s, v) => [a[0] + ux * s - uz * v, a[1] + uz * s + ux * v];
  const end = (s) => Math.max(...[-1, -0.5, 0, 0.5, 1].map((k) => T(...at(s, (k * g.w) / 2)))) + WALK_LIFT;
  const y0 = end(0), y1 = end(L);
  const n = Math.max(FIRST + 1, Math.round((y1 - y0) / RISER)), r = (y1 - y0) / n, up = n - FIRST;
  const run = L - 2 * GRAND_EDGE;
  // Верхних маршей k (не меньше 3 ступеней в каждом); площадок k — над нижним маршем и между верхними.
  const k = Math.max(1, Math.min(Math.floor(up / 3), Math.round((run - n * TREAD) / LANDING)));
  const t = Math.min(TREAD, (run - k * 1.5) / n);
  const sizes = Array.from({ length: k }, (_, i) => Math.round((up * (i + 1)) / k) - Math.round((up * i) / k));
  const pieces = [];
  let s = GRAND_EDGE, y = y0;
  const flight = (m, w) => { pieces.push({ s0: s, s1: s + m * t, y0: y, y1: y + m * r, n: m, w }); s += m * t; y += m * r; };
  // Площадка — до места, где рельеф поднимается до её уровня, но не короче 1,5 м и так, чтобы остальные марши
  // (с площадками по 1,5 м) уложились до верхнего конца.
  const landing = (w, i) => {
    const need = sizes.slice(i).reduce((a, m) => a + m * t, 0) + (k - 1 - i) * 1.5;
    let q = s + 1.5;
    while (q < L && end(q + 0.25) < y + 0.02) q += 0.25;
    q = Math.max(s + 1.5, Math.min(q, L - GRAND_EDGE - need));
    pieces.push({ s0: s, s1: q, y0: y, y1: y, n: 0, w });
    s = q;
  };
  flight(FIRST, g.w0);
  for (let i = 0; i < k; i++) {
    landing(i ? g.w : g.w0, i);
    flight(sizes[i], g.w);
  }
  if (s < L - 0.1) pieces.push({ s0: s, s1: L, y0: y, y1: y, n: 0, w: g.w }); // верхняя площадка до конца оси
  p.layout = { ax: a[0], az: a[1], ux, uz, L, y0, y1, r, t, pieces, at, w: g.w, w0: g.w0 };
  return p.layout;
}

// Плита, по которой едут по парадной лестнице: пандус по кромкам ступеней, на площадках — ровно. Меша нет (grand).
function grandStrip(world, p) {
  const lay = grandLayout(world, p), pts = [];
  const pt = (s, y, w) => { const [x, z] = lay.at(s, 0); pts.push({ x, z, y, on: true, hw: w / 2 }); };
  pt(0, lay.y0, lay.w0);
  for (const pc of lay.pieces) {
    if (pc === lay.pieces[0]) pt(pc.s0, pc.y0, pc.w);
    pt(pc.s1, pc.y1, pc.w);
  }
  if (lay.pieces[lay.pieces.length - 1].s1 < lay.L - 0.05) pt(lay.L, lay.y1, lay.w);
  return { pts, k: 's', h: Math.max(lay.w, lay.w0) / 2, road: null, grand: true };
}

// Линия, сдвинутая влево (off > 0) от ломаной, с митрой на изломах (не больше 2).
function offsetLine(pts, off) {
  return pts.map((c, j) => {
    const p = pts[j - 1], n = pts[j + 1];
    let ux = 0, uz = 0, m = 1;
    const dir = (a, b) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
    if (p && n) {
      const [ax, az] = dir(p, c), [bx, bz] = dir(c, n);
      ux = ax + bx; uz = az + bz;
      const l = Math.hypot(ux, uz) || 1;
      ux /= l; uz /= l;
      m = Math.min(2, 1 / Math.max(0.5, ax * ux + az * uz));
    } else [ux, uz] = p ? dir(p, c) : dir(c, n);
    return [c[0] - uz * off * m, c[1] + ux * off * m];
  });
}

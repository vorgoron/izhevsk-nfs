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
const RAMP = 40; // м: подъезд к ровному мосту
// Путепровод (мост над дорогой/рельсами): настил над нижней землёй на CLEAR м, уклон до GRADE,
// концы приподнимаются не выше END_MAX м (дальше — подъезды насыпью).
const CLEAR = 6.5, GRADE = 0.07, END_MAX = 6;
const GRADE_MAX = 0.12; // подъезд короче нужного (дальше перекрёсток) — сжимается до такого уклона
const RAIL_ALONG = 9; // м от края полотна путепровода: пути вдоль него идут на его уровне
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

export class World {
  constructor(city) {
    this.city = city;
    this.bounds = city.bounds;
    this.nodes = city.roadNodes;
    this.roads = city.roads.filter((r) => ROAD_CLASSES.has(r.k) && !r.tu);
    this.patches = [];
    this.#initDem(city.dem);
    this.#initMeshGrid();
    this.#planOverpasses();
    this.#carveUnderBridges();
    this.levelEnds = [];
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
      if (!d) this.chunkData.set(k, (d = { ci, cj, areas: [], paths: [], rails: [], waterways: [], lines: [], runs: [], buildings: [], trees: [], water: null }));
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
    const empty = { areas: [], paths: [], rails: [], waterways: [], lines: [], runs: [], buildings: [], trees: [] };
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
    // Парные мосты (две проезжие части рядом, концы рядом) — одной высоты: между ними трамвайные
    // пути и полоса, которые идут вровень с дорогой.
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
          ya: road.y?.[i - 1], yb: road.y?.[i], w: road.w, road, s0: acc, len: L,
        };
        acc += L;
        this.segments.push(seg);
        this.#insert(this.roadGrid, this.roadCell, seg, seg.w / 2 + 2);
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
    for (const s of this.nearbyRoadSegments(x, z)) {
      if (World.closest(s, x, z).d < s.w / 2 + 0.4) return 'road';
    }
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
    for (const r of this.city.rails) {
      for (let i = 1; i < r.p.length; i++) {
        const [ax, az] = r.p[i - 1], [bx, bz] = r.p[i];
        this.#insert(this.railGrid, this.railCell, { ax, az, bx, bz, k: r.k }, 6);
      }
    }
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
    return y;
  }

  // Высота под рельсами: как ground, но путепроводы (мосты над дорогами/рельсами) пропускаются —
  // пути идут под ними. По мосту через реку рельсы идут по настилу.
  // Пути вдоль путепровода (dx, dz — направление пути), между его проезжими частями или рядом,
  // идут вровень с ближайшим полотном моста или подъезда: в OSM у трамвая свой мост, а флага
  // «мост» у рельсов в данных нет.
  railGround(x, z, dx = 0, dz = 0) {
    const t = this.terrain(x, z);
    let y = t, along = null;
    for (const s of this.segmentsNear(x, z, RAIL_ALONG + 15)) {
      const c = World.closest(s, x, z);
      const lifted = s.road.hump || s.road.ramp?.some((r) => r.quad);
      if (lifted && c.d <= s.w / 2 + RAIL_ALONG && Math.abs(((s.bx - s.ax) * dx + (s.bz - s.az) * dz) / (s.len || 1)) > 0.9) {
        if (!along || c.d < along.d) along = { d: c.d, y: this.#segY(s, c, x, z, t) };
        continue;
      }
      if (s.road.hump) continue;
      if (c.d <= s.w / 2 + 0.3) y = Math.max(y, this.#segY(s, c, x, z, t));
    }
    return along ? Math.max(y, along.y) : y;
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

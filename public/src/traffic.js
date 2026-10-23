// Трафик: машины и автобусы по графу улиц вокруг игрока. Правостороннее движение,
// односторонние улицы, торможение перед впереди идущими и перед игроком, столкновения.
import * as THREE from 'three';
import { MODELS, vehicleParts, prism, withArches, wheelArches, ARCH_GAP } from './vehicles.js';
import { ExhaustFX, HitFX } from './effects.js';
import { CLEAR_ALT, YAW_K as PLAYER_K } from './car.js';
import { carGlows, busGlows, glowMaterial } from './night.js';

// Скорость по классу дороги, м/с. Нет в списке — трафика там нет (дворы, проезды).
const SPEED = {
  trunk: 16, primary: 15, secondary: 14, tertiary: 12, unclassified: 9, residential: 8, living_street: 5,
  trunk_link: 11, primary_link: 11, secondary_link: 10, tertiary_link: 9,
};
// Состав потока: ижевские машины (vehicles.js) и автобусы.
const MIX = { oda: 10, m412: 7, kombi: 6, kabluk: 5, pickup: 3, vesta: 13 };
const BUSES = 6;
const SPAWN_MIN = 140, SPAWN_MAX = 420, DESPAWN = 480;
// В гонке трафика меньше: остаётся каждая RACE_KEEP-я машина (v.thin — лишняя), лишние уходят за кадром.
// Общая гонка с друзьями — трафик «по расписанию» вдоль её маршрута (#line): машины в обе стороны через LINE_GAP м
// (±40 %) со скоростью LINE_V, место — только от общего времени гонки и её старта, у всех одно и то же. Ближе
// LINE_END м к старту и финишу их нет (там стартовая сетка и перескок с конца маршрута в начало).
const RACE_KEEP = 0.35, LINE_GAP = 160, LINE_V = 10, LINE_END = 60;
const LINE_MIX = { ...MIX, bus: 2 };
const GRID = 100; // м: клетка сетки рёбер
const CORNER = 9; // м: столько до узла и после него поворот идёт по кривой, а не углом
const TURN = 0.3; // рад: излом маршрута круче — поворот, его кривая берёт прямую и через короткие рёбра
const ROUTE = 80; // м: маршрут машины известен на столько вперёд и назад
// У знака STOP — полная остановка на STOP_WAIT с; у «Уступи дорогу» — подъезд не быстрее GIVE_V м/с. Дальше — только если
// к перекрёстку (YIELD_AHEAD м за знаком) по поперечной улице никто не едет ближе YIELD_R м.
const STOP_WAIT = 1, GIVE_V = 5, YIELD_AHEAD = 7, YIELD_R = 35;
const BUS_PALETTE = ['#f2c230', '#e8e8e8', '#3d8f4f', '#d9442f'];
const PLAYER_R = 1.15, PLAYER_AXLE = 1.25; // как в car.js
// Удары: массы в тоннах (игрок — легковушка), упругость (кузова мнутся — отскок слабый), трение
// скольжения металла о металл. Удар сильнее HARD м/с по нормали сбивает машину с полосы: она едет
// свободно — скользит (поперёк кузова шины тормозят сильнее, вдоль — водитель жмёт тормоз),
// крутится, отскакивает от стен и других машин, а встав, возвращается в свою полосу.
const PLAYER_M = 1.2, CAR_M = 1.1, BUS_M = 9;
const RESTITUTION = 0.25, MU = 0.35, HARD = 3, KNOCK_DV = 1.2;
const SLIDE_LAT = 8, SLIDE_LON = 5, SPIN_DRAG = 2.5; // м/с², м/с², рад/с²
// Кузов трафика качается на подвеске от удара: жёсткость, демпфер, предел крена/тангажа.
const WOB_K = 60, WOB_C = 6, WOB_MAX = 0.14;

// ---------------------------------------------------------------- модели: одна геометрия, цвет кузова — от инстанса

function merged(parts) {
  const pos = [], nor = [], col = [];
  const c = new THREE.Color();
  for (const [geo, color, x, y, z] of parts) {
    const g = (geo.index ? geo.toNonIndexed() : geo).translate(x, y, z);
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    c.set(color);
    for (let i = 0; i < g.attributes.position.count; i++) col.push(c.r, c.g, c.b);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const wheel = (r) => new THREE.CylinderGeometry(r, r, 0.25, 10).rotateZ(Math.PI / 2);

const hub = (r) => new THREE.CylinderGeometry(r, r, 0.26, 8).rotateZ(Math.PI / 2);
const BUS_WHEEL = { r: 0.5, x: 1.1, zs: [3.8, -3.4] };

function busGeometry() {
  const { r, x: wx, zs } = BUS_WHEEL, R = r + ARCH_GAP, y0 = 0.45;
  const body = [[-5.75, y0], [5.75, y0], [5.75, 2.85], [-5.75, 2.85]];
  const paint = [[prism(withArches(body, wheelArches(r, zs)), 2.5), '#fff', 0, 0, 0]];
  const parts = [
    [box(2.54, 0.9, 10.6), '#22303a', 0, 2.0, -0.2], // окна по бокам
    [box(2.3, 1.1, 0.05), '#22303a', 0, 2.0, 5.76], // лобовое
    [box(2.4, 0.15, 11.2), '#cfd2d6', 0, 2.92, 0],
  ];
  for (const sx of [-0.9, 0.9]) parts.push([box(0.35, 0.2, 0.05), '#fff6d0', sx, 0.8, 5.76], [box(0.35, 0.25, 0.05), '#ff2a1a', sx, 0.9, -5.76]);
  for (const z of zs) {
    // Ниша между колёсами — чтобы сквозь арки не просвечивала улица.
    parts.push([box(2 * (wx - 0.14), r + R - y0 + 0.01, 2 * R), '#111214', 0, (y0 + r + R + 0.01) / 2, z]);
    for (const x of [-wx, wx]) parts.push([wheel(r), '#151618', x, r, z], [hub(r * 0.55), '#9ea3a8', x, r, z]);
  }
  // Кузов — под цвет инстанса, остальное своим цветом.
  return { paint: merged(paint), detail: merged(parts) };
}

// ---------------------------------------------------------------- трафик

export class Traffic {
  constructor(world, scene) {
    this.world = world;
    this.enabled = true;
    this.signals = null; // выставляет Signals
    this.trams = null;   // выставляет main.js: трамваи — препятствие, сквозь них не едем
    this.race = null;    // выставляет main.js: в гонке трафика меньше, в общей — по расписанию (#line)
    this.line = null;
    this.honks = []; // гудки за кадр: { x, z, bus, long } — забирает Sound.traffic
    this.#buildGraph();

    // Каждый тип — набор InstancedMesh с общими индексами: кузов (цвет от инстанса), детали, фары.
    const lit = new THREE.MeshLambertMaterial({ vertexColors: true });
    const glow = new THREE.MeshBasicMaterial({ vertexColors: true });
    // roof — высота крыши над дорогой (на неё можно сесть после трюка, см. main.js).
    const roofOf = (...geos) => Math.max(...geos.map((g) => (g.computeBoundingBox(), g.boundingBox.max.y)));
    const kinds = Object.entries(MIX).map(([key, count]) => {
      const p = vehicleParts(MODELS[key], { wheelsInDetail: true });
      return { key, count, len: p.length, colors: MODELS[key].colors, paint: 0, roof: roofOf(p.paint, p.detail),
        meshes: [new THREE.InstancedMesh(p.paint, lit, count), new THREE.InstancedMesh(p.detail, lit, count),
          new THREE.InstancedMesh(p.lights, glow, count), new THREE.InstancedMesh(carGlows(p.lights, { beam: true }), glowMaterial(), count)] };
    });
    const bus = busGeometry();
    kinds.push({ key: 'bus', count: BUSES, len: 11.5, colors: BUS_PALETTE, paint: 0, roof: 2.95,
      meshes: [new THREE.InstancedMesh(bus.paint, lit, BUSES), new THREE.InstancedMesh(bus.detail, lit, BUSES),
        new THREE.InstancedMesh(busGlows(), glowMaterial(), BUSES)] });
    this.meshes = kinds.flatMap((k) => k.meshes);
    this.kinds = kinds;
    this.drawFar = 300; // м от игрока
    for (const k of kinds) k.meshes.kind = k;
    this.vehicles = [];
    let n = 0;
    for (const kind of kinds) {
      const bus = kind.key === 'bus';
      for (let idx = 0; idx < kind.count; idx++, n++) {
        const color = new THREE.Color(kind.colors[(idx * 3 + n) % kind.colors.length]);
        kind.meshes[kind.paint].setColorAt(idx, color); // заводит instanceColor до компиляции шейдера
        this.vehicles.push({
          meshes: kind.meshes, color, bus, kind: kind.key,
          len: kind.len, roof: kind.roof, y: 0, half: bus ? 1.25 : 0.85,
          // Выхлопная труба слева сзади; ускорение — для густоты дыма.
          acc: 0, smoke: { carry: Math.random() },
          pipe: new THREE.Vector3(bus ? -0.9 : -0.45, bus ? 0.45 : 0.33, -kind.len / 2 - 0.1),
          r: bus ? 1.3 : 1.1,
          circles: bus ? [-4.5, -1.5, 1.5, 4.5] : [-1.2, 1.2], // коллайдеры вдоль кузова
          maxSpeed: bus ? 11 : 17 * (MODELS[kind.key]?.stats.kmh ?? 160) / 160,
          mass: bus ? BUS_M : CAR_M,
          yk: (kind.len ** 2 + (bus ? 2.5 : 1.8) ** 2) / 12, // момент инерции на единицу массы
          knock: null, blend: null, roll: 0, rollV: 0, pitch: 0, pitchV: 0,
          mood: 0.85 + ((n * 37) % 30) / 100, // кто-то едет бодрее
          edge: null, next: null, s: 0, speed: 0,
          x: 0, z: 0, heading: 0, dx: 0, dz: 1, hit: 0, stuck: 0, ghost: 0, active: false,
          waitPlayer: 0, honkCool: 0, thin: ((n * 7) % 20) / 20 >= RACE_KEEP, slot: null,
        });
      }
    }
    for (const m of this.meshes) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.castShadow = m.receiveShadow = m.material !== glowMaterial(); // ночное свечение фар — без теней
      m.frustumCulled = false; // инстансы разбросаны по карте, сфера геометрии им не подходит
      scene.add(m);
    }
    this.mat4 = new THREE.Matrix4();
    this.quat = new THREE.Quaternion();
    this.up = new THREE.Vector3(0, 1, 0);
    this.smoke = new ExhaustFX(scene, 400);
    this.sparks = new HitFX(scene);
    this.bangs = []; // удары машин трафика между собой — для звука (забирает Sound.traffic)
    this.wallC = new THREE.Vector2();
    this.np = []; // узлы маршрута для #pose: положение и поворот ли (переиспользуются)
    this.nt = [];
  }

  // Направленный граф полос: двусторонняя улица — два ребра со сдвигом вправо.
  #buildGraph() {
    const w = this.world;
    this.out = new Map();
    this.edges = [];
    this.grid = new Map();
    // За забором по краю карты (world.edge) не ездим: улица, уходящая за край, — тупик, там разворот.
    const [x0, z0, x1, z1] = w.edge, inside = (x, z) => x > x0 && x < x1 && z > z0 && z < z1;
    const add = (a, b, road, forward) => {
      const [ax, az] = w.nodes[a], [bx, bz] = w.nodes[b];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.05 || !inside(ax, az) || !inside(bx, bz)) return;
      // Полосы в своём направлении: из OSM (lanes, lanes:forward/backward) или по ширине.
      const total = road.ln ?? Math.max(1, Math.round((road.w - 1) / 3.3));
      const lanes = Math.max(1, road.ow ? total : (forward ? road.lf : road.lb) ?? Math.floor(total / 2));
      const half = road.ow ? road.w / 2 : road.w / 2, span = road.ow ? road.w : road.w / 2;
      const laneW = span / lanes;
      // Смещение центра полосы j (0 — крайняя правая) вправо от оси дороги.
      const laneOff = (j) => half - (Math.min(j, lanes - 1) + 0.5) * laneW;
      const e = {
        a, b, ax, az, len, dx: (bx - ax) / len, dz: (bz - az) / len,
        lanes, laneOff, off: laneOff(0), v: SPEED[road.k], w: road.w, road,
      };
      this.edges.push(e);
      // Сетка рёбер для появления машин рядом с игроком (город большой — случайное ребро далеко).
      const key = Math.floor((ax + bx) / 2 / GRID) * 100003 + Math.floor((az + bz) / 2 / GRID);
      (this.grid.get(key) || this.grid.set(key, []).get(key)).push(e);
      if (!this.out.has(a)) this.out.set(a, []);
      this.out.get(a).push(e);
    };
    for (const r of w.roads) {
      if (!SPEED[r.k]) continue;
      for (let i = 1; i < r.n.length; i++) {
        add(r.n[i - 1], r.n[i], r, true);
        if (!r.ow) add(r.n[i], r.n[i - 1], r, false);
      }
    }
  }

  // На перекрёстке — чаще прямо и на улицу покрупнее, разворот только в тупике.
  #choose(e) {
    const outs = this.out.get(e.b) || [];
    let cands = outs.filter((o) => o.b !== e.a);
    if (!cands.length) cands = outs;
    if (!cands.length) return null;
    const ws = cands.map((o) => (1.2 + o.dx * e.dx + o.dz * e.dz) ** 2 * o.v);
    let r = Math.random() * ws.reduce((a, b) => a + b, 0);
    for (let i = 0; i < cands.length; i++) if ((r -= ws[i]) <= 0) return cands[i];
    return cands[cands.length - 1];
  }

  #spawn(v, px, pz, minD) {
    for (let tries = 0; tries < 300; tries++) {
      // Случайная точка в кольце вокруг игрока → случайное ребро из её клетки.
      const a = Math.random() * Math.PI * 2, r = minD + Math.random() * (SPAWN_MAX - minD);
      const cell = this.grid.get(Math.floor((px + Math.cos(a) * r) / GRID) * 100003 + Math.floor((pz + Math.sin(a) * r) / GRID));
      if (!cell) continue;
      const e = cell[(Math.random() * cell.length) | 0];
      const s = Math.random() * e.len;
      const lane = v.bus ? 0 : (Math.random() * e.lanes) | 0; // автобус — в правой
      const off = e.laneOff(lane);
      const x = e.ax + e.dx * s - e.dz * off, z = e.az + e.dz * s + e.dx * off;
      const d = Math.hypot(x - px, z - pz);
      if (d < minD || d > SPAWN_MAX) continue;
      if (this.vehicles.some((o) => o.active && Math.hypot(o.x - x, o.z - z) < 14)) continue;
      Object.assign(v, { route: [e], ri: 0, end: false, off, sk: 1, s, x, z, dx: e.dx, dz: e.dz, heading: Math.atan2(e.dx, e.dz), acc: 0,
        lane, laneCool: 0, slowT: 0, speed: e.v * 0.6, hit: 0, stuck: 0, ghost: 0, active: true,
        knock: null, blend: null, roll: 0, rollV: 0, pitch: 0, pitchV: 0 });
      this.#route(v);
      return;
    }
    v.active = false;
  }

  // Расставить трафик вокруг точки (старт, респаун).
  reset(px, pz) {
    for (const v of this.vehicles) { v.active = false; v.slot = null; v.knock = null; }
    if (this.line) { for (const c of this.line.cars) { c.v = null; c.dead = false; } return; } // расставит #lineUpdate
    for (const v of this.vehicles) this.#spawn(v, px, pz, 25);
  }

  setEnabled(on) {
    this.enabled = on;
    for (const m of this.meshes) m.visible = on;
    this.smoke.points.visible = on;
    this.sparks.points.visible = on;
  }

  update(dt, car) {
    if (!this.enabled) return;
    const px = car.pos.x, pz = car.pos.y;
    const race = this.race, racing = race && (race.state === 'running' || race.state === 'countdown');
    const lineAt = racing && race.shared ? race.startAt : null;
    if (lineAt !== (this.line?.at ?? null)) this.#setLine(lineAt);
    // Трамваи рядом с трафиком — точки вдоль вагона (вагон длинный, поперёк дороги его центр может быть в стороне),
    // и где они будут через 1 и 2 с: трамвай, подъезжающий к перекрёстку сбоку, пропускаем заранее.
    this.tramPts = [];
    for (const t of this.trams?.near(px, pz, DESPAWN + 30) ?? []) {
      for (const k of [0, 1, 2]) for (const o of [-6, -3, 0, 3, 6]) {
        const s = o + t.v * k;
        this.tramPts.push([t.x + t.dx * s, t.z + t.dz * s, t.dx, t.dz]);
      }
    }
    if (this.line) this.#lineUpdate(dt, px, pz);
    for (const v of this.vehicles) {
      if (this.line) { if (v.active && v.knock) this.#tumble(v, dt); continue; }
      const d = v.active ? Math.hypot(v.x - px, v.z - pz) : Infinity;
      if (racing && v.thin) { if (d > SPAWN_MIN) v.active = false; }
      else if (d > DESPAWN) this.#spawn(v, px, pz, SPAWN_MIN);
      if (v.active && v.knock) this.#tumble(v, dt);
      else if (v.active) this.#drive(v, dt, car);
    }
    this.#separate();
    this.#collideKnocked();
    this.#collidePlayer(car);
    this.#sync(dt, px, pz);
  }

  // Едет ли кто к перекрёстку за знаком y поперёк (трафик и игрок; стоящие не мешают — иначе на двух «Уступи»
  // друг против друга ждали бы вечно).
  #crossing(y, v, car) {
    const jx = y.x + y.ux * YIELD_AHEAD, jz = y.z + y.uz * YIELD_AHEAD;
    const near = (x, z, dx, dz, speed) => {
      if (speed < 1.5 || Math.abs(dx * y.ux + dz * y.uz) > 0.6) return false;
      const rx = jx - x, rz = jz - z;
      return Math.abs(rx) < YIELD_R && Math.abs(rz) < YIELD_R && Math.hypot(rx, rz) < YIELD_R && rx * dx + rz * dz > -4;
    };
    for (const o of this.vehicles) if (o !== v && o.active && !o.knock && near(o.x, o.z, o.dx, o.dz, o.speed)) return true;
    const f = car.forward;
    return !car.air && near(car.pos.x, car.pos.y, f.x, f.y, Math.abs(car.speed));
  }

  #drive(v, dt, car) {
    const e = v.edge;
    let limit = Math.min(v.maxSpeed, e.v) * v.mood;

    // Крутой поворот впереди (и за короткими рёбрами) — сбросить скорость.
    const rest = e.len - v.s, r = v.route;
    for (let i = v.ri, d = rest; i + 1 < r.length && d < 25; d += r[++i].len) {
      const cos = r[i].dx * r[i + 1].dx + r[i].dz * r[i + 1].dz;
      if (cos < 0.75) { limit = Math.min(limit, 4 + d * 0.5 + cos * 3); break; }
    }

    // Лежачий полицейский впереди — переваливаем шагом.
    const bump = this.world.bumpAhead(v.x, v.z, v.dx, v.dz, 30);
    if (bump < Infinity) limit = Math.min(limit, 3 + bump * 0.35);

    // «Уступи дорогу» / STOP впереди.
    const yl = this.world.yieldAhead(v.x, v.z, v.dx, v.dz, 35);
    if (yl) {
      const stop = yl.d - v.len / 2, hold = Math.max(0, (stop - 1) * 0.7);
      if (v.yieldAt !== yl.y) { v.yieldAt = yl.y; v.yieldT = 0; }
      if (yl.y.s === 's' && v.yieldT < STOP_WAIT) {
        limit = Math.min(limit, hold);
        if (stop < 3 && v.speed < 0.5) v.yieldT += dt;
      } else if (this.#crossing(yl.y, v, car)) limit = Math.min(limit, hold);
      else limit = Math.min(limit, GIVE_V + Math.max(0, stop) * 0.4);
    }

    // Светофор на этом или следующем ребре: стоим у стоп-линии на красный и на жёлтый,
    // если ещё успеваем затормозить.
    if (this.signals) {
      let ap = this.signals.approach.get(e), dist = rest;
      if (!ap && v.next) { ap = this.signals.approach.get(v.next); dist = rest + v.next.len; }
      if (ap) {
        const stop = dist - ap.stopBack - v.len / 2; // до переднего бампера, не до центра
        const st = this.signals.state(ap);
        if (stop > -1 && st !== 'green' && !(st === 'yellow' && stop < v.speed * 1.2)) {
          limit = Math.min(limit, Math.max(0, (stop - 1) * 0.7));
        }
      }
    }

    // Кто впереди в моей полосе: попутный трафик и игрок (игрок — в любом направлении).
    let blockedByTraffic = false;
    const look = 10 + v.speed * 1.6;
    const check = (ox, oz, olen, sameDirOnly, odx, odz) => {
      const rx = ox - v.x, rz = oz - v.z;
      const ahead = rx * v.dx + rz * v.dz;
      if (ahead <= 0 || ahead > look + olen / 2) return false;
      const lat = Math.abs(rx * v.dz - rz * v.dx);
      if (lat > 2.3) return false;
      if (sameDirOnly && odx * v.dx + odz * v.dz < 0.1) return false; // и вливающихся сбоку
      const gap = ahead - (v.len + olen) / 2;
      limit = Math.min(limit, Math.max(0, (gap - 2.5) * 0.8));
      return true;
    };
    {
      for (const o of this.vehicles) {
        // Сбитая машина стоит поперёк как попало — препятствие при любом её курсе.
        if (o !== v && o.active && check(o.x, o.z, o.len, !o.knock, o.dx, o.dz)) blockedByTraffic = true;
      }
    }
    // Трамвай впереди — в любом направлении (пересекает улицу или едет по полосе): ждём.
    for (const [tx, tz, tdx, tdz] of this.tramPts) {
      if (Math.abs(tx - v.x) < look + 10 && Math.abs(tz - v.z) < look + 10 && check(tx, tz, 3, false, tdx, tdz)) blockedByTraffic = true;
    }
    const f = car.forward;
    const byPlayer = !car.onTop && car.alt < CLEAR_ALT && check(car.pos.x, car.pos.y, 4.3, false, f.x, f.y);

    // Игрок стоит поперёк дороги — посигналить ему (не чаще раза в несколько секунд).
    v.honkCool = Math.max(0, v.honkCool - dt);
    v.waitPlayer = byPlayer && v.speed < 2 ? v.waitPlayer + dt : 0;
    if (v.waitPlayer > 1.5 && v.honkCool <= 0) {
      this.honks.push({ x: v.x, z: v.z, bus: v.bus, long: false });
      v.honkCool = 4 + Math.random() * 4;
      v.waitPlayer = 0;
    }

    // Упёрлись в медленного впереди — перестроиться в соседнюю полосу, если она свободна.
    v.laneCool = Math.max(0, v.laneCool - dt);
    v.slowT = blockedByTraffic && limit < e.v * v.mood * 0.6 ? v.slowT + dt : 0;
    if (v.slowT > 1.5 && v.laneCool <= 0 && e.lanes > 1) {
      const cur = Math.min(v.lane, e.lanes - 1);
      for (const nl of [cur + 1, cur - 1]) {
        if (nl < 0 || nl >= e.lanes) continue;
        const shift = e.laneOff(nl) - e.laneOff(cur); // вправо — положительно
        const free = this.vehicles.every((o) => {
          if (o === v || !o.active || o.dx * v.dx + o.dz * v.dz < 0.5) return true;
          const rx = o.x - v.x, rz = o.z - v.z;
          const ahead = rx * v.dx + rz * v.dz, lat = rx * -v.dz + rz * v.dx;
          return Math.abs(lat - shift) > 1.8 || ahead < -9 || ahead > 14;
        });
        if (free) { v.lane = nl; v.laneCool = 4; v.slowT = 0; break; }
      }
    }

    // Застряли в пробке из таких же (не очередь на светофоре) — ненадолго «не замечаем» соседей, чтобы рассосалось.
    v.ghost = Math.max(0, v.ghost - dt);
    if (blockedByTraffic && v.speed < 0.3) v.stuck += dt;
    else v.stuck = 0;
    // Стоит дольше цикла светофора (затор на развилке) — не проезжать сквозь соседей, а тихо
    // убрать машину вдали от игрока: на её место появится другая в кольце вокруг.
    if (v.stuck > 20) {
      v.stuck = 0;
      if (Math.hypot(v.x - car.pos.x, v.z - car.pos.y) > 90) { v.active = false; return; }
    }

    // Удар от игрока: постоять.
    if (v.hit > 0) { v.hit -= dt; limit = 0; }

    const speed0 = v.speed;
    v.speed += Math.max(-9 * dt, Math.min(2.8 * dt, limit - v.speed));
    if (dt > 0) v.acc += ((v.speed - speed0) / dt - v.acc) * Math.min(1, dt * 5);
    v.s += v.speed * dt * v.sk; // на кривой поворота путь по полосе длиннее или короче оси дороги
    while (v.s > v.edge.len) {
      v.s -= v.edge.len;
      if (!v.next) { v.active = false; return; }
      v.ri++;
      this.#route(v);
    }

    // Сдвиг от оси дороги плавно идёт к своей полосе (перестроение, на новом ребре полос меньше —
    // крайняя доступная).
    const off0 = v.off;
    v.off += (v.edge.laneOff(v.lane ?? 0) - v.off) * Math.min(1, dt * 1.5);
    const [x, z, tx, tz] = this.#pose(v);
    v.x = x;
    v.z = z;
    // Курс — по касательной к пути, при перестроении чуть в сторону сдвига.
    const side = dt > 0 ? Math.atan2((v.off - off0) / dt, Math.max(v.speed, 2)) : 0;
    let want = Math.atan2(tx, tz) - Math.max(-0.2, Math.min(0.2, side));
    // После удара: сдвиг от полосы и поворот кузова уходят плавно, быстрее на ходу.
    const b = v.blend;
    if (b) {
      const k = Math.exp(-dt * (0.25 + v.speed * 0.3));
      b.x *= k; b.z *= k; b.h *= k;
      v.x += b.x;
      v.z += b.z;
      want += b.h;
      if (Math.hypot(b.x, b.z) < 0.05 && Math.abs(b.h) < 0.01) v.blend = null;
    }
    let dh = want - v.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    v.heading += dh * Math.min(1, dt * 10);
    v.dx = Math.sin(v.heading);
    v.dz = Math.cos(v.heading);
  }

  // Маршрут машины: рёбра позади и впереди текущего (v.route[v.ri]), не меньше ROUTE м в обе стороны,
  // чтобы поворот видел прямую до соседнего поворота и сквозь короткие рёбра (узлы переходов, примыканий).
  // v.edge / v.prev / v.next — текущее, прошлое и следующее рёбра из маршрута.
  #route(v) {
    const r = v.route;
    let ahead = 0;
    for (let i = v.ri + 1; i < r.length; i++) ahead += r[i].len;
    while (ahead < ROUTE && !v.end) {
      const n = this.#choose(r[r.length - 1]);
      if (!n) { v.end = true; break; }
      r.push(n);
      ahead += n.len;
    }
    let behind = 0;
    for (let i = 0; i < v.ri; i++) behind += r[i].len;
    while (v.ri > 0 && behind - r[0].len >= ROUTE) { behind -= r.shift().len; v.ri--; }
    v.edge = r[v.ri];
    v.prev = r[v.ri - 1] ?? null;
    v.next = r[v.ri + 1] ?? null;
  }

  // Точка машины на пути и направление пути [x, z, dx, dz]. Путь — полоса маршрута со сдвигом v.off, у узла —
  // кубическая кривая между точками полосы до и после него (иначе угол срезается рывком). Поворот (угол больше
  // TURN) берёт прямую через сколько угодно коротких рёбер, но не больше половины расстояния до соседнего
  // поворота; мелкий излом — только до середины своих рёбер и не заходя на кривую поворота.
  #pose(v) {
    const r = v.route, D = v.s;
    v.sk = 1;
    let base = 0; // начало маршрута от начала текущего ребра
    for (let i = 0; i < v.ri; i++) base -= r[i].len;
    // Узлы маршрута: положение (от начала текущего ребра) и поворот ли.
    const P = this.np, T = this.nt;
    P.length = T.length = 0;
    let p = base;
    for (let j = 1; j < r.length; j++) {
      const a = r[j - 1], b = r[j];
      p += a.len;
      P.push(p);
      T.push(Math.abs(Math.atan2(a.dx * b.dz - a.dz * b.dx, a.dx * b.dx + a.dz * b.dz)) > TURN);
    }
    const end = p + r[r.length - 1].len;
    // Ближайшие повороты вокруг узла k: границы их кривых, чтобы мелкий излом на них не заходил.
    let lo = 0, hi = 0, found = false, behindHi = -Infinity, aheadLo = Infinity;
    for (let k = 0; k < P.length; k++) {
      if (!T[k] || P[k] < D - 60 || P[k] > D + 60) continue;
      let prev = base, next = end;
      for (let q = k - 1; q >= 0; q--) if (T[q]) { prev = (P[q] + P[k]) / 2; break; }
      for (let q = k + 1; q < P.length; q++) if (T[q]) { next = (P[q] + P[k]) / 2; break; }
      const [x, y] = this.#cross(r[k], r[k + 1], v.off);
      // Не короче 3 м в каждую сторону: на крутом левом пересечение полос далеко за узлом, а концы кривой
      // до узла на a и после него на b и так по нужные стороны от него.
      const l = P[k] - Math.max(0.25, Math.min(P[k] - prev, Math.max(3, CORNER - x)));
      const h = P[k] + Math.max(0.25, Math.min(next - P[k], Math.max(3, CORNER + y)));
      if (D >= l && D <= h) { lo = l; hi = h; found = true; break; }
      if (h < D) behindHi = Math.max(behindHi, h);
      else aheadLo = Math.min(aheadLo, l);
    }
    // Мелкий излом у концов текущего ребра.
    if (!found) {
      const e = v.edge;
      for (const k of [v.ri - 1, v.ri]) {
        if (k < 0 || k >= P.length || T[k]) continue;
        const [x, y] = this.#cross(r[k], r[k + 1], v.off);
        const l = Math.max(P[k] - Math.min(r[k].len / 2, CORNER - x), behindHi);
        const h = Math.min(P[k] + Math.min(r[k + 1].len / 2, CORNER + y), aheadLo);
        if (h - l > 0.3 && D >= l && D <= h && l <= P[k] && h >= P[k]) { lo = l; hi = h; found = true; break; }
      }
      if (!found) return [e.ax + e.dx * D - e.dz * v.off, e.az + e.dz * D + e.dx * v.off, e.dx, e.dz];
    }
    // Кривая между точками полосы на lo и hi, ручки — как у дуги окружности на угол θ между касательными:
    // хорда / (3 cos²(θ/4)). На прямой это треть хорды (проходится равномерно), и длина меняется с углом
    // плавно — от пересечения касательных брать нельзя: на почти прямом изломе оно скачет и улетает.
    const [p0x, p0z, ax, az] = this.#lanePt(v, base, lo), [p3x, p3z, bx, bz] = this.#lanePt(v, base, hi);
    const c4 = Math.cos(Math.acos(Math.max(-1, Math.min(1, ax * bx + az * bz))) / 4);
    const h = Math.max(Math.hypot(p3x - p0x, p3z - p0z), (hi - lo) / 4) / (3 * c4 * c4);
    const p1x = p0x + ax * h, p1z = p0z + az * h, p2x = p3x - bx * h, p2z = p3z - bz * h;
    const t = (D - lo) / (hi - lo), m = 1 - t;
    const k0 = m * m * m, k1 = 3 * m * m * t, k2 = 3 * m * t * t, k3 = t * t * t;
    const d0 = m * m, d1 = 2 * m * t, d2 = t * t;
    let dx = d0 * (p1x - p0x) + d1 * (p2x - p1x) + d2 * (p3x - p2x), dz = d0 * (p1z - p0z) + d1 * (p2z - p1z) + d2 * (p3z - p2z);
    const l = Math.hypot(dx, dz);
    if (l > 1e-6) { dx /= l; dz /= l; } else { dx = bx; dz = bz; }
    // Длина кривой (по хордам) → во сколько раз медленнее идёт s по оси, чтобы скорость по полосе была настоящей.
    let len = 0, qx = p0x, qz = p0z;
    for (let i = 1; i <= 8; i++) {
      const tt = i / 8, mm = 1 - tt, a0 = mm * mm * mm, a1 = 3 * mm * mm * tt, a2 = 3 * mm * tt * tt, a3 = tt * tt * tt;
      const nx = a0 * p0x + a1 * p1x + a2 * p2x + a3 * p3x, nz = a0 * p0z + a1 * p1z + a2 * p2z + a3 * p3z;
      len += Math.hypot(nx - qx, nz - qz); qx = nx; qz = nz;
    }
    v.sk = (hi - lo) / Math.max(len, 0.1);
    return [k0 * p0x + k1 * p1x + k2 * p2x + k3 * p3x, k0 * p0z + k1 * p1z + k2 * p2z + k3 * p3z, dx, dz];
  }

  // Точка полосы маршрута на расстоянии d от начала текущего ребра (base — начало маршрута) и её направление.
  #lanePt(v, base, d) {
    const r = v.route;
    let i = 0;
    while (i < r.length - 1 && d > base + r[i].len) base += r[i++].len;
    const e = r[i], s = d - base;
    return [e.ax + e.dx * s - e.dz * v.off, e.az + e.dz * s + e.dx * v.off, e.dx, e.dz];
  }

  // Где пересекаются полосы рёбер a и b со сдвигом off: x — вдоль a от узла, y — вдоль b от узла. На повороте
  // направо это до узла, налево — за ним; кривая — CORNER в обе стороны от этой точки. Считать от самого узла
  // нельзя: на широкой улице правая полоса пересекает поперечную раньше узла, и кривая шла бы назад петлёй.
  #cross(a, b, off) {
    const cr = a.dx * b.dz - a.dz * b.dx;
    if (Math.abs(cr) <= 0.05) return [0, 0];
    const wx = off * (a.dz - b.dz), wz = off * (b.dx - a.dx); // off · (правая b − правая a)
    return [Math.max(-15, Math.min(15, (wx * b.dz - wz * b.dx) / cr)), Math.max(-15, Math.min(15, -(a.dx * wz - a.dz * wx) / cr))];
  }

  // Страховка: если две попутные машины всё же наехали друг на друга (слияние полос, развилка,
  // перестроение), задняя откатывается назад вдоль своего ребра и встаёт.
  #separate() {
    const vs = this.vehicles.filter((v) => v.active);
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i];
      for (let j = i + 1; j < vs.length; j++) {
        const b = vs[j];
        if (a.knock || b.knock) continue; // этих разводит удар (#collideKnocked)
        if (a.slot || b.slot) continue; // по расписанию друг на друга не наезжают
        const rx = b.x - a.x, rz = b.z - a.z;
        if (Math.abs(rx) > 14 || Math.abs(rz) > 14) continue;
        if (a.dx * b.dx + a.dz * b.dz < -0.3) continue; // встречные — на своих полосах
        const along = rx * a.dx + rz * a.dz, lat = Math.abs(rx * a.dz - rz * a.dx);
        const need = (a.len + b.len) / 2 + 0.6;
        if (lat > 2 || Math.abs(along) >= need) continue;
        const [rear, gap] = along > 0 ? [a, need - along] : [b, need + along];
        rear.s = Math.max(0, rear.s - gap);
        rear.speed = 0;
        [rear.x, rear.z] = this.#pose(rear);
        if (rear.blend) { rear.x += rear.blend.x; rear.z += rear.blend.z; }
      }
    }
  }

  // Скорость машины трафика в точке (px, pz): по полосе — вдоль курса, сбитая — своя плюс вращение.
  #pointVel(v, px, pz) {
    if (!v.knock) return [v.dx * v.speed, v.dz * v.speed];
    const { vx, vz, w } = v.knock;
    return [vx + w * (pz - v.z), vz - w * (px - v.x)];
  }

  // Сбить машину с полосы: дальше она едет свободно со своей скоростью (#tumble).
  #knockOut(v) {
    if (v.knock) return;
    v.knock = { vx: v.dx * v.speed, vz: v.dz * v.speed, w: 0, rest: 0 };
    v.speed = 0;
    v.blend = null;
  }

  // Импульс J (т·м/с) в точке (px, pz) машине трафика: скорость, вращение, качнуть кузов.
  #push(v, jx, jz, px, pz) {
    const k = v.knock, m = v.mass;
    k.vx += jx / m;
    k.vz += jz / m;
    k.w = Math.max(-4, Math.min(4, k.w - ((px - v.x) * jz - (pz - v.z) * jx) / (m * v.yk)));
    // В осях кузова: удар сбоку — крен, спереди/сзади — клевок.
    const lat = (jx * v.dz - jz * v.dx) / m, lon = (jx * v.dx + jz * v.dz) / m;
    v.rollV += lat * 0.12;
    v.pitchV -= lon * 0.06;
  }

  // Решить удар двух тел по нормали n (от b к a), точка контакта p. ma, mb — массы, ka, kb — моменты
  // инерции на единицу массы, ra, rb — плечи (от центров к p), vn и vt — относительная скорость точек
  // по нормали и по касательной. Возвращает [Jx, Jz] — импульс, который получает a (b — обратный).
  static #impulse(nx, nz, vn, vt, ma, ka, rax, raz, mb, kb, rbx, rbz) {
    const tx = -nz, tz = nx;
    const ca = rax * nz - raz * nx, cb = rbx * nz - rbz * nx;
    const ta = rax * tz - raz * tx, tb = rbx * tz - rbz * tx;
    const ia = 1 / ma, ib = mb === Infinity ? 0 : 1 / mb;
    const dn = ia + ib + ca * ca * ia / ka + (ib ? cb * cb * ib / kb : 0);
    const dt = ia + ib + ta * ta * ia / ka + (ib ? tb * tb * ib / kb : 0);
    const j = -(1 + RESTITUTION) * vn / dn;
    const jt = Math.max(-MU * j, Math.min(MU * j, -vt / dt));
    return [nx * j + tx * jt, nz * j + tz * jt];
  }

  #collidePlayer(car) {
    if (car.ghostVehicles > 0) return; // выезжаем из зажатия
    if (car.alt > CLEAR_ALT || car.onTop) return; // перелетаем; стоим на крыше
    const f = car.forward;
    for (const v of this.vehicles) {
      if (!v.active || Math.hypot(v.x - car.pos.x, v.z - car.pos.y) > 16) continue;
      if (car.y > v.y + v.roof - 0.4) continue; // над её крышей — садимся на неё, а не толкаемся
      for (const so of [PLAYER_AXLE, -PLAYER_AXLE]) {
        for (const vo of v.circles) {
          const cx = car.pos.x + f.x * so, cz = car.pos.y + f.y * so;
          const ox = v.x + v.dx * vo, oz = v.z + v.dz * vo;
          const d = Math.hypot(cx - ox, cz - oz), min = PLAYER_R + v.r;
          if (d >= min || d < 1e-6) continue;
          const nx = (cx - ox) / d, nz = (cz - oz) / d;
          const px = ox + nx * v.r, pz = oz + nz * v.r; // точка контакта — на борту машины трафика
          // Расталкиваем: машину на полосе не двигаем (её держит путь), сбитую — по массам.
          const depth = min - d, share = v.knock ? v.mass / (v.mass + PLAYER_M) : 1;
          car.contact = true;
          car.pos.x += nx * depth * share;
          car.pos.y += nz * depth * share;
          if (v.knock) { v.x -= nx * depth * (1 - share); v.z -= nz * depth * (1 - share); }
          // Относительная скорость точек контакта (с учётом вращения обоих).
          const rpx = px - car.pos.x, rpz = pz - car.pos.y;
          const ux = car.vel.x + car.yawV * rpz, uz = car.vel.y - car.yawV * rpx;
          const [tx, tz] = this.#pointVel(v, px, pz);
          const vn = (ux - tx) * nx + (uz - tz) * nz;
          if (vn >= 0) continue;
          if (vn > -HARD && !v.knock) {
            // Лёгкое касание машины на полосе — только не даём въехать в неё.
            car.vel.x -= vn * nx;
            car.vel.y -= vn * nz;
            continue;
          }
          const vt = (ux - tx) * -nz + (uz - tz) * nx;
          const [jx, jz] = Traffic.#impulse(nx, nz, vn, vt, PLAYER_M, PLAYER_K, rpx, rpz,
            v.mass, v.yk, px - v.x, pz - v.z);
          car.push(jx / PLAYER_M, jz / PLAYER_M, px, pz);
          const was = !!v.knock;
          if (!was && Math.hypot(jx, jz) / v.mass < KNOCK_DV) {
            // Автобус почти не сдвинуть: только встаёт.
            v.speed *= 0.3;
          } else {
            this.#knockOut(v);
            this.#push(v, -jx, -jz, px, pz);
          }
          if (vn < -HARD) {
            // Протаранили — долгий гудок, искры.
            if (v.hit <= 0 && v.honkCool <= 0) {
              this.honks.push({ x: v.x, z: v.z, bus: v.bus, long: true });
              v.honkCool = 3;
            }
            v.hit = 2.5;
            this.sparks.burst(px, car.y + 0.55, pz, nx, nz, Math.min(1, -vn / 20));
          }
        }
      }
    }
  }

  // Сбитая машина едет сама: скользит, крутится, тормозит, бьётся о стены. Встала — назад в полосу.
  #tumble(v, dt) {
    const k = v.knock;
    // Скорость в осях кузова: вдоль (lon) и поперёк (lat, ось (−dz, dx)).
    let lon = k.vx * v.dx + k.vz * v.dz, lat = -k.vx * v.dz + k.vz * v.dx;
    lon -= Math.sign(lon) * Math.min(Math.abs(lon), SLIDE_LON * dt);
    lat -= Math.sign(lat) * Math.min(Math.abs(lat), SLIDE_LAT * dt);
    k.vx = v.dx * lon - v.dz * lat;
    k.vz = v.dz * lon + v.dx * lat;
    k.w -= Math.sign(k.w) * Math.min(Math.abs(k.w), SPIN_DRAG * dt);
    v.x += k.vx * dt;
    v.z += k.vz * dt;
    v.heading += k.w * dt;
    v.dx = Math.sin(v.heading);
    v.dz = Math.cos(v.heading);
    // Стены: отскок с закруткой от плеча удара.
    for (const vo of v.circles) {
      const c = this.wallC.set(v.x + v.dx * vo, v.z + v.dz * vo);
      const bx = c.x, bz = c.y;
      const n = this.world.collide(c, v.r);
      if (!n) continue;
      v.x += c.x - bx;
      v.z += c.y - bz;
      const px = c.x - n.x * v.r, pz = c.y - n.z * v.r;
      const [ux, uz] = this.#pointVel(v, px, pz);
      const vn = ux * n.x + uz * n.z;
      if (vn >= 0) continue;
      const vt = ux * -n.z + uz * n.x;
      const [jx, jz] = Traffic.#impulse(n.x, n.z, vn, vt, v.mass, v.yk, px - v.x, pz - v.z, Infinity, 1, 0, 0);
      this.#push(v, jx, jz, px, pz);
      if (vn < -HARD) this.#bang(v, px, pz, n.x, n.z, -vn);
    }
    if (Math.hypot(k.vx, k.vz) < 0.3 && Math.abs(k.w) < 0.15) k.rest += dt;
    else k.rest = 0;
    if (k.rest > 1.2) {
      if (v.slot) { v.knock = null; v.speed = 0; v.slot.dead = true; } // сбитая по расписанию — стоит, пока не уедем
      else this.#rejoin(v);
    }
  }

  // Вернуть вставшую машину на полосу: место на ребре — проекция, а отличие от полосы (сдвиг и курс)
  // уходит плавно, пока она трогается (blend в #drive).
  #rejoin(v) {
    const e = v.edge;
    v.knock = null;
    v.s = Math.max(0, Math.min(e.len, (v.x - e.ax) * e.dx + (v.z - e.az) * e.dz));
    v.speed = 0;
    v.hit = Math.max(v.hit, 1.5);
    const [x, z, tx, tz] = this.#pose(v);
    const h = v.heading - Math.atan2(tx, tz);
    v.blend = { x: v.x - x, z: v.z - z, h: Math.atan2(Math.sin(h), Math.cos(h)) };
  }

  // Удар машины трафика обо что-то: искры и звук (если рядом с игроком — решает Sound.traffic).
  #bang(v, px, pz, nx, nz, speed) {
    const y = this.world.roadY(v.edge.road, px, pz) ?? this.world.ground(px, pz);
    const s = Math.min(1, speed / 20);
    this.sparks.burst(px, y + 0.55, pz, nx, nz, s);
    this.bangs.push({ x: px, z: pz, s });
  }

  // Сбитые машины сталкиваются с остальными: удар по массам; задетая на полосе тоже слетает с неё,
  // если толчок заметный (цепная авария), иначе сбитая отскакивает от неё, как от стены.
  #collideKnocked() {
    const vs = this.vehicles;
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i];
      if (!a.active || !a.knock) continue;
      for (let j = 0; j < vs.length; j++) {
        const b = vs[j];
        if (j === i || !b.active || (b.knock && j < i)) continue; // пару сбитых — один раз
        if (Math.abs(b.x - a.x) > 16 || Math.abs(b.z - a.z) > 16) continue;
        for (const ao of a.circles) {
          for (const bo of b.circles) {
            const ax = a.x + a.dx * ao, az = a.z + a.dz * ao, bx = b.x + b.dx * bo, bz = b.z + b.dz * bo;
            const d = Math.hypot(ax - bx, az - bz), min = a.r + b.r;
            if (d >= min || d < 1e-6) continue;
            const nx = (ax - bx) / d, nz = (az - bz) / d;
            const px = bx + nx * b.r, pz = bz + nz * b.r;
            const depth = min - d, share = b.knock ? b.mass / (a.mass + b.mass) : 1;
            a.x += nx * depth * share; a.z += nz * depth * share;
            if (b.knock) { b.x -= nx * depth * (1 - share); b.z -= nz * depth * (1 - share); }
            const [uax, uaz] = this.#pointVel(a, px, pz), [ubx, ubz] = this.#pointVel(b, px, pz);
            const vn = (uax - ubx) * nx + (uaz - ubz) * nz;
            if (vn >= 0) continue;
            const vt = (uax - ubx) * -nz + (uaz - ubz) * nx;
            let [jx, jz] = Traffic.#impulse(nx, nz, vn, vt, a.mass, a.yk, px - a.x, pz - a.z, b.mass, b.yk, px - b.x, pz - b.z);
            if (b.knock || Math.hypot(jx, jz) / b.mass >= KNOCK_DV) {
              this.#knockOut(b);
              this.#push(b, -jx, -jz, px, pz);
              b.hit = 2.5;
            } else {
              [jx, jz] = Traffic.#impulse(nx, nz, vn, vt, a.mass, a.yk, px - a.x, pz - a.z, Infinity, 1, 0, 0);
              b.speed *= 0.5;
            }
            this.#push(a, jx, jz, px, pz);
            if (vn < -HARD) this.#bang(a, px, pz, nx, nz, -vn);
          }
        }
      }
    }
  }

  // Трафик дымит только рядом с игроком.
  // Трафик общей гонки: машины по расписанию вдоль маршрута race (at — её старт, мс по часам сервера; от него и
  // случайные числа). Рёбра маршрута — улица (высота, звук ударов), можно ли по ним в эту сторону (односторонние) и
  // сдвиг полосы вправо от оси.
  #setLine(at) {
    for (const v of this.vehicles) { v.active = false; v.slot = null; v.knock = null; }
    this.line = null;
    if (at == null) return;
    const race = this.race, w = this.world, { route, cum, path } = race, L = race.length;
    const segs = [];
    for (let i = 1; i < route.length; i++) {
      const a = path[i - 1], b = path[i], road = w.graph.get(a)?.find((e) => e[0] === b)?.[2] ?? null;
      let fwd = true, back = true;
      if (road?.ow) { const k = road.n.indexOf(a); fwd = road.n[k + 1] === b; back = !fwd; }
      const [ax, az] = route[i - 1], [bx, bz] = route[i], len = cum[i] - cum[i - 1] || 1;
      segs.push({ road, fwd, back, off: road ? Math.max(1.6, road.w / 4) : 2, ax, az, len, dx: (bx - ax) / len, dz: (bz - az) / len });
    }
    let seed = (at % 2147483647) | 0;
    const rnd = () => { // mulberry32
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const kinds = Object.entries(LINE_MIX), sum = kinds.reduce((a, [, n]) => a + n, 0);
    const pick = () => { let r = rnd() * sum; for (const [k, n] of kinds) if ((r -= n) <= 0) return k; return kinds[0][0]; };
    const cars = [];
    for (const dir of [1, -1]) {
      for (let s = rnd() * LINE_GAP; s < L; s += LINE_GAP * (0.6 + rnd() * 0.8)) {
        const kind = pick(), colors = this.kinds.find((k) => k.key === kind).colors;
        cars.push({ s0: s, dir, kind, color: new THREE.Color(colors[(rnd() * colors.length) | 0]), v: null, dead: false });
      }
    }
    this.line = { at, segs, cars, L };
  }

  // Точка оси маршрута в s м от старта и номер ребра.
  #linePt(s) {
    const { segs, L } = this.line;
    s = Math.max(0, Math.min(L, s));
    let lo = 0, hi = segs.length - 1;
    const cum = this.race.cum;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (cum[m] <= s) lo = m; else hi = m - 1; }
    const e = segs[lo], k = Math.min(e.len, s - cum[lo]);
    return [e.ax + e.dx * k, e.az + e.dz * k, lo];
  }

  #lineUpdate(dt, px, pz) {
    const { cars, segs, L } = this.line, t = (this.race.clock() - this.line.at) / 1000;
    for (const c of cars) {
      const v = c.v;
      if (v) { v.honkCool -= dt; v.hit -= dt; }
      if (c.dead || v?.knock) { // сбили: стоит, где встала, пока не отъедем
        if (v && !v.knock && Math.hypot(v.x - px, v.z - pz) > SPAWN_MIN) { v.active = false; v.slot = null; c.v = null; }
        continue;
      }
      const s = (((c.s0 + c.dir * LINE_V * t) % L) + L) % L;
      const [cx, cz, i] = this.#linePt(s), e = segs[i];
      // Направление — по точкам в 5 м до и после (на изломе оси не скачет), сдвиг полосы — средний по трём точкам.
      const [ax, az] = this.#linePt(s - 5), [bx, bz] = this.#linePt(s + 5);
      const l = Math.hypot(bx - ax, bz - az) || 1, tx = (bx - ax) / l * c.dir, tz = (bz - az) / l * c.dir;
      const off = (segs[this.#linePt(s - 6)[2]].off + e.off + segs[this.#linePt(s + 6)[2]].off) / 3;
      const x = cx - tz * off, z = cz + tx * off;
      const show = s > LINE_END && s < L - LINE_END && (c.dir > 0 ? e.fwd : e.back) && Math.hypot(x - px, z - pz) < DESPAWN;
      if (!show) { if (v) { v.active = false; v.slot = null; c.v = null; } continue; }
      if (!v) {
        const free = this.vehicles.find((o) => !o.active && !o.slot && o.kind === c.kind);
        if (!free) continue; // все такие заняты — эту не видно
        Object.assign(free, { slot: c, active: true, knock: null, blend: null, hit: 0, acc: 0, roll: 0, rollV: 0, pitch: 0, pitchV: 0 });
        free.color.copy(c.color);
        c.v = free;
      }
      Object.assign(c.v, { x, z, dx: tx, dz: tz, heading: Math.atan2(tx, tz), speed: LINE_V, edge: e });
    }
  }

  #sync(dt, px, pz) {
    const p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), e = new THREE.Euler(0, 0, 0, 'YXZ');
    const w = this.world;
    // Активные машины — подряд в начало инстансов, mesh.count = их число: спрятанные нулевой матрицей
    // видеокарта всё равно обсчитывала — все 50 машин в кадре и в тенях.
    for (const k of this.kinds) k.used = 0;
    for (const v of this.vehicles) {
      if (!v.active) continue;
      // Наклон по поверхности, как у машины игрока: тангаж по осям колёс, крен по бокам.
      const fx = v.dx, fz = v.dz, rx = -fz, rz = fx, a = v.len * 0.32, b = v.bus ? 1.1 : 0.85;
      // Высота от своей дороги: под мостом — по нижней улице, а не по настилу над ней.
      const y = w.roadY(v.edge.road, v.x, v.z) ?? Infinity;
      const hf = w.ground(v.x + fx * a, v.z + fz * a, y), hb = w.ground(v.x - fx * a, v.z - fz * a, y);
      const hl = w.ground(v.x - rx * b, v.z - rz * b, y), hr = w.ground(v.x + rx * b, v.z + rz * b, y);
      p.set(v.x, Math.max(w.ground(v.x, v.z, y), (hf + hb) / 2), v.z);
      v.y = p.y;
      // Качка на подвеске после удара — пружина с демпфером.
      if (v.roll || v.rollV || v.pitch || v.pitchV) {
        const sdt = Math.min(dt, 1 / 30);
        v.rollV += (-v.roll * WOB_K - v.rollV * WOB_C) * sdt;
        v.pitchV += (-v.pitch * WOB_K - v.pitchV * WOB_C) * sdt;
        v.roll = Math.max(-WOB_MAX, Math.min(WOB_MAX, v.roll + v.rollV * sdt));
        v.pitch = Math.max(-WOB_MAX, Math.min(WOB_MAX, v.pitch + v.pitchV * sdt));
        if (Math.abs(v.roll) + Math.abs(v.rollV) + Math.abs(v.pitch) + Math.abs(v.pitchV) < 1e-3) v.roll = v.rollV = v.pitch = v.pitchV = 0;
      }
      e.set(-Math.atan2(hf - hb, 2 * a) + v.pitch, v.heading, Math.atan2(hl - hr, 2 * b) + v.roll);
      this.quat.setFromEuler(e);
      this.mat4.compose(p, this.quat, one);
      // Дальше drawFar машина едет, но не рисуется: там уже туман, а каждая — 4–10 тыс. треугольников.
      const d = Math.hypot(v.x - px, v.z - pz);
      if (d > this.drawFar) continue;
      const kind = v.meshes.kind, slot = kind.used++;
      for (const m of v.meshes) m.setMatrixAt(slot, this.mat4);
      v.meshes[kind.paint].setColorAt(slot, v.color);
      if (d < 60) {
        const throttle = Math.min(1, Math.max(0, v.acc / 2.8));
        this.smoke.emit(dt, v.smoke, this.mat4, v.pipe, v.dx * v.speed, v.dz * v.speed, v.speed, throttle, v.bus ? 1 : 0.7);
      }
    }
    this.smoke.step(dt);
    this.sparks.update(dt);
    for (const k of this.kinds) {
      for (const m of k.meshes) {
        m.count = k.used;
        m.visible = k.used > 0; // пустой — всё равно вызов отрисовки
        m.instanceMatrix.needsUpdate = true;
      }
      k.meshes[k.paint].instanceColor.needsUpdate = true;
    }
  }
}

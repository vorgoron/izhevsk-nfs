// Трафик: машины и автобусы по графу улиц вокруг игрока. Правостороннее движение,
// односторонние улицы, торможение перед впереди идущими и перед игроком, столкновения.
import * as THREE from 'three';
import { MODELS, vehicleParts, prism, withArches, wheelArches, ARCH_GAP } from './vehicles.js';
import { ExhaustFX } from './effects.js';

// Скорость по классу дороги, м/с. Нет в списке — трафика там нет (дворы, проезды).
const SPEED = {
  trunk: 16, primary: 15, secondary: 14, tertiary: 12, unclassified: 9, residential: 8, living_street: 5,
  trunk_link: 11, primary_link: 11, secondary_link: 10, tertiary_link: 9,
};
// Состав потока: ижевские машины (vehicles.js) и автобусы.
const MIX = { oda: 10, m412: 7, kombi: 6, kabluk: 5, odavan: 4, vesta: 13 };
const BUSES = 6;
const SPAWN_MIN = 140, SPAWN_MAX = 420, DESPAWN = 480;
const GRID = 100; // м: клетка сетки рёбер
const CORNER = 9; // м: столько до узла и после него поворот идёт по кривой, а не углом
const BUS_PALETTE = ['#f2c230', '#e8e8e8', '#3d8f4f', '#d9442f'];
const PLAYER_R = 1.15, PLAYER_AXLE = 1.25; // как в car.js

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
    this.honks = []; // гудки за кадр: { x, z, bus, long } — забирает Sound.traffic
    this.#buildGraph();

    // Каждый тип — набор InstancedMesh с общими индексами: кузов (цвет от инстанса), детали, фары.
    const lit = new THREE.MeshLambertMaterial({ vertexColors: true });
    const glow = new THREE.MeshBasicMaterial({ vertexColors: true });
    const kinds = Object.entries(MIX).map(([key, count]) => {
      const p = vehicleParts(MODELS[key], { wheelsInDetail: true });
      return { key, count, len: p.length, colors: MODELS[key].colors, paint: 0,
        meshes: [new THREE.InstancedMesh(p.paint, lit, count), new THREE.InstancedMesh(p.detail, lit, count),
          new THREE.InstancedMesh(p.lights, glow, count)] };
    });
    const bus = busGeometry();
    kinds.push({ key: 'bus', count: BUSES, len: 11.5, colors: BUS_PALETTE, paint: 0,
      meshes: [new THREE.InstancedMesh(bus.paint, lit, BUSES), new THREE.InstancedMesh(bus.detail, lit, BUSES)] });
    this.meshes = kinds.flatMap((k) => k.meshes);
    const c = new THREE.Color();
    this.vehicles = [];
    let n = 0;
    for (const kind of kinds) {
      const bus = kind.key === 'bus';
      for (let idx = 0; idx < kind.count; idx++, n++) {
        kind.meshes[kind.paint].setColorAt(idx, c.set(kind.colors[(idx * 3 + n) % kind.colors.length]));
        this.vehicles.push({
          meshes: kind.meshes, idx, bus, kind: kind.key,
          len: kind.len,
          // Выхлопная труба слева сзади; ускорение — для густоты дыма.
          acc: 0, smoke: { carry: Math.random() },
          pipe: new THREE.Vector3(bus ? -0.9 : -0.45, bus ? 0.45 : 0.33, -kind.len / 2 - 0.1),
          r: bus ? 1.3 : 1.1,
          circles: bus ? [-4.5, -1.5, 1.5, 4.5] : [-1.2, 1.2], // коллайдеры вдоль кузова
          maxSpeed: bus ? 11 : 17 * (MODELS[kind.key]?.stats.kmh ?? 160) / 160,
          mood: 0.85 + ((n * 37) % 30) / 100, // кто-то едет бодрее
          edge: null, next: null, s: 0, speed: 0,
          x: 0, z: 0, heading: 0, dx: 0, dz: 1, hit: 0, stuck: 0, ghost: 0, active: false,
          waitPlayer: 0, honkCool: 0,
        });
      }
    }
    for (const m of this.meshes) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false; // инстансы разбросаны по карте, сфера геометрии им не подходит
      scene.add(m);
    }
    this.mat4 = new THREE.Matrix4();
    this.quat = new THREE.Quaternion();
    this.up = new THREE.Vector3(0, 1, 0);
    this.hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    this.smoke = new ExhaustFX(scene, 400);
  }

  // Направленный граф полос: двусторонняя улица — два ребра со сдвигом вправо.
  #buildGraph() {
    const w = this.world;
    this.out = new Map();
    this.edges = [];
    this.grid = new Map();
    const add = (a, b, road, forward) => {
      const [ax, az] = w.nodes[a], [bx, bz] = w.nodes[b];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.05) return;
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
      Object.assign(v, { edge: e, next: this.#choose(e), prev: null, off, sk: 1, s, x, z, dx: e.dx, dz: e.dz, heading: Math.atan2(e.dx, e.dz), acc: 0,
        lane, laneCool: 0, slowT: 0, speed: e.v * 0.6, hit: 0, stuck: 0, ghost: 0, active: true });
      return;
    }
    v.active = false;
  }

  // Расставить трафик вокруг точки (старт, респаун).
  reset(px, pz) {
    for (const v of this.vehicles) v.active = false;
    for (const v of this.vehicles) this.#spawn(v, px, pz, 25);
  }

  setEnabled(on) {
    this.enabled = on;
    for (const m of this.meshes) m.visible = on;
    this.smoke.points.visible = on;
  }

  update(dt, car) {
    if (!this.enabled) return;
    const px = car.pos.x, pz = car.pos.y;
    for (const v of this.vehicles) {
      if (!v.active || Math.hypot(v.x - px, v.z - pz) > DESPAWN) this.#spawn(v, px, pz, SPAWN_MIN);
      if (v.active) this.#drive(v, dt, car);
    }
    this.#separate();
    this.#collidePlayer(car);
    this.#sync(dt, px, pz);
  }

  #drive(v, dt, car) {
    const e = v.edge;
    let limit = Math.min(v.maxSpeed, e.v) * v.mood;

    // Крутой поворот впереди — сбросить скорость.
    const rest = e.len - v.s;
    if (v.next) {
      const cos = v.next.dx * e.dx + v.next.dz * e.dz;
      if (cos < 0.75 && rest < 25) limit = Math.min(limit, 4 + rest * 0.5 + cos * 3);
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
        if (o !== v && o.active && check(o.x, o.z, o.len, true, o.dx, o.dz)) blockedByTraffic = true;
      }
    }
    const f = car.forward;
    const byPlayer = check(car.pos.x, car.pos.y, 4.3, false, f.x, f.y);

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
      v.prev = v.edge;
      v.edge = v.next;
      v.next = this.#choose(v.edge);
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
    let dh = Math.atan2(tx, tz) - Math.max(-0.2, Math.min(0.2, side)) - v.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    v.heading += dh * Math.min(1, dt * 10);
    v.dx = Math.sin(v.heading);
    v.dz = Math.cos(v.heading);
  }

  // Точка машины на пути и направление пути [x, z, dx, dz]. У узла путь — кубическая кривая от полосы
  // прежнего ребра к полосе следующего (на прямой — та же прямая), иначе угол срезается рывком.
  #pose(v) {
    const e = v.edge;
    v.sk = 1;
    let c = null, u;
    if (v.next && v.next.a === e.b) {
      c = this.#corner(e, v.next, v.off);
      if (e.len - v.s < c.inA) u = (v.s - e.len + c.inA) / (c.inA + c.outB);
      else c = null;
    }
    if (!c && v.prev && v.prev.b === e.a) {
      c = this.#corner(v.prev, e, v.off);
      if (v.s < c.outB) u = (v.s + c.inA) / (c.inA + c.outB);
      else c = null;
    }
    if (!c) return [e.ax + e.dx * v.s - e.dz * v.off, e.az + e.dz * v.s + e.dx * v.off, e.dx, e.dz];
    // Ручки — к точке пересечения полос, 2/3 расстояния до неё: на прямой кривая проходится равномерно.
    const { a, b, dA, dB, cx, cz } = c, hA = (2 / 3) * Math.max(dA, 0.5), hB = (2 / 3) * Math.max(dB, 0.5);
    const p0x = cx - a.dx * dA, p0z = cz - a.dz * dA, p3x = cx + b.dx * dB, p3z = cz + b.dz * dB;
    const p1x = p0x + a.dx * hA, p1z = p0z + a.dz * hA, p2x = p3x - b.dx * hB, p2z = p3z - b.dz * hB;
    const t = Math.max(0, Math.min(1, u)), m = 1 - t;
    const k0 = m * m * m, k1 = 3 * m * m * t, k2 = 3 * m * t * t, k3 = t * t * t;
    const d0 = m * m, d1 = 2 * m * t, d2 = t * t;
    let dx = d0 * (p1x - p0x) + d1 * (p2x - p1x) + d2 * (p3x - p2x), dz = d0 * (p1z - p0z) + d1 * (p2z - p1z) + d2 * (p3z - p2z);
    const l = Math.hypot(dx, dz);
    if (l > 1e-6) { dx /= l; dz /= l; } else { dx = b.dx; dz = b.dz; }
    // Длина кривой (по хордам) → во сколько раз медленнее идёт s по оси, чтобы скорость по полосе была настоящей.
    let len = 0, qx = p0x, qz = p0z;
    for (let i = 1; i <= 8; i++) {
      const tt = i / 8, mm = 1 - tt, a0 = mm * mm * mm, a1 = 3 * mm * mm * tt, a2 = 3 * mm * tt * tt, a3 = tt * tt * tt;
      const nx = a0 * p0x + a1 * p1x + a2 * p2x + a3 * p3x, nz = a0 * p0z + a1 * p1z + a2 * p2z + a3 * p3z;
      len += Math.hypot(nx - qx, nz - qz); qx = nx; qz = nz;
    }
    v.sk = (c.inA + c.outB) / Math.max(len, 0.1);
    return [k0 * p0x + k1 * p1x + k2 * p2x + k3 * p3x, k0 * p0z + k1 * p1z + k2 * p2z + k3 * p3z, dx, dz];
  }

  // Поворот с ребра a на ребро b на полосе со сдвигом off. Кривая строится вокруг точки (cx, cz), где
  // пересекаются линии полос (на повороте направо она до узла, налево — за ним), на CORNER в обе стороны;
  // inA — за сколько до конца a кривая начинается, outB — через сколько от начала b кончается (не дальше
  // середины ребра — чтобы не налезать на соседний поворот); dA, dB — от начала и конца кривой до (cx, cz).
  // Считать от самого узла нельзя: на повороте направо полоса пересекает поперечную раньше узла,
  // и кривая от узла шла бы назад — машина крутилась петлёй.
  #corner(a, b, off) {
    const cr = a.dx * b.dz - a.dz * b.dx;
    let x = 0, y = 0; // где пересекаются полосы: x — вдоль a от узла, y — вдоль b от узла
    if (Math.abs(cr) > 0.05) {
      const wx = off * (a.dz - b.dz), wz = off * (b.dx - a.dx); // off · (правая b − правая a)
      x = Math.max(-15, Math.min(15, (wx * b.dz - wz * b.dx) / cr));
      y = Math.max(-15, Math.min(15, -(a.dx * wz - a.dz * wx) / cr));
    }
    const inA = Math.max(0.5, Math.min(a.len / 2, CORNER - x)), outB = Math.max(0.5, Math.min(b.len / 2, CORNER + y));
    const s = a.len + x;
    return { a, b, inA, outB, dA: inA + x, dB: outB - y, cx: a.ax + a.dx * s - a.dz * off, cz: a.az + a.dz * s + a.dx * off };
  }

  // Страховка: если две попутные машины всё же наехали друг на друга (слияние полос, развилка,
  // перестроение), задняя откатывается назад вдоль своего ребра и встаёт.
  #separate() {
    const vs = this.vehicles.filter((v) => v.active);
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i];
      for (let j = i + 1; j < vs.length; j++) {
        const b = vs[j];
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
      }
    }
  }

  #collidePlayer(car) {
    if (car.ghostVehicles > 0) return; // выезжаем из зажатия
    const f = car.forward;
    for (const v of this.vehicles) {
      if (!v.active || Math.hypot(v.x - car.pos.x, v.z - car.pos.y) > 16) continue;
      for (const so of [PLAYER_AXLE, -PLAYER_AXLE]) {
        for (const vo of v.circles) {
          const cx = car.pos.x + f.x * so, cz = car.pos.y + f.y * so;
          const ox = v.x + v.dx * vo, oz = v.z + v.dz * vo;
          const d = Math.hypot(cx - ox, cz - oz), min = PLAYER_R + v.r;
          if (d >= min || d < 1e-6) continue;
          const nx = (cx - ox) / d, nz = (cz - oz) / d;
          // Относительная скорость вдоль нормали: трафик тяжёлый, отскакивает в основном игрок.
          // Встаёт машина трафика только от удара (не от того, что о неё трутся — иначе стоит вечно).
          const vn = (car.vel.x - v.dx * v.speed) * nx + (car.vel.y - v.dz * v.speed) * nz;
          if (car.touchVehicle(nx, nz, min - d, vn)) {
            // Протаранили — долгий гудок.
            if (v.hit <= 0 && v.honkCool <= 0) {
              this.honks.push({ x: v.x, z: v.z, bus: v.bus, long: true });
              v.honkCool = 3;
            }
            v.speed *= 0.3;
            v.hit = 2.5;
          }
        }
      }
    }
  }

  // Трафик дымит только рядом с игроком.
  #sync(dt, px, pz) {
    const p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), e = new THREE.Euler(0, 0, 0, 'YXZ');
    const w = this.world;
    for (const v of this.vehicles) {
      if (!v.active) { for (const m of v.meshes) m.setMatrixAt(v.idx, this.hidden); continue; }
      // Наклон по поверхности, как у машины игрока: тангаж по осям колёс, крен по бокам.
      const fx = v.dx, fz = v.dz, rx = -fz, rz = fx, a = v.len * 0.32, b = v.bus ? 1.1 : 0.85;
      // Высота от своей дороги: под мостом — по нижней улице, а не по настилу над ней.
      const y = w.roadY(v.edge.road, v.x, v.z) ?? Infinity;
      const hf = w.ground(v.x + fx * a, v.z + fz * a, y), hb = w.ground(v.x - fx * a, v.z - fz * a, y);
      const hl = w.ground(v.x - rx * b, v.z - rz * b, y), hr = w.ground(v.x + rx * b, v.z + rz * b, y);
      p.set(v.x, Math.max(w.ground(v.x, v.z, y), (hf + hb) / 2), v.z);
      e.set(-Math.atan2(hf - hb, 2 * a), v.heading, Math.atan2(hl - hr, 2 * b));
      this.quat.setFromEuler(e);
      this.mat4.compose(p, this.quat, one);
      for (const m of v.meshes) m.setMatrixAt(v.idx, this.mat4);
      if (Math.hypot(v.x - px, v.z - pz) < 60) {
        const throttle = Math.min(1, Math.max(0, v.acc / 2.8));
        this.smoke.emit(dt, v.smoke, this.mat4, v.pipe, v.dx * v.speed, v.dz * v.speed, v.speed, throttle, v.bus ? 1 : 0.7);
      }
    }
    this.smoke.step(dt);
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }
}

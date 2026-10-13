// Очереди на заправках: машины стоят от колонки через въезд и дальше вдоль обочины улицы.
// Раз в 10–20 с головная машина заправилась и уехала — остальные подтягиваются, в хвост встаёт новая.
import * as THREE from 'three';
import { MODELS, vehicleParts } from './vehicles.js';

const SLOT = 5.6;             // м между машинами в очереди
const CARS = 26;              // машин в очереди
const ACTIVE = 1000;          // м: очереди дальше не рисуем и не двигаем
const MINOR = new Set(['service', 'living_street']);
const MOVE_TIME = 2.2;        // с: подтягивание на одно место
const KINDS = ['oda', 'oda', 'm412', 'kombi', 'kabluk', 'odavan', 'vesta', 'm412'];
const PLAYER_R = 1.15, PLAYER_AXLE = 1.25;

function rnd(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

export class Queues {
  constructor(world, fuel, scene) {
    this.world = world;
    const r = rnd(4242);
    this.queues = [];
    for (const st of fuel.stations) {
      if (!st.pumps?.length || !st.entry) continue;
      const path = this.#path(st);
      if (!path) continue;
      const len = pathLength(path);
      const n = Math.min(CARS, Math.floor(len / SLOT));
      const cars = [];
      for (let i = 0; i < n; i++) cars.push(this.#newCar(r));
      this.queues.push({ st, path, len, cars, timer: 6 + r() * 10, shift: 0, r });
    }

    // InstancedMesh-тройки на модель, ёмкость — на все очереди сразу.
    const total = Math.min(this.queues.length, 8) * CARS; // одновременно рядом — не больше 8 заправок
    const lit = new THREE.MeshLambertMaterial({ vertexColors: true });
    const glow = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.kinds = {};
    for (const key of new Set(KINDS)) {
      const p = vehicleParts(MODELS[key], { wheelsInDetail: true });
      const meshes = [new THREE.InstancedMesh(p.paint, lit, total), new THREE.InstancedMesh(p.detail, lit, total),
        new THREE.InstancedMesh(p.lights, glow, total)];
      for (const m of meshes) {
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.frustumCulled = false;
        m.castShadow = m.receiveShadow = true;
        scene.add(m);
      }
      meshes[0].setColorAt(0, new THREE.Color('#fff')); // создать instanceColor
      this.kinds[key] = meshes;
    }
    this.m = new THREE.Matrix4();
    this.e = new THREE.Euler(0, 0, 0, 'YXZ');
    this.q = new THREE.Quaternion();
    this.p = new THREE.Vector3();
    this.one = new THREE.Vector3(1, 1, 1);
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
  }

  #newCar(r) {
    const kind = KINDS[Math.floor(r() * KINDS.length)];
    const colors = MODELS[kind].colors;
    return { kind, color: colors[Math.floor(r() * colors.length)] };
  }

  // Путь очереди: у колонки → въезд → на обочину ближайшей улицы (не двора) → назад вдоль улицы
  // против движения, повторяя её изгибы.
  #path(st) {
    const w = this.world, pump = st.pumps[0];
    const p0 = [pump.x + pump.vx * 3.2, pump.z + pump.vz * 3.2];
    // Ближайшая улица к территории АЗС.
    let best = null;
    for (const s of w.segmentsNear(st.cx, st.cz, Math.max(st.len, st.wid) / 2 + 120)) {
      if (MINOR.has(s.road.k)) continue;
      for (const [x, z] of st.p) {
        const c = w.constructor.closest(s, x, z);
        if (!best || c.d < best.d) best = { ...c, s, x, z };
      }
    }
    if (!best) return null; // рядом нет улицы — без очереди
    const { s: seg, x: ex, z: ez } = best, road = seg.road;
    const nodes = road.n.map((i) => w.nodes[i]);
    let i = nodes.findIndex((p, k) => k > 0 && nodes[k - 1][0] === seg.ax && nodes[k - 1][1] === seg.az && p[0] === seg.bx && p[1] === seg.bz);
    if (i < 0) i = 1;
    // Сторона АЗС относительно направления ребра a→b.
    const dx = seg.bx - seg.ax, dz = seg.bz - seg.az;
    const right = (ex - best.px) * -dz + (ez - best.pz) * dx > 0; // АЗС справа от a→b
    // Справа от направления движения стоит очередь: при АЗС справа едут a→b, хвост тянется к a.
    const back = right ? -1 : 1;
    const curb = seg.w / 2 + 0.6; // на обочине, за краем полотна: крайняя правая полоса — для трафика
    const offset = ([x, z], [nx, nz]) => [x + nx * curb, z + nz * curb];
    // Нормаль к АЗС: обходим против движения, АЗС справа от движения — то есть (tz, -tx) от обхода.
    const sideN = (ax, az, bx, bz) => {
      const L = Math.hypot(bx - ax, bz - az) || 1;
      return [(bz - az) / L, -(bx - ax) / L];
    };
    const path = [p0, [ex, ez]];
    let prev = [best.px, best.pz], k = back < 0 ? i - 1 : i, total = 0;
    path.push(offset(prev, sideN(prev[0], prev[1], nodes[k][0], nodes[k][1])));
    while (total < 240 && k >= 0 && k < nodes.length) {
      const nxt = nodes[k];
      total += Math.hypot(nxt[0] - prev[0], nxt[1] - prev[1]);
      path.push(offset(nxt, sideN(prev[0], prev[1], nxt[0], nxt[1])));
      prev = nxt;
      k += back;
    }
    // Улица кончилась раньше — продолжаем по прямой.
    if (total < 240) {
      const a = path[path.length - 2], b = path[path.length - 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      path.push([b[0] + ((b[0] - a[0]) / L) * (240 - total), b[1] + ((b[1] - a[1]) / L) * (240 - total)]);
    }
    return path;
  }

  update(dt, car) {
    // Рисуем и двигаем только очереди рядом с игроком (в городе десятки заправок).
    const dist = (q) => Math.hypot(q.path[1][0] - car.pos.x, q.path[1][1] - car.pos.y);
    this.active = this.queues.filter((q) => dist(q) < ACTIVE).sort((a, b) => dist(a) - dist(b)).slice(0, 8);
    for (const q of this.active) {
      // Подошла очередь: голова уезжает, все подтягиваются, хвост пополняется.
      q.timer -= dt;
      if (q.timer <= 0 && q.shift === 0) {
        q.shift = 1;
        q.cars.shift();
        q.cars.push(this.#newCar(q.r));
        q.timer = 10 + q.r() * 10;
      }
      if (q.shift > 0) q.shift = Math.max(0, q.shift - dt / MOVE_TIME);
    }
    this.#collidePlayer(car);
    this.#sync();
  }

  // Позиция i-й машины: место i, при подтягивании — плавно из места i+1.
  #pose(q, i) {
    const k = q.shift > 0 ? i + (1 - smooth(1 - q.shift)) : i;
    const at = pointAt(q.path, k * SLOT);
    return { x: at.x, z: at.z, dx: at.dx, dz: at.dz };
  }

  #collidePlayer(car) {
    if (car.ghostVehicles > 0) return; // выезжаем из зажатия
    const f = car.forward;
    for (const q of this.active) {
      if (Math.hypot(q.path[1][0] - car.pos.x, q.path[1][1] - car.pos.y) > q.len + 30) continue;
      q.cars.forEach((_, i) => {
        const v = this.#pose(q, i);
        if (Math.hypot(v.x - car.pos.x, v.z - car.pos.y) > 8) return;
        for (const so of [PLAYER_AXLE, -PLAYER_AXLE]) {
          for (const vo of [-1.2, 1.2]) {
            const cx = car.pos.x + f.x * so, cz = car.pos.y + f.y * so;
            // Машина в очереди смотрит к колонке: вперёд — против направления пути.
            const ox = v.x - v.dx * vo, oz = v.z - v.dz * vo;
            const d = Math.hypot(cx - ox, cz - oz), min = PLAYER_R + 1.1;
            if (d >= min || d < 1e-6) continue;
            const nx = (cx - ox) / d, nz = (cz - oz) / d;
            car.touchVehicle(nx, nz, min - d, car.vel.x * nx + car.vel.y * nz);
          }
        }
      });
    }
  }

  #sync() {
    const used = {};
    const w = this.world, c = new THREE.Color();
    for (const q of this.active) {
      q.cars.forEach((cv, i) => {
        const v = this.#pose(q, i);
        const meshes = this.kinds[cv.kind];
        const idx = (used[cv.kind] = (used[cv.kind] ?? -1) + 1);
        // Вперёд — к колонке (против направления пути), наклон по поверхности.
        const fx = -v.dx, fz = -v.dz, a = 1.3;
        const hf = w.ground(v.x + fx * a, v.z + fz * a), hb = w.ground(v.x - fx * a, v.z - fz * a);
        this.p.set(v.x, Math.max(w.ground(v.x, v.z), (hf + hb) / 2), v.z);
        this.e.set(-Math.atan2(hf - hb, 2 * a), Math.atan2(fx, fz), 0);
        this.m.compose(this.p, this.q.setFromEuler(this.e), this.one);
        for (const m of meshes) m.setMatrixAt(idx, this.m);
        meshes[0].setColorAt(idx, c.set(cv.color));
      });
    }
    for (const [key, meshes] of Object.entries(this.kinds)) {
      for (let i = (used[key] ?? -1) + 1; i < meshes[0].count; i++) for (const m of meshes) m.setMatrixAt(i, this.zero);
      for (const m of meshes) m.instanceMatrix.needsUpdate = true;
      meshes[0].instanceColor.needsUpdate = true;
    }
  }
}

const smooth = (t) => t * t * (3 - 2 * t);

function pathLength(p) {
  let l = 0;
  for (let i = 1; i < p.length; i++) l += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return l;
}

// Точка на ломаной по длине от начала и направление пути в ней.
function pointAt(p, d) {
  for (let i = 1; i < p.length; i++) {
    const dx = p[i][0] - p[i - 1][0], dz = p[i][1] - p[i - 1][1], L = Math.hypot(dx, dz);
    if (d <= L || i === p.length - 1) {
      const t = L ? d / L : 0;
      return { x: p[i - 1][0] + dx * t, z: p[i - 1][1] + dz * t, dx: dx / (L || 1), dz: dz / (L || 1) };
    }
    d -= L;
  }
  return { x: p[0][0], z: p[0][1], dx: 1, dz: 0 };
}

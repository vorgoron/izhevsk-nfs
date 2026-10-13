// Трафик: машины и автобусы по графу улиц вокруг игрока. Правостороннее движение,
// односторонние улицы, торможение перед впереди идущими и перед игроком, столкновения.
import * as THREE from 'three';
import { MODELS, vehicleParts } from './vehicles.js';

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
const BUS_PALETTE = ['#f2c230', '#e8e8e8', '#3d8f4f', '#d9442f'];
const PLAYER_R = 1.15, PLAYER_AXLE = 1.25; // как в car.js

// ---------------------------------------------------------------- модели: одна геометрия, цвет кузова — от инстанса

function merged(parts) {
  const pos = [], nor = [], col = [];
  const c = new THREE.Color();
  for (const [geo, color, x, y, z] of parts) {
    const g = geo.toNonIndexed().translate(x, y, z);
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

function busGeometry() {
  const parts = [
    [box(2.5, 2.4, 11.5), '#fff', 0, 1.65, 0],
    [box(2.54, 0.9, 10.6), '#22303a', 0, 2.0, -0.2], // окна по бокам
    [box(2.3, 1.1, 0.05), '#22303a', 0, 2.0, 5.76], // лобовое
    [box(2.4, 0.15, 11.2), '#cfd2d6', 0, 2.92, 0],
  ];
  for (const sx of [-0.9, 0.9]) parts.push([box(0.35, 0.2, 0.05), '#fff6d0', sx, 0.8, 5.76], [box(0.35, 0.25, 0.05), '#ff2a1a', sx, 0.9, -5.76]);
  for (const [x, z] of [[-1.1, 3.8], [1.1, 3.8], [-1.1, -3.4], [1.1, -3.4]]) parts.push([wheel(0.5), '#151618', x, 0.5, z]);
  return merged(parts);
}

// ---------------------------------------------------------------- трафик

export class Traffic {
  constructor(world, scene) {
    this.world = world;
    this.enabled = true;
    this.signals = null; // выставляет Signals
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
    kinds.push({ key: 'bus', count: BUSES, len: 11.5, colors: BUS_PALETTE, paint: 0,
      meshes: [new THREE.InstancedMesh(busGeometry(), lit, BUSES)] });
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
          r: bus ? 1.3 : 1.1,
          circles: bus ? [-4.5, -1.5, 1.5, 4.5] : [-1.2, 1.2], // коллайдеры вдоль кузова
          maxSpeed: bus ? 11 : 17 * (MODELS[kind.key]?.stats.kmh ?? 160) / 160,
          mood: 0.85 + ((n * 37) % 30) / 100, // кто-то едет бодрее
          edge: null, next: null, s: 0, speed: 0,
          x: 0, z: 0, heading: 0, dx: 0, dz: 1, hit: 0, stuck: 0, ghost: 0, active: false,
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
  }

  // Направленный граф полос: двусторонняя улица — два ребра со сдвигом вправо.
  #buildGraph() {
    const w = this.world;
    this.out = new Map();
    this.edges = [];
    this.grid = new Map();
    const add = (a, b, road) => {
      const [ax, az] = w.nodes[a], [bx, bz] = w.nodes[b];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.05) return;
      const e = {
        a, b, ax, az, len, dx: (bx - ax) / len, dz: (bz - az) / len,
        off: road.ow ? 0 : Math.min(road.w / 4, 3.4), v: SPEED[road.k], w: road.w, road,
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
        add(r.n[i - 1], r.n[i], r);
        if (!r.ow) add(r.n[i], r.n[i - 1], r);
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
      const x = e.ax + e.dx * s - e.dz * e.off, z = e.az + e.dz * s + e.dx * e.off;
      const d = Math.hypot(x - px, z - pz);
      if (d < minD || d > SPAWN_MAX) continue;
      if (this.vehicles.some((o) => o.active && Math.hypot(o.x - x, o.z - z) < 14)) continue;
      Object.assign(v, { edge: e, next: this.#choose(e), s, x, z, dx: e.dx, dz: e.dz, heading: Math.atan2(e.dx, e.dz),
        speed: e.v * 0.6, hit: 0, stuck: 0, ghost: 0, active: true });
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
  }

  update(dt, car) {
    if (!this.enabled) return;
    const px = car.pos.x, pz = car.pos.y;
    for (const v of this.vehicles) {
      if (!v.active || Math.hypot(v.x - px, v.z - pz) > DESPAWN) this.#spawn(v, px, pz, SPAWN_MIN);
      if (v.active) this.#drive(v, dt, car);
    }
    this.#collidePlayer(car);
    this.#sync();
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
        const stop = dist - ap.stopBack;
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
      if (sameDirOnly && odx * v.dx + odz * v.dz < 0.5) return false;
      const gap = ahead - (v.len + olen) / 2;
      limit = Math.min(limit, Math.max(0, (gap - 2.5) * 0.8));
      return true;
    };
    if (v.ghost <= 0) {
      for (const o of this.vehicles) {
        if (o !== v && o.active && check(o.x, o.z, o.len, true, o.dx, o.dz)) blockedByTraffic = true;
      }
    }
    const f = car.forward;
    check(car.pos.x, car.pos.y, 4.3, false, f.x, f.y);

    // Застряли в пробке из таких же (не очередь на светофоре) — ненадолго «не замечаем» соседей, чтобы рассосалось.
    v.ghost = Math.max(0, v.ghost - dt);
    if (blockedByTraffic && v.speed < 0.3) v.stuck += dt;
    else v.stuck = 0;
    if (v.stuck > 20) { v.ghost = 2; v.stuck = 0; } // дольше цикла светофора: очередь на красный не трогаем

    // Удар от игрока: постоять.
    if (v.hit > 0) { v.hit -= dt; limit = 0; }

    v.speed += Math.max(-9 * dt, Math.min(2.8 * dt, limit - v.speed));
    v.s += v.speed * dt;
    while (v.s > v.edge.len) {
      v.s -= v.edge.len;
      if (!v.next) { v.active = false; return; }
      v.edge = v.next;
      v.next = this.#choose(v.edge);
    }

    // Целевая точка на полосе; визуально догоняем плавно, чтобы на углах не дёргалось.
    const ce = v.edge;
    const tx = ce.ax + ce.dx * v.s - ce.dz * ce.off, tz = ce.az + ce.dz * v.s + ce.dx * ce.off;
    const k = Math.min(1, dt * 6);
    v.x += (tx - v.x) * k;
    v.z += (tz - v.z) * k;
    let dh = Math.atan2(ce.dx, ce.dz) - v.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    v.heading += dh * Math.min(1, dt * 5);
    v.dx = Math.sin(v.heading);
    v.dz = Math.cos(v.heading);
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
            v.speed *= 0.3;
            v.hit = 2.5;
          }
        }
      }
    }
  }

  #sync() {
    const p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), e = new THREE.Euler(0, 0, 0, 'YXZ');
    const w = this.world;
    for (const v of this.vehicles) {
      if (!v.active) { for (const m of v.meshes) m.setMatrixAt(v.idx, this.hidden); continue; }
      // Наклон по поверхности, как у машины игрока: тангаж по осям колёс, крен по бокам.
      const fx = v.dx, fz = v.dz, rx = -fz, rz = fx, a = v.len * 0.32, b = v.bus ? 1.1 : 0.85;
      const hf = w.ground(v.x + fx * a, v.z + fz * a), hb = w.ground(v.x - fx * a, v.z - fz * a);
      const hl = w.ground(v.x - rx * b, v.z - rz * b), hr = w.ground(v.x + rx * b, v.z + rz * b);
      p.set(v.x, Math.max(w.ground(v.x, v.z), (hf + hb) / 2), v.z);
      e.set(-Math.atan2(hf - hb, 2 * a), v.heading, Math.atan2(hl - hr, 2 * b));
      this.quat.setFromEuler(e);
      this.mat4.compose(p, this.quat, one);
      for (const m of v.meshes) m.setMatrixAt(v.idx, this.mat4);
    }
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }
}

// Открытые парковки (parkings в city.json, parking_lots в fetch_city.py): белая разметка мест и машины на части мест.
// Разметка строится для парковок рядом с игроком и выгружается, когда отъехал; машины — общие InstancedMesh по моделям,
// ставятся на ближайшие занятые места. Стоят намертво — машина игрока упирается в них, как в очередь на АЗС.
import * as THREE from 'three';
import { MODELS, vehicleParts } from './vehicles.js';

export const PARK_W = 2.6, PARK_D = 5; // м: как в fetch_city.py
const NEAR = 260;      // м: разметка парковок ближе — строится, дальше NEAR + 120 — выгружается
const CARS = 24;       // машин на парковках одновременно (ближайшие к игроку)
const BUSY = 0.3;      // доля занятых мест
const LINE = 0.12;     // м: ширина линии разметки
const KINDS = ['oda', 'oda', 'm412', 'kombi', 'kabluk', 'vesta', 'vesta', 'm412', 'pickup', 'largus', 'largus', 'elargus'];
const PLAYER_R = 1.15, PLAYER_AXLE = 1.25; // как в car.js

// Детерминированное «случайное» число места: у всех игроков одни и те же машины на тех же местах.
const hash = (a, b) => {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export class Parkings {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    this.far = 200; // м: машины дальше не ставим (уровень графики — main.js)
    this.lots = (world.city.parkings || []).map((lot, li) => {
      const [ox, oz] = lot.o, [ux, uz] = lot.u, vx = -uz, vz = ux;
      const stalls = [];
      for (const [t, face, ...runs] of lot.r) {
        for (let r = 0; r < runs.length; r += 2) {
          for (let k = runs[r]; k < runs[r] + runs[r + 1]; k++) {
            const s = (k + 0.5) * PARK_W, d = t + PARK_D / 2;
            // Носом от проезда: при стороне 1 проезд за рядом по +v — машина смотрит в -v.
            stalls.push({ x: ox + ux * s + vx * d, z: oz + uz * s + vz * d, fx: -vx * face, fz: -vz * face, ux, uz, k, t, face });
          }
        }
      }
      let cx = 0, cz = 0;
      for (const s of stalls) { cx += s.x; cz += s.z; }
      cx /= stalls.length; cz /= stalls.length;
      const R = Math.max(...stalls.map((s) => Math.hypot(s.x - cx, s.z - cz))) + PARK_D;
      for (const s of stalls) {
        const h = hash(li, s.k * 31 + Math.round(s.t));
        s.car = h < BUSY ? { kind: KINDS[Math.floor((h / BUSY) * KINDS.length)], color: hash(s.k, li * 7 + 3) } : null;
      }
      return { lot, li, stalls, cx, cz, R, mesh: null, ready: false };
    });

    this.paint = new THREE.MeshLambertMaterial({ color: '#e9e9e2', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const lit = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.kinds = {};
    for (const key of new Set(KINDS)) {
      const p = vehicleParts(MODELS[key], { wheelsInDetail: true });
      const meshes = [new THREE.InstancedMesh(p.paint, lit, CARS), new THREE.InstancedMesh(p.detail, lit, CARS)];
      for (const m of meshes) {
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.frustumCulled = false;
        m.castShadow = m.receiveShadow = true;
        m.count = 0;
        m.visible = false;
        scene.add(m);
      }
      meshes[0].setColorAt(0, new THREE.Color('#fff')); // создать instanceColor
      this.kinds[key] = meshes;
    }
    this.parked = [];
    this.at = null; // где игрок был при последней расстановке
    this.m = new THREE.Matrix4();
    this.e = new THREE.Euler(0, 0, 0, 'YXZ');
    this.q = new THREE.Quaternion();
    this.p = new THREE.Vector3();
    this.one = new THREE.Vector3(1, 1, 1);
  }

  update(dt, car) {
    const px = car.pos.x, pz = car.pos.y;
    if (!this.at || Math.hypot(px - this.at[0], pz - this.at[1]) > 15) {
      this.at = [px, pz];
      this.#markings(px, pz);
      this.#place(px, pz);
    }
    this.#collidePlayer(car);
  }

  // Места на тротуаре (его рисуем сами вдоль улиц — в OSM его нет, fetch_city.py о нём не знает) убираем, когда
  // парковка впервые оказалась рядом: тротуары квадрата строятся по требованию.
  #ready(L) {
    if (L.ready) return;
    L.ready = true;
    const walks = this.world.walks;
    L.stalls = L.stalls.filter((s) => {
      for (const [a, b] of [[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const x = s.x + s.ux * a * (PARK_W / 2 - 0.2) + s.fx * b * (PARK_D / 2 - 0.2), z = s.z + s.uz * a * (PARK_W / 2 - 0.2) + s.fz * b * (PARK_D / 2 - 0.2);
        if (walks.near(x, z)) return false;
      }
      return true;
    });
  }

  // Разметка: линии между местами и задняя линия ряда.
  #markings(px, pz) {
    for (const L of this.lots) {
      const d = Math.hypot(L.cx - px, L.cz - pz) - L.R;
      if (d < NEAR && !L.mesh) {
        this.#ready(L);
        L.mesh = this.#buildMarkings(L);
        if (L.mesh) this.scene.add(L.mesh);
      } else if (d > NEAR + 120 && L.mesh) {
        this.scene.remove(L.mesh);
        L.mesh.geometry.dispose();
        L.mesh = null;
      }
    }
  }

  #buildMarkings(L) {
    const w = this.world, [ox, oz] = L.lot.o, [ux, uz] = L.lot.u, vx = -uz, vz = ux;
    const pos = [];
    const at = (s, t) => {
      const x = ox + ux * s + vx * t, z = oz + uz * s + vz * t;
      return [x, w.ground(x, z) + 0.03, z];
    };
    // Полоса от (s0, t0) до (s1, t1) шириной LINE, разбита на куски по ~1,5 м — по рельефу.
    const strip = (s0, t0, s1, t1) => {
      const len = Math.hypot(s1 - s0, t1 - t0), n = Math.max(1, Math.round(len / 1.5));
      const ns = (-(t1 - t0) / len) * LINE / 2, nt = ((s1 - s0) / len) * LINE / 2;
      for (let i = 0; i < n; i++) {
        const a = i / n, b = (i + 1) / n;
        const sa = s0 + (s1 - s0) * a, ta = t0 + (t1 - t0) * a, sb = s0 + (s1 - s0) * b, tb = t0 + (t1 - t0) * b;
        const q = [at(sa - ns, ta - nt), at(sb - ns, tb - nt), at(sb + ns, tb + nt), at(sa + ns, ta + nt)];
        for (const j of [0, 2, 1, 0, 3, 2]) pos.push(...q[j]);
      }
    };
    // У места — боковые линии и задняя (со стороны, противоположной проезду); общая линия соседей рисуется дважды.
    for (const { k, t, face } of L.stalls) {
      const back = face === 1 ? t : t + PARK_D;
      strip(k * PARK_W, t, k * PARK_W, t + PARK_D);
      strip((k + 1) * PARK_W, t, (k + 1) * PARK_W, t + PARK_D);
      strip(k * PARK_W, back, (k + 1) * PARK_W, back);
    }
    if (!pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, this.paint);
    m.receiveShadow = true;
    m.userData.perf = 'парковки';
    return m;
  }

  // Ближайшие занятые места — в инстансы.
  #place(px, pz) {
    const near = [];
    for (const L of this.lots) {
      if (Math.hypot(L.cx - px, L.cz - pz) - L.R > this.far) continue;
      this.#ready(L);
      for (const s of L.stalls) {
        if (!s.car) continue;
        const d = Math.hypot(s.x - px, s.z - pz);
        if (d < this.far) near.push([d, s]);
      }
    }
    near.sort((a, b) => a[0] - b[0]);
    this.parked = near.slice(0, CARS).map(([, s]) => s);
    const used = {}, w = this.world, c = new THREE.Color();
    for (const s of this.parked) {
      const meshes = this.kinds[s.car.kind], idx = (used[s.car.kind] = (used[s.car.kind] ?? -1) + 1);
      const a = 1.3, hf = w.ground(s.x + s.fx * a, s.z + s.fz * a), hb = w.ground(s.x - s.fx * a, s.z - s.fz * a);
      this.p.set(s.x, Math.max(w.ground(s.x, s.z), (hf + hb) / 2), s.z);
      this.e.set(-Math.atan2(hf - hb, 2 * a), Math.atan2(s.fx, s.fz), 0);
      this.m.compose(this.p, this.q.setFromEuler(this.e), this.one);
      for (const m of meshes) m.setMatrixAt(idx, this.m);
      const colors = MODELS[s.car.kind].colors;
      meshes[0].setColorAt(idx, c.set(colors[Math.floor(s.car.color * colors.length)]));
    }
    for (const [key, meshes] of Object.entries(this.kinds)) {
      for (const m of meshes) {
        m.count = (used[key] ?? -1) + 1;
        m.visible = m.count > 0;
        m.instanceMatrix.needsUpdate = true;
      }
      meshes[0].instanceColor.needsUpdate = true;
    }
  }

  #collidePlayer(car) {
    if (car.ghostVehicles > 0 || car.air) return;
    const f = car.forward;
    for (const s of this.parked) {
      if (Math.hypot(s.x - car.pos.x, s.z - car.pos.y) > 8) continue;
      for (const so of [PLAYER_AXLE, -PLAYER_AXLE]) {
        for (const vo of [-1.2, 1.2]) {
          const cx = car.pos.x + f.x * so, cz = car.pos.y + f.y * so;
          const ox = s.x + s.fx * vo, oz = s.z + s.fz * vo;
          const d = Math.hypot(cx - ox, cz - oz), min = PLAYER_R + 1.1;
          if (d >= min || d < 1e-6) continue;
          const nx = (cx - ox) / d, nz = (cz - oz) / d;
          car.touchVehicle(nx, nz, min - d, car.vel.x * nx + car.vel.y * nz);
        }
      }
    }
  }
}

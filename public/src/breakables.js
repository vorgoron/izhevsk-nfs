// Ломаемое у дорог: фонарные столбы, светофоры, рекламные щиты (деревья — тоже здесь, но не ломаются). Машина сносит их ударом быстрее
// breakV (по нормали), медленнее — упирается, как в стену. Снесённое — отдельный меш на тех же
// геометриях: падает от удара (поворот вокруг основания под тяжестью), скользит и ложится; экземпляр
// на месте спрятан. Обратно встаёт, когда игрок уехал далеко. Сбитые машины трафика тоже сносят.
import * as THREE from 'three';
import { HitFX } from './effects.js';

// r — радиус стойки, h — высота (до верха), tip — запас верха над землёй лёжа, breakV — м/с по нормали,
// loss — доля скорости по нормали, которую теряет машина, kick — доля скорости машины, с которой летит основание.
const KINDS = {
  pole: { r: 0.18, h: 9, tip: 0.15, breakV: 3, loss: 0.25, kick: 0.35 },
  signal: { r: 0.12, h: 4.1, tip: 0.2, breakV: 2, loss: 0.12, kick: 0.3 },
  board: { r: 0.5, h: 8.55, tip: 0.3, breakV: 6, loss: 0.45, kick: 0.15 },
  tree: { r: 0.3, h: 6, breakV: Infinity }, // не сбить: упираешься на любой скорости; r — на масштаб 1
};
const CELL = 16;          // м: клетка сетки поиска
const MAX_DEBRIS = 40;    // больше — самое старое встаёт на место
const RESPAWN_AGE = 20;   // с: не раньше этого
const RESPAWN_DIST = 150; // м: и только если игрок дальше
const G = 9.8, SLIDE = 6; // тяжесть; торможение основания о землю, м/с²

const _m = new THREE.Matrix4();
const _qt = new THREE.Quaternion(), _qy = new THREE.Quaternion(), _axis = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class Breakables {
  constructor(world, scene) {
    this.world = world;
    this.grid = new Map();   // клетка → предметы
    this.owners = new Map(); // меш-источник → его предметы
    this.debris = [];
    this.smashes = [];       // снесли за кадр: { x, z, s } — забирает Sound.smash
    this.group = new THREE.Group();
    this.group.userData.perf = 'обломки';
    scene.add(this.group);
    this.sparks = new HitFX(scene);
    this.lampOff = new THREE.MeshBasicMaterial({ color: '#1e1f21' });
  }

  #cell(x, z) { return Math.floor(x / CELL) * 100000 + Math.floor(z / CELL); }

  #add(owner, items) {
    if (!items.length) return;
    this.owners.set(owner, items);
    for (const it of items) {
      const k = this.#cell(it.x, it.z);
      let list = this.grid.get(k);
      if (!list) this.grid.set(k, (list = []));
      list.push(it);
    }
  }

  // Квадрат выгружен: его предметы и обломки — прочь (заново построенный квадрат — целый).
  remove(owner) {
    const items = this.owners.get(owner);
    if (!items) return;
    this.owners.delete(owner);
    const gone = new Set(items);
    // По клеткам, а не по предметам: два предмета в одной клетке — второй найдёт её уже удалённой.
    for (const k of new Set(items.map((it) => this.#cell(it.x, it.z)))) {
      const list = this.grid.get(k);
      if (!list) continue;
      const rest = list.filter((o) => !gone.has(o));
      if (rest.length) this.grid.set(k, rest);
      else this.grid.delete(k);
    }
    this.debris = this.debris.filter((d) => {
      if (!gone.has(d.item)) return true;
      this.#drop(d);
      return false;
    });
  }

  // Фонарные столбы квадрата (buildPoleChunk): один InstancedMesh, геометрия от основания.
  // Пятно света под фонарём (glow[1], свои матрицы) гаснет и возвращается вместе со столбом.
  addPoles(mesh) {
    const pool = mesh.userData.glow?.[1];
    this.#add(mesh, mesh.userData.spots.map(([x, y, z, a], i) => {
      let pm = null;
      return {
        kind: KINDS.pole, x, y, z, a,
        hide: () => { if (pool) pm = hideInstance(pool, i); return hideInstance(mesh, i); },
        show: (m) => { if (pm) showInstance(pool, i, pm); pm = null; showInstance(mesh, i, m); },
        make: () => new THREE.Mesh(mesh.geometry, mesh.material),
      };
    }));
  }

  // Деревья квадрата (buildTreeChunk): стволы — препятствие, радиус по масштабу дерева.
  addTrees(trunks) {
    this.#add(trunks, trunks.userData.spots.map(([x, y, z, s]) => ({ kind: KINDS.tree, x, y, z, r: KINDS.tree.r * s })));
  }

  // Щиты квадрата (buildBillboardChunk): рамы — InstancedMesh, плакаты — общая геометрия по 8 вершин на щит.
  addBoards(frames, faces) {
    const pos = faces.geometry.attributes.position;
    this.#add(frames, frames.userData.spots.map(({ x, y, z, dx, dz }, i) => {
      const a = Math.atan2(dx, dz);
      let saved = null;
      return {
        kind: KINDS.board, x, y, z, a,
        hide: () => {
          saved = pos.array.slice(i * 24, i * 24 + 24);
          pos.array.fill(0, i * 24, i * 24 + 24); // все вершины в одной точке — треугольников не видно
          pos.needsUpdate = true;
          return hideInstance(frames, i);
        },
        show: (m) => {
          if (saved) { pos.array.set(saved, i * 24); pos.needsUpdate = true; }
          showInstance(frames, i, m);
        },
        // Плакаты — свой кусок геометрии в осях щита (UV те же, поэтому смена плаката идёт и на обломке).
        make: () => {
          const g = new THREE.Group();
          g.add(new THREE.Mesh(frames.geometry, frames.material));
          const fg = new THREE.BufferGeometry();
          const attr = (name, n) => new THREE.Float32BufferAttribute(faces.geometry.attributes[name].array.slice(i * 8 * n, (i + 1) * 8 * n), n);
          fg.setAttribute('position', new THREE.Float32BufferAttribute(saved, 3));
          fg.setAttribute('normal', attr('normal', 3));
          fg.setAttribute('uv', attr('uv', 2));
          fg.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
          fg.applyMatrix4(_m.makeRotationY(-a).multiply(new THREE.Matrix4().makeTranslation(-x, -y, -z)));
          g.add(new THREE.Mesh(fg, faces.material));
          g.userData.own = fg;
          return g;
        },
      };
    }));
  }

  // Светофоры (signals.js): столб и корпус — общая матрица от основания, лампы — свои матрицы в мире.
  addSignals(signals) {
    const items = [];
    const meshes = [signals.poles, signals.housings, ...signals.lamps];
    signals.list.forEach((_, i) => {
      signals.poles.getMatrixAt(i, _m);
      const e = _m.elements;
      if (e[0] === 0 && e[5] === 0) return; // столба нет
      const x = e[12], y = e[13], z = e[14], a = Math.atan2(e[8], e[10]);
      let saved = null;
      items.push({
        kind: KINDS.signal, x, y, z, a,
        hide: () => {
          saved = meshes.map((mesh) => hideInstance(mesh, i));
          return saved[0];
        },
        show: () => meshes.forEach((mesh, k) => showInstance(mesh, i, saved[k])),
        make: () => {
          const g = new THREE.Group();
          g.add(new THREE.Mesh(signals.poles.geometry, signals.poles.material));
          g.add(new THREE.Mesh(signals.housings.geometry, signals.housings.material));
          const inv = saved[0].clone().invert();
          for (let k = 2; k < meshes.length; k++) { // лампы — погасшие
            const l = new THREE.Mesh(meshes[k].geometry, this.lampOff);
            new THREE.Matrix4().multiplyMatrices(inv, saved[k]).decompose(l.position, l.quaternion, l.scale);
            g.add(l);
          }
          return g;
        },
      });
    });
    this.#add(signals, items);
  }

  #near(x, z, fn) {
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        const list = this.grid.get(i * 100000 + j);
        if (list) for (const it of list) if (!it.broken) fn(it);
      }
    }
  }

  // Каждый шаг физики: машина игрока — прямоугольник кузова против круга стойки.
  collide(car) {
    const hl = (car.model.userData.length ?? 4.2) / 2, hw = (car.model.userData.width ?? 1.8) / 2;
    const f = car.forward, r = car.right, cx = car.pos.x, cz = car.pos.y;
    this.#near(cx, cz, (it) => {
      const k = it.kind, ir = it.r ?? k.r;
      if (car.y > it.y + k.h - 1 || car.y < it.y - 1.5) return; // выше или ниже
      const dx = it.x - cx, dz = it.z - cz;
      const lon = dx * f.x + dz * f.y, lat = dx * r.x + dz * r.y;
      const plon = hl + ir - Math.abs(lon), plat = hw + ir - Math.abs(lat);
      if (plon <= 0 || plat <= 0) return;
      // Нормаль от стойки к машине — по оси наименьшего перекрытия.
      const byLon = plon < plat, depth = byLon ? plon : plat;
      const sg = -Math.sign(byLon ? lon : lat) || -1;
      const nx = (byLon ? f.x : r.x) * sg, nz = (byLon ? f.y : r.y) * sg;
      const vn = car.vel.x * nx + car.vel.y * nz;
      if (-vn >= k.breakV) {
        const dv = -vn * k.loss;
        car.push(nx * dv, nz * dv, it.x + nx * k.r, it.z + nz * k.r);
        car.impact = Math.max(car.impact, Math.min(1, -vn / 30));
        this.#break(it, car.vel.x, car.vel.y, nx, nz, car.y);
        return;
      }
      // Медленно (или дерево) — упёрлись; из зажатия о столб выезжаем, как с машинами.
      if (car.ghostVehicles > 0 && k !== KINDS.tree) return;
      car.contact = true;
      car.pos.x += nx * depth;
      car.pos.y += nz * depth;
      if (vn < 0) {
        car.vel.x -= 1.2 * vn * nx;
        car.vel.y -= 1.2 * vn * nz;
        car.impact = Math.max(car.impact, Math.min(1, -vn / 20));
      }
    });
  }

  // Сбитые машины трафика (свободные тела) сносят то, во что влетели, и теряют скорость.
  #collideTraffic(traffic) {
    for (const v of traffic.vehicles) {
      const kn = v.knock;
      if (!v.active || !kn) continue;
      for (const vo of v.circles) {
        const cx = v.x + v.dx * vo, cz = v.z + v.dz * vo;
        this.#near(cx, cz, (it) => {
          const ir = it.r ?? it.kind.r, d = Math.hypot(cx - it.x, cz - it.z);
          if (d >= v.r + ir || d < 1e-6) return;
          const nx = (cx - it.x) / d, nz = (cz - it.z) / d, vn = kn.vx * nx + kn.vz * nz;
          if (it.kind === KINDS.tree) { // от дерева — отскок
            v.x += nx * (v.r + ir - d);
            v.z += nz * (v.r + ir - d);
            if (vn < 0) { kn.vx -= 1.25 * vn * nx; kn.vz -= 1.25 * vn * nz; }
            return;
          }
          if (-vn < it.kind.breakV) return; // медленно — стоит (сбитая и так тормозит)
          const loss = it.kind.loss * (v.bus ? 0.3 : 1);
          kn.vx -= vn * loss * nx;
          kn.vz -= vn * loss * nz;
          this.#break(it, kn.vx, kn.vz, nx, nz, it.y);
        });
      }
    }
  }

  #break(it, vx, vz, nx, nz, y) {
    it.broken = true;
    const m = it.hide();
    const obj = it.make();
    obj.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.group.add(obj);
    const sp = Math.hypot(vx, vz), k = it.kind;
    // Падает по ходу удара; основание отлетает с долей скорости, вверх — подскок.
    const fx = sp > 0.1 ? vx / sp : -nx, fz = sp > 0.1 ? vz / sp : -nz;
    const d = {
      item: it, obj, m, age: 0,
      x: it.x, y: it.y, z: it.z, vx: vx * k.kick, vz: vz * k.kick, vy: 1 + sp * 0.04 * k.kick * 3,
      fx, fz, th: 0, w: (0.4 + sp * 0.07) * Math.sqrt(6 / k.h), yaw: it.a, yawV: (Math.random() - 0.5) * 1.2,
      rest: false,
    };
    this.debris.push(d);
    if (this.debris.length > MAX_DEBRIS) this.#drop(this.debris.shift(), true);
    const s = Math.min(1, sp / 25);
    this.sparks.burst(it.x + nx * k.r, y + 0.6, it.z + nz * k.r, nx, nz, s);
    this.smashes.push({ x: it.x, z: it.z, s: Math.max(0.3, s) });
    this.#pose(d);
  }

  // Убрать обломок; restore — поставить экземпляр обратно (квадрат ещё загружен).
  #drop(d, restore = false) {
    this.group.remove(d.obj);
    d.obj.userData.own?.dispose();
    if (restore) {
      d.item.show(d.m);
      d.item.broken = false;
    }
  }

  #pose(d) {
    _axis.set(d.fz, 0, -d.fx); // вокруг этой оси «верх» наклоняется к (fx, fz)
    _qt.setFromAxisAngle(_axis, d.th);
    _qy.setFromAxisAngle(UP, d.yaw);
    d.obj.position.set(d.x, d.y, d.z);
    d.obj.quaternion.multiplyQuaternions(_qt, _qy);
  }

  update(dt, car, traffic) {
    if (traffic?.enabled) this.#collideTraffic(traffic);
    this.sparks.update(dt);
    const w = this.world;
    for (const d of this.debris) {
      d.age += dt;
      if (d.rest) continue;
      const k = d.item.kind;
      // Основание: летит, пока выше земли, потом скользит с трением.
      const gy = w.terrain(d.x, d.z);
      d.vy -= G * dt;
      d.y += d.vy * dt;
      let onGround = false;
      if (d.y <= gy) { d.y = gy; d.vy = 0; onGround = true; }
      if (onGround) {
        const v = Math.hypot(d.vx, d.vz), nv = Math.max(0, v - SLIDE * dt);
        if (v > 0) { d.vx *= nv / v; d.vz *= nv / v; }
        d.yawV *= Math.exp(-3 * dt);
      }
      d.x += d.vx * dt;
      d.z += d.vz * dt;
      d.yaw += d.yawV * dt;
      // Наклон: как стержень на шарнире, θ'' = 3g / 2h · sin θ.
      d.w += (1.5 * G / k.h) * Math.sin(d.th + 0.05) * dt;
      d.th += d.w * dt;
      const tx = d.x + d.fx * k.h * Math.sin(d.th), tz = d.z + d.fz * k.h * Math.sin(d.th);
      const tipY = d.y + k.h * Math.cos(d.th);
      if (d.w > 0 && tipY <= w.terrain(tx, tz) + k.tip) {
        d.w = -d.w * 0.2; // лёг — чуть подпрыгнул верхом
        if (Math.abs(d.w) < 0.25) d.w = 0;
      }
      if (d.w === 0 && onGround && Math.hypot(d.vx, d.vz) < 0.05) d.rest = true;
      this.#pose(d);
    }
    // Далеко и давно — снова стоит.
    this.debris = this.debris.filter((d) => {
      if (d.age < RESPAWN_AGE || Math.hypot(d.item.x - car.pos.x, d.item.z - car.pos.y) < RESPAWN_DIST) return true;
      this.#drop(d, true);
      return false;
    });
  }
}

// Спрятать экземпляр (масштаб 0), вернуть его матрицу.
function hideInstance(mesh, i) {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(i, m);
  mesh.setMatrixAt(i, ZERO);
  mesh.instanceMatrix.needsUpdate = true;
  return m;
}

function showInstance(mesh, i, m) {
  mesh.setMatrixAt(i, m);
  mesh.instanceMatrix.needsUpdate = true;
}

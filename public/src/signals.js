// Светофоры из OSM (highway=traffic_signals). Узлы-светофоры рядом друг с другом — один
// перекрёсток с общим циклом: две фазы по осям, жёлтый, всё красное. Трафик стоит на красный.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { World } from './world.js';

const CLUSTER = 35;               // м: светофоры ближе — один перекрёсток
const GREEN = [14, 12], YELLOW = 3, ALL_RED = 1.5;
const PED_GREEN = 7;              // одиночный пешеходный светофор: «зелёный» для пешеходов
const ON = { red: '#ff2a1a', yellow: '#ffc21a', green: '#33ff66' };
const OFF = '#1e1f21';
const CELL = 600;                 // м: ячейка мешей светофоров
// Выезды из дворов у перекрёстка не сдвигают стоп-линию (но на них столб не ставим).
const MINOR = new Set(['service', 'living_street']);

export class Signals {
  constructor(world, traffic, scene) {
    this.world = world;
    this.time = 0;
    this.#cluster(world);
    this.#approaches(traffic.edges);
    this.#buildMeshes(scene);
    traffic.signals = this;
  }

  #cluster(world) {
    const ids = world.city.signals || [];
    const parent = ids.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = world.nodes[ids[i]], b = world.nodes[ids[j]];
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < CLUSTER) parent[find(i)] = find(j);
      }
    }
    const groups = new Map();
    ids.forEach((id, i) => {
      const r = find(i);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(id);
    });
    this.ctrls = [];
    this.ctrlOf = new Map(); // узел → контроллер
    for (const nodes of groups.values()) {
      const cx = nodes.reduce((s, n) => s + world.nodes[n][0], 0) / nodes.length;
      const cz = nodes.reduce((s, n) => s + world.nodes[n][1], 0) / nodes.length;
      const ctrl = { cx, cz, axis: null, phases: [false, false], approaches: [], offset: (cx * 7.3 + cz * 3.1) % 60, last: '' };
      this.ctrls.push(ctrl);
      for (const n of nodes) this.ctrlOf.set(n, ctrl);
    }
  }

  // Ребро-подход: ведёт в узел-светофор и приближается к центру перекрёстка.
  #approaches(edges) {
    this.approach = new Map();
    const nodes = this.world.nodes;
    for (const e of edges) {
      const ctrl = this.ctrlOf.get(e.b);
      if (!ctrl) continue;
      const [bx, bz] = nodes[e.b], [ax, az] = nodes[e.a];
      const db = Math.hypot(bx - ctrl.cx, bz - ctrl.cz), da = Math.hypot(ax - ctrl.cx, az - ctrl.cz);
      if (da <= db) continue; // выезд с перекрёстка
      // Подход изнутри перекрёстка (со второй проезжей части широкой улицы) — уже едем через него.
      if (this.#onOtherRoad(ax, az, e, 0.5)) continue;
      const stopBack = this.#stopBack(e);
      if (stopBack === null) continue;
      const angle = Math.atan2(e.dz, e.dx);
      if (ctrl.axis === null) ctrl.axis = angle;
      const phase = Math.abs(Math.cos(angle - ctrl.axis)) > 0.7 ? 0 : 1;
      ctrl.phases[phase] = true;
      const ap = { ctrl, phase, stopBack, e };
      ctrl.approaches.push(ap);
      this.approach.set(e, ap);
    }
    this.ctrls = this.ctrls.filter((c) => c.approaches.length);
    for (const c of this.ctrls) {
      const g = [GREEN[0], c.phases[1] ? GREEN[1] : PED_GREEN];
      // Границы фаз внутри цикла: G0 | Y0 | AR | G1 | Y1 | AR
      c.cycle = [g[0], YELLOW, ALL_RED, g[1], YELLOW, ALL_RED];
      c.length = c.cycle.reduce((a, b) => a + b, 0);
    }
  }

  // Точка на проезжей части другой улицы (поперечной или второй половины этой)?
  #onOtherRoad(x, z, e, pad, minor = true) {
    for (const s of this.world.nearbyRoadSegments(x, z)) {
      if (s.road === e.road || (minor && MINOR.has(s.road.k))) continue;
      if (World.closest(s, x, z).d < s.w / 2 + pad) return true;
    }
    return false;
  }

  // Стоп-линия: отходим от узла назад по своей полосе, пока не сойдём с поперечной дороги.
  #stopBack(e) {
    const [bx, bz] = this.world.nodes[e.b];
    for (let d = 0; d <= 40; d += 0.5) {
      const x = bx - e.dx * d - e.dz * e.off, z = bz - e.dz * d + e.dx * e.off;
      if (!this.#onOtherRoad(x, z, e, 1.0)) return d + 1.0;
    }
    return null;
  }

  // Столб справа от своей дороги у стоп-линии; если там чужая проезжая часть — сдвигаем назад.
  #polePos(ap) {
    const e = ap.e, [bx, bz] = this.world.nodes[e.b];
    const side = e.w / 2 + 0.9;
    for (let d = ap.stopBack; d <= ap.stopBack + 25; d += 0.5) {
      const x = bx - e.dx * d - e.dz * side, z = bz - e.dz * d + e.dx * side;
      if (!this.#onOtherRoad(x, z, e, 0.6, false)) return [x, z];
    }
    return null;
  }

  // Сигнал для подхода: green | yellow | red.
  state(ap) {
    const c = ap.ctrl;
    let t = (this.time + c.offset) % c.length;
    let i = 0;
    while (t >= c.cycle[i]) t -= c.cycle[i++];
    const phase = i < 3 ? 0 : 1, part = i % 3;
    if (phase !== ap.phase || part === 2) return 'red';
    return part === 0 ? 'green' : 'yellow';
  }

  // Светофоры — по ячейкам CELL м: у каждой свои InstancedMesh со сферой границ, поэтому ячейки вне взгляда
  // отсекаются, а дальние прячет cull(). Раньше на весь город было по одному мешу с frustumCulled = false —
  // все ~400 светофоров (90 тыс. треугольников) рисовались каждый кадр. Столб с корпусом — одна геометрия
  // (материал общий); лампы — по мешу на цвет, цвет у инстанса. У подхода: ap.cell — ячейка, ap.slot — номер в ней.
  #buildMeshes(scene) {
    const pole = new THREE.CylinderGeometry(0.07, 0.09, 3.3, 6).translate(0, 1.65, 0);
    const housing = new THREE.BoxGeometry(0.38, 1.15, 0.3).translate(0, 3.55, 0);
    const body = mergeGeometries([pole.toNonIndexed(), housing.toNonIndexed()]);
    const poleMat = new THREE.MeshLambertMaterial({ color: '#2a2d30' });
    const lampGeo = new THREE.SphereGeometry(0.13, 8, 5); // 64 треугольника: ламп в городе тысячи
    const lampMats = [0, 1, 2].map(() => new THREE.MeshBasicMaterial());
    const LAMP_Y = { red: 3.92, yellow: 3.55, green: 3.18 };
    this.list = this.ctrls.flatMap((c) => c.approaches);
    this.group = new THREE.Group();
    scene.add(this.group);

    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), local = new THREE.Vector3();
    const byCell = new Map();
    for (const ap of this.list) {
      const pp = this.#polePos(ap);
      if (!pp) continue; // поставить негде — светофор работает, но без столба
      const [x, z] = pp, e = ap.e;
      ap.pole = pp; // для камер (cameras.js)
      const y = this.world.terrain(x, z);
      q.setFromAxisAngle(up, Math.atan2(-e.dx, -e.dz));
      const base = new THREE.Matrix4().compose(p.set(x, y, z), q, one);
      const lamps = ['red', 'yellow', 'green'].map((k) => {
        local.set(0, LAMP_Y[k], 0.16).applyQuaternion(q);
        return new THREE.Matrix4().makeTranslation(x + local.x, y + local.y, z + local.z);
      });
      const key = Math.floor(x / CELL) * 100000 + Math.floor(z / CELL);
      if (!byCell.has(key)) byCell.set(key, []);
      byCell.get(key).push({ ap, base, lamps, x, z });
    }
    const off = new THREE.Color(OFF);
    this.cells = [];
    for (const items of byCell.values()) {
      const n = items.length, g = new THREE.Group();
      const meshes = [new THREE.InstancedMesh(body, poleMat, n), ...lampMats.map((m) => new THREE.InstancedMesh(lampGeo, m, n))];
      const cell = { meshes, group: g, x: 0, z: 0, r: 0 };
      items.forEach(({ ap, base, lamps, x, z }, i) => {
        ap.cell = cell;
        ap.slot = i;
        meshes[0].setMatrixAt(i, base);
        lamps.forEach((m, j) => { meshes[1 + j].setMatrixAt(i, m); meshes[1 + j].setColorAt(i, off); });
        cell.x += x / n;
        cell.z += z / n;
      });
      for (const { x, z } of items) cell.r = Math.max(cell.r, Math.hypot(x - cell.x, z - cell.z));
      for (const m of meshes) {
        m.computeBoundingSphere();
        g.add(m);
      }
      meshes[0].castShadow = true;
      this.group.add(g);
      this.cells.push(cell);
    }
  }

  // Ячейки дальше far от (x, z) — не рисовать (main.js, раз в 0,5 с).
  cull(x, z, far) {
    for (const c of this.cells) c.group.visible = Math.hypot(c.x - x, c.z - z) - c.r < far;
  }

  // Проезд игрока на красный: пересёк стоп-линию подхода, по полосе которого едет, когда там красный.
  // Штрафуют только перекрёстки под целой камерой (c.cams — ставит cameras.js), остальные — нет, как в жизни.
  // Полоса подхода — курс вдоль ребра и справа от оси дороги (односторонняя — вся ширина). Жёлтый не
  // штрафуется; в прыжке над перекрёстком — тоже. Один перекрёсток штрафует не чаще раза в 15 с.
  // Возвращает перекрёсток или null.
  checkPlayer(car) {
    const px = car.pos.x, pz = car.pos.y, prev = this.prevPlayer;
    this.prevPlayer = [px, pz];
    if (!prev || car.air) return null;
    const f = car.forward;
    for (const c of this.ctrls) {
      if (!c.cams?.some((k) => !k.broken) || Math.abs(c.cx - px) > 80 || Math.abs(c.cz - pz) > 80 || this.time - (c.fined ?? -99) < 15) continue;
      for (const ap of c.approaches) {
        const e = ap.e;
        if (f.x * e.dx + f.y * e.dz < 0.6) continue;
        const [bx, bz] = this.world.nodes[e.b];
        const along = (px - bx) * e.dx + (pz - bz) * e.dz, before = (prev[0] - bx) * e.dx + (prev[1] - bz) * e.dz;
        if (!(before < -ap.stopBack && along >= -ap.stopBack && before > -ap.stopBack - e.len - 3)) continue;
        const lat = -(px - bx) * e.dz + (pz - bz) * e.dx; // вправо от оси
        if (e.road.ow ? Math.abs(lat) > e.w / 2 + 1.5 : lat < -0.8 || lat > e.w / 2 + 1.5) continue;
        if (this.state(ap) !== 'red') continue;
        c.fined = this.time;
        return c;
      }
    }
    return null;
  }

  update(dt) {
    this.time += dt;
    const c = new THREE.Color();
    for (const ap of this.list) {
      if (!ap.cell) continue;
      const st = this.state(ap);
      if (ap.last === st) continue;
      ap.last = st;
      ap.cell.dirty = true;
      ['red', 'yellow', 'green'].forEach((k, j) => ap.cell.meshes[1 + j].setColorAt(ap.slot, c.set(k === st ? ON[k] : OFF)));
    }
    for (const cell of this.cells) {
      if (!cell.dirty) continue;
      cell.dirty = false;
      for (let j = 1; j < 4; j++) cell.meshes[j].instanceColor.needsUpdate = true;
    }
  }
}

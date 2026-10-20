// Камеры: столб с камерой, штраф за превышение по КоАП 12.9 (money.js); перекрёсток под камерой штрафует и
// проезд на красный (signals.js, ctrl.cams) — на остальных красный не штрафуется. Столб можно снести
// (breakables.js, c.broken) — пока он лежит, камера не снимает.
// Где стоят: комплексы из перечня Госавтоинспекции Удмуртии (city.cams: [x, z, предел км/ч или 0,
// 1 — на перекрёсток, 0 — без скорости (нет — со скоростью)], tools/gibdd_cams.py); если их нет в собранном
// city.json — игровые: на части перекрёстков со светофорами на крупных улицах (места выдуманные).
// Камера снимает скорость только тех, кто едет на объектив, — со спины не ловит.
// Предел — maxspeed улицы из OSM (road.ms), без него — 60 км/ч.
import * as THREE from 'three';
import { World } from './world.js';

const CITY_LIMIT = 60;    // км/ч в населённом пункте (ПДД 10.2)
const ZONE = 22;          // м до столба: ближе, едучи на объектив, — камера снимает
const WARN = 260;         // м: заранее показываем знак камеры
const FACING = 0.5;       // cos угла: курс навстречу объективу не дальше ~60° от прямого
const COOLDOWN = 20;      // с: одна камера не штрафует чаще
const KEEP = 0.4;         // доля перекрёстков с камерой (игровые места)
const CROSS = 120;        // м: комплекс «на перекрёсток» следит за светофором не дальше
const MAJOR = new Set(['trunk', 'primary', 'secondary', 'trunk_link', 'primary_link']);

export class Cameras {
  constructor(world, signals, scene) {
    this.world = world;
    this.time = 0;
    const own = world.city.cams || [];
    this.list = own.length
      ? own.map(([x, z, lim, cross, speed = 1]) => {
        const c = speed ? this.#fromList(x, z, lim, cross, signals) : this.#atSignal(x, z, signals);
        const k = cross && this.#nearestCtrl(signals, x, z, CROSS);
        if (k) (k.cams ||= []).push(c ?? {}); // без столба — снести нечего, работает всегда
        return c;
      }).filter(Boolean)
      : this.#fromSignals(signals);
    this.#build(scene);
  }

  // Камера из перечня: координаты — у дороги, иногда посреди неё. Столб — на обочине ближайшей улицы,
  // объектив — навстречу машинам своей стороны дороги (едут, имея столб справа).
  #fromList(x, z, lim, cross, signals) {
    let r = this.world.nearestRoad(x, z, 60);
    const c = { x, z, pole: [x, z], lim: lim || r?.seg.road.ms || CITY_LIMIT };
    if (!r) return c;
    const dir = (s) => { const l = Math.hypot(s.bx - s.ax, s.bz - s.az) || 1; return [(s.bx - s.ax) / l, (s.bz - s.az) / l]; };
    // Раздельные проезжие части (по половине на направление, road.ow): комплекс на перекрёсток стоит у той,
    // что едет к перекрёстку, — точка из перечня бывает у встречной половины.
    if (cross && r.seg.road.ow) {
      const ctrl = this.#nearestCtrl(signals, x, z, 300);
      const [dx, dz] = dir(r.seg);
      if (ctrl && (ctrl.cx - r.px) * dx + (ctrl.cz - r.pz) * dz < 0) {
        let best = null;
        for (const s of this.world.segmentsNear(r.px, r.pz, 50)) {
          if (!s.road.ow) continue;
          const [ex, ez] = dir(s);
          if (ex * dx + ez * dz > -0.8) continue; // не встречная половина
          const q = World.closest(s, r.px, r.pz);
          if (q.d < 50 && (!best || q.d < best.d)) best = { ...q, d: q.d, seg: s };
        }
        if (best) r = best;
      }
    }
    const s = r.seg, [dx, dz] = dir(s);
    // Сторона: у половины проезжей части — справа по ходу (слева разделительная); у обычной улицы — та, где
    // точка из перечня (на оси — справа по ходу отрезка), если там столб не попал на полотно соседней улицы
    // (у перекрёстка); иначе — где до чужого полотна дальше.
    let side = s.road.ow ? 1 : (x - r.px) * -dz + (z - r.pz) * dx < 0 ? -1 : 1, off = s.w / 2 + 1;
    const at = (k) => [r.px - dz * k * off, r.pz + dx * k * off];
    const room = ([px, pz]) => this.world.nearestRoad(px, pz, 30)?.d ?? 30;
    const p1 = at(side);
    if (!s.road.ow) {
      const p2 = at(-side);
      if (room(p1) < 0.5 && room(p2) > room(p1)) side = -side;
      c.pole = at(side);
    } else { // у половины — назад от перекрёстка, пока столб на полотне поперечной улицы
      c.pole = p1;
      for (let t = 3; t <= 45 && room(c.pole) < 0.5; t += 3) c.pole = [p1[0] - dx * t, p1[1] - dz * t];
    }
    // Машины у столба едут вдоль отрезка, если он справа от них (side 1), иначе против; объектив — им навстречу.
    c.face = Math.atan2(-dx * side, -dz * side);
    return c;
  }

  // Комплекс только на перекрёсток (без скорости): столб за светофором ближайшего к точке подхода.
  #atSignal(x, z, signals) {
    const k = this.#nearestCtrl(signals, x, z, CROSS);
    let ap = null, bd = Infinity;
    for (const a of k?.approaches ?? []) {
      const d = a.pole ? Math.hypot(a.pole[0] - x, a.pole[1] - z) : Infinity;
      if (d < bd) { bd = d; ap = a; }
    }
    return ap && { ...this.#behind(ap), x, z, lim: 0, speed: false };
  }

  // Столб — за светофором подхода, на 3 м дальше от перекрёстка, объектив — на подъезжающих.
  #behind(ap) {
    const [x, z] = ap.pole;
    return { pole: [x - ap.e.dx * 3, z - ap.e.dz * 3], face: Math.atan2(-ap.e.dx, -ap.e.dz) };
  }

  #nearestCtrl(signals, x, z, maxD) {
    let best = null, bd = maxD;
    for (const k of signals.ctrls) {
      const d = Math.hypot(k.cx - x, k.cz - z);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }

  #fromSignals(signals) {
    const out = [];
    for (const c of signals.ctrls) {
      const ap = c.approaches.find((a) => MAJOR.has(a.e.road.k) && a.pole);
      if (!ap) continue;
      const h = (Math.imul(Math.round(c.cx * 10) ^ Math.round(c.cz * 10) * 31, 2654435761) >>> 0) % 1000;
      if (h >= KEEP * 1000) continue;
      const cam = { x: c.cx, z: c.cz, ...this.#behind(ap), lim: ap.e.road.ms || CITY_LIMIT };
      c.cams = [cam];
      out.push(cam);
    }
    return out;
  }

  #build(scene) {
    const n = this.list.length;
    if (!n) return;
    const pole = new THREE.CylinderGeometry(0.09, 0.11, 5.6, 6).translate(0, 2.8, 0);
    const arm = new THREE.BoxGeometry(0.12, 0.12, 1.2).translate(0, 5.5, 0.55);
    const box = new THREE.BoxGeometry(0.42, 0.34, 0.7).translate(0, 5.3, 1.05);
    const lens = new THREE.CylinderGeometry(0.11, 0.11, 0.06, 10).rotateX(Math.PI / 2).translate(0, 5.3, 1.42);
    const grey = new THREE.MeshLambertMaterial({ color: '#8c9196' });
    const white = new THREE.MeshLambertMaterial({ color: '#e9ebe6' });
    const black = new THREE.MeshBasicMaterial({ color: '#0d1013' });
    const meshes = [[pole, grey], [arm, grey], [box, white], [lens, black]].map(([g, m]) => new THREE.InstancedMesh(g, m, n));
    this.meshes = meshes; // общая матрица на камеру — для сноса (breakables.addCameras)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    this.list.forEach((c, i) => {
      const [x, z] = c.pole;
      // Камера смотрит на подъезжающих: к перекрёстку, а у камер из OSM — вдоль ближайшей улицы.
      let face = c.face;
      if (face === undefined) {
        const s = this.world.nearestRoad(x, z, 40)?.seg;
        face = s ? Math.atan2(s.bx - s.ax, s.bz - s.az) : 0;
      }
      c.face = face; // объектив смотрит по (sin face, cos face) — для конуса на миникарте
      m.compose(p.set(x, this.world.terrain(x, z), z), q.setFromAxisAngle(up, face), one);
      for (const mesh of meshes) mesh.setMatrixAt(i, m);
    });
    for (const mesh of meshes) {
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
  }

  // Расстояние до столба, если машина перед объективом (по ту сторону столба, куда смотрит камера) и едет
  // на него (курс навстречу, объектив смотрит по (sin face, cos face)); проехали столб, сзади, мимо — Infinity.
  // Камера без скорости (только перекрёсток) и снесённая — тоже Infinity.
  #facing(c, car) {
    if (c.speed === false || c.broken) return Infinity;
    const [px, pz] = c.pole, dx = px - car.pos.x, dz = pz - car.pos.y;
    if (Math.abs(dx) > WARN || Math.abs(dz) > WARN) return Infinity;
    const lx = Math.sin(c.face), lz = Math.cos(c.face), f = car.forward;
    if (-dx * lx - dz * lz <= 0 || f.x * lx + f.y * lz >= -FACING) return Infinity;
    return Math.hypot(dx, dz);
  }

  // Ближайшая камера в пределах WARN, на объектив которой едем, — для знака на экране: { cam, d } или null.
  ahead(car) {
    let best = null, bd = WARN;
    for (const c of this.list) {
      const d = this.#facing(c, car);
      if (d < bd) { bd = d; best = c; }
    }
    return best && { cam: best, d: bd };
  }

  // Проезд камеры: пока едем на неё и до столба меньше ZONE, запоминаем наибольшую скорость; проехали
  // столб (или ушли из зоны) — штраф по ней. Возвращает { cam, kmh, over } при превышении больше 20 км/ч, иначе null.
  update(dt, car) {
    this.time += dt;
    const kmh = Math.abs(car.speed) * 3.6;
    let shot = null;
    for (const c of this.list) {
      if (this.#facing(c, car) < ZONE && !car.air) c.max = Math.max(c.max ?? 0, kmh);
      else if (c.max !== undefined) {
        const over = c.max - c.lim;
        if (over > 20 && this.time - (c.shotAt ?? -99) > COOLDOWN) {
          c.shotAt = this.time;
          shot = { cam: c, kmh: Math.round(c.max), over: Math.round(over) };
        }
        c.max = undefined;
      }
    }
    return shot;
  }
}

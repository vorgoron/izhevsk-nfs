// Камеры скорости: столб с камерой у перекрёстка, штраф за превышение по КоАП 12.9 (money.js).
// Где стоят: highway=speed_camera из OSM (city.cams: [x, z, предел км/ч или 0]), а пока их нет в собранном
// city.json — игровые: на части перекрёстков со светофорами на крупных улицах (как комплексы на
// перекрёстках Ижевска, но места выдуманные). Предел — maxspeed улицы из OSM (road.ms), без него — 60 км/ч.
import * as THREE from 'three';

const CITY_LIMIT = 60;    // км/ч в населённом пункте (ПДД 10.2)
const ZONE = 22;          // м: проехал ближе — камера сняла
const WARN = 260;         // м: заранее показываем знак камеры
const COOLDOWN = 20;      // с: одна камера не штрафует чаще
const KEEP = 0.4;         // доля перекрёстков с камерой (игровые места)
const MAJOR = new Set(['trunk', 'primary', 'secondary', 'trunk_link', 'primary_link']);

export class Cameras {
  constructor(world, signals, scene) {
    this.world = world;
    this.time = 0;
    const own = world.city.cams || [];
    this.list = own.length
      ? own.map(([x, z, lim]) => ({ x, z, pole: [x, z], lim: lim || this.#limitAt(x, z) }))
      : this.#fromSignals(signals);
    this.#build(scene);
  }

  // Предел у точки: maxspeed ближайшей улицы или городской.
  #limitAt(x, z) {
    return this.world.nearestRoad(x, z, 40)?.seg.road.ms || CITY_LIMIT;
  }

  #fromSignals(signals) {
    const out = [];
    for (const c of signals.ctrls) {
      const ap = c.approaches.find((a) => MAJOR.has(a.e.road.k) && a.pole);
      if (!ap) continue;
      const h = (Math.imul(Math.round(c.cx * 10) ^ Math.round(c.cz * 10) * 31, 2654435761) >>> 0) % 1000;
      if (h >= KEEP * 1000) continue;
      // Столб — за светофором своего подхода, на 3 м дальше от перекрёстка.
      const [x, z] = ap.pole;
      out.push({ x: c.cx, z: c.cz, pole: [x - ap.e.dx * 3, z - ap.e.dz * 3], face: Math.atan2(-ap.e.dx, -ap.e.dz),
        lim: ap.e.road.ms || CITY_LIMIT });
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
      m.compose(p.set(x, this.world.terrain(x, z), z), q.setFromAxisAngle(up, face), one);
      for (const mesh of meshes) mesh.setMatrixAt(i, m);
    });
    for (const mesh of meshes) {
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
  }

  // Ближайшая камера впереди в пределах WARN — для знака на экране: { cam, d } или null.
  ahead(car) {
    const f = car.forward;
    let best = null, bd = WARN;
    for (const c of this.list) {
      const dx = c.x - car.pos.x, dz = c.z - car.pos.y;
      if (Math.abs(dx) > WARN || Math.abs(dz) > WARN) continue;
      const d = Math.hypot(dx, dz);
      if (d < bd && (d < ZONE || (dx * f.x + dz * f.y) / d > 0.5)) { bd = d; best = c; }
    }
    return best && { cam: best, d: bd };
  }

  // Проезд мимо камеры: пока в зоне, запоминаем наибольшую скорость; выехал — штраф по ней.
  // Возвращает { cam, kmh, over } при превышении больше 20 км/ч, иначе null.
  update(dt, car) {
    this.time += dt;
    const kmh = Math.abs(car.speed) * 3.6;
    let shot = null;
    for (const c of this.list) {
      const d = Math.hypot(c.x - car.pos.x, c.z - car.pos.y);
      if (d < ZONE && !car.air) c.max = Math.max(c.max ?? 0, kmh);
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

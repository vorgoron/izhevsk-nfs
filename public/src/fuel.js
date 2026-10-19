// Заправки (amenity=fuel из OSM): колонки под навесом, стела с названием сети,
// заправка бака на территории АЗС, поиск ближайшей (для подсказки и эвакуатора).
import * as THREE from 'three';

const REFUEL_RATE = 0.25;   // бака в секунду (полный — за 4 с)
const STOP_SPEED = 1.5;     // м/с: заправляемся, только когда стоим

function pointIn(x, z, p) {
  let ins = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) ins = !ins;
  }
  return ins;
}

// Центр и главная ось контура.
function axes(p) {
  const cx = p.reduce((a, q) => a + q[0], 0) / p.length, cz = p.reduce((a, q) => a + q[1], 0) / p.length;
  let sxx = 0, szz = 0, sxz = 0;
  for (const [x, z] of p) { sxx += (x - cx) ** 2; szz += (z - cz) ** 2; sxz += (x - cx) * (z - cz); }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz), ux = Math.cos(ang), uz = Math.sin(ang);
  const ss = p.map(([x, z]) => (x - cx) * ux + (z - cz) * uz), ts = p.map(([x, z]) => -(x - cx) * uz + (z - cz) * ux);
  return { cx, cz, ux, uz, len: Math.max(...ss) - Math.min(...ss), wid: Math.max(...ts) - Math.min(...ts) };
}

function signTexture(text) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#23303d';
  g.fillRect(0, 0, 128, 512);
  g.fillStyle = '#f2f2f2';
  g.font = 'bold 56px sans-serif';
  g.textAlign = 'center';
  g.fillText('АЗС', 64, 80);
  // Название — вертикально, по буквам.
  g.font = 'bold 40px sans-serif';
  [...text.toUpperCase()].slice(0, 9).forEach((ch, i) => g.fillText(ch, 64, 150 + i * 40));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Fuel {
  constructor(world, scene) {
    this.world = world;
    this.stations = (world.city.fuel || []).map((s) => ({ ...s, ...axes(s.p) }));
    this.#build(scene);
  }

  #build(scene) {
    const w = this.world;
    const island = new THREE.MeshLambertMaterial({ color: '#b9b6ae' });
    const pumpMat = new THREE.MeshLambertMaterial({ color: '#eceae5' });
    const pillar = new THREE.MeshLambertMaterial({ color: '#d9d9d9' });
    const islandGeo = new THREE.BoxGeometry(1.1, 0.2, 4.2).translate(0, 0.1, 0);
    const pumpGeo = new THREE.BoxGeometry(0.55, 1.75, 0.95).translate(0, 0.875 + 0.2, 0);
    const screenGeo = new THREE.BoxGeometry(0.57, 0.3, 0.5).translate(0, 1.45, 0);
    const pillarGeo = new THREE.BoxGeometry(0.4, 1, 0.4).translate(0, 0.5, 0);
    const group = new THREE.Group();
    let sg = null; // группа текущей заправки: дальние скрываем (update)
    const add = (geo, mat, x, z, y, rot, sy = 1) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.y = rot;
      m.scale.y = sy;
      m.castShadow = m.receiveShadow = true;
      sg.add(m);
    };
    for (const st of this.stations) {
      sg = st.group = new THREE.Group();
      group.add(sg);
      const accent = new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL((st.name.length * 0.13) % 1, 0.5, 0.42) });
      // Колонки под навесом из OSM (или по центру территории): островки вдоль длинной оси навеса.
      const roof = st.roofs?.[0] ? axes(st.roofs[0]) : { ...st, len: Math.min(st.len * 0.5, 24), wid: 10 };
      const roofTop = st.roofs?.[0] ? this.#roofBase(st.roofs[0]) : null;
      const n = Math.max(1, Math.min(4, Math.round(roof.len / 7)));
      const rot = Math.atan2(roof.ux, roof.uz) + Math.PI / 2; // островок поперёк длинной оси
      for (let i = 0; i < n; i++) {
        const s = (i - (n - 1) / 2) * (roof.len / n);
        const x = roof.cx + roof.ux * s, z = roof.cz + roof.uz * s, y = w.terrain(x, z);
        (st.pumps ||= []).push({ x, z, vx: -roof.uz, vz: roof.ux }); // для очереди: островок и его направление
        add(islandGeo, island, x, z, y, rot);
        add(pumpGeo, pumpMat, x, z, y, rot);
        add(screenGeo, accent, x, z, y, rot);
        w.addCollider(rect(x, z, roof.ux, roof.uz, 0.7, 2.2));
        // Столбы навеса на концах островка.
        if (roofTop) {
          for (const e of [-1.9, 1.9]) {
            const px = x - roof.uz * e, pz = z + roof.ux * e, py = w.terrain(px, pz);
            add(pillarGeo, pillar, px, pz, py, rot, roofTop - py);
          }
        }
      }
      // Стела с названием — у вершины контура, ближайшей к дороге, лицом к дороге.
      let best = null;
      for (const [x, z] of st.p) {
        const r = w.nearestRoad(x, z, 60);
        if (r && (!best || r.d < best.d)) best = { x, z, r };
      }
      if (best) {
        const dx = best.r.px - best.x, dz = best.r.pz - best.z, L = Math.hypot(dx, dz) || 1;
        const sx = best.x + (dx / L) * 1.5, sz = best.z + (dz / L) * 1.5, sy = w.terrain(sx, sz);
        const mats = [pumpMat, pumpMat, pumpMat, pumpMat, new THREE.MeshLambertMaterial({ map: signTexture(st.name) }),
          new THREE.MeshLambertMaterial({ map: signTexture(st.name) })];
        const sign = new THREE.Mesh(new THREE.BoxGeometry(1.4, 6, 0.35).translate(0, 3, 0), mats);
        sign.position.set(sx, sy, sz);
        sign.rotation.y = Math.atan2(dx, dz);
        sign.castShadow = true;
        sg.add(sign);
        w.addCollider(rect(sx, sz, -dz / L, dx / L, 0.8, 0.3));
        st.sign = [sx, sz];
        st.entry = { x: best.x, z: best.z, road: best.r }; // въезд: вершина контура у дороги
      }
    }
    scene.add(group);
  }

  // Высота низа навеса: здание-крыша из city.buildings с тем же контуром.
  #roofBase(poly) {
    const b = this.world.city.buildings.find((q) => q.p === poly || (q.p[0][0] === poly[0][0] && q.p[0][1] === poly[0][1]));
    let gmin = Infinity;
    for (const [x, z] of poly) gmin = Math.min(gmin, this.world.terrain(x, z));
    return gmin + (b?.mh ?? 4.5);
  }

  // Свободное место на территории АЗС для эвакуатора: ближе к колонкам, без столкновений.
  spot(st) {
    let best = null, bd = Infinity;
    const p = new THREE.Vector2();
    for (let dx = -30; dx <= 30; dx += 1.5) {
      for (let dz = -30; dz <= 30; dz += 1.5) {
        const x = st.cx + dx, z = st.cz + dz;
        if (!pointIn(x, z, st.p) || this.world.isWater(x, z)) continue;
        let free = true;
        for (const k of [-1.25, 0, 1.25]) {
          p.set(x + st.ux * k, z + st.uz * k);
          if (this.world.collide(p, 1.4, true)) { free = false; break; }
        }
        const d = Math.hypot(dx, dz);
        if (free && d < bd) { bd = d; best = [x, z]; }
      }
    }
    return best || [st.cx, st.cz];
  }

  inside(x, z) {
    return this.stations.find((s) => pointIn(x, z, s.p)) || null;
  }

  nearest(x, z) {
    let best = null, bd = Infinity;
    for (const s of this.stations) {
      const d = Math.hypot(s.cx - x, s.cz - z);
      if (d < bd) { bd = d; best = s; }
    }
    return best ? { station: best, d: bd } : null;
  }

  // Стоим на территории АЗС — бак наполняется.
  update(dt, car) {
    for (const s of this.stations) s.group.visible = Math.hypot(s.cx - car.pos.x, s.cz - car.pos.y) < 1500;
    const st = Math.abs(car.speed) < STOP_SPEED && car.sink === 0 ? this.inside(car.pos.x, car.pos.y) : null;
    car.refueling = !!st && car.fuel < 1;
    if (car.refueling) car.fuel = Math.min(1, car.fuel + REFUEL_RATE * dt);
  }
}

const rect = (x, z, ux, uz, halfLen, halfWid) => {
  const vx = -uz, vz = ux;
  return [[x - ux * halfLen - vx * halfWid, z - uz * halfLen - vz * halfWid], [x + ux * halfLen - vx * halfWid, z + uz * halfLen - vz * halfWid],
    [x + ux * halfLen + vx * halfWid, z + uz * halfLen + vz * halfWid], [x - ux * halfLen + vx * halfWid, z - uz * halfLen + vz * halfWid]];
};

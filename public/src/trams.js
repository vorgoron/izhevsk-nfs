// Трамваи по маршрутам из OSM (route=tram): весь парк движется всегда (дёшево — одна координата
// вдоль ломаной), рисуются только ближние. Остановки с ожиданием, на конечной — обратный рейс того
// же номера. Номер маршрута — на табло спереди и сзади. Стоит перед игроком и звенит.
import * as THREE from 'three';

const SPACING = 1400;     // м между трамваями одного направления
const MAX_V = 11;         // м/с ≈ 40 км/ч
const ACC = 1.0, DEC = 1.4;
const DWELL = 12;         // с на остановке
const VIS = 900;          // м: ближе — рисуем
const POOL = 24;          // моделей одновременно
const LEN = 15.2, HALF = LEN / 2;
const PLAYER_R = 1.15, PLAYER_AXLE = 1.25;

export class Trams {
  constructor(world, scene, sound) {
    this.world = world;
    this.sound = sound;
    this.routes = (world.city.trams || []).map((r) => {
      const acc = [0];
      for (let i = 1; i < r.p.length; i++) acc.push(acc[i - 1] + Math.hypot(r.p[i][0] - r.p[i - 1][0], r.p[i][1] - r.p[i - 1][1]));
      return { ...r, acc, len: acc[acc.length - 1] };
    });
    // Обратный рейс: тот же номер, начало ближе всего к нашему концу.
    for (const r of this.routes) {
      const end = r.p[r.p.length - 1];
      let best = null, bd = Infinity;
      for (const o of this.routes) {
        if (o === r || o.ref !== r.ref) continue;
        const d = Math.hypot(o.p[0][0] - end[0], o.p[0][1] - end[1]);
        if (d < bd) { bd = d; best = o; }
      }
      r.back = best || r;
    }
    this.trams = [];
    for (const r of this.routes) {
      for (let s = 200 + Math.random() * 600; s < r.len - 100; s += SPACING) {
        this.trams.push({ r, s, v: MAX_V * 0.7, wait: 0, x: 0, z: 0, dx: 1, dz: 0, bell: 0, model: null });
      }
    }
    this.group = new THREE.Group();
    scene.add(this.group);
    this.pool = [];
    this.signs = new Map();
    this.#buildPool();
  }

  // ---------------------------------------------------------------- модель

  #buildPool() {
    const red = new THREE.MeshLambertMaterial({ color: '#c3262b' });
    const cream = new THREE.MeshLambertMaterial({ color: '#efe6cf' });
    const glass = new THREE.MeshLambertMaterial({ color: '#25323d' });
    const dark = new THREE.MeshLambertMaterial({ color: '#1d1f22' });
    const grey = new THREE.MeshLambertMaterial({ color: '#8b8f94' });
    const lamp = new THREE.MeshBasicMaterial({ color: '#fff6d8' });
    const tail = new THREE.MeshBasicMaterial({ color: '#ff2a1a' });
    const box = (w, h, d, m, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; return o; };
    for (let i = 0; i < POOL; i++) {
      const g = new THREE.Group();
      // Кузов: красный низ, светлый верх с окнами, скруглённые торцы условно — скосом стёкол.
      g.add(box(2.5, 1.3, LEN, red, 0, 0.95, 0));
      g.add(box(2.52, 1.25, LEN - 1.2, cream, 0, 2.2, 0));
      g.add(box(2.55, 0.95, LEN - 2.2, glass, 0, 2.25, 0));      // окна салона
      g.add(box(2.4, 0.35, LEN - 0.6, cream, 0, 3.0, 0));         // крыша
      g.add(box(1.6, 0.3, 3.2, grey, 0, 3.3, 0));                // крышевое оборудование
      // Пантограф: ромб из двух рычагов и полоз.
      const arm = (a) => { const o = box(0.06, 0.06, 1.6, dark, 0, 3.95, 0.3); o.rotation.x = a; return o; };
      g.add(arm(0.7), arm(-0.7), box(1.4, 0.06, 0.1, dark, 0, 4.5, 0.3));
      for (const sgn of [1, -1]) {
        // Торцы: лобовое стекло, табло с номером, фары/фонари.
        g.add(box(2.3, 1.15, 0.12, glass, 0, 2.15, sgn * (LEN / 2 + 0.02)));
        g.add(box(2.5, 1.2, 0.3, red, 0, 0.95, sgn * (LEN / 2 - 0.1)));
        for (const sx of [-0.85, 0.85]) g.add(box(0.3, 0.2, 0.05, sgn > 0 ? lamp : tail, sx, 0.75, sgn * (LEN / 2 + 0.06)));
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.42), new THREE.MeshBasicMaterial({ color: '#fff' }));
        sign.position.set(0, 2.98, sgn * (LEN / 2 + 0.05));
        if (sgn < 0) sign.rotation.y = Math.PI;
        g.add(sign);
        (g.userData.signs ||= []).push(sign);
        // Тележки.
        g.add(box(2.1, 0.5, 2.6, dark, 0, 0.3, sgn * 4.4));
      }
      // Боковое табло с номером (справа по ходу).
      const side = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5), new THREE.MeshBasicMaterial({ color: '#fff' }));
      side.position.set(-1.27, 2.25, LEN / 2 - 1.6);
      side.rotation.y = -Math.PI / 2;
      g.add(side);
      g.userData.signs.push(side);
      g.visible = false;
      this.group.add(g);
      this.pool.push(g);
    }
  }

  #signMat(ref) {
    if (!this.signs.has(ref)) {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 48;
      const g = c.getContext('2d');
      g.fillStyle = '#111';
      g.fillRect(0, 0, 128, 48);
      g.fillStyle = '#ffb21e';
      g.font = 'bold 40px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(ref, 64, 26);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      this.signs.set(ref, new THREE.MeshBasicMaterial({ map: t }));
    }
    return this.signs.get(ref);
  }

  // ---------------------------------------------------------------- движение

  #pointAt(r, s) {
    const { p, acc } = r;
    let lo = 0, hi = acc.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (acc[m] <= s) lo = m; else hi = m; }
    const L = acc[hi] - acc[lo] || 1, t = Math.min(1, Math.max(0, (s - acc[lo]) / L));
    const dx = (p[hi][0] - p[lo][0]) / L, dz = (p[hi][1] - p[lo][1]) / L;
    return { x: p[lo][0] + (p[hi][0] - p[lo][0]) * t, z: p[lo][1] + (p[hi][1] - p[lo][1]) * t, dx, dz };
  }

  update(dt, car) {
    const px = car.pos.x, pz = car.pos.y;
    for (const tr of this.trams) {
      const r = tr.r;
      if (tr.wait > 0) {
        tr.wait -= dt;
      } else {
        // Ближайшая впереди остановка и конец маршрута — плавно тормозим к ним.
        let target = r.len - tr.s;
        for (const st of r.stops) if (st > tr.s + 0.5) { target = Math.min(target, st - tr.s); break; }
        let limit = Math.min(MAX_V, Math.sqrt(2 * DEC * Math.max(0, target)));
        // Игрок на рельсах впереди — стоим и звеним.
        const near = Math.hypot(tr.x - px, tr.z - pz) < 60;
        if (near) {
          const rx = px - tr.x, rz = pz - tr.z, ahead = rx * tr.dx + rz * tr.dz, lat = Math.abs(rx * tr.dz - rz * tr.dx);
          if (ahead > 0 && ahead < 30 && lat < 2.6) {
            limit = Math.min(limit, Math.max(0, (ahead - HALF - 4) * 0.6));
            tr.bell -= dt;
            if (tr.bell <= 0 && ahead < 25) { this.sound?.bell(); tr.bell = 4; }
          }
        }
        tr.v += Math.max(-DEC * 2 * dt, Math.min(ACC * dt, limit - tr.v));
        tr.s += tr.v * dt;
        if (target < 0.6 && tr.v < 0.3) {
          if (r.len - tr.s < 1) { tr.r = r.back; tr.s = 0; } // конечная — обратный рейс
          tr.wait = DWELL * (0.7 + Math.random() * 0.6);
          tr.s += 0.6;
        }
      }
      const q = this.#pointAt(tr.r, tr.s);
      tr.x = q.x; tr.z = q.z;
      tr.dx = q.dx; tr.dz = q.dz;
    }
    this.#collide(car);
    this.#sync(px, pz);
  }

  #collide(car) {
    const f = car.forward;
    for (const tr of this.trams) {
      if (Math.hypot(tr.x - car.pos.x, tr.z - car.pos.y) > 12) continue;
      for (const so of [PLAYER_AXLE, -PLAYER_AXLE]) {
        for (const o of [-6, -3, 0, 3, 6]) {
          const cx = car.pos.x + f.x * so, cz = car.pos.y + f.y * so;
          const ox = tr.x + tr.dx * o, oz = tr.z + tr.dz * o;
          const d = Math.hypot(cx - ox, cz - oz), min = PLAYER_R + 1.35;
          if (d >= min || d < 1e-6) continue;
          const nx = (cx - ox) / d, nz = (cz - oz) / d;
          car.touchVehicle(nx, nz, min - d, (car.vel.x - tr.dx * tr.v) * nx + (car.vel.y - tr.dz * tr.v) * nz);
        }
      }
    }
  }

  #sync(px, pz) {
    const near = this.trams
      .map((t) => [t, Math.hypot(t.x - px, t.z - pz)])
      .filter(([, d]) => d < VIS)
      .sort((a, b) => a[1] - b[1])
      .slice(0, POOL)
      .map(([t]) => t);
    const used = new Set();
    for (const t of near) if (t.model) used.add(t.model);
    for (const t of this.trams) if (t.model && !near.includes(t)) { t.model.visible = false; t.model = null; }
    const free = this.pool.filter((m) => !used.has(m));
    const w = this.world;
    for (const t of near) {
      if (!t.model) {
        t.model = free.pop();
        t.model.userData.ref = null;
      }
      const m = t.model;
      if (m.userData.ref !== t.r.ref) {
        m.userData.ref = t.r.ref;
        for (const s of m.userData.signs) s.material = this.#signMat(t.r.ref);
      }
      const hf = w.ground(t.x + t.dx * 5, t.z + t.dz * 5), hb = w.ground(t.x - t.dx * 5, t.z - t.dz * 5);
      m.position.set(t.x, (hf + hb) / 2, t.z);
      m.rotation.set(0, 0, 0);
      m.rotation.order = 'YXZ';
      m.rotation.y = Math.atan2(t.dx, t.dz);
      m.rotation.x = -Math.atan2(hf - hb, 10);
      m.visible = true;
    }
  }

  // Для миникарты.
  near(px, pz, r) {
    return this.trams.filter((t) => Math.abs(t.x - px) < r && Math.abs(t.z - pz) < r);
  }
}

// Гонка по чекпоинтам: маршрут — по графу улиц через промежуточные точки (кратчайший путь между соседними);
// куда ехать — стрелки на дороге (guide.js). Ворота редкие: между ними едешь как хочешь — срезать дворами можно.
// Общая гонка в комнате: маршрут задают узлы старта, промежуточных точек и финиша (у всех один граф — один путь),
// отсчёт и время — по часам сервера (clock).
import * as THREE from 'three';

const CP_SPACING = 650;
const CP_RADIUS = 18;
// Длина гонки: м по маршруту и сколько промежуточных точек (через районы, а не по прямой).
export const LENGTHS = {
  short: { min: 1800, max: 2600, via: 1, name: 'Короткая' },
  mid: { min: 3500, max: 4800, via: 2, name: 'Средняя' },
  long: { min: 6000, max: 8000, via: 3, name: 'Длинная' },
};
const TURN = 70 * Math.PI / 180; // следующая точка — не дальше этого угла от общего направления
const OVERLAP = 0.15;            // доля участка по уже пройденным улицам — больше нельзя (туда-обратно)
const GRID_BACK = 7, GRID_SIDE = 1.6; // м: стартовая сетка общей гонки — по две машины в ряд

export class Race {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.checkpoints = [];
    this.route = [];
    this.state = 'idle'; // idle | countdown | running | finished
    this.time = 0;
    this.countdown = 0;
    this.next = 0;
    this.length = 0;

    this.gateGeo = new THREE.CylinderGeometry(CP_RADIUS, CP_RADIUS, 40, 32, 1, true).translate(0, 20, 0);
    this.ringGeo = new THREE.TorusGeometry(CP_RADIUS, 0.5, 8, 48).rotateX(Math.PI / 2);
  }

  // Новая гонка от точки (x, z) длины len (LENGTHS); p — уже выбранные узлы (pick).
  start(x, z, len = 'short', p = this.pick(x, z, len)) {
    return !!p && this.#begin(p.from, p.to, p.via);
  }

  // Узлы старта, промежуточных точек и финиша новой гонки от точки (x, z): точки — перекрёстки, каждая следующая
  // примерно в общем направлении; путь не разворачивается на точке и не едет по своим же улицам обратно.
  // Длина не попала ни разу — ближайший к нужной из найденных.
  pick(x, z, len = 'short') {
    const w = this.world, L = LENGTHS[len] ?? LENGTHS.short;
    const from = w.nearestGraphNode(x, z);
    const want = (L.min + L.max) / 2;
    const cross = [...w.graph.keys()].filter((id) => w.graph.get(id).length >= 3);
    const near = (px, pz) => { // ближайший перекрёсток — по выборке, весь список долго
      let best = -1, bd = Infinity;
      for (let i = 0; i < 4000; i++) {
        const id = cross[Math.floor(Math.random() * cross.length)], [nx, nz] = w.nodes[id];
        const d = (nx - px) ** 2 + (nz - pz) ** 2;
        if (d < bd) { bd = d; best = id; }
      }
      return best;
    };
    let best = null, bestErr = Infinity;
    for (let tries = 0; tries < 40; tries++) {
      // По прямой между точками — меньше длины по улицам (~1,3 раза).
      const step = want / (L.via + 1) / 1.3;
      let dir = Math.random() * 2 * Math.PI, cur = from, total = 0, ok = true;
      const via = [], used = new Set(), path = [from];
      for (let k = 0; k <= L.via && ok; k++) {
        if (k) dir += (Math.random() * 2 - 1) * TURN;
        const [cx, cz] = w.nodes[cur];
        const next = near(cx + Math.sin(dir) * step, cz + Math.cos(dir) * step);
        const p = next !== cur && w.shortestPath(cur, next);
        if (!p || p.length < 3) { ok = false; break; }
        if (path.length > 1 && p[1] === path[path.length - 2]) { ok = false; break; } // разворот на точке
        let seg = 0, again = 0;
        for (let i = 1; i < p.length; i++) {
          const [ax, az] = w.nodes[p[i - 1]], [bx, bz] = w.nodes[p[i]], d = Math.hypot(bx - ax, bz - az);
          const key = p[i - 1] < p[i] ? `${p[i - 1]}-${p[i]}` : `${p[i]}-${p[i - 1]}`;
          if (used.has(key)) again += d;
          used.add(key);
          seg += d;
        }
        if (again > seg * OVERLAP) { ok = false; break; }
        total += seg;
        path.push(...p.slice(1));
        if (k < L.via) via.push(next);
        cur = next;
      }
      if (!ok) continue;
      const err = total < L.min ? L.min - total : total > L.max ? total - L.max : 0;
      if (err < bestErr) { bestErr = err; best = { from, to: cur, via }; }
      if (!err) break;
    }
    return best;
  }

  // Общая гонка: старт в момент startAt (мс по clock()), slot — место в стартовой сетке.
  startShared({ from, to, via = [], startAt, slot, clock }) {
    if (!this.#begin(from, to, via)) return false;
    this.shared = true;
    this.startAt = startAt;
    this.clock = clock;
    const { x, z, heading } = this.startPose, row = slot >> 1, side = slot % 2 ? 1 : -1;
    const fx = Math.sin(heading), fz = Math.cos(heading);
    this.startPose = { x: x - fx * GRID_BACK * row + fz * GRID_SIDE * side, z: z - fz * GRID_BACK * row - fx * GRID_SIDE * side, heading };
    this.update(0, null);
    return true;
  }

  #begin(from, to, via = []) {
    const w = this.world, pts = [from, ...via, to];
    if (!pts.every((id) => w.graph.has(id))) return false;
    const path = [from];
    for (let k = 1; k < pts.length; k++) {
      const p = w.shortestPath(pts[k - 1], pts[k]);
      if (!p) return false;
      path.push(...p.slice(1));
    }
    if (path.length < 2) return false;
    this.shared = false;
    this.startAt = null;

    this.route = path.map((id) => w.nodes[id]);
    this.checkpoints = [];
    this.cum = [0]; // пройдено по маршруту до узла i, м
    let acc = 0, len = 0;
    for (let i = 1; i < this.route.length; i++) {
      const [ax, az] = this.route[i - 1], [bx, bz] = this.route[i];
      const seg = Math.hypot(bx - ax, bz - az);
      len += seg;
      acc += seg;
      this.cum.push(len);
      if (acc >= CP_SPACING && len < this.#total() - CP_SPACING * 0.5) {
        this.checkpoints.push({ x: bx, z: bz, i });
        acc = 0;
      }
    }
    const [lx, lz] = this.route[this.route.length - 1];
    this.checkpoints.push({ x: lx, z: lz, finish: true, i: this.route.length - 1 });
    this.length = len;

    this.#buildGates();
    const [sx, sz] = this.route[0], [nx, nz] = this.route[Math.min(3, this.route.length - 1)];
    this.startPose = { x: sx, z: sz, heading: Math.atan2(nx - sx, nz - sz) };
    this.state = 'countdown';
    this.countdown = 3;
    this.time = 0;
    this.next = 0;
    this.#updateGateLook();
    this.onBegin?.();
    return true;
  }

  // Тот же маршрут заново: отсчёт со старта. Общая гонка общая и по времени — заново её не начать.
  restart() {
    if (!this.route.length) return false;
    if (this.shared) return this.state === 'countdown';
    this.state = 'countdown';
    this.countdown = 3;
    this.time = 0;
    this.next = 0;
    this.#updateGateLook();
    return true;
  }

  // Точка маршрута в d м от старта и направление там.
  at(d) {
    const { route, cum } = this;
    let i = 1;
    while (i < route.length - 1 && cum[i] < d) i++;
    const [ax, az] = route[i - 1], [bx, bz] = route[i], seg = cum[i] - cum[i - 1] || 1;
    const k = Math.max(0, Math.min(1, (d - cum[i - 1]) / seg));
    return { x: ax + (bx - ax) * k, z: az + (bz - az) * k, dx: (bx - ax) / seg, dz: (bz - az) / seg };
  }

  #total() {
    let l = 0;
    for (let i = 1; i < this.route.length; i++) {
      l += Math.hypot(this.route[i][0] - this.route[i - 1][0], this.route[i][1] - this.route[i - 1][1]);
    }
    return l;
  }

  #buildGates() {
    this.group.clear();
    for (const cp of this.checkpoints) {
      const y = this.world.terrain(cp.x, cp.z);
      const color = cp.finish ? '#40ff8a' : '#ffd23f';
      const gate = new THREE.Mesh(this.gateGeo, new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false,
      }));
      const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color }));
      gate.position.set(cp.x, y - 2, cp.z);
      ring.position.set(cp.x, y + 0.6, cp.z);
      cp.gate = gate;
      cp.ring = ring;
      this.group.add(gate, ring);
    }
  }

  #updateGateLook() {
    this.checkpoints.forEach((cp, i) => {
      const passed = i < this.next, current = i === this.next;
      cp.gate.visible = cp.ring.visible = !passed && i <= this.next + 2;
      cp.gate.material.opacity = current ? 0.3 : 0.1;
      cp.ring.scale.setScalar(current ? 1 : 0.6);
    });
  }

  // Сколько метров маршрута проехано: проекция машины на участок между взятым и следующим чекпоинтом
  // (только на него — маршрут может проходить рядом сам с собой).
  progress(car) {
    if (this.state === 'finished') return this.length;
    if (this.state !== 'running') return 0;
    const lo = this.next > 0 ? this.checkpoints[this.next - 1].i : 0, hi = this.checkpoints[this.next].i;
    let best = this.cum[lo], bd = Infinity;
    for (let i = lo + 1; i <= hi; i++) {
      const [ax, az] = this.route[i - 1], [bx, bz] = this.route[i];
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
      const k = Math.max(0, Math.min(1, ((car.pos.x - ax) * dx + (car.pos.y - az) * dz) / l2));
      const d = Math.hypot(ax + dx * k - car.pos.x, az + dz * k - car.pos.y);
      if (d < bd) { bd = d; best = this.cum[i - 1] + Math.sqrt(l2) * k; }
    }
    return best;
  }

  update(dt, car) {
    if (this.shared && this.state !== 'finished') { // время — от общего старта, а не своими кадрами
      const t = (this.clock() - this.startAt) / 1000;
      this.countdown = -t;
      if (t >= 0) { this.state = 'running'; this.time = t; }
    }
    if (!car) return;
    if (this.state === 'countdown') {
      if (!this.shared) this.countdown -= dt;
      car.place(this.startPose.x, this.startPose.z, this.startPose.heading);
      if (this.countdown <= 0) this.state = 'running';
    } else if (this.state === 'running') {
      if (!this.shared) this.time += dt;
      const cp = this.checkpoints[this.next];
      if (Math.hypot(car.pos.x - cp.x, car.pos.y - cp.z) < CP_RADIUS) {
        this.next++;
        if (this.next >= this.checkpoints.length) {
          this.state = 'finished';
          this.finishedAt = performance.now();
          this.#saveBest();
          this.onFinish?.(this.time);
        }
        this.#updateGateLook();
      }
    }
    const t = performance.now() / 1000;
    for (const cp of this.checkpoints) cp.ring.rotation.y = t;
  }

  #saveBest() {
    // Рекорд — на дистанцию, округлённую до 100 м: маршруты случайные.
    this.bestKey = `best_${Math.round(this.length / 100)}`;
    try {
      const prev = parseFloat(localStorage.getItem(this.bestKey));
      this.isRecord = !(prev <= this.time);
      if (this.isRecord) localStorage.setItem(this.bestKey, String(this.time));
      this.best = this.isRecord ? this.time : prev;
    } catch {
      this.best = this.time;
      this.isRecord = false;
    }
  }
}

export function formatTime(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

// Гонка по чекпоинтам: маршрут — кратчайший путь по графу улиц. Общая гонка в комнате: маршрут задают
// узлы старта и финиша (у всех один граф — один путь), отсчёт и время — по часам сервера (clock).
import * as THREE from 'three';

const CP_SPACING = 230;
const CP_RADIUS = 13;
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
    // Стрелка над машиной, указывает на следующий чекпоинт.
    // Объёмная стрелка: силуэт (древко + наконечник), вытянутый в толщину со скруглёнными
    // краями, с бликом и тенью; лежит горизонтально, остриём к цели (+z).
    const shape = new THREE.Shape();
    shape.moveTo(-0.17, -0.55);
    shape.lineTo(0.17, -0.55);
    shape.lineTo(0.17, 0.05);
    shape.lineTo(0.48, 0.05);
    shape.lineTo(0, 0.7);
    shape.lineTo(-0.48, 0.05);
    shape.lineTo(-0.17, 0.05);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 3 });
    geo.translate(0, -0.07, -0.08).rotateX(Math.PI / 2); // +y силуэта → +z; толщина по вертикали
    this.arrow = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({
      color: '#ffc928', emissive: '#4a3000', specular: '#fff4c2', shininess: 70, transparent: true, opacity: 0.88,
    }));
    this.arrow.castShadow = true;
    this.arrow.visible = false;
    scene.add(this.arrow);
  }

  // Новая гонка от точки (x, z): финиш в 1.3–2.3 км по прямой, маршрут по улицам.
  start(x, z) {
    const p = this.pick(x, z);
    return !!p && this.#begin(p.from, p.to);
  }

  // Узлы старта и финиша новой гонки от точки (x, z).
  pick(x, z) {
    const w = this.world;
    const from = w.nearestGraphNode(x, z);
    const ids = [...w.graph.keys()];
    for (let tries = 0; tries < 60; tries++) {
      const to = ids[Math.floor(Math.random() * ids.length)];
      const [px, pz] = w.nodes[to], [fx, fz] = w.nodes[from];
      const d = Math.hypot(px - fx, pz - fz);
      if (d < 1300 || d > 2300) continue;
      const p = w.shortestPath(from, to);
      if (p && p.length > 5) return { from, to };
    }
    return null;
  }

  // Общая гонка: старт в момент startAt (мс по clock()), slot — место в стартовой сетке.
  startShared({ from, to, startAt, slot, clock }) {
    if (!this.#begin(from, to)) return false;
    this.shared = true;
    this.startAt = startAt;
    this.clock = clock;
    const { x, z, heading } = this.startPose, row = slot >> 1, side = slot % 2 ? 1 : -1;
    const fx = Math.sin(heading), fz = Math.cos(heading);
    this.startPose = { x: x - fx * GRID_BACK * row + fz * GRID_SIDE * side, z: z - fz * GRID_BACK * row - fx * GRID_SIDE * side, heading };
    this.update(0, null);
    return true;
  }

  #begin(from, to) {
    const w = this.world;
    const path = w.graph.has(from) && w.graph.has(to) ? w.shortestPath(from, to) : null;
    if (!path || path.length < 2) return false;
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

    const target = this.checkpoints[this.next];
    this.arrow.visible = (this.state === 'running' || this.state === 'countdown') && !!target;
    if (this.arrow.visible) {
      // Лёгкое покачивание вверх-вниз.
      const y = car.y + 2.5 + Math.sin(performance.now() / 300) * 0.08;
      this.arrow.position.set(car.pos.x, y, car.pos.y);
      this.arrow.lookAt(target.x, y, target.z);
    }
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

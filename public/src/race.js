// Гонка по чекпоинтам: маршрут — кратчайший путь по графу улиц.
import * as THREE from 'three';

const CP_SPACING = 230;
const CP_RADIUS = 13;

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
    this.arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.6, 1.8, 12).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffd23f' }),
    );
    this.arrow.visible = false;
    scene.add(this.arrow);
  }

  // Новая гонка от точки (x, z): финиш в 1.3–2.3 км по прямой, маршрут по улицам.
  start(x, z) {
    const w = this.world;
    const from = w.nearestGraphNode(x, z);
    const ids = [...w.graph.keys()];
    let path = null;
    for (let tries = 0; tries < 60 && !path; tries++) {
      const to = ids[Math.floor(Math.random() * ids.length)];
      const [px, pz] = w.nodes[to], [fx, fz] = w.nodes[from];
      const d = Math.hypot(px - fx, pz - fz);
      if (d < 1300 || d > 2300) continue;
      const p = w.shortestPath(from, to);
      if (p && p.length > 5) path = p;
    }
    if (!path) return false;

    this.route = path.map((id) => w.nodes[id]);
    this.checkpoints = [];
    let acc = 0, len = 0;
    for (let i = 1; i < this.route.length; i++) {
      const [ax, az] = this.route[i - 1], [bx, bz] = this.route[i];
      const seg = Math.hypot(bx - ax, bz - az);
      len += seg;
      acc += seg;
      if (acc >= CP_SPACING && len < this.#total() - CP_SPACING * 0.5) {
        this.checkpoints.push({ x: bx, z: bz });
        acc = 0;
      }
    }
    const [lx, lz] = this.route[this.route.length - 1];
    this.checkpoints.push({ x: lx, z: lz, finish: true });
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

  // Тот же маршрут заново: отсчёт со старта.
  restart() {
    if (!this.route.length) return false;
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

  update(dt, car) {
    if (this.state === 'countdown') {
      this.countdown -= dt;
      car.place(this.startPose.x, this.startPose.z, this.startPose.heading);
      if (this.countdown <= 0) this.state = 'running';
    } else if (this.state === 'running') {
      this.time += dt;
      const cp = this.checkpoints[this.next];
      if (Math.hypot(car.pos.x - cp.x, car.pos.y - cp.z) < CP_RADIUS) {
        this.next++;
        if (this.next >= this.checkpoints.length) {
          this.state = 'finished';
          this.#saveBest();
        }
        this.#updateGateLook();
      }
    }
    const t = performance.now() / 1000;
    for (const cp of this.checkpoints) cp.ring.rotation.y = t;

    const target = this.checkpoints[this.next];
    this.arrow.visible = (this.state === 'running' || this.state === 'countdown') && !!target;
    if (this.arrow.visible) {
      this.arrow.position.set(car.pos.x, car.y + 3.4, car.pos.y);
      this.arrow.lookAt(target.x, car.y + 3.4, target.z);
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

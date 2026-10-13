// Аркадная машинка: своя простая физика в плоскости + высота по поверхности.
import * as THREE from 'three';

const MAX_SPEED = 52;     // м/с ≈ 187 км/ч
const NITRO_SPEED = 68;   // ≈ 245 км/ч
const ACCEL = 13;
const BRAKE = 28;
const REVERSE_MAX = 12;
const GRIP = 9;           // как быстро гасится боковое скольжение
const DRIFT_GRIP = 1.4;
const STEER_RATE = 2.3;   // рад/с на средней скорости
const RADIUS = 1.15;      // два круга-коллайдера вдоль кузова
const AXLE = 1.25;
const SINK_TIME = 2.8;    // с: от въезда в воду до «утонул»

export function buildCarModel() {
  const car = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color: '#b3261e' });
  const dark = new THREE.MeshLambertMaterial({ color: '#1b1d20' });
  const glass = new THREE.MeshLambertMaterial({ color: '#2b3b4a' });
  const chrome = new THREE.MeshLambertMaterial({ color: '#b9bcc0' });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 4.3), paint);
  body.position.y = 0.65;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 2.1), glass);
  cabin.position.set(0, 1.22, -0.25);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.08, 1.9), paint);
  roof.position.set(0, 1.52, -0.3);
  car.add(body, cabin, roof);

  const lightGeo = new THREE.BoxGeometry(0.4, 0.15, 0.05);
  for (const sx of [-0.6, 0.6]) {
    const head = new THREE.Mesh(lightGeo, new THREE.MeshBasicMaterial({ color: '#fff6d0' }));
    head.position.set(sx, 0.75, 2.16);
    const tail = new THREE.Mesh(lightGeo, new THREE.MeshBasicMaterial({ color: '#ff2a1a' }));
    tail.position.set(sx, 0.75, -2.16);
    car.add(head, tail);
  }
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.15, 0.1), chrome);
  bumper.position.set(0, 0.45, 2.17);
  car.add(bumper);

  car.userData.wheels = [];
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.25, 14).rotateZ(Math.PI / 2);
  for (const [x, z] of [[-0.85, 1.35], [0.85, 1.35], [-0.85, -1.35], [0.85, -1.35]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.34, z);
    const w = new THREE.Mesh(wheelGeo, dark);
    pivot.add(w);
    car.add(pivot);
    car.userData.wheels.push({ pivot, w, front: z > 0 });
  }
  car.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return car;
}

export class Car {
  constructor(world, model) {
    this.world = world;
    this.model = model;
    this.pos = new THREE.Vector2();
    this.vel = new THREE.Vector2();
    this.heading = 0;
    this.y = 0;
    this.steer = 0;
    this.nitro = 1;
    this.pitch = 0;
    this.roll = 0;
    this.wheelSpin = 0;
    this.impact = 0;
    this.sink = 0;          // сколько секунд в воде
    this.drowned = false;
    this.dry = new THREE.Vector2(); // последняя точка на суше
  }

  place(x, z, heading) {
    this.pos.set(x, z);
    this.vel.set(0, 0);
    this.sink = 0;
    this.drowned = false;
    this.pitch = 0;
    this.heading = heading;
    this.y = this.world.ground(x, z);
  }

  get forward() { return new THREE.Vector2(Math.sin(this.heading), Math.cos(this.heading)); }
  get right() { return new THREE.Vector2(-Math.cos(this.heading), Math.sin(this.heading)); }
  get speed() { return this.vel.dot(this.forward); }

  update(dt, input) {
    // В воде: мотор заглох, руль не слушается, машина тонет. drowned — пора начинать сначала.
    const wet = this.sink > 0 || this.world.isWater(this.pos.x, this.pos.y);
    if (wet) {
      this.sink += dt;
      this.drowned = this.sink > SINK_TIME;
      input = {};
    } else {
      this.dry.set(this.pos.x, this.pos.y);
    }
    const f = this.forward, r = this.right;
    let vf = this.vel.dot(f), vr = this.vel.dot(r);

    const nitroOn = input.nitro && this.nitro > 0 && vf > 5;
    this.nitro = Math.min(1, Math.max(0, this.nitro + (nitroOn ? -0.35 : 0.08) * dt));
    const top = nitroOn ? NITRO_SPEED : MAX_SPEED;

    if (input.up) {
      vf += (nitroOn ? ACCEL * 1.8 : ACCEL) * Math.max(0, 1 - vf / top) * dt;
    } else if (input.down) {
      if (vf > 0.5) vf -= BRAKE * dt;
      else vf -= ACCEL * 0.7 * Math.max(0, 1 + vf / REVERSE_MAX) * dt;
    } else {
      vf -= Math.sign(vf) * Math.min(Math.abs(vf), 2.5 * dt); // накат
    }
    vf -= vf * Math.abs(vf) * 0.0004 * dt; // сопротивление воздуха
    if (input.brake) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 9 * dt);

    // Руль: плавно к цели, на скорости — меньше угол.
    const target = input.steer ?? (input.right ? 1 : 0) - (input.left ? 1 : 0);
    this.steer += (target - this.steer) * Math.min(1, dt * 8);
    const speedFactor = Math.min(1, Math.abs(vf) / 6) / (1 + Math.abs(vf) / 45);
    const driftBoost = input.brake ? 1.5 : 1;
    this.heading -= this.steer * STEER_RATE * speedFactor * driftBoost * Math.sign(vf || 1) * dt;

    vr *= Math.exp(-(input.brake ? DRIFT_GRIP : GRIP) * dt);
    const f2 = this.forward, r2 = this.right;
    this.vel.set(f2.x * vf + r2.x * vr, f2.y * vf + r2.y * vr);
    if (wet) this.vel.multiplyScalar(Math.exp(-2.4 * dt)); // вода держит
    this.pos.addScaledVector(this.vel, dt);

    this.#collide();

    // Высота и наклон кузова по поверхности.
    const g = this.world;
    const ground = g.ground(this.pos.x, this.pos.y);
    this.y += (ground - this.y) * Math.min(1, dt * 15);
    const hf = g.ground(this.pos.x + f2.x * 1.6, this.pos.y + f2.y * 1.6);
    const hb = g.ground(this.pos.x - f2.x * 1.6, this.pos.y - f2.y * 1.6);
    const hl = g.ground(this.pos.x - r2.x * 0.9, this.pos.y - r2.y * 0.9);
    const hr = g.ground(this.pos.x + r2.x * 0.9, this.pos.y + r2.y * 0.9);
    const k = Math.min(1, dt * 10);
    this.pitch += (-Math.atan2(hf - hb, 3.2) - this.pitch) * k;
    // Крен от рельефа плюс немного от поворота — для ощущения скорости.
    const lean = this.steer * Math.min(1, Math.abs(vf) / 30) * 0.05;
    this.roll += (Math.atan2(hl - hr, 1.8) - lean - this.roll) * k;

    if (this.sink > 0) {
      // Уходит под воду носом вниз.
      this.y = ground - Math.min(3.2, this.sink * this.sink * 0.55);
      this.pitch = Math.min(0.45, this.sink * 0.22);
    }

    this.impact = Math.max(0, this.impact - dt * 2);
    this.#syncModel(dt, vf);
  }

  #collide() {
    const f = this.forward;
    for (const s of [AXLE, -AXLE]) {
      const c = new THREE.Vector2(this.pos.x + f.x * s, this.pos.y + f.y * s);
      const before = c.clone();
      const n = this.world.collide(c, RADIUS);
      if (!n) continue;
      this.pos.add(c.sub(before));
      const vn = this.vel.x * n.x + this.vel.y * n.z;
      if (vn < 0) {
        this.vel.x -= 1.3 * vn * n.x;
        this.vel.y -= 1.3 * vn * n.z;
        this.vel.multiplyScalar(0.85);
        this.impact = Math.max(this.impact, Math.min(1, -vn / 20));
      }
    }
  }

  #syncModel(dt, vf) {
    const m = this.model;
    m.position.set(this.pos.x, this.y, this.pos.y);
    m.rotation.order = 'YXZ';
    m.rotation.set(this.pitch, this.heading, this.roll);
    this.wheelSpin += (vf / 0.34) * dt;
    for (const { pivot, w, front } of m.userData.wheels) {
      w.rotation.x = this.wheelSpin;
      pivot.rotation.y = front ? -this.steer * 0.45 : 0;
    }
  }
}

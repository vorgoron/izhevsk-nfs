// Аркадная машинка: своя простая физика в плоскости + высота по поверхности.
import * as THREE from 'three';

// Скорость, разгон и сцепление — от модели (vehicles.js), здесь базовые величины.
const NITRO_K = 1.3;      // нитро: верхняя скорость ×1.3
const NITRO_UNLOCK = 0.25; // после опустошения нитро снова доступно с этого запаса
// Вне дороги (трава, лес, пустырь): доля от максимальной скорости, разгона, сцепления; торможение грунтом.
const OFF_SPEED = 0.45, OFF_ACCEL = 0.5, OFF_GRIP = 0.6, OFF_DRAG = 0.08;
const ACCEL = 13;
const BRAKE = 28;
const REVERSE_MAX = 12;
const GRIP = 9;           // как быстро гасится боковое скольжение
const DRIFT_GRIP = 1.4;
const STEER_RATE = 2.3;   // рад/с на средней скорости
// Крен кузова в повороте: рад на 1 м/с² бокового ускорения, предел; пружина подвески (жёсткость, демпфер).
const ROLL_K = 0.005, ROLL_MAX = 0.1, ROLL_STIFF = 70, ROLL_DAMP = 9;

// Шаг крена на подвеске к цели от бокового ускорения (скорость × угловая скорость по курсу).
// o: { roll, rollV }; yaw — скорость изменения курса, рад/с (рост курса — поворот влево).
function stepRoll(o, yaw, speed, dt) {
  const target = Math.max(-ROLL_MAX, Math.min(ROLL_MAX, yaw * speed * ROLL_K));
  const sdt = Math.min(dt, 1 / 30);
  o.rollV += ((target - o.roll) * ROLL_STIFF - o.rollV * ROLL_DAMP) * sdt;
  o.roll += o.rollV * sdt;
}
const RADIUS = 1.15;      // два круга-коллайдера вдоль кузова
const AXLE = 1.25;
const SINK_TIME = 2.8;    // с: от въезда в воду до «утонул»
const TANK_M = 9000;      // м на полном баке при обычном газе; нитро — втрое больше расхода

export class Car {
  constructor(world, model, stats) {
    this.world = world;
    this.setModel(model, stats);
    this.pos = new THREE.Vector2();
    this.vel = new THREE.Vector2();
    this.heading = 0;
    this.y = 0;
    this.steer = 0;
    this.nitro = 1;
    this.pitch = 0;
    this.roll = 0;
    this.bodyRoll = 0;      // крен кузова на подвеске (колёса не наклоняются)
    this.bodyRollV = 0;
    this.wheelSpin = 0;
    this.impact = 0;
    this.sink = 0;          // сколько секунд в воде
    this.drowned = false;
    this.dry = new THREE.Vector2(); // последняя точка на суше
    this.fuel = 1;          // бак, 0..1
    this.refueling = false; // выставляет Fuel
  }

  // Смена машины: модель и характеристики (км/ч, разгон и сцепление относительно базы).
  setModel(model, stats) {
    this.model = model;
    this.maxSpeed = stats.kmh / 3.6;
    this.accel = ACCEL * stats.accel;
    this.grip = GRIP * stats.grip;
    this.eco = stats.eco ?? 1;
  }

  place(x, z, heading) {
    this.pos.set(x, z);
    this.vel.set(0, 0);
    this.sink = 0;
    this.drowned = false;
    this.pitch = 0;
    this.bodyRoll = this.bodyRollV = 0;
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
    // Покрытие под машиной — 20 раз в секунду; offroad плавно 0..1 (дорога → грунт).
    this.surfT = (this.surfT ?? 0) - dt;
    if (this.surfT <= 0) { this.surface = this.world.surfaceAt(this.pos.x, this.pos.y); this.surfT = 0.05; }
    this.offroad = (this.offroad ?? 0) + ((this.surface === 'ground' ? 1 : 0) - (this.offroad ?? 0)) * Math.min(1, dt * 5);
    const off = this.offroad;
    const f = this.forward, r = this.right;
    let vf = this.vel.dot(f), vr = this.vel.dot(r);

    // Пустой бак: мотор заглох — ни газа, ни заднего хода, ни нитро; тормоз работает.
    if (this.fuel <= 0) input = { ...input, up: false, nitro: false, down: input.down && vf > 0.5 };
    // Кончилось нитро — заперто, пока баллон не наполнится на четверть (иначе на пустом баллоне
    // нитро включалось бы каждый кадр на крохи восстановления).
    if (this.nitro <= 0) this.nitroLocked = true;
    else if (this.nitro >= NITRO_UNLOCK) this.nitroLocked = false;
    const nitroOn = input.nitro && !this.nitroLocked && vf > 5;
    this.nitroOn = nitroOn;
    const vf0 = vf;
    if (input.up || (input.down && vf <= 0.5)) {
      this.fuel = Math.max(0, this.fuel - (Math.abs(vf) * dt + 0.3 * dt) / TANK_M * this.eco * (nitroOn ? 3 : 1));
    }
    this.nitro = Math.min(1, Math.max(0, this.nitro + (nitroOn ? -0.35 : 0.08) * dt));
    const top = (nitroOn ? this.maxSpeed * NITRO_K : this.maxSpeed) * (1 - (1 - OFF_SPEED) * off);
    const accel = this.accel * (1 - (1 - OFF_ACCEL) * off);

    if (input.up) {
      vf += (nitroOn ? accel * 1.8 : accel) * Math.max(0, 1 - vf / top) * dt;
    } else if (input.down) {
      if (vf > 0.5) vf -= BRAKE * dt;
      else vf -= accel * 0.7 * Math.max(0, 1 + vf / REVERSE_MAX) * dt;
    } else {
      vf -= Math.sign(vf) * Math.min(Math.abs(vf), 2.5 * dt); // накат
    }
    vf -= vf * Math.abs(vf) * 0.0004 * dt; // сопротивление воздуха
    vf -= vf * OFF_DRAG * off * dt;        // грунт тормозит
    if (vf > top + 1) vf -= Math.min(vf - top, 14 * dt); // съехал с дороги на скорости — сбрасываем до предела грунта
    if (input.brake) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 9 * dt);

    // Руль: плавно к цели, на скорости — меньше угол.
    const target = input.steer ?? (input.right ? 1 : 0) - (input.left ? 1 : 0);
    this.steer += (target - this.steer) * Math.min(1, dt * 8);
    const speedFactor = Math.min(1, Math.abs(vf) / 6) / (1 + Math.abs(vf) / 45);
    const driftBoost = input.brake ? 1.5 : 1;
    const yawRate = this.steer * STEER_RATE * speedFactor * driftBoost * Math.sign(vf || 1);
    this.heading -= yawRate * dt;

    vr *= Math.exp(-(input.brake ? DRIFT_GRIP : this.grip * (1 - (1 - OFF_GRIP) * off)) * dt);
    const f2 = this.forward, r2 = this.right;
    this.vel.set(f2.x * vf + r2.x * vr, f2.y * vf + r2.y * vr);
    // Сглаженное продольное ускорение — для камеры (отстаёт при разгоне).
    if (dt > 0) this.accel_ = (this.accel_ ?? 0) + ((vf - vf0) / dt - (this.accel_ ?? 0)) * Math.min(1, dt * 5);
    if (wet) this.vel.multiplyScalar(Math.exp(-2.4 * dt)); // вода держит
    this.pos.addScaledVector(this.vel, dt);

    this.#collide();

    // Высота и наклон кузова по поверхности.
    const g = this.world;
    // От текущей высоты: под мостом настил над головой не считается поверхностью.
    const y0 = this.y;
    const ground = g.ground(this.pos.x, this.pos.y, y0);
    this.y += (ground - this.y) * Math.min(1, dt * 15);
    const hf = g.ground(this.pos.x + f2.x * 1.6, this.pos.y + f2.y * 1.6, y0);
    const hb = g.ground(this.pos.x - f2.x * 1.6, this.pos.y - f2.y * 1.6, y0);
    const hl = g.ground(this.pos.x - r2.x * 0.9, this.pos.y - r2.y * 0.9, y0);
    const hr = g.ground(this.pos.x + r2.x * 0.9, this.pos.y + r2.y * 0.9, y0);
    const k = Math.min(1, dt * 10);
    this.pitch += (-Math.atan2(hf - hb, 3.2) - this.pitch) * k;
    this.roll += (Math.atan2(hl - hr, 1.8) - this.roll) * k; // от рельефа — вся машина
    // Кузов кренится наружу поворота от бокового ускорения (скорость × угловая скорость) и
    // покачивается на подвеске — пружина с демпфером, после поворота чуть перекачивается обратно.
    const sus = { roll: this.bodyRoll, rollV: this.bodyRollV };
    stepRoll(sus, -yawRate, vf, dt);
    this.bodyRoll = sus.roll; this.bodyRollV = sus.rollV;
    // Кочки на грунте: мелкая тряска кузова, сильнее на скорости.
    if (off > 0.05) {
      const b = off * Math.min(1, Math.abs(vf) / 12) * 0.025;
      this.pitch += (Math.random() - 0.5) * b;
      this.roll += (Math.random() - 0.5) * b;
    }

    if (this.sink > 0) {
      // Уходит под воду носом вниз.
      this.y = ground - Math.min(3.2, this.sink * this.sink * 0.55);
      this.pitch = Math.min(0.45, this.sink * 0.22);
    }

    this.impact = Math.max(0, this.impact - dt * 2);
    this.#syncModel(dt, vf);
  }

  // Контакт с машиной трафика или очереди: n — нормаль от неё к нам, depth — перекрытие,
  // vn — относительная скорость по нормали. Лёгкое касание только расталкивает, удар — отскок,
  // потеря скорости и тряска. Возвращает true при ударе.
  touchVehicle(nx, nz, depth, vn) {
    this.contact = true;
    this.pos.x += nx * depth;
    this.pos.y += nz * depth;
    if (vn >= 0) return false;
    const hard = vn < -3;
    this.vel.x -= (hard ? 1.3 : 1) * vn * nx;
    this.vel.y -= (hard ? 1.3 : 1) * vn * nz;
    if (hard) {
      this.vel.multiplyScalar(0.85);
      this.impact = Math.max(this.impact, Math.min(1, -vn / 20));
    }
    return hard;
  }

  // Раз в кадр, после столкновений с машинами: зажат и стоишь, хотя жмёшь газ/назад, больше
  // секунды — на 2 с соседние машины не мешают (ghostVehicles), чтобы выехать.
  checkStuck(dt, input) {
    this.ghostVehicles = Math.max(0, (this.ghostVehicles ?? 0) - dt);
    const trying = input.up || input.down;
    if (this.contact && trying && Math.abs(this.speed) < 1.5) this.stuckT = (this.stuckT ?? 0) + dt;
    else this.stuckT = Math.max(0, (this.stuckT ?? 0) - dt * 2);
    if (this.stuckT > 1) { this.ghostVehicles = 2; this.stuckT = 0; }
    this.contact = false;
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
    if (m.userData.body) m.userData.body.rotation.z = this.bodyRoll;
    this.wheelSpin += (vf / 0.34) * dt;
    for (const { pivot, w, front } of m.userData.wheels) {
      w.rotation.x = this.wheelSpin;
      pivot.rotation.y = front ? -this.steer * 0.45 : 0;
    }
  }
}

// Аркадная машинка: своя простая физика в плоскости + высота по поверхности.
import * as THREE from 'three';

// Скорость, разгон и сцепление — от модели (vehicles.js), здесь базовые величины.
const NITRO_K = 1.3;      // нитро: верхняя скорость ×1.3
const NITRO_UNLOCK = 0.25; // после опустошения нитро снова доступно с этого запаса
const NITRO_REFILL = 0.06; // 1/с: баллон сам наполняется, пока нитро не горит (~17 с с нуля); за деньги — сразу
// Нитро само не восполняется — баллон заправляют за деньги на АЗС или в меню (fuel.js, money.js).
// Вне дороги (трава, лес, пустырь): доля от максимальной скорости, разгона, сцепления; торможение грунтом.
const OFF_SPEED = 0.45, OFF_ACCEL = 0.5, OFF_GRIP = 0.6, OFF_DRAG = 0.08;
const ACCEL = 13;
const BRAKE = 28;
const REVERSE_MAX = 12;
const GRIP = 9;           // как быстро гасится боковое скольжение
// Ручник блокирует задние колёса: тормозит слабее педали (одна ось, ~0,55 g) и срывает зад в занос.
// Занос (slide 0..1): шины почти не держат вбок (DRIFT_GRIP), скорость больше не поворачивается вместе с
// кузовом — машину несёт, а курс задаёт угол заноса: руль в поворот — круче, прямо — средний, против —
// почти прямо (выход). Кузов догоняет этот угол за ~1/DRIFT_K с, траекторию гнёт
// оставшееся сцепление (круче угол — круче поворот). Под газом занос держится, пока машина боком больше
// SLIDE_MIN; без газа или выпрямился — гаснет. Часть потерянной боковой скорости уходит вперёд (DRIFT_KEEP),
// иначе дрифт гасил бы скорость за пару секунд. Тормоз педалью на скорости с рулём до упора тоже
// подбрасывает зад (SLIDE_BRAKE, до половины заноса) — вход в поворот с подтормаживанием.
// На грунте (offroad) всё скользче — пары значений [асфальт, грунт]: с рулём прямо занос шире (DRIFT_BASE + DIRT_ANGLE),
// дольше гаснет и сильнее тормозит, а сорвать зад можно и одним газом с рулём до упора (SLIDE_DIRT) — как в ралли.
const DRIFT_GRIP = [1.4, 0.8];
const HANDBRAKE = 5.5;    // м/с²
const SLIDE_ON = 6, SLIDE_BRAKE = 2, SLIDE_DIRT = 1.5; // 1/с: срыв ручником, тормозом, газом на грунте
const SLIDE_OFF = [2.2, 1.2]; // 1/с: угасание заноса
const DEG = Math.PI / 180;
const SLIDE_MIN = 8 * DEG;
// Угол заноса: руль прямо — DRIFT_BASE, в поворот до упора — DRIFT_MAX, против до упора — DRIFT_EXIT.
const DRIFT_BASE = 25 * DEG, DRIFT_MAX = 45 * DEG, DRIFT_EXIT = 5 * DEG, DIRT_ANGLE = 10 * DEG;
const DRIFT_K = 3, DRIFT_KEEP = [0.6, 0.5], DRIFT_ACCEL = 0.4;
// Значение для покрытия: off — 0 асфальт … 1 грунт.
const bySurface = ([road, dirt], off) => road + (dirt - road) * off;
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
// Трюки (как у Roadster): подскок на струях и полный оборот в воздухе — kickflip вокруг продольной
// оси (вбок), backflip вокруг поперечной (нос вверх и назад через крышу).
// Скорость подскока, м/с, и тяжесть, м/с²: полёт ~1,65 с, высота ~5 м — выше автобуса; тяжесть меньше
// земной — машина «висит» на струях, чтобы оборот успел пройти не спеша. Вращение — вокруг
// точки на высоте FLIP_AXIS над днищем, а не вокруг низа колёс.
// Оборот ведут струи, как регулятор: желаемый угол плавно доходит до 2π за долю FLIP_SPIN полёта, а сам
// угол тянется к нему пружиной с демпфером (FLIP_K, FLIP_C) — без рывков в начале и в конце, с перелётом
// ~11° за полный оборот и возвратом назад; к посадке успокаивается (ошибка ~0,1°). Угловое ускорение
// пружины — это и есть работа струй (air.acc для JetFX), поэтому видны и поправки.
const FLIP_VY = 12.3, FLIP_G = 15, FLIP_SPIN = 0.5, FLIP_AXIS = 0.7;
const FLIP_K = 100, FLIP_C = 11, FLIP_ACC = 30; // 1/с², 1/с; рад/с² — ускорение, при котором струи на полной тяге
// Поворот в воздухе боковыми соплами, рад/с на полном руле; курс полёта поворачивается вместе с машиной.
const AIR_YAW = 0.9;
// Бочка: тот же оборот вбок, что kickflip, но сторона задаётся самим набором и машину сносит вбок, м/с.
const ROLL_SIDE = 3.5;
// Выше этой высоты над поверхностью машины трафика не задевают — пролетаем.
export const CLEAR_ALT = 1.6;
// Удар со стороны: момент инерции кузова на единицу массы, м² (брусок 4,3 × 1,8 м); закрутка гаснет
// (YAW_DAMP, 1/с), шины после удара держат хуже (skid 0..1 срезает сцепление на SKID_GRIP, проходит за ~1 с).
export const YAW_K = (4.3 ** 2 + 1.8 ** 2) / 12;
const YAW_DAMP = 2.2, YAW_MAX = 4, SKID_GRIP = 0.85;
const RADIUS = 1.15;      // два круга-коллайдера вдоль кузова
const AXLE = 1.25;
const ZERO = new THREE.Vector2();
const SINK_TIME = 2.8;    // с: от въезда в воду до «утонул»
const DIRT_OFF = 0.6; // грунтовка: доля «бездорожья» (скорость, сцепление, тряска); > 0,5 — пыль и срыв газом, как на грунте
// Лежачие полицейские (World.bumpCross): быстрее BUMP_HOP м/с подбрасывает; [подскок, м/с вверх на 1 м/с сверх
// порога; скорость, на которой удар в полную силу] по виду неровности.
// Подскок до BUMP_HOP_MAX м/с: на 60 км/ч через бугор — ~0,7 м, на 90 — ~1,2 м (было 0,2 и 0,5 — почти не видно).
const BUMP_HOP = 9, BUMP_HOP_MAX = 6, BUMP_HIT = [[0.6, 25], [0.45, 35], [0.35, 40]];
// Крыши: после трюка можно сесть на машину трафика, трамвай или дом (support — main.js) и ехать по ней;
// съехал с края, а под колёсами пустота выше FALL м — падаешь.
const FALL = 1.2;
// Трамплин-ускоритель (ramps.js, хук ramp — main.js): заехал — разгоняет на RAMP_BOOST м/с, но не быстрее RAMP_TOP × верхней
// скорости, и RAMP_FX с горит нитро (пламя, камера); на земле лишняя скорость сходит за пару секунд, в воздухе держится.
// Съехал с кромки быстрее RAMP_MIN м/с — улетаешь, скорость вверх — доля
// скорости вперёд, в пределах [RAMP_VY_MIN, RAMP_VY_MAX]: на 85 км/ч — ~17 м над трамплином, пятиэтажку перелетаешь
// или садишься на крышу; 9-этажка выше — в стену.
const RAMP_MIN = 8, RAMP_VY = 0.9, RAMP_VY_MIN = 6, RAMP_VY_MAX = 24, RAMP_LIP = 0.8;
const RAMP_BOOST = 12, RAMP_TOP = 1.5, RAMP_FX = 1.2;
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
    this.air = null;        // в прыжке: { t, vy, dur, dir }
    this.flip = 0;          // угол оборота kickflip (крен), рад
    this.flipP = 0;         // угол оборота backflip (нос вверх), рад
    this.alt = 0;           // высота над поверхностью
    this.airSteer = 0;      // руль в воздухе (−1..1) — для боковых сопел
    this.yawV = 0;          // закрутка от удара, рад/с (как рост heading)
    this.skid = 0;          // после удара шины скользят, 0..1
    this.slide = 0;         // занос от ручника, 0..1
    // Опора сверху, на которую можно сесть: (x, z, y) → { y, vx, vz, kind, obj } — самая высокая крыша
    // не выше y + 0.5 или null; задаёт main.js. onTop — на чём стоим сейчас (null — на земле).
    this.support = null;
    this.onTop = null;
    // Трамплин под колёсами: (x, z, y, fx, fz) → { y, k, slope } или null; задаёт main.js. onRamp — на каком стоим.
    this.ramp = null;
    this.onRamp = null;
    this.boostT = 0;     // сколько ещё горит пламя ускорителя, с
    this.nitroBoost = 1; // во сколько раз быстрее наполняется нитро (отстающему в общей гонке — main.js)
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
    this.air = null;
    this.onRamp = null;
    this.hopV = this.hopH = 0;
    this.flip = this.flipP = this.alt = 0;
    this.yawV = this.skid = this.slide = 0;
    this.onTop = null;
    this.heading = heading;
    this.y = this.world.ground(x, z);
  }

  get forward() { return new THREE.Vector2(Math.sin(this.heading), Math.cos(this.heading)); }
  get right() { return new THREE.Vector2(-Math.cos(this.heading), Math.sin(this.heading)); }
  get speed() { return this.vel.dot(this.forward); }

  // Начать трюк: kind 'kick' или 'roll' (dir — в какую сторону крутиться, ±1, 1 — вправо) или 'back'.
  // Только с земли и не в воде.
  #jump(kind, dir = 1) {
    // С трамплина трюк можно начать в воздухе: оборот успевает за оставшийся полёт.
    if (this.air?.kind === 'ramp') {
      const a = this.air;
      a.kind = kind; a.dir = dir; a.t = 0;
      a.dur = Math.max(1, (a.vy + Math.sqrt(Math.max(0, a.vy * a.vy + 2 * FLIP_G * this.alt))) / FLIP_G);
      return true;
    }
    if (this.air || this.sink > 0 || this.drowned) return false;
    // a, w — угол и угловая скорость оборота; acc — угловое ускорение в долях полной тяги (± — раскрутка/торможение).
    this.air = { kind, t: 0, vy: FLIP_VY, dur: 2 * FLIP_VY / FLIP_G, dir, a: 0, w: 0, acc: 0 };
    return true;
  }
  kickflip(dir) { return this.#jump('kick', dir || 1); }
  backflip() { return this.#jump('back'); }
  barrelRoll(dir) {
    if (!this.#jump('roll', dir)) return false;
    this.vel.addScaledVector(this.right, dir * ROLL_SIDE);
    return true;
  }

  update(dt, input) {
    // В воде: мотор заглох, руль не слушается, машина тонет. drowned — пора начинать сначала.
    // Над водой в прыжке — ещё не в воде.
    const wet = this.sink > 0 || (!this.air && this.world.isWater(this.pos.x, this.pos.y));
    if (wet) {
      this.sink += dt;
      this.drowned = this.sink > SINK_TIME;
      input = {};
    } else {
      this.dry.set(this.pos.x, this.pos.y);
    }
    // Покрытие под машиной — 20 раз в секунду; offroad плавно 0..1 (дорога → грунт, грунтовка — наполовину).
    this.surfT = (this.surfT ?? 0) - dt;
    if (this.surfT <= 0) { this.surface = this.world.surfaceAt(this.pos.x, this.pos.y); this.surfT = 0.05; }
    const offT = this.surface === 'ground' ? 1 : this.surface === 'dirt' ? DIRT_OFF : 0;
    this.offroad = (this.offroad ?? 0) + (offT - (this.offroad ?? 0)) * Math.min(1, dt * 5);
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
    this.boostT = Math.max(0, (this.boostT ?? 0) - dt);
    this.nitroOn = nitroOn || this.boostT > 0; // для пламени и камеры: ускоритель — тоже нитро
    const vf0 = vf;
    if (input.up || (input.down && vf <= 0.5)) {
      this.fuel = Math.max(0, this.fuel - (Math.abs(vf) * dt + 0.3 * dt) / TANK_M * this.eco * (nitroOn ? 3 : 1));
    }
    this.nitro = Math.min(1, Math.max(0, this.nitro + (nitroOn ? -0.35 : NITRO_REFILL * this.nitroBoost) * dt));
    const top = (nitroOn ? this.maxSpeed * NITRO_K : this.maxSpeed) * (1 - (1 - OFF_SPEED) * off);
    const accel = this.accel * (1 - (1 - OFF_ACCEL) * off);

    const air = this.air;
    if (air) {
      // В воздухе колёса не держат: ни газа, ни тормоза — летим по инерции, поворачивают только сопла.
    } else if (input.up) {
      // В заносе задние колёса буксуют — разгон слабее (DRIFT_ACCEL).
      vf += (nitroOn ? accel * 1.8 : accel) * (1 - DRIFT_ACCEL * this.slide) * Math.max(0, 1 - vf / top) * dt;
    } else if (input.down) {
      if (vf > 0.5) vf -= BRAKE * dt;
      else vf -= accel * 0.7 * Math.max(0, 1 + vf / REVERSE_MAX) * dt;
    } else {
      vf -= Math.sign(vf) * Math.min(Math.abs(vf), 2.5 * dt); // накат
    }
    vf -= vf * Math.abs(vf) * 0.0004 * dt; // сопротивление воздуха
    vf -= vf * OFF_DRAG * off * dt;        // грунт тормозит
    if (vf > top + 1 && !air) vf -= Math.min(vf - top, 14 * dt); // съехал с дороги на скорости (или после ускорителя) — сбрасываем до предела
    if (input.brake && !air) vf -= Math.sign(vf) * Math.min(Math.abs(vf), HANDBRAKE * dt);

    // Руль: плавно к цели, на скорости — меньше угол.
    const target = input.steer ?? (input.right ? 1 : 0) - (input.left ? 1 : 0);
    this.steer += (target - this.steer) * Math.min(1, dt * 8);
    const speedFactor = Math.min(1, Math.abs(vf) / 6) / (1 + Math.abs(vf) / 45);
    this.airSteer = air ? this.steer : 0;
    const steerYaw = air ? this.steer * AIR_YAW : this.steer * STEER_RATE * speedFactor * Math.sign(vf || 1);

    // Угол заноса: на сколько курс левее направления движения (рад, вправо — меньше нуля).
    const beta = Math.atan2(vr, Math.abs(vf));
    // Куда заносит (знак beta) и насколько руль в ту же сторону (into: 1 — в поворот до упора, −1 — против).
    const side = Math.abs(beta) > 0.05 ? Math.sign(beta) : -Math.sign(this.steer);
    const into = -this.steer * side;
    // Занос: ручник на ходу срывает зад; под газом держится, пока едем боком; иначе сцепление возвращается.
    if (air) this.slide = 0;
    else if (input.brake && vf > 3) this.slide = Math.min(1, this.slide + SLIDE_ON * dt);
    else if (input.down && vf > 12 && Math.abs(this.steer) > 0.7) this.slide = Math.min(Math.max(this.slide, 0.5), this.slide + SLIDE_BRAKE * dt);
    else if (input.up && off > 0.5 && vf > 8 && into > 0.7) this.slide = Math.min(Math.max(this.slide, 0.8), this.slide + SLIDE_DIRT * dt);
    else if (!(input.up && vf > 5 && Math.abs(beta) > SLIDE_MIN)) this.slide = Math.max(0, this.slide - bySurface(SLIDE_OFF, off) * dt);
    this.handbrake = !air && input.brake && vf > 3; // для следов колёс
    const s = this.slide;

    // Боковое сцепление — в старых осях кузова: гасит скольжение, этим и гнёт траекторию к курсу.
    this.skid = Math.max(0, this.skid - dt);
    const skidGrip = 1 - SKID_GRIP * this.skid;
    const grip = this.grip * (1 - (1 - OFF_GRIP) * off);
    if (!air) {
      const vr0 = vr;
      vr *= Math.exp(-(grip + (bySurface(DRIFT_GRIP, off) - grip) * s) * skidGrip * dt);
      if (vf > 0) vf += Math.abs(vr0 - vr) * bySurface(DRIFT_KEEP, off) * s;
    }
    const phi0 = Math.atan2(this.vel.x, this.vel.y);
    this.vel.set(f.x * vf + r.x * vr, f.y * vf + r.y * vr);

    // Курс. Сцепление — руль поворачивает кузов, скорость поворачивается вместе с ним. Занос — кузов
    // держит угол к движению, скорость не поворачивается (её гнёт только сцепление выше).
    let turn = -steerYaw * dt;
    if (s > 0) {
      const mid = DRIFT_BASE + DIRT_ANGLE * off;
      const want = side * (into > 0 ? mid + (DRIFT_MAX - mid) * into : mid + (mid - DRIFT_EXIT) * into);
      const dphi = Math.atan2(this.vel.x, this.vel.y) - phi0;
      const drift = (dphi - Math.round(dphi / (2 * Math.PI)) * 2 * Math.PI) + DRIFT_K * (want - beta) * dt;
      turn += (drift - turn) * s;
    }
    this.heading += turn;
    this.vel.rotateAround(ZERO, -(1 - s) * turn); // ось Vector2 — против курса
    const yawRate = -turn / Math.max(dt, 1e-6);
    // Закрутка от удара: кузов поворачивается сам, а скорость остаётся прежней — машину несёт боком.
    this.heading += this.yawV * dt;
    this.yawV *= Math.exp(-YAW_DAMP * dt);
    const f2 = this.forward, r2 = this.right;
    // Сглаженное продольное ускорение — для камеры (отстаёт при разгоне).
    if (dt > 0) this.accel_ = (this.accel_ ?? 0) + ((vf - vf0) / dt - (this.accel_ ?? 0)) * Math.min(1, dt * 5);
    if (wet) this.vel.multiplyScalar(Math.exp(-2.4 * dt)); // вода держит
    this.pos.addScaledVector(this.vel, dt);
    // Стоим на едущей машине или трамвае — она везёт (своя скорость — относительно неё).
    if (this.onTop) { this.pos.x += this.onTop.vx * dt; this.pos.y += this.onTop.vz * dt; }

    this.#collide();

    // Высота и наклон кузова по поверхности.
    const g = this.world;
    // От текущей высоты: под мостом настил над головой не считается поверхностью.
    const y0 = this.y;
    const land = g.ground(this.pos.x, this.pos.y, y0);
    this.#bump(vf, air);
    // Крыша под машиной — только в прыжке и пока на ней стоим (с земли на крышу не заехать).
    const sup = (air || this.onTop) && this.support ? this.support(this.pos.x, this.pos.y, y0) : null;
    // Трамплин: его наклон — та же земля; съехал с кромки вперёд на скорости — прыжок.
    const rp = !air && this.ramp ? this.ramp(this.pos.x, this.pos.y, y0, f2.x, f2.y) : null;
    let ground = sup && sup.y > land ? sup.y : land;
    if (rp && !this.onRamp) { // заехал на ускоритель
      const v = this.vel.dot(f2), add = Math.max(0, Math.min(RAMP_BOOST, this.maxSpeed * RAMP_TOP - v));
      this.vel.addScaledVector(f2, add);
      this.boostT = RAMP_FX;
    }
    const v = this.vel.dot(f2);
    if (rp && rp.y > ground) ground = rp.y;
    else if (!air && this.onRamp && this.onRamp.k > RAMP_LIP && v > RAMP_MIN) {
      const vy = Math.max(RAMP_VY_MIN, Math.min(RAMP_VY_MAX, v * RAMP_VY));
      this.air = { kind: 'ramp', t: 0, vy, dur: 2 * vy / FLIP_G, dir: 1, a: 0, w: 0, acc: 0 };
      this.y = Math.max(this.y, this.onRamp.y);
    }
    this.onRamp = rp && rp.y >= ground ? rp : null;
    this.onTop = sup && sup.y > land && !air ? sup : null;
    // Съехал с крыши (или с обрыва) — падаем, а не съезжаем плавно.
    if (!this.air && y0 - ground > FALL && this.sink === 0) {
      this.air = { kind: 'fall', t: 0, vy: 0, dur: 1, dir: 1, a: 0, w: 0, acc: 0 };
      this.onTop = null;
    }
    if (this.air && this.air.kind === 'fall') {
      // Падение с крыши: просто вниз, без оборота.
      const fall = this.air;
      fall.vy -= FLIP_G * dt;
      this.y += fall.vy * dt;
      if (this.y <= ground) {
        this.y = ground;
        this.air = null;
        this.impact = Math.max(this.impact, Math.min(1, -fall.vy / 15));
        if (sup && sup.y > land) this.onTop = sup;
      }
    } else if (air) {
      air.t += dt;
      air.vy -= FLIP_G * dt;
      this.y += air.vy * dt;
      const u = Math.min(1, air.t / (air.dur * FLIP_SPIN));
      const want = air.kind === 'ramp' ? 0 : Math.PI * (1 - Math.cos(Math.PI * u)); // 0 → 2π, плавно разгоняется и тормозит
      const acc = FLIP_K * (want - air.a) - FLIP_C * air.w;
      air.w += acc * dt;
      air.a += air.w * dt;
      air.acc = acc / FLIP_ACC;
      if (air.kind === 'back') this.flipP = air.a;
      else this.flip = air.dir * air.a;
      if (air.vy < 0 && this.y <= ground) {
        // Посадка: на колёса, кузов качнуло, удар (звук и тряска камеры — от impact).
        this.y = ground;
        this.air = null;
        this.flip = this.flipP = 0;
        if (air.kind !== 'back') this.bodyRollV += air.dir * 1.5;
        this.impact = Math.max(this.impact, 0.3);
        this.landings = (this.landings ?? 0) + 1; // для пара при посадке (JetFX); респаун в прыжке — не посадка
        this.landed = air.kind; // какой трюк приземлён — забирает main.js (награда)
        this.landedOn = sup && sup.y > land ? sup.kind : null; // и на что: крыша машины, трамвая, дома
        if (this.landedOn) this.onTop = sup;
      }
    } else if (!this.air) {
      this.y = this.onRamp ? ground : this.y + (ground - this.y) * Math.min(1, dt * 15);
      // Подскок на лежачем полицейском: невысоко над поверхностью, без прыжка (струи трюка не нужны).
      if (this.hopV || this.hopH) {
        this.hopV -= FLIP_G * dt;
        this.hopH = (this.hopH ?? 0) + this.hopV * dt;
        if (this.hopH <= 0) {
          this.impact = Math.max(this.impact, Math.min(0.8, -this.hopV / 8));
          this.hopH = this.hopV = 0;
        }
        this.y = Math.max(this.y, ground + this.hopH);
      }
    }
    this.alt = this.y - land; // над землёй и дорогой (на крыше — высота крыши): пролетаем ли трафик
    const hf = g.ground(this.pos.x + f2.x * 1.6, this.pos.y + f2.y * 1.6, y0);
    const hb = g.ground(this.pos.x - f2.x * 1.6, this.pos.y - f2.y * 1.6, y0);
    const hl = g.ground(this.pos.x - r2.x * 0.9, this.pos.y - r2.y * 0.9, y0);
    const hr = g.ground(this.pos.x + r2.x * 0.9, this.pos.y + r2.y * 0.9, y0);
    const k = Math.min(1, dt * 10);
    // В воздухе — ровно, рельеф под колёсами не наклоняет.
    // С трамплина нос идёт по траектории: вверх на взлёте, вниз к посадке.
    const pitchTo = air ? (air.kind === 'ramp' ? -0.5 * Math.atan2(air.vy, Math.max(5, vf)) : 0)
      : this.onRamp ? -Math.atan(this.onRamp.slope) : -Math.atan2(hf - hb, 3.2);
    this.pitch += (pitchTo - this.pitch) * k;
    this.roll += ((air ? 0 : Math.atan2(hl - hr, 1.8)) - this.roll) * k; // от рельефа — вся машина
    // Кузов кренится наружу поворота от бокового ускорения (скорость × угловая скорость) и
    // покачивается на подвеске — пружина с демпфером, после поворота чуть перекачивается обратно.
    const sus = { roll: this.bodyRoll, rollV: this.bodyRollV };
    stepRoll(sus, -yawRate, vf, dt);
    this.bodyRoll = sus.roll; this.bodyRollV = sus.rollV;
    // Кочки на грунте: мелкая тряска кузова, сильнее на скорости.
    if (off > 0.05 && !air) {
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

  // Лежачий полицейский под колёсами: удар, на скорости — подбрасывает (hopV, м/с вверх; сам подскок — в update).
  #bump(vf, air) {
    const x = this.pos.x, z = this.pos.y, k = air || this.onTop ? -1 : this.world.bumpCross(this.bumpX ?? x, this.bumpZ ?? z, x, z);
    this.bumpX = x; this.bumpZ = z;
    if (k < 0) return;
    const v = Math.abs(vf), [hop, hard] = BUMP_HIT[k];
    this.impact = Math.max(this.impact, Math.min(1, v / hard));
    this.bodyRollV += (Math.random() - 0.5) * v * 0.05;
    if (v > BUMP_HOP) this.hopV = Math.max(this.hopV ?? 0, Math.min(BUMP_HOP_MAX, (v - BUMP_HOP) * hop));
  }

  // Контакт с машиной трафика или очереди: n — нормаль от неё к нам, depth — перекрытие,
  // vn — относительная скорость по нормали. Лёгкое касание только расталкивает, удар — отскок,
  // потеря скорости и тряска. Возвращает true при ударе.
  touchVehicle(nx, nz, depth, vn) {
    if (this.alt > CLEAR_ALT || this.onTop) return false; // перелетаем; стоим на крыше
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

  // Удар машиной трафика: импульс на единицу массы (jx, jz), приложенный в точке (px, pz). Меняет скорость,
  // закручивает вокруг центра, срывает шины в занос и качает кузов. Сила — от изменения скорости.
  push(jx, jz, px, pz) {
    this.vel.x += jx;
    this.vel.y += jz;
    const rx = px - this.pos.x, rz = pz - this.pos.y;
    this.yawV = Math.max(-YAW_MAX, Math.min(YAW_MAX, this.yawV - (rx * jz - rz * jx) / YAW_K));
    const j = Math.hypot(jx, jz);
    this.skid = Math.max(this.skid, Math.min(1, j / 8));
    const r = this.right;
    this.bodyRollV += Math.max(-1.5, Math.min(1.5, (jx * r.x + jz * r.y) * 0.08));
    this.impact = Math.max(this.impact, Math.min(1, j / 14));
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
      // В прыжке и на крыше стены ниже машины не мешают; на земле — все (дом на склоне ниже дороги — всё равно стена),
      // кроме заборов заметно ниже машины (забор под мостом, по которому едем).
      const n = this.world.collide(c, RADIUS, false, this.y, !(this.air || this.onTop));
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
    m.rotation.set(this.pitch - this.flipP, this.heading, this.roll + this.flip);
    if (this.flipP) {
      // Backflip: та же ось на высоте FLIP_AXIS, поворот вокруг поперечной оси — сдвиг вперёд и вверх.
      const s = Math.sin(this.flipP) * FLIP_AXIS;
      m.position.x += Math.sin(this.heading) * s;
      m.position.z += Math.cos(this.heading) * s;
      m.position.y += (1 - Math.cos(this.flipP)) * FLIP_AXIS;
    }
    if (this.flip) {
      // Ось оборота — на высоте FLIP_AXIS: сдвигаем модель так, чтобы эта точка стояла на месте.
      const s = Math.sin(this.flip) * FLIP_AXIS;
      m.position.x += Math.cos(this.heading) * s;
      m.position.z -= Math.sin(this.heading) * s;
      m.position.y += (1 - Math.cos(this.flip)) * FLIP_AXIS;
    }
    if (m.userData.body) m.userData.body.rotation.z = this.bodyRoll;
    this.wheelSpin += (vf / 0.34) * dt;
    for (const { pivot, w, front } of m.userData.wheels) {
      w.rotation.x = this.wheelSpin;
      pivot.rotation.y = front ? -this.steer * 0.45 : 0;
    }
  }
}

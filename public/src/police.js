// ГИБДД: посты ДПС и погони. На части камер скорости (cameras.js) за камерой у обочины стоит патрульная Веста; проехал
// мимо поста быстрее предела на RADAR км/ч, ударил патрульную или попался камере (с вероятностью DISPATCH — по
// ориентировке, машина выезжает сзади) — погоня: патрульные с мигалкой и сиреной едут к игроку по улицам
// (кратчайший путь по графу дорог, вблизи — прямо к нему). Встал рядом с патрульной — задержание: ARREST с — и штраф.
// Оторвался дальше LOSE м на ESCAPE с — ушёл, награда. В гонке и в гараже погони нет.
import * as THREE from 'three';
import { MODELS, vehicleParts } from './vehicles.js';
import { World } from './world.js';

const RADAR = 20;         // км/ч сверх предела у поста — погоня
const POST_ZONE = 70;     // м: пост видит машину ближе
const POST_AHEAD = 35;    // м: пост — за камерой по ходу движения
const DISPATCH = 0.35;    // доля штрафов камер, после которых выезжает патрульная
const CHASERS = 2;        // патрульных в погоне: вторая подключается через REINFORCE с
const REINFORCE = 25;
const SPAWN_BACK = 170;   // м: подкрепление и выезд по ориентировке — сзади на таком расстоянии
const ARREST = 2.5;       // с рядом с патрульной на малой скорости — задержан
const ARREST_R = 9, ARREST_V = 4; // м, м/с
const LOSE = 320, ESCAPE = 8;     // м, с
const FINE = 5000, BOUNTY = 1500; // ₽: штраф за неповиновение (КоАП 12.25 ч.2 — до 4 000, у нас с погоней) и награда
const ACCEL = 6, BRAKE = 8, LAT = 11; // м/с²: разгон, торможение перед игроком, предел бокового в повороте
const PATH_EVERY = 1;             // с: путь к игроку пересчитывается
const DIRECT = 50;                // м: ближе — прямо на игрока
const POST_HALF = [2.3, 0.95];      // м: полудлина и полуширина кузова патрульной — место поста без столбов
const R = 1.1, AXLE = 1.25, PLAYER_R = 1.15, PLAYER_AXLE = 1.25;

// Белая краска с синей полосой ДПС, нарисованной по координатам кузова (UV у моделей нет): по бортам на уровне ручек
// дверей от задней двери вперёд, на переднем крыле поднимается к капоту; задний край скошен, как на настоящих.
// На капоте — «ДПС» (надпись с холста, проекцией сверху; читается спереди). geo — геометрия кузова, нос — к +z.
function liveryMaterial(geo) {
  const mat = new THREE.MeshLambertMaterial({ color: '#f2f3f0' });
  geo.computeBoundingBox();
  const bb = geo.boundingBox, h = bb.max.y - bb.min.y, len = bb.max.z - bb.min.z;
  // Капот: смотрящие вверх вершины передней трети кузова.
  const pos = geo.attributes.position, nrm = geo.attributes.normal;
  let z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    if (nrm.getY(i) > 0.7 && z > bb.max.z - len * 0.36) { z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  }
  if (z0 > z1) { z0 = bb.max.z - len * 0.3; z1 = bb.max.z - len * 0.05; }
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 160;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.font = '900 150px Arial, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('ДПС', 256, 86, 500);
  const text = new THREE.CanvasTexture(cv);
  const tw = 0.95, td = tw * cv.height / cv.width; // м: ширина надписи и её глубина вдоль капота
  const u = {
    uBelt: { value: bb.min.y + h * 0.5 },    // середина полосы на дверях
    uHalf: { value: 0.075 },                 // полуширина полосы, м
    uRear: { value: bb.min.z + len * 0.3 },  // начало полосы (задняя дверь)
    uRise: { value: bb.min.z + len * 0.68 }, // отсюда к носу полоса поднимается
    uBlue: { value: new THREE.Color('#1f4fa3') },
    uText: { value: text },
    uTextBox: { value: new THREE.Vector4(0, (z0 + z1) / 2, tw, td) }, // центр x, z; ширина, глубина
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj, vObjN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position; vObjN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj, vObjN;\nuniform float uBelt, uHalf, uRear, uRise;\nuniform vec3 uBlue;\nuniform sampler2D uText;\nuniform vec4 uTextBox;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float y = uBelt + max(0.0, vObj.z - uRise) * 0.45;
          float dy = abs(vObj.y - y), e = 0.006;
          float band = 1.0 - smoothstep(uHalf - e, uHalf + e, dy);
          band *= smoothstep(uRear - e, uRear + e, vObj.z + (vObj.y - y) * 0.8);
          band *= smoothstep(0.3, 0.4, abs(normalize(vObjN).x));
          diffuseColor.rgb = mix(diffuseColor.rgb, uBlue, band);
          // «ДПС»: верх букв — к стеклу (−z), право — к +x, как видно, стоя перед машиной.
          vec2 tuv = vec2((vObj.x - uTextBox.x) / uTextBox.z + 0.5, (uTextBox.y - vObj.z) / uTextBox.w + 0.5);
          if (normalize(vObjN).y > 0.5 && all(greaterThan(tuv, vec2(0.0))) && all(lessThan(tuv, vec2(1.0))))
            diffuseColor.rgb = mix(diffuseColor.rgb, uBlue, texture2D(uText, tuv).a);
        }`);
  };
  mat.customProgramCacheKey = () => 'police-livery';
  return mat;
}

export class Police {
  constructor(world, cameras, scene) {
    this.world = world;
    this.scene = scene;
    this.posts = [];
    (cameras.list || []).forEach((c, i) => {
      if (c.speed === false || !c.lim || c.face === undefined || i % 2) return;
      // Машины у камеры едут навстречу объективу: по -(sin face, cos face). Пост — дальше по ходу, у той же обочины.
      const dx = -Math.sin(c.face), dz = -Math.cos(c.face);
      const x = c.pole[0] + dx * POST_AHEAD, z = c.pole[1] + dz * POST_AHEAD;
      const r = world.nearestRoad(x, z, 30);
      if (!r) return;
      // На обочину: от оси улицы в сторону столба, на полкорпуса за край полотна.
      const sx = c.pole[0] - r.px, sz = c.pole[1] - r.pz, sl = Math.hypot(sx, sz) || 1;
      const ex = r.seg.bx - r.seg.ax, ez = r.seg.bz - r.seg.az, el = Math.hypot(ex, ez) || 1;
      const lat = (sx / sl) * (-ez / el) + (sz / sl) * (ex / el) > 0 ? 1 : -1; // столб слева/справа от ребра
      const off = r.seg.w / 2 + 1.2, nx = (-ez / el) * lat, nz = (ex / el) * lat;
      const px = r.px + nx * off, pz = r.pz + nz * off;
      if (world.roofAt(px, pz) !== null || world.isWater(px, pz)) return;
      const along = (ex * dx + ez * dz) >= 0 ? 1 : -1;
      this.posts.push({ x: px, z: pz, heading: Math.atan2((ex / el) * along, (ez / el) * along), lim: c.lim, cam: c });
    });

    // Патрульная: Веста белая с синей полосой по бортам (liveryMaterial), мигалка на крыше.
    const p = vehicleParts(MODELS.vesta, { wheelsInDetail: true });
    p.paint.computeBoundingBox();
    const bb = p.paint.boundingBox, roof = bb.max.y;
    this.geo = { paint: p.paint, detail: p.detail };
    this.white = liveryMaterial(p.paint);
    this.lit = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.barGeo = new THREE.BoxGeometry(0.5, 0.12, 0.22).translate(0, roof + 0.07, 0);
    this.baseGeo = new THREE.BoxGeometry(1.15, 0.05, 0.28).translate(0, roof + 0.01, 0);
    // Мигалка: левая половина красная, правая синяя; выключенная — тёмное цветное стекло, горит — яркий цвет.
    this.red = new THREE.MeshBasicMaterial({ color: '#ff2a2a' });
    this.blue = new THREE.MeshBasicMaterial({ color: '#2a6bff' });
    this.redOff = new THREE.MeshLambertMaterial({ color: '#7a1c22' });
    this.blueOff = new THREE.MeshLambertMaterial({ color: '#1c3478' });
    this.grey = new THREE.MeshLambertMaterial({ color: '#2b2d31' });

    this.cars = [];      // патрульные: на посту и в погоне
    this.chase = null;   // { t, escape, arrest, why }
    this.time = 0;
    this.flash = 0;
    this.siren = 0;      // громкость сирены для звука, 0..1
    this.events = [];    // [{ kind: 'start' | 'caught' | 'escaped', why }] — забирает main.js
    this.hud = document.getElementById('chase');
    this.obstacles = null; // выставляет main.js: { ready(x, z), around(x, z, fn) } — столбы и деревья квадратов
  }

  #makeCar(x, z, heading, post = null) {
    const g = new THREE.Group();
    const paint = new THREE.Mesh(this.geo.paint, this.white), detail = new THREE.Mesh(this.geo.detail, this.lit);
    const base = new THREE.Mesh(this.baseGeo, this.grey);
    const left = new THREE.Mesh(this.barGeo, this.redOff), right = new THREE.Mesh(this.barGeo, this.blueOff);
    left.position.x = -0.28; right.position.x = 0.28;
    for (const m of [paint, detail]) m.castShadow = m.receiveShadow = true;
    g.add(paint, detail, base, left, right);
    g.userData.perf = 'ДПС';
    this.scene.add(g);
    const c = { g, left, right, x, z, heading, v: 0, y: this.world.ground(x, z), post, path: null, pathT: 0, stuck: 0, back: 0, pitch: 0 };
    this.#pose(c);
    this.cars.push(c);
    return c;
  }

  #drop(c) {
    this.scene.remove(c.g);
    this.cars.splice(this.cars.indexOf(c), 1);
  }

  get active() { return !!this.chase; }

  // Нарушение под камерой (main.js, fines): иногда выезжает патрульная.
  report(why) {
    if (this.chase || Math.random() > DISPATCH) return;
    this.pending = why;
  }

  // Отменить погоню без итога (началась гонка, гараж, перенос по карте).
  cancel() {
    if (!this.chase) return;
    this.chase = null;
    // Своя постовая — сразу на пост (за кадром не видно, как едет), выехавшая по вызову — стоит, пока не отъедешь.
    for (const c of this.cars) { c.chasing = false; c.v = 0; if (c.post) this.#home(c); }
    this.#hud();
  }

  update(dt, car, { allowed }) {
    this.time += dt;
    this.player = car;
    this.allowed = allowed;
    // Перенос машины (карта, респаун) — погоня кончилась ничем.
    if (this.last && Math.hypot(car.pos.x - this.last[0], car.pos.y - this.last[1]) > 60) this.cancel();
    this.last = [car.pos.x, car.pos.y];
    if (!allowed) { this.cancel(); this.pending = null; }
    const px = car.pos.x, py = car.pos.y;
    // Посты рядом — машины на месте; дальние убираем.
    for (const post of this.posts) {
      const d = Math.hypot(post.x - px, post.z - py);
      if (d < 400 && !post.car) post.car = this.#makeCar(post.x, post.z, post.heading, post);
      if (post.car && !post.clear && !post.car.chasing && this.obstacles?.ready(post.x, post.z)) this.#clearPost(post);
      else if (d > 500 && post.car && !post.car.chasing) { this.#drop(post.car); post.car = null; }
    }
    if (allowed && !this.chase) {
      const kmh = car.vel.length() * 3.6;
      for (const post of this.posts) {
        if (!post.car || Math.hypot(post.x - px, post.z - py) > POST_ZONE) continue;
        if (kmh > post.lim + RADAR) { this.#start(`превышение у поста ДПС: ${Math.round(kmh)} км/ч при ${post.lim}`, post.car); break; }
      }
      if (!this.chase && this.pending) this.#start(this.pending, null);
      this.pending = null;
    }
    for (const c of [...this.cars]) if (!c.post && !c.chasing && Math.hypot(c.x - px, c.z - py) > 300) this.#drop(c);
    for (const c of this.cars) this.#collidePlayer(c, car);
    if (this.chase) this.#chaseUpdate(dt, car);
    // Мигалка у машин в погоне: красный и синий по очереди, каждый — двойной вспышкой.
    const ph = (this.time * 2) % 1, blink = (a) => (ph >= a && ph < a + 0.1) || (ph >= a + 0.18 && ph < a + 0.28);
    this.flash = blink(0);
    for (const c of this.cars) {
      const on = c.chasing;
      c.left.material = on && blink(0) ? this.red : this.redOff;
      c.right.material = on && blink(0.5) ? this.blue : this.blueOff;
    }
    // Сирена: громче ближе ближайшая патрульная в погоне.
    let near = Infinity;
    for (const c of this.cars) if (c.chasing) near = Math.min(near, Math.hypot(c.x - px, c.z - py));
    this.siren = this.chase ? Math.max(0, Math.min(1, 1 - (near - 15) / 300)) : 0;
  }

  #start(why, carAtPost) {
    this.chase = { t: 0, escape: 0, arrest: 0, why, next: REINFORCE };
    this.events.push({ kind: 'start', why });
    if (carAtPost) carAtPost.chasing = true;
    else this.#reinforce();
    this.#hud();
  }

  // Патрульная выезжает сзади игрока, на улице, по возможности за кадром.
  #reinforce() {
    const car = this.player;
    if (!car) { this.needSpawn = true; return; }
    const f = car.forward;
    for (const k of [1, 0.7, 1.4, 0.5]) {
      const x = car.pos.x - f.x * SPAWN_BACK * k, z = car.pos.y - f.y * SPAWN_BACK * k;
      const r = this.#graphRoad(x, z, 80);
      if (!r) continue;
      const c = this.#makeCar(r.px, r.pz, Math.atan2(car.pos.x - r.px, car.pos.y - r.pz));
      c.chasing = true;
      c.v = 12;
      return;
    }
  }

  #chaseUpdate(dt, car) {
    const ch = this.chase, px = car.pos.x, py = car.pos.y;
    ch.t += dt;
    if (this.needSpawn) { this.needSpawn = false; this.#reinforce(); }
    if (ch.t > ch.next && this.cars.filter((c) => c.chasing).length < CHASERS) { ch.next = Infinity; this.#reinforce(); }
    let nearest = Infinity;
    for (const c of this.cars) {
      if (!c.chasing) continue;
      this.#drive(c, dt, car);
      nearest = Math.min(nearest, Math.hypot(c.x - px, c.z - py));
    }
    // Задержание: стоишь (или еле едешь) рядом с патрульной.
    const speed = car.vel.length();
    ch.arrest = nearest < ARREST_R && speed < ARREST_V ? ch.arrest + dt : Math.max(0, ch.arrest - dt * 2);
    ch.escape = nearest > LOSE ? ch.escape + dt : Math.max(0, ch.escape - dt * 3);
    if (ch.arrest >= ARREST) return this.#finish('caught');
    if (ch.escape >= ESCAPE) return this.#finish('escaped');
    this.#hud();
  }

  #finish(kind) {
    this.events.push({ kind, sum: kind === 'caught' ? FINE : BOUNTY });
    this.cancel();
  }

  // Пост: вернуть машину на место.
  // Пост ставится от камеры, не глядя на столбы и деревья (они строятся с квадратом), — патрульная вставала в столб.
  // Квадрат построен — сдвигаем пост вдоль дороги на ближайшее место, где кузов ни во что не упирается.
  #clearPost(post) {
    post.clear = true;
    const fx = Math.sin(post.heading), fz = Math.cos(post.heading);
    const blocked = (x, z) => {
      let hit = false;
      this.obstacles.around(x, z, (it) => {
        const dx = it.x - x, dz = it.z - z, r = (it.r ?? it.kind.r) + 0.3;
        const along = dx * fx + dz * fz, side = dx * fz - dz * fx;
        if (Math.abs(along) < POST_HALF[0] + r && Math.abs(side) < POST_HALF[1] + r) hit = true;
      });
      return hit || this.world.roofAt(x, z) !== null || this.world.isWater(x, z);
    };
    for (let k = 0; k <= 20; k++) {
      const t = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 1.5; // 0, 1.5, −1.5, 3, −3 … до ±15 м
      const x = post.x + fx * t, z = post.z + fz * t;
      if (blocked(x, z)) continue;
      if (t) { post.x = x; post.z = z; this.#home(post.car); }
      return;
    }
  }

  #home(c) {
    Object.assign(c, { x: c.post.x, z: c.post.z, heading: c.post.heading, path: null });
    c.y = this.world.ground(c.x, c.z);
    this.#pose(c);
  }

  #target(c, car) {
    const px = car.pos.x, py = car.pos.y, d = Math.hypot(px - c.x, py - c.z);
    if (d < DIRECT) return [px + car.vel.x * 0.4, py + car.vel.y * 0.4];
    if ((c.pathT -= this.dt) <= 0 || !c.path) {
      c.pathT = PATH_EVERY;
      c.path = this.#route(c.x, c.z, px, py);
    }
    // Ближайшая точка пути впереди дальше 14 м — цель.
    const path = c.path;
    if (!path) return [px, py];
    while (path.length > 1 && Math.hypot(path[0][0] - c.x, path[0][1] - c.z) < 14) path.shift();
    return path[0];
  }

  // Путь по улицам (в обе стороны, патрульной односторонние не указ): точки узлов от ближайшего к патрульной до
  // ближайшего к игроку, в конце — сам игрок.
  #route(x0, z0, x1, z1) {
    // Ближайший к точке конец ближайшего отрезка улицы из графа (дворовые проезды в него не входят).
    const w = this.world, node = (x, z) => {
      const r = this.#graphRoad(x, z, 150);
      if (!r) return null;
      const a = r.seg.road.n[r.seg.i - 1], b = r.seg.road.n[r.seg.i];
      return r.t < 0.5 ? a : b;
    };
    const a = node(x0, z0), b = node(x1, z1);
    if (a == null || b == null) return null;
    const ids = w.shortestPath(a, b);
    if (!ids) return null;
    const pts = ids.map((i) => w.nodes[i]);
    // Первый узел позади патрульной — пропускаем (иначе разворот к нему).
    if (pts.length > 1) {
      const [ax, az] = pts[0], [bx, bz] = pts[1];
      if ((ax - x0) * (bx - ax) + (az - z0) * (bz - az) < 0) pts.shift();
    }
    pts.push([x1, z1]);
    return pts.map((p) => [p[0], p[1]]);
  }

  // Ближайшее место на улице из графа маршрутов: { px, pz, t, seg } или null.
  #graphRoad(x, z, maxD) {
    const g = this.world.graph;
    let best = null;
    for (const s of this.world.segmentsNear(x, z, maxD)) {
      if (!g.has(s.road.n[s.i - 1]) || !g.has(s.road.n[s.i])) continue;
      const c = World.closest(s, x, z);
      if (c.d < maxD && (!best || c.d < best.d)) best = { ...c, seg: s };
    }
    return best;
  }

  #drive(c, dt, car) {
    this.dt = dt;
    const [tx, tz] = this.#target(c, car);
    let want = Math.atan2(tx - c.x, tz - c.z), diff = want - c.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const d = Math.hypot(car.pos.x - c.x, car.pos.y - c.z);
    const top = Math.max(28, (car.maxSpeed || 40) * 0.97);
    // На повороте сбрасывает, рядом с игроком держится его скорости (прижимает).
    // Подъезжая, тормозит так, чтобы встать в ~6 м от игрока (с запасом на его скорость).
    let vt = top * (1 - Math.min(0.75, Math.abs(diff) / 1.4));
    vt = Math.min(vt, car.vel.length() + 2 + Math.sqrt(2 * BRAKE * Math.max(0, d - 6)));
    if (d < 8) vt = Math.min(vt, Math.max(0, car.vel.length() - 1)); // догнала — встаёт рядом, не толкает
    if (c.back > 0) { // застрял — сдаёт назад, выворачивая
      c.back -= dt;
      c.v = Math.max(-6, c.v - ACCEL * dt);
      diff = -diff;
    } else {
      c.v += Math.max(-ACCEL * 2 * dt, Math.min(ACCEL * dt, vt - c.v));
    }
    const yaw = Math.min(2.4, LAT / Math.max(Math.abs(c.v), 3)) * dt;
    c.heading += Math.max(-yaw, Math.min(yaw, diff)) * Math.sign(c.v || 1);
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
    const ox = c.x, oz = c.z;
    c.x += fx * c.v * dt;
    c.z += fz * c.v * dt;
    // Стены и дома: как у машины игрока — два круга по осям.
    for (const s of [AXLE, -AXLE]) {
      const p = new THREE.Vector2(c.x + fx * s, c.z + fz * s), before = p.clone();
      const n = this.world.collide(p, R, false, c.y, true);
      if (!n) continue;
      c.x += p.x - before.x; c.z += p.y - before.y;
      c.v *= 0.9;
    }
    // Не едет, хоть и должна — сдаёт назад; не помогло несколько раз — на ближайшую улицу (отставшая так и
    // отстаёт: иначе от погони не уйти).
    const moved = Math.hypot(c.x - ox, c.z - oz) / dt;
    c.stuck = moved < 1.5 && c.back <= 0 ? c.stuck + dt : 0;
    if (c.stuck > 1.5) { c.back = 1.2; c.stuck = 0; c.stuckN = (c.stuckN || 0) + 1; }
    if (c.stuckN > 3) {
      const r = this.#graphRoad(c.x, c.z, 150);
      if (r) Object.assign(c, { x: r.px, z: r.pz, v: 0, path: null, stuckN: 0 });
    }
    if (moved > 5) c.stuckN = 0;
    this.#pose(c);
  }

  #pose(c) {
    const w = this.world, fx = Math.sin(c.heading), fz = Math.cos(c.heading);
    const ref = c.y + 1.5;
    const y = w.ground(c.x, c.z, ref), hf = w.ground(c.x + fx * 1.3, c.z + fz * 1.3, ref), hb = w.ground(c.x - fx * 1.3, c.z - fz * 1.3, ref);
    c.y = Math.max(y, (hf + hb) / 2);
    c.g.position.set(c.x, c.y, c.z);
    c.g.rotation.set(-Math.atan2(hf - hb, 2.6), c.heading, 0, 'YXZ');
  }

  #collidePlayer(c, car) {
    if (car.ghostVehicles > 0 || car.air) return;
    if (Math.hypot(c.x - car.pos.x, c.z - car.pos.y) > 8) return;
    const f = car.forward, cf = [Math.sin(c.heading), Math.cos(c.heading)];
    for (const so of [PLAYER_AXLE, -PLAYER_AXLE]) {
      for (const vo of [-AXLE, AXLE]) {
        const cx = car.pos.x + f.x * so, cz = car.pos.y + f.y * so;
        const ox = c.x + cf[0] * vo, oz = c.z + cf[1] * vo;
        const d = Math.hypot(cx - ox, cz - oz), min = PLAYER_R + R;
        if (d >= min || d < 1e-6) continue;
        const nx = (cx - ox) / d, nz = (cz - oz) / d;
        const vn = car.vel.x * nx + car.vel.y * nz - c.v * (cf[0] * nx + cf[1] * nz);
        car.touchVehicle(nx, nz, (min - d) / 2, vn);
        c.x -= nx * (min - d) / 2; c.z -= nz * (min - d) / 2;
        // Врезался в патрульную — погоня.
        if (!this.chase && vn < -5 && this.allowed) this.#start('наезд на машину ДПС', c);
      }
    }
  }

  #hud() {
    const el = this.hud;
    if (!el) return;
    const ch = this.chase;
    el.classList.toggle('show', !!ch);
    if (!ch) return;
    const bar = (k, cls) => `<i class="${cls}"><b style="width:${Math.round(Math.min(1, k) * 100)}%"></b></i>`;
    const html = ch.arrest > 0.05 ? `🚨 Задержание${bar(ch.arrest / ARREST, 'arrest')}`
      : ch.escape > 0.05 ? `🚨 Отрываетесь…${bar(ch.escape / ESCAPE, 'escape')}`
      : `🚨 Погоня ДПС<small>${ch.why}</small>`;
    if (html !== this.html) el.innerHTML = this.html = html;
  }
}

export const POLICE = { FINE, BOUNTY };

// Работа таксистом: заказ — забрать пассажира на остановке рядом (city.stops, PICK_MIN…PICK_MAX м) и отвезти к дому с
// адресом из OSM (DROP_MIN…DROP_MAX м от остановки). Дорогу показывает навигатор (citymap.go), у конца маршрута (место
// на улице у остановки или дома) — столб-маяк. Сел / вышел — остановиться у маяка (ближе PICK_R м, медленнее STOP_V). Плата — за длину маршрута; довёз быстро —
// надбавка, удары (car.impact) — пассажир недоволен, меньше. Гонка отменяет заказ (main.js).
import * as THREE from 'three';
import { address, short, routeLen } from './citymap.js';

const PICK_MIN = 200, PICK_MAX = 900, DROP_MIN = 1000, DROP_MAX = 3000; // м по прямой
const PICK_R = 14, STOP_V = 2;
const FARE_BASE = 1000, FARE_KM = 1800;   // ₽: посадка и за км маршрута
const FAST_KMH = 45, FAST_BONUS = 0.3;  // средняя быстрее — надбавка
const HIT = 0.4, HIT_CUT = 0.15, MIN_SHARE = 0.3; // удар сильнее — минус доля платы, но не меньше MIN_SHARE

const fmtDist = (d) => (d < 1000 ? `${Math.round(d / 10) * 10} м` : `${(d / 1000).toFixed(1)} км`);
const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export class Taxi {
  constructor(world, scene, citymap, el) {
    this.world = world;
    this.citymap = citymap;
    this.el = el;
    this.order = null; // { stage: 'pick' | 'ride', x, z, name, target, km, t, hits }
    this.homes = null;
    // Маяк — полупрозрачный жёлтый столб света до неба, виден из-за домов.
    const geo = new THREE.CylinderGeometry(1.6, 1.6, 60, 20, 1, true).translate(0, 30, 0);
    this.beacon = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: '#ffd23f', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    }));
    this.beacon.visible = false;
    this.beacon.userData.perf = 'такси';
    scene.add(this.beacon);
  }

  get active() { return !!this.order; }
  // Маршрут навигатора — заказа (его «Приехали» — здесь, а не в main.js).
  get target() { return this.order?.target ?? null; }

  // Новый заказ от места машины; идёт заказ — отменить. Возвращает текст плашки.
  toggle(car) {
    if (this.order) return this.cancel(), 'Заказ отменён';
    const px = car.pos.x, pz = car.pos.y;
    const near = this.world.city.stops.filter(([x, z]) => { const d = Math.hypot(x - px, z - pz); return d > PICK_MIN && d < PICK_MAX; });
    for (let i = near.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [near[i], near[j]] = [near[j], near[i]]; }
    for (const [x, z] of near.slice(0, 8)) {
      const road = this.world.nearestRoad(x, z, 50)?.seg.road.name;
      const name = road ? `остановка, ${short(road)}` : 'остановка';
      if (!this.citymap.go(x, z, name)) continue;
      const t = this.citymap.target;
      this.order = { stage: 'pick', x: t.x, z: t.z, name, target: t, t: 0, hits: 0, hit: false };
      this.#beacon(t.x, t.z);
      return `Такси: пассажир ждёт — ${name}`;
    }
    return 'Рядом нет остановок, куда можно доехать';
  }

  cancel() {
    if (!this.order) return;
    if (this.citymap.target && this.citymap.target === this.order.target) this.citymap.clear();
    this.order = null;
    this.beacon.visible = false;
    this.el.hidden = true;
  }

  #beacon(x, z) {
    this.beacon.position.set(x, this.world.terrain(x, z), z);
    this.beacon.visible = true;
  }

  // Дом с адресом в DROP_MIN…DROP_MAX м от (x, z), до которого есть маршрут; маршрут ставится.
  #destination(x, z) {
    if (!this.homes) {
      this.homes = [];
      for (const b of this.world.city.buildings) {
        if (!b.a || b.st == null || b.mh) continue;
        const cx = b.p.reduce((s, q) => s + q[0], 0) / b.p.length, cz = b.p.reduce((s, q) => s + q[1], 0) / b.p.length;
        this.homes.push([cx, cz, b]);
      }
    }
    const streets = this.world.city.streets || [];
    for (let k = 0, tries = 0; k < 400 && tries < 6; k++) {
      const [hx, hz, b] = this.homes[Math.floor(Math.random() * this.homes.length)];
      const d = Math.hypot(hx - x, hz - z);
      if (d < DROP_MIN || d > DROP_MAX) continue;
      tries++;
      const street = streets[b.st], name = address(street, b.a);
      if (this.citymap.go(hx, hz, name, street)) return { x: this.citymap.target.x, z: this.citymap.target.z, name };
    }
    return null;
  }

  // Раз в кадр. Возвращает событие { kind: 'pick' | 'drop' | 'fail', text, pay } или null.
  update(dt, car) {
    const o = this.order;
    if (!o) return null;
    if (this.citymap.target === o.target) [o.x, o.z] = [o.target.x, o.target.z]; // маршрут перестроен — конец мог сдвинуться
    const d = Math.hypot(o.x - car.pos.x, o.z - car.pos.y), slow = Math.abs(car.speed) < STOP_V && !car.air;
    let ev = null;
    if (o.stage === 'pick') {
      if (d < PICK_R && slow) {
        const to = this.#destination(o.x, o.z);
        if (!to) { this.cancel(); return { kind: 'fail', text: 'Пассажир передумал — некуда ехать' }; }
        Object.assign(o, { stage: 'ride', ...to, target: this.citymap.target, km: routeLen(this.citymap.target.route) / 1000, t: 0 });
        this.#beacon(o.x, o.z);
        ev = { kind: 'pick', text: `Пассажир сел: ${to.name}` };
      }
    } else {
      o.t += dt;
      // Удар — передний фронт car.impact выше HIT.
      if (car.impact > HIT && !o.hit) o.hits++;
      o.hit = car.impact > HIT;
      if (d < PICK_R && slow) {
        const fast = o.km / (o.t / 3600) >= FAST_KMH;
        const share = Math.max(MIN_SHARE, 1 - HIT_CUT * o.hits) * (fast ? 1 + FAST_BONUS : 1);
        const pay = Math.round(((FARE_BASE + FARE_KM * o.km) * share) / 50) * 50;
        const why = [fast ? 'быстро' : '', o.hits ? `ударов: ${o.hits}` : ''].filter(Boolean).join(', ');
        this.cancel();
        return { kind: 'drop', pay, text: `такси${why ? ` (${why})` : ''}` };
      }
    }
    this.el.hidden = false;
    this.el.innerHTML = o.stage === 'pick'
      ? `<span class="lbl">🚕 Пассажир ждёт</span><b>${fmtDist(d)}</b><br><small>${o.name}</small>`
      : `<span class="lbl">🚕 Везу</span><b>${fmtDist(d)}</b> <small>${fmtTime(o.t)}</small><br><small>${o.name}${o.hits ? ` · ударов: ${o.hits}` : ''}</small>`;
    return ev;
  }
}

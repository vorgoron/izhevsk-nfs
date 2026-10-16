// Мультиплеер через Firebase Realtime Database: каждый считает свою машину сам и 10 раз в секунду
// пишет её положение в rooms/<комната>/players/<uid>; чужие машины плавно едут между полученными
// точками. Столкновения каждый считает сам: свою машину отталкивает от того, где видит чужую, — и
// у того, в кого врезались, его игра так же оттолкнёт его машину от нашей.
// В общем городе пока никого не видно и ничего не шлём (лимиты Firebase): связь — только в своей комнате. Нет связи с Firebase — игра идёт как раньше, одна.
import * as THREE from 'three';
import { firebaseConfig, FIREBASE_SDK } from './firebase-config.js';
import { MODELS, DEFAULT_MODEL, buildPlayerModel, setPlate, disposePlates } from './vehicles.js';

export const CITY = 'city'; // общий город — комната по умолчанию
const SEND_EVERY = 0.1;      // с
const DELAY = 150;           // мс: показываем чужие машины с запасом на неровную доставку
const EXTRAPOLATE = 250;     // мс: дольше нет данных — машина стоит в последней точке
const LABEL_DIST = 600;      // м: дальше ник не показываем
// мс: столько нет обновлений — машину прячем. Свернул вкладку (цикл игры стоит) или запись осталась
// после вылета, а onDisconnect не сработал. Обновления пойдут снова — машина появится.
const STALE = 5000;
const ROOM_RE = /^[a-z0-9-]{1,24}$/;
const NAME_MAX = 10; // столько помещается на номер машины
const CAR_R = 1.15, CAR_AXLE = 1.25; // два круга вдоль машины, как в car.js
// Машины одинаковой массы: удар делится пополам — каждому достаётся половина относительной скорости.
const SHARE = 0.5;
const SAME_LEVEL = 3; // м: по высоте дальше — разные уровни (эстакада и дорога под ней), не сталкиваемся

const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, NAME_MAX);
const lerpAngle = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

// Значение из localStorage, а нет — созданное make() и сразу сохранённое: имя по умолчанию и своя
// комната не меняются от перезагрузки.
function stored(key, valid, make) {
  try { const v = localStorage.getItem(key); if (v && valid(v)) return v; } catch {}
  const v = make();
  try { localStorage.setItem(key, v); } catch {}
  return v;
}
// Имя, сохранённое до ограничения длины, обрезаем.
const loadName = () => cleanName(stored('name', (v) => !!cleanName(v), () => `Гонщик ${100 + Math.floor(Math.random() * 900)}`));
const ownRoom = () => stored('room', (v) => ROOM_RE.test(v) && v !== CITY, () => Math.random().toString(36).slice(2, 8).padEnd(6, '0'));

// Ник над машиной: спрайт постоянного размера на экране, виден сквозь дома.
function makeLabel(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 30px system-ui, sans-serif';
  const w = Math.min(248, g.measureText(text).width + 28);
  g.fillStyle = 'rgba(10,12,14,0.6)';
  g.beginPath(); g.roundRect((256 - w) / 2, 10, w, 44, 22); g.fill();
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 33, 232);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, fog: false, sizeAttenuation: false }));
  s.scale.set(0.2, 0.05, 1);
  s.renderOrder = 10;
  return s;
}

export class Net {
  // onChange — изменилось то, что показывает меню (связь, число игроков, имя).
  constructor(scene, { model, color }, onChange = () => {}) {
    this.scene = scene;
    this.onChange = onChange;
    this.name = loadName();
    this.model = model;
    this.color = color;
    this.status = 'solo'; // 'solo' (общий город, без сети) | 'connecting' | 'online' | 'offline'
    this.ghosts = new Map();    // uid → { name, model, color, mesh, label, buf, offset, spin }
    const r = new URLSearchParams(location.search).get('room')?.toLowerCase();
    this.room = r && ROOM_RE.test(r) ? r : CITY;
    this.sendT = 0;
    queueMicrotask(() => this.join(this.room)); // onChange — когда конструктор уже вернул объект
  }

  get count() { let n = 1; for (const g of this.ghosts.values()) n += !g.stale; return n; }

  async start() {
    const [{ initializeApp }, auth, db] = await Promise.all(
      ['app', 'auth', 'database'].map((m) => import(`${FIREBASE_SDK}/firebase-${m}.js`)));
    this.fb = db;
    const app = initializeApp(firebaseConfig);
    // Вход в sessionStorage, а не в общий для всех вкладок IndexedDB: каждая вкладка — отдельный игрок.
    const { user } = await auth.signInAnonymously(auth.initializeAuth(app, { persistence: auth.browserSessionPersistence }));
    this.uid = user.uid;
    this.db = db.getDatabase(app);
    db.onValue(db.ref(this.db, '.info/connected'), (s) => {
      if (this.room === CITY) return;
      this.status = s.val() ? 'online' : 'connecting';
      this.onChange();
    });
    this.join(this.room);
  }

  // Перейти в комнату: уйти из прежней (запись и подписки), войти в новую, адрес — в строку браузера.
  // В общий город — отключиться от базы совсем (запись уберёт onDisconnect).
  join(room) {
    this.room = room;
    const url = new URL(location.href);
    if (room === CITY) url.searchParams.delete('room'); else url.searchParams.set('room', room);
    history.replaceState(null, '', url);
    for (const uid of [...this.ghosts.keys()]) this.#drop(uid);
    const { ref, remove, onDisconnect, onChildAdded, onChildChanged, onChildRemoved, goOnline, goOffline } = this.fb ?? {};
    const was = this.me;
    this.me = null;
    this.unsub?.forEach((f) => f());
    this.unsub = null;
    if (room === CITY) {
      if (was) remove(was);
      if (this.db) goOffline(this.db);
      this.status = 'solo';
      this.onChange();
      return;
    }
    if (!this.db) { // Firebase ещё не загружен — start() войдёт сам
      this.status = 'connecting';
      this.onChange();
      this.starting ??= this.start().catch((e) => {
        console.warn('[net] нет связи:', e);
        this.starting = null;
        this.status = 'offline';
        this.onChange();
      });
      return;
    }
    if (was) { remove(was); onDisconnect(was).cancel(); }
    goOnline(this.db);
    this.onChange();
    this.me = ref(this.db, `rooms/${room}/players/${this.uid}`);
    onDisconnect(this.me).remove();
    const players = ref(this.db, `rooms/${room}/players`);
    const got = (s) => { if (s.key !== this.uid) this.#receive(s.key, s.val()); };
    this.unsub = [
      onChildAdded(players, got),
      onChildChanged(players, got),
      onChildRemoved(players, (s) => { this.#drop(s.key); this.onChange(); }),
    ];
    this.sendT = 0;
  }

  // Ссылка для друзей: из общего города — в свою комнату (код у игрока постоянный), из чужой — на неё же.
  inviteLink() {
    if (this.room === CITY) this.join(ownRoom());
    return location.href;
  }

  setName(name) {
    this.name = cleanName(name) || this.name;
    try { localStorage.setItem('name', this.name); } catch {}
    this.sendT = 0;
    this.onChange();
  }

  setVehicle(model, color) {
    this.model = model;
    this.color = color;
    this.sendT = 0;
  }

  // Раз в кадр: своё положение — в базу (10 раз в секунду), чужие машины — на места.
  update(dt, car) {
    if (this.me && (this.sendT -= dt) <= 0) {
      this.sendT = SEND_EVERY;
      const f = (v, n = 2) => +v.toFixed(n);
      const s = [f(car.pos.x), f(car.y), f(car.pos.y), f(car.heading, 3), f(car.pitch, 3), f(car.roll, 3),
        f(car.bodyRoll, 3), f(car.speed, 1), f(car.steer), Math.round(performance.now())].join(',');
      const data = { n: this.name, s, m: this.model };
      if (this.color) data.c = this.color;
      this.fb.set(this.me, data).catch((e) => {
        if (!this.writeErr) console.warn('[net] запись не прошла:', e);
        this.writeErr = true;
      });
    }
    const now = performance.now();
    for (const g of this.ghosts.values()) this.#place(g, now, dt, car);
    this.#collide(car);
  }

  #collide(car) {
    if (car.ghostVehicles > 0) return; // выезжаем из зажатия
    const f = car.forward;
    for (const g of this.ghosts.values()) {
      const m = g.mesh;
      if (!m?.visible || Math.abs(m.position.y - car.y) > SAME_LEVEL) continue;
      if (Math.hypot(m.position.x - car.pos.x, m.position.z - car.pos.y) > 8) continue;
      const gx = Math.sin(m.rotation.y), gz = Math.cos(m.rotation.y);
      for (const so of [CAR_AXLE, -CAR_AXLE]) {
        for (const go of [CAR_AXLE, -CAR_AXLE]) {
          const cx = car.pos.x + f.x * so, cz = car.pos.y + f.y * so;
          const ox = m.position.x + gx * go, oz = m.position.z + gz * go;
          const d = Math.hypot(cx - ox, cz - oz), min = 2 * CAR_R;
          if (d >= min || d < 1e-6) continue;
          const nx = (cx - ox) / d, nz = (cz - oz) / d;
          const vn = (car.vel.x - g.vx) * nx + (car.vel.y - g.vz) * nz;
          car.touchVehicle(nx, nz, min - d, vn * SHARE);
        }
      }
    }
  }

  #receive(uid, v) {
    if (!v || typeof v.s !== 'string') return;
    const n = v.s.split(',').map(Number);
    if (n.length < 10 || n.some((x) => !Number.isFinite(x))) return;
    const [x, y, z, h, p, r, br, sp, st, t] = n;
    const model = Object.hasOwn(MODELS, v.m ?? '') ? v.m : DEFAULT_MODEL;
    const color = /^#[0-9a-f]{6}$/i.test(v.c ?? '') ? v.c : undefined;
    const name = cleanName(v.n) || 'Гонщик';
    let g = this.ghosts.get(uid);
    if (!g) {
      g = { buf: [], offset: Infinity, spin: 0, stale: false };
      this.ghosts.set(uid, g);
      this.onChange();
    }
    if (g.model !== model || g.color !== color) {
      this.#dispose(g.mesh);
      g.mesh = buildPlayerModel(model, color);
      g.mesh.userData.perf = 'другие игроки';
      this.scene.add(g.mesh);
      g.model = model; g.color = color;
      g.mesh.visible = false; // до первой расстановки
    }
    if (g.name !== name) {
      if (g.label) { this.scene.remove(g.label); g.label.material.map.dispose(); g.label.material.dispose(); }
      g.label = makeLabel(name);
      g.label.userData.perf = 'другие игроки';
      this.scene.add(g.label);
      g.name = name;
    }
    setPlate(g.mesh, name); // на номере — имя игрока (тот же текст — ничего не делает)
    const last = g.buf.at(-1);
    if (last && t < last.t - 1000) { g.buf = []; g.offset = Infinity; } // у игрока перезагрузилась вкладка
    if (last && t <= last.t) return;
    // Часы у игроков свои: смещение — наименьшее «пришло − отправлено» (сдвиг часов + самая быстрая доставка).
    g.offset = Math.min(g.offset, performance.now() - t);
    g.at = performance.now();
    g.buf.push({ t, x, y, z, h, p, r, br, sp, st });
    if (g.buf.length > 30) g.buf.shift();
  }

  #place(g, now, dt, car) {
    const m = g.mesh, b = g.buf;
    if (!m || !b.length) return;
    const stale = now - g.at > STALE;
    if (stale !== g.stale) { g.stale = stale; this.onChange(); }
    if (stale) {
      m.visible = false;
      if (g.label) g.label.visible = false;
      return;
    }
    const rt = now - g.offset - DELAY; // время отправителя, которое показываем
    let i = b.findIndex((s) => s.t > rt);
    let a, c, k;
    if (i === -1) { // новее нет — продолжаем движение по двум последним точкам, недолго
      c = b.at(-1); a = b.at(-2) ?? c;
      k = a === c ? 0 : 1 + Math.min(rt - c.t, EXTRAPOLATE) / (c.t - a.t);
    } else if (i === 0) { a = c = b[0]; k = 0; }
    else { a = b[i - 1]; c = b[i]; k = (rt - a.t) / (c.t - a.t); }
    const L = (u, v) => u + (v - u) * k;
    // Скорость — по отрезку между точками: для удара важна она, а не только скорость «вперёд».
    const ms = c.t - a.t;
    g.vx = ms > 0 && k < 1 + EXTRAPOLATE / ms ? (c.x - a.x) / ms * 1000 : 0;
    g.vz = ms > 0 && k < 1 + EXTRAPOLATE / ms ? (c.z - a.z) / ms * 1000 : 0;
    m.visible = true;
    m.position.set(L(a.x, c.x), L(a.y, c.y), L(a.z, c.z));
    m.rotation.order = 'YXZ';
    m.rotation.set(L(a.p, c.p), lerpAngle(a.h, c.h, k), L(a.r, c.r));
    if (m.userData.body) m.userData.body.rotation.z = L(a.br, c.br);
    g.spin += (L(a.sp, c.sp) / 0.34) * dt;
    const steer = L(a.st, c.st);
    for (const { pivot, w, front } of m.userData.wheels) {
      w.rotation.x = g.spin;
      pivot.rotation.y = front ? -steer * 0.45 : 0;
    }
    if (g.label) {
      g.label.position.set(m.position.x, m.position.y + 2.4, m.position.z);
      g.label.visible = Math.hypot(m.position.x - car.pos.x, m.position.z - car.pos.y) < LABEL_DIST;
    }
  }

  #dispose(mesh) {
    if (!mesh) return;
    this.scene.remove(mesh);
    mesh.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } });
    disposePlates(mesh);
  }

  #drop(uid) {
    const g = this.ghosts.get(uid);
    if (!g) return;
    this.#dispose(g.mesh);
    if (g.label) { this.scene.remove(g.label); g.label.material.map.dispose(); g.label.material.dispose(); }
    this.ghosts.delete(uid);
  }
}

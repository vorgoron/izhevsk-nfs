// Звук целиком синтезируется Web Audio: мотор, визг шин, ветер, нитро, удары, сигналы гонки,
// трафик вокруг (моторы ближайших машин, шорох шин потока, гудки).
// Браузер разрешает звук только после жеста пользователя — контекст создаётся на первое нажатие.

const GEARS = [0, 35, 65, 100, 140, 185, 260]; // км/ч: границы передач
export const IDLE_RPM = 900, MAX_RPM = 6400;

// Обороты мотора к которым он идёт (без сглаживания) и передача — по скорости и газу. Общие для звука и тахометра.
export function engineTarget(kmh, throttle) {
  let gear = 1;
  while (gear < GEARS.length - 1 && kmh > GEARS[gear]) gear++;
  const lo = GEARS[gear - 1], hi = GEARS[gear];
  let rpm = IDLE_RPM + ((kmh - lo) / (hi - lo)) * (MAX_RPM - IDLE_RPM) * (gear === 1 ? 1 : 0.62) + (gear === 1 ? 0 : 2000);
  if (kmh < 2) rpm = throttle ? 2600 : IDLE_RPM; // газ на месте — перегазовка
  return { rpm, gear };
}
const TRAFFIC_VOICES = 4; // столько ближайших машин слышно мотором
const TRAFFIC_HEAR = 70; // м
const SOUND_SPEED = 343; // м/с, для Доплера
// Ползунки громкости в меню, 0..1: общая, своя машина, трафик, радио (радио — <audio>, его ставит main.js).
export const VOLUMES = ['master', 'car', 'traffic', 'radio'];

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem('muted') === '1'; } catch {}
    this.prev = { state: null, next: 0, count: 0, impact: 0 };
    this.rpm = IDLE_RPM;
    this.vol = Object.fromEntries(VOLUMES.map((k) => [k, 1]));
    try {
      const saved = JSON.parse(localStorage.getItem('volume') || '{}');
      for (const k of VOLUMES) if (Number.isFinite(saved[k])) this.vol[k] = Math.max(0, Math.min(1, saved[k]));
    } catch {}
  }

  setVolume(key, v) {
    this.vol[key] = Math.max(0, Math.min(1, v));
    try { localStorage.setItem('volume', JSON.stringify(this.vol)); } catch {}
    this.#applyGain();
  }

  // Вызывать из обработчика нажатия клавиши/клика.
  unlock() {
    if (!this.ctx) this.#init();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    try { localStorage.setItem('muted', this.muted ? '1' : '0'); } catch {}
    this.#applyGain();
    return this.muted;
  }

  // Пауза (меню): глушим всё, настройку «звук» не трогаем.
  setPaused(on) {
    this.paused = on;
    this.#applyGain();
  }

  #applyGain() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted || this.paused ? 0 : 0.8 * this.vol.master, t, 0.05);
    this.carBus.gain.setTargetAtTime(this.vol.car, t, 0.05);
    this.trafficBus.gain.setTargetAtTime(this.vol.traffic, t, 0.05);
  }

  #init() {
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted || this.paused ? 0 : 0.8 * this.vol.master;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    // Свои ползунки: звуки своей машины и трафика; сигналы гонки, звонки и бульканье — сразу в master.
    this.carBus = ctx.createGain();
    this.carBus.gain.value = this.vol.car;
    this.carBus.connect(this.master);
    this.trafficBus = ctx.createGain();
    this.trafficBus.gain.value = this.vol.traffic;
    this.trafficBus.connect(this.master);

    // Белый шум — основа шин, ветра, нитро и ударов.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Мотор: пила + пила октавой ниже + квадрат, через фильтр, мягкий перегруз.
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 4;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(2.5 * x); }
    shaper.curve = curve;
    shaper.connect(this.engineFilter).connect(this.engineGain).connect(this.carBus);
    this.engineOsc = [['sawtooth', 1, 0.5], ['sawtooth', 0.5, 0.6], ['square', 1.004, 0.2]].map(([type, mul, g]) => {
      const o = ctx.createOscillator();
      o.type = type;
      const gn = ctx.createGain();
      gn.gain.value = g;
      o.connect(gn).connect(shaper);
      o.start();
      return { o, mul };
    });

    this.skid = this.#noiseVoice('bandpass', 1300, 3, this.carBus);
    this.wind = this.#noiseVoice('lowpass', 500, 0.7, this.carBus);
    this.nitroV = this.#noiseVoice('highpass', 2500, 0.7, this.carBus);
    this.gravel = this.#noiseVoice('lowpass', 380, 1.2, this.carBus); // гул грунта под колёсами

    // Трафик: несколько голосов-моторов, каждый со своей панорамой, и общий шорох шин.
    this.trafficV = Array.from({ length: TRAFFIC_VOICES }, () => this.#trafficVoice());
    this.trafficRoll = this.#noiseVoice('lowpass', 650, 0.8, this.trafficBus);
  }

  // Мотор чужой машины: пила + треугольник октавой ниже, приглушённые фильтром.
  #trafficVoice() {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 400;
    f.Q.value = 2;
    const g = ctx.createGain();
    g.gain.value = 0;
    const pan = ctx.createStereoPanner();
    f.connect(g).connect(pan).connect(this.trafficBus);
    const osc = [['sawtooth', 1, 0.5], ['triangle', 0.5, 0.8]].map(([type, mul, gv]) => {
      const o = ctx.createOscillator();
      o.type = type;
      const gn = ctx.createGain();
      gn.gain.value = gv;
      o.connect(gn).connect(f);
      o.start();
      return { o, mul };
    });
    return { f, g, pan, osc, v: null };
  }

  // Гудок: два расстроенных квадрата через фильтр — «ба-а» легковушки, у автобуса ниже.
  #honk(bus, long, vol, pan) {
    const ctx = this.ctx, t = ctx.currentTime;
    const dur = long ? 0.9 : 0.35 + Math.random() * 0.15;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = bus ? 1400 : 2200;
    const g = ctx.createGain();
    g.gain.value = vol; // огибающая — у каждого «бипа» своя
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    f.connect(g).connect(p).connect(this.trafficBus);
    // Короткий гудок иногда двойной.
    const beeps = long || Math.random() < 0.6 ? [0] : [0, dur + 0.12];
    for (const freq of bus ? [262, 330] : [415, 523]) {
      for (const k of beeps) {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = freq * (0.98 + Math.random() * 0.04);
        const og = ctx.createGain();
        og.gain.setValueAtTime(0, t + k);
        og.gain.linearRampToValueAtTime(0.5, t + k + 0.015);
        og.gain.setValueAtTime(0.5, t + k + dur);
        og.gain.linearRampToValueAtTime(0, t + k + dur + 0.05);
        o.connect(og).connect(f);
        o.start(t + k);
        o.stop(t + k + dur + 0.1);
      }
    }
  }

  #noiseVoice(type, freq, q, out) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(out);
    src.start();
    return { f, g };
  }

  #tone(freq, t0, dur, type = 'square', vol = 0.15) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  #thump(strength, bus = this.carBus) {
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9 * strength, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(f).connect(g).connect(bus);
    src.start(t, Math.random());
    src.stop(t + 0.4);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.25);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.8 * strength, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(og).connect(bus);
    o.start(t);
    o.stop(t + 0.35);
  }

  // Снесли столб, светофор или щит (Breakables.smashes): треск и звон металла, удар — свой, от car.impact.
  // Снесённое сбитой машиной трафика вдали — тише.
  smash(list, car) {
    if (!list.length || !this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const b of list) {
      const s = b.s * Math.min(1, (12 / Math.max(Math.hypot(b.x - car.pos.x, b.z - car.pos.y), 1)) ** 1.1);
      if (s < 0.03) continue;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.setValueAtTime(2600, t);
      f.frequency.exponentialRampToValueAtTime(700, t + 0.3);
      f.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.7 * s, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      src.connect(f).connect(g).connect(this.carBus);
      src.start(t, Math.random());
      src.stop(t + 0.5);
      for (const freq of [430, 655, 1170]) { // звон стойки — негармоничные обертоны
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = freq * (0.95 + Math.random() * 0.1);
        const og = ctx.createGain();
        og.gain.setValueAtTime(0.12 * s, t);
        og.gain.exponentialRampToValueAtTime(0.001, t + 0.6 + Math.random() * 0.4);
        o.connect(og).connect(this.carBus);
        o.start(t);
        o.stop(t + 1.1);
      }
    }
  }

  // Струи трюка: шум с полосой, уходящей вниз, — «пшш» на взлёте.
  #whoosh() {
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.8;
    f.frequency.setValueAtTime(2500, t);
    f.frequency.exponentialRampToValueAtTime(400, t + 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.7, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    src.connect(f).connect(g).connect(this.carBus);
    src.start(t, Math.random());
    src.stop(t + 0.75);
  }

  // Трамвайный звонок: два коротких «дзынь».
  bell() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    for (const k of [0, 0.22]) {
      this.#tone(1568, t + k, 0.35, 'sine', 0.18);
      this.#tone(2093, t + k, 0.25, 'sine', 0.08);
    }
  }

  // Предупреждение: два нисходящих тона (критично — три и громче).
  warn(critical) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const notes = critical ? [988, 784, 988, 784] : [880, 660];
    notes.forEach((f, i) => this.#tone(f, t + i * 0.18, 0.16, 'square', critical ? 0.16 : 0.12));
  }

  #splash() {
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2500, t);
    f.frequency.exponentialRampToValueAtTime(250, t + 1.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
    src.connect(f).connect(g).connect(this.carBus);
    src.start(t, Math.random());
    src.stop(t + 1.4);
  }

  // Трафик слышно вокруг машины игрока: громкость — от расстояния, панорама — слева/справа
  // от курса игрока, высота мотора — от скорости и газа, со сдвигом Доплера.
  traffic(dt, traffic, car) {
    const honks = traffic.honks.splice(0); // копятся, только пока их не забрали
    const bangs = traffic.bangs.splice(0);
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const set = (param, v, tc = 0.08) => param.setTargetAtTime(v, t, tc);
    const px = car.pos.x, pz = car.pos.y, r = car.right;
    const near = [];
    if (traffic.enabled) {
      for (const v of traffic.vehicles) {
        if (!v.active) continue;
        const d = Math.hypot(v.x - px, v.z - pz);
        if (d < TRAFFIC_HEAR) near.push({ v, d });
      }
    }
    near.sort((a, b) => a.d - b.d);
    const loud = (d) => Math.min(1, (10 / Math.max(d, 1)) ** 1.1);
    // Удары машин трафика между собой и о стены (свои удары игрока — от car.impact в update).
    for (const b of bangs) {
      const s = b.s * loud(Math.hypot(b.x - px, b.z - pz));
      if (s > 0.03) this.#thump(Math.min(1, 0.3 + b.s) * s, this.trafficBus);
    }

    // Голос остаётся за машиной, пока она в числе ближайших; свободные берут новых — с нуля громкости.
    const top = near.slice(0, TRAFFIC_VOICES);
    for (const voice of this.trafficV) if (!top.some((n) => n.v === voice.v)) voice.v = null;
    for (const n of top) {
      if (this.trafficV.some((voice) => voice.v === n.v)) continue;
      const voice = this.trafficV.find((x) => !x.v);
      voice.v = n.v;
      voice.g.gain.cancelScheduledValues(t);
      voice.g.gain.setValueAtTime(0, t);
    }
    for (const voice of this.trafficV) {
      const v = voice.v;
      if (!v) { set(voice.g.gain, 0, 0.1); continue; }
      const rx = v.x - px, rz = v.z - pz, d = Math.max(Math.hypot(rx, rz), 0.5);
      const throttle = Math.min(1, Math.max(0, v.acc / 2.8));
      // Легковушка — четвёрка на 2–3 передаче, автобус — дизель пониже.
      const rpm = v.bus ? 650 + (v.speed / 11) * 1300 + throttle * 300 : 850 + Math.min(1, v.speed / 15) * 2300 + throttle * 500;
      // Доплер: скорость сближения вдоль линии игрок—машина.
      const closing = -((v.dx * v.speed - car.vel.x) * rx + (v.dz * v.speed - car.vel.y) * rz) / d;
      const dop = SOUND_SPEED / (SOUND_SPEED - Math.max(-60, Math.min(60, closing)));
      const freq = (rpm / 60) * (v.bus ? 3 : 2) * dop;
      for (const { o, mul } of voice.osc) set(o.frequency, freq * mul, 0.05);
      set(voice.f.frequency, (v.bus ? 220 : 300) + rpm * 0.12 + throttle * 250);
      set(voice.g.gain, loud(d) * (v.bus ? 0.32 : 0.22) * (0.6 + throttle * 0.4));
      set(voice.pan.pan, Math.max(-1, Math.min(1, ((rx * r.x + rz * r.y) / d) * 0.8)));
    }

    // Шорох шин всего потока рядом.
    let roll = 0;
    for (const { v, d } of near) roll += loud(d * 0.7) * Math.min(1, v.speed / 14);
    set(this.trafficRoll.g.gain, Math.min(0.2, roll * 0.08), 0.2);

    for (const h of honks) {
      const rx = h.x - px, rz = h.z - pz, d = Math.max(Math.hypot(rx, rz), 0.5);
      if (d > 120) continue;
      this.#honk(h.bus, h.long, Math.min(0.2, 0.2 * (8 / d) ** 1.1), Math.max(-1, Math.min(1, ((rx * r.x + rz * r.y) / d) * 0.8)));
    }
  }

  update(dt, car, input, race) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const set = (param, v, tc = 0.05) => param.setTargetAtTime(v, t, tc);

    // ---- мотор: обороты по передачам, на газу громче и ярче
    const kmh = Math.abs(car.speed) * 3.6;
    const throttle = input.up || input.down ? 1 : 0;
    const target = engineTarget(kmh, throttle).rpm;
    this.rpm += (target - this.rpm) * Math.min(1, dt * 9);
    const freq = (this.rpm / 60) * 2; // 4 цилиндра: 2 вспышки на оборот
    for (const { o, mul } of this.engineOsc) set(o.frequency, freq * mul, 0.02);
    set(this.engineFilter.frequency, 300 + this.rpm * (throttle ? 0.35 : 0.18));
    set(this.engineGain.gain, 0.09 + throttle * 0.055 + (this.rpm / MAX_RPM) * 0.035);

    // ---- шины: боковое скольжение и торможение юзом
    const slip = Math.abs(car.vel.dot(car.right));
    const braking = (input.brake || (input.down && car.speed > 3)) && kmh > 15;
    const skid = Math.min(1, Math.max(0, (slip - 2.5) / 8) + (braking ? 0.35 : 0)) * Math.min(1, kmh / 20);
    set(this.skid.g.gain, skid * 0.35, 0.04);
    set(this.skid.f.frequency, 1100 + slip * 25);

    // ---- грунт: глухой шорох, громче на скорости
    set(this.gravel.g.gain, (car.offroad ?? 0) * Math.min(1, kmh / 60) * 0.32, 0.1);

    // ---- ветер и нитро
    set(this.wind.g.gain, Math.min(0.25, (kmh / 200) ** 2 * 0.25), 0.2);
    const nitroOn = input.nitro && car.nitro > 0 && car.speed > 5;
    set(this.nitroV.g.gain, nitroOn ? 0.18 : 0, nitroOn ? 0.05 : 0.15);

    // ---- заправка: бульканье, полный бак — звонок
    if (car.refueling && Math.random() < dt * 7) this.#tone(110 + Math.random() * 90, t, 0.07, 'sine', 0.14);
    if (car.fuel >= 1 && this.prev.fuel < 1 && this.prev.refueling) {
      this.#tone(1046, t, 0.15, 'triangle', 0.22);
      this.#tone(1568, t + 0.12, 0.3, 'triangle', 0.22);
    }
    this.prev.fuel = car.fuel;
    this.prev.refueling = car.refueling;

    // ---- вода: плюх при въезде, потом бульканье
    if (car.sink > 0 && !this.prev.sink) this.#splash();
    if (car.sink > 0.3 && Math.random() < dt * 9) this.#tone(180 + Math.random() * 260, t, 0.08, 'sine', 0.12);
    this.prev.sink = car.sink;

    // ---- трюк: шипение струй на взлёте (посадку озвучивает удар ниже)
    if (car.air && !this.prev.air) this.#whoosh();
    this.prev.air = !!car.air;

    // ---- удар о стену: impact подскакивает в момент столкновения
    if (car.impact > this.prev.impact + 0.05) this.#thump(Math.min(1, 0.3 + car.impact));
    this.prev.impact = car.impact;

    // ---- гонка: отсчёт, чекпоинты, финиш
    const p = this.prev;
    if (race.state === 'countdown') {
      const n = Math.ceil(race.countdown);
      if (n !== p.count && n > 0 && n <= 3) this.#tone(440, t, 0.25);
      p.count = n;
    }
    if (race.state === 'running' && p.state === 'countdown') this.#tone(880, t, 0.5);
    if (race.state === 'running' && race.next > p.next) {
      this.#tone(988, t, 0.12, 'triangle', 0.25);
      this.#tone(1319, t + 0.09, 0.25, 'triangle', 0.25);
    }
    if (race.state === 'finished' && p.state === 'running') {
      [523, 659, 784, 1047].forEach((f, i) => this.#tone(f, t + i * 0.12, i === 3 ? 0.7 : 0.18, 'triangle', 0.25));
      if (race.isRecord) [1319, 1568].forEach((f, i) => this.#tone(f, t + 0.6 + i * 0.12, 0.5, 'triangle', 0.2));
    }
    p.state = race.state;
    p.next = race.next;
  }
}

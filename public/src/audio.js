// Звук целиком синтезируется Web Audio: мотор, визг шин, ветер, нитро, удары, сигналы гонки.
// Браузер разрешает звук только после жеста пользователя — контекст создаётся на первое нажатие.

const GEARS = [0, 35, 65, 100, 140, 185, 260]; // км/ч: границы передач
const IDLE_RPM = 900, MAX_RPM = 6400;

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem('muted') === '1'; } catch {}
    this.prev = { state: null, next: 0, count: 0, impact: 0 };
    this.rpm = IDLE_RPM;
  }

  // Вызывать из обработчика нажатия клавиши/клика.
  unlock() {
    if (!this.ctx) this.#init();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    try { localStorage.setItem('muted', this.muted ? '1' : '0'); } catch {}
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  #init() {
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

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
    shaper.connect(this.engineFilter).connect(this.engineGain).connect(this.master);
    this.engineOsc = [['sawtooth', 1, 0.5], ['sawtooth', 0.5, 0.6], ['square', 1.004, 0.2]].map(([type, mul, g]) => {
      const o = ctx.createOscillator();
      o.type = type;
      const gn = ctx.createGain();
      gn.gain.value = g;
      o.connect(gn).connect(shaper);
      o.start();
      return { o, mul };
    });

    this.skid = this.#noiseVoice('bandpass', 1300, 3);
    this.wind = this.#noiseVoice('lowpass', 500, 0.7);
    this.nitroV = this.#noiseVoice('highpass', 2500, 0.7);
  }

  #noiseVoice(type, freq, q) {
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
    src.connect(f).connect(g).connect(this.master);
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

  #thump(strength) {
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9 * strength, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.4);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.25);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.8 * strength, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.35);
  }

  update(dt, car, input, race) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const set = (param, v, tc = 0.05) => param.setTargetAtTime(v, t, tc);

    // ---- мотор: обороты по передачам, на газу громче и ярче
    const kmh = Math.abs(car.speed) * 3.6;
    let gear = 1;
    while (gear < GEARS.length - 1 && kmh > GEARS[gear]) gear++;
    const lo = GEARS[gear - 1], hi = GEARS[gear];
    const throttle = input.up || input.down ? 1 : 0;
    let target = IDLE_RPM + ((kmh - lo) / (hi - lo)) * (MAX_RPM - IDLE_RPM) * (gear === 1 ? 1 : 0.62) + (gear === 1 ? 0 : 2000);
    if (kmh < 2) target = throttle ? 2600 : IDLE_RPM; // газ на месте — перегазовка
    this.rpm += (target - this.rpm) * Math.min(1, dt * 9);
    const freq = (this.rpm / 60) * 2; // 4 цилиндра: 2 вспышки на оборот
    for (const { o, mul } of this.engineOsc) set(o.frequency, freq * mul, 0.02);
    set(this.engineFilter.frequency, 300 + this.rpm * (throttle ? 0.35 : 0.18));
    set(this.engineGain.gain, 0.16 + throttle * 0.1 + (this.rpm / MAX_RPM) * 0.06);

    // ---- шины: боковое скольжение и торможение юзом
    const slip = Math.abs(car.vel.dot(car.right));
    const braking = (input.brake || (input.down && car.speed > 3)) && kmh > 15;
    const skid = Math.min(1, Math.max(0, (slip - 2.5) / 8) + (braking ? 0.35 : 0)) * Math.min(1, kmh / 20);
    set(this.skid.g.gain, skid * 0.35, 0.04);
    set(this.skid.f.frequency, 1100 + slip * 25);

    // ---- ветер и нитро
    set(this.wind.g.gain, Math.min(0.25, (kmh / 200) ** 2 * 0.25), 0.2);
    const nitroOn = input.nitro && car.nitro > 0 && car.speed > 5;
    set(this.nitroV.g.gain, nitroOn ? 0.18 : 0, nitroOn ? 0.05 : 0.15);

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

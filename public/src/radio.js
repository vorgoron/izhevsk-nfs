// Радио: интернет-потоки через обычный <audio> (не Web Audio — потоки без CORS туда не пускают).
// Переключение по кругу: выкл → станции → выкл. Выбор помнится; после перезагрузки поток
// включается на первое нажатие — браузер не даёт играть звук без жеста пользователя.

export const STATIONS = [
  { name: 'Радио Адам', url: 'https://radioadam.hostingradio.ru/radioadam256.mp3' },
  { name: 'Даур FM', url: 'https://fm.daur.media/listen/daur_fm/radio.mp3' },
  // Только http: со страницы по https браузер поток не пустит (mixed content) — играет лишь локально.
  { name: 'Моя Удмуртия', url: 'http://radio.myudm.ru:10010/efir' },
];

export class Radio {
  // onChange() — сменилась станция или состояние потока (status: 'loading' | 'playing' | 'error').
  constructor(onChange) {
    this.onChange = onChange;
    this.status = 'loading';
    this.station = -1; // -1 — выключено
    try { this.station = Math.min(STATIONS.length - 1, +(localStorage.getItem('radio') ?? -1)); } catch {}
    this.muted = false;
    this.started = false;
    const a = (this.audio = new Audio());
    a.preload = 'none';
    a.volume = 0.6; // на iPhone не работает — там громкость только кнопками телефона (и ползунок в меню тоже)
    const set = (status) => { if (this.station >= 0 && a.src && this.status !== status) { this.status = status; this.onChange(); } };
    a.addEventListener('error', () => set('error'));
    a.addEventListener('waiting', () => set('loading'));
    a.addEventListener('playing', () => set('playing'));
  }

  get name() { return this.station >= 0 ? STATIONS[this.station].name : null; }

  // Вызывать из обработчика нажатия: запускает станцию, выбранную в прошлый раз.
  unlock() {
    if (this.started) return;
    this.started = true;
    if (this.station >= 0) { this.#play(); this.onChange(); }
  }

  // Первое нажатие после загрузки включает запомненную станцию, дальше — следующую по кругу.
  next() {
    if (!this.started && this.station >= 0) return this.unlock();
    this.started = true;
    this.station = this.station + 1 < STATIONS.length ? this.station + 1 : -1;
    try { localStorage.setItem('radio', this.station); } catch {}
    if (this.station >= 0) this.#play();
    else this.#stop();
    this.onChange();
  }

  // Ползунок громкости, 0..1.
  setVolume(v) {
    this.audio.volume = 0.6 * Math.max(0, Math.min(1, v));
  }

  // Общий «звук выкл» глушит и радио; поток не рвём, чтобы включение было мгновенным.
  setMuted(on) {
    this.muted = on;
    this.audio.muted = on;
  }

  #play() {
    const a = this.audio;
    this.status = 'loading';
    a.src = STATIONS[this.station].url; // заново — живой эфир, а не то, что осталось в буфере
    a.muted = this.muted;
    a.play().catch(() => {}); // ошибку сети покажет обработчик 'error'
  }

  #stop() {
    const a = this.audio;
    a.pause();
    a.removeAttribute('src'); // иначе браузер продолжает качать поток
    a.load();
  }
}

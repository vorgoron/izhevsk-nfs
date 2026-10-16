// Меню-пауза: действия (гонка, на дорогу, гараж) и все настройки. Открывается Esc или ☰.
// Горячие клавиши работают и без меню — main.js после каждого действия зовёт sync(),
// чтобы переключатели в меню показывали текущее состояние.

const CAMERAS = ['сзади', 'из салона', 'сверху'];
const VOLUME_LABELS = { master: 'Общая', car: 'Своя машина', traffic: 'Трафик', radio: 'Радио' };

export class Menu {
  // actions — общие действия main.js; state() — { sound, radio, traffic, camera, fps, bigMap, fullscreen };
  // volume — ползунки громкости { get(key), set(key, 0..1) }; setName — имя игрока для сети.
  // В state() для сети: name, room, city (в общем городе), online, players, netStatus, copied.
  constructor({ actions, state, volume, setName }) {
    this.actions = actions;
    this.state = state;
    this.volume = volume;
    this.isOpen = false;

    const el = (this.el = document.createElement('div'));
    el.id = 'menu';
    const fs = document.fullscreenEnabled; // iPhone не умеет
    // Две страницы: главная и подменю громкости (ползунки), переход — кнопки data-page.
    el.innerHTML = `<div class="box">
      <div class="page" data-page="main">
      <h2>Пауза</h2>
      <button data-act="menu" class="go">Продолжить <kbd>Esc</kbd></button>
      <button data-act="race">Новая гонка <kbd>N</kbd></button>
      <button data-act="respawn">На дорогу <kbd>R</kbd></button>
      <button data-act="garage">Гараж — выбор машины <kbd>G</kbd></button>
      <h3>Сеть <span data-v="net"></span></h3>
      <button data-page="name">Имя <b data-v="name"></b><i>›</i></button>
      <button data-act="invite">Позвать друзей <b data-v="invite"></b></button>
      <button data-act="city" data-show="room">В общий город <b data-v="room"></b></button>
      <h3>Настройки</h3>
      <button data-act="sound">Звук <b data-v="sound"></b><kbd>V</kbd></button>
      <button data-page="volume">Громкость <b data-v="volume"></b><i>›</i></button>
      <button data-act="radio">Радио <b data-v="radio"></b><kbd>B</kbd></button>
      <button data-act="traffic">Трафик <b data-v="traffic"></b><kbd>T</kbd></button>
      <button data-act="camera">Камера <b data-v="camera"></b><kbd>C</kbd></button>
      <button data-act="fps">Кадров в секунду <b data-v="fps"></b><kbd>L</kbd></button>
      <button data-act="map">Миникарта <b data-v="bigMap"></b><kbd>M</kbd></button>
      ${fs ? '<button data-act="fullscreen">Во весь экран <b data-v="fullscreen"></b><kbd>F</kbd></button>' : ''}
      <div class="keys">
        <kbd>W A S D</kbd> / стрелки — ехать · <kbd>Пробел</kbd> ручник · <kbd>Shift</kbd> нитро<br>
        мышь — повернуть камеру
      </div>
      </div>
      <div class="page" data-page="name" hidden>
      <h2>Имя</h2>
      <input data-name maxlength="10" autocomplete="nickname" enterkeyhint="done" spellcheck="false">
      <p class="hint">До 10 знаков. Его видят другие игроки над вашей машиной и на её номере.</p>
      <button data-page="main" class="go">‹ Готово <kbd>Esc</kbd></button>
      </div>
      <div class="page" data-page="volume" hidden>
      <h2>Громкость</h2>
      <div class="volumes">${Object.entries(VOLUME_LABELS).map(([k, label]) =>
        `<label>${label}<input type="range" min="0" max="100" step="5" data-vol="${k}"><output data-vol-out="${k}"></output></label>`).join('')}</div>
      <button data-page="main" class="go">‹ Назад <kbd>Esc</kbd></button>
      </div>
    </div>`;
    document.body.append(el);
    for (const b of el.querySelectorAll('[data-act]')) {
      b.addEventListener('click', () => this.actions[b.dataset.act]());
    }
    for (const b of el.querySelectorAll('button[data-page]')) b.addEventListener('click', () => this.page(b.dataset.page));
    const nameIn = (this.nameIn = el.querySelector('[data-name]'));
    nameIn.addEventListener('change', () => { setName(nameIn.value); this.sync(); });
    nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.page('main'); });
    for (const r of el.querySelectorAll('[data-vol]')) {
      r.addEventListener('input', () => { this.volume.set(r.dataset.vol, r.value / 100); this.sync(); });
    }
    // Клик мимо панели — продолжить.
    el.addEventListener('pointerdown', (e) => { if (e.target === el) { this.page('main'); this.actions.menu(); } });
    document.addEventListener('fullscreenchange', () => this.sync());
    this.sync();
  }

  sync() {
    const s = this.state();
    const v = {
      sound: s.sound ? 'вкл' : 'выкл',
      radio: s.radio ?? 'выкл',
      traffic: s.traffic ? 'вкл' : 'выкл',
      camera: CAMERAS[s.camera],
      fps: s.fps ? `до ${s.fps}` : 'без предела',
      bigMap: s.bigMap ? 'крупная' : 'обычная',
      fullscreen: s.fullscreen ? 'вкл' : 'выкл',
      volume: s.sound ? `${Math.round(this.volume.get('master') * 100)}%` : 'звук выкл',
      net: { online: `· ${s.city ? 'общий город' : 'своя комната'} · ${s.players} в игре`, connecting: '· подключение…', offline: '· нет связи' }[s.netStatus],
      name: s.name,
      invite: s.copied ? 'ссылка скопирована' : s.city ? 'своя комната' : 'ссылка',
      room: s.room,
    };
    s.invite = s.online;
    s.volume = s.sound && this.volume.get('master') > 0;
    for (const b of this.el.querySelectorAll('[data-v]')) {
      b.textContent = v[b.dataset.v];
      b.classList.toggle('off', !['camera', 'bigMap', 'fps', 'net', 'name', 'room'].includes(b.dataset.v) && !s[b.dataset.v]);
    }
    this.el.querySelector('[data-show="room"]').hidden = s.city;
    if (document.activeElement !== this.nameIn) this.nameIn.value = s.name;
    for (const r of this.el.querySelectorAll('[data-vol]')) {
      const pct = Math.round(this.volume.get(r.dataset.vol) * 100);
      if (document.activeElement !== r) r.value = pct;
      this.el.querySelector(`[data-vol-out="${r.dataset.vol}"]`).textContent = `${pct}%`;
    }
    this.el.querySelector('.volumes').classList.toggle('off', !s.sound);
  }

  // Показать страницу меню: 'main' или 'volume'.
  page(name) {
    // Уходим со страницы имени — сохранить введённое (change не всегда успевает, например по Esc).
    if (document.activeElement === this.nameIn) this.nameIn.blur();
    for (const p of this.el.querySelectorAll('.page')) p.hidden = p.dataset.page !== name;
    this.sync();
    if (name === 'name') this.nameIn.focus();
  }

  // Esc в подменю — назад на главную, а не закрыть меню. true — если было куда возвращаться.
  back() {
    if (!this.isOpen || this.el.querySelector('[data-page="main"].page').hidden === false) return false;
    this.page('main');
    return true;
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.sync();
    this.el.classList.add('open');
    document.body.classList.add('in-menu');
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.page('main');
    this.el.classList.remove('open');
    document.body.classList.remove('in-menu');
  }

  toggle() { this.isOpen ? this.close() : this.open(); }
}

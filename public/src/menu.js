// Меню-пауза: действия (гонка, на дорогу, гараж) и все настройки. Открывается Esc или ☰.
// Горячие клавиши работают и без меню — main.js после каждого действия зовёт sync(),
// чтобы переключатели в меню показывали текущее состояние.

import { Wheel } from './wheel.js';

const CAMERAS = ['сзади', 'из салона', 'сверху', 'кино'];
const VOLUME_LABELS = { master: 'Общая', car: 'Своя машина', traffic: 'Трафик', radio: 'Радио' };

export class Menu {
  // actions — общие действия main.js; state() — { sound, radio, traffic, camera, night, fps, fullscreen, debug };
  // volume — ползунки громкости { get(key), set(key, 0..1) }; setName — имя игрока для сети.
  // radio — станции для барабана { names, get() — номер или -1, select(i) }.
  // В state() для сети: name, room, city (в общем городе), online, players, netStatus, copied,
  // shared (гонка общая — в своей комнате на связи). money — баланс, nitro — цена долива баллона (или «полный»).
  // account — вход по почте (account.js): { state() → { status, email, error }, start(), send(email), signOut() }.
  constructor({ actions, state, volume, radio, setName, account }) {
    this.account = account;
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
      <h2>Пауза <small data-v="money"></small></h2>
      <button data-act="menu" class="go">Продолжить <kbd>Esc</kbd></button>
      <button data-act="race">Новая гонка <b data-v="race"></b><kbd>N</kbd></button>
      <button data-act="respawn">На дорогу <kbd>R</kbd></button>
      <button data-act="nitro">Нитро в баллон <b data-v="nitro"></b></button>
      <button data-act="garage">Гараж — выбор машины <kbd>G</kbd></button>
      <h3>Сеть <span data-v="net"></span></h3>
      <button data-page="name">Имя <b data-v="name"></b><i>›</i></button>
      <button data-act="invite">Позвать друзей <b data-v="invite"></b></button>
      <button data-page="account">Аккаунт <b data-v="account"></b><i>›</i></button>
      <button data-act="city" data-show="room">Ездить одному, без друзей</button>
      <h3>Настройки</h3>
      <button data-act="sound">Звук <b data-v="sound"></b><kbd>V</kbd></button>
      <button data-page="volume">Громкость <b data-v="volume"></b><i>›</i></button>
      <button data-page="radio">Радио <b data-v="radio"></b><kbd>B</kbd><i>›</i></button>
      <button data-act="traffic">Трафик <b data-v="traffic"></b><kbd>T</kbd></button>
      <button data-act="night">Время суток <b data-v="night"></b><kbd>Y</kbd></button>
      <button data-act="camera">Камера <b data-v="camera"></b><kbd>C</kbd></button>
      <button data-act="fps">Кадров в секунду <b data-v="fps"></b><kbd>L</kbd></button>
      <button data-act="map">Карта города <b data-v="nav"></b><kbd>M</kbd></button>
      <button data-act="debug">Отладка: координаты и камера <b data-v="debug"></b><kbd>I</kbd></button>
      ${fs ? '<button data-act="fullscreen">Во весь экран <b data-v="fullscreen"></b><kbd>F</kbd></button>' : ''}
      <button data-page="tricks">Трюки <b data-v="tricks"></b><i>›</i></button>
      <div class="keys">
        <kbd>W A S D</kbd> / стрелки — ехать · <kbd>Пробел</kbd> ручник · <kbd>Shift</kbd> нитро<br>
        <kbd>Пробел</kbd> <kbd>Пробел</kbd> <kbd>W</kbd> kickflip · <kbd>Пробел</kbd> <kbd>Пробел</kbd> <kbd>S</kbd> backflip<br>
        мышь — повернуть камеру
      </div>
      </div>
      <div class="page" data-page="name" hidden>
      <h2>Имя</h2>
      <input data-name maxlength="10" autocomplete="nickname" enterkeyhint="done" spellcheck="false">
      <p class="hint">До 10 знаков. Его видят другие игроки над вашей машиной и на её номере.</p>
      <button data-page="main" class="go">‹ Готово <kbd>Esc</kbd></button>
      </div>
      <div class="page" data-page="account" hidden>
      <h2>Аккаунт</h2>
      <p class="hint" data-acc="text"></p>
      <input data-acc="email" type="email" autocomplete="email" enterkeyhint="send" spellcheck="false" placeholder="почта">
      <button data-acc="send" class="go">Прислать ссылку для входа</button>
      <button data-acc="out">Выйти из аккаунта</button>
      <button data-page="main">‹ Назад <kbd>Esc</kbd></button>
      </div>
      <div class="page" data-page="tricks" hidden>
      <h2>Трюки</h2>
      <p class="hint">Набор — как суперудар: три нажатия подряд, быстро, не дольше 0,7 с. Газ или тормоз нажать
        заново, даже если уже держите.</p>
      <div class="tricks">
        <div><b>Kickflip</b> — подскок на струях и оборот вбок; в какую сторону рулишь, туда и крутится
          <span class="combo only-keys"><kbd>Пробел</kbd> <kbd>Пробел</kbd> <kbd>W</kbd> или <kbd>↑</kbd></span>
          <span class="combo only-touch">ручник · ручник · газ</span></div>
        <div><b>Backflip</b> — подскок и оборот назад через крышу
          <span class="combo only-keys"><kbd>Пробел</kbd> <kbd>Пробел</kbd> <kbd>S</kbd> или <kbd>↓</kbd></span>
          <span class="combo only-touch">ручник · ручник · тормоз</span></div>
        <div>В полёте руль поворачивает машину боковыми соплами. Подскок — выше машин и автобусов, их можно перелететь.</div>
      </div>
      <button data-page="main" class="go">‹ Назад <kbd>Esc</kbd></button>
      </div>
      <div class="page" data-page="radio" hidden>
      <h2>Радио</h2>
      <div data-wheel></div>
      <p class="hint">Прокрутите барабан — станция включится, когда он остановится.<span class="only-keys"> Стрелки ↑ ↓ или <kbd>B</kbd> — следующая.</span></p>
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
    const email = el.querySelector('[data-acc=email]');
    el.querySelector('[data-acc=send]').addEventListener('click', () => account.send(email.value));
    email.addEventListener('keydown', (e) => { if (e.key === 'Enter') account.send(email.value); });
    el.querySelector('[data-acc=out]').addEventListener('click', () => account.signOut());
    this.wheel = new Wheel(radio.names, { get: radio.get, select: (i) => { radio.select(i); this.sync(); } });
    el.querySelector('[data-wheel]').replaceWith(this.wheel.el);
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
      night: s.night,
      fps: s.fps ? `до ${s.fps}` : 'без предела',
      nav: s.nav ?? '',
      fullscreen: s.fullscreen ? 'вкл' : 'выкл',
      volume: s.sound ? `${Math.round(this.volume.get('master') * 100)}%` : 'звук выкл',
      net: { online: `· ${s.city ? 'один' : 'с друзьями по ссылке'} · ${s.players} в игре`, connecting: '· подключение…', offline: '· нет связи', solo: '· один · позовите друзей ссылкой' }[s.netStatus],
      name: s.name,
      invite: s.copied ? 'ссылка скопирована' : 'скопировать ссылку',
      room: s.room,
      race: s.shared ? 'со всеми в комнате' : '',
      tricks: 'kickflip, backflip',
      money: s.money,
      account: { in: this.account?.state().email, sent: 'письмо отправлено' }[this.account?.state().status] ?? 'войти по почте',
      nitro: s.nitro,
      debug: s.debug ? 'вкл' : 'выкл',
    };
    s.invite = s.online || s.city;
    s.volume = s.sound && this.volume.get('master') > 0;
    for (const b of this.el.querySelectorAll('[data-v]')) {
      b.textContent = v[b.dataset.v];
      b.classList.toggle('off', !['camera', 'night', 'nav', 'fps', 'net', 'name', 'room', 'race', 'tricks', 'money', 'nitro', 'account'].includes(b.dataset.v) && !s[b.dataset.v]);
    }
    this.el.querySelector('[data-show="room"]').hidden = s.city;
    if (document.activeElement !== this.nameIn) this.nameIn.value = s.name;
    for (const r of this.el.querySelectorAll('[data-vol]')) {
      const pct = Math.round(this.volume.get(r.dataset.vol) * 100);
      if (document.activeElement !== r) r.value = pct;
      this.el.querySelector(`[data-vol-out="${r.dataset.vol}"]`).textContent = `${pct}%`;
    }
    this.el.querySelector('.volumes').classList.toggle('off', !s.sound);
    // Аккаунт: что с входом и что можно сделать.
    const a = this.account?.state() ?? { status: 'out' };
    const acc = (k) => this.el.querySelector(`[data-acc=${k}]`);
    acc('text').textContent = {
      out: 'Войдите по почте — деньги, детали, машина и рекорды сохранятся и будут на любом устройстве. Пароль не нужен: пришлём ссылку.',
      loading: 'Подождите…',
      sent: `Письмо со ссылкой отправлено на ${a.email}. Откройте её на этом или другом устройстве — и вы в аккаунте.`,
      in: `Вы вошли: ${a.email}. Прогресс сохраняется в аккаунте.`,
      error: a.error,
    }[a.status];
    acc('email').hidden = acc('send').hidden = a.status === 'in' || a.status === 'loading';
    acc('send').textContent = a.status === 'sent' ? 'Прислать ещё раз' : 'Прислать ссылку для входа';
    acc('out').hidden = a.status !== 'in';
    this.wheel.sync();
  }

  // Показать страницу меню: 'main', 'name', 'radio', 'volume' или 'tricks'.
  page(name) {
    // Уходим со страницы имени — сохранить введённое (change не всегда успевает, например по Esc).
    if (document.activeElement === this.nameIn) this.nameIn.blur();
    for (const p of this.el.querySelectorAll('.page')) p.hidden = p.dataset.page !== name;
    this.sync();
    if (name === 'name') this.nameIn.focus();
    if (name === 'account') this.account?.start();
    if (name === 'radio') {
      this.wheel.show();
      this.wheel.wheel.focus({ preventScroll: true });
    }
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

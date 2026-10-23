// Меню-пауза: действия (гонка, на дорогу, гараж) и все настройки. Открывается Esc или ☰.
// Горячие клавиши работают и без меню — main.js после каждого действия зовёт sync(),
// чтобы переключатели в меню показывали текущее состояние.

import { Wheel } from './wheel.js';
import { AD_LIMITS, validContact } from './adrequest.js';

const CAMERAS = ['сзади', 'из салона', 'сверху', 'кино'];
// Откуда пришли на вложенную страницу — туда ведут «Назад» и Esc; остальные страницы — с главной.
const PARENT = { name: 'net', volume: 'settings', radio: 'settings', quality: 'settings' };
const VOLUME_LABELS = { master: 'Общая', car: 'Своя машина', traffic: 'Трафик', radio: 'Радио' };

export class Menu {
  // actions — общие действия main.js; state() — { sound, radio, traffic, camera, night, fps, quality, qName, fullscreen, debug };
  // volume — ползунки громкости { get(key), set(key, 0..1) }; setName — имя игрока для сети.
  // radio — станции для барабана { names, get() — номер или -1, select(i) }.
  // В state() для сети: name, room, city (в общем городе), online, players, netStatus, copied,
  // shared (гонка общая — в своей комнате на связи). money — баланс, nitro — цена долива баллона (или «полный»),
  // hopper — стоит ли «Кузнечик» (трюки).
  // account — вход по почте (account.js): { state() → { status, email, error }, start(), send(email), signOut() }.
  // adRequest — отправить заявку на рекламу { who, contact, phone, what } → Promise (adrequest.js).
  constructor({ actions, state, volume, radio, setName, account, adRequest }) {
    this.account = account;
    this.actions = actions;
    this.state = state;
    this.volume = volume;
    this.isOpen = false;

    const el = (this.el = document.createElement('div'));
    el.id = 'menu';
    const fs = document.fullscreenEnabled; // iPhone не умеет
    // Страницы: на главной — игровые действия, остальное в подменю; переход — кнопки data-page.
    el.innerHTML = `<div class="box">
      <div class="page" data-page="main">
      <h2>Пауза <small data-v="money"></small></h2>
      <button data-act="menu" class="go">Продолжить <kbd>Esc</kbd></button>
      <button data-act="race">Новая гонка <b data-v="race"></b><kbd>N</kbd></button>
      <button data-act="taxi">Такси <b data-v="taxi"></b><kbd>J</kbd></button>
      <button data-act="garage">Автосалон — машины и улучшения <kbd>G</kbd></button>
      <button data-act="map">Карта города <b data-v="nav"></b><kbd>M</kbd></button>
      <button data-act="nitro">Нитро в баллон <b data-v="nitro"></b></button>
      <button data-act="respawn">На дорогу <kbd>R</kbd></button>
      <hr>
      <button data-page="net">Друзья и сеть <b data-v="netShort"></b><i>›</i></button>
      <button data-page="account">Аккаунт <b data-v="account"></b><i>›</i></button>
      <button data-page="settings">Настройки <i>›</i></button>
      <button data-page="tricks"><span class="only-keys">Управление и трюки</span><span class="only-touch">Трюки</span> <b data-v="tricks"></b><i>›</i></button>
      <button data-page="ads">Реклама на щитах <b data-v="ads"></b><i>›</i></button>
      </div>
      <div class="page" data-page="net" hidden>
      <h2>Друзья и сеть</h2>
      <p class="hint" data-v="net"></p>
      <button data-act="invite">Позвать друзей <b data-v="invite"></b></button>
      <button data-act="city" data-show="room">Ездить одному, без друзей</button>
      <button data-page="name">Имя <b data-v="name"></b><i>›</i></button>
      <button data-page="main" class="go">‹ Назад <kbd>Esc</kbd></button>
      </div>
      <div class="page" data-page="settings" hidden>
      <h2>Настройки</h2>
      <button data-act="lang">Язык <b data-v="lang"></b></button>
      <h3>Звук</h3>
      <button data-act="sound">Звук <b data-v="sound"></b><kbd>V</kbd></button>
      <button data-page="volume">Громкость <b data-v="volume"></b><i>›</i></button>
      <button data-page="radio">Радио <b data-v="radio"></b><kbd>B</kbd><i>›</i></button>
      <h3>Город</h3>
      <button data-act="traffic">Трафик <b data-v="traffic"></b><kbd>T</kbd></button>
      <button data-act="night">Время суток <b data-v="night"></b><kbd>Y</kbd></button>
      <h3>Экран</h3>
      <button data-act="camera">Камера <b data-v="camera"></b><kbd>C</kbd></button>
      <button data-page="quality">Графика <b data-v="quality"></b><i>›</i></button>
      <button data-act="fps">Кадров в секунду <b data-v="fps"></b><kbd>L</kbd></button>
      ${fs ? '<button data-act="fullscreen">Во весь экран <b data-v="fullscreen"></b><kbd>F</kbd></button>' : ''}
      <button data-act="debug">Отладка: координаты и камера <b data-v="debug"></b><kbd>I</kbd></button>
      <button data-page="main" class="go">‹ Назад <kbd>Esc</kbd></button>
      </div>
      <div class="page" data-page="name" hidden>
      <h2>Имя</h2>
      <input data-name maxlength="10" autocomplete="nickname" enterkeyhint="done" spellcheck="false">
      <p class="hint">До 10 знаков. Его видят другие игроки над вашей машиной и на её номере.</p>
      <button data-page="net" class="go">‹ Готово <kbd>Esc</kbd></button>
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
      <h2><span class="only-keys">Управление и трюки</span><span class="only-touch">Трюки</span></h2>
      <div class="keys">
        <kbd>W A S D</kbd> или стрелки — ехать<br>
        <kbd>Пробел</kbd> — ручник · <kbd>Shift</kbd> — нитро<br>
        мышь — повернуть камеру · колесо — ближе / дальше
      </div>
      <h3 class="only-keys">Трюки</h3>
      <p class="hint" data-show="no-hopper">Трюкам нужна система «Кузнечик» — струи на днище машины. Она продаётся в автосалоне
        (<span class="only-keys"><kbd>G</kbd> или </span>«Автосалон» в меню) и ставится на машину.</p>
      <p class="hint">Набор — как суперудар: три нажатия подряд, быстро, не дольше 0,7 с. Газ или тормоз нажать
        заново, даже если уже держите.</p>
      <div class="tricks">
        <div><b>Kickflip</b> — подскок на струях и оборот вбок; в какую сторону рулишь, туда и крутится
          <span class="combo only-keys"><kbd>Пробел</kbd> <kbd>Пробел</kbd> <kbd>W</kbd> или <kbd>↑</kbd></span>
          <span class="combo only-touch">ручник · ручник · газ</span></div>
        <div><b>Backflip</b> — подскок и оборот назад через крышу
          <span class="combo only-keys"><kbd>Пробел</kbd> <kbd>Пробел</kbd> <kbd>S</kbd> или <kbd>↓</kbd></span>
          <span class="combo only-touch">ручник · ручник · тормоз</span></div>
        <div><b>Бочка</b> — подскок и оборот влево или вправо, машину при этом сносит вбок на полосу-другую
          <span class="combo only-keys"><kbd>Пробел</kbd> <kbd>Пробел</kbd> <kbd>A</kbd>/<kbd>D</kbd> или <kbd>←</kbd>/<kbd>→</kbd></span></div>
        <div>В полёте руль поворачивает машину боковыми соплами. Подскок — выше машин и автобусов, их можно перелететь.</div>
      </div>
      <button data-page="main" class="go">‹ Назад <kbd>Esc</kbd></button>
      </div>
      <div class="page" data-page="radio" hidden>
      <h2>Радио</h2>
      <div data-wheel></div>
      <p class="hint">Прокрутите барабан — станция включится, когда он остановится.<span class="only-keys"> Стрелки ↑ ↓ или <kbd>B</kbd> — следующая.</span></p>
      <button data-page="settings" class="go">‹ Готово <kbd>Esc</kbd></button>
      </div>
      <div class="page" data-page="ads" hidden>
      <h2>Реклама на щитах</h2>
      <p class="hint">Ваш плакат на рекламных щитах вдоль улиц Ижевска в игре: нажатие на него ведёт на ваш сайт.
        Оставьте заявку — свяжемся и расскажем о местах и ценах.</p>
      <input data-ad="who" maxlength="${AD_LIMITS.who}" autocomplete="organization" placeholder="Компания или имя">
      <input data-ad="contact" maxlength="${AD_LIMITS.contact}" autocomplete="email" placeholder="Почта, Telegram (@имя) или ВКонтакте (vk.com/…)">
      <input data-ad="phone" type="tel" maxlength="${AD_LIMITS.phone}" autocomplete="tel" placeholder="Телефон — по желанию">
      <textarea data-ad="what" maxlength="${AD_LIMITS.what}" rows="3" placeholder="Что рекламировать и где (улицы, район) — по желанию"></textarea>
      <p class="hint" data-ad="text"></p>
      <button data-ad="send" class="go">Отправить заявку</button>
      <button data-page="main">‹ Назад <kbd>Esc</kbd></button>
      </div>
      <div class="page" data-page="quality" hidden>
      <h2>Графика</h2>
      <button data-q="high">Высокая <b>весь город до горизонта, тени, сглаживание</b></button>
      <button data-q="medium">Средняя <b>город до ~1 км, мелочи вблизи</b></button>
      <button data-q="low">Низкая <b>для слабых телефонов: ближе туман, без теней</b></button>
      <p class="hint">Игра перезапустится с того же места.</p>
      <button data-page="settings">‹ Назад <kbd>Esc</kbd></button>
      </div>
      <div class="page" data-page="volume" hidden>
      <h2>Громкость</h2>
      <div class="volumes">${Object.entries(VOLUME_LABELS).map(([k, label]) =>
        `<label>${label}<input type="range" min="0" max="100" step="5" data-vol="${k}"><output data-vol-out="${k}"></output></label>`).join('')}</div>
      <button data-page="settings" class="go">‹ Назад <kbd>Esc</kbd></button>
      </div>
    </div>`;
    document.body.append(el);
    for (const b of el.querySelectorAll('[data-act]')) {
      b.addEventListener('click', () => this.actions[b.dataset.act]());
    }
    for (const b of el.querySelectorAll('button[data-q]')) b.addEventListener('click', () => this.actions.quality(b.dataset.q));
    for (const b of el.querySelectorAll('button[data-page]')) b.addEventListener('click', () => this.page(b.dataset.page));
    const nameIn = (this.nameIn = el.querySelector('[data-name]'));
    nameIn.addEventListener('change', () => { setName(nameIn.value); this.sync(); });
    nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.page('net'); });
    for (const r of el.querySelectorAll('[data-vol]')) {
      r.addEventListener('input', () => { this.volume.set(r.dataset.vol, r.value / 100); this.sync(); });
    }
    const email = el.querySelector('[data-acc=email]');
    el.querySelector('[data-acc=send]').addEventListener('click', () => account.send(email.value));
    email.addEventListener('keydown', (e) => { if (e.key === 'Enter') account.send(email.value); });
    el.querySelector('[data-acc=out]').addEventListener('click', () => account.signOut());
    // Заявка на рекламу: нужны имя и контакт (почта, Telegram или ВКонтакте), телефон — по желанию; ушла — поля чистятся.
    const ad = (k) => el.querySelector(`[data-ad=${k}]`);
    ad('send').addEventListener('click', () => {
      const v = Object.fromEntries(['who', 'contact', 'phone', 'what'].map((k) => [k, ad(k).value.trim()]));
      if (!v.who || !v.contact) { this.adStatus('Укажите компанию или имя и как с вами связаться.'); return; }
      if (!validContact(v.contact)) {
        this.adStatus('Для связи нужна почта, Telegram (@имя или t.me/имя) или ВКонтакте (vk.com/…).');
        return;
      }
      ad('send').disabled = true;
      this.adStatus('Отправляю…');
      adRequest(v).then(() => {
        for (const k of ['who', 'contact', 'phone', 'what']) ad(k).value = '';
        this.adStatus('Заявка отправлена — спасибо! Свяжемся с вами.');
        this.adSent = true;
        this.sync();
      }, (e) => {
        console.warn('[ads] заявка не ушла:', e);
        this.adStatus('Не получилось отправить — проверьте интернет и попробуйте ещё раз.');
      }).finally(() => { ad('send').disabled = false; });
    });
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
      quality: s.quality,
      nav: s.nav ?? '',
      fullscreen: s.fullscreen ? 'вкл' : 'выкл',
      volume: s.sound ? `${Math.round(this.volume.get('master') * 100)}%` : 'звук выкл',
      net: { online: `${s.city ? 'Ездите один' : 'Вы с друзьями по ссылке'}, в игре ${s.players}.`, connecting: 'Подключение…', offline: 'Нет связи с сервером.', solo: 'Ездите один — позовите друзей ссылкой.' }[s.netStatus],
      netShort: { online: s.city ? `${s.players} в игре` : `с друзьями · ${s.players}`, connecting: 'подключение…', offline: 'нет связи', solo: 'один' }[s.netStatus],
      name: s.name,
      invite: s.copied ? 'ссылка скопирована' : 'скопировать ссылку',
      room: s.room,
      race: s.shared ? 'со всеми в комнате' : '',
      tricks: s.hopper ? 'kickflip, backflip, бочка' : 'нужен «Кузнечик»',
      money: s.money,
      account: { in: this.account?.state().email, sent: 'письмо отправлено' }[this.account?.state().status] ?? 'войти по почте',
      nitro: s.nitro,
      debug: s.debug ? 'вкл' : 'выкл',
      lang: s.lang,
      ads: this.adSent ? 'заявка отправлена' : 'оставить заявку',
      taxi: s.taxi,
    };
    s.invite = s.online || s.city;
    s.volume = s.sound && this.volume.get('master') > 0;
    for (const b of this.el.querySelectorAll('[data-v]')) {
      b.textContent = v[b.dataset.v];
      b.classList.toggle('off', !['camera', 'night', 'nav', 'fps', 'quality', 'net', 'netShort', 'name', 'room', 'race', 'tricks', 'money', 'nitro', 'account', 'ads', 'taxi'].includes(b.dataset.v) && !s[b.dataset.v]);
    }
    this.el.querySelector('[data-show="room"]').hidden = s.city;
    for (const b of this.el.querySelectorAll('[data-q]')) b.classList.toggle('off', b.dataset.q !== s.qName);
    this.el.querySelector('[data-show="no-hopper"]').hidden = s.hopper;
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

  adStatus(text) { this.el.querySelector('[data-ad=text]').textContent = text; }

  // Показать страницу меню: 'main', 'net', 'name', 'account', 'settings', 'volume', 'radio', 'quality', 'tricks' или 'ads'.
  page(name) {
    // Уходим со страницы имени — сохранить введённое (change не всегда успевает, например по Esc).
    if (document.activeElement === this.nameIn) this.nameIn.blur();
    for (const p of this.el.querySelectorAll('.page')) p.hidden = p.dataset.page !== name;
    this.sync();
    if (name === 'name') this.nameIn.focus();
    if (name === 'account') this.account?.start();
    if (name === 'ads' && !this.adSent) this.adStatus('');
    if (name === 'radio') {
      this.wheel.show();
      this.wheel.wheel.focus({ preventScroll: true });
    }
  }

  // Esc в подменю — на страницу выше, а не закрыть меню. true — если было куда возвращаться.
  back() {
    const cur = this.el.querySelector('.page:not([hidden])')?.dataset.page;
    if (!this.isOpen || !cur || cur === 'main') return false;
    this.page(PARENT[cur] ?? 'main');
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

// Меню-пауза: действия (гонка, на дорогу, гараж) и все настройки. Открывается Esc или ☰.
// Горячие клавиши работают и без меню — main.js после каждого действия зовёт sync(),
// чтобы переключатели в меню показывали текущее состояние.

const CAMERAS = ['сзади', 'из салона', 'сверху'];

export class Menu {
  // actions — общие действия main.js; state() — { sound, radio, traffic, camera, bigMap, fullscreen }.
  constructor({ actions, state }) {
    this.actions = actions;
    this.state = state;
    this.isOpen = false;

    const el = (this.el = document.createElement('div'));
    el.id = 'menu';
    const fs = document.fullscreenEnabled; // iPhone не умеет
    el.innerHTML = `<div class="box">
      <h2>Пауза</h2>
      <button data-act="menu" class="go">Продолжить <kbd>Esc</kbd></button>
      <button data-act="race">Новая гонка <kbd>N</kbd></button>
      <button data-act="respawn">На дорогу <kbd>R</kbd></button>
      <button data-act="garage">Гараж — выбор машины <kbd>G</kbd></button>
      <h3>Настройки</h3>
      <button data-act="sound">Звук <b data-v="sound"></b><kbd>V</kbd></button>
      <button data-act="radio">Радио <b data-v="radio"></b><kbd>B</kbd></button>
      <button data-act="traffic">Трафик <b data-v="traffic"></b><kbd>T</kbd></button>
      <button data-act="camera">Камера <b data-v="camera"></b><kbd>C</kbd></button>
      <button data-act="map">Миникарта <b data-v="bigMap"></b><kbd>M</kbd></button>
      ${fs ? '<button data-act="fullscreen">Во весь экран <b data-v="fullscreen"></b><kbd>F</kbd></button>' : ''}
      <div class="keys">
        <kbd>W A S D</kbd> / стрелки — ехать · <kbd>Пробел</kbd> ручник · <kbd>Shift</kbd> нитро<br>
        мышь — повернуть камеру
      </div>
    </div>`;
    document.body.append(el);
    for (const b of el.querySelectorAll('[data-act]')) {
      b.addEventListener('click', () => this.actions[b.dataset.act]());
    }
    // Клик мимо панели — продолжить.
    el.addEventListener('pointerdown', (e) => { if (e.target === el) this.actions.menu(); });
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
      bigMap: s.bigMap ? 'крупная' : 'обычная',
      fullscreen: s.fullscreen ? 'вкл' : 'выкл',
    };
    for (const b of this.el.querySelectorAll('[data-v]')) {
      b.textContent = v[b.dataset.v];
      b.classList.toggle('off', b.dataset.v !== 'camera' && b.dataset.v !== 'bigMap' && !s[b.dataset.v]);
    }
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
    this.el.classList.remove('open');
    document.body.classList.remove('in-menu');
  }

  toggle() { this.isOpen ? this.close() : this.open(); }
}

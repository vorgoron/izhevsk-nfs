// Сенсорное управление: слева — руль (тянуть влево/вправо от точки касания),
// справа — педали, сверху — меню (все настройки там, menu.js), «на дорогу» и полный экран. Включается только на сенсорных устройствах.

export const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

const STEER_PX = 70; // на сколько пикселей тянуть до полного поворота руля

export function setupTouch({ keys, analog, actions, press }) {
  const ctl = { nitro: false, update() {} };
  if (!isTouch) return ctl;
  document.body.classList.add('touch');

  // iOS: без этого двойной тап и щипок масштабируют страницу, долгое нажатие — меню.
  for (const ev of ['gesturestart', 'dblclick', 'contextmenu']) document.addEventListener(ev, (e) => e.preventDefault());

  const ui = document.createElement('div');
  ui.id = 'touch';
  ui.innerHTML = `
    <div id="steer-zone"><div id="steer-base"><div id="steer-knob"></div></div><span>руль</span></div>
    <div id="pedals">
      <button data-key="Space" class="pedal small">ручник</button>
      <button id="nitro-btn" class="pedal small nitro">нитро</button>
      <button data-key="KeyS" class="pedal brake">тормоз</button>
      <button data-key="KeyW" class="pedal gas">газ</button>
    </div>
    <div id="tbar">
      <button data-act="respawn" title="На дорогу">↺</button>
      <button data-act="fullscreen" title="Во весь экран">⛶</button>
      <button data-act="menu" title="Меню">☰</button>
    </div>`;
  document.body.append(ui);
  if (!document.fullscreenEnabled) ui.querySelector('[data-act=fullscreen]').remove(); // iPhone не умеет

  // Педали: держим, пока палец на кнопке. Каждая кнопка ловит свой палец — мультитач работает.
  for (const b of ui.querySelectorAll('[data-key]')) {
    const code = b.dataset.key;
    const up = () => { keys.delete(code); b.classList.remove('on'); };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      keys.add(code);
      press(code); // набор для трюков: ручник, ручник, газ
      b.classList.add('on');
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, up);
  }

  // Нитро — переключатель, а не педаль: одним пальцем газ и нитро сразу не нажать. Касание взводит
  // нитро, и оно горит, пока держишь газ; гаснет от второго касания, тормоза или пустого баллона.
  const nitroBtn = ui.querySelector('#nitro-btn');
  const arm = (on) => { ctl.nitro = on; nitroBtn.classList.toggle('on', on); };
  nitroBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); arm(!ctl.nitro); });
  ui.querySelector('[data-key=KeyS]').addEventListener('pointerdown', () => arm(false));
  ctl.update = (car) => { if (ctl.nitro && car.nitroLocked) arm(false); };

  for (const b of ui.querySelectorAll('[data-act]')) {
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      actions[b.dataset.act]();
    });
  }

  // Руль: точка касания — центр, смещение пальца по горизонтали — угол.
  const zone = ui.querySelector('#steer-zone'), base = ui.querySelector('#steer-base'), knob = ui.querySelector('#steer-knob');
  let pid = null, x0 = 0;
  zone.addEventListener('pointerdown', (e) => {
    if (pid !== null) return;
    e.preventDefault();
    pid = e.pointerId;
    zone.setPointerCapture(pid);
    x0 = e.clientX;
    const r = zone.getBoundingClientRect();
    base.style.left = `${e.clientX - r.left}px`;
    base.style.top = `${e.clientY - r.top}px`;
    zone.classList.add('on');
    analog.steer = 0;
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pid) return;
    const s = Math.max(-1, Math.min(1, (e.clientX - x0) / STEER_PX));
    analog.steer = s;
    knob.style.transform = `translate(${s * STEER_PX * 0.6}px, 0)`;
  });
  const release = (e) => {
    if (e.pointerId !== pid) return;
    pid = null;
    analog.steer = null;
    knob.style.transform = '';
    zone.classList.remove('on');
  };
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) zone.addEventListener(ev, release);
  return ctl;
}

export function toggleFullscreen() {
  if (document.fullscreenElement) return document.exitFullscreen();
  document.documentElement.requestFullscreen?.().then(() => screen.orientation?.lock?.('landscape').catch(() => {}), () => {});
}

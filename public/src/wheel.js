// Барабан выбора станции радио, как выбор месяца на iPhone: прокрутка прилипает к строке
// (scroll-snap), строки по краям поворачиваются, как на цилиндре. Станция включается, когда
// прокрутка встала: пока палец крутит, потоки не дёргаются. Один и тот же барабан — в меню
// и на игровом экране (по нажатию на надпись радио).

export class Wheel {
  // names — станции; первой строкой барабан сам добавляет «Выкл» (номер -1).
  // get() — текущий номер, select(i) — выбрали другой. row — высота строки, rows — сколько видно (нечётное).
  constructor(names, { get, select, row = 40, rows = 5 }) {
    this.get = get;
    this.row = row;
    this.max = names.length - 1;
    this.timer = 0;
    const box = (this.el = document.createElement('div'));
    box.className = 'wheel-box';
    box.style.setProperty('--row', `${row}px`);
    box.style.setProperty('--pad', `${row * (rows - 1) / 2}px`);
    box.innerHTML = `<div class="wheel" tabindex="0">${['Выкл', ...names].map((n, i) => `<div data-i="${i - 1}">${n}</div>`).join('')}</div>`;
    const w = (this.wheel = box.firstChild);
    w.addEventListener('scroll', () => {
      this.#draw();
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = 0;
        const i = this.#at();
        if (i !== this.get()) select(i);
      }, 150);
    }, { passive: true });
    for (const r of w.children) r.addEventListener('click', () => this.#to(+r.dataset.i, true));
    w.addEventListener('keydown', (e) => {
      const d = { ArrowUp: -1, ArrowDown: 1 }[e.key];
      if (d) this.#to(Math.max(-1, Math.min(this.max, this.#at() + d)), true);
    });
  }

  // Барабан только что показали: прокрутка у скрытого элемента не ставится, поэтому — здесь.
  show() { this.#to(this.get(), false); }

  // Станцию сменили не барабаном (клавиша B) — докрутить к ней, если барабан сейчас не крутят.
  sync() {
    if (!this.wheel.offsetParent || this.timer) return;
    if (this.#at() !== this.get()) this.#to(this.get(), true);
    else this.#draw();
  }

  #at() { return Math.round(this.wheel.scrollTop / this.row) - 1; }

  #to(i, smooth) {
    this.wheel.scrollTo({ top: (i + 1) * this.row, behavior: smooth ? 'smooth' : 'instant' });
    this.#draw();
  }

  #draw() {
    const at = this.wheel.scrollTop / this.row - 1;
    const cur = this.get();
    for (const r of this.wheel.children) {
      const d = Math.max(-3, Math.min(3, +r.dataset.i - at)); // в строках от середины
      r.style.transform = `rotateX(${-d * 22}deg)`;
      r.style.opacity = 1 - Math.abs(d) * 0.28;
      r.classList.toggle('on', +r.dataset.i === cur);
    }
  }
}

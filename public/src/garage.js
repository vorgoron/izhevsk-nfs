// Гараж: выбор машины, цвета и деталей (у машин с options). Панель справа, камера облетает машину (main.js).
import { MODELS, DEFAULT_MODEL, pickOptions } from './vehicles.js';

const STORE = 'vehicle';
const MAX = { kmh: 190, accel: 1, grip: 1.06 };

export function loadChoice() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE));
    if (v && MODELS[v.model]) {
      return { model: v.model, color: v.color || MODELS[v.model].colors[0], options: pickOptions(MODELS[v.model], v.options || {}), saved: true };
    }
  } catch {}
  return { model: DEFAULT_MODEL, color: MODELS[DEFAULT_MODEL].colors[0], options: pickOptions(MODELS[DEFAULT_MODEL]), saved: false };
}

function save(choice) {
  try { localStorage.setItem(STORE, JSON.stringify({ model: choice.model, color: choice.color, options: choice.options })); } catch {}
}

export class Garage {
  // onChange(model, color, options) — сразу при выборе (меняем машину на глазах); onClose(changed).
  constructor(choice, { onChange, onClose }) {
    this.choice = { ...choice };
    this.onChange = onChange;
    this.onClose = onClose;
    this.isOpen = false;
    this.keys = Object.keys(MODELS);

    const el = (this.el = document.createElement('div'));
    el.id = 'garage';
    el.innerHTML = `<h2>Гараж <span>ижевский автопром</span></h2><div class="list"></div>
      <div class="colors"></div><div class="opts"></div><button class="go">Поехать <kbd>Enter</kbd></button>
      <div class="hint">↑↓ машина · ←→ цвет · <kbd>G</kbd> гараж</div>`;
    document.body.append(el);
    const list = el.querySelector('.list');
    for (const key of this.keys) {
      const m = MODELS[key];
      const card = document.createElement('button');
      card.className = 'card';
      card.dataset.key = key;
      const bar = (label, v) => `<div class="stat"><span>${label}</span><i style="--v:${Math.round(v * 100)}%"></i></div>`;
      card.innerHTML = `<b>${m.name}</b><small>${m.years}</small><p>${m.about}</p>${m.credit ? `<p class="credit">${m.credit}</p>` : ''}
        ${bar('скорость', m.stats.kmh / MAX.kmh)}${bar('разгон', m.stats.accel / MAX.accel)}${bar('сцепление', m.stats.grip / MAX.grip)}`;
      card.addEventListener('click', () => this.#pick(key, MODELS[key].colors[0]));
      list.append(card);
    }
    el.querySelector('.go').addEventListener('click', () => this.close());
    addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      const i = this.keys.indexOf(this.choice.model), colors = MODELS[this.choice.model].colors;
      const ci = Math.max(0, colors.indexOf(this.choice.color));
      if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
        const k = this.keys[(i + (e.code === 'ArrowDown' ? 1 : -1) + this.keys.length) % this.keys.length];
        this.#pick(k, MODELS[k].colors[0]);
      } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        this.#pick(this.choice.model, colors[(ci + (e.code === 'ArrowRight' ? 1 : -1) + colors.length) % colors.length]);
      } else if (e.code === 'Enter' || e.code === 'Escape') {
        this.close();
      } else return;
      e.preventDefault();
    });
    this.#render();
  }

  // options — только для той же машины; у другой — детали по умолчанию.
  #pick(model, color, options = model === this.choice.model ? this.choice.options : {}) {
    options = pickOptions(MODELS[model], options);
    const same = model === this.choice.model && color === this.choice.color && JSON.stringify(options) === JSON.stringify(this.choice.options);
    if (same) return;
    this.choice = { model, color, options };
    this.changed = true;
    this.#render();
    this.onChange(model, color, options);
  }

  #render() {
    for (const c of this.el.querySelectorAll('.card')) {
      const on = c.dataset.key === this.choice.model;
      c.classList.toggle('on', on);
      if (on && this.isOpen) c.scrollIntoView({ block: 'nearest' });
    }
    const box = this.el.querySelector('.colors');
    box.innerHTML = '';
    for (const color of MODELS[this.choice.model].colors) {
      const b = document.createElement('button');
      b.style.background = color;
      b.classList.toggle('on', color === this.choice.color);
      b.addEventListener('click', () => this.#pick(this.choice.model, color));
      box.append(b);
    }
    const opts = this.el.querySelector('.opts');
    opts.innerHTML = '';
    const spec = MODELS[this.choice.model];
    for (const slot of (spec.mesh && spec.options) || []) { // модель не загрузилась — процедурная, деталей нет
      const row = document.createElement('div');
      row.className = 'opt';
      row.innerHTML = `<span>${slot.name}</span>`;
      for (const [v, label] of slot.variants) {
        const b = document.createElement('button');
        b.textContent = label;
        b.classList.toggle('on', this.choice.options[slot.key] === v);
        b.addEventListener('click', () => this.#pick(this.choice.model, this.choice.color, { ...this.choice.options, [slot.key]: v }));
        row.append(b);
      }
      opts.append(row);
    }
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.changed = false;
    this.el.classList.add('open');
    document.body.classList.add('in-garage');
    this.#render();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.remove('open');
    document.body.classList.remove('in-garage');
    save(this.choice);
    this.onClose(this.changed);
  }

  toggle() { this.isOpen ? this.close() : this.open(); }
}

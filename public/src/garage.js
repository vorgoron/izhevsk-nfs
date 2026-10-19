// Гараж: выбор машины, цвета и деталей (у машин с options). Панель справа, камера облетает машину (main.js).
// Машины и цвета бесплатные, детали — за деньги (цена — третье число варианта в vehicles.js). Выбранную
// деталь сразу видно на машине; платят при выезде из гаража, а не хватает денег — детали возвращаются.
import { MODELS, DEFAULT_MODEL, pickOptions } from './vehicles.js';
import { formatMoney } from './money.js';

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

// Ключ купленной детали в кошельке.
export const optionKey = (model, slot, v) => `${model}:${slot}:${v}`;

export class Garage {
  // onChange(model, color, options) — сразу при выборе (меняем машину на глазах); onClose(changed).
  // wallet — кошелёк (money.js): купленные детали и оплата.
  constructor(choice, { onChange, onClose, wallet }) {
    this.choice = { ...choice };
    this.wallet = wallet;
    this.onChange = onChange;
    this.onClose = onClose;
    this.isOpen = false;
    this.keys = Object.keys(MODELS);

    const el = (this.el = document.createElement('div'));
    el.id = 'garage';
    el.innerHTML = `<h2>Гараж <b class="money"></b><span>ижевский автопром</span></h2><div class="list"></div>
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
    this.goLabel = el.querySelector('.go').innerHTML;
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
      for (const [v, label, price] of slot.variants) {
        const b = document.createElement('button');
        const own = !price || this.wallet?.owns(optionKey(this.choice.model, slot.key, v));
        b.innerHTML = own ? label : `${label} <small>${formatMoney(price)}</small>`;
        b.classList.toggle('on', this.choice.options[slot.key] === v);
        b.addEventListener('click', () => this.#pick(this.choice.model, this.choice.color, { ...this.choice.options, [slot.key]: v }));
        row.append(b);
      }
      opts.append(row);
    }
    if (this.wallet) this.el.querySelector('.money').textContent = formatMoney(this.wallet.balance);
    // Кнопка выезда: есть некупленные детали — с ценой.
    const due = this.#due();
    const go = this.el.querySelector('.go');
    go.innerHTML = !due.sum ? this.goLabel : this.wallet.can(due.sum)
      ? `Купить за ${formatMoney(due.sum)} и поехать` : `Не хватает ${formatMoney(due.sum - Math.max(0, this.wallet.balance))} — снять детали`;
  }

  // Выбранные, но не купленные детали: { sum, keys }.
  #due() {
    const out = { sum: 0, keys: [] };
    if (!this.wallet) return out;
    const spec = MODELS[this.choice.model];
    for (const slot of (spec.mesh && spec.options) || []) {
      const [v, , price] = slot.variants.find(([x]) => x === this.choice.options[slot.key]) ?? [];
      const key = optionKey(this.choice.model, slot.key, v);
      if (price && !this.wallet.owns(key)) { out.sum += price; out.keys.push([key, price]); }
    }
    return out;
  }

  // При выезде: оплатить выбранные детали; не хватает денег — вернуть на них купленные (или штатные).
  #settle() {
    const due = this.#due();
    if (!due.sum) return;
    if (this.wallet.can(due.sum)) {
      for (const [key, price] of due.keys) this.wallet.buy(key, price, 'детали в гараже');
      return;
    }
    const spec = MODELS[this.choice.model], options = { ...this.choice.options };
    for (const slot of spec.options) {
      if (due.keys.some(([k]) => k === optionKey(this.choice.model, slot.key, options[slot.key]))) {
        options[slot.key] = this.paid?.model === this.choice.model ? this.paid.options[slot.key] : slot.variants[0][0];
      }
    }
    this.#pick(this.choice.model, this.choice.color, options);
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.changed = false;
    this.paid = { model: this.choice.model, options: { ...this.choice.options } }; // с чем заехали — всё оплачено
    this.el.classList.add('open');
    document.body.classList.add('in-garage');
    this.#render();
  }

  close() {
    if (!this.isOpen) return;
    this.#settle();
    this.isOpen = false;
    this.el.classList.remove('open');
    document.body.classList.remove('in-garage');
    save(this.choice);
    this.onClose(this.changed);
  }

  toggle() { this.isOpen ? this.close() : this.open(); }
}

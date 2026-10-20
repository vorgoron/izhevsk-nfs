// Гараж — он же автосалон: машины, цвет, детали (у машин с options) и улучшения (shop.js). Панель справа, камера
// облетает машину (main.js). В начале есть только базовая машина; остальные можно выбрать и посмотреть на ходу,
// цвета бесплатные, детали — за деньги (цена — третье число варианта в vehicles.js). Машину и детали покупают
// при выезде из гаража, а не хватает денег — возвращается то, на чём заехали. Улучшения покупаются сразу,
// кнопкой, и только для своей машины.
import { MODELS, DEFAULT_MODEL, pickOptions } from './vehicles.js';
import { formatMoney } from './money.js';
import { UPGRADES, carKey, carPrice, ownsCar, upKey, upLevel } from './shop.js';

const STORE = 'vehicle';
const MAX = { kmh: 190, accel: 1, grip: 1.06 };

export function loadChoice() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE));
    if (v && MODELS[v.model]) {
      return { model: v.model, color: v.color || MODELS[v.model].colors[0], options: pickOptions(MODELS[v.model], v.options || {}), saved: true };
    }
  } catch {}
  return defaultChoice();
}

// Стартовая машина со штатными деталями.
export const defaultChoice = () => ({ model: DEFAULT_MODEL, color: MODELS[DEFAULT_MODEL].colors[0], options: pickOptions(MODELS[DEFAULT_MODEL]), saved: false });

function save(choice) {
  try { localStorage.setItem(STORE, JSON.stringify({ model: choice.model, color: choice.color, options: choice.options })); } catch {}
}

// Ключ купленной детали в кошельке.
export const optionKey = (model, slot, v) => `${model}:${slot}:${v}`;

export class Garage {
  // onChange(model, color, options) — сразу при выборе (меняем машину на глазах); onClose(changed);
  // onUpgrade() — куплено улучшение (пересчитать характеристики). wallet — кошелёк (money.js): покупки и оплата.
  constructor(choice, { onChange, onClose, onUpgrade, wallet }) {
    this.choice = { ...choice };
    this.wallet = wallet;
    this.onChange = onChange;
    this.onClose = onClose;
    this.onUpgrade = onUpgrade;
    this.isOpen = false;
    this.keys = Object.keys(MODELS);

    const el = (this.el = document.createElement('div'));
    el.id = 'garage';
    el.innerHTML = `<h2>Автосалон <b class="money"></b><span>ижевский автопром · улучшения · нитро · «Кузнечик»</span></h2><div class="list"></div>
      <div class="colors"></div><div class="opts"></div><div class="ups"></div><button class="go">Поехать <kbd>Enter</kbd></button>
      <div class="hint">↑↓ машина · ←→ цвет · <kbd>G</kbd> гараж</div>`;
    document.body.append(el);
    const list = el.querySelector('.list');
    for (const key of this.keys) {
      const m = MODELS[key];
      const card = document.createElement('button');
      card.className = 'card';
      card.dataset.key = key;
      const bar = (label, v) => `<div class="stat"><span>${label}</span><i style="--v:${Math.round(v * 100)}%"></i></div>`;
      card.innerHTML = `<em class="price"></em><b>${m.name}</b><small>${m.years}</small><p>${m.about}</p>${m.credit ? `<p class="credit">${m.credit}</p>` : ''}
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
      const k = c.dataset.key, own = !this.wallet || ownsCar(this.wallet, k);
      c.querySelector('.price').textContent = !carPrice(k) ? 'стартовая' : own ? 'своя' : formatMoney(carPrice(k));
      c.classList.toggle('own', own);
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
    this.#renderUps();
    if (this.wallet) this.el.querySelector('.money').textContent = formatMoney(this.wallet.balance);
    // Кнопка выезда: есть некупленные детали — с ценой.
    const due = this.#due();
    const go = this.el.querySelector('.go');
    go.innerHTML = !due.sum ? this.goLabel : this.wallet.can(due.sum)
      ? `Купить за ${formatMoney(due.sum)} и поехать` : `Не хватает ${formatMoney(due.sum - Math.max(0, this.wallet.balance))} — ${due.car ? 'вернуться на свою' : 'снять детали'}`;
  }

  // Улучшения: по строке на каждое — купленные уровни, следующий с ценой (кнопка — купить сразу), дальше — закрыты.
  #renderUps() {
    const box = this.el.querySelector('.ups');
    box.innerHTML = '';
    if (!this.wallet) return;
    const model = this.choice.model, own = ownsCar(this.wallet, model);
    const head = document.createElement('div');
    head.className = 'ups-head';
    head.textContent = own ? 'Улучшения — ставятся на эту машину' : 'Улучшения — после покупки машины';
    box.append(head);
    for (const up of UPGRADES) {
      const lv = upLevel(this.wallet, model, up.key);
      const row = document.createElement('div');
      row.className = 'opt';
      row.innerHTML = `<span>${up.name}</span>`;
      up.levels.forEach(([label, price, about], i) => {
        const b = document.createElement('button');
        b.title = about;
        if (i < lv) { b.textContent = label; b.classList.add('on'); }
        else {
          b.innerHTML = `${label} <small>${formatMoney(price)}</small>`;
          const next = i === lv && own;
          b.disabled = !next;
          b.classList.toggle('poor', next && !this.wallet.can(price));
          b.addEventListener('click', () => {
            if (!this.wallet.buy(upKey(model, up.key, i + 1), price, `${up.name}: ${label}`)) return;
            this.#render();
            this.onUpgrade?.();
          });
        }
        row.append(b);
      });
      const note = document.createElement('small');
      note.className = 'about';
      note.textContent = lv === up.levels.length ? up.levels[lv - 1][2] : `${lv ? 'дальше: ' : ''}${up.levels[lv][2]}`;
      row.append(note);
      box.append(row);
    }
  }

  // Выбранные, но не купленные машина и детали: { sum, keys, car }.
  #due() {
    const out = { sum: 0, keys: [], car: false };
    if (!this.wallet) return out;
    const spec = MODELS[this.choice.model];
    if (!ownsCar(this.wallet, this.choice.model)) {
      out.car = true;
      out.sum += carPrice(this.choice.model);
      out.keys.push([carKey(this.choice.model), carPrice(this.choice.model)]);
    }
    for (const slot of (spec.mesh && spec.options) || []) {
      const [v, , price] = slot.variants.find(([x]) => x === this.choice.options[slot.key]) ?? [];
      const key = optionKey(this.choice.model, slot.key, v);
      if (price && !this.wallet.owns(key)) { out.sum += price; out.keys.push([key, price]); }
    }
    return out;
  }

  // При выезде: оплатить выбранные машину и детали; не хватает денег — вернуть на детали купленные (или штатные),
  // а чужую машину — на ту, на которой заехали.
  #settle() {
    const due = this.#due();
    if (!due.sum) return;
    if (this.wallet.can(due.sum)) {
      for (const [key, price] of due.keys) this.wallet.buy(key, price, key === carKey(this.choice.model) ? MODELS[this.choice.model].name : 'детали в гараже');
      return;
    }
    if (due.car) return this.#pick(this.paid.model, this.paid.color, this.paid.options);
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
    this.paid = { model: this.choice.model, color: this.choice.color, options: { ...this.choice.options } }; // с чем заехали — всё оплачено
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

  // Выбор извне (из аккаунта, account.js): запомнить и показать; машину на сцене меняет вызывающий.
  set({ model, color, options }) {
    if (!MODELS[model]) return false;
    this.choice = { model, color: color || MODELS[model].colors[0], options: pickOptions(MODELS[model], options || {}) };
    save(this.choice);
    this.#render();
    return true;
  }
}

// Гараж — он же автосалон: машины лентой внизу, справа — панель выбранной машины: характеристики, вкладки «Вид»
// (цвет, детали у машин с options) и «Тюнинг» (улучшения, shop.js). Камера облетает машину в свободной части экрана
// (main.js, frame()). В начале есть только базовая машина; любую другую можно выбрать и посмотреть, купить —
// кнопкой «Купить», не купил и уехал — возвращаешься на ту, на которой заехал. Цвета бесплатные, детали — за
// деньги (цена — третье число варианта в vehicles.js), их оплачивают при выезде, а не хватает — детали снимаются.
// Улучшения покупаются сразу, кнопкой, и только для своей машины.
import { MODELS, DEFAULT_MODEL, pickOptions } from './vehicles.js';
import { formatMoney } from './money.js';
import { UPGRADES, carKey, carPrice, ownsCar, upKey, upLevel, tuned } from './shop.js';

const STORE = 'vehicle';
const MAX = { kmh: 220, accel: 1.21, grip: 1.17 }; // шкалы характеристик — с запасом на улучшения Весты

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
    this.tab = 'look';
    this.keys = Object.keys(MODELS);

    const el = (this.el = document.createElement('div'));
    el.id = 'garage';
    el.innerHTML = `<div class="side">
        <h2>Автосалон <b class="money"></b></h2>
        <div class="info"></div>
        <div class="tabs"><button data-tab="look">Вид</button><button data-tab="tune">Тюнинг</button></div>
        <div class="pane" data-pane="look"><div class="colors"></div><div class="opts"></div></div>
        <div class="pane" data-pane="tune"><div class="ups"></div></div>
        <div class="actions"><button class="go"></button><button class="back">К своей</button></div>
        <div class="hint">←→ машина · ↑↓ цвет · <kbd>Enter</kbd> поехать · <kbd>G</kbd> выйти</div>
      </div>
      <div class="strip"></div>`;
    document.body.append(el);
    const strip = el.querySelector('.strip');
    for (const key of this.keys) {
      const m = MODELS[key];
      const card = document.createElement('button');
      card.className = 'card';
      card.dataset.key = key;
      card.innerHTML = `<i class="dot" style="background:${m.colors[0]}"></i><b>${m.name}</b><small>${m.years}</small><em class="price"></em>`;
      card.addEventListener('click', () => this.#pick(key, MODELS[key].colors[0]));
      strip.append(card);
    }
    for (const b of el.querySelectorAll('[data-tab]')) b.addEventListener('click', () => { this.tab = b.dataset.tab; this.#render(); });
    el.querySelector('.go').addEventListener('click', () => this.#go());
    el.querySelector('.back').addEventListener('click', () => this.#pick(this.paid.model, this.paid.color, this.paid.options));
    addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      const i = this.keys.indexOf(this.choice.model), colors = MODELS[this.choice.model].colors;
      const ci = Math.max(0, colors.indexOf(this.choice.color));
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        const k = this.keys[(i + (e.code === 'ArrowRight' ? 1 : -1) + this.keys.length) % this.keys.length];
        this.#pick(k, MODELS[k].colors[0]);
      } else if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
        this.#pick(this.choice.model, colors[(ci + (e.code === 'ArrowDown' ? 1 : -1) + colors.length) % colors.length]);
      } else if (e.code === 'Enter') {
        this.#go();
      } else if (e.code === 'Escape') {
        this.close();
      } else return;
      e.preventDefault();
    });
    this.#render();
  }

  // Свободная часть экрана под машину (для камеры, main.js): ширина панели справа и высота ленты снизу, px.
  frame() {
    return { right: this.el.querySelector('.side').offsetWidth, bottom: this.el.querySelector('.strip').offsetHeight };
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

  // Главная кнопка: чужая машина — купить (вместе с выбранными деталями), своя — поехать.
  #go() {
    const due = this.#due();
    if (!due.car) return this.close();
    if (!this.wallet.can(due.sum)) return;
    for (const [key, price] of due.keys) this.wallet.buy(key, price, key === carKey(this.choice.model) ? MODELS[this.choice.model].name : 'детали в гараже');
    this.paid = { model: this.choice.model, color: this.choice.color, options: { ...this.choice.options } };
    this.tab = 'tune'; // купил машину — сразу к улучшениям
    this.#render();
    this.onUpgrade?.();
  }

  #render() {
    const model = this.choice.model, spec = MODELS[model], own = !this.wallet || ownsCar(this.wallet, model);
    for (const c of this.el.querySelectorAll('.card')) {
      const on = c.dataset.key === model;
      c.classList.toggle('on', on);
      if (on && this.isOpen) c.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
      const k = c.dataset.key, mine = !this.wallet || ownsCar(this.wallet, k);
      c.querySelector('.price').textContent = !carPrice(k) ? 'стартовая' : mine ? 'своя' : formatMoney(carPrice(k));
      c.classList.toggle('own', mine);
    }
    // Характеристики: штатные — жёлтым, прибавка от улучшений — зелёным.
    const t = this.wallet ? tuned(this.wallet, model) : spec.stats;
    const bar = (label, base, up, max) => `<div class="stat"><span>${label}</span><i style="--v:${Math.round(base / max * 100)}%;--u:${Math.round(up / max * 100)}%"></i></div>`;
    this.el.querySelector('.info').innerHTML = `<b>${spec.name}</b> <small>${spec.years}</small>
      <em class="${own ? 'own' : ''}">${!carPrice(model) ? 'стартовая' : own ? 'своя' : formatMoney(carPrice(model))}</em>
      <p>${spec.about}</p>${spec.credit ? `<p class="credit">${spec.credit}</p>` : ''}
      ${bar('скорость', spec.stats.kmh, t.kmh, MAX.kmh)}${bar('разгон', spec.stats.accel, t.accel, MAX.accel)}${bar('сцепление', spec.stats.grip, t.grip, MAX.grip)}
      <div class="sys">${t.nitro ? '<span>нитро</span>' : ''}${t.hopper ? '<span>«Кузнечик»</span>' : ''}</div>`;
    for (const b of this.el.querySelectorAll('[data-tab]')) b.classList.toggle('on', b.dataset.tab === this.tab);
    for (const p of this.el.querySelectorAll('[data-pane]')) p.hidden = p.dataset.pane !== this.tab;
    const box = this.el.querySelector('.colors');
    box.innerHTML = '';
    for (const color of spec.colors) {
      const b = document.createElement('button');
      b.style.background = color;
      b.classList.toggle('on', color === this.choice.color);
      b.addEventListener('click', () => this.#pick(model, color));
      box.append(b);
    }
    const opts = this.el.querySelector('.opts');
    opts.innerHTML = '';
    for (const slot of (spec.mesh && spec.options) || []) { // модель не загрузилась — процедурная, деталей нет
      const row = document.createElement('div');
      row.className = 'opt';
      row.innerHTML = `<span>${slot.name}</span>`;
      for (const [v, label, price] of slot.variants) {
        const b = document.createElement('button');
        const mine = !price || this.wallet?.owns(optionKey(model, slot.key, v));
        b.innerHTML = mine ? label : `${label} <small>${formatMoney(price)}</small>`;
        b.classList.toggle('on', this.choice.options[slot.key] === v);
        b.addEventListener('click', () => this.#pick(model, this.choice.color, { ...this.choice.options, [slot.key]: v }));
        row.append(b);
      }
      opts.append(row);
    }
    this.#renderUps();
    if (this.wallet) this.el.querySelector('.money').textContent = formatMoney(this.wallet.balance);
    // Кнопки: чужая машина — «Купить» и «К своей», своя — «Поехать» (есть некупленные детали — с ценой).
    const due = this.#due(), poor = due.sum - Math.max(0, this.wallet?.balance ?? 0);
    const go = this.el.querySelector('.go');
    go.innerHTML = due.car ? (poor > 0 ? `Не хватает ${formatMoney(poor)}` : `Купить за ${formatMoney(due.sum)}`)
      : !due.sum ? 'Поехать' : poor > 0 ? `Не хватает ${formatMoney(poor)} — снять детали` : `Детали за ${formatMoney(due.sum)} — поехать`;
    go.classList.toggle('poor', due.car && poor > 0);
    this.el.querySelector('.back').hidden = !due.car;
  }

  // Улучшения: по строке на каждое — купленные уровни, следующий с ценой (кнопка — купить сразу), дальше — закрыты.
  #renderUps() {
    const box = this.el.querySelector('.ups');
    box.innerHTML = '';
    if (!this.wallet) return;
    const model = this.choice.model, own = ownsCar(this.wallet, model);
    if (!own) {
      const head = document.createElement('div');
      head.className = 'ups-head';
      head.textContent = 'Улучшения ставятся на свою машину — сначала купите её';
      box.append(head);
    }
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

  // При выезде: не купленная машина — вернуть ту, на которой заехали; детали — оплатить, а не хватает денег —
  // вернуть на них купленные (или штатные).
  #settle() {
    const due = this.#due();
    if (!due.sum) return;
    if (due.car) return this.#pick(this.paid.model, this.paid.color, this.paid.options);
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

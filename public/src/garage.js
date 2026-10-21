// Гараж — он же автосалон: машины лентой внизу, справа — панель выбранной машины: характеристики, вкладки «Вид»
// (цвет, детали у машин с options) и «Тюнинг» (улучшения, shop.js). Камера облетает машину в свободной части экрана
// (main.js, frame()). В начале есть только базовая машина; любую другую можно выбрать и посмотреть. Ничего не
// покупается сразу: машина, улучшения и платные детали (цена — третье число варианта в vehicles.js) кладутся в корзину,
// а оплачиваются вместе кнопкой «Купить» в корзине. Цвета бесплатные. Улучшения — для своей машины или той, что
// в корзине. Не купил и уехал — возвращаешься на ту машину, на которой заехал, с купленными деталями; корзина
// с машинами и улучшениями остаётся до следующего захода (пока открыта игра).
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
    this.cart = new Map(); // ключ в кошельке → { price, why, model } — машины и улучшения; детали — из выбора (#due)

    const el = (this.el = document.createElement('div'));
    el.id = 'garage';
    el.innerHTML = `<div class="side">
        <h2>Автосалон <b class="money"></b></h2>
        <div class="info"></div>
        <div class="tabs"><button data-tab="look">Вид</button><button data-tab="tune">Тюнинг</button></div>
        <div class="pane" data-pane="look"><div class="colors"></div><div class="opts"></div></div>
        <div class="pane" data-pane="tune"><div class="ups"></div></div>
        <div class="cart" hidden><div class="cart-head"></div><div class="cart-list"></div><button class="buy"></button></div>
        <div class="actions"><button class="go"></button><button class="back">К своей</button></div>
        <div class="hint">←→ машина · ↑↓ цвет · <kbd>Enter</kbd> в корзину / поехать · <kbd>G</kbd> выйти</div>
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
    el.querySelector('.buy').addEventListener('click', () => this.#buy());
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

  // Куплено или лежит в корзине — для предпросмотра улучшений и характеристик.
  #has(key) { return this.wallet.owns(key) || this.cart.has(key); }
  #view() { return { owns: (key) => this.#has(key) }; }

  // Главная кнопка: чужая машина — в корзину, своя — поехать.
  #go() {
    const model = this.choice.model;
    if (!this.wallet || ownsCar(this.wallet, model)) return this.close();
    if (this.cart.has(carKey(model))) return;
    this.cart.set(carKey(model), { price: carPrice(model), why: MODELS[model].name, model, car: true });
    this.#render();
  }

  // Убрать из корзины: машину — вместе с её улучшениями, уровень улучшения — вместе со следующими,
  // деталь — вернуть купленную (или штатную).
  #remove(key) {
    const item = this.cart.get(key);
    if (item) {
      for (const [k, it] of this.cart) {
        if (it.model === item.model && (item.car || (it.up === item.up && it.level >= item.level))) this.cart.delete(k);
      }
      return this.#render();
    }
    const slot = (MODELS[this.choice.model].options ?? []).find((o) => optionKey(this.choice.model, o.key, this.choice.options[o.key]) === key);
    if (slot) this.#pick(this.choice.model, this.choice.color, { ...this.choice.options, [slot.key]: this.#paidOption(slot) });
  }

  // Что было на этой детали до захода (если машина та же), иначе штатный вариант.
  #paidOption(slot) {
    return this.paid?.model === this.choice.model ? this.paid.options[slot.key] : slot.variants[0][0];
  }

  // Всё, что в корзине: машины и улучшения (кроме уже купленных — могли приехать из аккаунта) + выбранные детали.
  #items() {
    for (const k of this.cart.keys()) if (this.wallet.owns(k)) this.cart.delete(k);
    return [...[...this.cart].map(([key, it]) => ({ key, ...it })), ...this.#due().keys.filter(([key]) => key !== carKey(this.choice.model)).map(([key, price, why]) => ({ key, price, why, model: this.choice.model }))];
  }

  // «Купить» в корзине: всё сразу — или ничего, если не хватает денег. Машины лежат в корзине раньше своих улучшений.
  #buy() {
    const items = this.#items(), sum = items.reduce((a, it) => a + it.price, 0);
    if (!items.length || !this.wallet.can(sum)) return;
    for (const it of items) this.wallet.buy(it.key, it.price, it.why);
    this.cart.clear();
    if (ownsCar(this.wallet, this.choice.model)) {
      this.paid = { model: this.choice.model, color: this.choice.color, options: { ...this.choice.options } };
      if (items.some((it) => it.car && it.model === this.choice.model)) this.tab = 'tune'; // купил машину — к улучшениям
    }
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
      c.querySelector('.price').textContent = !carPrice(k) ? 'стартовая' : mine ? 'своя' : `${formatMoney(carPrice(k))}${this.cart.has(carKey(k)) ? ' · в корзине' : ''}`;
      c.classList.toggle('own', mine);
    }
    // Характеристики: штатные — жёлтым, прибавка от улучшений — зелёным, от улучшений в корзине — голубым.
    const t = this.wallet ? tuned(this.wallet, model) : spec.stats, c = this.wallet ? tuned(this.#view(), model) : t;
    const pct = (x, max) => `${Math.round(x / max * 100)}%`;
    const bar = (label, k, max) => `<div class="stat"><span>${label}</span><i style="--v:${pct(spec.stats[k], max)};--u:${pct(t[k], max)};--c:${pct(c[k], max)}"></i></div>`;
    this.el.querySelector('.info').innerHTML = `<b>${spec.name}</b> <small>${spec.years}</small>
      <em class="${own ? 'own' : ''}">${!carPrice(model) ? 'стартовая' : own ? 'своя' : `${this.cart.has(carKey(model)) ? 'в корзине · ' : ''}${formatMoney(carPrice(model))}`}</em>
      <p>${spec.about}</p>${spec.credit ? `<p class="credit">${spec.credit}</p>` : ''}
      ${bar('скорость', 'kmh', MAX.kmh)}${bar('разгон', 'accel', MAX.accel)}${bar('сцепление', 'grip', MAX.grip)}
      <div class="sys">${c.nitro ? `<span class="${t.nitro ? '' : 'in-cart'}">нитро</span>` : ''}${c.hopper ? `<span class="${t.hopper ? '' : 'in-cart'}">«Кузнечик»</span>` : ''}</div>`;
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
    this.#renderCart();
    if (this.wallet) this.el.querySelector('.money').textContent = formatMoney(this.wallet.balance);
    // Кнопки: чужая машина — «В корзину» и «К своей», своя — «Поехать».
    const foreign = !own, inCart = foreign && this.cart.has(carKey(model));
    const go = this.el.querySelector('.go');
    go.innerHTML = !foreign ? 'Поехать' : inCart ? 'В корзине' : `В корзину · ${formatMoney(carPrice(model))}`;
    go.classList.toggle('poor', inCart);
    this.el.querySelector('.back').hidden = !foreign;
  }

  // Корзина: строки с ценой и крестиком, итог и «Купить» (не хватает денег — сколько).
  #renderCart() {
    const box = this.el.querySelector('.cart'), items = this.wallet ? this.#items() : [];
    box.hidden = !items.length;
    if (!items.length) return;
    const sum = items.reduce((a, it) => a + it.price, 0), poor = sum - Math.max(0, this.wallet.balance);
    box.querySelector('.cart-head').textContent = `Корзина · ${items.length}`;
    const list = box.querySelector('.cart-list');
    list.innerHTML = '';
    for (const it of items) {
      const row = document.createElement('div');
      const label = it.model !== this.choice.model && !it.car ? `${it.why} · ${MODELS[it.model].name}` : it.why;
      row.innerHTML = `<span></span><b>${formatMoney(it.price)}</b><button title="Убрать из корзины">✕</button>`;
      row.querySelector('span').textContent = label;
      row.querySelector('button').addEventListener('click', () => this.#remove(it.key));
      list.append(row);
    }
    const buy = box.querySelector('.buy');
    buy.textContent = poor > 0 ? `Не хватает ${formatMoney(poor)}` : `Купить за ${formatMoney(sum)}`;
    buy.classList.toggle('poor', poor > 0);
  }

  // Улучшения: по строке на каждое — купленные уровни, уровни в корзине (нажал — убрать), следующий с ценой
  // (нажал — в корзину), дальше — закрыты.
  #renderUps() {
    const box = this.el.querySelector('.ups');
    box.innerHTML = '';
    if (!this.wallet) return;
    const model = this.choice.model, own = ownsCar(this.wallet, model) || this.cart.has(carKey(model));
    const sum = this.#items().reduce((a, it) => a + it.price, 0);
    if (!own) {
      const head = document.createElement('div');
      head.className = 'ups-head';
      head.textContent = 'Улучшения ставятся на свою машину — сначала положите её в корзину';
      box.append(head);
    }
    for (const up of UPGRADES) {
      const lv = upLevel(this.wallet, model, up.key), lc = upLevel(this.#view(), model, up.key);
      const row = document.createElement('div');
      row.className = 'opt';
      row.innerHTML = `<span>${up.name}</span>`;
      up.levels.forEach(([label, price, about], i) => {
        const b = document.createElement('button');
        b.title = about;
        const key = upKey(model, up.key, i + 1);
        if (i < lv) { b.textContent = label; b.classList.add('on'); }
        else if (i < lc) {
          b.innerHTML = `${label} <small>в корзине</small>`;
          b.classList.add('in-cart');
          b.addEventListener('click', () => this.#remove(key));
        } else {
          b.innerHTML = `${label} <small>${formatMoney(price)}</small>`;
          const next = i === lc && own;
          b.disabled = !next;
          b.classList.toggle('poor', next && !this.wallet.can(sum + price));
          b.addEventListener('click', () => {
            this.cart.set(key, { price, why: `${up.name}: ${label}`, model, up: up.key, level: i + 1 });
            this.#render();
          });
        }
        row.append(b);
      });
      const note = document.createElement('small');
      note.className = 'about';
      note.textContent = lc === up.levels.length ? up.levels[lc - 1][2] : `${lc ? 'дальше: ' : ''}${up.levels[lc][2]}`;
      row.append(note);
      box.append(row);
    }
  }

  // Выбранные, но не купленные машина и детали: { sum, keys: [ключ, цена, подпись], car }.
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
      const [v, label, price] = slot.variants.find(([x]) => x === this.choice.options[slot.key]) ?? [];
      const key = optionKey(this.choice.model, slot.key, v);
      if (price && !this.wallet.owns(key)) { out.sum += price; out.keys.push([key, price, `${slot.name}: ${label}`]); }
    }
    return out;
  }

  // При выезде: не купленная машина — вернуть ту, на которой заехали; не купленные детали — вернуть на них
  // купленные (или штатные). Корзина с машинами и улучшениями остаётся.
  #settle() {
    const due = this.#due();
    if (!due.sum) return;
    if (due.car) return this.#pick(this.paid.model, this.paid.color, this.paid.options);
    const options = { ...this.choice.options };
    for (const slot of MODELS[this.choice.model].options) {
      if (due.keys.some(([k]) => k === optionKey(this.choice.model, slot.key, options[slot.key]))) options[slot.key] = this.#paidOption(slot);
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

// Деньги: кошелёк игрока (localStorage), цены, начисления и списания с плашками на экране.
// Начисляют гонки, трюки и дрифт; списывают заправка, нитро, штрафы и детали в гараже.
// Штраф может увести в минус — это долг: пока он есть, ничего не купить.

export const START_MONEY = 20000;
export const PRICES = {
  tank: 3000,      // полный бак
  nitro: 1500,     // полный баллон нитро
  redLight: 1000,  // КоАП 12.12 ч.1 — проезд на запрещающий сигнал
  stopSign: 500,   // КоАП 12.16 ч.1 — проезд знака STOP без остановки
};
// Превышение, км/ч сверх предела → штраф по КоАП 12.9 (ч.2–5; до 20 км/ч не штрафуют).
export const SPEEDING = [[80, 5000], [60, 2000], [40, 1000], [20, 500]];
export const speedingFine = (over) => SPEEDING.find(([d]) => over > d)?.[1] ?? 0;

// Гонка: 6 000 ₽ за 1,5 км, длиннее — пропорционально длине (~4 000 ₽ в минуту гонки); побил свой рекорд — ещё 2 000 ₽.
// Общая гонка: за места — доли от награды за победу.
export function raceReward(length, { place = 1, record = false } = {}) {
  const base = Math.max(6000, Math.round(length / 1500 * 6000 / 500) * 500);
  const share = [1, 0.5, 0.3][place - 1] ?? 0.15;
  return Math.round(base * share / 100) * 100 + (record ? 2000 : 0);
}

const fmt = (n) => `${n < 0 ? '−' : ''}${Math.abs(Math.round(n)).toLocaleString('ru-RU')} ₽`;
export const formatMoney = fmt;

export class Wallet {
  // el — счёт на экране, log — столбик плашек «+500 ₽ kickflip» под ним.
  constructor(el, log) {
    this.el = el;
    this.log = log;
    this.balance = START_MONEY;
    this.owned = new Set();
    this.fresh = true; // кошелька ещё не было (первый запуск с деньгами)
    try {
      const v = localStorage.getItem('money');
      if (v !== null && Number.isFinite(+v)) this.balance = +v;
      const owned = localStorage.getItem('owned');
      this.fresh = owned === null;
      this.owned = new Set(JSON.parse(owned || '[]'));
    } catch {}
    this.onChange = () => {};
    this.#show();
  }

  get debt() { return this.balance < 0; }
  can(sum) { return this.balance >= sum; }

  earn(sum, why) {
    if (sum <= 0) return;
    this.balance += sum;
    this.#note(`+${fmt(sum)}`, why, 'plus');
    this.#save();
  }

  // Заплатить, если хватает. quiet — без плашки (мелкие списания на заправке, плашка — в конце).
  pay(sum, why, quiet = false) {
    if (sum <= 0) return true;
    if (!this.can(sum)) return false;
    this.balance -= sum;
    if (!quiet) this.#note(`−${fmt(sum)}`, why, 'minus');
    this.#save();
    return true;
  }

  // Штраф списывается всегда, хоть в минус.
  fine(sum, why) {
    this.balance -= sum;
    this.#note(`−${fmt(sum)}`, why, 'fine');
    this.#save();
  }

  // Плашка без денег (взял бонус на трассе).
  say(text, why) { this.#note(text, why, 'plus'); }

  // Итог серии мелких списаний (заправка) — одной плашкой.
  note(sum, why) { if (sum >= 1) this.#note(`−${fmt(sum)}`, why, 'minus'); }

  owns(key) { return this.owned.has(key); }
  // Отдать даром (детали, выбранные до появления денег).
  grant(keys) { for (const k of keys) this.owned.add(k); this.#save(); }
  buy(key, price, why) {
    if (this.owned.has(key)) return true;
    if (!this.pay(price, why)) return false;
    this.owned.add(key);
    this.#save();
    return true;
  }

  // Прогресс целиком — для сохранения в аккаунте (account.js).
  snapshot() { return { money: Math.round(this.balance), owned: [...this.owned] }; }
  restore({ money, owned }) {
    if (Number.isFinite(money)) this.balance = money;
    if (Array.isArray(owned)) for (const k of owned) this.owned.add(k);
    this.#save();
  }

  #save() {
    try {
      localStorage.setItem('money', String(Math.round(this.balance)));
      localStorage.setItem('owned', JSON.stringify([...this.owned]));
    } catch {}
    this.#show();
    this.onChange();
  }

  #show() {
    if (!this.el) return;
    this.el.textContent = fmt(this.balance);
    this.el.classList.toggle('debt', this.debt);
  }

  // Плашка на 3 с, не больше четырёх сразу.
  #note(text, why, kind) {
    if (!this.log) return;
    const div = document.createElement('div');
    div.className = kind;
    div.innerHTML = `<b>${text}</b> ${why ?? ''}`;
    this.log.prepend(div);
    while (this.log.children.length > 4) this.log.lastChild.remove();
    setTimeout(() => div.classList.add('out'), 2600);
    setTimeout(() => div.remove(), 3200);
    this.el?.classList.remove('bump');
    void this.el?.offsetWidth;
    this.el?.classList.add('bump');
  }
}

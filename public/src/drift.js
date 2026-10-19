// Дрифт: очки за езду боком — угол заноса × скорость × время, множитель растёт, пока дрифт не прерывается.
// Дрифт кончился (полсекунды без заноса) — очки уходят в кошелёк рублями; удар о стену или машину — сорван.
const MIN_SPEED = 8;     // м/с
const MIN_ANGLE = 12;    // градусов между курсом и движением
const MAX_ANGLE = 70;    // боком сильнее — уже разворот, очков не прибавляет
const GAP = 0.6;         // с без заноса — дрифт кончился
const MULT_EVERY = 2.5;  // с непрерывного дрифта на +1 к множителю, до MULT_MAX
const MULT_MAX = 5;
const MIN_PAY = 100;     // меньше — не считается

export class Drift {
  constructor(el) {
    this.el = el;
    this.points = 0;
    this.time = 0;
    this.gap = 0;
  }

  get mult() { return Math.min(MULT_MAX, 1 + Math.floor(this.time / MULT_EVERY)); }

  // Возвращает очки законченного дрифта (сколько рублей начислить) или 0.
  update(dt, car) {
    const f = car.forward, r = car.right;
    const vf = car.vel.dot(f), vr = car.vel.dot(r), v = Math.hypot(vf, vr);
    const angle = Math.atan2(Math.abs(vr), Math.abs(vf)) * 180 / Math.PI;
    let paid = 0;
    if (this.points && car.impact > 0.25) {
      this.#show('ДРИФТ СОРВАН', 'lost');
      this.points = this.time = 0;
    }
    if (!car.air && vf > 0 && v > MIN_SPEED && angle > MIN_ANGLE && !car.sink) {
      this.time += dt;
      this.gap = 0;
      this.points += Math.min(angle, MAX_ANGLE) * v * dt * 0.5 * this.mult;
    } else if (this.points) {
      this.gap += dt;
      if (this.gap > GAP) {
        paid = this.points >= MIN_PAY ? Math.round(this.points / 10) * 10 : 0;
        this.points = this.time = 0;
        if (paid) this.#show(`ДРИФТ ${paid.toLocaleString('ru-RU')}`, 'done');
      }
    }
    if (this.points >= MIN_PAY / 2) this.#show(`ДРИФТ ${Math.round(this.points).toLocaleString('ru-RU')}${this.mult > 1 ? ` ×${this.mult}` : ''}`, 'on');
    else if (this.state === 'on') this.#hide();
    return paid;
  }

  // Надпись: 'on' — идёт, 'done' / 'lost' — итог, гаснет через секунду.
  #show(text, state) {
    if (!this.el) return;
    if (this.el.textContent !== text) this.el.textContent = text;
    if (this.state !== state) {
      this.el.className = `hud show ${state}`;
      this.state = state;
    }
    clearTimeout(this.timer);
    if (state !== 'on') this.timer = setTimeout(() => this.#hide(), 1200);
  }

  #hide() {
    this.el.className = 'hud';
    this.state = null;
  }
}
